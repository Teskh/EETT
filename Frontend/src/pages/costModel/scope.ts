import type { CostModelRow, CostModelStudyMaterial } from "../../lib/types";
import { belongsToScenario, buildBudgetLine, defaultSuggestionCriteria, suggest, type BudgetLine, type SuggestionCriteria } from "./budget";

/** A subtype in the analysis and its share of the average house. */
export type ScopeSubtype = { id: number | null; name: string; weight: number };
export type ScopePart = ScopeSubtype & { line: BudgetLine };

/**
 * Weights of the selected subtypes: their houses started in the period. When
 * the period has no mix yet, or a selected subtype started no houses in it,
 * every selected subtype weighs the same, so none of its materials vanish.
 */
export function scopeWeights(selected: { id: number | null; name: string }[], mix: { subtype_id: number | null; houses: number }[] | null) {
  const houses = selected.map((item) => mix?.find((entry) => entry.subtype_id === item.id)?.houses ?? 0);
  const total = houses.reduce((sum, value) => sum + value, 0);
  const empty = mix ? selected.filter((_, index) => houses[index] === 0).map((item) => item.name) : [];
  const equal = !mix || total === 0 || empty.length > 0;
  return {
    subtypes: selected.map((item, index) => ({ ...item, weight: equal ? 1 / selected.length : houses[index] / total, houses: mix ? houses[index] : null })),
    equal,
    empty,
  };
}

function applies(line: BudgetLine) {
  // Absent from a subtype's BOM (or explicitly zero) and not adjusted there:
  // the material does not apply. A blank quantity does apply, and is incomplete.
  return !(line.estimate === 0 && (line.quantity === 0 || line.quantity === null));
}

/**
 * One material over several subtypes. Quantities are per house of the
 * subtypes that use it (a left-hand door stays 1 / viv.); costs are its
 * contribution to the average house of the mix, so they add up to the
 * weighted budget per house.
 */
export function buildScopeLine(row: CostModelRow, subtypes: ScopeSubtype[], study: CostModelStudyMaterial | null, criteria: SuggestionCriteria = defaultSuggestionCriteria): BudgetLine | null {
  const belonging: ScopePart[] = subtypes.filter((item) => belongsToScenario(row, item.id))
    .map((item) => ({ ...item, line: buildBudgetLine(row, item.id, study, criteria) }));
  if (!belonging.length) return null;
  if (subtypes.length === 1) return { ...belonging[0].line, parts: belonging, onlyIn: null, share: 1 };
  const parts = belonging.filter((part) => applies(part.line));
  const used = parts.length ? parts : belonging;
  const share = used.reduce((sum, part) => sum + part.weight, 0);
  const average = (pick: (line: BudgetLine) => number | null) =>
    used.some((part) => pick(part.line) === null) || share === 0 ? null : used.reduce((sum, part) => sum + part.weight * (pick(part.line) as number), 0) / share;
  const contribution = (pick: (line: BudgetLine) => number | null) =>
    used.some((part) => pick(part.line) === null) ? null : used.reduce((sum, part) => sum + part.weight * (pick(part.line) as number), 0);
  const sources = new Set(used.map((part) => part.line.source));
  const estimate = average((line) => line.estimate);
  const historic = average((line) => line.historic);
  const price = row.price !== null && row.price > 0 ? row.price : null;
  const selected = new Set(subtypes.map((item) => item.id));
  const first = used[0].line;
  return {
    row, study, estimate, historic,
    quantity: average((line) => line.quantity),
    source: sources.size === 1 ? first.source : "mixed",
    adjustment: first.adjustment,
    estimatedCost: contribution((line) => line.estimatedCost),
    budgetCost: contribution((line) => line.budgetCost),
    change: contribution((line) => line.change),
    potentialChange: contribution((line) => line.potentialChange),
    // The impact threshold is per average house, like the costs.
    suggestion: suggest(study, historic, estimate, price, { ...criteria, minImpact: share > 0 ? criteria.minImpact / share : criteria.minImpact }),
    missingSubtypes: row.subtypes.filter((entry) => entry.has_missing_quantity && entry.subtype_id !== null && !selected.has(entry.subtype_id)).map((entry) => entry.subtype_name),
    partial: estimate !== null && used.some((part) => part.line.partial),
    parts: used,
    onlyIn: parts.length && parts.length < subtypes.length ? parts.map((part) => part.name) : null,
    share,
  };
}

/**
 * Quantities to save per subtype when a scope line picks a source. Each
 * subtype keeps its own BOM: history applies the same ratio to each, and a
 * manual quantity scales each estimate by the same factor.
 */
export function scopeSaves(line: BudgetLine, source: "estimated" | "historic_allocated" | "manual", quantity: number) {
  const parts = line.parts ?? [];
  if (parts.length === 1) return [{ part: parts[0], quantity }];
  const factor = source === "manual" && line.estimate ? quantity / line.estimate : null;
  return parts.flatMap((part) => {
    const value = source === "estimated" ? part.line.estimate ?? 0
      : source === "historic_allocated" ? part.line.historic
      : factor !== null && part.line.estimate !== null ? part.line.estimate * factor : quantity;
    return value === null ? [] : [{ part, quantity: Math.round(value * 1e6) / 1e6 }];
  });
}
