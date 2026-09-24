import type { MaterialDashboardMovementPoint } from "../../lib/types";

import { moveToPreviousBusinessDay, toDateInputValue, toStartOfDay } from "./dates";

export const CHART_WIDTH = 760;
export const CHART_HEIGHT = 240;
const CHART_PADDING = { top: 18, right: 18, bottom: 26, left: 40 };

export type StockSeriesPoint = {
  date: string;
  value: number;
  time: number;
};

export type ChartPoint = StockSeriesPoint & {
  index: number;
  x: number;
  y: number;
};

export type ChartSelection = {
  startIndex: number;
  endIndex: number;
};

export type StockTrendSummary = {
  start: { date: string };
  end: { date: string };
  elapsedDays: number;
  stockDelta: number | null;
  consumed: number | null;
  averageConsumptionPerDay: number | null;
  averageConsumptionPerWeek: number | null;
};

export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function buildLinePath(points: StockSeriesPoint[], width: number, height: number, options: { fitValues?: boolean } = {}) {
  if (!points.length) {
    return null;
  }
  const padding = CHART_PADDING;
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const values = points.map((point) => point.value);
  // Fitting frames the axis on the observed values, so small charts show the
  // variation instead of a line hugging the top of a zero-based axis.
  const minValue = options.fitValues ? Math.min(...values) : 0;
  const maxValue = Math.max(...values, minValue + 1);

  const chartPoints = points.map((point, index) => {
    const x =
      points.length === 1
        ? padding.left + plotWidth / 2
        : padding.left + (index / (points.length - 1)) * plotWidth;
    const y = padding.top + plotHeight - ((point.value - minValue) / (maxValue - minValue)) * plotHeight;
    return { ...point, index, x, y };
  });

  const path = chartPoints
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(" ");

  return { path, points: chartPoints, minValue, maxValue, padding, plotHeight, plotWidth, width, height };
}

export function getClampedSelectionBounds(selection: ChartSelection, pointCount: number) {
  if (pointCount <= 0) {
    return null;
  }
  return {
    startIndex: clamp(Math.min(selection.startIndex, selection.endIndex), 0, pointCount - 1),
    endIndex: clamp(Math.max(selection.startIndex, selection.endIndex), 0, pointCount - 1),
  };
}

export function getSeriesSummary(points: ChartPoint[], selection?: ChartSelection | null): StockTrendSummary | null {
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
  const consumed = start.value - end.value;
  return {
    start,
    end,
    elapsedDays,
    stockDelta: end.value - start.value,
    consumed,
    averageConsumptionPerDay: consumed / elapsedDays,
    averageConsumptionPerWeek: (consumed / elapsedDays) * 5,
  };
}

export function getClosestPointIndex(points: Array<{ x: number; index: number }>, x: number) {
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

/** Shifts a YYYY-MM-DD key by whole calendar days, independent of DST. */
function shiftDayKey(key: string, days: number) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function isWeekendKey(key: string) {
  const [year, month, day] = key.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return weekday === 0 || weekday === 6;
}

/**
 * Reconstructs the day-by-day stock level by walking backwards from today's
 * stock on hand and undoing each day's movements. Weekend days are skipped
 * unless `includeWeekends` is set, matching how the plant operates.
 *
 * Days are walked as calendar keys, not timestamps: where DST starts at
 * midnight (Chile), that midnight does not exist and timestamp keys stop
 * matching, silently dropping every earlier movement.
 */
export function buildHistoricalStockSeries(
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
  const today = new Date();
  const anchorKey = toDateInputValue(includeWeekends ? today : moveToPreviousBusinessDay(today));
  const dailyMovementMap = new Map<string, number>();
  for (const point of movements) {
    const key = toDateInputValue(point.date);
    dailyMovementMap.set(key, (dailyMovementMap.get(key) || 0) + (Number(point.quantity) || 0));
  }

  const earliestMovementKey = dailyMovementMap.size ? [...dailyMovementMap.keys()].sort()[0] : anchorKey;
  const requestedEndKey = options.endDate ? toDateInputValue(options.endDate) : anchorKey;
  const endKey = requestedEndKey < anchorKey ? requestedEndKey : anchorKey;
  const requestedStartKey = options.startDate ? toDateInputValue(options.startDate) : earliestMovementKey;
  const startKey = requestedStartKey < endKey ? requestedStartKey : endKey;
  const history: StockSeriesPoint[] = [];
  const pushPoint = (key: string, value: number) => {
    if (!includeWeekends && isWeekendKey(key)) {
      return;
    }
    const date = toStartOfDay(key);
    history.unshift({ date: date.toISOString(), time: date.getTime(), value });
  };

  // Stock at the end of a day equals the next day's closing stock plus that
  // next day's outgoing movements.
  let runningStock = Number(currentStock);
  let key = toDateInputValue(today);
  while (key > endKey) {
    runningStock += dailyMovementMap.get(key) || 0;
    key = shiftDayKey(key, -1);
  }
  pushPoint(key, runningStock);
  while (key > startKey) {
    runningStock += dailyMovementMap.get(key) || 0;
    key = shiftDayKey(key, -1);
    pushPoint(key, runningStock);
  }

  return history;
}
