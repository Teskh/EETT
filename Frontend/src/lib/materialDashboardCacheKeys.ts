export const CECO_CACHE_KEY = "material-dashboard::cecos";
export const HOUSE_TYPES_CACHE_KEY = "material-dashboard::house-types";

type DateRangeLike = {
  startDate?: string | null;
  endDate?: string | null;
};

type HouseRangeLike = {
  startDate: string;
  endDate: string;
};

export function normalizeCecos(cecos: string[]) {
  return Array.from(new Set(cecos.map((ceco) => ceco.trim()).filter(Boolean))).sort((left, right) => left.localeCompare(right));
}

export function dashboardCacheKey(cecos: string[], range?: DateRangeLike | null, movementDays = 60) {
  const normalized = normalizeCecos(cecos);
  const startDate = range?.startDate || "default";
  const endDate = range?.endDate || "default";
  return `dashboard::${movementDays}::${startDate}::${endDate}::${normalized.join("|") || "all"}`;
}

export function detailCacheKey(sku: string, cecos: string[]) {
  return `detail::${sku}::${normalizeCecos(cecos).join("|") || "all"}`;
}

export function historyCacheKey(sku: string, cecos: string[], range?: DateRangeLike | null) {
  const startDate = range?.startDate || "default";
  const endDate = range?.endDate || "default";
  return `history::${sku}::${startDate}::${endDate}::${normalizeCecos(cecos).join("|") || "all"}`;
}

export function houseComparisonCacheKey(
  sku: string,
  houseTypeId: number,
  cecos: string[],
  range: HouseRangeLike,
  projectId?: number | null,
) {
  return `houses::${sku}::${houseTypeId}::${range.startDate}::${range.endDate}::project:${projectId ?? "none"}::${normalizeCecos(cecos).join("|") || "all"}`;
}

export function economicMetricsCacheKey(houseTypeId: number, cecos: string[], range: HouseRangeLike, projectId?: number | null) {
  return `economics::${houseTypeId}::${range.startDate}::${range.endDate}::project:${projectId ?? "none"}::${normalizeCecos(cecos).join("|") || "all"}`;
}

export function groupDashboardCacheKey(cecos: string[], range?: DateRangeLike | null, movementDays = 60) {
  const normalized = normalizeCecos(cecos);
  const startDate = range?.startDate || "default";
  const endDate = range?.endDate || "default";
  return `groups::${movementDays}::${startDate}::${endDate}::${normalized.join("|") || "all"}`;
}

export function groupDetailCacheKey(groupId: number, cecos: string[]) {
  return `group-detail::${groupId}::${normalizeCecos(cecos).join("|") || "all"}`;
}

export function groupHistoryCacheKey(groupId: number, cecos: string[], range?: DateRangeLike | null) {
  const startDate = range?.startDate || "default";
  const endDate = range?.endDate || "default";
  return `group-history::${groupId}::${startDate}::${endDate}::${normalizeCecos(cecos).join("|") || "all"}`;
}

export function groupHouseComparisonCacheKey(
  groupId: number,
  houseTypeId: number,
  cecos: string[],
  range: HouseRangeLike,
  projectId?: number | null,
) {
  return `group-houses::${groupId}::${houseTypeId}::${range.startDate}::${range.endDate}::project:${projectId ?? "none"}::${normalizeCecos(cecos).join("|") || "all"}`;
}
