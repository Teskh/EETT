import type { BomEntry, ProjectSubtype } from "./types";

export type FlatSubtype = {
  id: number;
  name: string;
  depth: number;
  parentId: number | null;
};

export type EditableSubtypeQuantity = {
  subtype_id: number | null;
  quantity: number | null;
  assembly_quantity: number | null;
  inheritance_mode?: "override" | "add";
};

export type ResolvedSubtypeQuantity = {
  quantity: number | null;
  assemblyQuantity: number | null;
  quantitySourceId: number | null;
  assemblyQuantitySourceId: number | null;
};

export type SubtypeBranchInfo = {
  descendantCount: number;
  uniform: boolean;
};

export function flattenSubtypeTree(
  subtypes: ProjectSubtype[],
  depth = 0,
  parentVariantId: number | null = null,
): FlatSubtype[] {
  return subtypes.flatMap((subtype) => {
    const isVariant = subtype.kind === "variant";
    const nextParentVariantId = isVariant ? subtype.id : parentVariantId;
    return [
      ...(isVariant
        ? [{ id: subtype.id, name: subtype.path || subtype.name, depth, parentId: parentVariantId }]
        : []),
      ...flattenSubtypeTree(subtype.children, depth + 1, nextParentVariantId),
    ];
  });
}

export function resolveSubtypeQuantities(
  entries: EditableSubtypeQuantity[],
  subtypeOptions: FlatSubtype[],
): Map<number, ResolvedSubtypeQuantity> {
  const entriesById = new Map(
    entries.flatMap((entry) => (entry.subtype_id === null ? [] : [[entry.subtype_id, entry] as const])),
  );
  const resolved = new Map<number, ResolvedSubtypeQuantity>();

  for (const subtype of subtypeOptions) {
    const parent = subtype.parentId === null ? null : resolved.get(subtype.parentId) || null;
    const entry = entriesById.get(subtype.id);
    const mode = entry?.inheritance_mode || "override";

    const quantity = resolveField(parent?.quantity ?? null, entry?.quantity ?? null, mode);
    const assemblyQuantity = resolveField(
      parent?.assemblyQuantity ?? null,
      entry?.assembly_quantity ?? null,
      mode,
    );

    resolved.set(subtype.id, {
      quantity,
      assemblyQuantity,
      quantitySourceId:
        entry?.quantity !== null && entry?.quantity !== undefined
          ? subtype.id
          : parent?.quantitySourceId ?? null,
      assemblyQuantitySourceId:
        entry?.assembly_quantity !== null && entry?.assembly_quantity !== undefined
          ? subtype.id
          : parent?.assemblyQuantitySourceId ?? null,
    });
  }

  return resolved;
}

export function analyzeSubtypeBranches(
  rows: BomEntry[],
  subtypeOptions: FlatSubtype[],
): Map<number, SubtypeBranchInfo> {
  const rowsById = new Map(
    rows.flatMap((row) => (row.subtype_id === null ? [] : [[row.subtype_id, row] as const])),
  );
  const descendantsById = buildDescendantsById(subtypeOptions);
  const result = new Map<number, SubtypeBranchInfo>();

  for (const subtype of subtypeOptions) {
    const descendantIds = descendantsById.get(subtype.id) || [];
    if (descendantIds.length === 0) {
      continue;
    }
    const parentRow = rowsById.get(subtype.id);
    const uniform = Boolean(
      parentRow &&
        descendantIds.every((descendantId) => {
          const descendantRow = rowsById.get(descendantId);
          return descendantRow ? sameEffectiveQuantities(parentRow, descendantRow) : false;
        }),
    );
    result.set(subtype.id, { descendantCount: descendantIds.length, uniform });
  }

  return result;
}

export function defaultExpandedSubtypeIds(
  rows: BomEntry[],
  subtypeOptions: FlatSubtype[],
): Set<number> {
  return new Set(
    [...analyzeSubtypeBranches(rows, subtypeOptions)]
      .filter(([, branch]) => !branch.uniform)
      .map(([subtypeId]) => subtypeId),
  );
}

export function allExpandableSubtypeIds(subtypeOptions: FlatSubtype[]): Set<number> {
  const parentIds = new Set<number>();
  for (const subtype of subtypeOptions) {
    if (subtype.parentId !== null) {
      parentIds.add(subtype.parentId);
    }
  }
  return parentIds;
}

export function isSubtypeRowVisible(
  subtypeId: number | null,
  subtypeOptions: FlatSubtype[],
  expandedSubtypeIds: ReadonlySet<number>,
): boolean {
  if (subtypeId === null) {
    return true;
  }
  const optionsById = new Map(subtypeOptions.map((subtype) => [subtype.id, subtype]));
  let parentId = optionsById.get(subtypeId)?.parentId ?? null;
  while (parentId !== null) {
    if (!expandedSubtypeIds.has(parentId)) {
      return false;
    }
    parentId = optionsById.get(parentId)?.parentId ?? null;
  }
  return true;
}

function resolveField(
  inheritedValue: number | null,
  explicitValue: number | null,
  mode: "override" | "add",
): number | null {
  if (explicitValue === null) {
    return inheritedValue;
  }
  return mode === "add" ? (inheritedValue ?? 0) + explicitValue : explicitValue;
}

function buildDescendantsById(subtypeOptions: FlatSubtype[]): Map<number, number[]> {
  const childrenById = new Map<number, number[]>();
  for (const subtype of subtypeOptions) {
    if (subtype.parentId === null) {
      continue;
    }
    childrenById.set(subtype.parentId, [...(childrenById.get(subtype.parentId) || []), subtype.id]);
  }

  const descendantsById = new Map<number, number[]>();
  function descendantsOf(subtypeId: number): number[] {
    const cached = descendantsById.get(subtypeId);
    if (cached) {
      return cached;
    }
    const descendants = (childrenById.get(subtypeId) || []).flatMap((childId) => [
      childId,
      ...descendantsOf(childId),
    ]);
    descendantsById.set(subtypeId, descendants);
    return descendants;
  }

  for (const subtype of subtypeOptions) {
    descendantsOf(subtype.id);
  }
  return descendantsById;
}

function sameEffectiveQuantities(left: BomEntry, right: BomEntry): boolean {
  return (
    left.effective_quantity_state === right.effective_quantity_state &&
    sameNumber(left.effective_quantity, right.effective_quantity) &&
    left.effective_assembly_quantity_state === right.effective_assembly_quantity_state &&
    sameNumber(left.effective_assembly_quantity, right.effective_assembly_quantity)
  );
}

function sameNumber(left: number | null, right: number | null): boolean {
  if (left === null || right === null) {
    return left === right;
  }
  return Math.abs(left - right) <= 1e-9;
}
