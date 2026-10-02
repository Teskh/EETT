import { describe, expect, it } from "vitest";
import type { CostModelExtra, CostModelUnbudgetedMaterial } from "../../lib/types";
import { buildExtraLines, includedExtrasPerHouse } from "./extras";

const mdp: CostModelUnbudgetedMaterial = {
  sku: "PLAC0075", name: "MDP 18MM", unit: "UN", quantity: 400, quantity_per_house: 4, value_per_house: 96000,
  active_weeks: 3, explained_elsewhere: 0, main_cost_center: "04-16-16", main_cost_center_name: null, main_cost_center_share: 1, replaces: [],
};
const screws: CostModelUnbudgetedMaterial = { ...mdp, sku: "FIJA0332", name: "TIRAFONDO", quantity_per_house: 30, value_per_house: 15000 };
const decision = (values: Partial<CostModelExtra>): CostModelExtra => ({
  sku: "PLAC0075", name: "MDP 18MM", unit: "UN", included: true, quantity_per_house: null, unit_cost: null, replaces_sku: null,
  source_range_start: null, source_range_end: null, note: null, updated_at: null, ...values,
});

describe("materials outside the BOM as budget lines", () => {
  it("follows the project default until decided", () => {
    expect(buildExtraLines([mdp, screws], { stored: true, default: "include", items: [] }).map((line) => line.included)).toEqual([true, true]);
    const excluded = buildExtraLines([mdp, screws], { stored: true, default: "exclude", items: [decision({ sku: "FIJA0332" })] });
    expect(excluded.map((line) => [line.sku, line.included, line.decided])).toEqual([["PLAC0075", false, false], ["FIJA0332", true, true]]);
    expect(includedExtrasPerHouse(excluded)).toBe(15000);
  });

  it("values a pinned quantity at the period's unit cost", () => {
    const [line] = buildExtraLines([mdp], { stored: true, default: "include", items: [decision({ quantity_per_house: 11.4 })] });
    expect(line.pinned).toBe(true);
    expect(line.valuePerHouse).toBeCloseTo(11.4 * 24000);
  });

  it("keeps decided materials that the current period did not withdraw", () => {
    const lines = buildExtraLines([], { stored: true, default: "include", items: [decision({ quantity_per_house: 10, unit_cost: 2000 })] });
    expect(lines.map((line) => [line.inStudy, line.valuePerHouse])).toEqual([[false, 20000]]);
  });
});
