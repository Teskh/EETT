import type {
  CatalogMaterialSearchResult,
  MaterialDashboardDetailData,
  MaterialDashboardGroupDetailData,
  MaterialDashboardGroupHouseComparisonData,
  MaterialDashboardGroupMovementData,
  MaterialDashboardGroupMovementDetail,
  MaterialDashboardMappedHouseComparisonData,
  MaterialDashboardListRow,
  MaterialDashboardMovementData,
  MaterialDashboardMovementDetail,
  MaterialDashboardStockRiskMetric,
  MaterialStudyGroupRow,
} from "../../lib/types";

// The dashboard analyzes either a single material or a study group; these
// unions cover the places where both shapes are handled with one code path.
export type DashboardSelectionRow = MaterialDashboardListRow | MaterialStudyGroupRow;
export type DashboardDetailLike = MaterialDashboardDetailData | MaterialDashboardGroupDetailData;
export type DashboardHistoryLike = MaterialDashboardMovementData | MaterialDashboardGroupMovementData;
export type DashboardHistoryDetailLike = MaterialDashboardMovementDetail | MaterialDashboardGroupMovementDetail;
export type DashboardHouseComparisonLike = MaterialDashboardMappedHouseComparisonData | MaterialDashboardGroupHouseComparisonData;

export function isGroupRow(value: DashboardSelectionRow | null): value is MaterialStudyGroupRow {
  return Boolean(value && "group_id" in value);
}

export function isGroupDetail(value: DashboardDetailLike | null): value is MaterialDashboardGroupDetailData {
  return Boolean(value && "group_id" in value);
}

export function materialSearchResultToDashboardRow(result: CatalogMaterialSearchResult): MaterialDashboardListRow {
  return {
    sku: result.sku,
    material_name: result.name || result.sku,
    unit: result.unit,
    last_movement_date: null,
    movement_quantity_60d: 0,
    movement_count_60d: 0,
  };
}

export type BaseSortKey = "material_name" | "sku" | "last_movement_date" | "movement_quantity_60d" | "movement_count_60d";
export type EconomicSortKey =
  | "consumption_delta_percent"
  | "consumption_cost_delta_per_house"
  | "historical_weighted_overprice"
  | "estimated_weighted_overprice";
export type StockRiskSortKey = "stockout_risk";
export type SortKey = BaseSortKey | EconomicSortKey | StockRiskSortKey;

export type SortDirection = 1 | -1;

export type SortState = {
  key: SortKey;
  direction: SortDirection;
};

export type BaseSortState = {
  key: BaseSortKey;
  direction: SortDirection;
};

export const DEFAULT_SORT_STATE: BaseSortState = { key: "last_movement_date", direction: -1 };

export function isEconomicSortKey(key: SortKey): key is EconomicSortKey {
  return (
    key === "consumption_delta_percent" ||
    key === "consumption_cost_delta_per_house" ||
    key === "historical_weighted_overprice" ||
    key === "estimated_weighted_overprice"
  );
}

export function isStockRiskSortKey(key: SortKey): key is StockRiskSortKey {
  return key === "stockout_risk";
}

export function hasPositiveEstimatedQuantityPerHouse(
  metric: { predicted_quantity_per_house: number | null | undefined } | null | undefined,
) {
  return typeof metric?.predicted_quantity_per_house === "number" &&
    Number.isFinite(metric.predicted_quantity_per_house) &&
    metric.predicted_quantity_per_house > 0;
}

export function toBaseSort(sort: SortState): BaseSortState {
  return isEconomicSortKey(sort.key) || isStockRiskSortKey(sort.key)
    ? DEFAULT_SORT_STATE
    : { key: sort.key, direction: sort.direction };
}

/**
 * Orders rows by an economic metric value, pushing rows without the metric to
 * the end and breaking ties alphabetically. Shared by the material and group
 * lists, which only differ in how they look up the metric.
 */
export function compareEconomicMetricValues(
  left: { value: number | null | undefined; name: string },
  right: { value: number | null | undefined; name: string },
  direction: SortDirection,
) {
  const leftMissing = left.value === null || left.value === undefined || Number.isNaN(left.value);
  const rightMissing = right.value === null || right.value === undefined || Number.isNaN(right.value);
  if (leftMissing && rightMissing) {
    return left.name.localeCompare(right.name);
  }
  if (leftMissing) {
    return 1;
  }
  if (rightMissing) {
    return -1;
  }
  if (left.value === right.value) {
    return left.name.localeCompare(right.name);
  }
  return ((left.value as number) - (right.value as number)) * direction;
}

/**
 * Orders projected stock-outs by urgency. Descending means highest risk first:
 * projected stock-outs precede safe/no-consumption rows, and earlier projected
 * dates precede later ones. ERP-unavailable rows always remain at the end.
 */
export function compareStockRiskMetricValues(
  left: { metric: MaterialDashboardStockRiskMetric | null | undefined; name: string },
  right: { metric: MaterialDashboardStockRiskMetric | null | undefined; name: string },
  direction: SortDirection,
) {
  const leftUnavailable = !left.metric || left.metric.status === "unavailable";
  const rightUnavailable = !right.metric || right.metric.status === "unavailable";
  if (leftUnavailable && rightUnavailable) {
    return left.name.localeCompare(right.name);
  }
  if (leftUnavailable) {
    return 1;
  }
  if (rightUnavailable) {
    return -1;
  }

  const statusRank = { projected: 2, outside_horizon: 1, no_consumption: 0 } as const;
  const leftRank = statusRank[left.metric!.status as keyof typeof statusRank];
  const rightRank = statusRank[right.metric!.status as keyof typeof statusRank];
  if (leftRank !== rightRank) {
    return (leftRank - rightRank) * direction;
  }

  if (left.metric!.status === "projected" && right.metric!.status === "projected") {
    const leftDays = left.metric!.business_days_until_stockout ?? Number.POSITIVE_INFINITY;
    const rightDays = right.metric!.business_days_until_stockout ?? Number.POSITIVE_INFINITY;
    if (leftDays !== rightDays) {
      return (leftDays - rightDays) * -direction;
    }
  }
  return left.name.localeCompare(right.name);
}

export function compareRows(left: MaterialDashboardListRow, right: MaterialDashboardListRow, sort: BaseSortState) {
  const leftValue = left[sort.key];
  const rightValue = right[sort.key];

  if (typeof leftValue === "string" || typeof rightValue === "string") {
    return String(leftValue || "").localeCompare(String(rightValue || "")) * sort.direction;
  }

  const leftNumber = typeof leftValue === "number" ? leftValue : leftValue ? Date.parse(String(leftValue)) : Number.NEGATIVE_INFINITY;
  const rightNumber = typeof rightValue === "number" ? rightValue : rightValue ? Date.parse(String(rightValue)) : Number.NEGATIVE_INFINITY;
  if (leftNumber === rightNumber) {
    return left.material_name.localeCompare(right.material_name) * sort.direction;
  }
  return (leftNumber - rightNumber) * sort.direction;
}
