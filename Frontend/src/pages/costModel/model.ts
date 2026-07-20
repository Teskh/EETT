import type { CostModelAdjustment, CostModelRow, MaterialStudyGroupRow } from "../../lib/types";

export type CostModelReviewFilter = "all" | "review" | "missing_price" | "adjusted";

export type CostModelSummary = {
  totalRows: number;
  pricedRows: number;
  adjustedRows: number;
  missingPriceRows: number;
  missingQuantityRows: number;
  reviewRows: number;
};

export function getMaterialGroupMemberships(groups: MaterialStudyGroupRow[], sku: string | null | undefined) {
  const normalizedSku = sku?.trim().toUpperCase();
  if (!normalizedSku) {
    return [];
  }
  return groups
    .filter((group) => group.members.some((member) => member.sku.trim().toUpperCase() === normalizedSku))
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name, "es") || left.group_id - right.group_id);
}

export function findSubtypeAdjustment(row: CostModelRow, subtypeId: number | null): CostModelAdjustment | null {
  return row.adjustments.find((adjustment) => adjustment.subtype_id === subtypeId) ?? null;
}

export function computeDisplayedQuantity(row: CostModelRow, subtypeId: number | null): number | null {
  const adjustment = findSubtypeAdjustment(row, subtypeId);
  if (adjustment) {
    return adjustment.adjusted_quantity;
  }
  const subtypeEntry = row.subtypes.find((entry) => entry.subtype_id === subtypeId);
  return subtypeEntry?.estimated_quantity ?? null;
}

export function computeRowQuantity(row: CostModelRow): number | null {
  let total = 0;
  let hasAny = false;
  for (const subtype of row.subtypes) {
    const value = computeDisplayedQuantity(row, subtype.subtype_id);
    if (value === null || value === undefined || !Number.isFinite(value)) {
      continue;
    }
    total += value;
    hasAny = true;
  }
  return hasAny ? total : null;
}

export function quantityCost(quantity: number | null, price: number | null): number | null {
  if (quantity === null || price === null || !Number.isFinite(quantity) || !Number.isFinite(price)) {
    return null;
  }
  return quantity * price;
}

export function hasUsablePrice(row: CostModelRow): boolean {
  return row.price !== null && Number.isFinite(row.price) && row.price > 0;
}

export function hasMissingQuantity(row: CostModelRow): boolean {
  return (
    row.subtypes.length === 0 ||
    row.subtypes.some((subtype) => {
      const quantity = computeDisplayedQuantity(row, subtype.subtype_id);
      return quantity === null || !Number.isFinite(quantity);
    })
  );
}

export function rowNeedsReview(row: CostModelRow): boolean {
  return !hasUsablePrice(row) || hasMissingQuantity(row);
}

export function matchesCostModelReviewFilter(row: CostModelRow, filter: CostModelReviewFilter): boolean {
  if (filter === "review") {
    return rowNeedsReview(row);
  }
  if (filter === "missing_price") {
    return !hasUsablePrice(row);
  }
  if (filter === "adjusted") {
    return row.adjustments.length > 0;
  }
  return true;
}

export function summarizeCostModelRows(rows: CostModelRow[]): CostModelSummary {
  let pricedRows = 0;
  let adjustedRows = 0;
  let missingPriceRows = 0;
  let missingQuantityRows = 0;
  let reviewRows = 0;

  for (const row of rows) {
    const usablePrice = hasUsablePrice(row);
    const missingQuantity = hasMissingQuantity(row);
    if (usablePrice) {
      pricedRows += 1;
    } else {
      missingPriceRows += 1;
    }
    if (row.adjustments.length > 0) {
      adjustedRows += 1;
    }
    if (missingQuantity) {
      missingQuantityRows += 1;
    }
    if (!usablePrice || missingQuantity) {
      reviewRows += 1;
    }
  }

  return {
    totalRows: rows.length,
    pricedRows,
    adjustedRows,
    missingPriceRows,
    missingQuantityRows,
    reviewRows,
  };
}
