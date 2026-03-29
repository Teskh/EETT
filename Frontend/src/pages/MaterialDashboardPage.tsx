import { memo, startTransition, useDeferredValue, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import { MaterialStudyGroupEditor } from "../components/MaterialStudyGroupEditor";
import { MovementStationDistributionModal } from "../components/MovementStationDistributionModal";
import { ApiError, api } from "../lib/api";
import { getMaterialDashboardCacheValue, setMaterialDashboardCacheValue } from "../lib/materialDashboardCache";
import type {
  MaterialDashboardCeco,
  MaterialDashboardData,
  MaterialDashboardDetailData,
  MaterialDashboardGroupDetailData,
  MaterialDashboardGroupHouseComparisonData,
  MaterialDashboardGroupMovementData,
  MaterialDashboardGroupMovementDetail,
  MaterialDashboardHouseComparisonData,
  MaterialDashboardHouseComparisonPoint,
  MaterialDashboardHouseType,
  MaterialDashboardListRow,
  MaterialDashboardMovementDetail,
  MaterialDashboardMovementData,
  MaterialDashboardMovementPoint,
  MaterialStudyGroupListResponse,
  MaterialStudyGroupRow,
  ProjectSummary,
  ProjectsBoardData,
} from "../lib/types";

type SortKey = "material_name" | "sku" | "last_movement_date" | "movement_quantity_60d" | "movement_count_60d";

type SortState = {
  key: SortKey;
  direction: 1 | -1;
};

const numberFormatter = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 1 });
const integerFormatter = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 0 });
const currencyFormatter = new Intl.NumberFormat("es-CL", {
  style: "currency",
  currency: "CLP",
  maximumFractionDigits: 0,
});
const percentFormatter = new Intl.NumberFormat("es-CL", {
  maximumFractionDigits: 1,
});
const DEFAULT_HOUSE_RANGE_DAYS = 90;
const LIST_PAGE_SIZE = 50;
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const HOUSE_VIEW_PREFERENCES_KEY = "material-dashboard::house-view-preferences";
const CECO_FILTER_PREFERENCES_KEY = "material-dashboard::ceco-filter-preferences";

function parseDateValue(value: string | Date) {
  if (value instanceof Date) {
    return new Date(value);
  }
  if (DATE_ONLY_PATTERN.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    return new Date(year, month - 1, day);
  }
  return new Date(value);
}

function formatNumber(value: number | null | undefined, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "—";
  }
  return digits === 0 ? integerFormatter.format(value) : numberFormatter.format(value);
}

function formatCurrency(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "—";
  }
  return currencyFormatter.format(value);
}

function formatSignedNumber(value: number | null | undefined, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "—";
  }
  const absolute = digits === 0 ? integerFormatter.format(Math.abs(value)) : numberFormatter.format(Math.abs(value));
  if (value === 0) {
    return absolute;
  }
  return `${value > 0 ? "+" : "-"}${absolute}`;
}

function formatPercent(value: number | null | undefined, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "—";
  }
  const absolute = percentFormatter.format(Math.abs(value));
  if (value === 0) {
    return `${absolute}%`;
  }
  return `${value > 0 ? "+" : "-"}${absolute}%`;
}

function formatDate(value: string | null | undefined) {
  if (!value) {
    return "—";
  }
  const date = parseDateValue(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleDateString("es-CL", { year: "numeric", month: "short", day: "numeric" });
}

function isDateWithinRange(value: string, startDate: string | null | undefined, endDate: string | null | undefined) {
  const time = toStartOfDay(value).getTime();
  if (startDate && time < toStartOfDay(startDate).getTime()) {
    return false;
  }
  if (endDate && time > toStartOfDay(endDate).getTime()) {
    return false;
  }
  return true;
}

const CECO_CACHE_KEY = "material-dashboard::cecos";

function normalizeCecos(cecos: string[]) {
  return Array.from(new Set(cecos.map((ceco) => ceco.trim()).filter(Boolean))).sort((left, right) => left.localeCompare(right));
}

function dashboardCacheKey(cecos: string[], movementDays = 60) {
  const normalized = normalizeCecos(cecos);
  return `dashboard::${movementDays}::${normalized.join("|") || "all"}`;
}

function detailCacheKey(sku: string, cecos: string[]) {
  return `detail::${sku}::${normalizeCecos(cecos).join("|") || "all"}`;
}

function historyCacheKey(sku: string, cecos: string[], range?: { startDate?: string | null; endDate?: string | null } | null) {
  const startDate = range?.startDate || "default";
  const endDate = range?.endDate || "default";
  return `history::${sku}::${startDate}::${endDate}::${normalizeCecos(cecos).join("|") || "all"}`;
}

function houseComparisonCacheKey(sku: string, houseTypeId: number, cecos: string[], range: HouseRange, projectId?: number | null) {
  return `houses::${sku}::${houseTypeId}::${range.startDate}::${range.endDate}::project:${projectId ?? "none"}::${normalizeCecos(cecos).join("|") || "all"}`;
}

function groupDashboardCacheKey(cecos: string[], movementDays = 60) {
  const normalized = normalizeCecos(cecos);
  return `groups::${movementDays}::${normalized.join("|") || "all"}`;
}

function groupDetailCacheKey(groupId: number, cecos: string[]) {
  return `group-detail::${groupId}::${normalizeCecos(cecos).join("|") || "all"}`;
}

function groupHistoryCacheKey(groupId: number, cecos: string[], range?: { startDate?: string | null; endDate?: string | null } | null) {
  const startDate = range?.startDate || "default";
  const endDate = range?.endDate || "default";
  return `group-history::${groupId}::${startDate}::${endDate}::${normalizeCecos(cecos).join("|") || "all"}`;
}

function groupHouseComparisonCacheKey(groupId: number, houseTypeId: number, cecos: string[], range: HouseRange, projectId?: number | null) {
  return `group-houses::${groupId}::${houseTypeId}::${range.startDate}::${range.endDate}::project:${projectId ?? "none"}::${normalizeCecos(cecos).join("|") || "all"}`;
}

type DashboardSelectionRow = MaterialDashboardListRow | MaterialStudyGroupRow;
type DashboardDetailLike = MaterialDashboardDetailData | MaterialDashboardGroupDetailData;
type DashboardHistoryLike = MaterialDashboardMovementData | MaterialDashboardGroupMovementData;
type DashboardHistoryDetailLike = MaterialDashboardMovementDetail | MaterialDashboardGroupMovementDetail;
type DashboardHouseComparisonLike = MaterialDashboardHouseComparisonData | MaterialDashboardGroupHouseComparisonData;

function isGroupRow(value: DashboardSelectionRow | null): value is MaterialStudyGroupRow {
  return Boolean(value && "group_id" in value);
}

function isGroupDetail(value: DashboardDetailLike | null): value is MaterialDashboardGroupDetailData {
  return Boolean(value && "group_id" in value);
}

function isGroupHistory(value: DashboardHistoryLike | null): value is MaterialDashboardGroupMovementData {
  return Boolean(value && "group_id" in value);
}

function compareRows(left: MaterialDashboardListRow, right: MaterialDashboardListRow, sort: SortState) {
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

const CHART_PADDING = { top: 18, right: 18, bottom: 26, left: 40 };
const CHART_WIDTH = 760;
const CHART_HEIGHT = 240;

type StockSeriesPoint = {
  date: string;
  value: number;
  time: number;
};

type ChartPoint = StockSeriesPoint & {
  index: number;
  x: number;
  y: number;
};

type ChartSelection = {
  startIndex: number;
  endIndex: number;
};

type CecoFilterMode = "exclude" | "include";
type HouseRange = {
  startDate: string;
  endDate: string;
};

type LeadTimeMode = "worst" | "median" | "average";

type LeadTimeReference = {
  days: number;
  source: LeadTimeMode;
};

type PurchaseOrderEstimate = {
  bufferWeeks: number;
  bufferBusinessDays: number;
  minimumExpectedStock: number;
  rateUsed: number;
  rateSource: "selection" | "recent_30d";
  leadTimeDays: number;
  thresholdDate: string;
  purchaseOrderDate: string;
};

type EstimatedConsumptionPurchaseOrderEstimate = {
  bufferWeeks: number;
  minimumExpectedStock: number;
  estimatedConsumptionPerWeek: number;
  estimatedConsumptionPerBusinessDay: number;
  rateSource: "selection" | "range";
  leadTimeDays: number;
  thresholdDate: string;
  purchaseOrderDate: string;
};

type StockTrendSummary = {
  start: { date: string };
  end: { date: string };
  elapsedDays: number;
  stockDelta: number | null;
  consumed: number | null;
  averageConsumptionPerDay: number | null;
  averageConsumptionPerWeek: number | null;
};

function toStartOfDay(value: string | Date) {
  const date = parseDateValue(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function toDateInputValue(value: string | Date) {
  const date = toStartOfDay(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isWeekend(date: Date) {
  const day = date.getDay();
  return day === 0 || day === 6;
}

function moveToPreviousBusinessDay(value: Date) {
  const date = toStartOfDay(value);
  while (isWeekend(date)) {
    date.setDate(date.getDate() - 1);
  }
  return date;
}

function moveToNextBusinessDay(value: Date) {
  const date = toStartOfDay(value);
  while (isWeekend(date)) {
    date.setDate(date.getDate() + 1);
  }
  return date;
}

function getDefaultHouseRange(referenceDate = new Date()): HouseRange {
  const endDate = moveToPreviousBusinessDay(referenceDate);
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - (DEFAULT_HOUSE_RANGE_DAYS - 1));
  return {
    startDate: toDateInputValue(moveToNextBusinessDay(startDate)),
    endDate: toDateInputValue(endDate),
  };
}

function getStoredHouseViewPreferences() {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(HOUSE_VIEW_PREFERENCES_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as {
      selectedHouseTypeId?: number | null;
      selectedProjectId?: number | null;
      leadTimeMode?: string;
      houseRange?: Partial<HouseRange> | null;
    };
    return {
      hasSelectedHouseTypePreference: Object.prototype.hasOwnProperty.call(parsed, "selectedHouseTypeId"),
      selectedHouseTypeId:
        typeof parsed.selectedHouseTypeId === "number" && Number.isFinite(parsed.selectedHouseTypeId)
          ? parsed.selectedHouseTypeId
          : null,
      selectedProjectId:
        typeof parsed.selectedProjectId === "number" && Number.isFinite(parsed.selectedProjectId)
          ? parsed.selectedProjectId
          : null,
      leadTimeMode:
        parsed.leadTimeMode === "average" || parsed.leadTimeMode === "median" || parsed.leadTimeMode === "worst"
          ? parsed.leadTimeMode
          : "worst",
      houseRange:
        parsed.houseRange?.startDate && parsed.houseRange?.endDate
          ? {
              startDate: parsed.houseRange.startDate,
              endDate: parsed.houseRange.endDate,
            }
          : null,
    };
  } catch {
    return null;
  }
}

function getStoredCecoFilterPreferences() {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(CECO_FILTER_PREFERENCES_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as { mode?: string; cecos?: unknown };
    return {
      mode: parsed.mode === "include" ? "include" : "exclude",
      cecos: Array.isArray(parsed.cecos) ? normalizeCecos(parsed.cecos.map((value) => String(value ?? ""))) : [],
    } satisfies { mode: CecoFilterMode; cecos: string[] };
  } catch {
    return null;
  }
}

function clampHouseRange(range: HouseRange, referenceDate = new Date()): HouseRange {
  const latestDate = moveToPreviousBusinessDay(referenceDate);
  let startDate = moveToNextBusinessDay(toStartOfDay(range.startDate));
  let endDate = moveToPreviousBusinessDay(toStartOfDay(range.endDate));

  if (startDate.getTime() > latestDate.getTime()) {
    startDate = latestDate;
  }
  if (endDate.getTime() > latestDate.getTime()) {
    endDate = latestDate;
  }
  if (startDate.getTime() > endDate.getTime()) {
    startDate = new Date(endDate);
  }

  return {
    startDate: toDateInputValue(startDate),
    endDate: toDateInputValue(endDate),
  };
}

function addBusinessDays(value: Date, offset: number) {
  const roundedOffset = offset >= 0 ? Math.ceil(offset) : -Math.ceil(Math.abs(offset));
  const date = roundedOffset >= 0 ? moveToNextBusinessDay(value) : moveToPreviousBusinessDay(value);
  let remaining = Math.max(Math.abs(roundedOffset), 0);
  while (remaining > 0) {
    date.setDate(date.getDate() + (roundedOffset >= 0 ? 1 : -1));
    if (!isWeekend(date)) {
      remaining -= 1;
    }
  }
  return date;
}

function getPurchaseOrderUrgencyClasses(value: string | null | undefined) {
  if (!value) {
    return "";
  }
  const targetDate = toStartOfDay(value);
  if (Number.isNaN(targetDate.getTime())) {
    return "";
  }
  const today = toStartOfDay(new Date());
  const daysUntilTarget = Math.round((targetDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (daysUntilTarget <= 7) {
    return "text-red-600 dark:text-red-400";
  }
  if (daysUntilTarget <= 14) {
    return "text-amber-600 dark:text-amber-400";
  }
  return "text-zinc-900 dark:text-white";
}

function getLeadTimeReference(detail: DashboardDetailLike | null, mode: LeadTimeMode): LeadTimeReference | null {
  if (!detail) {
    return null;
  }
  if (mode === "worst" && detail.max_lead_time_days !== null && detail.max_lead_time_days !== undefined && Number.isFinite(detail.max_lead_time_days)) {
    return { days: detail.max_lead_time_days, source: "worst" };
  }
  if (mode === "median" && detail.median_lead_time_days !== null && detail.median_lead_time_days !== undefined && Number.isFinite(detail.median_lead_time_days)) {
    return { days: detail.median_lead_time_days, source: "median" };
  }
  if (mode === "average" && detail.average_lead_time_days !== null && detail.average_lead_time_days !== undefined && Number.isFinite(detail.average_lead_time_days)) {
    return { days: detail.average_lead_time_days, source: "average" };
  }
  return null;
}

function getLeadTimeDigits(mode: LeadTimeMode) {
  return mode === "worst" ? 0 : 1;
}

function getLeadTimeModeLabel(mode: LeadTimeMode) {
  if (mode === "worst") {
    return "Worst";
  }
  if (mode === "median") {
    return "Median";
  }
  return "Average";
}

function getReorderDateForLeadTime(detail: DashboardDetailLike | null, leadTimeReference: LeadTimeReference | null) {
  if (!detail || detail.days_of_stock_30d === null || detail.days_of_stock_30d === undefined || !leadTimeReference) {
    return null;
  }
  const reorderInDays = Math.max(intOrZero(Math.round(detail.days_of_stock_30d - leadTimeReference.days)), 0);
  return addBusinessDays(moveToNextBusinessDay(new Date()), reorderInDays).toISOString();
}

function intOrZero(value: number) {
  return Number.isFinite(value) ? value : 0;
}

function getPurchaseOrderEstimate({
  detail,
  summary,
  leadTimeReference,
  isCustomSelection,
  bufferWeeks,
}: {
  detail: DashboardDetailLike | null;
  summary: ReturnType<typeof getSeriesSummary>;
  leadTimeReference: LeadTimeReference | null;
  isCustomSelection: boolean;
  bufferWeeks: number;
}): PurchaseOrderEstimate | null {
  if (!detail || detail.stock_on_hand === null || detail.stock_on_hand === undefined || Number.isNaN(detail.stock_on_hand)) {
    return null;
  }

  if (!leadTimeReference) {
    return null;
  }

  const selectionRate = summary?.averageConsumptionPerDay;
  const recentRate = detail.average_daily_outgoing_30d;
  const rateUsed = isCustomSelection ? selectionRate : recentRate;
  if (rateUsed === null || rateUsed === undefined || !Number.isFinite(rateUsed) || rateUsed <= 0) {
    return null;
  }

  const normalizedBufferWeeks = Math.max(bufferWeeks, 0);
  const bufferBusinessDays = normalizedBufferWeeks * 5;
  const minimumStock = rateUsed * bufferBusinessDays;
  const today = moveToNextBusinessDay(new Date());
  const businessDaysUntilThreshold =
    detail.stock_on_hand <= minimumStock ? 0 : Math.ceil((detail.stock_on_hand - minimumStock) / rateUsed);
  const leadTimeDays = Math.max(Math.ceil(leadTimeReference.days), 0);
  const thresholdDate = addBusinessDays(today, businessDaysUntilThreshold);
  const purchaseOrderDate = addBusinessDays(thresholdDate, -leadTimeDays);

  return {
    bufferWeeks: normalizedBufferWeeks,
    bufferBusinessDays,
    minimumExpectedStock: minimumStock,
    rateUsed,
    rateSource: isCustomSelection ? "selection" : "recent_30d",
    leadTimeDays,
    thresholdDate: thresholdDate.toISOString(),
    purchaseOrderDate: purchaseOrderDate.toISOString(),
  };
}

function getEstimatedConsumptionPurchaseOrderEstimate({
  detail,
  leadTimeReference,
  estimatedConsumptionPerWeek,
  isCustomSelection,
  bufferWeeks,
}: {
  detail: DashboardDetailLike | null;
  leadTimeReference: LeadTimeReference | null;
  estimatedConsumptionPerWeek: number | null | undefined;
  isCustomSelection: boolean;
  bufferWeeks: number;
}): EstimatedConsumptionPurchaseOrderEstimate | null {
  if (!detail || detail.stock_on_hand === null || detail.stock_on_hand === undefined || Number.isNaN(detail.stock_on_hand)) {
    return null;
  }

  if (!leadTimeReference) {
    return null;
  }

  if (
    estimatedConsumptionPerWeek === null ||
    estimatedConsumptionPerWeek === undefined ||
    !Number.isFinite(estimatedConsumptionPerWeek) ||
    estimatedConsumptionPerWeek <= 0
  ) {
    return null;
  }

  const normalizedBufferWeeks = Math.max(bufferWeeks, 0);
  const minimumStock = estimatedConsumptionPerWeek * normalizedBufferWeeks;
  const estimatedConsumptionPerBusinessDay = estimatedConsumptionPerWeek / 5;
  const today = moveToNextBusinessDay(new Date());
  const businessDaysUntilThreshold =
    detail.stock_on_hand <= minimumStock ? 0 : Math.ceil((detail.stock_on_hand - minimumStock) / estimatedConsumptionPerBusinessDay);
  const leadTimeDays = Math.max(Math.ceil(leadTimeReference.days), 0);
  const thresholdDate = addBusinessDays(today, businessDaysUntilThreshold);
  const purchaseOrderDate = addBusinessDays(thresholdDate, -leadTimeDays);

  return {
    bufferWeeks: normalizedBufferWeeks,
    minimumExpectedStock: minimumStock,
    estimatedConsumptionPerWeek,
    estimatedConsumptionPerBusinessDay,
    rateSource: isCustomSelection ? "selection" : "range",
    leadTimeDays,
    thresholdDate: thresholdDate.toISOString(),
    purchaseOrderDate: purchaseOrderDate.toISOString(),
  };
}

function buildLinePath(
  points: StockSeriesPoint[],
  width: number,
  height: number,
) {
  if (!points.length) {
    return null;
  }
  const padding = CHART_PADDING;
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const maxValue = Math.max(...points.map((point) => point.value), 1);

  const chartPoints = points
    .map((point, index) => {
      const x =
        points.length === 1
          ? padding.left + plotWidth / 2
          : padding.left + (index / (points.length - 1)) * plotWidth;
      const y = padding.top + plotHeight - (point.value / maxValue) * plotHeight;
      return { ...point, index, x, y };
    });

  const path = chartPoints
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(" ");

  return { path, points: chartPoints, maxValue, padding, plotHeight, plotWidth, width, height };
}

function getSelectionBounds(selection: ChartSelection) {
  return {
    startIndex: Math.min(selection.startIndex, selection.endIndex),
    endIndex: Math.max(selection.startIndex, selection.endIndex),
  };
}

function getClampedSelectionBounds(selection: ChartSelection, pointCount: number) {
  if (pointCount <= 0) {
    return null;
  }
  const bounds = getSelectionBounds(selection);
  return {
    startIndex: clamp(bounds.startIndex, 0, pointCount - 1),
    endIndex: clamp(bounds.endIndex, 0, pointCount - 1),
  };
}

function getSeriesSummary(points: ChartPoint[], selection?: ChartSelection | null): StockTrendSummary | null {
  if (!points.length) {
    return null;
  }
  const bounds = selection ? getClampedSelectionBounds(selection, points.length) : { startIndex: 0, endIndex: points.length - 1 };
  if (!bounds) {
    return null;
  }
  const start = points[bounds.startIndex];
  const end = points[bounds.endIndex];
  const elapsedDays = Math.max(bounds.endIndex - bounds.startIndex, 1);
  const stockDelta = end.value - start.value;
  const consumed = start.value - end.value;
  return {
    start,
    end,
    elapsedDays,
    stockDelta,
    consumed,
    averageConsumptionPerDay: consumed / elapsedDays,
    averageConsumptionPerWeek: (consumed / elapsedDays) * 5,
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function getClosestPointIndex(points: Array<{ x: number; index: number }>, x: number) {
  let closestIndex = 0;
  let closestDistance = Number.POSITIVE_INFINITY;

  for (const point of points) {
    const distance = Math.abs(point.x - x);
    if (distance < closestDistance) {
      closestDistance = distance;
      closestIndex = point.index;
    }
  }

  return closestIndex;
}

function buildHistoricalStockSeries(
  movements: MaterialDashboardMovementPoint[],
  currentStock: number | null | undefined,
  options: {
    startDate?: string | null;
    endDate?: string | null;
    includeWeekends?: boolean;
  } = {},
): StockSeriesPoint[] {
  if (currentStock === null || currentStock === undefined || Number.isNaN(currentStock)) {
    return [];
  }
  const includeWeekends = options.includeWeekends ?? false;
  const today = toStartOfDay(new Date());
  const anchorDate = includeWeekends ? today : moveToPreviousBusinessDay(today);
  const dailyMovementMap = new Map<number, number>();
  for (const point of movements) {
    const date = toStartOfDay(point.date);
    const time = date.getTime();
    dailyMovementMap.set(time, (dailyMovementMap.get(time) || 0) + (Number(point.quantity) || 0));
  }

  let runningStock = Number(currentStock);
  if (anchorDate.getTime() !== today.getTime()) {
    const futureCursor = new Date(today);
    while (futureCursor.getTime() > anchorDate.getTime()) {
      runningStock += dailyMovementMap.get(futureCursor.getTime()) || 0;
      futureCursor.setDate(futureCursor.getDate() - 1);
    }
  }

  const earliestMovementTime = dailyMovementMap.size ? Math.min(...dailyMovementMap.keys()) : anchorDate.getTime();
  const requestedEndTime = options.endDate ? toStartOfDay(options.endDate).getTime() : anchorDate.getTime();
  const endTime = Math.min(requestedEndTime, anchorDate.getTime());
  const requestedStartTime = options.startDate ? toStartOfDay(options.startDate).getTime() : earliestMovementTime;
  const startTime = Math.min(requestedStartTime, endTime);
  const history: StockSeriesPoint[] = [];

  const cursor = new Date(anchorDate);
  while (cursor.getTime() > endTime) {
    runningStock += dailyMovementMap.get(cursor.getTime()) || 0;
    cursor.setDate(cursor.getDate() - 1);
  }

  if (includeWeekends || !isWeekend(cursor)) {
    history.unshift({
      date: cursor.toISOString(),
      time: cursor.getTime(),
      value: runningStock,
    });
  }

  while (cursor.getTime() > startTime) {
    cursor.setDate(cursor.getDate() - 1);
    runningStock += dailyMovementMap.get(cursor.getTime()) || 0;
    if (!includeWeekends && isWeekend(cursor)) {
      continue;
    }
    history.unshift({
      date: cursor.toISOString(),
      time: cursor.getTime(),
      value: runningStock,
    });
  }

  return history;
}

type HouseTrendChartPoint = MaterialDashboardHouseComparisonPoint & {
  index: number;
  x: number;
  stockValue: number | null;
  stockY: number | null;
  projectedStockValue: number | null;
  projectedStockY: number | null;
  projectedMaterialQuantity: number;
  cumulativeProjectedMaterialQuantity: number;
  remainingHouseStarts: number;
  houseY: number;
};

type ProjectedStockByDayPoint = {
  projectedStockValue: number;
  projectedMaterialQuantity: number;
  cumulativeProjectedMaterialQuantity: number;
};

function buildLineSegments(points: Array<{ x: number; y: number | null }>) {
  const segments: string[] = [];
  let drawing = false;

  for (const point of points) {
    if (point.y === null) {
      drawing = false;
      continue;
    }
    segments.push(`${drawing ? "L" : "M"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`);
    drawing = true;
  }

  return segments.join(" ");
}

function getStockValueForDate(stockSeries: StockSeriesPoint[], date: string) {
  if (!stockSeries.length) {
    return null;
  }
  const stockIndexByDay = new Map<number, number>();
  stockSeries.forEach((point, index) => {
    stockIndexByDay.set(toStartOfDay(point.date).getTime(), index);
  });
  const stockIndex = stockIndexByDay.get(toStartOfDay(date).getTime());
  if (stockIndex === undefined) {
    return null;
  }
  return stockSeries[stockIndex]?.value ?? null;
}

function buildProjectedStockByDay(
  houseComparison: MaterialDashboardHouseComparisonData | null,
  stockSeries: StockSeriesPoint[],
) {
  const projectComparison = houseComparison?.project_comparison;
  if (!houseComparison || !projectComparison || !houseComparison.points.length || !stockSeries.length) {
    return null;
  }
  const firstPoint = houseComparison.points[0];
  const firstStockValue = getStockValueForDate(stockSeries, firstPoint.date);
  if (firstStockValue === null) {
    return null;
  }

  const projectedStockByDay = new Map<number, ProjectedStockByDayPoint>();
  let runningProjectedStock = firstStockValue + (Number(firstPoint.material_quantity) || 0);
  let cumulativeProjectedMaterialQuantity = 0;

  houseComparison.points.forEach((point) => {
    const projectedMaterialQuantity = (Number(point.house_starts) || 0) * projectComparison.predicted_quantity_per_house;
    cumulativeProjectedMaterialQuantity += projectedMaterialQuantity;
    runningProjectedStock -= projectedMaterialQuantity;
    projectedStockByDay.set(toStartOfDay(point.date).getTime(), {
      projectedStockValue: Math.round(runningProjectedStock * 10000) / 10000,
      projectedMaterialQuantity: Math.round(projectedMaterialQuantity * 10000) / 10000,
      cumulativeProjectedMaterialQuantity: Math.round(cumulativeProjectedMaterialQuantity * 10000) / 10000,
    });
  });

  return projectedStockByDay;
}

function buildHouseComparisonChart(
  houseComparison: MaterialDashboardHouseComparisonData,
  stockSeries: StockSeriesPoint[],
  width: number,
  height: number,
  stockAxisBaseline: number | null = null,
  stockAxisCeiling: number | null = null,
  projectedStockByDay: Map<number, ProjectedStockByDayPoint> | null = null,
) {
  if (!houseComparison.points.length) {
    return null;
  }
  const padding = { top: 18, right: 52, bottom: 26, left: 40 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const stockIndexByDay = new Map<number, number>();
  stockSeries.forEach((point, index) => {
    stockIndexByDay.set(toStartOfDay(point.date).getTime(), index);
  });
  const stockValues = stockSeries.map((point) => point.value);
  const finalStock = stockAxisBaseline ?? (stockValues.length ? stockValues[stockValues.length - 1] : 0);
  const totalHouseStarts = Math.max(houseComparison.total_house_starts, 0);

  const chartPoints: HouseTrendChartPoint[] = houseComparison.points.map((point, index) => {
    const pointTime = toStartOfDay(point.date).getTime();
    const x =
      houseComparison.points.length === 1
        ? padding.left + plotWidth / 2
        : padding.left + (index / (houseComparison.points.length - 1)) * plotWidth;
    const stockIndex = stockIndexByDay.get(pointTime);
    const stockValue = stockIndex !== undefined ? stockSeries[stockIndex]?.value ?? null : null;
    const projectedPoint = projectedStockByDay?.get(pointTime) ?? null;
    const remainingHouseStarts = Math.max(totalHouseStarts - (point.cumulative_house_starts - point.house_starts), 0);
    return {
      ...point,
      index,
      x,
      stockValue,
      stockY: null,
      projectedStockValue: projectedPoint?.projectedStockValue ?? null,
      projectedStockY: null,
      projectedMaterialQuantity: projectedPoint?.projectedMaterialQuantity ?? 0,
      cumulativeProjectedMaterialQuantity: projectedPoint?.cumulativeProjectedMaterialQuantity ?? 0,
      remainingHouseStarts,
      houseY: 0,
    };
  });
  const combinedStockValues = chartPoints.flatMap((point) =>
    [point.stockValue, point.projectedStockValue].filter((value): value is number => value !== null),
  );
  const maxStock = Math.max(...combinedStockValues, stockAxisCeiling ?? Number.NEGATIVE_INFINITY, 1);
  const minStock = Math.max(finalStock, 0);
  const stockRange = Math.max(maxStock - minStock, 1);
  const maxRemainingHouseStarts = Math.max(...chartPoints.map((point) => point.remainingHouseStarts), 1);
  const positionedPoints = chartPoints.map((point) => ({
    ...point,
    stockY:
      point.stockValue !== null
        ? padding.top + plotHeight - ((point.stockValue - minStock) / stockRange) * plotHeight
        : null,
    projectedStockY:
      point.projectedStockValue !== null
        ? padding.top + plotHeight - ((point.projectedStockValue - minStock) / stockRange) * plotHeight
        : null,
    houseY: padding.top + plotHeight - (point.remainingHouseStarts / maxRemainingHouseStarts) * plotHeight,
  }));

  const stockPath = buildLineSegments(positionedPoints.map((point) => ({ x: point.x, y: point.stockY })));
  const projectedStockPath = buildLineSegments(positionedPoints.map((point) => ({ x: point.x, y: point.projectedStockY })));
  const housePath = buildLineSegments(positionedPoints.map((point) => ({ x: point.x, y: point.houseY })));

  return {
    width,
    height,
    padding,
    plotWidth,
    plotHeight,
    maxStock,
    minStock,
    maxRemainingHouseStarts,
    points: positionedPoints,
    stockPath,
    projectedStockPath,
    housePath,
  };
}

function getHouseComparisonForRange(
  houseComparison: MaterialDashboardHouseComparisonData | null,
  range: HouseRange,
): MaterialDashboardHouseComparisonData | null {
  if (!houseComparison) {
    return null;
  }
  const startTime = toStartOfDay(range.startDate).getTime();
  const endTime = toStartOfDay(range.endDate).getTime();
  let cumulativeMaterialQuantity = 0;
  let cumulativeHouseStarts = 0;
  let latestHouseStartDate: string | null = null;
  const points = houseComparison.points
    .filter((point) => {
      const pointTime = toStartOfDay(point.date).getTime();
      return pointTime >= startTime && pointTime <= endTime;
    })
    .map((point) => {
      const materialQuantity = Number(point.material_quantity) || 0;
      const houseStarts = Number(point.house_starts) || 0;
      cumulativeMaterialQuantity += materialQuantity;
      cumulativeHouseStarts += houseStarts;
      if (houseStarts > 0) {
        latestHouseStartDate = point.date;
      }
      return {
        ...point,
        material_quantity: materialQuantity,
        house_starts: houseStarts,
        cumulative_material_quantity: Math.round(cumulativeMaterialQuantity * 10000) / 10000,
        cumulative_house_starts: cumulativeHouseStarts,
        material_per_house:
          cumulativeHouseStarts > 0 ? Math.round((cumulativeMaterialQuantity / cumulativeHouseStarts) * 10000) / 10000 : null,
      };
    });
  const movementDays = Math.max(Math.round((endTime - startTime) / (1000 * 60 * 60 * 24)) + 1, 1);

  return {
    ...houseComparison,
    movement_days: movementDays,
    range_start: range.startDate,
    range_end: range.endDate,
    total_material_quantity: Math.round(cumulativeMaterialQuantity * 10000) / 10000,
    total_house_starts: cumulativeHouseStarts,
    material_per_house:
      cumulativeHouseStarts > 0 ? Math.round((cumulativeMaterialQuantity / cumulativeHouseStarts) * 10000) / 10000 : null,
    latest_house_start_date: latestHouseStartDate,
    project_comparison: houseComparison.project_comparison
      ? {
          ...houseComparison.project_comparison,
          projected_total_material_quantity:
            Math.round(houseComparison.project_comparison.predicted_quantity_per_house * cumulativeHouseStarts * 10000) / 10000,
        }
      : null,
    points,
  };
}

function getHouseSeriesSummary(points: HouseTrendChartPoint[], selection?: ChartSelection | null) {
  if (!points.length) {
    return null;
  }
  const bounds = selection ? getClampedSelectionBounds(selection, points.length) : { startIndex: 0, endIndex: points.length - 1 };
  if (!bounds) {
    return null;
  }
  const start = points[bounds.startIndex];
  const end = points[bounds.endIndex];
  const elapsedDays = Math.max(bounds.endIndex - bounds.startIndex, 1);
  const materialConsumed = end.cumulative_material_quantity - (start.cumulative_material_quantity - start.material_quantity);
  const housesProduced = end.cumulative_house_starts - (start.cumulative_house_starts - start.house_starts);
  const projectedMaterialConsumed =
    end.cumulativeProjectedMaterialQuantity - (start.cumulativeProjectedMaterialQuantity - start.projectedMaterialQuantity);
  const stockDelta =
    start.stockValue !== null && end.stockValue !== null ? end.stockValue - start.stockValue : null;

  return {
    start,
    end,
    elapsedDays,
    stockDelta,
    materialConsumed,
    projectedMaterialConsumed,
    housesProduced,
    averageConsumptionPerHouse: housesProduced > 0 ? materialConsumed / housesProduced : null,
    averageProjectedConsumptionPerBusinessDay: projectedMaterialConsumed / elapsedDays,
    averageProjectedConsumptionPerWeek: (projectedMaterialConsumed / elapsedDays) * 5,
  };
}

function getHouseStockSeriesSummary(points: HouseTrendChartPoint[], selection?: ChartSelection | null): StockTrendSummary | null {
  if (!points.length) {
    return null;
  }
  const bounds = selection ? getClampedSelectionBounds(selection, points.length) : { startIndex: 0, endIndex: points.length - 1 };
  if (!bounds) {
    return null;
  }
  const start = points[bounds.startIndex];
  const end = points[bounds.endIndex];
  if (start.stockValue === null || end.stockValue === null) {
    return {
      start,
      end,
      elapsedDays: Math.max(bounds.endIndex - bounds.startIndex, 1),
      stockDelta: null,
      consumed: null,
      averageConsumptionPerDay: null,
      averageConsumptionPerWeek: null,
    };
  }
  const elapsedDays = Math.max(bounds.endIndex - bounds.startIndex, 1);
  const stockDelta = end.stockValue - start.stockValue;
  const consumed = start.stockValue - end.stockValue;
  return {
    start,
    end,
    elapsedDays,
    stockDelta,
    consumed,
    averageConsumptionPerDay: consumed / elapsedDays,
    averageConsumptionPerWeek: (consumed / elapsedDays) * 5,
  };
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-black/10 bg-zinc-50 px-4 py-3 shadow-sm transition-colors hover:bg-zinc-100/50 dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/[0.07]">
      <div className="text-[10px] font-bold uppercase tracking-[0.25em] text-zinc-500">{label}</div>
      <div className="mt-1 text-sm font-semibold text-zinc-900 dark:text-white">{value}</div>
    </div>
  );
}

function SelectionMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-[132px] rounded-2xl border border-black/10 bg-zinc-50/90 px-4 py-3 shadow-sm transition-colors hover:bg-zinc-100/90 dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/[0.07]">
      <div className="text-[10px] font-bold uppercase tracking-[0.25em] text-zinc-500">{label}</div>
      <div className="mt-1 text-sm font-semibold text-zinc-900 dark:text-white">{value}</div>
    </div>
  );
}

function MetricRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="group flex items-center justify-between border-b border-black/5 py-1.5 transition-colors last:border-0 hover:bg-black/[0.02] dark:border-white/5 dark:hover:bg-white/[0.02]">
      <div className="text-xs font-medium text-zinc-500 transition-colors group-hover:text-zinc-700 dark:group-hover:text-zinc-300">{label}</div>
      <div className="text-sm font-semibold text-zinc-900 dark:text-white">{value}</div>
    </div>
  );
}

function SkeletonBlock({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-full bg-zinc-200/85 dark:bg-white/10 ${className}`} />;
}

function TrendChartSkeleton({ dualSeries = false }: { dualSeries?: boolean }) {
  return (
    <div className="absolute inset-0 overflow-hidden rounded-3xl border border-black/5 bg-zinc-50/60 p-4 dark:border-white/5 dark:bg-white/[0.02]">
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between gap-3">
          <SkeletonBlock className="h-4 w-32" />
          <div className="flex items-center gap-2">
            <SkeletonBlock className="h-6 w-16" />
            {dualSeries ? <SkeletonBlock className="h-6 w-24" /> : null}
          </div>
        </div>
        <div className="relative mt-4 flex-1 overflow-hidden rounded-2xl border border-black/5 bg-white/70 px-4 py-3 dark:border-white/5 dark:bg-black/20">
          {[14, 34, 54, 74].map((top) => (
            <div
              key={top}
              className="absolute left-12 right-4 h-px bg-zinc-200/80 dark:bg-white/10"
              style={{ top: `${top}%` }}
            />
          ))}
          <svg
            viewBox="0 0 100 60"
            preserveAspectRatio="none"
            className="absolute inset-x-12 bottom-8 top-10 h-auto w-auto overflow-visible"
            aria-hidden="true"
          >
            <path
              d="M2 16 C18 18, 28 23, 42 30 S70 43, 98 52"
              fill="none"
              stroke="rgb(253 186 116 / 0.9)"
              strokeWidth="2.8"
              strokeLinecap="round"
              className="dark:stroke-[rgba(251,191,36,0.28)]"
            />
            {dualSeries ? (
              <path
                d="M2 10 C18 14, 32 18, 47 27 S75 38, 98 46"
                fill="none"
                stroke="rgb(203 213 225 / 0.95)"
                strokeWidth="2.8"
                strokeLinecap="round"
                className="dark:stroke-[rgba(226,232,240,0.24)]"
              />
            ) : null}
          </svg>
          <div className="absolute bottom-3 left-12 right-4 flex items-center justify-between">
            <SkeletonBlock className="h-3 w-20" />
            <SkeletonBlock className="h-3 w-20" />
          </div>
        </div>
      </div>
    </div>
  );
}

function MovementBreakdownSkeleton() {
  return (
    <div className="mt-3 pt-3 border-t border-black/5 dark:border-white/5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <SkeletonBlock className="h-3 w-36" />
          <SkeletonBlock className="mt-2 h-3 w-28" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SkeletonBlock className="h-7 w-20" />
          <SkeletonBlock className="h-7 w-20" />
          <SkeletonBlock className="h-7 w-20" />
        </div>
      </div>

      <div className="mt-3 flex h-[300px] flex-col overflow-hidden rounded-xl border border-black/10 bg-zinc-50/70 dark:border-white/10 dark:bg-white/[0.03]">
        <div className="grid gap-3 border-b border-black/5 bg-zinc-100/50 px-4 py-2 dark:border-white/5 dark:bg-white/[0.02] md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
          <SkeletonBlock className="h-3 w-32" />
          <div className="flex md:justify-end">
            <SkeletonBlock className="h-3 w-16" />
          </div>
        </div>
        <div className="flex-1 divide-y divide-black/5 overflow-y-auto dark:divide-white/5">
          {Array.from({ length: 5 }).map((_, index) => (
            <div
              key={index}
              className="grid min-h-[74px] gap-3 px-4 py-3 transition-colors hover:bg-zinc-100/50 dark:hover:bg-white/[0.05] md:grid-cols-[minmax(0,1fr)_auto] md:items-center"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <SkeletonBlock className="h-4 w-24" />
                  <SkeletonBlock className="h-5 w-16" />
                  <SkeletonBlock className="h-5 w-16" />
                  <SkeletonBlock className="h-5 w-20" />
                </div>
                <SkeletonBlock className="mt-2 h-3 w-3/4 max-w-[320px]" />
              </div>
              <div className="flex flex-col items-start gap-2 md:items-end">
                <SkeletonBlock className="h-5 w-16" />
                <SkeletonBlock className="h-3 w-12" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const SidebarSearchInput = memo(function SidebarSearchInput({
  value,
  pending,
  placeholder,
  onChange,
}: {
  value: string;
  pending: boolean;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="relative">
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-black/20 pl-10 pr-10 py-2.5 text-sm text-zinc-900 dark:text-white outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500 transition-colors"
        placeholder={placeholder}
      />
      <svg className="absolute left-3 top-3 w-4 h-4 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
      {pending ? <span className="pointer-events-none absolute right-4 top-1/2 h-2.5 w-2.5 -translate-y-1/2 animate-pulse rounded-full bg-accent-500/90" /> : null}
    </div>
  );
});

const MaterialResultsList = memo(function MaterialResultsList({
  loading,
  rows,
  hasMore,
  selectedMaterialSku,
  onSelect,
}: {
  loading: boolean;
  rows: MaterialDashboardListRow[];
  hasMore: boolean;
  selectedMaterialSku: string | null;
  onSelect: (key: string) => void;
}) {
  if (loading) {
    return <div className="p-10 text-center text-sm text-zinc-500">Loading materials...</div>;
  }

  if (!rows.length) {
    return <div className="p-10 text-center text-sm text-zinc-500">No materials match the current filters.</div>;
  }

  return (
    <div className="divide-y divide-black/5 dark:divide-white/5">
      {rows.map((row) => {
        const active = row.sku === selectedMaterialSku;
        return (
          <div
            key={row.sku}
            onClick={() => onSelect(`material:${row.sku}`)}
            className={`cursor-pointer p-4 transition-colors ${
              active ? "bg-amber-50 dark:bg-amber-500/10 relative" : "hover:bg-zinc-100 dark:hover:bg-white/5"
            }`}
          >
            {active ? <div className="absolute left-0 top-0 bottom-0 w-1 bg-amber-500" /> : null}
            <div className="flex justify-between items-start gap-4 mb-2">
              <h4 className={`text-sm font-semibold leading-tight ${active ? "text-amber-900 dark:text-amber-100" : "text-zinc-900 dark:text-white"}`}>
                {row.material_name}
              </h4>
              <div className="text-xs font-mono px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 flex-shrink-0">
                {row.sku}
              </div>
            </div>
            <div className="flex items-center justify-between text-xs text-zinc-500">
              <div><span className="font-medium text-zinc-700 dark:text-zinc-300">{formatNumber(row.movement_quantity_60d)}</span> {row.unit || "units"} (60d)</div>
              <div>Last mov: {formatDate(row.last_movement_date)}</div>
            </div>
          </div>
        );
      })}
      {hasMore ? <div className="px-4 py-3 text-[11px] font-medium text-zinc-400">Scroll to load more materials...</div> : null}
    </div>
  );
});

const CecoResultsList = memo(function CecoResultsList({
  rows,
  hasMore,
  selectedCecoSet,
  cecoFilterMode,
  onToggle,
}: {
  rows: MaterialDashboardCeco[];
  hasMore: boolean;
  selectedCecoSet: Set<string>;
  cecoFilterMode: CecoFilterMode;
  onToggle: (code: string) => void;
}) {
  if (!rows.length) {
    return <div className="py-6 text-sm text-zinc-500 text-center">No cost centers match.</div>;
  }

  return (
    <div className="space-y-1">
      {rows.map((ceco) => {
        const isSelected = selectedCecoSet.has(ceco.code);
        return (
          <label
            key={ceco.code}
            className={`flex items-start gap-3 p-2.5 rounded-xl cursor-pointer transition-colors ${
              isSelected
                ? cecoFilterMode === "exclude"
                  ? "bg-rose-50 dark:bg-rose-500/10 hover:bg-rose-100 dark:hover:bg-rose-500/20"
                  : "bg-accent-50 dark:bg-accent-500/10 hover:bg-accent-100 dark:hover:bg-accent-500/20"
                : "hover:bg-zinc-100 dark:hover:bg-white/5"
            }`}
          >
            <input
              type="checkbox"
              checked={isSelected}
              onChange={() => onToggle(ceco.code)}
              className="mt-1 flex-shrink-0"
            />
            <span className="min-w-0 flex-1">
              <span
                className={`block text-sm font-medium truncate ${
                  isSelected
                    ? cecoFilterMode === "exclude"
                      ? "text-rose-900 dark:text-rose-100"
                      : "text-accent-900 dark:text-accent-100"
                    : "text-zinc-900 dark:text-white"
                }`}
              >
                {ceco.name || ceco.code}
              </span>
              <span
                className={`block text-[10px] uppercase tracking-wider ${
                  isSelected
                    ? cecoFilterMode === "exclude"
                      ? "text-rose-700 dark:text-rose-300"
                      : "text-accent-700 dark:text-accent-300"
                    : "text-zinc-500"
                }`}
              >
                {ceco.code}
              </span>
            </span>
          </label>
        );
      })}
      {hasMore ? <div className="px-2 py-3 text-[11px] font-medium text-zinc-400">Scroll to load more CECOs...</div> : null}
    </div>
  );
});

const GroupResultsList = memo(function GroupResultsList({
  rows,
  selectedGroupId,
  onSelect,
}: {
  rows: MaterialStudyGroupRow[];
  selectedGroupId: number | null;
  onSelect: (key: string) => void;
}) {
  if (!rows.length) {
    return <div className="p-10 text-center text-sm text-zinc-500">No groups match the current filters.</div>;
  }

  return (
    <div className="divide-y divide-black/5 dark:divide-white/5">
      {rows.map((row) => {
        const active = row.group_id === selectedGroupId;
        return (
          <div
            key={row.group_id}
            onClick={() => onSelect(`group:${row.group_id}`)}
            className={`cursor-pointer p-4 transition-colors ${
              active ? "bg-amber-50 dark:bg-amber-500/10 relative" : "hover:bg-zinc-100 dark:hover:bg-white/5"
            }`}
          >
            {active ? <div className="absolute left-0 top-0 bottom-0 w-1 bg-amber-500" /> : null}
            <div className="flex justify-between items-start gap-4 mb-2">
              <div>
                <h4 className={`text-sm font-semibold leading-tight ${active ? "text-amber-900 dark:text-amber-100" : "text-zinc-900 dark:text-white"}`}>
                  {row.name}
                </h4>
                <div className="mt-1 text-[11px] text-zinc-500">{formatNumber(row.member_count, 0)} members</div>
              </div>
              <div className="text-xs font-mono px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 flex-shrink-0">
                {row.study_unit}
              </div>
            </div>
            <div className="flex items-center justify-between text-xs text-zinc-500">
              <div><span className="font-medium text-zinc-700 dark:text-zinc-300">{formatNumber(row.movement_quantity_60d)}</span> {row.study_unit} (60d)</div>
              <div>Last mov: {formatDate(row.last_movement_date)}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
});

function MovementBreakdownList({
  movements,
  loading,
  rangeStart,
  rangeEnd,
  unitLabel,
}: {
  movements: DashboardHistoryDetailLike[];
  loading: boolean;
  rangeStart: string | null;
  rangeEnd: string | null;
  unitLabel?: string | null;
}) {
  const [stationModalOpen, setStationModalOpen] = useState(false);

  if (loading) {
    return <MovementBreakdownSkeleton />;
  }

  const totalQuantity = movements.reduce((sum, movement) => sum + (Number(movement.quantity) || 0), 0);
  const uniqueCecos = new Set(movements.map((movement) => movement.ceco).filter(Boolean)).size;

  return (
    <div className="mt-3 pt-3 border-t border-black/5 dark:border-white/5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h4 className="text-[10px] font-bold uppercase tracking-[0.25em] text-zinc-500">Movement Breakdown</h4>
          <p className="mt-1 text-xs text-zinc-500">
            {formatDate(rangeStart)} - {formatDate(rangeEnd)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
          <span className="rounded-full border border-black/10 px-2.5 py-1 dark:border-white/10">{formatNumber(movements.length, 0)} movs.</span>
          <span className="rounded-full border border-black/10 px-2.5 py-1 dark:border-white/10">{formatNumber(uniqueCecos, 0)} CECOs</span>
          <span className="rounded-full border border-black/10 px-2.5 py-1 dark:border-white/10">{formatNumber(totalQuantity)} qty</span>
        </div>
      </div>

      <div className="mt-3 flex h-[300px] flex-col overflow-hidden rounded-xl border border-black/10 bg-zinc-50/70 dark:border-white/10 dark:bg-white/[0.03]">
        {movements.length ? (
          <>
            <div className="grid gap-3 border-b border-black/5 bg-zinc-100/50 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.1em] text-zinc-500 dark:border-white/5 dark:bg-white/[0.02] md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
              <div className="flex items-center gap-2">
                <span>Detalles del Movimiento</span>
                {movements.length ? (
                  <button
                    type="button"
                    onClick={() => setStationModalOpen(true)}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-black/10 bg-white/80 text-zinc-600 transition-colors hover:border-amber-400/60 hover:text-amber-600 dark:border-white/10 dark:bg-white/[0.04] dark:text-zinc-300 dark:hover:text-amber-300"
                    title="Ver distribución por estación"
                    aria-label="Ver distribución por estación"
                  >
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" aria-hidden="true">
                      <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.7" opacity="0.35" />
                      <path d="M12 4a8 8 0 0 1 8 8h-8z" fill="currentColor" />
                      <path d="M12 12l-4.9 6.3A8 8 0 0 1 4 12z" fill="currentColor" opacity="0.6" />
                    </svg>
                  </button>
                ) : null}
              </div>
              <div className="text-left md:text-right">Cantidad</div>
            </div>
            <div className="flex-1 divide-y divide-black/5 overflow-y-auto dark:divide-white/5">
              {movements.map((movement, index) => {
                const cecoLabel = movement.ceco_name ? `${movement.ceco ?? "No CECO"} - ${movement.ceco_name}` : movement.ceco ?? "No CECO";
                const titleParts = [
                  `Fecha: ${formatDate(movement.date)}`,
                  `Cantidad: ${formatNumber(movement.quantity)}`,
                  `CECO: ${cecoLabel}`,
                  "sku" in movement ? `SKU: ${movement.sku}` : null,
                  movement.movement_internal_number ? `Mov. ERP: ${movement.movement_internal_number}` : null,
                  movement.line_count > 0 ? `Lineas SKU: ${formatNumber(movement.line_count, 0)}` : null,
                ].filter(Boolean);
                return (
                  <div
                    key={`${movement.date}-${movement.movement_internal_number ?? "movement"}-${index}`}
                    title={titleParts.join("\n")}
                    className="grid gap-3 px-4 py-3 transition-colors hover:bg-zinc-100/50 dark:hover:bg-white/[0.05] md:grid-cols-[minmax(0,1fr)_auto] md:items-center"
                  >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-zinc-900 dark:text-white">{formatDate(movement.date)}</span>
                      {"sku" in movement ? (
                        <span className="rounded-full border border-black/10 px-2 py-0.5 font-mono text-[10px] text-zinc-500 dark:border-white/10">
                          {movement.sku}
                        </span>
                      ) : null}
                      <span className="rounded-full bg-black/[0.05] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-600 dark:bg-white/[0.06] dark:text-zinc-300">
                        {movement.ceco ?? "No CECO"}
                      </span>
                      {movement.movement_internal_number ? (
                        <span className="rounded-full border border-black/10 px-2 py-0.5 font-mono text-[10px] text-zinc-500 dark:border-white/10">
                          ERP {movement.movement_internal_number}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 truncate text-xs text-zinc-500">
                      {"material_name" in movement ? `${movement.material_name} • ` : ""}
                      {movement.ceco_name || "No CECO description"}
                      {movement.line_count > 0 ? ` • ${formatNumber(movement.line_count, 0)} lineas SKU` : ""}
                    </p>
                  </div>
                  <div className="text-left md:text-right">
                    <div className="text-base font-semibold text-zinc-900 dark:text-white">{formatNumber(movement.quantity)}</div>
                    <div className="text-[11px] text-zinc-500">
                      {"source_quantity" in movement ? `${formatNumber(movement.source_quantity)} src` : "Salida"}
                    </div>
                  </div>
                </div>
              );
            })}
            </div>
          </>
        ) : (
          <div className="flex h-full items-center justify-center px-4 py-8 text-sm text-zinc-500">
            No outgoing movements fell within this plotted period.
          </div>
        )}
      </div>

      <MovementStationDistributionModal
        open={stationModalOpen}
        movements={movements}
        rangeStart={rangeStart}
        rangeEnd={rangeEnd}
        unitLabel={unitLabel}
        onClose={() => setStationModalOpen(false)}
      />
    </div>
  );
}

const MovementHistoryCard = memo(function MovementHistoryCard({
  selected,
  detail,
  history,
  houseTypes,
  projects,
  selectedHouseTypeId,
  selectedProjectId,
  leadTimeMode,
  onSelectHouseType,
  onSelectProject,
  onLeadTimeModeChange,
  houseRange,
  onHouseRangeChange,
  houseComparison,
  detailLoading,
  historyLoading,
  houseComparisonLoading,
  detailRefreshing,
  historyRefreshing,
  houseComparisonRefreshing,
  historyError,
  houseComparisonError,
}: {
  selected: DashboardSelectionRow | null;
  detail: DashboardDetailLike | null;
  history: DashboardHistoryLike | null;
  houseTypes: MaterialDashboardHouseType[];
  projects: ProjectSummary[];
  selectedHouseTypeId: number | null;
  selectedProjectId: number | null;
  leadTimeMode: LeadTimeMode;
  onSelectHouseType: (houseTypeId: number | null) => void;
  onSelectProject: (projectId: number | null) => void;
  onLeadTimeModeChange: (mode: LeadTimeMode) => void;
  houseRange: HouseRange;
  onHouseRangeChange: (range: HouseRange) => void;
  houseComparison: DashboardHouseComparisonLike | null;
  detailLoading: boolean;
  historyLoading: boolean;
  houseComparisonLoading: boolean;
  detailRefreshing: boolean;
  historyRefreshing: boolean;
  houseComparisonRefreshing: boolean;
  historyError: string | null;
  houseComparisonError: string | null;
}) {
  const [selection, setSelection] = useState<ChartSelection | null>(null);
  const [dragAnchorIndex, setDragAnchorIndex] = useState<number | null>(null);
  const [dragCurrentIndex, setDragCurrentIndex] = useState<number | null>(null);
  const [hoveredPointIndex, setHoveredPointIndex] = useState<number | null>(null);
  const [bufferWeeksInput, setBufferWeeksInput] = useState("2");
  const [isEditingBufferWeeks, setIsEditingBufferWeeks] = useState(false);
  const [isEditingLeadTimeMode, setIsEditingLeadTimeMode] = useState(false);
  const selectedGroup = isGroupRow(selected) ? selected : null;
  const groupSelection = Boolean(selectedGroup);

  useEffect(() => {
    setSelection(null);
    setDragAnchorIndex(null);
    setDragCurrentIndex(null);
    setHoveredPointIndex(null);
    setIsEditingBufferWeeks(false);
    setIsEditingLeadTimeMode(false);
  }, [selected?.sku, history?.generated_at, detail?.stock_on_hand, selectedHouseTypeId, selectedProjectId, houseComparison?.generated_at, houseRange.startDate, houseRange.endDate]);

  if (!selected) {
    return (
      <section className="flex-1 flex items-center justify-center bg-white dark:bg-zinc-950 h-full">
        <div className="text-center max-w-xl p-8">
          <div className="w-16 h-16 rounded-2xl bg-zinc-100 dark:bg-white/5 mx-auto flex items-center justify-center mb-6">
            <svg className="w-8 h-8 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z" />
            </svg>
          </div>
          <p className="text-[10px] font-bold uppercase tracking-[0.35em] text-zinc-500 mb-3">Pinned Graph</p>
          <h2 className="text-xl font-medium text-zinc-900 dark:text-white mb-2">No study selected</h2>
          <p className="text-sm text-zinc-500">
            Select a material or group from the list to analyze normalized movement history and stock trends.
          </p>
        </div>
      </section>
    );
  }

  const latestHouseRangeDate = moveToPreviousBusinessDay(new Date());
  const latestHouseRangeValue = toDateInputValue(latestHouseRangeDate);
  const selectedHouseType = houseTypes.find((houseType) => houseType.id === selectedHouseTypeId) || null;
  const houseComparisonInRange = getHouseComparisonForRange(houseComparison, houseRange);
  const projectComparisonInRange = houseComparisonInRange?.project_comparison ?? null;
  const weekdayHouseComparison =
    houseComparisonInRange
      ? {
          ...houseComparisonInRange,
          points: houseComparisonInRange.points.filter((point) => !isWeekend(toStartOfDay(point.date))),
        }
      : null;
  const houseStockSeries =
    detail && history
      ? buildHistoricalStockSeries(history.movements, detail.stock_on_hand, {
          startDate: houseRange.startDate,
          endDate: latestHouseRangeValue,
        })
      : [];
  const projectedStockByDay = buildProjectedStockByDay(houseComparisonInRange, houseStockSeries);
  const houseRangeEndStockValue = getStockValueForDate(houseStockSeries, houseRange.endDate);
  const stockRangeChart = houseStockSeries.length ? buildLinePath(houseStockSeries, CHART_WIDTH, CHART_HEIGHT) : null;
  const houseChart =
    weekdayHouseComparison && houseStockSeries.length
        ? buildHouseComparisonChart(
            weekdayHouseComparison,
            houseStockSeries,
            CHART_WIDTH,
            CHART_HEIGHT,
            houseRangeEndStockValue,
            detail?.stock_on_hand ?? null,
            projectedStockByDay,
          )
      : weekdayHouseComparison
        ? buildHouseComparisonChart(
            weekdayHouseComparison,
            [],
            CHART_WIDTH,
            CHART_HEIGHT,
            houseRangeEndStockValue,
            detail?.stock_on_hand ?? null,
            projectedStockByDay,
          )
        : null;
  const activeSelection =
    dragAnchorIndex !== null && dragCurrentIndex !== null ? { startIndex: dragAnchorIndex, endIndex: dragCurrentIndex } : selection;
  const stockSummary = stockRangeChart ? getSeriesSummary(stockRangeChart.points, activeSelection) : null;
  const houseSummary = houseChart ? getHouseSeriesSummary(houseChart.points, activeSelection) : null;
  const houseStockSummary = houseChart ? getHouseStockSeriesSummary(houseChart.points, activeSelection) : null;
  const activeChart = selectedHouseType ? houseChart : stockRangeChart;
  const selectionBounds = activeSelection && activeChart ? getClampedSelectionBounds(activeSelection, activeChart.points.length) : null;
  const selectionStart = selectionBounds && activeChart ? activeChart.points[selectionBounds.startIndex] : null;
  const selectionEnd = selectionBounds && activeChart ? activeChart.points[selectionBounds.endIndex] : null;
  const hoveredPoint = stockRangeChart && hoveredPointIndex !== null ? stockRangeChart.points[hoveredPointIndex] || null : null;
  const houseChartHoveredPoint = houseChart && hoveredPointIndex !== null ? houseChart.points[hoveredPointIndex] || null : null;
  const isCustomSelection = Boolean(activeSelection && selectionBounds && selectionBounds.startIndex !== selectionBounds.endIndex);
  const isBlockingLoad = !historyError && (!detail || !history);
  const isHouseBlockingLoad = !historyError && !houseComparisonError && Boolean(selectedHouseType) && (!detail || !history || !houseComparison);
  const isRefreshing = detailRefreshing || historyRefreshing;
  const bufferWeeks = Math.max(Number(bufferWeeksInput) || 0, 0);
  const leadTimeReference = getLeadTimeReference(detail, leadTimeMode);
  const selectedReorderDateRecentRate = getReorderDateForLeadTime(detail, leadTimeReference);
  const procurementSummary = selectedHouseType ? houseStockSummary : stockSummary;
  const purchaseOrderEstimate = getPurchaseOrderEstimate({
    detail,
    summary: procurementSummary,
    leadTimeReference,
    isCustomSelection,
    bufferWeeks,
  });
  const estimatedConsumptionPurchaseOrderEstimate = getEstimatedConsumptionPurchaseOrderEstimate({
    detail,
    leadTimeReference,
    estimatedConsumptionPerWeek:
      selectedHouseType && projectComparisonInRange
        ? isCustomSelection
          ? houseSummary?.averageProjectedConsumptionPerWeek ?? null
          : projectComparisonInRange.projected_total_material_quantity / Math.max((houseChart?.points.length ?? 0) / 5, 0.2)
        : null,
    isCustomSelection,
    bufferWeeks,
  });
  const selectedBadge = groupSelection ? `Group #${selectedGroup?.group_id}` : selected.sku;
  const selectedUnitLabel = groupSelection ? selectedGroup?.study_unit : selected.unit;
  const detailMembers = isGroupDetail(detail) ? detail.members : [];
  const actualConsumptionPerHouse = houseSummary?.averageConsumptionPerHouse ?? houseComparisonInRange?.material_per_house ?? null;
  const projectedConsumptionPerHouse = projectComparisonInRange?.predicted_quantity_per_house ?? null;
  const consumptionDeltaPercent =
    actualConsumptionPerHouse !== null && projectedConsumptionPerHouse && projectedConsumptionPerHouse !== 0
      ? ((actualConsumptionPerHouse - projectedConsumptionPerHouse) / projectedConsumptionPerHouse) * 100
      : null;
  const consumptionCostDeltaPerHouse =
    actualConsumptionPerHouse !== null &&
    projectedConsumptionPerHouse !== null &&
    detail?.average_price !== null &&
    detail?.average_price !== undefined
      ? (actualConsumptionPerHouse - projectedConsumptionPerHouse) * detail.average_price
      : null;
  const activeMovementRangeStart = selectedHouseType
    ? houseSummary?.start.date ?? houseComparisonInRange?.range_start ?? houseRange.startDate
    : stockSummary?.start.date ?? houseRange.startDate;
  const activeMovementRangeEnd = selectedHouseType
    ? houseSummary?.end.date ?? houseComparisonInRange?.range_end ?? houseRange.endDate
    : stockSummary?.end.date ?? houseRange.endDate;
  const filteredHouseMovementDetails = (history?.movement_details || []).filter((movement) =>
    isDateWithinRange(movement.date, activeMovementRangeStart, activeMovementRangeEnd),
  );

  function getPointIndexFromEvent(event: ReactPointerEvent<SVGSVGElement>) {
    if (!activeChart) {
      return null;
    }
    const svg = event.currentTarget;
    const pt = svg.createSVGPoint();
    pt.x = event.clientX;
    pt.y = event.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) {
      return null;
    }
    const cursorPt = pt.matrixTransform(ctm.inverse());
    const chartX = clamp(cursorPt.x, activeChart.padding.left, activeChart.padding.left + activeChart.plotWidth);
    return getClosestPointIndex(activeChart.points, chartX);
  }

  function handlePointerDown(event: ReactPointerEvent<SVGSVGElement>) {
    const pointIndex = getPointIndexFromEvent(event);
    if (pointIndex === null) {
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragAnchorIndex(pointIndex);
    setDragCurrentIndex(pointIndex);
    setHoveredPointIndex(pointIndex);
  }

  function handlePointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    const pointIndex = getPointIndexFromEvent(event);
    if (pointIndex !== null) {
      setHoveredPointIndex(pointIndex);
    }
    if (dragAnchorIndex === null || pointIndex === null) {
      return;
    }
    setDragCurrentIndex(pointIndex);
  }

  function handlePointerUp(event: ReactPointerEvent<SVGSVGElement>) {
    if (dragAnchorIndex === null) {
      return;
    }
    const pointIndex = getPointIndexFromEvent(event);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setHoveredPointIndex(pointIndex);
    if (pointIndex !== null && pointIndex !== dragAnchorIndex) {
      setSelection({ startIndex: dragAnchorIndex, endIndex: pointIndex });
    }
    setDragAnchorIndex(null);
    setDragCurrentIndex(null);
  }

  function handlePointerCancel(event: ReactPointerEvent<SVGSVGElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDragAnchorIndex(null);
    setDragCurrentIndex(null);
    setHoveredPointIndex(null);
  }

  function handlePointerLeave() {
    if (dragAnchorIndex !== null) {
      return;
    }
    setHoveredPointIndex(null);
  }

  function handleHouseRangeStartChange(value: string) {
    if (!value) {
      return;
    }
    let nextStart = moveToNextBusinessDay(toStartOfDay(value));
    let nextEnd = toStartOfDay(houseRange.endDate);
    if (nextStart.getTime() > latestHouseRangeDate.getTime()) {
      nextStart = latestHouseRangeDate;
    }
    if (nextStart.getTime() > nextEnd.getTime()) {
      nextEnd = new Date(nextStart);
    }
    onHouseRangeChange({
      startDate: toDateInputValue(nextStart),
      endDate: toDateInputValue(nextEnd),
    });
  }

  function handleHouseRangeEndChange(value: string) {
    if (!value) {
      return;
    }
    let nextStart = toStartOfDay(houseRange.startDate);
    let nextEnd = moveToPreviousBusinessDay(toStartOfDay(value));
    if (nextEnd.getTime() > latestHouseRangeDate.getTime()) {
      nextEnd = latestHouseRangeDate;
    }
    if (nextEnd.getTime() < nextStart.getTime()) {
      nextStart = new Date(nextEnd);
    }
    onHouseRangeChange({
      startDate: toDateInputValue(nextStart),
      endDate: toDateInputValue(nextEnd),
    });
  }

  return (
    <section className="flex-1 flex flex-col h-full bg-white dark:bg-zinc-950 overflow-hidden">
      <div className="p-6 md:p-8 border-b border-black/10 dark:border-white/10 bg-white/40 dark:bg-black/20 flex flex-col md:flex-row justify-between gap-6">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.35em] text-zinc-500 mb-2">Pinned Graph</p>
          <h2 className="text-3xl font-bold text-zinc-900 dark:text-white tracking-tight">{selected.material_name}</h2>
          <p className="text-sm font-medium text-zinc-500 mt-2 flex items-center gap-2">
            <span className="bg-zinc-200 dark:bg-zinc-800 px-2 py-0.5 rounded text-xs text-zinc-700 dark:text-zinc-300 font-mono">{selectedBadge}</span>
            {selectedUnitLabel ? <span>&bull; {selectedUnitLabel}</span> : null}
            {groupSelection ? <span>&bull; {formatNumber(selectedGroup?.member_count, 0)} members</span> : null}
          </p>
          {groupSelection && detailMembers.length ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {detailMembers.map((member) => (
                <span
                  key={member.sku}
                  className="rounded-full border border-black/10 bg-white/80 px-2.5 py-1 text-[10px] font-medium text-zinc-600 dark:border-white/10 dark:bg-white/[0.05] dark:text-zinc-300"
                >
                  {member.sku} = {formatNumber(member.factor_to_study_unit)} {detail?.unit || selectedGroup?.study_unit}
                </span>
              ))}
            </div>
          ) : null}
        </div>
        <div className="flex gap-6 items-end">
          <div className="text-right">
            <div className="text-[10px] font-bold uppercase tracking-[0.25em] text-zinc-500 mb-1">
              {selectedHouseType ? "Cons./House" : "Stock on Hand"}
            </div>
            <div className="flex items-center justify-end gap-2">
              <div className="text-3xl font-light tracking-tight text-zinc-900 dark:text-white">
                {selectedHouseType
                  ? houseSummary
                    ? formatNumber(houseSummary.averageConsumptionPerHouse)
                    : houseComparisonInRange
                      ? formatNumber(houseComparisonInRange.material_per_house)
                      : houseComparisonLoading
                        ? "..."
                        : "—"
                  : detail
                    ? formatNumber(detail.stock_on_hand)
                    : detailLoading
                      ? "..."
                      : "—"}
              </div>
              {selectedHouseType && projectComparisonInRange && consumptionDeltaPercent !== null ? (
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold ${
                    consumptionDeltaPercent > 0
                      ? "bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300"
                      : consumptionDeltaPercent < 0
                        ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
                        : "bg-zinc-100 text-zinc-600 dark:bg-white/10 dark:text-zinc-300"
                  }`}
                >
                  <span>{consumptionDeltaPercent > 0 ? "↑" : consumptionDeltaPercent < 0 ? "↓" : "→"}</span>
                  <span>{percentFormatter.format(Math.abs(consumptionDeltaPercent))}%</span>
                </span>
              ) : null}
            </div>
          </div>
          {selectedHouseType && projectComparisonInRange ? <div className="w-px h-10 bg-black/10 dark:bg-white/10 hidden md:block" /> : null}
          {selectedHouseType && projectComparisonInRange ? (
            <div className="text-right">
              <div className="text-[10px] font-bold uppercase tracking-[0.25em] text-zinc-500 mb-1">Proj./House</div>
              <div className="text-3xl font-light tracking-tight text-zinc-900 dark:text-white">
                {formatNumber(projectComparisonInRange.predicted_quantity_per_house)}
              </div>
            </div>
          ) : null}
          {selectedHouseType && projectComparisonInRange && consumptionCostDeltaPerHouse !== null ? (
            <div className="w-px h-10 bg-black/10 dark:bg-white/10 hidden md:block" />
          ) : null}
          {selectedHouseType && projectComparisonInRange && consumptionCostDeltaPerHouse !== null ? (
            <div className="text-right">
              <div className="text-[10px] font-bold uppercase tracking-[0.25em] text-zinc-500 mb-1">
                {consumptionCostDeltaPerHouse > 0 ? "Overcost/House" : consumptionCostDeltaPerHouse < 0 ? "Savings/House" : "Cost/House"}
              </div>
              <div
                className={`text-3xl font-light tracking-tight ${
                  consumptionCostDeltaPerHouse > 0
                    ? "text-red-700 dark:text-red-300"
                    : consumptionCostDeltaPerHouse < 0
                      ? "text-emerald-700 dark:text-emerald-300"
                      : "text-zinc-900 dark:text-white"
                }`}
              >
                {formatCurrency(Math.abs(consumptionCostDeltaPerHouse))}
              </div>
            </div>
          ) : null}
          <div className="w-px h-10 bg-black/10 dark:bg-white/10 hidden md:block" />
          <div className="text-right">
            <div className="text-[10px] font-bold uppercase tracking-[0.25em] text-zinc-500 mb-1">{groupSelection ? "Study Unit" : "Avg Price"}</div>
            <div className="text-3xl font-light tracking-tight text-zinc-900 dark:text-white">
              {groupSelection ? detail?.unit || selectedGroup?.study_unit : detail ? formatCurrency(detail.average_price) : detailLoading ? "..." : "—"}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr,320px] flex-1">
        <div className="p-6 md:p-8 flex flex-col border-b lg:border-b-0 lg:border-r border-black/10 dark:border-white/10">
          <div className="flex items-start justify-between mb-2 gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-3">
                <h3 className="text-sm font-semibold text-zinc-900 dark:text-white">
                  {selectedHouseType
                    ? isCustomSelection
                      ? "Selected House Period"
                      : houseChart
                        ? `${houseChart.points.length}-Weekday House Trend`
                        : "House Trend"
                    : isCustomSelection
                      ? "Selected Stock Period"
                      : stockRangeChart
                        ? `${stockRangeChart.points.length}-Business-Day Stock Trend`
                        : "Stock Trend"}
                </h3>
                <select
                  value={selectedHouseTypeId === null ? "none" : String(selectedHouseTypeId)}
                  onChange={(event) => onSelectHouseType(event.target.value === "none" ? null : Number(event.target.value))}
                  className="rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-zinc-900 px-3 py-1.5 text-sm text-zinc-900 dark:text-white outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500 transition-colors"
                >
                  <option value="none">None</option>
                  {houseTypes.map((houseType) => (
                    <option key={houseType.id} value={houseType.id}>
                      {houseType.name}
                    </option>
                  ))}
                </select>
                <select
                  value={selectedProjectId ?? ""}
                  onChange={(event) => onSelectProject(event.target.value ? Number(event.target.value) : null)}
                  className="rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-zinc-900 px-3 py-1.5 text-sm text-zinc-900 dark:text-white outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500 transition-colors"
                >
                  <option value="">No project</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
                <div className="inline-flex items-center gap-1 rounded-full border border-black/10 bg-black/[0.02] px-1.5 py-1 dark:border-white/10 dark:bg-white/[0.03]">
                  <input
                    type="date"
                    value={houseRange.startDate}
                    max={houseRange.endDate}
                    onChange={(event) => handleHouseRangeStartChange(event.target.value)}
                    aria-label="Start date"
                    className="w-[106px] rounded-full bg-transparent px-2 py-0.5 text-[11px] font-medium text-zinc-600 outline-none transition-colors hover:bg-black/[0.03] focus:bg-white/80 focus:ring-1 focus:ring-accent-500/50 dark:text-zinc-300 dark:hover:bg-white/[0.04] dark:focus:bg-white/[0.06] [color-scheme:light] dark:[color-scheme:dark]"
                  />
                  <span className="text-[11px] text-zinc-400">-</span>
                  <input
                    type="date"
                    value={houseRange.endDate}
                    min={houseRange.startDate}
                    max={latestHouseRangeValue}
                    onChange={(event) => handleHouseRangeEndChange(event.target.value)}
                    aria-label="End date"
                    className="w-[106px] rounded-full bg-transparent px-2 py-0.5 text-[11px] font-medium text-zinc-600 outline-none transition-colors hover:bg-black/[0.03] focus:bg-white/80 focus:ring-1 focus:ring-accent-500/50 dark:text-zinc-300 dark:hover:bg-white/[0.04] dark:focus:bg-white/[0.06] [color-scheme:light] dark:[color-scheme:dark]"
                  />
                  <button
                    type="button"
                    onClick={() => onHouseRangeChange(getDefaultHouseRange())}
                    className="rounded-full px-2.5 py-0.5 text-[11px] font-medium text-zinc-500 transition-colors hover:bg-black/[0.05] hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-white/[0.06] dark:hover:text-zinc-200"
                  >
                    90d
                  </button>
                </div>
              </div>
              <div className="text-xs text-zinc-500 mt-1">
                {selectedHouseType
                  ? houseSummary
                    ? `${formatDate(houseSummary.start.date)} - ${formatDate(houseSummary.end.date)}`
                    : houseComparisonInRange
                      ? `${formatDate(houseComparisonInRange.range_start)} - ${formatDate(houseComparisonInRange.range_end)}`
                      : `${formatDate(houseRange.startDate)} - ${formatDate(houseRange.endDate)}`
                  : stockSummary
                    ? `${formatDate(stockSummary.start.date)} - ${formatDate(stockSummary.end.date)}`
                    : `${formatDate(houseRange.startDate)} - ${formatDate(houseRange.endDate)}`}
              </div>
              {selectedHouseType ? (
                <>
                  <div className="mt-1 flex flex-wrap items-center gap-4 text-[11px] text-zinc-500">
                    <div className="flex items-center gap-2">
                      <span className="block h-0.5 w-6 rounded-full bg-amber-500" />
                      <span>Material stock</span>
                    </div>
                    {projectComparisonInRange ? (
                      <div className="flex items-center gap-2">
                        <span className="block h-0.5 w-6 rounded-full bg-emerald-500" />
                        <span>{projectComparisonInRange.project_name}</span>
                      </div>
                    ) : null}
                    <div className="flex items-center gap-2">
                      <span className="block h-0.5 w-6 rounded-full bg-slate-700 dark:bg-slate-300" />
                      <span>Remaining house starts</span>
                    </div>
                  </div>
                </>
              ) : (
                <p className="mt-1.5 text-xs text-zinc-500 max-w-sm">
                  Click and drag across the curve to inspect the stock variation and average weekday consumption. Weekend days are omitted.
                </p>
              )}
              {isRefreshing ? <p className="mt-1 text-xs text-amber-600 dark:text-amber-500">Refreshing cached ERP data...</p> : null}
              {houseComparisonRefreshing && selectedHouseType ? (
                <p className="mt-1 text-xs text-amber-600 dark:text-amber-500">Refreshing house-start comparison...</p>
              ) : null}
              {houseComparisonError && selectedHouseType ? <p className="mt-1 text-xs text-red-600 dark:text-red-400">{houseComparisonError}</p> : null}
            </div>
            {isCustomSelection ? (
              <div className="shrink-0">
                <button
                  type="button"
                  onClick={() => setSelection(null)}
                  className="rounded-full border border-black/10 px-3 py-1 text-[11px] font-medium text-zinc-600 transition-colors hover:bg-black/[0.04] hover:text-zinc-900 dark:border-white/10 dark:text-zinc-300 dark:hover:bg-white/[0.06] dark:hover:text-white"
                >
                  Reset Selection
                </button>
              </div>
            ) : null}
          </div>

          <div className="flex-1 w-full relative min-h-[180px]">
            {!selectedHouseType ? (
              isBlockingLoad ? (
                <TrendChartSkeleton />
              ) : stockRangeChart ? (
                <svg
                  viewBox={`0 0 ${stockRangeChart.width} ${stockRangeChart.height}`}
                  className="w-full h-full max-h-[400px] overflow-visible cursor-crosshair touch-none select-none"
                  focusable="false"
                  style={{ userSelect: "none", WebkitUserSelect: "none" }}
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerCancel={handlePointerCancel}
                  onPointerLeave={handlePointerLeave}
                >
                  <defs>
                    {selectionStart && selectionEnd ? (
                      <clipPath id="selection-clip">
                        <rect
                          x={Math.min(selectionStart.x, selectionEnd.x)}
                          y={0}
                          width={Math.max(Math.abs(selectionEnd.x - selectionStart.x), 0.001)}
                          height={stockRangeChart.height}
                        />
                      </clipPath>
                    ) : null}
                  </defs>
                  {[0, 0.25, 0.5, 0.75, 1].map((stop) => {
                    const y = stockRangeChart.padding.top + stockRangeChart.plotHeight - stop * stockRangeChart.plotHeight;
                    return (
                      <g key={stop}>
                        <line
                          x1={stockRangeChart.padding.left}
                          y1={y}
                          x2={stockRangeChart.width - stockRangeChart.padding.right}
                          y2={y}
                          stroke="rgba(113,113,122,0.18)"
                          strokeDasharray="4 6"
                        />
                        <text
                          x={stockRangeChart.padding.left - 10}
                          y={y + 4}
                          textAnchor="end"
                          fontSize="11"
                          fill="currentColor"
                          opacity="0.55"
                          pointerEvents="none"
                        >
                          {formatNumber(stockRangeChart.maxValue * stop)}
                        </text>
                      </g>
                    );
                  })}
                  {selectionStart && selectionEnd ? (
                    <g>
                      <rect
                        x={Math.min(selectionStart.x, selectionEnd.x)}
                        y={stockRangeChart.padding.top}
                        width={Math.max(Math.abs(selectionEnd.x - selectionStart.x), 2)}
                        height={stockRangeChart.plotHeight}
                        fill="rgba(245, 158, 11, 0.12)"
                      />
                      <line
                        x1={selectionStart.x}
                        y1={stockRangeChart.padding.top}
                        x2={selectionStart.x}
                        y2={stockRangeChart.padding.top + stockRangeChart.plotHeight}
                        stroke="rgba(245, 158, 11, 0.55)"
                        strokeDasharray="4 4"
                      />
                      <line
                        x1={selectionEnd.x}
                        y1={stockRangeChart.padding.top}
                        x2={selectionEnd.x}
                        y2={stockRangeChart.padding.top + stockRangeChart.plotHeight}
                        stroke="rgba(245, 158, 11, 0.55)"
                        strokeDasharray="4 4"
                      />
                    </g>
                  ) : null}
                  <path
                    d={stockRangeChart.path}
                    fill="none"
                    stroke="rgb(245 158 11)"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    opacity={selectionBounds ? 0.25 : 1}
                    className="transition-opacity duration-300"
                  />
                  {stockRangeChart.points.map((point) => (
                    <circle
                      key={`base-${point.date}`}
                      cx={point.x}
                      cy={point.y}
                      r={hoveredPoint?.index === point.index ? 5 : 2.5}
                      fill="rgb(245 158 11)"
                      opacity={selectionBounds ? 0.25 : 1}
                      className="transition-opacity duration-300"
                      pointerEvents="none"
                    />
                  ))}
                  {selectionBounds ? (
                    <g clipPath="url(#selection-clip)">
                      <path
                        d={stockRangeChart.path}
                        fill="none"
                        stroke="rgb(245 158 11)"
                        strokeWidth="3.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      {stockRangeChart.points.map((point) => {
                        const highlighted = point.index >= selectionBounds.startIndex && point.index <= selectionBounds.endIndex;
                        if (!highlighted) {
                          return null;
                        }
                        return (
                          <circle
                            key={`hi-${point.date}`}
                            cx={point.x}
                            cy={point.y}
                            r={hoveredPoint?.index === point.index ? 5.5 : 4.5}
                            fill="rgb(245 158 11)"
                            stroke="rgb(255 255 255)"
                            strokeWidth="1.5"
                            className="dark:stroke-zinc-900"
                            pointerEvents="none"
                          />
                        );
                      })}
                    </g>
                  ) : null}
                  {hoveredPoint ? (
                    <g pointerEvents="none">
                      <line
                        x1={hoveredPoint.x}
                        y1={stockRangeChart.padding.top}
                        x2={hoveredPoint.x}
                        y2={stockRangeChart.padding.top + stockRangeChart.plotHeight}
                        stroke="rgba(245, 158, 11, 0.35)"
                        strokeDasharray="4 4"
                      />
                      <circle
                        cx={hoveredPoint.x}
                        cy={hoveredPoint.y}
                        r={6}
                        fill="rgb(245 158 11)"
                        stroke="rgb(255 255 255)"
                        strokeWidth="2"
                        className="dark:stroke-zinc-900"
                      />
                      <g
                        transform={`translate(${clamp(hoveredPoint.x - 68, stockRangeChart.padding.left, stockRangeChart.width - stockRangeChart.padding.right - 136)}, ${
                          hoveredPoint.y < stockRangeChart.padding.top + 56 ? hoveredPoint.y + 14 : hoveredPoint.y - 54
                        })`}
                      >
                        <rect
                          width="136"
                          height="42"
                          rx="10"
                          fill="rgba(24, 24, 27, 0.92)"
                          className="dark:fill-zinc-950/95"
                        />
                        <text x="12" y="17" fontSize="11" fill="white" opacity="0.9">
                          {formatDate(hoveredPoint.date)}
                        </text>
                        <text x="12" y="31" fontSize="12" fill="white" fontWeight="700">
                          Stock: {formatNumber(hoveredPoint.value)}
                        </text>
                      </g>
                    </g>
                  ) : null}
                  <text x={stockRangeChart.padding.left} y={stockRangeChart.height - 8} fontSize="11" fill="currentColor" opacity="0.55" pointerEvents="none">
                    {formatDate(stockRangeChart.points[0]?.date)}
                  </text>
                  <text x={stockRangeChart.width - stockRangeChart.padding.right} y={stockRangeChart.height - 8} textAnchor="end" fontSize="11" fill="currentColor" opacity="0.55" pointerEvents="none">
                    {formatDate(stockRangeChart.points[stockRangeChart.points.length - 1]?.date)}
                  </text>
                </svg>
              ) : (
                <div className="absolute inset-0 flex items-center justify-center text-sm text-zinc-500">No movement history available for this study.</div>
              )
            ) : isHouseBlockingLoad ? (
                <TrendChartSkeleton dualSeries />
              ) : houseComparison && houseChart ? (
                <svg
                  viewBox={`0 0 ${houseChart.width} ${houseChart.height}`}
                  className="w-full h-full max-h-[400px] overflow-visible cursor-crosshair touch-none select-none"
                  focusable="false"
                  style={{ userSelect: "none", WebkitUserSelect: "none" }}
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerCancel={handlePointerCancel}
                  onPointerLeave={handlePointerLeave}
                >
                  <defs>
                    {selectionStart && selectionEnd ? (
                      <clipPath id="selection-clip">
                        <rect
                          x={Math.min(selectionStart.x, selectionEnd.x)}
                          y={0}
                          width={Math.max(Math.abs(selectionEnd.x - selectionStart.x), 0.001)}
                          height={houseChart.height}
                        />
                      </clipPath>
                    ) : null}
                  </defs>
                  {[0, 0.25, 0.5, 0.75, 1].map((stop) => {
                    const y = houseChart.padding.top + houseChart.plotHeight - stop * houseChart.plotHeight;
                    return (
                      <g key={stop}>
                        <line
                          x1={houseChart.padding.left}
                          y1={y}
                          x2={houseChart.width - houseChart.padding.right}
                          y2={y}
                          stroke="rgba(113,113,122,0.18)"
                          strokeDasharray="4 6"
                        />
                        <text x={houseChart.padding.left - 10} y={y + 4} textAnchor="end" fontSize="11" fill="currentColor" opacity="0.55">
                          {formatNumber(houseChart.minStock + (houseChart.maxStock - houseChart.minStock) * stop)}
                        </text>
                        <text x={houseChart.width - houseChart.padding.right + 10} y={y + 4} fontSize="11" fill="currentColor" opacity="0.55">
                          {formatNumber(houseChart.maxRemainingHouseStarts * stop, 0)}
                        </text>
                      </g>
                    );
                  })}
                  {selectionStart && selectionEnd ? (
                    <g>
                      <rect
                        x={Math.min(selectionStart.x, selectionEnd.x)}
                        y={houseChart.padding.top}
                        width={Math.max(Math.abs(selectionEnd.x - selectionStart.x), 2)}
                        height={houseChart.plotHeight}
                        fill="rgba(51, 65, 85, 0.08)"
                      />
                      <line
                        x1={selectionStart.x}
                        y1={houseChart.padding.top}
                        x2={selectionStart.x}
                        y2={houseChart.padding.top + houseChart.plotHeight}
                        stroke="rgba(51, 65, 85, 0.45)"
                        strokeDasharray="4 4"
                      />
                      <line
                        x1={selectionEnd.x}
                        y1={houseChart.padding.top}
                        x2={selectionEnd.x}
                        y2={houseChart.padding.top + houseChart.plotHeight}
                        stroke="rgba(51, 65, 85, 0.45)"
                        strokeDasharray="4 4"
                      />
                    </g>
                  ) : null}
                  {houseChart.stockPath ? (
                    <path
                      d={houseChart.stockPath}
                      fill="none"
                      stroke="rgb(245 158 11)"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      opacity={selectionBounds ? 0.25 : 1}
                      className="transition-opacity duration-300"
                    />
                  ) : null}
                  {houseChart.projectedStockPath ? (
                    <path
                      d={houseChart.projectedStockPath}
                      fill="none"
                      stroke="rgb(16 185 129)"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      opacity={selectionBounds ? 0.25 : 1}
                      className="transition-opacity duration-300"
                    />
                  ) : null}
                  {houseChart.housePath ? (
                    <path
                      d={houseChart.housePath}
                      fill="none"
                      stroke="rgb(51 65 85)"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      opacity={selectionBounds ? 0.25 : 1}
                      className="transition-opacity duration-300 dark:stroke-slate-300"
                    />
                  ) : null}
                  {houseChart.points.map((point) => (
                    <g key={point.date}>
                      {point.stockY !== null ? (
                        <circle
                          cx={point.x}
                          cy={point.stockY}
                          r={houseChartHoveredPoint?.index === point.index ? 5 : 2.5}
                          fill="rgb(245 158 11)"
                          opacity={selectionBounds ? 0.25 : 1}
                          className="transition-opacity duration-300"
                          pointerEvents="none"
                        />
                      ) : null}
                      {point.projectedStockY !== null ? (
                        <circle
                          cx={point.x}
                          cy={point.projectedStockY}
                          r={houseChartHoveredPoint?.index === point.index ? 5 : 2.5}
                          fill="rgb(16 185 129)"
                          opacity={selectionBounds ? 0.25 : 1}
                          className="transition-opacity duration-300"
                          pointerEvents="none"
                        />
                      ) : null}
                      <circle
                        cx={point.x}
                        cy={point.houseY}
                        r={houseChartHoveredPoint?.index === point.index ? 5 : 2.5}
                        fill="rgb(51 65 85)"
                        opacity={selectionBounds ? 0.25 : 1}
                        className="transition-opacity duration-300 dark:fill-slate-300"
                        pointerEvents="none"
                      />
                    </g>
                  ))}
                  {selectionBounds ? (
                    <g clipPath="url(#selection-clip)">
                      {houseChart.stockPath ? (
                        <path
                          d={houseChart.stockPath}
                          fill="none"
                          stroke="rgb(245 158 11)"
                          strokeWidth="3.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      ) : null}
                      {houseChart.projectedStockPath ? (
                        <path
                          d={houseChart.projectedStockPath}
                          fill="none"
                          stroke="rgb(16 185 129)"
                          strokeWidth="3.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      ) : null}
                      {houseChart.housePath ? (
                        <path
                          d={houseChart.housePath}
                          fill="none"
                          stroke="rgb(51 65 85)"
                          strokeWidth="3.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="dark:stroke-slate-300"
                        />
                      ) : null}
                      {houseChart.points.map((point) => {
                        const highlighted = point.index >= selectionBounds.startIndex && point.index <= selectionBounds.endIndex;
                        if (!highlighted) {
                          return null;
                        }
                        return (
                          <g key={`hi-${point.date}`}>
                            {point.stockY !== null ? (
                              <circle
                                cx={point.x}
                                cy={point.stockY}
                                r={houseChartHoveredPoint?.index === point.index ? 5.5 : 4.5}
                                fill="rgb(245 158 11)"
                                stroke="rgb(255 255 255)"
                                strokeWidth="1.5"
                                className="dark:stroke-zinc-900"
                                pointerEvents="none"
                              />
                            ) : null}
                            {point.projectedStockY !== null ? (
                              <circle
                                cx={point.x}
                                cy={point.projectedStockY}
                                r={houseChartHoveredPoint?.index === point.index ? 5.5 : 4.5}
                                fill="rgb(16 185 129)"
                                stroke="rgb(255 255 255)"
                                strokeWidth="1.5"
                                className="dark:stroke-zinc-900"
                                pointerEvents="none"
                              />
                            ) : null}
                            <circle
                              cx={point.x}
                              cy={point.houseY}
                              r={houseChartHoveredPoint?.index === point.index ? 5.5 : 4.5}
                              fill="rgb(51 65 85)"
                              stroke="rgb(255 255 255)"
                              strokeWidth="1.5"
                              className="dark:stroke-slate-300"
                              pointerEvents="none"
                            />
                          </g>
                        );
                      })}
                    </g>
                  ) : null}
                  {houseChartHoveredPoint ? (
                    <g pointerEvents="none">
                      <line
                        x1={houseChartHoveredPoint.x}
                        y1={houseChart.padding.top}
                        x2={houseChartHoveredPoint.x}
                        y2={houseChart.padding.top + houseChart.plotHeight}
                        stroke="rgba(51, 65, 85, 0.35)"
                        strokeDasharray="4 4"
                      />
                      {houseChartHoveredPoint.stockY !== null ? (
                        <circle
                          cx={houseChartHoveredPoint.x}
                          cy={houseChartHoveredPoint.stockY}
                          r={6}
                          fill="rgb(245 158 11)"
                          stroke="rgb(255 255 255)"
                          strokeWidth="2"
                          className="dark:stroke-zinc-900"
                        />
                      ) : null}
                      {houseChartHoveredPoint.projectedStockY !== null ? (
                        <circle
                          cx={houseChartHoveredPoint.x}
                          cy={houseChartHoveredPoint.projectedStockY}
                          r={6}
                          fill="rgb(16 185 129)"
                          stroke="rgb(255 255 255)"
                          strokeWidth="2"
                          className="dark:stroke-zinc-900"
                        />
                      ) : null}
                      <circle
                        cx={houseChartHoveredPoint.x}
                        cy={houseChartHoveredPoint.houseY}
                        r={6}
                        fill="rgb(51 65 85)"
                        stroke="rgb(255 255 255)"
                        strokeWidth="2"
                        className="dark:fill-slate-300 dark:stroke-zinc-900"
                      />
                      <g
                        transform={`translate(${clamp(houseChartHoveredPoint.x - 90, houseChart.padding.left, houseChart.width - houseChart.padding.right - 180)}, ${
                          Math.min(
                            houseChartHoveredPoint.stockY ?? houseChartHoveredPoint.houseY,
                            houseChartHoveredPoint.houseY,
                          ) < houseChart.padding.top + 74
                            ? Math.max(
                                houseChartHoveredPoint.stockY ?? houseChartHoveredPoint.houseY,
                                houseChartHoveredPoint.houseY,
                              ) + 16
                            : Math.min(
                                houseChartHoveredPoint.stockY ?? houseChartHoveredPoint.houseY,
                                houseChartHoveredPoint.houseY,
                              ) - 76
                        })`}
                      >
                        <rect
                          width="180"
                          height={houseChartHoveredPoint.projectedStockValue !== null ? "80" : "66"}
                          rx="10"
                          fill="rgba(24, 24, 27, 0.92)"
                          className="dark:fill-zinc-950/95"
                        />
                        <text x="12" y="17" fontSize="11" fill="white" opacity="0.9">
                          {formatDate(houseChartHoveredPoint.date)}
                        </text>
                        <text x="12" y="31" fontSize="12" fill="white" fontWeight="700">
                          Stock: {formatNumber(houseChartHoveredPoint.stockValue)}
                        </text>
                        {houseChartHoveredPoint.projectedStockValue !== null ? (
                          <text x="12" y="45" fontSize="12" fill="white" fontWeight="700">
                            Projected: {formatNumber(houseChartHoveredPoint.projectedStockValue)}
                          </text>
                        ) : null}
                        <text x="12" y={houseChartHoveredPoint.projectedStockValue !== null ? "59" : "45"} fontSize="12" fill="white" fontWeight="700">
                          Remaining starts: {formatNumber(houseChartHoveredPoint.remainingHouseStarts, 0)}
                        </text>
                        <text x="12" y={houseChartHoveredPoint.projectedStockValue !== null ? "73" : "59"} fontSize="12" fill="white" fontWeight="700">
                          Starts today: {formatNumber(houseChartHoveredPoint.house_starts, 0)}
                        </text>
                      </g>
                    </g>
                  ) : null}
                  <text x={houseChart.padding.left} y={houseChart.height - 8} fontSize="11" fill="currentColor" opacity="0.55">
                    {formatDate(houseChart.points[0]?.date)}
                  </text>
                  <text x={houseChart.width - houseChart.padding.right} y={houseChart.height - 8} textAnchor="end" fontSize="11" fill="currentColor" opacity="0.55">
                    {formatDate(houseChart.points[houseChart.points.length - 1]?.date)}
                  </text>
                </svg>
              ) : (
                <div className="absolute inset-0 flex items-center justify-center text-sm text-zinc-500">No house-start data available for this range and house type.</div>
              )}
          </div>

          <MovementBreakdownList
            movements={filteredHouseMovementDetails}
            loading={!history && !historyError}
            rangeStart={activeMovementRangeStart}
            rangeEnd={activeMovementRangeEnd}
            unitLabel={selectedUnitLabel}
          />
        </div>

        <div className="p-6 md:p-8 bg-zinc-50/50 dark:bg-white/[0.02] flex flex-col gap-6">
          <div>
            <h3 className="text-[10px] font-bold uppercase tracking-[0.25em] text-zinc-500 mb-4">Procurement Metrics</h3>
            <div className="space-y-3">
              <MetricRow label="Mov. 60d" value={formatNumber(selected.movement_quantity_60d)} />
              <MetricRow label="Pend. OC" value={detail ? formatNumber(detail.pending_purchase_quantity) : detailLoading ? "..." : "—"} />
              <MetricRow label="Reorden 30d" value={detail ? formatDate(selectedReorderDateRecentRate) : detailLoading ? "..." : "—"} />
              <MetricRow label="Mov. 30d" value={detail ? formatNumber(detail.movement_quantity_30d) : detailLoading ? "..." : "—"} />
              <MetricRow
                label="Lead time"
                value={
                  !detail ? (detailLoading ? "..." : "—") : isEditingLeadTimeMode ? (
                    <select
                      autoFocus
                      value={leadTimeMode}
                      onChange={(event) => onLeadTimeModeChange(event.target.value as LeadTimeMode)}
                      onBlur={() => setIsEditingLeadTimeMode(false)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === "Escape") {
                          setIsEditingLeadTimeMode(false);
                        }
                      }}
                      className="rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-zinc-900 px-2 py-1 text-sm font-semibold text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-400/50"
                    >
                      <option value="worst">Worst</option>
                      <option value="median">Median</option>
                      <option value="average">Average</option>
                    </select>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setIsEditingLeadTimeMode(true)}
                      className="rounded-lg px-2 py-1 -mx-2 text-sm font-semibold text-zinc-900 dark:text-white hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                      title="Click to choose the lead time metric used on this page"
                    >
                      {leadTimeReference ? `${formatNumber(leadTimeReference.days, getLeadTimeDigits(leadTimeReference.source))} d` : "—"}
                      <span className="ml-2 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">
                        {getLeadTimeModeLabel(leadTimeMode)}
                      </span>
                    </button>
                  )
                }
              />
              <MetricRow
                label="Buffer sem."
                value={
                  isEditingBufferWeeks ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min="0"
                        step="0.5"
                        autoFocus
                        value={bufferWeeksInput}
                        onChange={(event) => setBufferWeeksInput(event.target.value)}
                        onBlur={() => setIsEditingBufferWeeks(false)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === "Escape") {
                            setIsEditingBufferWeeks(false);
                          }
                        }}
                        className="w-24 rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-zinc-900 px-2 py-1 text-right text-sm font-semibold text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-400/50"
                      />
                      <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">weeks</span>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setIsEditingBufferWeeks(true)}
                      className="rounded-lg px-2 py-1 -mx-2 text-sm font-semibold text-zinc-900 dark:text-white hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                      title="Click to edit stock buffer in weeks"
                    >
                      {formatNumber(bufferWeeks)}
                      <span className="ml-2 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">weeks</span>
                    </button>
                  )
                }
              />
              <MetricRow
                label="Min. stock calc."
                value={purchaseOrderEstimate ? formatNumber(purchaseOrderEstimate.minimumExpectedStock) : "—"}
              />
              <MetricRow
                label="Cons. usada"
                value={
                  purchaseOrderEstimate
                    ? `${formatNumber(purchaseOrderEstimate.rateUsed)} / d${purchaseOrderEstimate.rateSource === "selection" ? " sel." : ""}`
                    : "—"
                }
              />
              <MetricRow
                label="Nueva OC"
                value={
                  purchaseOrderEstimate ? (
                    <span className={getPurchaseOrderUrgencyClasses(purchaseOrderEstimate.purchaseOrderDate)}>
                      {formatDate(purchaseOrderEstimate.purchaseOrderDate)}
                    </span>
                  ) : "—"
                }
              />
              <MetricRow label="Llega al min." value={purchaseOrderEstimate ? formatDate(purchaseOrderEstimate.thresholdDate) : "—"} />
              <MetricRow
                label="Cons. est./sem"
                value={
                  estimatedConsumptionPurchaseOrderEstimate
                    ? `${formatNumber(estimatedConsumptionPurchaseOrderEstimate.estimatedConsumptionPerWeek)}${estimatedConsumptionPurchaseOrderEstimate.rateSource === "selection" ? " sel." : ""}`
                    : "—"
                }
              />
              <MetricRow
                label="Min. est. calc."
                value={estimatedConsumptionPurchaseOrderEstimate ? formatNumber(estimatedConsumptionPurchaseOrderEstimate.minimumExpectedStock) : "—"}
              />
              <MetricRow
                label="Nueva OC est."
                value={
                  estimatedConsumptionPurchaseOrderEstimate ? (
                    <span className={getPurchaseOrderUrgencyClasses(estimatedConsumptionPurchaseOrderEstimate.purchaseOrderDate)}>
                      {formatDate(estimatedConsumptionPurchaseOrderEstimate.purchaseOrderDate)}
                    </span>
                  ) : "—"
                }
              />
              <MetricRow
                label="Llega min. est."
                value={estimatedConsumptionPurchaseOrderEstimate ? formatDate(estimatedConsumptionPurchaseOrderEstimate.thresholdDate) : "—"}
              />
              <MetricRow label="Dias stock" value={detail ? formatNumber(detail.days_of_stock_30d) : detailLoading ? "..." : "—"} />
              <MetricRow label="Ult. OC" value={!groupSelection && detail ? formatDate(detail.last_purchase_order.date) : "—"} />
              <MetricRow label="No. OC" value={!groupSelection && detail ? detail.last_purchase_order.number || "—" : "—"} />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
});

export function MaterialDashboardPage({ canEditGroups = false }: { canEditGroups?: boolean }) {
  const [storedHousePreferences] = useState(() => getStoredHouseViewPreferences());
  const storedCecoPreferences = getStoredCecoFilterPreferences();
  const [cecos, setCecos] = useState<MaterialDashboardCeco[]>([]);
  const [projectsBoard, setProjectsBoard] = useState<ProjectsBoardData | null>(null);
  const [dashboardCache, setDashboardCache] = useState<Record<string, MaterialDashboardData>>({});
  const [detailCache, setDetailCache] = useState<Record<string, MaterialDashboardDetailData>>({});
  const [historyCache, setHistoryCache] = useState<Record<string, MaterialDashboardMovementData>>({});
  const [houseComparisonCache, setHouseComparisonCache] = useState<Record<string, MaterialDashboardHouseComparisonData>>({});
  const [groupListCache, setGroupListCache] = useState<Record<string, MaterialStudyGroupListResponse>>({});
  const [groupDetailCache, setGroupDetailCache] = useState<Record<string, MaterialDashboardGroupDetailData>>({});
  const [groupHistoryCache, setGroupHistoryCache] = useState<Record<string, MaterialDashboardGroupMovementData>>({});
  const [groupHouseComparisonCache, setGroupHouseComparisonCache] = useState<Record<string, MaterialDashboardGroupHouseComparisonData>>({});
  const [houseTypes, setHouseTypes] = useState<MaterialDashboardHouseType[]>([]);
  const [cecoFilterMode, setCecoFilterMode] = useState<CecoFilterMode>(storedCecoPreferences?.mode ?? "exclude");
  const [selectedCecos, setSelectedCecos] = useState<string[]>(storedCecoPreferences?.cecos ?? []);
  const [activeTab, setActiveTab] = useState<"materials" | "groups" | "cecos">("materials");
  const [cecoSearch, setCecoSearch] = useState("");
  const [materialSearchInput, setMaterialSearchInput] = useState("");
  const [materialSearch, setMaterialSearch] = useState("");
  const [sort, setSort] = useState<SortState>({ key: "last_movement_date", direction: -1 });
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [groupEditorOpen, setGroupEditorOpen] = useState(false);
  const [selectedHouseTypeId, setSelectedHouseTypeId] = useState<number | null>(
    () => storedHousePreferences?.selectedHouseTypeId ?? null,
  );
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(
    () => storedHousePreferences?.selectedProjectId ?? null,
  );
  const [leadTimeMode, setLeadTimeMode] = useState<LeadTimeMode>(() => storedHousePreferences?.leadTimeMode ?? "worst");
  const [houseRange, setHouseRange] = useState<HouseRange>(() => {
    return clampHouseRange(storedHousePreferences?.houseRange || getDefaultHouseRange());
  });
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [houseComparisonLoading, setHouseComparisonLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [houseComparisonError, setHouseComparisonError] = useState<string | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [visibleMaterialCount, setVisibleMaterialCount] = useState(LIST_PAGE_SIZE);
  const [visibleCecoCount, setVisibleCecoCount] = useState(LIST_PAGE_SIZE);
  const deferredMaterialSearch = useDeferredValue(materialSearch);
  const cecoRefreshNonceRef = useRef(0);
  const dashboardRefreshNonceRef = useRef(0);
  const detailRefreshNonceRef = useRef(0);
  const historyRefreshNonceRef = useRef(0);
  const houseComparisonRefreshNonceRef = useRef(0);
  const groupListRefreshNonceRef = useRef(0);
  const groupDetailRefreshNonceRef = useRef(0);
  const groupHistoryRefreshNonceRef = useRef(0);
  const groupHouseComparisonRefreshNonceRef = useRef(0);
  const normalizedSelectedCecoCodes = normalizeCecos(selectedCecos);
  const selectedCecoSet = useMemo(() => new Set(normalizedSelectedCecoCodes), [normalizedSelectedCecoCodes]);
  const cecoNameByCode = useMemo(
    () => new Map(cecos.map((ceco) => [ceco.code, ceco.name])),
    [cecos],
  );
  const normalizedSelectedCecos =
    cecoFilterMode === "exclude"
      ? normalizeCecos(cecos.map((ceco) => ceco.code).filter((code) => !selectedCecoSet.has(code)))
      : normalizedSelectedCecoCodes;
  const cecoApiFilters = cecoFilterMode === "exclude" ? { excludedCecos: normalizedSelectedCecoCodes } : { cecos: normalizedSelectedCecoCodes };
  const allCecosExcluded = cecos.length > 0 && normalizedSelectedCecos.length === 0;
  const currentDashboardMovementDays = Math.max(
    Math.round(
      (toStartOfDay(houseRange.endDate).getTime() - toStartOfDay(houseRange.startDate).getTime()) / (1000 * 60 * 60 * 24),
    ) + 1,
    1,
  );
  const latestHistoryDate = toDateInputValue(moveToPreviousBusinessDay(new Date()));
  const selectedMaterialSku = selectedKey?.startsWith("material:") ? selectedKey.slice("material:".length) : null;
  const parsedSelectedGroupId = selectedKey?.startsWith("group:") ? Number(selectedKey.slice("group:".length)) : null;
  const selectedGroupId =
    parsedSelectedGroupId !== null && parsedSelectedGroupId !== undefined && Number.isFinite(parsedSelectedGroupId)
      ? parsedSelectedGroupId
      : null;
  const historyRequestRange = {
    startDate: houseRange.startDate,
    endDate: latestHistoryDate,
  };
  const currentDashboardKey = dashboardCacheKey(normalizedSelectedCecos, currentDashboardMovementDays);
  const currentGroupDashboardKey = groupDashboardCacheKey(normalizedSelectedCecos, currentDashboardMovementDays);
  const data = allCecosExcluded
    ? {
        materials: [],
        movement_window_days: currentDashboardMovementDays,
        ceco_filters: [],
        generated_at: "",
      }
    : dashboardCache[currentDashboardKey] || null;
  const groupData = allCecosExcluded
    ? {
        groups: [],
        movement_window_days: currentDashboardMovementDays,
        ceco_filters: [],
        generated_at: "",
      }
    : groupListCache[currentGroupDashboardKey] || null;
  const currentDetailKey = selectedMaterialSku ? detailCacheKey(selectedMaterialSku, normalizedSelectedCecos) : null;
  const selectedDetail = allCecosExcluded ? null : currentDetailKey ? detailCache[currentDetailKey] || null : null;
  const currentGroupDetailKey = selectedGroupId ? groupDetailCacheKey(selectedGroupId, normalizedSelectedCecos) : null;
  const selectedGroupDetail = allCecosExcluded ? null : currentGroupDetailKey ? groupDetailCache[currentGroupDetailKey] || null : null;
  const currentHistoryKey = selectedMaterialSku ? historyCacheKey(selectedMaterialSku, normalizedSelectedCecos, historyRequestRange) : null;
  const currentHistory = allCecosExcluded ? null : currentHistoryKey ? historyCache[currentHistoryKey] || null : null;
  const currentGroupHistoryKey = selectedGroupId ? groupHistoryCacheKey(selectedGroupId, normalizedSelectedCecos, historyRequestRange) : null;
  const currentGroupHistory = allCecosExcluded
    ? null
    : currentGroupHistoryKey
      ? groupHistoryCache[currentGroupHistoryKey] || null
      : null;
  const currentHouseComparisonKey =
    selectedMaterialSku && selectedHouseTypeId
      ? houseComparisonCacheKey(selectedMaterialSku, selectedHouseTypeId, normalizedSelectedCecos, houseRange, selectedProjectId)
      : null;
  const currentHouseComparison = allCecosExcluded
    ? null
    : currentHouseComparisonKey
      ? houseComparisonCache[currentHouseComparisonKey] || null
      : null;
  const currentGroupHouseComparisonKey =
    selectedGroupId && selectedHouseTypeId
      ? groupHouseComparisonCacheKey(selectedGroupId, selectedHouseTypeId, normalizedSelectedCecos, houseRange, selectedProjectId)
      : null;
  const currentGroupHouseComparison = allCecosExcluded
    ? null
    : currentGroupHouseComparisonKey
      ? groupHouseComparisonCache[currentGroupHouseComparisonKey] || null
      : null;
  const selectedMaterialRow = (data?.materials || []).find((row) => row.sku === selectedMaterialSku) || null;
  const selectedGroupRow = (groupData?.groups || []).find((row) => row.group_id === selectedGroupId) || null;
  const selectedRow = selectedMaterialRow || selectedGroupRow;
  const selectedDetailLike = selectedMaterialRow ? selectedDetail : selectedGroupRow ? selectedGroupDetail : null;
  const selectedHistoryLike = selectedMaterialRow ? currentHistory : selectedGroupRow ? currentGroupHistory : null;
  const selectedHouseComparisonLike = selectedMaterialRow ? currentHouseComparison : selectedGroupRow ? currentGroupHouseComparison : null;
  const projectOptions = useMemo(
    () =>
      Object.values(projectsBoard?.grouped_projects || {})
        .flat()
        .filter((project) => project.status === "execution")
        .slice()
        .sort((left, right) => left.name.localeCompare(right.name)),
    [projectsBoard],
  );

  function syncSelectedMaterial(response: MaterialDashboardData) {
    setSelectedKey((current) => {
      if (current?.startsWith("material:")) {
        const currentSku = current.slice("material:".length);
        if (response.materials.some((row) => row.sku === currentSku)) {
          return current;
        }
      }
      return !current && response.materials[0] ? `material:${response.materials[0].sku}` : current;
    });
  }

  function syncSelectedGroup(response: MaterialStudyGroupListResponse) {
    setSelectedKey((current) => {
      if (current?.startsWith("group:")) {
        const currentGroupId = Number(current.slice("group:".length));
        if (response.groups.some((row) => row.group_id === currentGroupId)) {
          return current;
        }
      }
      if ((!current || activeTab === "groups") && response.groups[0]) {
        return `group:${response.groups[0].group_id}`;
      }
      return current;
    });
  }

  useEffect(() => {
    let cancelled = false;
    async function loadCostCenters() {
      const forceRefresh = refreshNonce > 0 && cecoRefreshNonceRef.current !== refreshNonce;
      if (forceRefresh) {
        cecoRefreshNonceRef.current = refreshNonce;
      }
      let hasCached = false;
      if (!forceRefresh) {
        const cached = await getMaterialDashboardCacheValue<MaterialDashboardCeco[]>(CECO_CACHE_KEY);
        if (cancelled) {
          return;
        }
        if (cached !== null) {
          hasCached = true;
          setCecos(cached);
        }
      }
      try {
        const response = await api.getMaterialDashboardCostCenters({ refresh: forceRefresh });
        if (!cancelled) {
          setCecos(response.cecos);
          void setMaterialDashboardCacheValue(CECO_CACHE_KEY, response.cecos);
        }
      } catch {
        if (!cancelled && !hasCached) {
          setCecos([]);
        }
      }
    }
    void loadCostCenters();
    return () => {
      cancelled = true;
    };
  }, [refreshNonce]);

  useEffect(() => {
    if (!cecos.length) {
      return;
    }
    const availableCodes = new Set(cecos.map((ceco) => ceco.code));
    setSelectedCecos((current) => {
      const next = normalizeCecos(current.filter((code) => availableCodes.has(code)));
      if (next.length === current.length && next.every((code, index) => code === current[index])) {
        return current;
      }
      return next;
    });
  }, [cecos]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(
      CECO_FILTER_PREFERENCES_KEY,
      JSON.stringify({
        mode: cecoFilterMode,
        cecos: normalizedSelectedCecoCodes,
      }),
    );
  }, [cecoFilterMode, normalizedSelectedCecoCodes]);

  useEffect(() => {
    let cancelled = false;
    async function loadHouseTypes() {
      try {
        const response = await api.getMaterialDashboardHouseTypes();
        if (cancelled) {
          return;
        }
        setHouseTypes(response.house_types);
      } catch {
        if (!cancelled) {
          setHouseTypes([]);
          setSelectedHouseTypeId(null);
        }
      }
    }
    void loadHouseTypes();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadProjects() {
      try {
        const response = await api.getProjects();
        if (!cancelled) {
          setProjectsBoard(response);
        }
      } catch {
        if (!cancelled) {
          setProjectsBoard({ grouped_projects: {}, status_labels: {} });
          setSelectedProjectId(null);
        }
      }
    }
    void loadProjects();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadDashboard() {
      if (allCecosExcluded) {
        setError(null);
        setLoading(false);
        return;
      }
      const forceRefresh = refreshNonce > 0 && dashboardRefreshNonceRef.current !== refreshNonce;
      if (forceRefresh) {
        dashboardRefreshNonceRef.current = refreshNonce;
      }
      let hasCached = false;
      setError(null);
      if (!forceRefresh) {
        const cached =
          dashboardCache[currentDashboardKey] || (await getMaterialDashboardCacheValue<MaterialDashboardData>(currentDashboardKey));
        if (cancelled) {
          return;
        }
        if (cached) {
          hasCached = true;
          setDashboardCache((current) => (current[currentDashboardKey] ? current : { ...current, [currentDashboardKey]: cached }));
          syncSelectedMaterial(cached);
          setLoading(false);
        }
      }
      if (!hasCached) {
        setLoading(true);
      }
      try {
        const response = await api.getMaterialDashboard(cecoApiFilters, {
          refresh: forceRefresh,
          movementDays: currentDashboardMovementDays,
        });
        if (cancelled) {
          return;
        }
        setDashboardCache((current) => ({ ...current, [currentDashboardKey]: response }));
        syncSelectedMaterial(response);
        void setMaterialDashboardCacheValue(currentDashboardKey, response);
      } catch (err) {
        if (cancelled) {
          return;
        }
        if (!hasCached) {
          setError(err instanceof ApiError ? err.message : "Could not load dashboard materials.");
          setSelectedKey((current) => (current?.startsWith("material:") ? null : current));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    void loadDashboard();
    return () => {
      cancelled = true;
    };
  }, [allCecosExcluded, currentDashboardKey, currentDashboardMovementDays, refreshNonce]);

  useEffect(() => {
    let cancelled = false;
    async function loadGroups() {
      if (allCecosExcluded) {
        return;
      }
      const forceRefresh = refreshNonce > 0 && groupListRefreshNonceRef.current !== refreshNonce;
      if (forceRefresh) {
        groupListRefreshNonceRef.current = refreshNonce;
      }
      let hasCached = false;
      if (!forceRefresh) {
        const cached =
          groupListCache[currentGroupDashboardKey] ||
          (await getMaterialDashboardCacheValue<MaterialStudyGroupListResponse>(currentGroupDashboardKey));
        if (cancelled) {
          return;
        }
        if (cached) {
          hasCached = true;
          setGroupListCache((current) =>
            current[currentGroupDashboardKey] ? current : { ...current, [currentGroupDashboardKey]: cached },
          );
          syncSelectedGroup(cached);
        }
      }
      try {
        const response = await api.getMaterialStudyGroups(cecoApiFilters, {
          movementDays: currentDashboardMovementDays,
          refresh: forceRefresh,
        });
        if (cancelled) {
          return;
        }
        setGroupListCache((current) => ({ ...current, [currentGroupDashboardKey]: response }));
        syncSelectedGroup(response);
        void setMaterialDashboardCacheValue(currentGroupDashboardKey, response);
      } catch (err) {
        if (!cancelled && !hasCached) {
          setError((current) => current || (err instanceof ApiError ? err.message : "Could not load material groups."));
        }
      }
    }
    void loadGroups();
    return () => {
      cancelled = true;
    };
  }, [allCecosExcluded, currentDashboardMovementDays, currentGroupDashboardKey, refreshNonce]);

  useEffect(() => {
    const sku = selectedMaterialSku;
    const cacheKey = sku ? detailCacheKey(sku, normalizedSelectedCecos) : null;
    if (allCecosExcluded || !sku || !cacheKey) {
      setHistoryError(null);
      setDetailLoading(false);
      return;
    }
    const activeSku = sku;
    const activeCacheKey = cacheKey;
    let cancelled = false;
    async function loadDetail() {
      const forceRefresh = refreshNonce > 0 && detailRefreshNonceRef.current !== refreshNonce;
      if (forceRefresh) {
        detailRefreshNonceRef.current = refreshNonce;
      }
      let hasCached = false;
      setHistoryError(null);
      if (!forceRefresh) {
        const cached = detailCache[activeCacheKey] || (await getMaterialDashboardCacheValue<MaterialDashboardDetailData>(activeCacheKey));
        if (cancelled) {
          return;
        }
        if (cached) {
          hasCached = true;
          setDetailCache((current) => (current[activeCacheKey] ? current : { ...current, [activeCacheKey]: cached }));
          setDetailLoading(false);
        }
      }
      if (!hasCached) {
        setDetailLoading(true);
      }
      try {
        const response = await api.getMaterialDashboardDetail(activeSku, cecoApiFilters, { refresh: forceRefresh });
        if (!cancelled) {
          setDetailCache((current) => ({ ...current, [activeCacheKey]: response }));
          void setMaterialDashboardCacheValue(activeCacheKey, response);
        }
      } catch (err) {
        if (!cancelled && !hasCached) {
          setHistoryError(err instanceof ApiError ? err.message : "Could not load material detail.");
        }
      } finally {
        if (!cancelled) {
          setDetailLoading(false);
        }
      }
    }
    void loadDetail();
    return () => {
      cancelled = true;
    };
  }, [allCecosExcluded, currentDetailKey, refreshNonce, selectedMaterialSku]);

  useEffect(() => {
    const groupId = selectedGroupId;
    const cacheKey = groupId ? groupDetailCacheKey(groupId, normalizedSelectedCecos) : null;
    if (allCecosExcluded || !groupId || !cacheKey) {
      return;
    }
    let cancelled = false;
    async function loadGroupDetail() {
      const forceRefresh = refreshNonce > 0 && groupDetailRefreshNonceRef.current !== refreshNonce;
      if (forceRefresh) {
        groupDetailRefreshNonceRef.current = refreshNonce;
      }
      let hasCached = false;
      setHistoryError(null);
      if (!forceRefresh) {
        const cached =
          groupDetailCache[cacheKey] || (await getMaterialDashboardCacheValue<MaterialDashboardGroupDetailData>(cacheKey));
        if (cancelled) {
          return;
        }
        if (cached) {
          hasCached = true;
          setGroupDetailCache((current) => (current[cacheKey] ? current : { ...current, [cacheKey]: cached }));
          setDetailLoading(false);
        }
      }
      if (!hasCached) {
        setDetailLoading(true);
      }
      try {
        const response = await api.getMaterialStudyGroupDetail(groupId, cecoApiFilters, { refresh: forceRefresh });
        if (!cancelled) {
          setGroupDetailCache((current) => ({ ...current, [cacheKey]: response }));
          void setMaterialDashboardCacheValue(cacheKey, response);
        }
      } catch (err) {
        if (!cancelled && !hasCached) {
          setHistoryError(err instanceof ApiError ? err.message : "Could not load material group detail.");
        }
      } finally {
        if (!cancelled) {
          setDetailLoading(false);
        }
      }
    }
    void loadGroupDetail();
    return () => {
      cancelled = true;
    };
  }, [allCecosExcluded, currentGroupDetailKey, refreshNonce, selectedGroupId]);

  useEffect(() => {
    if (!houseTypes.length) {
      return;
    }
    setSelectedHouseTypeId((current) =>
      current === null
        ? storedHousePreferences?.hasSelectedHouseTypePreference
          ? null
          : houseTypes[0].id
        : houseTypes.some((houseType) => houseType.id === current)
          ? current
          : houseTypes[0].id,
    );
  }, [houseTypes, storedHousePreferences?.hasSelectedHouseTypePreference]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(
      HOUSE_VIEW_PREFERENCES_KEY,
      JSON.stringify({
        selectedHouseTypeId,
        selectedProjectId,
        leadTimeMode,
        houseRange,
      }),
    );
  }, [houseRange, leadTimeMode, selectedHouseTypeId, selectedProjectId]);

  useEffect(() => {
    if (!projectsBoard) {
      return;
    }
    if (!selectedProjectId) {
      return;
    }
    if (projectOptions.some((project) => project.id === selectedProjectId)) {
      return;
    }
    setSelectedProjectId(null);
  }, [projectOptions, projectsBoard, selectedProjectId]);

  useEffect(() => {
    const sku = selectedMaterialSku;
    const cacheKey = sku ? historyCacheKey(sku, normalizedSelectedCecos, historyRequestRange) : null;
    if (allCecosExcluded || !sku || !cacheKey) {
      setHistoryError(null);
      setHistoryLoading(false);
      return;
    }
    const activeSku = sku;
    const activeCacheKey = cacheKey;
    let cancelled = false;
    async function loadHistory() {
      const forceRefresh = refreshNonce > 0 && historyRefreshNonceRef.current !== refreshNonce;
      if (forceRefresh) {
        historyRefreshNonceRef.current = refreshNonce;
      }
      let hasCached = false;
      setHistoryError(null);
      if (!forceRefresh) {
        const cached = historyCache[activeCacheKey] || (await getMaterialDashboardCacheValue<MaterialDashboardMovementData>(activeCacheKey));
        if (cancelled) {
          return;
        }
        if (cached) {
          hasCached = true;
          setHistoryCache((current) => (current[activeCacheKey] ? current : { ...current, [activeCacheKey]: cached }));
          setHistoryLoading(false);
        }
      }
      if (!hasCached) {
        setHistoryLoading(true);
      }
      try {
        const response = await api.getMaterialDashboardHistory(activeSku, cecoApiFilters, {
          refresh: forceRefresh,
          startDate: historyRequestRange?.startDate,
          endDate: historyRequestRange?.endDate,
        });
        if (!cancelled) {
          setHistoryCache((current) => ({ ...current, [activeCacheKey]: response }));
          void setMaterialDashboardCacheValue(activeCacheKey, response);
        }
      } catch (err) {
        if (!cancelled && !hasCached) {
          setHistoryError(err instanceof ApiError ? err.message : "Could not load movement history.");
        }
      } finally {
        if (!cancelled) {
          setHistoryLoading(false);
        }
      }
    }
    void loadHistory();
    return () => {
      cancelled = true;
    };
  }, [allCecosExcluded, currentHistoryKey, historyRequestRange?.endDate, historyRequestRange?.startDate, refreshNonce, selectedMaterialSku]);

  useEffect(() => {
    const groupId = selectedGroupId;
    const cacheKey = groupId ? groupHistoryCacheKey(groupId, normalizedSelectedCecos, historyRequestRange) : null;
    if (allCecosExcluded || !groupId || !cacheKey) {
      return;
    }
    let cancelled = false;
    async function loadGroupHistory() {
      const forceRefresh = refreshNonce > 0 && groupHistoryRefreshNonceRef.current !== refreshNonce;
      if (forceRefresh) {
        groupHistoryRefreshNonceRef.current = refreshNonce;
      }
      let hasCached = false;
      setHistoryError(null);
      if (!forceRefresh) {
        const cached =
          groupHistoryCache[cacheKey] || (await getMaterialDashboardCacheValue<MaterialDashboardGroupMovementData>(cacheKey));
        if (cancelled) {
          return;
        }
        if (cached) {
          hasCached = true;
          setGroupHistoryCache((current) => (current[cacheKey] ? current : { ...current, [cacheKey]: cached }));
          setHistoryLoading(false);
        }
      }
      if (!hasCached) {
        setHistoryLoading(true);
      }
      try {
        const response = await api.getMaterialStudyGroupHistory(groupId, cecoApiFilters, {
          refresh: forceRefresh,
          startDate: historyRequestRange?.startDate,
          endDate: historyRequestRange?.endDate,
        });
        if (!cancelled) {
          setGroupHistoryCache((current) => ({ ...current, [cacheKey]: response }));
          void setMaterialDashboardCacheValue(cacheKey, response);
        }
      } catch (err) {
        if (!cancelled && !hasCached) {
          setHistoryError(err instanceof ApiError ? err.message : "Could not load material group history.");
        }
      } finally {
        if (!cancelled) {
          setHistoryLoading(false);
        }
      }
    }
    void loadGroupHistory();
    return () => {
      cancelled = true;
    };
  }, [allCecosExcluded, currentGroupHistoryKey, historyRequestRange?.endDate, historyRequestRange?.startDate, refreshNonce, selectedGroupId]);

  useEffect(() => {
    const sku = selectedMaterialSku;
    const houseTypeId = selectedHouseTypeId;
    const cacheKey =
      sku && houseTypeId ? houseComparisonCacheKey(sku, houseTypeId, normalizedSelectedCecos, houseRange, selectedProjectId) : null;
    if (allCecosExcluded || !sku || !houseTypeId || !cacheKey) {
      setHouseComparisonError(null);
      setHouseComparisonLoading(false);
      return;
    }
    const activeSku = sku;
    const activeHouseTypeId = houseTypeId;
    const activeCacheKey = cacheKey;
    let cancelled = false;
    async function loadHouseComparison() {
      const forceRefresh = refreshNonce > 0 && houseComparisonRefreshNonceRef.current !== refreshNonce;
      if (forceRefresh) {
        houseComparisonRefreshNonceRef.current = refreshNonce;
      }
      let hasCached = false;
      setHouseComparisonError(null);
      if (!forceRefresh) {
        const cached =
          houseComparisonCache[activeCacheKey] ||
          (await getMaterialDashboardCacheValue<MaterialDashboardHouseComparisonData>(activeCacheKey));
        if (cancelled) {
          return;
        }
        if (cached) {
          hasCached = true;
          setHouseComparisonCache((current) =>
            current[activeCacheKey] ? current : { ...current, [activeCacheKey]: cached },
          );
          setHouseComparisonLoading(false);
        }
      }
      if (!hasCached) {
        setHouseComparisonLoading(true);
      }
      try {
        const response = await api.getMaterialDashboardHouseComparison(
          activeSku,
          activeHouseTypeId,
          cecoApiFilters,
          {
            refresh: forceRefresh,
            startDate: houseRange.startDate,
            endDate: houseRange.endDate,
            projectId: selectedProjectId,
          },
        );
        if (!cancelled) {
          setHouseComparisonCache((current) => ({ ...current, [activeCacheKey]: response }));
          void setMaterialDashboardCacheValue(activeCacheKey, response);
        }
      } catch (err) {
        if (!cancelled && !hasCached) {
          setHouseComparisonError(err instanceof ApiError ? err.message : "Could not load house-start comparison.");
        }
      } finally {
        if (!cancelled) {
          setHouseComparisonLoading(false);
        }
      }
    }
    void loadHouseComparison();
    return () => {
      cancelled = true;
    };
  }, [allCecosExcluded, currentHouseComparisonKey, houseRange.endDate, houseRange.startDate, refreshNonce, selectedHouseTypeId, selectedMaterialSku, selectedProjectId]);

  useEffect(() => {
    const groupId = selectedGroupId;
    const houseTypeId = selectedHouseTypeId;
    const cacheKey =
      groupId && houseTypeId
        ? groupHouseComparisonCacheKey(groupId, houseTypeId, normalizedSelectedCecos, houseRange, selectedProjectId)
        : null;
    if (allCecosExcluded || !groupId || !houseTypeId || !cacheKey) {
      setHouseComparisonLoading(false);
      return;
    }
    let cancelled = false;
    async function loadGroupHouseComparison() {
      const forceRefresh = refreshNonce > 0 && groupHouseComparisonRefreshNonceRef.current !== refreshNonce;
      if (forceRefresh) {
        groupHouseComparisonRefreshNonceRef.current = refreshNonce;
      }
      let hasCached = false;
      setHouseComparisonError(null);
      if (!forceRefresh) {
        const cached =
          groupHouseComparisonCache[cacheKey] ||
          (await getMaterialDashboardCacheValue<MaterialDashboardGroupHouseComparisonData>(cacheKey));
        if (cancelled) {
          return;
        }
        if (cached) {
          hasCached = true;
          setGroupHouseComparisonCache((current) => (current[cacheKey] ? current : { ...current, [cacheKey]: cached }));
          setHouseComparisonLoading(false);
        }
      }
      if (!hasCached) {
        setHouseComparisonLoading(true);
      }
      try {
        const response = await api.getMaterialStudyGroupHouseComparison(groupId, houseTypeId, cecoApiFilters, {
          refresh: forceRefresh,
          startDate: houseRange.startDate,
          endDate: houseRange.endDate,
          projectId: selectedProjectId,
        });
        if (!cancelled) {
          setGroupHouseComparisonCache((current) => ({ ...current, [cacheKey]: response }));
          void setMaterialDashboardCacheValue(cacheKey, response);
        }
      } catch (err) {
        if (!cancelled && !hasCached) {
          setHouseComparisonError(err instanceof ApiError ? err.message : "Could not load group house-start comparison.");
        }
      } finally {
        if (!cancelled) {
          setHouseComparisonLoading(false);
        }
      }
    }
    void loadGroupHouseComparison();
    return () => {
      cancelled = true;
    };
  }, [allCecosExcluded, currentGroupHouseComparisonKey, houseRange.endDate, houseRange.startDate, refreshNonce, selectedGroupId, selectedHouseTypeId, selectedProjectId]);

  const normalizedMaterialSearch = deferredMaterialSearch.trim().toLowerCase();
  const isMaterialSearchPending = materialSearchInput !== deferredMaterialSearch;
  const rows = useMemo(
    () =>
      (data?.materials || [])
        .filter((row) => {
          if (!normalizedMaterialSearch) {
            return true;
          }
          return row.material_name.toLowerCase().includes(normalizedMaterialSearch) || row.sku.toLowerCase().includes(normalizedMaterialSearch);
        })
        .slice()
        .sort((left, right) => compareRows(left, right, sort)),
    [data?.materials, normalizedMaterialSearch, sort],
  );
  const groupRows = useMemo(
    () =>
      (groupData?.groups || [])
        .filter((row) => {
          if (!normalizedMaterialSearch) {
            return true;
          }
          return row.material_name.toLowerCase().includes(normalizedMaterialSearch) || row.name.toLowerCase().includes(normalizedMaterialSearch);
        })
        .slice()
        .sort((left, right) => compareRows(left, right, sort)),
    [groupData?.groups, normalizedMaterialSearch, sort],
  );

  const filteredCecos = useMemo(() => {
    const term = cecoSearch.trim().toLowerCase();
    return cecos.filter((ceco) => {
      if (!term) {
        return true;
      }
      return ceco.code.toLowerCase().includes(term) || ceco.name.toLowerCase().includes(term);
    });
  }, [cecoSearch, cecos]);
  const shouldLimitMaterialRows = !normalizedMaterialSearch;
  const shouldLimitCecos = !cecoSearch.trim();
  const visibleMaterialRows = shouldLimitMaterialRows ? rows.slice(0, visibleMaterialCount) : rows;
  const visibleCecos = shouldLimitCecos ? filteredCecos.slice(0, visibleCecoCount) : filteredCecos;
  const hasMoreMaterialRows = shouldLimitMaterialRows && visibleMaterialRows.length < rows.length;
  const hasMoreCecos = shouldLimitCecos && visibleCecos.length < filteredCecos.length;

  function toggleSort(key: SortKey) {
    setSort((current) => (current.key === key ? { key, direction: current.direction === 1 ? -1 : 1 } : { key, direction: -1 }));
  }

  function toggleCecoSelection(code: string) {
    setSelectedCecos((current) =>
      normalizeCecos(current.includes(code) ? current.filter((item) => item !== code) : [...current, code]),
    );
  }

  function handleReload() {
    setRefreshNonce((current) => current + 1);
  }

  function handleMaterialSearchChange(value: string) {
    setMaterialSearchInput(value);
    startTransition(() => {
      setMaterialSearch(value);
    });
  }

  function maybeLoadMoreRows(
    element: HTMLDivElement,
    visibleCount: number,
    totalCount: number,
    setVisibleCount: (updater: (current: number) => number) => void,
  ) {
    if (visibleCount >= totalCount) {
      return;
    }
    if (element.scrollTop + element.clientHeight < element.scrollHeight - 120) {
      return;
    }
    setVisibleCount((current) => Math.min(current + LIST_PAGE_SIZE, totalCount));
  }

  function handleResetCecoFilter() {
    setCecoFilterMode("exclude");
    setSelectedCecos([]);
  }

  function handleGroupEditorChanged(groupId: number | null) {
    setRefreshNonce((current) => current + 1);
    if (groupId) {
      setSelectedKey(`group:${groupId}`);
      setActiveTab("groups");
    }
  }

  useEffect(() => {
    if (activeTab === "materials" && !selectedMaterialRow && rows[0]) {
      setSelectedKey(`material:${rows[0].sku}`);
    }
    if (activeTab === "groups" && !selectedGroupRow && groupRows[0]) {
      setSelectedKey(`group:${groupRows[0].group_id}`);
    }
  }, [activeTab, groupRows, rows, selectedGroupRow, selectedMaterialRow]);

  useEffect(() => {
    setVisibleMaterialCount(LIST_PAGE_SIZE);
  }, [currentDashboardKey, normalizedMaterialSearch, sort.direction, sort.key]);

  useEffect(() => {
    setVisibleCecoCount(LIST_PAGE_SIZE);
  }, [cecoFilterMode, cecoSearch, cecos.length]);

  return (
    <div className="absolute inset-0 top-16 flex flex-col xl:flex-row overflow-hidden bg-zinc-50 dark:bg-zinc-950/40 z-30">
      
      {/* Panel 1: Sidebar with Tabs */}
      <section className="w-full xl:w-[420px] 2xl:w-[480px] flex-shrink-0 flex flex-col border-r border-black/10 dark:border-white/10 bg-white/60 dark:bg-white/[0.01]">
        
        {/* Header and Tabs */}
        <div className="p-4 lg:p-6 pb-0 border-b border-black/5 dark:border-white/5 flex flex-col gap-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.35em] text-zinc-500 mb-2">Filters</p>
            <div className="flex items-end justify-between mb-4">
              <h2 className="text-lg font-bold text-zinc-900 dark:text-white">ERP Activity</h2>
              <div className="text-xs text-zinc-500">Updated: {formatDate(activeTab === "groups" ? groupData?.generated_at : data?.generated_at)}</div>
            </div>
          </div>

          <div className="flex gap-4 border-b border-black/10 dark:border-white/10 px-2">
            <button
              type="button"
              onClick={() => setActiveTab("materials")}
              className={`pb-3 text-sm font-semibold transition-colors relative ${activeTab === "materials" ? "text-accent-600 dark:text-accent-400" : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"}`}
            >
              Materials
              {activeTab === "materials" ? (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent-500 rounded-t-full" />
              ) : null}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("groups")}
              className={`pb-3 text-sm font-semibold transition-colors relative ${activeTab === "groups" ? "text-accent-600 dark:text-accent-400" : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"}`}
            >
              Groups
              {activeTab === "groups" ? (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent-500 rounded-t-full" />
              ) : null}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("cecos")}
              className={`pb-3 text-sm font-semibold transition-colors relative flex items-center gap-2 ${activeTab === "cecos" ? "text-accent-600 dark:text-accent-400" : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"}`}
            >
              Cost Centers
              {normalizedSelectedCecoCodes.length > 0 ? (
                <span className="bg-accent-100 dark:bg-accent-500/20 text-accent-700 dark:text-accent-400 text-[10px] px-1.5 py-0.5 rounded-full">
                  {normalizedSelectedCecoCodes.length}
                </span>
              ) : null}
              {activeTab === "cecos" ? (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent-500 rounded-t-full" />
              ) : null}
            </button>
          </div>
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {activeTab === "materials" ? (
            <div className="flex-1 flex flex-col min-h-0">
              <div className="p-4 lg:p-6 border-b border-black/5 dark:border-white/5 space-y-3">
                <SidebarSearchInput
                  value={materialSearchInput}
                  pending={isMaterialSearchPending}
                  placeholder="SKU or material name"
                  onChange={handleMaterialSearchChange}
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleReload}
                    className="flex-1 rounded-xl bg-accent-500 text-zinc-950 font-semibold text-sm px-4 py-2 hover:bg-accent-400 transition-colors shadow-sm"
                  >
                    Reload
                  </button>
                  <button
                    type="button"
                    onClick={handleResetCecoFilter}
                    className="rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-white/5 text-sm font-medium px-4 py-2 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-white/10 transition-colors shadow-sm"
                  >
                    Reset CECO Filter
                  </button>
                </div>
                {error ? <div className="mt-1 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div> : null}
                {historyError ? <div className="mt-1 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{historyError}</div> : null}
                {houseComparisonError ? (
                  <div className="mt-1 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{houseComparisonError}</div>
                ) : null}
              </div>

              <div
                className="flex-1 overflow-y-auto"
                onScroll={(event) =>
                  maybeLoadMoreRows(event.currentTarget, visibleMaterialRows.length, rows.length, setVisibleMaterialCount)
                }
              >
                <MaterialResultsList
                  loading={loading}
                  rows={visibleMaterialRows}
                  hasMore={hasMoreMaterialRows}
                  selectedMaterialSku={selectedMaterialSku}
                  onSelect={setSelectedKey}
                />
              </div>
            </div>
          ) : activeTab === "groups" ? (
            <div className="flex-1 flex flex-col min-h-0">
              <div className="p-4 lg:p-6 border-b border-black/5 dark:border-white/5 space-y-3">
                <SidebarSearchInput
                  value={materialSearchInput}
                  pending={isMaterialSearchPending}
                  placeholder="Group name"
                  onChange={handleMaterialSearchChange}
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleReload}
                    className="flex-1 rounded-xl bg-accent-500 text-zinc-950 font-semibold text-sm px-4 py-2 hover:bg-accent-400 transition-colors shadow-sm"
                  >
                    Reload
                  </button>
                  {canEditGroups ? (
                    <button
                      type="button"
                      onClick={() => setGroupEditorOpen(true)}
                      className="rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-white/5 text-sm font-medium px-4 py-2 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-white/10 transition-colors shadow-sm"
                    >
                      Manage Groups
                    </button>
                  ) : null}
                </div>
                {error ? <div className="mt-1 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div> : null}
                {historyError ? <div className="mt-1 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{historyError}</div> : null}
                {houseComparisonError ? (
                  <div className="mt-1 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{houseComparisonError}</div>
                ) : null}
              </div>

              <div className="flex-1 overflow-y-auto">
                <GroupResultsList rows={groupRows} selectedGroupId={selectedGroupId} onSelect={setSelectedKey} />
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col min-h-0">
              <div className="p-4 lg:p-6 border-b border-black/5 dark:border-white/5 space-y-4">
                <input
                  value={cecoSearch}
                  onChange={(event) => setCecoSearch(event.target.value)}
                  className="w-full rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-black/20 px-4 py-2.5 text-sm text-zinc-900 dark:text-white outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500 transition-colors"
                  placeholder="Search CECO..."
                />

                <div className="rounded-2xl border border-black/10 dark:border-white/10 bg-zinc-50 dark:bg-white/5 p-1">
                  <div className="grid grid-cols-2 gap-1">
                    <button
                      type="button"
                      onClick={() => setCecoFilterMode("exclude")}
                      className={`rounded-xl px-3 py-2 text-xs font-semibold transition-colors ${
                        cecoFilterMode === "exclude"
                          ? "bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white shadow-sm"
                          : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
                      }`}
                    >
                      All But Selected
                    </button>
                    <button
                      type="button"
                      onClick={() => setCecoFilterMode("include")}
                      className={`rounded-xl px-3 py-2 text-xs font-semibold transition-colors ${
                        cecoFilterMode === "include"
                          ? "bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white shadow-sm"
                          : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
                      }`}
                    >
                      Only Selected
                    </button>
                  </div>
                </div>

                <p className="text-xs leading-5 text-zinc-500">
                  {cecoFilterMode === "exclude"
                    ? "Select CECOs to hide them from the dashboard."
                    : "Select the only CECOs that should remain visible in the dashboard."}
                </p>

                {normalizedSelectedCecoCodes.length > 0 ? (
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-2">
                      {cecoFilterMode === "exclude" ? "Hidden" : "Included"}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {normalizedSelectedCecoCodes.map((code) => (
                        <button
                          key={code}
                          type="button"
                          onClick={() => toggleCecoSelection(code)}
                          className={`rounded-lg px-2 py-1 text-xs font-semibold transition-colors flex items-center gap-1 ${
                            cecoFilterMode === "exclude"
                              ? "border border-rose-500/30 bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-500/20"
                              : "border border-accent-500/30 bg-accent-50 dark:bg-accent-500/10 text-accent-700 dark:text-accent-300 hover:bg-accent-100 dark:hover:bg-accent-500/20"
                          }`}
                        >
                          {cecoNameByCode.get(code) || code}
                          <svg className="w-3 h-3 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>

              <div
                className="flex-1 overflow-y-auto px-2 lg:px-4 py-2"
                onScroll={(event) =>
                  maybeLoadMoreRows(event.currentTarget, visibleCecos.length, filteredCecos.length, setVisibleCecoCount)
                }
              >
                <CecoResultsList
                  rows={visibleCecos}
                  hasMore={hasMoreCecos}
                  selectedCecoSet={selectedCecoSet}
                  cecoFilterMode={cecoFilterMode}
                  onToggle={toggleCecoSelection}
                />
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Panel 2: Graph and Metrics */}
      <main className="flex-1 min-w-0 bg-white dark:bg-zinc-950 flex flex-col h-full relative overflow-hidden">
        <MovementHistoryCard
          selected={selectedRow}
          detail={selectedDetailLike}
          history={selectedHistoryLike}
          houseTypes={houseTypes}
          projects={projectOptions}
          selectedHouseTypeId={selectedHouseTypeId}
          selectedProjectId={selectedProjectId}
          leadTimeMode={leadTimeMode}
          onSelectHouseType={setSelectedHouseTypeId}
          onSelectProject={setSelectedProjectId}
          onLeadTimeModeChange={setLeadTimeMode}
          houseRange={houseRange}
          onHouseRangeChange={setHouseRange}
          houseComparison={selectedHouseComparisonLike}
          detailLoading={detailLoading}
          historyLoading={historyLoading}
          houseComparisonLoading={houseComparisonLoading}
          detailRefreshing={detailLoading && Boolean(selectedDetailLike)}
          historyRefreshing={historyLoading && Boolean(selectedHistoryLike)}
          houseComparisonRefreshing={houseComparisonLoading && Boolean(selectedHouseComparisonLike)}
          historyError={historyError}
          houseComparisonError={houseComparisonError}
        />
      </main>
      {canEditGroups ? (
        <MaterialStudyGroupEditor
          open={groupEditorOpen}
          groups={groupData?.groups || []}
          onClose={() => setGroupEditorOpen(false)}
          onChanged={handleGroupEditorChanged}
        />
      ) : null}
    </div>
  );
}

function SortableHeader({
  label,
  active,
  direction,
  onClick,
}: {
  label: string;
  active: boolean;
  direction: 1 | -1;
  onClick: () => void;
}) {
  return (
    <th className="px-4 py-3 text-left font-semibold">
      <button type="button" onClick={onClick} className="inline-flex items-center gap-2">
        <span>{label}</span>
        <span className={`text-xs ${active ? "opacity-100" : "opacity-35"}`}>{direction === 1 ? "↑" : "↓"}</span>
      </button>
    </th>
  );
}
