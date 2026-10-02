import type { CostModelExtra, CostModelExtras, CostModelUnbudgetedMaterial } from "../../lib/types";

export type ExtraLine = {
  sku: string;
  name: string;
  unit: string | null;
  included: boolean;
  /** The user decided this material; otherwise it follows the project default. */
  decided: boolean;
  /** Quantity fixed by the user, e.g. the rate since a replacement. */
  pinned: boolean;
  quantityPerHouse: number | null;
  unitCost: number | null;
  valuePerHouse: number | null;
  activeWeeks: number | null;
  mainCostCenter: { code: string; name: string | null; share: number | null } | null;
  replaces: CostModelUnbudgetedMaterial["replaces"];
  replacesSku: string | null;
  /** Withdrawn in the study period. Decided lines from other periods may not be. */
  inStudy: boolean;
  decision: CostModelExtra | null;
};

/**
 * Materials outside the BOM as budget lines: the study's list merged with the
 * project's decisions. Undecided materials follow the project default, and
 * unpinned quantities follow the study period.
 */
export function buildExtraLines(unbudgeted: CostModelUnbudgetedMaterial[], extras: CostModelExtras | null): ExtraLine[] {
  const decisions = new Map((extras?.items ?? []).map((item) => [item.sku, item]));
  const includeByDefault = (extras?.default ?? "include") === "include";
  const lines: ExtraLine[] = unbudgeted.map((item) => {
    const decision = decisions.get(item.sku) ?? null;
    decisions.delete(item.sku);
    const unitCost = decision?.unit_cost ?? (item.quantity_per_house > 0 ? item.value_per_house / item.quantity_per_house : null);
    const quantity = decision?.quantity_per_house ?? item.quantity_per_house;
    return {
      sku: item.sku, name: item.name, unit: item.unit, included: decision ? decision.included : includeByDefault,
      decided: decision !== null, pinned: decision?.quantity_per_house != null,
      quantityPerHouse: quantity, unitCost,
      valuePerHouse: decision?.quantity_per_house != null ? unitCost === null ? null : quantity * unitCost : item.value_per_house,
      activeWeeks: item.active_weeks,
      mainCostCenter: item.main_cost_center ? { code: item.main_cost_center, name: item.main_cost_center_name, share: item.main_cost_center_share } : null,
      replaces: item.replaces, replacesSku: decision?.replaces_sku ?? null, inStudy: true, decision,
    };
  });
  for (const decision of decisions.values()) {
    const quantity = decision.quantity_per_house;
    lines.push({
      sku: decision.sku, name: decision.name ?? decision.sku, unit: decision.unit, included: decision.included,
      decided: true, pinned: quantity !== null, quantityPerHouse: quantity, unitCost: decision.unit_cost,
      valuePerHouse: quantity !== null && decision.unit_cost !== null ? quantity * decision.unit_cost : null,
      activeWeeks: null, mainCostCenter: null, replaces: [], replacesSku: decision.replaces_sku, inStudy: false, decision,
    });
  }
  return lines.sort((a, b) => (b.valuePerHouse ?? 0) - (a.valuePerHouse ?? 0));
}

export function includedExtrasPerHouse(lines: ExtraLine[]): number {
  return lines.reduce((sum, line) => sum + (line.included ? line.valuePerHouse ?? 0 : 0), 0);
}
