import type { CostModelStudy, MaterialStudyGroupRow } from "../../lib/types";
import type { BudgetLine } from "./budget";

/** How far the group's real cost may be from its estimate and still validate the estimate. */
export const GROUP_TOLERANCE = 0.1;
/** Members withdrawn this much through excluded cost centers (e.g. Obra) have a history biased low. */
export const MAX_EXCLUDED_SHARE = 0.2;
const UNRELIABLE_REASONS = new Set(["incomplete_bom", "no_consumption", "no_expected"]);

export type GroupValidation = {
  groupId: number;
  name: string;
  /** Real cost of the group (members at their historic quantity plus included substitutes) over its estimated cost. */
  ratio: number;
  estimatedCost: number;
  realCost: number;
  /** Members outside the BOM, included in «Fuera de presupuesto», that explain the deviation. */
  complements: string[];
};

export type ExtraMark = { included: boolean; valuePerHouse: number | null; quantityPerHouse?: number | null };

/** Where a group member's budgeted quantity comes from under the current configuration. */
export type MemberBudgetSource = BudgetLine["source"] | "extra_included" | "extra_excluded" | "none";
export type MemberBudget = { sku: string; source: MemberBudgetSource; quantity: number | null; cost: number | null };

/**
 * What the current configuration budgets for each member and for the group:
 * BOM members at their chosen source, members outside the BOM at their value
 * when included in «Fuera de presupuesto», nothing when excluded or absent.
 * This is the figure to compare with the group's real consumption.
 */
export function groupBudget(skus: string[], lines: BudgetLine[], extras: Map<string, ExtraMark>) {
  const bySku = new Map(lines.map((line) => [key(line.row.sku), line]));
  const members: MemberBudget[] = skus.map((sku) => {
    const line = bySku.get(key(sku));
    if (line) return { sku, source: line.source, quantity: line.quantity, cost: line.budgetCost };
    const extra = extras.get(key(sku));
    if (!extra) return { sku, source: "none", quantity: null, cost: 0 };
    return extra.included
      ? { sku, source: "extra_included", quantity: extra.quantityPerHouse ?? null, cost: extra.valuePerHouse }
      : { sku, source: "extra_excluded", quantity: 0, cost: 0 };
  });
  const bom = members.filter((member) => bySku.has(key(member.sku)));
  const outside = members.filter((member) => member.source === "extra_included");
  const add = (items: MemberBudget[]) => items.some((item) => item.cost === null) ? null : items.reduce((sum, item) => sum + (item.cost as number), 0);
  return { members, bom: add(bom), outside: add(outside), total: add(members), outsideCount: outside.length };
}

const key = (sku: string) => sku.trim().toUpperCase();

/**
 * Groups whose members substitute each other and, together, consumed what the
 * BOM estimated. Each member's deviation is then a shift between members, not
 * noise, so every budgeted member can take its historic quantity whatever its
 * own confidence: the substitutes outside the BOM are already in the budget.
 *
 * A group validates only when all of this holds:
 * - every budgeted member has a historic quantity, withdrawn mostly in the plant
 *   (not through excluded cost centers) and with a complete BOM;
 * - members outside the BOM that were withdrawn are included in the budget;
 * - something complements the deviation: an included substitute, or members
 *   deviating in opposite directions;
 * - the group's real cost is within GROUP_TOLERANCE of its estimate.
 * Members that only exist in another subtype (e.g. a door's other hand) have no
 * historic quantity here, so their group never validates: the estimate stays.
 */
export function validateGroups(groups: MaterialStudyGroupRow[], lines: BudgetLine[], extras: Map<string, ExtraMark>): Map<string, GroupValidation> {
  const bySku = new Map(lines.filter((line) => !line.row.is_auxiliary && line.row.material_id !== null).map((line) => [key(line.row.sku), line]));
  const result = new Map<string, GroupValidation>();
  for (const group of groups) {
    const members = [...new Set(group.members.map((member) => key(member.sku)))];
    const budgeted = members.flatMap((sku) => bySku.get(sku) ?? []);
    if (!budgeted.length) continue;
    const reliable = budgeted.every((line) => line.historic !== null && line.estimatedCost !== null && line.potentialChange !== null && line.study !== null
      && line.study.excluded_share < MAX_EXCLUDED_SHARE && !line.study.reasons.some((reason) => UNRELIABLE_REASONS.has(reason)));
    if (!reliable) continue;
    const outside = members.filter((sku) => !bySku.has(sku)).flatMap((sku) => {
      const extra = extras.get(sku);
      return extra && (extra.valuePerHouse ?? 0) > 0 ? [{ sku, extra }] : [];
    });
    // An excluded substitute would leave its share of the group out of the budget.
    if (outside.some((item) => !item.extra.included)) continue;
    const changes = budgeted.map((line) => line.potentialChange as number);
    const opposite = changes.some((value) => value > 0) && changes.some((value) => value < 0);
    if (!outside.length && !opposite) continue;
    const estimatedCost = budgeted.reduce((sum, line) => sum + (line.estimatedCost as number), 0);
    const realCost = budgeted.reduce((sum, line) => sum + (line.estimatedCost as number) + (line.potentialChange as number), 0)
      + outside.reduce((sum, item) => sum + (item.extra.valuePerHouse ?? 0), 0);
    if (estimatedCost <= 0) continue;
    const ratio = realCost / estimatedCost;
    if (Math.abs(ratio - 1) > GROUP_TOLERANCE) continue;
    const validation = { groupId: group.group_id, name: group.name, ratio, estimatedCost, realCost, complements: outside.map((item) => item.sku) };
    for (const line of budgeted) if (!result.has(key(line.row.sku))) result.set(key(line.row.sku), validation);
  }
  return result;
}

/**
 * Suggests the historic quantity for members of validated groups. A manual
 * quantity stays: it is a deliberate choice, e.g. the rate since a replacement.
 */
export function applyGroupValidation(lines: BudgetLine[], validations: Map<string, GroupValidation>): BudgetLine[] {
  if (!validations.size) return lines;
  return lines.map((line) => {
    const validation = validations.get(key(line.row.sku));
    return validation && line.historic !== null && line.source !== "manual" ? { ...line, suggestion: "historic", groupValidation: validation } : line;
  });
}

/** Where a member's historic consumption comes from in the study (excluded cost centers left out). */
export type MemberHistoricSource = "bom" | "outside" | "unattributed" | "none";
export type MemberHistoric = { sku: string; source: MemberHistoricSource; quantity: number | null; cost: number | null };

/**
 * The group's historic consumption per house, in the study's terms: BOM
 * members at their historic quantity (the budget table's «Histórica»),
 * members outside the BOM at what «Fuera de presupuesto» measured. A member
 * the study knows but attributes nothing to this selection (e.g. a door's
 * other hand when production does not tell subtypes apart) is unattributed:
 * the total leaves it out and says so.
 */
export function groupHistoric(skus: string[], lines: BudgetLine[], study: CostModelStudy | null) {
  const bySku = new Map(lines.map((line) => [key(line.row.sku), line]));
  const outside = new Map((study?.unbudgeted ?? []).map((item) => [key(item.sku), item]));
  const known = new Set((study?.materials ?? []).map((item) => key(item.sku)));
  const members: MemberHistoric[] = skus.map((sku) => {
    const line = bySku.get(key(sku));
    if (line) {
      const cost = line.estimatedCost !== null && line.potentialChange !== null ? line.estimatedCost + line.potentialChange : null;
      return line.historic === null ? { sku, source: "unattributed", quantity: null, cost: null } : { sku, source: "bom", quantity: line.historic, cost };
    }
    const extra = outside.get(key(sku));
    if (extra) return { sku, source: "outside", quantity: extra.quantity_per_house, cost: extra.value_per_house };
    return known.has(key(sku)) ? { sku, source: "unattributed", quantity: null, cost: null } : { sku, source: "none", quantity: 0, cost: 0 };
  });
  const unattributed = members.filter((item) => item.cost === null).map((item) => item.sku);
  const total = study ? members.reduce((sum, item) => sum + (item.cost ?? 0), 0) : null;
  return { members, total, unattributed };
}
