import { describe, expect, it } from "vitest";
import type { CostModelRow, CostModelStudy, CostModelStudyMaterial, MaterialStudyGroupRow } from "../../lib/types";
import { buildBudgetLine, pendingSuggestions } from "./budget";
import { applyGroupValidation, groupBudget, groupHistoric, validateGroups, type ExtraMark } from "./groupValidation";

const row = (sku: string, estimate: number, price: number, materialId: number): CostModelRow => ({
  material_id: materialId, sku, material_name: sku, unit: "un", price, estimated_total_quantity: null,
  is_auxiliary: false, instances: [], adjustments: [], subtypes: [{ subtype_id: 8, subtype_name: "Normal", estimated_quantity: estimate }],
});
const material = (sku: string, historic: number, values: Partial<CostModelStudyMaterial> = {}): CostModelStudyMaterial => ({
  sku, ratio: null, pooled_ratio: null, method: "pooled", identifiability: null, actual: 0, expected: 0, expected_target: 0,
  target_share: 1, site_share: 0, excluded_share: 0, unit_cost: null, quantity_per_house: { "8": historic },
  signals: { tracking: null, active_weeks: null, edge_sensitivity: null, stability: null, weekly_actual: [], weekly_expected: [], weeks: [] },
  grade: "low", reasons: ["change_point"], suggestion: "estimated", ...values,
});
const group = (skus: string[]): MaterialStudyGroupRow => ({
  group_id: 1, name: "2x4", description: null, study_unit: "ml", member_count: skus.length, sku: "GROUP:1", material_name: "2x4", unit: null,
  last_movement_date: null, movement_quantity_60d: 0, movement_count_60d: 0,
  members: skus.map((sku, index) => ({ sku, material_name: sku, unit: "UN", factor_to_study_unit: 3.2, display_order: index })),
});

// Impregnated pine: estimate 100 at $5.000 ($500.000); 70 were used, and dry pine outside the BOM made up the rest.
const impregnated = row("IMPREG", 100, 5000, 1);
const line = (study = material("IMPREG", 70, { ratio: 0.7 })) => buildBudgetLine(impregnated, 8, study);
const dry = (included: boolean, valuePerHouse = 160000) => new Map<string, ExtraMark>([["SECO", { included, valuePerHouse }]]);

describe("group validation", () => {
  it("suggests the history of a low-confidence member when an included substitute closes the group", () => {
    const validations = validateGroups([group(["IMPREG", "SECO"])], [line()], dry(true));
    expect(validations.get("IMPREG")?.ratio).toBeCloseTo(1.02);
    expect(validations.get("IMPREG")?.complements).toEqual(["SECO"]);
    const [validated] = applyGroupValidation([line()], validations);
    expect(line().suggestion).toBe("estimated");
    expect(validated.suggestion).toBe("historic");
    expect(pendingSuggestions([validated])).toEqual([validated]);
  });

  it("leaves a manual quantity alone, e.g. the rate since a replacement", () => {
    const manual = { ...line(), source: "manual" as const, quantity: 0 };
    const [kept] = applyGroupValidation([manual], validateGroups([group(["IMPREG", "SECO"])], [line()], dry(true)));
    expect(kept.suggestion).toBe("estimated");
  });

  it("budgets the group as configured: BOM members at their source plus included substitutes", () => {
    const historic = { ...line(), source: "historic_allocated" as const, quantity: 70, budgetCost: 350000 };
    const current = groupBudget(["IMPREG", "SECO", "OTRO"], [historic], new Map([...dry(true), ["OTRO", { included: false, valuePerHouse: 9000 }]]));
    expect(current.total).toBe(510000);
    expect(current.bom).toBe(350000);
    expect(current.outside).toBe(160000);
    expect(current.members.map((item) => item.source)).toEqual(["historic_allocated", "extra_included", "extra_excluded"]);
    expect(groupBudget(["IMPREG", "SECO"], [line()], dry(false)).total).toBe(500000);
  });

  it("measures the group's history in the study's terms and flags members it cannot attribute", () => {
    const study = {
      materials: [material("IMPREG", 70), material("IZQ", 0)],
      unbudgeted: [{ sku: "SECO", quantity_per_house: 40, value_per_house: 160000 }],
    } as unknown as CostModelStudy;
    const history = groupHistoric(["IMPREG", "SECO", "IZQ", "NUNCA"], [line()], study);
    expect(history.members.map((item) => [item.source, item.cost])).toEqual([["bom", 350000], ["outside", 160000], ["unattributed", null], ["none", 0]]);
    expect(history.total).toBe(510000);
    expect(history.unattributed).toEqual(["IZQ"]);
    expect(groupHistoric(["IMPREG"], [line()], null).total).toBeNull();
  });

  it("does not validate when the substitute is excluded or the group does not add up", () => {
    expect(validateGroups([group(["IMPREG", "SECO"])], [line()], dry(false)).size).toBe(0);
    expect(validateGroups([group(["IMPREG", "SECO"])], [line()], dry(true, 20000)).size).toBe(0);
  });

  it("needs a complement: a member alone below its estimate is not a substitution", () => {
    expect(validateGroups([group(["IMPREG"])], [line()], new Map()).size).toBe(0);
  });

  it("validates members that deviate in opposite directions", () => {
    const small = row("SMALL", 46, 2547, 2);
    const large = row("LARGE", 55, 2547, 3);
    const lines = [buildBudgetLine(small, 8, material("SMALL", 60)), buildBudgetLine(large, 8, material("LARGE", 38))];
    expect(validateGroups([group(["SMALL", "LARGE"])], lines, new Map()).size).toBe(2);
  });

  it("keeps the estimate when the history is biased low by excluded cost centers or an incomplete BOM", () => {
    expect(validateGroups([group(["IMPREG", "SECO"])], [line(material("IMPREG", 70, { excluded_share: 0.4 }))], dry(true)).size).toBe(0);
    expect(validateGroups([group(["IMPREG", "SECO"])], [line(material("IMPREG", 70, { reasons: ["incomplete_bom"] }))], dry(true)).size).toBe(0);
  });

  it("keeps the estimate when the other member belongs to another subtype, like a door's other hand", () => {
    // The left-hand door is in Espejada's BOM, not Normal's: no history here, and no extra either.
    const right = buildBudgetLine(row("DER", 1, 180000, 4), 8, material("DER", 0.55));
    expect(validateGroups([group(["DER", "IZQ"])], [right], new Map()).size).toBe(0);
  });
});
