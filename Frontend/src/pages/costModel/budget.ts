import type { CostModelAdjustment, CostModelHistoryReference, CostModelRow } from "../../lib/types";
import { findSubtypeAdjustment, quantityCost } from "./model";

export type BudgetSource = "estimated" | "historic_allocated" | "manual" | "legacy";
export type BudgetLine = {
  row: CostModelRow;
  estimate: number | null;
  quantity: number | null;
  source: BudgetSource;
  adjustment: CostModelAdjustment | null;
  reference: CostModelHistoryReference | null;
  estimatedCost: number | null;
  budgetCost: number | null;
  historicalImpact: number | null;
};

function componentEstimate(row: CostModelRow, subtypeId: number | null): number | null {
  const entry = row.subtypes.find((item) => item.subtype_id === subtypeId);
  return entry ? entry.has_missing_quantity ? null : entry.estimated_quantity : 0;
}

function add(left: number | null, right: number | null) {
  return left === null || right === null ? null : left + right;
}

export function buildBudgetLine(row: CostModelRow, subtypeId: number | null, reference: CostModelHistoryReference | null = null): BudgetLine {
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
  return {
    row, estimate, quantity, source, adjustment, reference,
    estimatedCost: quantityCost(estimate, price), budgetCost: quantityCost(quantity, price),
    historicalImpact: reference?.quantity_per_house != null && quantity !== null
      ? quantityCost(reference.quantity_per_house - quantity, price) : null,
  };
}

export function belongsToScenario(row: CostModelRow, subtypeId: number | null) {
  return row.subtypes.some((entry) => entry.subtype_id === null || entry.subtype_id === subtypeId)
    || row.adjustments.some((adjustment) => adjustment.subtype_id === subtypeId);
}

export type BudgetSort = "estimated_cost" | "budget_cost" | "impact" | "name";

export function sortBudgetLines(lines: BudgetLine[], sort: BudgetSort): BudgetLine[] {
  return [...lines].sort((a, b) => {
    const left = sort === "impact" ? a.historicalImpact === null ? null : Math.abs(a.historicalImpact) : sort === "budget_cost" ? a.budgetCost : a.estimatedCost;
    const right = sort === "impact" ? b.historicalImpact === null ? null : Math.abs(b.historicalImpact) : sort === "budget_cost" ? b.budgetCost : b.estimatedCost;
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
