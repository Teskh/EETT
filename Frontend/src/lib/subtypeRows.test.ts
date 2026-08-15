import { describe, expect, it } from "vitest";

import type { BomEntry, ProjectSubtype } from "./types";
import {
  allExpandableSubtypeIds,
  analyzeSubtypeBranches,
  defaultExpandedSubtypeIds,
  flattenSubtypeTree,
  isSubtypeRowVisible,
  resolveSubtypeQuantities,
} from "./subtypeRows";

const subtypeTree: ProjectSubtype[] = [
  {
    id: 1,
    parent_id: null,
    name: "Base",
    path: "Base",
    kind: "variant",
    children: [
      {
        id: 2,
        parent_id: 1,
        name: "Organization",
        path: "Base › Organization",
        kind: "group",
        children: [
          {
            id: 3,
            parent_id: 2,
            name: "Child",
            path: "Base › Organization › Child",
            kind: "variant",
            children: [
              {
                id: 4,
                parent_id: 3,
                name: "Grandchild",
                path: "Base › Organization › Child › Grandchild",
                kind: "variant",
                children: [],
              },
            ],
          },
        ],
      },
    ],
  },
];

function bomRow(
  subtypeId: number,
  quantity: number | null,
  assemblyQuantity: number | null,
): BomEntry {
  const state = (value: number | null) => (value === null ? "blank" : value === 0 ? "zero" : "value");
  return {
    subtype_id: subtypeId,
    subtype: String(subtypeId),
    subtype_depth: 0,
    inheritance_mode: "override",
    quantity,
    quantity_state: state(quantity),
    effective_quantity: quantity,
    effective_quantity_state: state(quantity),
    assembly_quantity: assemblyQuantity,
    assembly_quantity_state: state(assemblyQuantity),
    effective_assembly_quantity: assemblyQuantity,
    effective_assembly_quantity_state: state(assemblyQuantity),
    inherited_from_subtype_id: null,
    inherited_from_subtype: null,
    unit: "UN",
    calculation_mode: "manual",
    calculation_formula: null,
    calculation_explanation: null,
    is_persisted: true,
  };
}

describe("subtype row compaction", () => {
  it("links variants through organizational groups", () => {
    const options = flattenSubtypeTree(subtypeTree);

    expect(options.map(({ id, parentId, depth }) => ({ id, parentId, depth }))).toEqual([
      { id: 1, parentId: null, depth: 0 },
      { id: 3, parentId: 1, depth: 2 },
      { id: 4, parentId: 3, depth: 3 },
    ]);
  });

  it("resolves inherited and additive quantities locally", () => {
    const options = flattenSubtypeTree(subtypeTree);
    const resolved = resolveSubtypeQuantities(
      [
        { subtype_id: 1, quantity: 5, assembly_quantity: 2, inheritance_mode: "override" },
        { subtype_id: 3, quantity: null, assembly_quantity: null, inheritance_mode: "override" },
        { subtype_id: 4, quantity: 1, assembly_quantity: 0, inheritance_mode: "add" },
      ],
      options,
    );

    expect(resolved.get(3)).toMatchObject({ quantity: 5, assemblyQuantity: 2, quantitySourceId: 1 });
    expect(resolved.get(4)).toMatchObject({ quantity: 6, assemblyQuantity: 2, quantitySourceId: 4 });
  });

  it("collapses a branch only when every effective factory and assembly quantity matches", () => {
    const options = flattenSubtypeTree(subtypeTree);
    const uniformRows = [bomRow(1, 5, 2), bomRow(3, 5, 2), bomRow(4, 5, 2)];

    expect(analyzeSubtypeBranches(uniformRows, options).get(1)).toEqual({ descendantCount: 2, uniform: true });
    expect(defaultExpandedSubtypeIds(uniformRows, options)).toEqual(new Set());
    expect(isSubtypeRowVisible(3, options, new Set())).toBe(false);
    expect(isSubtypeRowVisible(3, options, allExpandableSubtypeIds(options))).toBe(true);

    const differingRows = [bomRow(1, 5, 2), bomRow(3, 5, 2), bomRow(4, 5, 0)];
    expect(analyzeSubtypeBranches(differingRows, options).get(1)?.uniform).toBe(false);
    expect(defaultExpandedSubtypeIds(differingRows, options)).toEqual(new Set([1, 3]));
  });

  it("keeps blank and zero quantities distinct", () => {
    const options = flattenSubtypeTree(subtypeTree);
    const rows = [bomRow(1, null, null), bomRow(3, 0, null), bomRow(4, 0, null)];

    expect(analyzeSubtypeBranches(rows, options).get(1)?.uniform).toBe(false);
    expect(analyzeSubtypeBranches(rows, options).get(3)?.uniform).toBe(true);
  });
});
