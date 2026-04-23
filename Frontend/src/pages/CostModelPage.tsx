import { useEffect, useMemo, useState, type PointerEvent as ReactPointerEvent } from "react";

import { Modal } from "../components/Modal";
import { ApiError, api } from "../lib/api";
import type {
  CostModelAdjustment,
  CostModelRow,
  CostModelView,
  MaterialDashboardDetailData,
  MaterialDashboardHouseComparisonData,
  MaterialDashboardHouseType,
  MaterialDashboardMovementData,
  MaterialDashboardMovementPoint,
  SessionUser,
} from "../lib/types";

type CostModelPageProps = {
  projectId: number;
  onNavigate: (to: string) => void;
  onTitleChange?: (title: string) => void;
  currentUser: SessionUser;
};

type ConsumptionSelection = {
  sku: string;
  subtypeId: number | null;
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
const CHART_WIDTH = 760;
const CHART_HEIGHT = 250;

const numberFormatter = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 2 });
const integerFormatter = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 0 });
const currencyFormatter = new Intl.NumberFormat("es-CL", {
  style: "currency",
  currency: "CLP",
  maximumFractionDigits: 0,
});
const percentFormatter = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 1 });

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
  const [view, setView] = useState<CostModelView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [viewBySubtype, setViewBySubtype] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [detailsRow, setDetailsRow] = useState<CostModelRow | null>(null);
  const [consumptionSelection, setConsumptionSelection] = useState<ConsumptionSelection | null>(null);

  const canEdit = currentUser.permissions.project_edit;

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getCostModel(projectId);
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
  }, [projectId]);

  useEffect(() => {
    if (view?.project.name) {
      onTitleChange?.(view.project.name);
    }
  }, [onTitleChange, view?.project.name]);

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
    const selectableRows = filteredRows.filter((row) => !row.is_auxiliary);
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
  }, [filteredRows, consumptionSelection]);

  const selectedConsumptionTarget = useMemo<ConsumptionTarget | null>(() => {
    if (!consumptionSelection) {
      return null;
    }
    const row = filteredRows.find((entry) => !entry.is_auxiliary && entry.sku === consumptionSelection.sku) ?? null;
    if (!row) {
      return null;
    }
    return {
      row,
      subtypeId: consumptionSelection.subtypeId,
    };
  }, [consumptionSelection, filteredRows]);

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
    if (row.material_id === null) {
      return;
    }
    const key = `${row.material_id}:${subtypeId ?? "null"}`;
    setSavingKey(key);
    setError(null);
    try {
      const next = await api.upsertCostModelAdjustment(projectId, {
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
      setError(err instanceof ApiError ? err.message : "Could not save adjustment.");
    } finally {
      setSavingKey(null);
    }
  }

  async function handleDelete(row: CostModelRow, subtypeId: number | null) {
    if (row.material_id === null) {
      return;
    }
    const key = `${row.material_id}:${subtypeId ?? "null"}`;
    setSavingKey(key);
    setError(null);
    try {
      const next = await api.deleteCostModelAdjustment(projectId, {
        material_id: row.material_id,
        subtype_id: subtypeId,
      });
      setView(next);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not remove adjustment.");
    } finally {
      setSavingKey(null);
    }
  }

  if (loading) {
    return (
      <div className="liquid-glass rounded-2xl p-8 text-sm text-zinc-600 dark:text-zinc-400">Loading cost model...</div>
    );
  }
  if (!view) {
    return (
      <div className="liquid-glass rounded-2xl p-8 text-sm text-zinc-600 dark:text-zinc-400">
        Cost model not available.
      </div>
    );
  }

  return (
    <div className="max-w-[1700px] mx-auto h-[calc(100vh-7rem)] flex flex-col gap-4 overflow-hidden">
      {error ? (
        <div className="rounded-xl border border-red-200 dark:border-red-500/20 bg-red-100 dark:bg-red-500/10 px-4 py-3 text-sm text-red-800 dark:text-red-200">
          {error}
        </div>
      ) : null}

      <section className="shrink-0">
        <div className="grid gap-4 lg:grid-cols-[minmax(280px,340px),minmax(0,1fr)]">
          <header className="liquid-glass rounded-2xl border border-black/10 dark:border-white/10 p-4 flex flex-col gap-3">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-[10px] font-bold text-accent-600 dark:text-accent-500 uppercase tracking-widest mb-1">
                  Cost Model
                </p>
                <h1 className="text-xl font-bold text-zinc-900 dark:text-white tracking-tight break-words">{view.project.name}</h1>
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-1 font-mono">
                  {view.rows.length} materials · {view.project.instance_count} instances · material mode {view.material_mode}
                </p>
              </div>
              <button
                type="button"
                className="px-3 py-1.5 rounded border border-black/10 dark:border-white/10 bg-zinc-50 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 text-xs font-semibold text-zinc-900 dark:text-white transition-colors flex items-center gap-1.5"
                onClick={() => onNavigate(`/projects/${projectId}`)}
              >
                <i className="ph-bold ph-arrow-left" /> Back
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-xs font-semibold text-zinc-700 dark:text-zinc-200 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={viewBySubtype}
                  onChange={(event) => setViewBySubtype(event.target.checked)}
                />
                View by subtype
              </label>
              <input
                type="text"
                placeholder="Filter by SKU or material..."
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                className="flex-1 min-w-[220px] bg-white dark:bg-black/40 border border-black/10 dark:border-white/10 rounded-lg py-1.5 px-3 text-sm text-zinc-800 dark:text-zinc-300 placeholder:text-zinc-500 focus:outline-none focus:border-accent-500/50 font-mono"
              />
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <SummaryMetric label="Visible total" value={formatCurrency(totals?.totalCost ?? null)} emphasis />
              <SummaryMetric label="Visible materials" value={formatNumber(filteredRows.length, 0)} />
            </div>

            {viewBySubtype && subtypeColumns.length > 0 && totals ? (
              <div className="space-y-1">
                <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-zinc-500">Subtype totals in view</p>
                <div className="flex gap-2 overflow-x-auto pb-1">
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
          </header>

          <InlineConsumptionPanel
            target={selectedConsumptionTarget}
            projectId={projectId}
            canEdit={canEdit}
            onSave={handleUpsert}
          />
        </div>
      </section>

      <section className="liquid-glass rounded-2xl border border-black/10 dark:border-white/10 overflow-hidden min-h-0 flex-1">
        <div className="h-full overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-white/90 dark:bg-zinc-900/90 backdrop-blur">
              <tr className="text-left text-[11px] uppercase tracking-widest text-zinc-500 dark:text-zinc-400 border-b border-black/10 dark:border-white/10">
                <th className="px-4 py-3 font-semibold">SKU</th>
                <th className="px-4 py-3 font-semibold">Material</th>
                <th className="px-4 py-3 font-semibold text-right">Unit price</th>
                <th className="px-4 py-3 font-semibold text-right">Qty</th>
                {viewBySubtype
                  ? subtypeColumns.map((col) => (
                      <th key={col.id ?? "none"} className="px-4 py-3 font-semibold text-right">
                        {col.name}
                      </th>
                    ))
                  : null}
                <th className="px-4 py-3 font-semibold text-right">Cost</th>
                <th className="px-4 py-3 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.length === 0 ? (
                <tr>
                  <td
                    colSpan={viewBySubtype ? 6 + subtypeColumns.length : 6}
                    className="px-4 py-8 text-center text-zinc-500 dark:text-zinc-400 text-xs"
                  >
                    No materials match the current filter.
                  </td>
                </tr>
              ) : null}
              {filteredRows.map((row) => (
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
                />
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <DetailsModal row={detailsRow} onClose={() => setDetailsRow(null)} />
    </div>
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

function SubtypeTotalChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-full border border-black/10 dark:border-white/10 bg-white/70 dark:bg-white/[0.04] px-3 py-1.5 text-xs">
      <span className="font-semibold text-zinc-700 dark:text-zinc-100">{label}</span>
      <span className="ml-2 font-mono text-zinc-500 dark:text-zinc-300">{value}</span>
    </div>
  );
}

type InlineConsumptionPanelProps = {
  target: ConsumptionTarget | null;
  projectId: number;
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
};

function InlineConsumptionPanel({ target, projectId, canEdit, onSave }: InlineConsumptionPanelProps) {
  const [houseTypes, setHouseTypes] = useState<MaterialDashboardHouseType[]>([]);
  const [selectedHouseType, setSelectedHouseType] = useState<number | null>(null);
  const [houseRange, setHouseRange] = useState<HouseRange>(() => getDefaultHouseRange());
  const [detail, setDetail] = useState<MaterialDashboardDetailData | null>(null);
  const [history, setHistory] = useState<MaterialDashboardMovementData | null>(null);
  const [comparison, setComparison] = useState<MaterialDashboardHouseComparisonData | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [selection, setSelection] = useState<ChartSelection | null>(null);
  const [dragAnchorIndex, setDragAnchorIndex] = useState<number | null>(null);
  const [dragCurrentIndex, setDragCurrentIndex] = useState<number | null>(null);
  const [hoveredPointIndex, setHoveredPointIndex] = useState<number | null>(null);
  const [manualValue, setManualValue] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!target) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const response = await api.getMaterialDashboardHouseTypes();
        if (cancelled) {
          return;
        }
        setHouseTypes(response.house_types);
        setSelectedHouseType((current) => {
          if (current !== null && response.house_types.some((houseType) => houseType.id === current)) {
            return current;
          }
          return response.house_types[0]?.id ?? null;
        });
      } catch (err) {
        if (!cancelled) {
          setFetchError(err instanceof ApiError ? err.message : "Could not load house types.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [target?.row.sku]);

  useEffect(() => {
    setSelection(null);
    setDragAnchorIndex(null);
    setDragCurrentIndex(null);
    setHoveredPointIndex(null);
  }, [target?.row.sku, target?.subtypeId]);

  useEffect(() => {
    if (!target || !selectedHouseType) {
      setDetail(null);
      setHistory(null);
      setComparison(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setFetchError(null);

    void (async () => {
      try {
        const [detailData, historyData, comparisonData] = await Promise.all([
          api.getMaterialDashboardDetail(target.row.sku),
          api.getMaterialDashboardHistory(target.row.sku, {}, {
            startDate: houseRange.startDate,
            endDate: houseRange.endDate,
          }),
          api.getMaterialDashboardHouseComparison(
            target.row.sku,
            selectedHouseType,
            {},
            {
              projectId,
              startDate: houseRange.startDate,
              endDate: houseRange.endDate,
            },
          ),
        ]);
        if (!cancelled) {
          setDetail(detailData);
          setHistory(historyData);
          setComparison(comparisonData);
        }
      } catch (err) {
        if (!cancelled) {
          setFetchError(err instanceof ApiError ? err.message : "Could not load consumption data.");
          setDetail(null);
          setHistory(null);
          setComparison(null);
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
  }, [projectId, selectedHouseType, target, houseRange.endDate, houseRange.startDate]);

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
  const quantityDelta =
    actualConsumptionPerHouse !== null && actualConsumptionPerHouse !== undefined && currentQuantity !== null
      ? actualConsumptionPerHouse - currentQuantity
      : null;
  const deltaPercent =
    quantityDelta !== null && currentQuantity !== null && currentQuantity !== 0
      ? (quantityDelta / currentQuantity) * 100
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
    setHouseRange((current) =>
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
    setHouseRange((current) =>
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
        house_type_id: selectedHouseType,
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
        house_type_id: selectedHouseType,
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
  const isBlockingLoad = !fetchError && Boolean(selectedHouseType) && (!detail || !history || !comparison);
  const selectionStart = selectionBounds && chart ? chart.points[selectionBounds.startIndex] ?? null : null;
  const selectionEnd = selectionBounds && chart ? chart.points[selectionBounds.endIndex] ?? null : null;

  if (!target) {
    return (
      <section className="liquid-glass rounded-2xl border border-black/10 dark:border-white/10 p-6 flex items-center justify-center min-h-[360px]">
        <div className="text-center max-w-md">
          <p className="text-[10px] font-bold uppercase tracking-[0.35em] text-zinc-500 mb-3">Consumption Study</p>
          <h2 className="text-xl font-semibold text-zinc-900 dark:text-white mb-2">Select a SKU to pin its graph</h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            The inline graph follows the focused material and becomes the source used for historic consumption overrides.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="liquid-glass rounded-2xl border border-black/10 dark:border-white/10 p-4 flex flex-col gap-3 min-h-[320px]">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
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
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            Click and drag across the graph to define the sample period used for this cost-model value.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={selectedHouseType ?? ""}
            onChange={(event) => setSelectedHouseType(event.target.value ? Number(event.target.value) : null)}
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
              onClick={() => setHouseRange(getDefaultHouseRange())}
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

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr),240px]">
        <div className="rounded-xl border border-black/10 dark:border-white/10 bg-white/60 dark:bg-white/[0.03] p-3">
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
          ) : !selectedHouseType ? (
            <p className="text-xs text-zinc-500">Select a house type to load the project comparison.</p>
          ) : isBlockingLoad ? (
            <p className="text-xs text-zinc-500">Loading consumption…</p>
          ) : comparison && chart ? (
            <svg
              viewBox={`0 0 ${chart.width} ${chart.height}`}
              className="w-full h-auto max-h-[285px] overflow-visible cursor-crosshair touch-none select-none"
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
          ) : loading ? (
            <p className="text-xs text-zinc-500">Loading consumption…</p>
          ) : !selectedHouseType ? (
            <p className="text-xs text-zinc-500">Select a house type to load the project comparison.</p>
          ) : comparison ? (
            <div className="text-sm text-zinc-500">No house-start data available for this range and house type.</div>
          ) : null}
        </div>

        <aside className="rounded-xl border border-black/10 dark:border-white/10 p-3 bg-zinc-50/60 dark:bg-white/[0.03] flex flex-col gap-3">
          <SummaryMetric label="Cons. / house" value={formatNumber(actualConsumptionPerHouse)} emphasis />
          <SummaryMetric label="Current model" value={formatNumber(currentQuantity)} />
          <SummaryMetric label="Delta / house" value={formatNumber(quantityDelta)} />
          <SummaryMetric label="Cost delta" value={formatCurrency(costDeltaPerHouse)} />
          <div className="rounded-xl border border-black/10 dark:border-white/10 bg-white/70 dark:bg-white/[0.04] px-3 py-2.5 text-xs text-zinc-500 dark:text-zinc-400">
            {selectionBounds ? "Using the selected graph range." : "Using the full visible range."}
            {deltaPercent !== null ? (
              <div className="mt-1 font-mono text-zinc-700 dark:text-zinc-200">{formatPercent(deltaPercent)} vs model</div>
            ) : null}
          </div>
          <div className="flex flex-col gap-2">
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
            <span className="text-[10px] text-zinc-500 font-mono">
              Current model: {formatNumber(currentQuantity)} · Unit price: {formatCurrency(target.row.price)}
            </span>
          </div>
        </aside>
      </div>
    </section>
  );
}

type CostModelRowViewProps = {
  row: CostModelRow;
  subtypeColumns: Array<{ id: number | null; name: string }>;
  viewBySubtype: boolean;
  canEdit: boolean;
  savingKey: string | null;
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
      <td className="px-4 py-3 font-mono text-[11px] text-zinc-800 dark:text-zinc-200 whitespace-nowrap">
        {row.sku}
        {row.is_auxiliary ? (
          <span className="ml-2 px-1.5 py-0.5 rounded bg-zinc-200 dark:bg-white/10 text-[9px] uppercase tracking-widest text-zinc-600 dark:text-zinc-400">
            aux
          </span>
        ) : null}
      </td>
      <td className="px-4 py-3 text-zinc-900 dark:text-zinc-100">
        {row.material_name}
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
      <td className="px-4 py-3 text-right whitespace-nowrap">
        <div className="inline-flex items-center gap-1.5">
          <button
            type="button"
            className="px-2 py-1 rounded border border-black/10 dark:border-white/10 bg-white dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 text-[10px] font-semibold text-zinc-800 dark:text-zinc-100"
            onClick={(event) => {
              event.stopPropagation();
              onOpenDetails();
            }}
            title="Show per-instance/subtype breakdown"
          >
            <i className="ph-bold ph-list-magnifying-glass" /> Details
          </button>
        </div>
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
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const effective = computeDisplayedQuantity(row, subtypeId);
  const isOverridden = adjustment !== null;
  const isImplicit = subtypeId === null && !adjustment && rowHasSubtypeAdjustments(row);

  useEffect(() => {
    if (!editing) {
      setDraft("");
    }
  }, [editing]);

  async function handleCommit() {
    const parsed = parseNumberInput(draft);
    if (parsed === null) {
      setEditing(false);
      return;
    }
    await onUpsert(parsed);
    setEditing(false);
  }

  if (editing) {
    return (
      <div className="inline-flex items-center gap-1">
        <input
          autoFocus
          type="text"
          inputMode="decimal"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              void handleCommit();
            } else if (event.key === "Escape") {
              setEditing(false);
            }
          }}
          placeholder={estimated !== null ? String(estimated) : "0"}
          className="w-24 bg-white dark:bg-black/40 border border-accent-500/50 rounded px-2 py-1 text-xs font-mono text-right text-zinc-900 dark:text-white"
        />
        <button
          type="button"
          className="px-1.5 py-1 rounded border border-black/10 dark:border-white/10 text-[10px] font-semibold text-zinc-800 dark:text-zinc-100 bg-accent-500/20 hover:bg-accent-500/30"
          onClick={(event) => {
            event.stopPropagation();
            void handleCommit();
          }}
          disabled={saving}
        >
          <i className="ph-bold ph-check" />
        </button>
        <button
          type="button"
          className="px-1.5 py-1 rounded border border-black/10 dark:border-white/10 text-[10px] text-zinc-600 dark:text-zinc-300"
          onClick={(event) => {
            event.stopPropagation();
            setEditing(false);
          }}
          disabled={saving}
        >
          <i className="ph-bold ph-x" />
        </button>
      </div>
    );
  }

  return (
    <div
      className={[
        "inline-flex items-center gap-1.5 justify-end rounded-lg px-1.5 py-1",
        selected ? "bg-accent-500/10 ring-1 ring-accent-500/40" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <span
        className={
          isOverridden
            ? "px-2 py-0.5 rounded font-mono text-[11px] bg-amber-100 dark:bg-amber-500/15 text-amber-800 dark:text-amber-200 border border-amber-300/50 dark:border-amber-500/30"
            : isImplicit
              ? "px-2 py-0.5 rounded font-mono text-[11px] bg-amber-50 dark:bg-amber-500/5 text-amber-700 dark:text-amber-300 border border-amber-200/50 dark:border-amber-500/20 italic"
              : "font-mono text-[11px] text-zinc-800 dark:text-zinc-200"
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
      </span>
      {canEdit ? (
        <>
          <button
            type="button"
            className="px-1.5 py-1 rounded border border-black/10 dark:border-white/10 text-[10px] text-zinc-700 dark:text-zinc-200 hover:bg-black/10 dark:hover:bg-white/10"
            onClick={(event) => {
              event.stopPropagation();
              setDraft(effective !== null ? String(effective) : "");
              setEditing(true);
            }}
            title={isOverridden ? "Edit adjustment" : "Override quantity"}
          >
            <i className="ph-bold ph-pencil-simple" />
          </button>
          {!row.is_auxiliary ? (
            <button
              type="button"
              className="px-1.5 py-1 rounded border border-black/10 dark:border-white/10 text-[10px] text-zinc-700 dark:text-zinc-200 hover:bg-black/10 dark:hover:bg-white/10"
              onClick={(event) => {
                event.stopPropagation();
                onFocusConsumption();
              }}
              title="Focus inline consumption chart"
            >
              <i className="ph-bold ph-chart-line-up" />
            </button>
          ) : null}
          {isOverridden ? (
            <button
              type="button"
              className="px-1.5 py-1 rounded border border-amber-300 dark:border-amber-500/30 text-[10px] text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-500/10"
              onClick={(event) => {
                event.stopPropagation();
                void onDelete();
              }}
              disabled={saving}
              title="Revert to estimated quantity"
            >
              <i className="ph-bold ph-arrow-counter-clockwise" />
            </button>
          ) : null}
        </>
      ) : null}
      {subtypeId === null && isOverridden && adjustment?.source_kind && adjustment.source_kind !== "manual" ? (
        <span
          className="text-[9px] uppercase tracking-widest font-semibold text-amber-700 dark:text-amber-300"
          title={adjustment.source_kind}
        >
          {adjustment.source_kind}
        </span>
      ) : null}
    </div>
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
