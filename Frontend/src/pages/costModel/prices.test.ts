import { describe, expect, it } from "vitest";
import type { CostModelRow } from "../../lib/types";
import { buildBudgetLine, summarizeBudget } from "./budget";
import { mergePrices } from "./prices";

const windowRow: CostModelRow = {
  material_id: 1, sku: "VENT0238", material_name: "Ventana", unit: "UN", price: 371909.86,
  estimated_total_quantity: 1, is_auxiliary: false, instances: [], adjustments: [],
  subtypes: [{ subtype_id: null, subtype_name: "General", estimated_quantity: 1 }],
};

describe("prices across quantity saves", () => {
  it("keeps the original estimate and values the saved quantity when a save loses its price", () => {
    // The initial view already has prices, so no separate ERP request ran.
    const loaded = mergePrices(null, 4, { [windowRow.sku]: windowRow.price });
    const saved: CostModelRow = { ...windowRow, price: null, adjustments: [{
      id: 1, subtype_id: null, quantity_scope: "scenario", source_kind: "historic_allocated", adjusted_quantity: 2,
      source_note: null, source_house_type_id: null, source_range_start: null, source_range_end: null,
      source_sample_houses: null, source_total_consumption: null, updated_at: null, created_by: null,
    }] };
    const partial = mergePrices(loaded, 4, { VENT0238: null });
    const totals = summarizeBudget([buildBudgetLine({ ...saved, price: partial.values.VENT0238 }, null)]);
    expect(totals.estimated).toBe(371909.86);
    expect(totals.budget).toBe(743819.72);
    expect(totals.missingBudget).toBe(0);
  });

  it("merges partial refreshes without erasing known prices, then accepts a new valid quote", () => {
    const loaded = mergePrices(null, 4, { VENT0238: 371909.86, MADE0040: 5511.95 });
    const partial = mergePrices(loaded, 4, { VENT0238: 0, MADE0040: 5600, UNKNOWN: null });
    expect(partial.values).toEqual({ VENT0238: 371909.86, MADE0040: 5600 });
    expect(mergePrices(partial, 4, { " vent0238 ": 380000 }).values.VENT0238).toBe(380000);
    expect(loaded.values.MADE0040).toBe(5511.95);
  });

  it("does not carry another project's prices into the current project", () => {
    const loaded = mergePrices(null, 4, { VENT0238: 371909.86 });
    expect(mergePrices(loaded, 9, { VENT0238: null }).values).toEqual({});
  });
});
