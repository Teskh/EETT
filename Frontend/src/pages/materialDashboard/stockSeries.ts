import type { MaterialDashboardMovementPoint } from "../../lib/types";

import { isWeekend, moveToPreviousBusinessDay, toStartOfDay } from "./dates";

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

export function buildLinePath(points: StockSeriesPoint[], width: number, height: number) {
  if (!points.length) {
    return null;
  }
  const padding = CHART_PADDING;
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const maxValue = Math.max(...points.map((point) => point.value), 1);

  const chartPoints = points.map((point, index) => {
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

/**
 * Reconstructs the day-by-day stock level by walking backwards from today's
 * stock on hand and undoing each day's movements. Weekend days are skipped
 * unless `includeWeekends` is set, matching how the plant operates.
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
  const today = toStartOfDay(new Date());
  const anchorDate = includeWeekends ? today : moveToPreviousBusinessDay(today);
  const dailyMovementMap = new Map<number, number>();
  for (const point of movements) {
    const time = toStartOfDay(point.date).getTime();
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
