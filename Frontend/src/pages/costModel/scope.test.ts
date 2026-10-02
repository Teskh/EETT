import { describe, expect, it } from "vitest";
import type { CostModelAdjustment, CostModelRow, CostModelStudyMaterial } from "../../lib/types";
import { buildBudgetLine, summarizeBudget } from "./budget";
import { buildScopeLine, scopeSaves, scopeWeights } from "./scope";

// Normal (8) and Espejada (9): a shared board, and a left-hand door only in Espejada.
const board: CostModelRow = {
  material_id: 1, sku: "MAT", material_name: "Tablero", unit: "un", price: 1000,
  estimated_total_quantity: null, is_auxiliary: false, instances: [], adjustments: [],
  subtypes: [{ subtype_id: 8, subtype_name: "Normal", estimated_quantity: 10 }, { subtype_id: 9, subtype_name: "Espejada", estimated_quantity: 12 }],
};
const door: CostModelRow = { ...board, material_id: 2, sku: "PUER", material_name: "Puerta izquierda", price: 50000, subtypes: [{ subtype_id: 9, subtype_name: "Espejada", estimated_quantity: 1 }] };
const study: CostModelStudyMaterial = {
  sku: "MAT", ratio: 1.2, pooled_ratio: 1.2, method: "pooled", identifiability: null, actual: 120, expected: 100,
  expected_target: 100, target_share: 1, site_share: 0, excluded_share: 0, unit_cost: 1000, quantity_per_house: { "8": 12, "9": 14.4 },
  signals: { tracking: 0.05, active_weeks: 1, edge_sensitivity: 0.02, stability: null, weekly_actual: [], weekly_expected: [], weeks: [] },
  grade: "high", reasons: [], suggestion: "historic",
};
const adjustment = (values: Partial<CostModelAdjustment>): CostModelAdjustment => ({
  id: 1, subtype_id: 8, quantity_scope: "scenario", adjusted_quantity: 11, source_kind: "manual",
  source_note: null, source_house_type_id: null, source_range_start: null, source_range_end: null,
  source_sample_houses: null, source_total_consumption: null, updated_at: null, created_by: null, ...values,
});
const selected = [{ id: 8, name: "Normal" }, { id: 9, name: "Espejada" }];
const mix = scopeWeights(selected, [{ subtype_id: 8, houses: 80 }, { subtype_id: 9, houses: 20 }]).subtypes;

describe("several subtypes in one analysis", () => {
  it("weights by the period's houses and falls back to equal weights", () => {
    expect(mix.map((item) => item.weight)).toEqual([0.8, 0.2]);
    const empty = scopeWeights(selected, [{ subtype_id: 8, houses: 80 }]);
    expect(empty.equal).toBe(true);
    expect(empty.empty).toEqual(["Espejada"]);
    expect(empty.subtypes.map((item) => item.weight)).toEqual([0.5, 0.5]);
    expect(scopeWeights(selected, null).equal).toBe(true);
  });

  it("is today's line when one subtype is selected", () => {
    const line = buildScopeLine(board, [{ id: 8, name: "Normal", weight: 1 }], study);
    const { parts, onlyIn, share, ...rest } = line!;
    const { parts: _p, onlyIn: _o, share: _s, ...reference } = buildBudgetLine(board, 8, study);
    expect(rest).toEqual(reference);
    expect(onlyIn).toBeNull();
    expect(share).toBe(1);
    expect(parts).toHaveLength(1);
  });

  it("averages shared materials and weights their cost by the mix", () => {
    const line = buildScopeLine(board, mix, study)!;
    expect(line.estimate).toBeCloseTo(10.4);
    expect(line.historic).toBeCloseTo(12.48);
    expect(line.estimatedCost).toBeCloseTo(10400);
    expect(line.onlyIn).toBeNull();
  });

  it("keeps materials of one subtype per its houses, with their cost weighted", () => {
    const line = buildScopeLine(door, mix, null)!;
    expect(line.estimate).toBe(1);
    expect(line.onlyIn).toEqual(["Espejada"]);
    expect(line.estimatedCost).toBeCloseTo(0.2 * 50000);
    // The subtype totals are the weighted average of each subtype's own budget.
    const total = summarizeBudget([buildScopeLine(board, mix, study)!, line]).estimated;
    const normal = summarizeBudget([buildBudgetLine(board, 8)]).estimated;
    const espejada = summarizeBudget([buildBudgetLine(board, 9), buildBudgetLine(door, 9)]).estimated;
    expect(total).toBeCloseTo(0.8 * normal + 0.2 * espejada);
  });

  it("marks different sources as mixed and saves each subtype's own quantity", () => {
    const line = buildScopeLine({ ...board, adjustments: [adjustment({})] }, mix, study)!;
    expect(line.source).toBe("mixed");
    expect(scopeSaves(line, "historic_allocated", line.historic!).map((item) => item.quantity)).toEqual([12, 14.4]);
    expect(scopeSaves(line, "estimated", 0).map((item) => item.quantity)).toEqual([10, 12]);
    // A manual 10 % above the average estimate is 10 % above each subtype's.
    expect(scopeSaves(line, "manual", 10.4 * 1.1).map((item) => item.quantity)).toEqual([11, 13.2]);
  });

  it("treats a blank quantity as incomplete, not as not applying", () => {
    const blank: CostModelRow = { ...board, subtypes: [board.subtypes[0], { subtype_id: 9, subtype_name: "Espejada", estimated_quantity: null, has_missing_quantity: true }] };
    const line = buildScopeLine(blank, mix, study)!;
    expect(line.onlyIn).toBeNull();
    expect(line.estimate).toBeNull();
    expect(line.estimatedCost).toBeNull();
  });
});
