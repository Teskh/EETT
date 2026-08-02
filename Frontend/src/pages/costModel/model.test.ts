import { describe, expect, it } from "vitest";

import type { CostModelRow, MaterialStudyGroupRow } from "../../lib/types";
import {
  computeRowQuantity,
  getMaterialGroupMemberships,
  matchesCostModelReviewFilter,
  summarizeCostModelRows,
} from "./model";

function row(overrides: Partial<CostModelRow> = {}): CostModelRow {
  return {
    material_id: 1,
    sku: "MAT-001",
    material_name: "Material",
    unit: "un",
    price: 1000,
    estimated_total_quantity: 3,
    subtypes: [
      { subtype_id: null, subtype_name: "General", estimated_quantity: 1 },
      { subtype_id: 8, subtype_name: "A", estimated_quantity: 2 },
    ],
    instances: [],
    adjustments: [],
    is_auxiliary: false,
    ...overrides,
  };
}

describe("cost model review state", () => {
  it("does not combine mutually exclusive subtype scenarios", () => {
    const adjusted = row({
      adjustments: [
        {
          id: 1,
          subtype_id: 8,
          adjusted_quantity: 4.5,
          source_kind: "historic_consumption",
          source_note: null,
          source_house_type_id: null,
          source_range_start: null,
          source_range_end: null,
          source_sample_houses: null,
          source_total_consumption: null,
          updated_at: null,
          created_by: null,
        },
      ],
    });

    expect(computeRowQuantity(adjusted)).toBeNull();
    expect(matchesCostModelReviewFilter(adjusted, "adjusted")).toBe(true);
  });

  it("treats a partially blank subtype row and non-positive price as review items", () => {
    const incomplete = row({
      price: 0,
      subtypes: [
        { subtype_id: null, subtype_name: "General", estimated_quantity: 1 },
        { subtype_id: 8, subtype_name: "A", estimated_quantity: null },
      ],
    });

    expect(matchesCostModelReviewFilter(incomplete, "review")).toBe(true);
    expect(matchesCostModelReviewFilter(incomplete, "missing_price")).toBe(true);
    expect(summarizeCostModelRows([incomplete])).toMatchObject({
      totalRows: 1,
      pricedRows: 0,
      missingPriceRows: 1,
      missingQuantityRows: 1,
      reviewRows: 1,
    });
  });

  it("keeps valid zero quantities distinct from missing quantities", () => {
    const zero = row({
      subtypes: [{ subtype_id: null, subtype_name: "General", estimated_quantity: 0 }],
      estimated_total_quantity: 0,
    });

    expect(computeRowQuantity(zero)).toBe(0);
    expect(summarizeCostModelRows([zero]).reviewRows).toBe(0);
  });
});

describe("cost model group memberships", () => {
  function group(groupId: number, name: string, skus: string[]): MaterialStudyGroupRow {
    return {
      group_id: groupId,
      name,
      description: null,
      study_unit: "m2",
      member_count: skus.length,
      members: skus.map((sku, display_order) => ({
        sku,
        material_name: sku,
        unit: "un",
        factor_to_study_unit: 1,
        display_order,
      })),
      sku: `GROUP:${groupId}`,
      material_name: name,
      unit: "m2",
      last_movement_date: null,
      movement_quantity_60d: 0,
      movement_count_60d: 0,
    };
  }

  it("finds every matching group case-insensitively and orders them by name", () => {
    const groups = [group(2, "Muros", ["MAT-01"]), group(1, "Aislacion", ["mat-01", "MAT-02"]), group(3, "Pisos", ["MAT-03"])];

    expect(getMaterialGroupMemberships(groups, " mat-01 ").map((item) => item.group_id)).toEqual([1, 2]);
    expect(getMaterialGroupMemberships(groups, "missing")).toEqual([]);
  });
});
