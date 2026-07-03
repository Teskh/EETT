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
export type SortKey = BaseSortKey | EconomicSortKey;

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

export function toBaseSort(sort: SortState): BaseSortState {
  return isEconomicSortKey(sort.key) ? DEFAULT_SORT_STATE : { key: sort.key, direction: sort.direction };
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
