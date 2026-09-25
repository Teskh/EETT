import type { CostModelAdjustment, CostModelRow, CostModelStudyMaterial } from "../../lib/types";
import { findSubtypeAdjustment, quantityCost } from "./model";

export type BudgetSource = "estimated" | "historic_allocated" | "manual" | "legacy";
export type BudgetLine = {
  row: CostModelRow;
  estimate: number | null;
  quantity: number | null;
  source: BudgetSource;
  adjustment: CostModelAdjustment | null;
  study: CostModelStudyMaterial | null;
  /** Historic quantity per house for this subtype, from the study. */
  historic: number | null;
  estimatedCost: number | null;
  budgetCost: number | null;
  /** Budget minus estimate per house, in pesos: what the chosen source changes. */
  change: number | null;
  /** What using the historic quantity would change against the estimate, whatever its confidence. */
  potentialChange: number | null;
  /** Other subtypes whose BOM leaves this material blank: their houses expect none of it. */
  missingSubtypes: string[];
  /** Whether to adopt the historic quantity, under the viewer's criteria. */
  suggestion: Suggestion;
};

export type Suggestion = "historic" | "review" | "estimated";
export type SuggestionCriteria = {
  /** Minimum |real / estimate − 1|, e.g. 0.1 for 10%. */
  minDeviation: number;
  /** Lowest confidence suggested outright; "medium" also suggests what would be reviewed. */
  minGrade: "high" | "medium";
  /** Minimum |historic − estimate| × price per house, in pesos. */
  minImpact: number;
};
export const defaultSuggestionCriteria: SuggestionCriteria = { minDeviation: 0.1, minGrade: "high", minImpact: 0 };

export function suggest(study: CostModelStudyMaterial | null, historic: number | null, estimate: number | null, price: number | null, criteria: SuggestionCriteria): Suggestion {
  const ratio = study?.ratio ?? null;
  if (!study || ratio === null || historic === null || study.grade === "low" || study.grade === "none") return "estimated";
  if (Math.abs(ratio - 1) < criteria.minDeviation) return "estimated";
  if (criteria.minImpact > 0 && (estimate === null || price === null || Math.abs(historic - estimate) * price < criteria.minImpact)) return "estimated";
  return study.grade === "high" || criteria.minGrade === "medium" ? "historic" : "review";
}

function componentEstimate(row: CostModelRow, subtypeId: number | null): number | null {
  const entry = row.subtypes.find((item) => item.subtype_id === subtypeId);
  return entry ? entry.has_missing_quantity ? null : entry.estimated_quantity : 0;
}

function add(left: number | null, right: number | null) {
  return left === null || right === null ? null : left + right;
}

export function historicQuantity(study: CostModelStudyMaterial | null, subtypeId: number | null): number | null {
  return study?.quantity_per_house[subtypeId === null ? "general" : String(subtypeId)] ?? null;
}

export function buildBudgetLine(row: CostModelRow, subtypeId: number | null, study: CostModelStudyMaterial | null = null, criteria: SuggestionCriteria = defaultSuggestionCriteria): BudgetLine {
  const general = componentEstimate(row, null);
  const estimate = subtypeId === null ? general : add(general, componentEstimate(row, subtypeId));
  const adjustment = findSubtypeAdjustment(row, subtypeId);
  const generalAdjustment = findSubtypeAdjustment(row, null);
  let quantity = estimate;
  let source: BudgetSource = "estimated";
  if (adjustment?.quantity_scope === "scenario") {
    source = adjustment.source_kind === "estimated" ? "estimated" : adjustment.source_kind === "historic_allocated" ? "historic_allocated" : "manual";
    quantity = source === "estimated" ? estimate : adjustment.adjusted_quantity;
  } else if (adjustment || generalAdjustment) {
    // Old adjustments replace one contribution, whereas new ones replace the whole scenario.
    const effectiveGeneral = generalAdjustment?.source_kind === "estimated" ? general : generalAdjustment?.adjusted_quantity ?? general;
    quantity = subtypeId === null ? effectiveGeneral : add(effectiveGeneral, adjustment?.adjusted_quantity ?? componentEstimate(row, subtypeId));
    source = "legacy";
  }
  const price = row.price !== null && row.price > 0 ? row.price : null;
  const historic = historicQuantity(study, subtypeId);
  return {
    row, estimate, quantity, source, adjustment, study, historic,
    estimatedCost: quantityCost(estimate, price), budgetCost: quantityCost(quantity, price),
    change: quantity !== null && estimate !== null ? quantityCost(quantity - estimate, price) : null,
    potentialChange: historic !== null && estimate !== null ? quantityCost(historic - estimate, price) : null,
    missingSubtypes: row.subtypes.filter((entry) => entry.has_missing_quantity && entry.subtype_id !== null && entry.subtype_id !== subtypeId).map((entry) => entry.subtype_name),
    suggestion: suggest(study, historic, estimate, price, criteria),
  };
}

export function belongsToScenario(row: CostModelRow, subtypeId: number | null) {
  return row.subtypes.some((entry) => entry.subtype_id === null || entry.subtype_id === subtypeId)
    || row.adjustments.some((adjustment) => adjustment.subtype_id === subtypeId);
}

export type BudgetSort = "estimated_cost" | "budget_cost" | "impact" | "name";

function shownChange(line: BudgetLine): number | null {
  return line.source === "estimated" ? line.potentialChange : line.change;
}

export function sortBudgetLines(lines: BudgetLine[], sort: BudgetSort): BudgetLine[] {
  return [...lines].sort((a, b) => {
    const left = sort === "impact" ? shownChange(a) === null ? null : Math.abs(shownChange(a) as number) : sort === "budget_cost" ? a.budgetCost : a.estimatedCost;
    const right = sort === "impact" ? shownChange(b) === null ? null : Math.abs(shownChange(b) as number) : sort === "budget_cost" ? b.budgetCost : b.estimatedCost;
    if (sort !== "name") {
      if (left === null && right !== null) return 1;
      if (right === null && left !== null) return -1;
      if (left !== null && right !== null && left !== right) return right - left;
    }
    return a.row.material_name.localeCompare(b.row.material_name, "es") || a.row.sku.localeCompare(b.row.sku);
  });
}

export function summarizeBudget(lines: BudgetLine[]) {
  return {
    estimated: lines.reduce((sum, line) => sum + (line.estimatedCost ?? 0), 0),
    budget: lines.reduce((sum, line) => sum + (line.budgetCost ?? 0), 0),
    missingEstimate: lines.filter((line) => line.estimatedCost === null).length,
    missingBudget: lines.filter((line) => line.budgetCost === null).length,
    adjusted: lines.filter((line) => line.source !== "estimated").length,
  };
}

export function parseBudgetQuantity(value: string): number | null {
  const normalized = value.trim().replace(/\s/g, "");
  if (!/^(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d+)?$/.test(normalized)) return null;
  const number = Number(normalized.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(number) && number >= 0 ? number : null;
}

/** Lines whose suggested historic quantity is not the one in use yet. */
export function pendingSuggestions(lines: BudgetLine[]): BudgetLine[] {
  return lines.filter((line) => !line.row.is_auxiliary && line.row.material_id !== null && line.suggestion === "historic"
    && line.historic !== null && !(line.source === "historic_allocated" && line.quantity === line.historic));
}

/**
 * Budget per house of the whole project, weighting each subtype by the houses
 * it started in the study period: the mix is whatever was produced.
 */
export function projectMixAverage(totals: { subtypeId: number | null; budget: number }[], mix: { subtype_id: number | null; houses: number }[]): number | null {
  const houses = mix.reduce((sum, item) => sum + item.houses, 0);
  if (!houses) return null;
  let total = 0;
  for (const item of mix) {
    const match = totals.find((entry) => entry.subtypeId === item.subtype_id);
    if (!match) return null;
    total += match.budget * item.houses;
  }
  return total / houses;
}
