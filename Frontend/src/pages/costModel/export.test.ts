import { describe, expect, it } from "vitest";
import type { CostModelRow } from "../../lib/types";
import { buildBudgetLine, summarizeBudget } from "./budget";
import { buildCostExport } from "./export";

const row: CostModelRow = {
  material_id: 1, sku: "CINTA", material_name: "Cinta", unit: "un", price: 1000, estimated_total_quantity: null, is_auxiliary: false, adjustments: [],
  subtypes: [{ subtype_id: null, subtype_name: "General", estimated_quantity: 4, has_missing_quantity: true }, { subtype_id: 8, subtype_name: "A", estimated_quantity: 1 }],
  instances: [
    { instance_id: 1, instance_name: "Muro", category_label: "1. Muros", subtype_id: null, subtype_name: "General", quantity: 4, quantity_state: "value" },
    { instance_id: 2, instance_name: "Tabique", category_label: "1. Muros", subtype_id: null, subtype_name: "General", quantity: null, quantity_state: "blank" },
    { instance_id: 1, instance_name: "Muro", category_label: "1. Muros", subtype_id: 8, subtype_name: "A", quantity: 1, quantity_state: "value" },
    { instance_id: 1, instance_name: "Muro", category_label: "1. Muros", subtype_id: 9, subtype_name: "B", quantity: 0, quantity_state: "zero" },
  ],
};
const absent: CostModelRow = { ...row, material_id: 2, sku: "PUERTA", subtypes: [{ subtype_id: 9, subtype_name: "B", estimated_quantity: 0 }], instances: [] };

describe("cost model export", () => {
  const lines = [buildBudgetLine(row, 8), buildBudgetLine(absent, 8)];
  const payload = buildCostExport({
    subtypes: [{ id: 8, name: "A", lines }], mix: [{ subtype_id: 8, houses: 5 }], targetHouses: 5,
    range: { startDate: "2026-06-01", endDate: "2026-08-31" }, selection: [{ name: "A", weight: 1 }], extras: [], rows: [row, absent],
    now: new Date("2026-09-27T12:00:00Z"),
  });

  it("sends the page's own quantities, so the workbook totals the page's budget", () => {
    const [subtype] = payload.subtypes;
    expect(subtype.houses).toBe(5);
    expect(subtype.lines).toHaveLength(1);
    const [line] = subtype.lines;
    expect(line).toMatchObject({ sku: "CINTA", estimate: 5, quantity: 5, price: 1000, partial: true, source: "Estimada" });
    expect(line.quantity! * line.price!).toBe(summarizeBudget(lines).budget);
  });

  it("lists each subtype's house in the BOM detail, blanks included", () => {
    expect(payload.detail.map((item) => [item.instance, item.quantity])).toEqual([["Muro", 4], ["Tabique", null], ["Muro", 1]]);
    expect(payload.selection).toBeNull();
  });
});
