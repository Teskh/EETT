import { describe, expect, it } from "vitest";
import type { CostModelAdjustment, CostModelRow, CostModelStudyMaterial } from "../../lib/types";
import { belongsToScenario, buildBudgetLine, parseBudgetQuantity, pendingSuggestions, projectMixAverage, sortBudgetLines, summarizeBudget, defaultSuggestionCriteria } from "./budget";

const row: CostModelRow = {
  material_id: 1, sku: "MAT", material_name: "Tablero", unit: "un", price: 1000,
  estimated_total_quantity: null, is_auxiliary: false, instances: [], adjustments: [],
  subtypes: [
    { subtype_id: null, subtype_name: "General", estimated_quantity: 2 },
    { subtype_id: 8, subtype_name: "A", estimated_quantity: 3 },
    { subtype_id: 9, subtype_name: "B", estimated_quantity: 7 },
  ],
};
const adjustment = (values: Partial<CostModelAdjustment>): CostModelAdjustment => ({
  id: 1, subtype_id: 8, quantity_scope: "scenario", adjusted_quantity: 6, source_kind: "manual",
  source_note: null, source_house_type_id: null, source_range_start: null, source_range_end: null,
  source_sample_houses: null, source_total_consumption: null, updated_at: null, created_by: null, ...values,
});
const reference: CostModelStudyMaterial = {
  sku: "MAT", ratio: 1.2, pooled_ratio: 1.2, method: "pooled", identifiability: null, actual: 120, expected: 100,
  expected_target: 100, target_share: 1, site_share: 0, excluded_share: 0, unit_cost: 1000, quantity_per_house: { "8": 6, "9": 10.8 },
  signals: { tracking: 0.05, active_weeks: 1, edge_sensitivity: 0.02, stability: null, weekly_actual: [], weekly_expected: [], weeks: [] },
  grade: "high", reasons: [], suggestion: "historic",
};

describe("budget per subtype", () => {
  it("includes general quantities exactly once and keeps other subtypes separate", () => {
    const a = buildBudgetLine(row, 8, reference);
    expect(a.estimate).toBe(5);
    expect(a.budgetCost).toBe(5000);
    expect(a.change).toBe(0);
    expect(a.potentialChange).toBe(1000);
    expect(a.missingSubtypes).toEqual([]);
    expect(buildBudgetLine(row, 9).quantity).toBe(9);
  });
  it("adopts a complete historical quantity without adding general quantities again", () => {
    const changed = { ...row, adjustments: [adjustment({ source_kind: "historic_allocated" })] };
    expect(buildBudgetLine(changed, 8).quantity).toBe(6);
    expect(buildBudgetLine(changed, 9).quantity).toBe(9);
  });
  it("keeps old component adjustments until the user chooses a new source", () => {
    const changed = { ...row, adjustments: [adjustment({ subtype_id: null, quantity_scope: "component", adjusted_quantity: 4 }), adjustment({ quantity_scope: "component", adjusted_quantity: 1 })] };
    expect(buildBudgetLine(changed, 8).quantity).toBe(5);
    expect(buildBudgetLine(changed, 9).quantity).toBe(11);
    changed.adjustments[1] = adjustment({ source_kind: "estimated", adjusted_quantity: 999 });
    expect(buildBudgetLine(changed, 8).quantity).toBe(5);
    expect(buildBudgetLine(changed, 8).source).toBe("estimated");
  });
  it("can override a general-only material for one subtype", () => {
    const changed = { ...row, subtypes: row.subtypes.slice(0, 1), adjustments: [adjustment({ adjusted_quantity: 0 })] };
    expect(belongsToScenario(changed, 8)).toBe(true);
    expect(buildBudgetLine(changed, 8).quantity).toBe(0);
    expect(buildBudgetLine(changed, 9).quantity).toBe(2);
  });
  it("keeps adopted history fixed when a different period is loaded", () => {
    const changed = { ...row, adjustments: [adjustment({ source_kind: "historic_allocated" })] };
    const line = buildBudgetLine(changed, 8, { ...reference, quantity_per_house: { "8": 10 } });
    expect(line.quantity).toBe(6);
    expect(line.change).toBe(1000);
  });
  it("counts the filled instances of a partly blank material and flags it", () => {
    // Subtype 8 has 3 in some instances and a blank in another.
    const changed = { ...row, subtypes: row.subtypes.map((entry) => entry.subtype_id === 8 ? { ...entry, has_missing_quantity: true } : entry) };
    const line = buildBudgetLine(changed, 8);
    expect(line.estimate).toBe(5);
    expect(line.budgetCost).toBe(5000);
    expect(line.partial).toBe(true);
    expect(buildBudgetLine(changed, 9).partial).toBe(false);
    expect(buildBudgetLine(changed, 9).missingSubtypes).toEqual(["A"]);
    expect(line.missingSubtypes).toEqual([]);
    expect(summarizeBudget([line])).toMatchObject({ budget: 5000, missingBudget: 0, partial: 1, partialBudget: 1 });
    // A chosen quantity replaces the estimate, blanks included.
    const adjusted = buildBudgetLine({ ...changed, adjustments: [adjustment({})] }, 8);
    expect(adjusted.budgetCost).toBe(6000);
    expect(summarizeBudget([adjusted]).partialBudget).toBe(0);
  });
  it("leaves a material with no quantity at all unknown", () => {
    const blank = { ...row, subtypes: row.subtypes.map((entry) => entry.subtype_id === 8 ? { ...entry, estimated_quantity: null, has_missing_quantity: true } : entry) };
    const line = buildBudgetLine(blank, 8);
    expect(line.estimate).toBeNull();
    expect(line.partial).toBe(false);
    expect(summarizeBudget([line]).missingBudget).toBe(1);
  });
  it("sorts increases and savings by absolute change with missing references last", () => {
    const base = buildBudgetLine(row, 8, reference);
    const saving = { ...base, potentialChange: -9000 };
    const noHistory = { ...base, potentialChange: null };
    expect(sortBudgetLines([base, noHistory, saving], "impact")).toEqual([saving, base, noHistory]);
  });
  it("does not treat missing prices as zero cost", () => {
    const line = buildBudgetLine({ ...row, price: null }, 8, reference);
    expect(line.budgetCost).toBeNull();
    expect(line.change).toBeNull();
  });
  it("excludes materials only applicable to another subtype", () => {
    expect(belongsToScenario({ ...row, subtypes: row.subtypes.slice(2) }, 8)).toBe(false);
  });
  it("accepts Chilean quantities and rejects negative, empty or invalid input", () => {
    expect(parseBudgetQuantity("1.234,56")).toBe(1234.56);
    expect(parseBudgetQuantity("0")).toBe(0);
    expect(parseBudgetQuantity("12,75")).toBe(12.75);
    for (const invalid of ["", "-1", "NaN", "Infinity", "1,2,3", "1.5"]) expect(parseBudgetQuantity(invalid)).toBeNull();
  });
});

describe("study suggestions and project mix", () => {
  it("takes the historic quantity of the selected subtype", () => {
    expect(buildBudgetLine(row, 9, reference).historic).toBe(10.8);
    expect(buildBudgetLine(row, null, reference).historic).toBeNull();
  });
  it("lists suggested lines until their historic quantity is in use", () => {
    // The fixture's impact is $1.000 / viv., under the default minimum.
    const criteria = { ...defaultSuggestionCriteria, minImpact: 0 };
    const line = buildBudgetLine(row, 8, reference, criteria);
    expect(pendingSuggestions([line])).toEqual([line]);
    const adopted = buildBudgetLine({ ...row, adjustments: [adjustment({ source_kind: "historic_allocated", adjusted_quantity: 6 })] }, 8, reference, criteria);
    expect(pendingSuggestions([adopted])).toEqual([]);
    expect(pendingSuggestions([buildBudgetLine(row, 8, { ...reference, grade: "medium" }, criteria)])).toEqual([]);
  });
  it("follows the viewer's suggestion criteria", () => {
    // Subtype 8: estimate 5, historic 6, ratio 1.2, price 1000 → impact $1.000 / viv.
    const at = (criteria: Partial<typeof defaultSuggestionCriteria>, study = reference) => buildBudgetLine(row, 8, study, { ...defaultSuggestionCriteria, ...criteria }).suggestion;
    expect(at({})).toBe("estimated");
    expect(at({ minImpact: 0 })).toBe("historic");
    expect(at({ minImpact: 0, minDeviation: 0.25 })).toBe("estimated");
    expect(at({ minImpact: 1500 })).toBe("estimated");
    expect(at({ minImpact: 1000 })).toBe("historic");
    expect(at({ minImpact: 0 }, { ...reference, grade: "medium" })).toBe("review");
    expect(at({ minImpact: 0, minGrade: "medium" }, { ...reference, grade: "medium" })).toBe("historic");
    expect(at({ minGrade: "medium" }, { ...reference, grade: "low" })).toBe("estimated");
  });
  it("weights each subtype by the houses it started in the period", () => {
    expect(projectMixAverage([{ subtypeId: 8, budget: 100 }, { subtypeId: 9, budget: 200 }], [{ subtype_id: 8, houses: 3 }, { subtype_id: 9, houses: 1 }])).toBe(125);
    expect(projectMixAverage([{ subtypeId: 8, budget: 100 }], [{ subtype_id: 9, houses: 1 }])).toBeNull();
    expect(projectMixAverage([], [])).toBeNull();
  });
});
