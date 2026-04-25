import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type SetStateAction,
} from "react";

import { Modal } from "../components/Modal";
import { ApiError, api } from "../lib/api";
import { getMaterialDashboardCacheValue, setMaterialDashboardCacheValue } from "../lib/materialDashboardCache";
import {
  HOUSE_TYPES_CACHE_KEY,
  detailCacheKey,
  economicMetricsCacheKey,
  historyCacheKey,
  houseComparisonCacheKey,
} from "../lib/materialDashboardCacheKeys";
import type {
  CostModelAdjustment,
  CostModelRow,
  CostModelView,
  MaterialDashboardDetailData,
  MaterialDashboardEconomicMetricsResponse,
  MaterialDashboardHouseComparisonData,
  MaterialDashboardHouseType,
  MaterialDashboardMaterialStudyData,
  MaterialDashboardMovementData,
  MaterialDashboardMovementPoint,
  ProjectSummary,
  ProjectsBoardData,
  SessionUser,
} from "../lib/types";

type CostModelPageProps = {
  projectId: number | null;
  onNavigate: (to: string, replace?: boolean) => void;
  onTitleChange?: (title: string) => void;
  currentUser: SessionUser;
};

type ConsumptionSelection = {
  sku: string;
  subtypeId: number | null;
};

type CostModelSortKey = "sku" | "material_name" | "price" | "quantity" | "usage_delta" | "cost" | `subtype:${string}`;

type CostModelSortState = {
  key: CostModelSortKey;
  direction: 1 | -1;
};

type ConsumptionTarget = {
  row: CostModelRow;
  subtypeId: number | null;
};

type HouseRange = {
  startDate: string;
  endDate: string;
};

type ChartSelection = {
  startIndex: number;
  endIndex: number;
};

type StockSeriesPoint = {
  date: string;
  value: number;
  time: number;
};

type HouseTrendChartPoint = MaterialDashboardHouseComparisonData["points"][number] & {
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

type HouseChartData = {
  width: number;
  height: number;
  padding: { top: number; right: number; bottom: number; left: number };
  plotWidth: number;
  plotHeight: number;
  maxStock: number;
  minStock: number;
  maxRemainingHouseStarts: number;
  points: HouseTrendChartPoint[];
  stockPath: string;
  projectedStockPath: string;
  housePath: string;
};

type HouseRangeSummary = {
  start: HouseTrendChartPoint;
  end: HouseTrendChartPoint;
  elapsedDays: number;
  stockDelta: number | null;
  materialConsumed: number;
  projectedMaterialConsumed: number;
  housesProduced: number;
  averageConsumptionPerHouse: number | null;
  averageProjectedConsumptionPerBusinessDay: number | null;
  averageProjectedConsumptionPerWeek: number | null;
};

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_HOUSE_RANGE_DAYS = 90;
const CHART_WIDTH = 1200;
const CHART_HEIGHT = 220;
const COST_MODEL_PREFERENCES_KEY = "cost-model::preferences";

const numberFormatter = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 2 });
const integerFormatter = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 0 });
const currencyFormatter = new Intl.NumberFormat("es-CL", {
  style: "currency",
  currency: "CLP",
  maximumFractionDigits: 0,
});
const percentFormatter = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 1 });
const DEFAULT_SORT_STATE: CostModelSortState = { key: "sku", direction: 1 };

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

function formatNumber(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "—";
  }
  return digits === 0 ? integerFormatter.format(value) : numberFormatter.format(value);
}

function formatCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "—";
  }
  return currencyFormatter.format(value);
}

function formatPercent(value: number | null | undefined): string {
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

function parseNumberInput(raw: string): number | null {
  if (!raw.trim()) {
    return null;
  }
  const normalized = raw.replace(/\./g, "").replace(",", ".");
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return parsed;
}

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

function getStoredCostModelPreferences() {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(COST_MODEL_PREFERENCES_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as { selectedHouseTypeId?: number | null; houseRange?: Partial<HouseRange> | null };
    const storedRange =
      parsed.houseRange &&
      typeof parsed.houseRange.startDate === "string" &&
      typeof parsed.houseRange.endDate === "string"
        ? clampHouseRange({
            startDate: parsed.houseRange.startDate,
            endDate: parsed.houseRange.endDate,
          })
        : null;
    return {
      selectedHouseTypeId:
        typeof parsed.selectedHouseTypeId === "number" && Number.isFinite(parsed.selectedHouseTypeId)
          ? parsed.selectedHouseTypeId
          : null,
      houseRange: storedRange,
    };
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

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

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

function findAggregateAdjustment(row: CostModelRow): CostModelAdjustment | null {
  return row.adjustments.find((adj) => adj.subtype_id === null) ?? null;
}

function findSubtypeAdjustment(row: CostModelRow, subtypeId: number | null): CostModelAdjustment | null {
  return row.adjustments.find((adj) => adj.subtype_id === subtypeId) ?? null;
}

function rowHasSubtypeAdjustments(row: CostModelRow) {
  return row.adjustments.some((adj) => adj.subtype_id !== null);
}

function computeEffectiveQuantity(row: CostModelRow, subtypeId: number | null): number | null {
  const override = findSubtypeAdjustment(row, subtypeId);
  if (override) {
    return override.adjusted_quantity;
  }
  if (subtypeId === null) {
    const aggregate = findAggregateAdjustment(row);
    if (aggregate) {
      return aggregate.adjusted_quantity;
    }
    return row.estimated_total_quantity;
  }
  const subtypeEntry = row.subtypes.find((entry) => entry.subtype_id === subtypeId);
  return subtypeEntry ? subtypeEntry.estimated_quantity : null;
}

function computeRowTotal(row: CostModelRow): number | null {
  const aggregate = findAggregateAdjustment(row);
  if (aggregate) {
    return aggregate.adjusted_quantity;
  }
  let total = 0;
  let hasAny = false;
  for (const subtype of row.subtypes) {
    const override = findSubtypeAdjustment(row, subtype.subtype_id);
    const value = override ? override.adjusted_quantity : subtype.estimated_quantity;
    if (value === null || value === undefined) {
      continue;
    }
    total += value;
    hasAny = true;
  }
  if (!hasAny) {
    return row.estimated_total_quantity;
  }
  return total;
}

function computeDisplayedQuantity(row: CostModelRow, subtypeId: number | null): number | null {
  if (subtypeId !== null) {
    return computeEffectiveQuantity(row, subtypeId);
  }
  const aggregate = findAggregateAdjustment(row);
  if (aggregate) {
    return aggregate.adjusted_quantity;
  }
  if (rowHasSubtypeAdjustments(row)) {
    return computeRowTotal(row);
  }
  return row.estimated_total_quantity;
}

function quantityCost(quantity: number | null, price: number | null): number | null {
  if (quantity === null || price === null) {
    return null;
  }
  return quantity * price;
}

function metricKeyForSku(sku: string) {
  return sku.trim().toUpperCase();
}

function flattenProjects(board: ProjectsBoardData | null) {
  if (!board) {
    return [] as ProjectSummary[];
  }
  return Object.values(board.grouped_projects)
    .flat()
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name, "es"));
}

function compareNullableNumbers(left: number | null | undefined, right: number | null | undefined) {
  if (left === null || left === undefined) {
    return right === null || right === undefined ? 0 : 1;
  }
  if (right === null || right === undefined) {
    return -1;
  }
  return left - right;
}

function compareNullableStrings(left: string | null | undefined, right: string | null | undefined) {
  if (!left) {
    return right ? 1 : 0;
  }
  if (!right) {
    return -1;
  }
  return left.localeCompare(right, "es");
}

function applyOptimisticAdjustment(
  currentView: CostModelView,
  materialId: number,
  subtypeId: number | null,
  adjustedQuantity: number,
  source?: {
    kind?: string;
    house_type_id?: number | null;
    range_start?: string | null;
    range_end?: string | null;
    sample_houses?: number | null;
    total_consumption?: number | null;
  },
) {
  return {
    ...currentView,
    rows: currentView.rows.map((row) => {
      if (row.material_id !== materialId) {
        return row;
      }
      const existingAdjustment = row.adjustments.find((adjustment) => adjustment.subtype_id === subtypeId) ?? null;
      const nextAdjustment: CostModelAdjustment = {
        id: existingAdjustment?.id ?? -Date.now(),
        subtype_id: subtypeId,
        adjusted_quantity: adjustedQuantity,
        source_kind: source?.kind ?? existingAdjustment?.source_kind ?? "manual",
        source_note: existingAdjustment?.source_note ?? null,
        source_house_type_id: source?.house_type_id ?? existingAdjustment?.source_house_type_id ?? null,
        source_range_start: source?.range_start ?? existingAdjustment?.source_range_start ?? null,
        source_range_end: source?.range_end ?? existingAdjustment?.source_range_end ?? null,
        source_sample_houses: source?.sample_houses ?? existingAdjustment?.source_sample_houses ?? null,
        source_total_consumption: source?.total_consumption ?? existingAdjustment?.source_total_consumption ?? null,
        updated_at: existingAdjustment?.updated_at ?? null,
        created_by: existingAdjustment?.created_by ?? null,
      };

      return {
        ...row,
        adjustments: existingAdjustment
          ? row.adjustments.map((adjustment) => (adjustment.subtype_id === subtypeId ? nextAdjustment : adjustment))
          : [...row.adjustments, nextAdjustment],
      };
    }),
  };
}

function applyOptimisticDelete(currentView: CostModelView, materialId: number, subtypeId: number | null) {
  return {
    ...currentView,
    rows: currentView.rows.map((row) => {
      if (row.material_id !== materialId) {
        return row;
      }
      return {
        ...row,
        adjustments: row.adjustments.filter((adjustment) => adjustment.subtype_id !== subtypeId),
      };
    }),
  };
}

function getSubtypeLabel(row: CostModelRow, subtypeId: number | null) {
  if (subtypeId === null) {
    return "Total";
  }
  return row.subtypes.find((entry) => entry.subtype_id === subtypeId)?.subtype_name ?? "Subtype";
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
): HouseChartData | null {
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
    stockPath: buildLineSegments(positionedPoints.map((point) => ({ x: point.x, y: point.stockY }))),
    projectedStockPath: buildLineSegments(positionedPoints.map((point) => ({ x: point.x, y: point.projectedStockY }))),
    housePath: buildLineSegments(positionedPoints.map((point) => ({ x: point.x, y: point.houseY }))),
  };
}

function getHouseSeriesSummary(points: HouseTrendChartPoint[], selection?: ChartSelection | null): HouseRangeSummary | null {
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

export function CostModelPage({ projectId, onNavigate, onTitleChange, currentUser }: CostModelPageProps) {
  const [storedPreferences] = useState(() => getStoredCostModelPreferences());
  const [selectedHouseTypeId, setSelectedHouseTypeId] = useState<number | null>(storedPreferences?.selectedHouseTypeId ?? null);
  const [houseRange, setHouseRange] = useState<HouseRange>(() => storedPreferences?.houseRange ?? getDefaultHouseRange());
  const [projectsBoard, setProjectsBoard] = useState<ProjectsBoardData | null>(null);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [view, setView] = useState<CostModelView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [economicMetrics, setEconomicMetrics] = useState<MaterialDashboardEconomicMetricsResponse | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [viewBySubtype, setViewBySubtype] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [sort, setSort] = useState<CostModelSortState>(DEFAULT_SORT_STATE);
  const [detailsRow, setDetailsRow] = useState<CostModelRow | null>(null);
  const [consumptionSelection, setConsumptionSelection] = useState<ConsumptionSelection | null>(null);

  const canEdit = currentUser.permissions.project_edit;
  const allProjects = useMemo(() => flattenProjects(projectsBoard), [projectsBoard]);
  const selectedProjectId = useMemo(() => {
    if (projectId !== null && allProjects.some((project) => project.id === projectId)) {
      return projectId;
    }
    return allProjects[0]?.id ?? null;
  }, [allProjects, projectId]);

  const economicMetricsKey = useMemo(
    () =>
      selectedHouseTypeId && selectedProjectId !== null
        ? economicMetricsCacheKey(selectedHouseTypeId, [], houseRange, selectedProjectId)
        : null,
    [houseRange, selectedHouseTypeId, selectedProjectId],
  );

  const economicMetricsBySku = useMemo(() => {
    const map = new Map<string, MaterialDashboardEconomicMetricsResponse["metrics"][number]>();
    for (const metric of economicMetrics?.metrics ?? []) {
      map.set(metricKeyForSku(metric.sku), metric);
    }
    return map;
  }, [economicMetrics]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(
      COST_MODEL_PREFERENCES_KEY,
      JSON.stringify({
        selectedHouseTypeId,
        houseRange,
      }),
    );
  }, [houseRange, selectedHouseTypeId]);

  useEffect(() => {
    let active = true;
    async function loadProjects() {
      setProjectsLoading(true);
      try {
        const board = await api.getProjects();
        if (active) {
          setProjectsBoard(board);
        }
      } catch (err) {
        if (active) {
          setError(err instanceof ApiError ? err.message : "Could not load projects.");
          setProjectsBoard(null);
        }
      } finally {
        if (active) {
          setProjectsLoading(false);
        }
      }
    }
    void loadProjects();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!allProjects.length || selectedProjectId === null || projectId === selectedProjectId) {
      return;
    }
    onNavigate(`/cost-model?project_id=${selectedProjectId}`, true);
  }, [allProjects.length, onNavigate, projectId, selectedProjectId]);

  async function refresh() {
    if (selectedProjectId === null) {
      setView(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await api.getCostModel(selectedProjectId);
      setView(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load cost model.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProjectId]);

  useEffect(() => {
    if (!selectedHouseTypeId || selectedProjectId === null || !economicMetricsKey) {
      setEconomicMetrics(null);
      return;
    }

    let cancelled = false;
    void (async () => {
      const cached = await getMaterialDashboardCacheValue<MaterialDashboardEconomicMetricsResponse>(economicMetricsKey);
      if (cancelled) {
        return;
      }
      if (cached) {
        setEconomicMetrics(cached);
      } else {
        setEconomicMetrics(null);
      }
      try {
        const response = await api.getMaterialDashboardEconomicMetrics(
          selectedHouseTypeId,
          {},
          {
            projectId: selectedProjectId,
            startDate: houseRange.startDate,
            endDate: houseRange.endDate,
          },
        );
        if (cancelled) {
          return;
        }
        setEconomicMetrics(response);
        void setMaterialDashboardCacheValue(economicMetricsKey, response);
      } catch {
        if (!cancelled && !cached) {
          setEconomicMetrics(null);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [economicMetricsKey, houseRange.endDate, houseRange.startDate, selectedHouseTypeId, selectedProjectId]);

  useEffect(() => {
    if (view?.project.name) {
      onTitleChange?.(view.project.name);
      return;
    }
    const selectedProject = allProjects.find((project) => project.id === selectedProjectId);
    if (selectedProject?.name) {
      onTitleChange?.(selectedProject.name);
    }
  }, [allProjects, onTitleChange, selectedProjectId, view?.project.name]);

  const subtypeColumns = useMemo(() => {
    if (!view) {
      return [] as Array<{ id: number | null; name: string }>;
    }
    const seen = new Map<string, { id: number | null; name: string }>();
    for (const row of view.rows) {
      for (const entry of row.subtypes) {
        const key = entry.subtype_id === null ? "__none__" : String(entry.subtype_id);
        if (!seen.has(key)) {
          seen.set(key, { id: entry.subtype_id, name: entry.subtype_name });
        }
      }
    }
    const values = Array.from(seen.values());
    values.sort((a, b) => {
      if (a.id === null) return -1;
      if (b.id === null) return 1;
      return a.name.localeCompare(b.name, "es");
    });
    return values;
  }, [view]);

  const filteredRows = useMemo(() => {
    if (!view) {
      return [];
    }
    const needle = searchTerm.trim().toLowerCase();
    if (!needle) {
      return view.rows;
    }
    return view.rows.filter(
      (row) =>
        row.sku.toLowerCase().includes(needle) ||
        row.material_name.toLowerCase().includes(needle),
    );
  }, [view, searchTerm]);

  useEffect(() => {
    if (!viewBySubtype && sort.key.startsWith("subtype:")) {
      setSort(DEFAULT_SORT_STATE);
    }
  }, [sort.key, viewBySubtype]);

  const sortedRows = useMemo(() => {
    const rows = filteredRows.slice();
    rows.sort((left, right) => {
      let comparison = 0;
      if (sort.key === "sku") {
        comparison = compareNullableStrings(left.sku, right.sku);
      } else if (sort.key === "material_name") {
        comparison = compareNullableStrings(left.material_name, right.material_name);
      } else if (sort.key === "price") {
        comparison = compareNullableNumbers(left.price, right.price);
      } else if (sort.key === "quantity") {
        comparison = compareNullableNumbers(computeDisplayedQuantity(left, null), computeDisplayedQuantity(right, null));
      } else if (sort.key === "usage_delta") {
        comparison = compareNullableNumbers(
          economicMetricsBySku.get(metricKeyForSku(left.sku))?.consumption_delta_percent,
          economicMetricsBySku.get(metricKeyForSku(right.sku))?.consumption_delta_percent,
        );
      } else if (sort.key === "cost") {
        comparison = compareNullableNumbers(
          quantityCost(computeDisplayedQuantity(left, null), left.price),
          quantityCost(computeDisplayedQuantity(right, null), right.price),
        );
      } else if (sort.key.startsWith("subtype:")) {
        const subtypeIdToken = sort.key.slice("subtype:".length);
        const subtypeId = subtypeIdToken === "__none__" ? null : Number(subtypeIdToken);
        comparison = compareNullableNumbers(computeDisplayedQuantity(left, subtypeId), computeDisplayedQuantity(right, subtypeId));
      }

      if (comparison === 0) {
        comparison = compareNullableStrings(left.material_name, right.material_name);
      }
      if (comparison === 0) {
        comparison = compareNullableStrings(left.sku, right.sku);
      }
      return comparison * sort.direction;
    });
    return rows;
  }, [economicMetricsBySku, filteredRows, sort]);

  const totals = useMemo(() => {
    if (!view) {
      return null;
    }
    let totalCost = 0;
    let hasCost = false;
    let pricedRowCount = 0;
    const perSubtype = new Map<string, number>();
    for (const row of filteredRows) {
      const rowTotal = computeDisplayedQuantity(row, null);
      const cost = quantityCost(rowTotal, row.price);
      if (cost !== null) {
        totalCost += cost;
        hasCost = true;
        pricedRowCount += 1;
      }
      for (const subtype of row.subtypes) {
        const effective = computeDisplayedQuantity(row, subtype.subtype_id);
        const subtypeCost = quantityCost(effective, row.price);
        if (subtypeCost === null) {
          continue;
        }
        const key = subtype.subtype_id === null ? "__none__" : String(subtype.subtype_id);
        perSubtype.set(key, (perSubtype.get(key) ?? 0) + subtypeCost);
      }
    }
    return {
      totalCost: hasCost ? totalCost : null,
      perSubtype,
      pricedRowCount,
    };
  }, [filteredRows, view]);

  useEffect(() => {
    const selectableRows = sortedRows.filter((row) => !row.is_auxiliary);
    if (!selectableRows.length) {
      if (consumptionSelection !== null) {
        setConsumptionSelection(null);
      }
      return;
    }

    const currentRow = consumptionSelection
      ? selectableRows.find((row) => row.sku === consumptionSelection.sku) ?? null
      : null;

    if (!currentRow) {
      setConsumptionSelection({ sku: selectableRows[0].sku, subtypeId: null });
      return;
    }

    if (
      consumptionSelection?.subtypeId !== null &&
      !currentRow.subtypes.some((entry) => entry.subtype_id === consumptionSelection.subtypeId)
    ) {
      setConsumptionSelection({ sku: currentRow.sku, subtypeId: null });
    }
  }, [sortedRows, consumptionSelection]);

  const selectedConsumptionTarget = useMemo<ConsumptionTarget | null>(() => {
    if (!consumptionSelection) {
      return null;
    }
    const row = sortedRows.find((entry) => !entry.is_auxiliary && entry.sku === consumptionSelection.sku) ?? null;
    if (!row) {
      return null;
    }
    return {
      row,
      subtypeId: consumptionSelection.subtypeId,
    };
  }, [consumptionSelection, sortedRows]);

  const prefetchConsumptionTarget = useMemo<ConsumptionTarget | null>(() => {
    if (!selectedConsumptionTarget) {
      return null;
    }
    const selectableRows = sortedRows.filter((row) => !row.is_auxiliary);
    const currentIndex = selectableRows.findIndex((row) => row.sku === selectedConsumptionTarget.row.sku);
    const nextRow = currentIndex >= 0 ? selectableRows[currentIndex + 1] ?? null : null;
    return nextRow ? { row: nextRow, subtypeId: null } : null;
  }, [selectedConsumptionTarget, sortedRows]);

  async function handleUpsert(
    row: CostModelRow,
    subtypeId: number | null,
    adjustedQuantity: number,
    source?: {
      kind?: string;
      house_type_id?: number | null;
      range_start?: string | null;
      range_end?: string | null;
      sample_houses?: number | null;
      total_consumption?: number | null;
    },
  ) {
    if (row.material_id === null || selectedProjectId === null) {
      return;
    }
    const key = `${row.material_id}:${subtypeId ?? "null"}`;
    const previousView = view;
    setSavingKey(key);
    setError(null);
    if (previousView) {
      setView(applyOptimisticAdjustment(previousView, row.material_id, subtypeId, adjustedQuantity, source));
    }
    try {
      const next = await api.upsertCostModelAdjustment(selectedProjectId, {
        material_id: row.material_id,
        subtype_id: subtypeId,
        adjusted_quantity: adjustedQuantity,
        source_kind: source?.kind ?? "manual",
        source_note: null,
        source_house_type_id: source?.house_type_id ?? null,
        source_range_start: source?.range_start ?? null,
        source_range_end: source?.range_end ?? null,
        source_sample_houses: source?.sample_houses ?? null,
        source_total_consumption: source?.total_consumption ?? null,
      });
      setView(next);
    } catch (err) {
      if (previousView) {
        setView(previousView);
      }
      setError(err instanceof ApiError ? err.message : "Could not save adjustment.");
    } finally {
      setSavingKey(null);
    }
  }

  async function handleDelete(row: CostModelRow, subtypeId: number | null) {
    if (row.material_id === null || selectedProjectId === null) {
      return;
    }
    const key = `${row.material_id}:${subtypeId ?? "null"}`;
    const previousView = view;
    setSavingKey(key);
    setError(null);
    if (previousView) {
      setView(applyOptimisticDelete(previousView, row.material_id, subtypeId));
    }
    try {
      const next = await api.deleteCostModelAdjustment(selectedProjectId, {
        material_id: row.material_id,
        subtype_id: subtypeId,
      });
      setView(next);
    } catch (err) {
      if (previousView) {
        setView(previousView);
      }
      setError(err instanceof ApiError ? err.message : "Could not remove adjustment.");
    } finally {
      setSavingKey(null);
    }
  }

  if (projectsLoading || loading) {
    return (
      <section className="absolute inset-0 top-16 flex items-center justify-center bg-white dark:bg-zinc-950">
        <div className="text-sm text-zinc-600 dark:text-zinc-400">Loading cost model...</div>
      </section>
    );
  }
  if (!projectsLoading && !allProjects.length) {
    return (
      <section className="absolute inset-0 top-16 flex items-center justify-center bg-white dark:bg-zinc-950">
        <div className="max-w-md text-center">
          <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.35em] text-zinc-500">Cost Model</p>
          <h2 className="text-xl font-medium text-zinc-900 dark:text-white">No projects available</h2>
          <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
            Create a project first to load cost totals, subtype adjustments, and consumption studies.
          </p>
        </div>
      </section>
    );
  }
  if (!view) {
    return (
      <section className="absolute inset-0 top-16 flex items-center justify-center bg-white dark:bg-zinc-950 text-sm text-zinc-600 dark:text-zinc-400">
        Cost model not available.
      </section>
    );
  }

  const pageHeader = (
    <div className="flex flex-col gap-4 h-full">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[10px] font-bold text-accent-600 dark:text-accent-500 uppercase tracking-widest mb-1">
            Cost Model
          </p>
          <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-1 font-mono">
            {view.rows.length} materials · {view.project.instance_count} instances · mode: {view.material_mode}
          </p>
        </div>
        <div className="w-full max-w-[320px] shrink-0">
          <label className="block text-[10px] font-bold uppercase tracking-[0.25em] text-zinc-500 mb-2">
            Project
          </label>
          <select
            value={selectedProjectId ?? ""}
            onChange={(event) => {
              const nextProjectId = event.target.value ? Number(event.target.value) : null;
              onNavigate(nextProjectId ? `/cost-model?project_id=${nextProjectId}` : "/cost-model");
            }}
            className="w-full rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-zinc-900 px-3 py-2 text-sm text-zinc-900 dark:text-white outline-none transition-colors focus:border-accent-500 focus:ring-1 focus:ring-accent-500"
          >
            {allProjects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <input
          type="text"
          placeholder="Filter by SKU or material..."
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
          className="w-full bg-white dark:bg-black/40 border border-black/10 dark:border-white/10 rounded-lg py-1.5 px-3 text-sm text-zinc-800 dark:text-zinc-300 placeholder:text-zinc-500 focus:outline-none focus:border-accent-500/50 font-mono"
        />
        <label className="flex items-center gap-2 text-xs font-semibold text-zinc-700 dark:text-zinc-200 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={viewBySubtype}
            onChange={(event) => setViewBySubtype(event.target.checked)}
            className="accent-accent-500"
          />
          View by subtype
        </label>
        <p className="text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
          Off shows one rolled-up quantity and cost per material. On keeps the same total row and adds one quantity column for each project subtype.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 mt-2">
        <SummaryMetric label="Visible total" value={formatCurrency(totals?.totalCost ?? null)} emphasis />
        <SummaryMetric label="Visible materials" value={formatNumber(sortedRows.length, 0)} />
      </div>

      {viewBySubtype && subtypeColumns.length > 0 && totals ? (
        <div className="space-y-1 mt-2">
          <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-zinc-500">Subtype totals in view</p>
          <div className="flex flex-wrap gap-2 pb-1">
            {subtypeColumns.map((column) => {
              const key = column.id === null ? "__none__" : String(column.id);
              return (
                <SubtypeTotalChip
                  key={column.id ?? "none"}
                  label={column.name}
                  value={formatCurrency(totals.perSubtype.get(key) ?? null)}
                />
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );

  return (
    <section className="absolute inset-0 top-16 flex min-h-0 flex-col overflow-hidden bg-white dark:bg-zinc-950">
      {error ? (
        <div className="m-4 rounded-xl border border-red-200 dark:border-red-500/20 bg-red-100 dark:bg-red-500/10 px-4 py-3 text-sm text-red-800 dark:text-red-200 shrink-0">
          {error}
        </div>
      ) : null}

        <ConsumptionStudyWrapper
          target={selectedConsumptionTarget}
          prefetchTarget={prefetchConsumptionTarget}
          projectId={selectedProjectId}
          selectedHouseTypeId={selectedHouseTypeId}
          onSelectedHouseTypeIdChange={setSelectedHouseTypeId}
          houseRange={houseRange}
          onHouseRangeChange={setHouseRange}
          canEdit={canEdit}
          onSave={handleUpsert}
          headerLeft={pageHeader}
      >
        <section className="flex-1 flex flex-col min-h-0 overflow-hidden border-r border-black/5 dark:border-white/5">
          <div className="h-full overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-white/95 dark:bg-zinc-950/95 backdrop-blur">
                <tr className="text-left text-[11px] uppercase tracking-widest text-zinc-500 dark:text-zinc-400 border-b border-black/10 dark:border-white/10">
                  <SortableHeader
                    label="SKU"
                    active={sort.key === "sku"}
                    direction={sort.direction}
                    onClick={() =>
                      setSort((current) =>
                        current.key === "sku" ? { key: "sku", direction: current.direction === 1 ? -1 : 1 } : { key: "sku", direction: 1 },
                      )
                    }
                  />
                  <SortableHeader
                    label="Material"
                    active={sort.key === "material_name"}
                    direction={sort.direction}
                    onClick={() =>
                      setSort((current) =>
                        current.key === "material_name"
                          ? { key: "material_name", direction: current.direction === 1 ? -1 : 1 }
                          : { key: "material_name", direction: 1 },
                      )
                    }
                  />
                  <SortableHeader
                    label="Unit price"
                    align="right"
                    active={sort.key === "price"}
                    direction={sort.direction}
                    onClick={() =>
                      setSort((current) =>
                        current.key === "price"
                          ? { key: "price", direction: current.direction === 1 ? -1 : 1 }
                          : { key: "price", direction: -1 },
                      )
                    }
                  />
                  <SortableHeader
                    label="Qty"
                    align="right"
                    active={sort.key === "quantity"}
                    direction={sort.direction}
                    onClick={() =>
                      setSort((current) =>
                        current.key === "quantity"
                          ? { key: "quantity", direction: current.direction === 1 ? -1 : 1 }
                          : { key: "quantity", direction: -1 },
                      )
                    }
                  />
                  <SortableHeader
                    label="% vs usage"
                    align="right"
                    active={sort.key === "usage_delta"}
                    direction={sort.direction}
                    onClick={() =>
                      setSort((current) =>
                        current.key === "usage_delta"
                          ? { key: "usage_delta", direction: current.direction === 1 ? -1 : 1 }
                          : { key: "usage_delta", direction: -1 },
                      )
                    }
                  />
                  {viewBySubtype
                    ? subtypeColumns.map((col) => (
                        <SortableHeader
                          key={col.id ?? "none"}
                          label={col.name}
                          align="right"
                          active={sort.key === `subtype:${col.id === null ? "__none__" : String(col.id)}`}
                          direction={sort.direction}
                          onClick={() => {
                            const key = `subtype:${col.id === null ? "__none__" : String(col.id)}` as CostModelSortKey;
                            setSort((current) =>
                              current.key === key
                                ? { key, direction: current.direction === 1 ? -1 : 1 }
                                : { key, direction: -1 },
                            );
                          }}
                        />
                      ))
                    : null}
                  <SortableHeader
                    label="Cost"
                    align="right"
                    active={sort.key === "cost"}
                    direction={sort.direction}
                    onClick={() =>
                      setSort((current) =>
                        current.key === "cost"
                          ? { key: "cost", direction: current.direction === 1 ? -1 : 1 }
                          : { key: "cost", direction: -1 },
                      )
                    }
                  />
                </tr>
              </thead>
              <tbody>
                {sortedRows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={viewBySubtype ? 6 + subtypeColumns.length : 6}
                      className="px-4 py-8 text-center text-zinc-500 dark:text-zinc-400 text-xs"
                    >
                      No materials match the current filter.
                    </td>
                  </tr>
                ) : null}
                {sortedRows.map((row) => (
                  <CostModelRowView
                    key={`${row.is_auxiliary ? "aux" : "mat"}:${row.material_id ?? row.sku}`}
                    row={row}
                    subtypeColumns={subtypeColumns}
                    viewBySubtype={viewBySubtype}
                    canEdit={canEdit}
                    savingKey={savingKey}
                    selectedConsumption={consumptionSelection}
                    onFocusConsumption={(subtypeId) => setConsumptionSelection({ sku: row.sku, subtypeId })}
                    onOpenDetails={() => setDetailsRow(row)}
                    onUpsert={handleUpsert}
                    onDelete={handleDelete}
                    usageMetric={economicMetricsBySku.get(metricKeyForSku(row.sku)) ?? null}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </ConsumptionStudyWrapper>

      <DetailsModal row={detailsRow} onClose={() => setDetailsRow(null)} />
    </section>
  );
}

type SummaryMetricProps = {
  label: string;
  value: string;
  emphasis?: boolean;
};

function SummaryMetric({ label, value, emphasis = false }: SummaryMetricProps) {
  return (
    <div className="rounded-xl border border-black/10 dark:border-white/10 bg-white/60 dark:bg-white/[0.04] px-3 py-2.5">
      <p className="text-[10px] uppercase tracking-widest font-semibold text-zinc-500">{label}</p>
      <p className={emphasis ? "mt-1 text-lg font-semibold tracking-tight text-zinc-900 dark:text-white" : "mt-1 text-sm font-mono text-zinc-900 dark:text-white"}>
        {value}
      </p>
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
                stroke="rgb(16 185 129 / 0.9)"
                strokeWidth="2.8"
                strokeLinecap="round"
                className="dark:stroke-[rgba(16,185,129,0.24)]"
              />
            ) : null}
          </svg>
          <div className="absolute bottom-3 left-12 right-4 flex items-center justify-between">
            <SkeletonBlock className="h-3 w-16" />
            <SkeletonBlock className="h-3 w-16" />
          </div>
        </div>
      </div>
    </div>
  );
}

function SubtypeTotalChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-full border border-black/10 dark:border-white/10 bg-white/70 dark:bg-white/[0.04] px-3 py-1.5 text-xs">
      <span className="font-semibold text-zinc-700 dark:text-zinc-100">{label}</span>
      <span className="ml-2 font-mono text-zinc-500 dark:text-zinc-300">{value}</span>
    </div>
  );
}

function SortableHeader({
  label,
  active,
  direction,
  align = "left",
  onClick,
}: {
  label: string;
  active: boolean;
  direction: 1 | -1;
  align?: "left" | "right";
  onClick: () => void;
}) {
  return (
    <th className={`px-4 py-3 font-semibold ${align === "right" ? "text-right" : "text-left"}`}>
      <button type="button" onClick={onClick} className={`inline-flex items-center gap-2 ${align === "right" ? "justify-end" : ""}`}>
        <span>{label}</span>
        <span className={`text-xs ${active ? "opacity-100" : "opacity-35"}`}>{direction === 1 ? "↑" : "↓"}</span>
      </button>
    </th>
  );
}

type ConsumptionStudyWrapperProps = {
  target: ConsumptionTarget | null;
  prefetchTarget?: ConsumptionTarget | null;
  projectId: number | null;
  selectedHouseTypeId: number | null;
  onSelectedHouseTypeIdChange: Dispatch<SetStateAction<number | null>>;
  houseRange: HouseRange;
  onHouseRangeChange: Dispatch<SetStateAction<HouseRange>>;
  canEdit: boolean;
  onSave: (
    row: CostModelRow,
    subtypeId: number | null,
    adjustedQuantity: number,
    source?: {
      kind?: string;
      house_type_id?: number | null;
      range_start?: string | null;
      range_end?: string | null;
      sample_houses?: number | null;
      total_consumption?: number | null;
    },
  ) => Promise<void>;
  headerLeft?: ReactNode;
  children?: ReactNode;
};

function cacheMaterialStudyData(
  study: MaterialDashboardMaterialStudyData,
  keys: {
    detailKey: string;
    historyKey: string;
    comparisonKey: string;
  },
  refs?: {
    detailCacheRef?: MutableRefObject<Record<string, MaterialDashboardDetailData>>;
    historyCacheRef?: MutableRefObject<Record<string, MaterialDashboardMovementData>>;
    comparisonCacheRef?: MutableRefObject<Record<string, MaterialDashboardHouseComparisonData>>;
  },
) {
  if (refs?.detailCacheRef) {
    refs.detailCacheRef.current[keys.detailKey] = study.detail;
  }
  if (refs?.historyCacheRef) {
    refs.historyCacheRef.current[keys.historyKey] = study.history;
  }
  if (refs?.comparisonCacheRef) {
    refs.comparisonCacheRef.current[keys.comparisonKey] = study.comparison;
  }
  void Promise.all([
    setMaterialDashboardCacheValue(keys.detailKey, study.detail),
    setMaterialDashboardCacheValue(keys.historyKey, study.history),
    setMaterialDashboardCacheValue(keys.comparisonKey, study.comparison),
  ]);
}

function ConsumptionStudyWrapper({
  target,
  prefetchTarget = null,
  projectId,
  selectedHouseTypeId,
  onSelectedHouseTypeIdChange,
  houseRange,
  onHouseRangeChange,
  canEdit,
  onSave,
  headerLeft,
  children,
}: ConsumptionStudyWrapperProps) {
  const [houseTypes, setHouseTypes] = useState<MaterialDashboardHouseType[]>([]);
  const [detail, setDetail] = useState<MaterialDashboardDetailData | null>(null);
  const [history, setHistory] = useState<MaterialDashboardMovementData | null>(null);
  const [comparison, setComparison] = useState<MaterialDashboardHouseComparisonData | null>(null);
  const detailCacheRef = useRef<Record<string, MaterialDashboardDetailData>>({});
  const historyCacheRef = useRef<Record<string, MaterialDashboardMovementData>>({});
  const comparisonCacheRef = useRef<Record<string, MaterialDashboardHouseComparisonData>>({});
  const prefetchedStudyKeysRef = useRef<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [selection, setSelection] = useState<ChartSelection | null>(null);
  const [dragAnchorIndex, setDragAnchorIndex] = useState<number | null>(null);
  const [dragCurrentIndex, setDragCurrentIndex] = useState<number | null>(null);
  const [hoveredPointIndex, setHoveredPointIndex] = useState<number | null>(null);
  const [manualValue, setManualValue] = useState("");
  const [saving, setSaving] = useState(false);
  const detailKey = useMemo(() => (target ? detailCacheKey(target.row.sku, []) : null), [target?.row.sku]);
  const historyKey = useMemo(() => (target ? historyCacheKey(target.row.sku, [], houseRange) : null), [houseRange, target?.row.sku]);
  const comparisonKey = useMemo(
    () => (target && selectedHouseTypeId ? houseComparisonCacheKey(target.row.sku, selectedHouseTypeId, [], houseRange, projectId) : null),
    [houseRange, projectId, selectedHouseTypeId, target?.row.sku],
  );
  const selectedHouseType = useMemo(
    () => houseTypes.find((houseType) => houseType.id === selectedHouseTypeId) ?? null,
    [houseTypes, selectedHouseTypeId],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let hasCached = false;
      const cached = await getMaterialDashboardCacheValue<MaterialDashboardHouseType[]>(HOUSE_TYPES_CACHE_KEY);
      if (cancelled) {
        return;
      }
      if (cached) {
        hasCached = true;
        setHouseTypes(cached);
        onSelectedHouseTypeIdChange((current) => {
          if (current !== null && cached.some((houseType) => houseType.id === current)) {
            return current;
          }
          return cached[0]?.id ?? null;
        });
      }
      try {
        const response = await api.getMaterialDashboardHouseTypes();
        if (cancelled) {
          return;
        }
        setHouseTypes(response.house_types);
        void setMaterialDashboardCacheValue(HOUSE_TYPES_CACHE_KEY, response.house_types);
        onSelectedHouseTypeIdChange((current) => {
          if (current !== null && response.house_types.some((houseType) => houseType.id === current)) {
            return current;
          }
          return response.house_types[0]?.id ?? null;
        });
      } catch (err) {
        if (!cancelled && !hasCached) {
          setFetchError(err instanceof ApiError ? err.message : "Could not load house types.");
          setHouseTypes([]);
          onSelectedHouseTypeIdChange(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [onSelectedHouseTypeIdChange]);

  useEffect(() => {
    setSelection(null);
    setDragAnchorIndex(null);
    setDragCurrentIndex(null);
    setHoveredPointIndex(null);
  }, [target?.row.sku, target?.subtypeId]);

  useEffect(() => {
    if (!target || !selectedHouseTypeId || !detailKey || !historyKey || !comparisonKey) {
      setDetail(null);
      setHistory(null);
      setComparison(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setFetchError(null);

    void (async () => {
      const [cachedDetail, cachedHistory, cachedComparison] = await Promise.all([
        detailCacheRef.current[detailKey] ?? getMaterialDashboardCacheValue<MaterialDashboardDetailData>(detailKey),
        historyCacheRef.current[historyKey] ?? getMaterialDashboardCacheValue<MaterialDashboardMovementData>(historyKey),
        comparisonCacheRef.current[comparisonKey] ?? getMaterialDashboardCacheValue<MaterialDashboardHouseComparisonData>(comparisonKey),
      ]);
      if (cancelled) {
        return;
      }

      const hasAllCached = Boolean(cachedDetail && cachedHistory && cachedComparison);

      if (cachedDetail) {
        detailCacheRef.current[detailKey] = cachedDetail;
        setDetail(cachedDetail);
      } else {
        setDetail(null);
      }

      if (cachedHistory) {
        historyCacheRef.current[historyKey] = cachedHistory;
        setHistory(cachedHistory);
      } else {
        setHistory(null);
      }

      if (cachedComparison) {
        comparisonCacheRef.current[comparisonKey] = cachedComparison;
        setComparison(cachedComparison);
      } else {
        setComparison(null);
      }

      setLoading(!hasAllCached);

      try {
        const studyData = await api.getMaterialDashboardMaterialStudy(target.row.sku, selectedHouseTypeId, {}, {
          projectId,
          startDate: houseRange.startDate,
          endDate: houseRange.endDate,
        });
        if (!cancelled) {
          cacheMaterialStudyData(
            studyData,
            { detailKey, historyKey, comparisonKey },
            { detailCacheRef, historyCacheRef, comparisonCacheRef },
          );
          setDetail(studyData.detail);
          setHistory(studyData.history);
          setComparison(studyData.comparison);
        }
      } catch (err) {
        if (!cancelled) {
          setFetchError(err instanceof ApiError ? err.message : "Could not load consumption data.");
          if (!cachedDetail) {
            setDetail(null);
          }
          if (!cachedHistory) {
            setHistory(null);
          }
          if (!cachedComparison) {
            setComparison(null);
          }
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    comparisonKey,
    detailKey,
    historyKey,
    houseRange.endDate,
    houseRange.startDate,
    projectId,
    selectedHouseTypeId,
    target?.row.sku,
    target?.subtypeId,
  ]);

  useEffect(() => {
    if (loading || !prefetchTarget || !selectedHouseTypeId) {
      return;
    }
    const prefetchDetailKey = detailCacheKey(prefetchTarget.row.sku, []);
    const prefetchHistoryKey = historyCacheKey(prefetchTarget.row.sku, [], houseRange);
    const prefetchComparisonKey = houseComparisonCacheKey(prefetchTarget.row.sku, selectedHouseTypeId, [], houseRange, projectId);
    const prefetchKey = `${prefetchDetailKey}::${prefetchHistoryKey}::${prefetchComparisonKey}`;
    if (prefetchedStudyKeysRef.current.has(prefetchKey)) {
      return;
    }

    let cancelled = false;
    const timeoutId = window.setTimeout(() => {
      void (async () => {
        const [cachedDetail, cachedHistory, cachedComparison] = await Promise.all([
          detailCacheRef.current[prefetchDetailKey] ??
            getMaterialDashboardCacheValue<MaterialDashboardDetailData>(prefetchDetailKey),
          historyCacheRef.current[prefetchHistoryKey] ??
            getMaterialDashboardCacheValue<MaterialDashboardMovementData>(prefetchHistoryKey),
          comparisonCacheRef.current[prefetchComparisonKey] ??
            getMaterialDashboardCacheValue<MaterialDashboardHouseComparisonData>(prefetchComparisonKey),
        ]);
        if (cancelled) {
          return;
        }
        if (cachedDetail && cachedHistory && cachedComparison) {
          detailCacheRef.current[prefetchDetailKey] = cachedDetail;
          historyCacheRef.current[prefetchHistoryKey] = cachedHistory;
          comparisonCacheRef.current[prefetchComparisonKey] = cachedComparison;
          prefetchedStudyKeysRef.current.add(prefetchKey);
          return;
        }

        try {
          const studyData = await api.getMaterialDashboardMaterialStudy(prefetchTarget.row.sku, selectedHouseTypeId, {}, {
            projectId,
            startDate: houseRange.startDate,
            endDate: houseRange.endDate,
          });
          if (cancelled) {
            return;
          }
          cacheMaterialStudyData(
            studyData,
            {
              detailKey: prefetchDetailKey,
              historyKey: prefetchHistoryKey,
              comparisonKey: prefetchComparisonKey,
            },
            { detailCacheRef, historyCacheRef, comparisonCacheRef },
          );
          prefetchedStudyKeysRef.current.add(prefetchKey);
        } catch {
          // Prefetch is opportunistic; the visible selection path will surface errors.
        }
      })();
    }, 500);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [
    houseRange.endDate,
    houseRange.startDate,
    loading,
    prefetchTarget?.row.sku,
    projectId,
    selectedHouseTypeId,
  ]);

  const latestHouseRangeValue = toDateInputValue(moveToPreviousBusinessDay(new Date()));
  const weekdayComparison = useMemo(
    () =>
      comparison
        ? {
            ...comparison,
            points: comparison.points.filter((point) => !isWeekend(toStartOfDay(point.date))),
          }
        : null,
    [comparison],
  );
  const stockSeries = useMemo(
    () =>
      detail && history
        ? buildHistoricalStockSeries(history.movements, detail.stock_on_hand, {
            startDate: houseRange.startDate,
            endDate: latestHouseRangeValue,
          })
        : [],
    [detail, history, houseRange.startDate, latestHouseRangeValue],
  );
  const projectedStockByDay = useMemo(
    () => buildProjectedStockByDay(comparison, stockSeries),
    [comparison, stockSeries],
  );
  const houseRangeEndStockValue = useMemo(
    () => getStockValueForDate(stockSeries, houseRange.endDate),
    [stockSeries, houseRange.endDate],
  );
  const chart = useMemo(
    () =>
      weekdayComparison
        ? buildHouseComparisonChart(
            weekdayComparison,
            stockSeries,
            CHART_WIDTH,
            CHART_HEIGHT,
            houseRangeEndStockValue,
            detail?.stock_on_hand ?? null,
            projectedStockByDay,
          )
        : null,
    [detail?.stock_on_hand, houseRangeEndStockValue, projectedStockByDay, stockSeries, weekdayComparison],
  );
  const activeSelection =
    dragAnchorIndex !== null && dragCurrentIndex !== null
      ? { startIndex: dragAnchorIndex, endIndex: dragCurrentIndex }
      : selection;
  const selectionBounds = activeSelection && chart ? getClampedSelectionBounds(activeSelection, chart.points.length) : null;
  const hoveredPoint = chart && hoveredPointIndex !== null ? chart.points[hoveredPointIndex] ?? null : null;
  const houseSummary = chart ? getHouseSeriesSummary(chart.points, activeSelection) : null;
  const currentQuantity = target ? computeDisplayedQuantity(target.row, target.subtypeId) : null;
  const currentAdjustment = target ? findSubtypeAdjustment(target.row, target.subtypeId) : null;
  const actualConsumptionPerHouse = houseSummary?.averageConsumptionPerHouse ?? comparison?.material_per_house ?? null;
  const definedQuantityPerHouse = comparison?.project_comparison?.predicted_quantity_per_house ?? null;
  const quantityDelta =
    actualConsumptionPerHouse !== null && actualConsumptionPerHouse !== undefined && definedQuantityPerHouse !== null
      ? actualConsumptionPerHouse - definedQuantityPerHouse
      : null;
  const deltaPercent =
    quantityDelta !== null && definedQuantityPerHouse !== null && definedQuantityPerHouse !== 0
      ? (quantityDelta / definedQuantityPerHouse) * 100
      : null;
  const costDeltaPerHouse =
    quantityDelta !== null && target?.row.price !== null && target?.row.price !== undefined
      ? quantityDelta * target.row.price
      : null;

  useEffect(() => {
    if (!target) {
      setManualValue("");
      return;
    }
    if (actualConsumptionPerHouse !== null && actualConsumptionPerHouse !== undefined) {
      setManualValue(String(Math.round(actualConsumptionPerHouse * 10000) / 10000));
      return;
    }
    setManualValue("");
  }, [actualConsumptionPerHouse, target?.row.sku, target?.subtypeId]);

  function getPointIndexFromEvent(event: ReactPointerEvent<SVGSVGElement>) {
    if (!chart) {
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
    const chartX = clamp(cursorPt.x, chart.padding.left, chart.padding.left + chart.plotWidth);
    return getClosestPointIndex(chart.points, chartX);
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
    } else {
      setSelection(null);
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
    onHouseRangeChange((current) =>
      clampHouseRange(
        {
          startDate: value,
          endDate: current.endDate,
        },
        new Date(),
      ),
    );
  }

  function handleHouseRangeEndChange(value: string) {
    if (!value) {
      return;
    }
    onHouseRangeChange((current) =>
      clampHouseRange(
        {
          startDate: current.startDate,
          endDate: value,
        },
        new Date(),
      ),
    );
  }

  async function handleSaveFromRange() {
    if (!target || !houseSummary || houseSummary.averageConsumptionPerHouse === null) {
      return;
    }
    setSaving(true);
    try {
      await onSave(target.row, target.subtypeId, houseSummary.averageConsumptionPerHouse, {
        kind: "historic_consumption",
        house_type_id: selectedHouseTypeId,
        range_start: houseSummary.start.date,
        range_end: houseSummary.end.date,
        sample_houses: houseSummary.housesProduced,
        total_consumption: houseSummary.materialConsumed,
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveManual() {
    if (!target) {
      return;
    }
    const parsed = parseNumberInput(manualValue);
    if (parsed === null) {
      return;
    }
    setSaving(true);
    try {
      await onSave(target.row, target.subtypeId, parsed, {
        kind: "manual",
        house_type_id: selectedHouseTypeId,
        range_start: houseSummary?.start.date ?? comparison?.range_start ?? null,
        range_end: houseSummary?.end.date ?? comparison?.range_end ?? null,
        sample_houses: houseSummary?.housesProduced ?? comparison?.total_house_starts ?? null,
        total_consumption: houseSummary?.materialConsumed ?? comparison?.total_material_quantity ?? null,
      });
    } finally {
      setSaving(false);
    }
  }

  const disabled = !canEdit || saving;
  const isBlockingLoad = !fetchError && Boolean(selectedHouseTypeId) && (!detail || !history || !comparison);
  const selectionStart = selectionBounds && chart ? chart.points[selectionBounds.startIndex] ?? null : null;
  const selectionEnd = selectionBounds && chart ? chart.points[selectionBounds.endIndex] ?? null : null;

  if (!target) {
    return (
      <div className="flex flex-col h-full w-full">
        <div className="shrink-0 border-b border-black/5 dark:border-white/5 p-4 md:p-6 bg-white/40 dark:bg-black/20 flex flex-col xl:flex-row gap-6">
          <div className="w-full xl:w-[380px] shrink-0">
            {headerLeft}
          </div>
          <div className="flex-1 min-w-0 flex items-center justify-center xl:border-l xl:border-black/5 xl:dark:border-white/5 xl:pl-6 bg-zinc-50/50 dark:bg-black/10 rounded-xl p-6">
             <div className="text-center max-w-md">
              <p className="text-[10px] font-bold uppercase tracking-[0.35em] text-zinc-500 mb-3">Consumption Study</p>
              <h2 className="text-xl font-medium text-zinc-900 dark:text-white mb-2">Select a SKU to pin its graph</h2>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                The inline graph follows the focused material and becomes the source used for historic consumption overrides.
              </p>
            </div>
          </div>
        </div>
        <div className="flex flex-1 min-h-0">
          <div className="flex-1 min-w-0 flex flex-col">
            {children}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full w-full">
      <div className="shrink-0 border-b border-black/5 dark:border-white/5 p-4 md:p-6 bg-white/40 dark:bg-black/20 flex flex-col xl:flex-row gap-6">
        <div className="w-full xl:w-[380px] shrink-0">
          {headerLeft}
        </div>
        
        <div className="flex-1 min-w-0 flex flex-col gap-3 xl:border-l xl:border-black/5 xl:dark:border-white/5 xl:pl-6">
          <div className="min-w-0 flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.35em] text-zinc-500 mb-2">Consumption Study</p>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-zinc-200 dark:bg-white/10 px-2.5 py-1 text-[11px] font-mono text-zinc-700 dark:text-zinc-200">
                  {target.row.sku}
                </span>
                <span className="rounded-full border border-black/10 dark:border-white/10 px-2.5 py-1 text-[11px] text-zinc-600 dark:text-zinc-300">
                  {getSubtypeLabel(target.row, target.subtypeId)}
                </span>
                {currentAdjustment?.source_kind && currentAdjustment.source_kind !== "manual" ? (
                  <span className="rounded-full border border-amber-300 dark:border-amber-500/30 bg-amber-100 dark:bg-amber-500/10 px-2.5 py-1 text-[11px] font-semibold text-amber-700 dark:text-amber-300">
                    {currentAdjustment.source_kind}
                  </span>
                ) : null}
              </div>
              <h2 className="mt-3 text-xl font-semibold text-zinc-900 dark:text-white break-words">{target.row.material_name}</h2>
            </div>
            
            <div className="flex flex-col items-end gap-2 shrink-0">
              <select
                value={selectedHouseTypeId ?? ""}
                onChange={(event) => onSelectedHouseTypeIdChange(event.target.value ? Number(event.target.value) : null)}
                className="rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-zinc-900 px-3 py-1.5 text-sm text-zinc-900 dark:text-white outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500 transition-colors"
              >
                <option value="">Select house type…</option>
                {houseTypes.map((houseType) => (
                  <option key={houseType.id} value={houseType.id}>
                    {houseType.name} ({houseType.number_of_modules}m)
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

              {selectionBounds ? (
                <button
                  type="button"
                  onClick={() => setSelection(null)}
                  className="rounded-full border border-black/10 px-3 py-1 text-[11px] font-medium text-zinc-600 transition-colors hover:bg-black/[0.04] hover:text-zinc-900 dark:border-white/10 dark:text-zinc-300 dark:hover:bg-white/[0.06] dark:hover:text-white"
                >
                  Reset selection
                </button>
              ) : null}
            </div>
          </div>

          <div className="w-full flex-1 flex flex-col min-h-[160px]">
            <div className="flex flex-wrap items-center gap-4 text-[11px] text-zinc-500 mb-2">
              <div className="flex items-center gap-2">
                <span className="block h-0.5 w-6 rounded-full bg-amber-500" />
                <span>Material stock</span>
              </div>
              {comparison?.project_comparison ? (
                <div className="flex items-center gap-2">
                  <span className="block h-0.5 w-6 rounded-full bg-emerald-500" />
                  <span>{comparison.project_comparison.project_name}</span>
                </div>
              ) : null}
              <div className="flex items-center gap-2">
                <span className="block h-0.5 w-6 rounded-full bg-slate-700 dark:bg-slate-300" />
                <span>Remaining house starts</span>
              </div>
              {houseSummary ? (
                <span className="font-mono text-zinc-600 dark:text-zinc-300">
                  {formatDate(houseSummary.start.date)} - {formatDate(houseSummary.end.date)} · {formatNumber(houseSummary.housesProduced, 0)} houses · {formatNumber(houseSummary.materialConsumed)} material
                </span>
              ) : null}
            </div>

            {fetchError ? (
              <div className="rounded-lg border border-red-200 dark:border-red-500/20 bg-red-50 dark:bg-red-500/10 px-3 py-2 text-xs text-red-800 dark:text-red-200">
                {fetchError}
              </div>
            ) : !selectedHouseTypeId ? (
              <p className="text-xs text-zinc-500">Select a house type to load the project comparison.</p>
            ) : isBlockingLoad || loading ? (
              <div className="relative min-h-[220px]">
                <TrendChartSkeleton dualSeries />
              </div>
            ) : comparison && chart ? (
              <svg
                viewBox={`0 0 ${chart.width} ${chart.height}`}
                className="w-full h-auto max-h-[220px] overflow-visible cursor-crosshair touch-none select-none"
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
                  <clipPath id="cost-model-selection-clip">
                    <rect
                      x={Math.min(selectionStart.x, selectionEnd.x)}
                      y={0}
                      width={Math.max(Math.abs(selectionEnd.x - selectionStart.x), 0.001)}
                      height={chart.height}
                    />
                  </clipPath>
                ) : null}
              </defs>
              {[0, 0.25, 0.5, 0.75, 1].map((stop) => {
                const y = chart.padding.top + chart.plotHeight - stop * chart.plotHeight;
                return (
                  <g key={stop}>
                    <line
                      x1={chart.padding.left}
                      y1={y}
                      x2={chart.width - chart.padding.right}
                      y2={y}
                      stroke="rgba(113,113,122,0.18)"
                      strokeDasharray="4 6"
                    />
                    <text x={chart.padding.left - 10} y={y + 4} textAnchor="end" fontSize="11" fill="currentColor" opacity="0.55">
                      {formatNumber(chart.minStock + (chart.maxStock - chart.minStock) * stop)}
                    </text>
                    <text x={chart.width - chart.padding.right + 10} y={y + 4} fontSize="11" fill="currentColor" opacity="0.55">
                      {formatNumber(chart.maxRemainingHouseStarts * stop, 0)}
                    </text>
                  </g>
                );
              })}
              {selectionStart && selectionEnd ? (
                <g>
                  <rect
                    x={Math.min(selectionStart.x, selectionEnd.x)}
                    y={chart.padding.top}
                    width={Math.max(Math.abs(selectionEnd.x - selectionStart.x), 2)}
                    height={chart.plotHeight}
                    fill="rgba(51, 65, 85, 0.08)"
                  />
                  <line
                    x1={selectionStart.x}
                    y1={chart.padding.top}
                    x2={selectionStart.x}
                    y2={chart.padding.top + chart.plotHeight}
                    stroke="rgba(51, 65, 85, 0.45)"
                    strokeDasharray="4 4"
                  />
                  <line
                    x1={selectionEnd.x}
                    y1={chart.padding.top}
                    x2={selectionEnd.x}
                    y2={chart.padding.top + chart.plotHeight}
                    stroke="rgba(51, 65, 85, 0.45)"
                    strokeDasharray="4 4"
                  />
                </g>
              ) : null}
              {chart.stockPath ? (
                <path
                  d={chart.stockPath}
                  fill="none"
                  stroke="rgb(245 158 11)"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity={selectionBounds ? 0.25 : 1}
                />
              ) : null}
              {chart.projectedStockPath ? (
                <path
                  d={chart.projectedStockPath}
                  fill="none"
                  stroke="rgb(16 185 129)"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity={selectionBounds ? 0.25 : 1}
                />
              ) : null}
              {chart.housePath ? (
                <path
                  d={chart.housePath}
                  fill="none"
                  stroke="rgb(51 65 85)"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity={selectionBounds ? 0.25 : 1}
                  className="dark:stroke-slate-300"
                />
              ) : null}
              {chart.points.map((point) => (
                <g key={point.date}>
                  {point.stockY !== null ? (
                    <circle
                      cx={point.x}
                      cy={point.stockY}
                      r={hoveredPoint?.index === point.index ? 5 : 2.5}
                      fill="rgb(245 158 11)"
                      opacity={selectionBounds ? 0.25 : 1}
                      pointerEvents="none"
                    />
                  ) : null}
                  {point.projectedStockY !== null ? (
                    <circle
                      cx={point.x}
                      cy={point.projectedStockY}
                      r={hoveredPoint?.index === point.index ? 5 : 2.5}
                      fill="rgb(16 185 129)"
                      opacity={selectionBounds ? 0.25 : 1}
                      pointerEvents="none"
                    />
                  ) : null}
                  <circle
                    cx={point.x}
                    cy={point.houseY}
                    r={hoveredPoint?.index === point.index ? 5 : 2.5}
                    fill="rgb(51 65 85)"
                    opacity={selectionBounds ? 0.25 : 1}
                    className="dark:fill-slate-300"
                    pointerEvents="none"
                  />
                </g>
              ))}
              {selectionBounds ? (
                <g clipPath="url(#cost-model-selection-clip)">
                  {chart.stockPath ? (
                    <path
                      d={chart.stockPath}
                      fill="none"
                      stroke="rgb(245 158 11)"
                      strokeWidth="3.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  ) : null}
                  {chart.projectedStockPath ? (
                    <path
                      d={chart.projectedStockPath}
                      fill="none"
                      stroke="rgb(16 185 129)"
                      strokeWidth="3.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  ) : null}
                  {chart.housePath ? (
                    <path
                      d={chart.housePath}
                      fill="none"
                      stroke="rgb(51 65 85)"
                      strokeWidth="3.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="dark:stroke-slate-300"
                    />
                  ) : null}
                  {chart.points.map((point) => {
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
                            r={hoveredPoint?.index === point.index ? 5.5 : 4.5}
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
                            r={hoveredPoint?.index === point.index ? 5.5 : 4.5}
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
                          r={hoveredPoint?.index === point.index ? 5.5 : 4.5}
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
              {hoveredPoint ? (
                <g pointerEvents="none">
                  <line
                    x1={hoveredPoint.x}
                    y1={chart.padding.top}
                    x2={hoveredPoint.x}
                    y2={chart.padding.top + chart.plotHeight}
                    stroke="rgba(51, 65, 85, 0.35)"
                    strokeDasharray="4 4"
                  />
                  {hoveredPoint.stockY !== null ? (
                    <circle
                      cx={hoveredPoint.x}
                      cy={hoveredPoint.stockY}
                      r={6}
                      fill="rgb(245 158 11)"
                      stroke="rgb(255 255 255)"
                      strokeWidth="2"
                      className="dark:stroke-zinc-900"
                    />
                  ) : null}
                  {hoveredPoint.projectedStockY !== null ? (
                    <circle
                      cx={hoveredPoint.x}
                      cy={hoveredPoint.projectedStockY}
                      r={6}
                      fill="rgb(16 185 129)"
                      stroke="rgb(255 255 255)"
                      strokeWidth="2"
                      className="dark:stroke-zinc-900"
                    />
                  ) : null}
                  <circle
                    cx={hoveredPoint.x}
                    cy={hoveredPoint.houseY}
                    r={6}
                    fill="rgb(51 65 85)"
                    stroke="rgb(255 255 255)"
                    strokeWidth="2"
                    className="dark:fill-slate-300 dark:stroke-zinc-900"
                  />
                  <g
                    transform={`translate(${clamp(hoveredPoint.x - 90, chart.padding.left, chart.width - chart.padding.right - 180)}, ${
                      Math.min(hoveredPoint.stockY ?? hoveredPoint.houseY, hoveredPoint.houseY) < chart.padding.top + 74
                        ? Math.max(hoveredPoint.stockY ?? hoveredPoint.houseY, hoveredPoint.houseY) + 16
                        : Math.min(hoveredPoint.stockY ?? hoveredPoint.houseY, hoveredPoint.houseY) - 76
                    })`}
                  >
                    <rect
                      width="180"
                      height={hoveredPoint.projectedStockValue !== null ? "80" : "66"}
                      rx="10"
                      fill="rgba(24, 24, 27, 0.92)"
                      className="dark:fill-zinc-950/95"
                    />
                    <text x="12" y="17" fontSize="11" fill="white" opacity="0.9">
                      {formatDate(hoveredPoint.date)}
                    </text>
                    <text x="12" y="31" fontSize="12" fill="white" fontWeight="700">
                      Stock: {formatNumber(hoveredPoint.stockValue)}
                    </text>
                    {hoveredPoint.projectedStockValue !== null ? (
                      <text x="12" y="45" fontSize="12" fill="white" fontWeight="700">
                        Projected: {formatNumber(hoveredPoint.projectedStockValue)}
                      </text>
                    ) : null}
                    <text x="12" y={hoveredPoint.projectedStockValue !== null ? "59" : "45"} fontSize="12" fill="white" fontWeight="700">
                      Remaining starts: {formatNumber(hoveredPoint.remainingHouseStarts, 0)}
                    </text>
                    <text x="12" y={hoveredPoint.projectedStockValue !== null ? "73" : "59"} fontSize="12" fill="white" fontWeight="700">
                      Starts today: {formatNumber(hoveredPoint.house_starts, 0)}
                    </text>
                  </g>
                </g>
              ) : null}
              <text x={chart.padding.left} y={chart.height - 8} fontSize="11" fill="currentColor" opacity="0.55">
                {formatDate(chart.points[0]?.date)}
              </text>
              <text x={chart.width - chart.padding.right} y={chart.height - 8} textAnchor="end" fontSize="11" fill="currentColor" opacity="0.55">
                {formatDate(chart.points[chart.points.length - 1]?.date)}
              </text>
              </svg>
            ) : !selectedHouseTypeId ? (
              <p className="text-xs text-zinc-500">Select a house type to load the project comparison.</p>
            ) : comparison ? (
              <div className="text-sm text-zinc-500">No house-start data available for this range and house type.</div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="flex flex-1 min-h-0">
        <div className="flex-1 min-w-0 flex flex-col">
          {children}
        </div>
        
        <aside className="w-[320px] lg:w-[380px] shrink-0 p-4 md:p-6 overflow-y-auto border-l border-black/5 dark:border-white/5 bg-zinc-50/10 dark:bg-black/10 flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <SummaryMetric label="Observed / house" value={formatNumber(actualConsumptionPerHouse)} emphasis />
            <SummaryMetric
              label={selectedHouseType ? `Defined / ${selectedHouseType.name}` : "Defined / house"}
              value={formatNumber(definedQuantityPerHouse)}
            />
            <SummaryMetric label="Delta / house" value={formatNumber(quantityDelta)} />
            <SummaryMetric label="Cost delta" value={formatCurrency(costDeltaPerHouse)} />
          </div>
          <div className="rounded-xl border border-black/10 dark:border-white/10 bg-white/70 dark:bg-white/[0.04] px-3 py-2.5 text-xs text-zinc-500 dark:text-zinc-400">
            {selectionBounds ? "Using the selected graph range." : "Using the full visible range."}
            {deltaPercent !== null ? (
              <div className="mt-1 font-mono text-zinc-700 dark:text-zinc-200">{formatPercent(deltaPercent)} vs model</div>
            ) : null}
            {selectedHouseType ? (
              <div className="mt-1 font-mono text-zinc-600 dark:text-zinc-300">
                House type: {selectedHouseType.name}
              </div>
            ) : null}
          </div>
          <div className="flex flex-col gap-2 mt-2">
            <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">
              Quantity to save
              <input
                type="text"
                inputMode="decimal"
                value={manualValue}
                onChange={(event) => setManualValue(event.target.value)}
                disabled={disabled}
                className="mt-1 w-full bg-white dark:bg-black/40 border border-black/10 dark:border-white/10 rounded px-3 py-1.5 font-mono text-sm text-zinc-900 dark:text-white"
              />
            </label>
          </div>
          <div className="flex flex-col gap-2">
            <button
              type="button"
              className="px-3 py-1.5 rounded bg-accent-500/20 border border-accent-500/30 text-xs font-semibold text-accent-700 dark:text-accent-300 hover:bg-accent-500/30 disabled:opacity-50"
              onClick={() => void handleSaveFromRange()}
              disabled={disabled || !houseSummary || houseSummary.averageConsumptionPerHouse === null}
              title="Save the per-house consumption computed from the selected range"
            >
              <i className="ph-bold ph-check" /> Use selected consumption
            </button>
            <button
              type="button"
              className="px-3 py-1.5 rounded border border-black/10 dark:border-white/10 bg-white dark:bg-white/5 text-xs font-semibold text-zinc-800 dark:text-zinc-100 hover:bg-black/10 dark:hover:bg-white/10 disabled:opacity-50"
              onClick={() => void handleSaveManual()}
              disabled={disabled || parseNumberInput(manualValue) === null}
              title="Save the value entered above"
            >
              Save manual value
            </button>
            <span className="text-[10px] text-zinc-500 font-mono mt-1 text-center">
              Saved quantity: {formatNumber(currentQuantity)} · Unit price: {formatCurrency(target.row.price)}
            </span>
          </div>
        </aside>
      </div>
    </div>
  );
}

type CostModelRowViewProps = {
  row: CostModelRow;
  subtypeColumns: Array<{ id: number | null; name: string }>;
  viewBySubtype: boolean;
  canEdit: boolean;
  savingKey: string | null;
  usageMetric: MaterialDashboardEconomicMetricsResponse["metrics"][number] | null;
  selectedConsumption: ConsumptionSelection | null;
  onFocusConsumption: (subtypeId: number | null) => void;
  onOpenDetails: () => void;
  onUpsert: (
    row: CostModelRow,
    subtypeId: number | null,
    adjustedQuantity: number,
    source?: {
      kind?: string;
    },
  ) => Promise<void>;
  onDelete: (row: CostModelRow, subtypeId: number | null) => Promise<void>;
};

function CostModelRowView({
  row,
  subtypeColumns,
  viewBySubtype,
  canEdit,
  savingKey,
  usageMetric,
  selectedConsumption,
  onFocusConsumption,
  onOpenDetails,
  onUpsert,
  onDelete,
}: CostModelRowViewProps) {
  const rowTotal = computeDisplayedQuantity(row, null);
  const rowCost = quantityCost(rowTotal, row.price);
  const aggregateAdjustment = findAggregateAdjustment(row);
  const rowSelected = selectedConsumption?.sku === row.sku;
  const rowHasOverrides = row.adjustments.length > 0;
  const usageDelta = usageMetric?.consumption_delta_percent ?? null;
  const usageDeltaClass =
    usageDelta === null
      ? "text-zinc-400 dark:text-zinc-600"
      : Math.abs(usageDelta) < 0.05
        ? "text-zinc-600 dark:text-zinc-300"
        : usageDelta > 0
          ? "text-red-700 dark:text-red-300"
          : "text-emerald-700 dark:text-emerald-300";

  return (
    <tr
      tabIndex={row.is_auxiliary ? -1 : 0}
      onClick={() => {
        if (!row.is_auxiliary) {
          onFocusConsumption(null);
        }
      }}
      onFocus={() => {
        if (!row.is_auxiliary) {
          onFocusConsumption(null);
        }
      }}
      className={[
        "border-b border-black/5 dark:border-white/5 transition-colors",
        row.is_auxiliary ? "" : "cursor-pointer hover:bg-zinc-50/60 dark:hover:bg-white/5",
        rowSelected ? "bg-accent-500/[0.06] dark:bg-accent-500/[0.08]" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <td className="px-4 py-3 font-mono text-[11px] whitespace-nowrap">
        <div className="inline-flex items-center gap-2">
          <span className="font-semibold text-zinc-800 dark:text-zinc-200">{row.sku}</span>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onOpenDetails();
            }}
            className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-black/10 bg-white/80 text-zinc-500 transition-colors hover:border-accent-500/50 hover:text-accent-700 dark:border-white/10 dark:bg-white/[0.06] dark:text-zinc-400 dark:hover:text-accent-300"
            title={`View ${row.material_name} details`}
            aria-label={`View ${row.material_name} details`}
          >
            <i className="ph-bold ph-info text-[11px]" />
          </button>
          {row.is_auxiliary ? (
            <span className="px-1.5 py-0.5 rounded bg-zinc-200 dark:bg-white/10 text-[9px] uppercase tracking-widest text-zinc-600 dark:text-zinc-400">
              aux
            </span>
          ) : null}
          {rowHasOverrides ? (
            <span className="rounded-full border border-amber-300/70 bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-widest text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
              override
            </span>
          ) : null}
        </div>
      </td>
      <td className="px-4 py-3">
        <span className="font-medium text-zinc-900 dark:text-zinc-100">
          {row.material_name}
        </span>
        {row.unit ? (
          <span className="ml-2 text-[10px] text-zinc-500 font-mono">{row.unit}</span>
        ) : null}
      </td>
      <td className="px-4 py-3 text-right font-mono text-[11px] text-zinc-700 dark:text-zinc-300 whitespace-nowrap">
        {formatCurrency(row.price)}
      </td>
      <td className="px-4 py-3 text-right">
        <AdjustableQuantityCell
          row={row}
          subtypeId={null}
          estimated={row.estimated_total_quantity}
          adjustment={aggregateAdjustment}
          selected={Boolean(rowSelected && selectedConsumption?.subtypeId === null)}
          canEdit={canEdit && !row.is_auxiliary}
          saving={savingKey === `${row.material_id}:null`}
          onFocusConsumption={() => onFocusConsumption(null)}
          onUpsert={(value) => onUpsert(row, null, value)}
          onDelete={() => onDelete(row, null)}
        />
      </td>
      <td
        className={`px-4 py-3 text-right font-mono text-[11px] whitespace-nowrap ${usageDeltaClass}`}
        title={
          usageMetric
            ? `Usage: ${formatNumber(usageMetric.material_per_house)} / house; expected: ${formatNumber(usageMetric.predicted_quantity_per_house)} / house`
            : "No usage comparison available for this material and date range"
        }
      >
        {formatPercent(usageDelta)}
      </td>
      {viewBySubtype
        ? subtypeColumns.map((col) => {
            const subtypeEntry = row.subtypes.find((entry) => entry.subtype_id === col.id);
            if (!subtypeEntry) {
              return (
                <td key={col.id ?? "none"} className="px-4 py-3 text-right text-zinc-400 dark:text-zinc-600 font-mono text-[11px]">
                  —
                </td>
              );
            }
            const subtypeAdjustment = findSubtypeAdjustment(row, col.id);
            return (
              <td key={col.id ?? "none"} className="px-4 py-3 text-right">
                <AdjustableQuantityCell
                  row={row}
                  subtypeId={col.id}
                  estimated={subtypeEntry.estimated_quantity}
                  adjustment={subtypeAdjustment}
                  selected={Boolean(rowSelected && selectedConsumption?.subtypeId === col.id)}
                  canEdit={canEdit && !row.is_auxiliary}
                  saving={savingKey === `${row.material_id}:${col.id ?? "null"}`}
                  onFocusConsumption={() => onFocusConsumption(col.id)}
                  onUpsert={(value) => onUpsert(row, col.id, value)}
                  onDelete={() => onDelete(row, col.id)}
                />
              </td>
            );
          })
        : null}
      <td className="px-4 py-3 text-right font-mono text-[11px] text-zinc-900 dark:text-white whitespace-nowrap">
        {formatCurrency(rowCost)}
      </td>
    </tr>
  );
}

type AdjustableQuantityCellProps = {
  row: CostModelRow;
  subtypeId: number | null;
  estimated: number | null;
  adjustment: CostModelAdjustment | null;
  selected: boolean;
  canEdit: boolean;
  saving: boolean;
  onFocusConsumption: () => void;
  onUpsert: (value: number) => Promise<void>;
  onDelete: () => Promise<void>;
};

function AdjustableQuantityCell({
  row,
  subtypeId,
  estimated,
  adjustment,
  selected,
  canEdit,
  saving,
  onFocusConsumption,
  onUpsert,
  onDelete,
}: AdjustableQuantityCellProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const effective = computeDisplayedQuantity(row, subtypeId);
  const isOverridden = adjustment !== null;
  const isImplicit = subtypeId === null && !adjustment && rowHasSubtypeAdjustments(row);

  useEffect(() => {
    if (!modalOpen) {
      setDraft("");
    } else {
      setDraft(effective !== null ? String(effective) : "");
    }
  }, [modalOpen, effective]);

  async function handleCommit() {
    const parsed = parseNumberInput(draft);
    if (parsed === null) {
      setModalOpen(false);
      return;
    }
    await onUpsert(parsed);
    setModalOpen(false);
  }

  return (
    <>
      <div
        className={[
          "inline-flex items-center gap-1.5 justify-end rounded-lg px-1.5 py-1",
          selected ? "bg-accent-500/10 ring-1 ring-accent-500/40" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            if (canEdit && !row.is_auxiliary) {
              onFocusConsumption();
              setModalOpen(true);
            }
          }}
          disabled={!canEdit || row.is_auxiliary}
          className={
            isOverridden
              ? "px-2 py-0.5 rounded font-mono text-[11px] bg-amber-100 dark:bg-amber-500/15 text-amber-800 dark:text-amber-200 border border-amber-300/50 dark:border-amber-500/30 hover:bg-amber-200 dark:hover:bg-amber-500/30 transition-colors"
              : isImplicit
                ? "px-2 py-0.5 rounded font-mono text-[11px] bg-amber-50 dark:bg-amber-500/5 text-amber-700 dark:text-amber-300 border border-amber-200/50 dark:border-amber-500/20 italic hover:bg-amber-100 dark:hover:bg-amber-500/10 transition-colors"
                : "font-mono text-[11px] text-zinc-800 dark:text-zinc-200 hover:text-accent-600 dark:hover:text-accent-400 transition-colors"
          }
          title={
            isOverridden
              ? `Adjusted from ${formatNumber(estimated)} to ${formatNumber(effective)}`
              : isImplicit
                ? "Implied from per-subtype adjustments"
                : "Estimated from BOM"
          }
        >
          {formatNumber(effective)}
        </button>
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={`Edit Quantity: ${row.sku}`}>
        <div className="p-4 flex flex-col gap-4">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {row.material_name}
            {subtypeId !== null ? ` (Subtype: ${getSubtypeLabel(row, subtypeId)})` : ""}
          </p>

          <div className="flex flex-col gap-2">
            <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">
              Quantity
            </label>
            <input
              autoFocus
              type="text"
              inputMode="decimal"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  void handleCommit();
                } else if (event.key === "Escape") {
                  setModalOpen(false);
                }
              }}
              placeholder={estimated !== null ? String(estimated) : "0"}
              className="bg-white dark:bg-black/40 border border-black/10 dark:border-white/10 rounded px-3 py-2 text-sm font-mono text-zinc-900 dark:text-white outline-none focus:border-accent-500/50"
            />
          </div>

          <div className="flex justify-between items-center mt-4">
            {isOverridden ? (
              <button
                type="button"
                className="px-3 py-1.5 rounded border border-amber-300 dark:border-amber-500/30 text-xs font-semibold text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-500/10 disabled:opacity-50"
                onClick={() => {
                  void onDelete();
                  setModalOpen(false);
                }}
                disabled={saving}
              >
                Revert to {formatNumber(estimated)}
              </button>
            ) : (
              <div />
            )}
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="px-3 py-1.5 rounded text-xs font-semibold text-zinc-600 dark:text-zinc-300 hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-50"
                onClick={() => setModalOpen(false)}
                disabled={saving}
              >
                Cancel
              </button>
              <button
                type="button"
                className="px-3 py-1.5 rounded border border-black/10 dark:border-white/10 text-xs font-semibold text-zinc-800 dark:text-zinc-100 bg-accent-500/20 hover:bg-accent-500/30 disabled:opacity-50"
                onClick={() => void handleCommit()}
                disabled={saving}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      </Modal>
    </>
  );
}

function DetailsModal({ row, onClose }: { row: CostModelRow | null; onClose: () => void }) {
  const grouped = useMemo(() => {
    type Group = { subtypeId: number | null; subtypeName: string; instances: CostModelRow["instances"] };
    if (!row) {
      return [] as Group[];
    }
    const map = new Map<string, Group>();
    for (const instance of row.instances) {
      const key = instance.subtype_id === null ? "__none__" : String(instance.subtype_id);
      const bucket = map.get(key);
      if (bucket) {
        bucket.instances.push(instance);
      } else {
        map.set(key, {
          subtypeId: instance.subtype_id,
          subtypeName: instance.subtype_name,
          instances: [instance],
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.subtypeName.localeCompare(b.subtypeName, "es"));
  }, [row]);

  return (
    <Modal
      open={row !== null}
      title={row ? `${row.sku} — ${row.material_name}` : ""}
      kicker="Per-instance breakdown"
      onClose={onClose}
      panelClassName="max-w-3xl"
    >
      {row ? (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-3 gap-4 text-xs">
            <Stat label="Unit" value={row.unit || "—"} />
            <Stat label="Unit price" value={formatCurrency(row.price)} />
            <Stat label="Estimated total" value={formatNumber(row.estimated_total_quantity)} />
          </div>
          {grouped.length === 0 ? (
            <p className="text-xs text-zinc-500">No instance-level data available for this material.</p>
          ) : (
            grouped.map((group) => (
              <section
                key={group.subtypeId ?? "none"}
                className="rounded-xl border border-black/10 dark:border-white/10 overflow-hidden"
              >
                <header className="px-4 py-2 bg-zinc-50 dark:bg-white/5 border-b border-black/5 dark:border-white/5 flex items-center justify-between">
                  <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">{group.subtypeName}</span>
                  <span className="text-[10px] font-mono text-zinc-500">
                    {group.instances.length} instance{group.instances.length === 1 ? "" : "s"}
                  </span>
                </header>
                <ul className="divide-y divide-black/5 dark:divide-white/5">
                  {group.instances.map((instance: CostModelRow["instances"][number], index: number) => (
                    <li
                      key={`${instance.instance_id ?? "x"}-${index}`}
                      className="px-4 py-2 flex items-center justify-between gap-4 text-xs"
                    >
                      <div className="flex flex-col min-w-0">
                        <span className="text-zinc-900 dark:text-zinc-100 truncate">
                          {instance.instance_name ?? "—"}
                        </span>
                        {instance.category_label ? (
                          <span className="text-[10px] text-zinc-500 font-mono truncate">
                            {instance.category_label}
                          </span>
                        ) : null}
                      </div>
                      <span
                        className={
                          instance.quantity_state === "blank"
                            ? "font-mono text-[11px] text-amber-700 dark:text-amber-300"
                            : instance.quantity_state === "zero"
                              ? "font-mono text-[11px] text-zinc-400"
                              : "font-mono text-[11px] text-zinc-900 dark:text-white"
                        }
                      >
                        {instance.quantity_state === "blank"
                          ? "blank"
                          : instance.quantity_state === "zero"
                            ? "0"
                            : formatNumber(instance.quantity)}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>
      ) : null}
    </Modal>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-black/10 dark:border-white/10 px-3 py-2">
      <p className="text-[10px] uppercase tracking-widest font-semibold text-zinc-500">{label}</p>
      <p className="font-mono text-sm text-zinc-900 dark:text-white">{value}</p>
    </div>
  );
}
