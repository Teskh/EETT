import type {
  MaterialDashboardExpectedBreakdown,
  MaterialDashboardMappedHouseComparisonData,
  MaterialDashboardMappedHouseComparisonPoint,
} from "../../lib/types";

import { inclusiveDaySpan, toStartOfDay } from "./dates";
import { getClampedSelectionBounds, type ChartSelection, type StockSeriesPoint, type StockTrendSummary } from "./stockSeries";

export type HouseTrendChartPoint = MaterialDashboardMappedHouseComparisonPoint & {
  index: number;
  x: number;
  stockValue: number | null;
  stockY: number | null;
  projectedStockValue: number | null;
  projectedStockY: number | null;
  remainingHouseStarts: number;
  houseY: number;
};

export type ProjectedStockByDayPoint = {
  projectedStockValue: number;
};

export type HouseComparisonChart = NonNullable<ReturnType<typeof buildHouseComparisonChart>>;

function roundTo4(value: number) {
  return Math.round(value * 10000) / 10000;
}

function getExpectedBreakdownKey(row: MaterialDashboardExpectedBreakdown) {
  if (row.mapped_project_id !== undefined && row.mapped_project_id !== null) {
    return `app:${row.mapped_project_id}:${row.mapped_project_subtype_id ?? "general"}`;
  }
  return `production:${row.house_type_id}:${row.sub_type_id ?? "general"}`;
}

function aggregateExpectedBreakdown(points: MaterialDashboardMappedHouseComparisonPoint[]) {
  const byKey = new Map<string, MaterialDashboardExpectedBreakdown>();
  points.forEach((point) => {
    (point.expected_breakdown || []).forEach((row) => {
      const key = getExpectedBreakdownKey(row);
      const existing = byKey.get(key);
      if (existing) {
        const previousStarts = existing.house_starts;
        const nextStarts = previousStarts + row.house_starts;
        existing.house_starts += row.house_starts;
        existing.total_expected_material_quantity = roundTo4(existing.total_expected_material_quantity + row.total_expected_material_quantity);
        existing.expected_quantity_per_house = nextStarts > 0
          ? roundTo4(existing.total_expected_material_quantity / nextStarts)
          : 0;
        existing.missing_quantity_count = Math.max(existing.missing_quantity_count || 0, row.missing_quantity_count || 0);

        const existingInstances = new Map(
          (existing.instance_breakdown || []).map((instance) => [instance.instance_id, instance]),
        );
        const nextInstances = new Map(
          (row.instance_breakdown || []).map((instance) => [instance.instance_id, instance]),
        );
        const instanceIds = new Set([...existingInstances.keys(), ...nextInstances.keys()]);
        existing.instance_breakdown = Array.from(instanceIds)
          .map((instanceId) => {
            const previous = existingInstances.get(instanceId);
            const next = nextInstances.get(instanceId);
            if (!previous && next) {
              return {
                ...next,
                quantity: roundTo4((next.quantity * row.house_starts) / nextStarts),
              };
            }
            if (previous && !next) {
              return {
                ...previous,
                quantity: roundTo4((previous.quantity * previousStarts) / nextStarts),
              };
            }
            if (previous && next) {
              return {
                ...previous,
                quantity: roundTo4((previous.quantity * previousStarts + next.quantity * row.house_starts) / nextStarts),
              };
            }
            return null;
          })
          .filter((instance): instance is NonNullable<typeof instance> => instance !== null)
          .sort((a, b) => a.instance_name.localeCompare(b.instance_name));
        return;
      }
      byKey.set(key, { ...row });
    });
  });

  return Array.from(byKey.values()).sort(
    (a, b) =>
      b.house_starts - a.house_starts ||
      (a.mapped_project_name || a.house_type_name).localeCompare(b.mapped_project_name || b.house_type_name) ||
      (a.mapped_project_subtype_name || a.sub_type_name || "").localeCompare(b.mapped_project_subtype_name || b.sub_type_name || ""),
  );
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

export function getStockValueForDate(stockSeries: StockSeriesPoint[], date: string) {
  const targetTime = toStartOfDay(date).getTime();
  const match = stockSeries.find((point) => toStartOfDay(point.date).getTime() === targetTime);
  return match ? match.value : null;
}

/**
 * Simulates the stock level the house type mapping predicts: starting from the
 * real stock on the first day of the comparison, subtract the expected
 * consumption of each day's mapped house starts.
 */
export function buildProjectedStockByDay(
  houseComparison: MaterialDashboardMappedHouseComparisonData | null,
  stockSeries: StockSeriesPoint[],
) {
  if (!houseComparison || !houseComparison.link_count || !houseComparison.points.length || !stockSeries.length) {
    return null;
  }
  const firstPoint = houseComparison.points[0];
  const firstStockValue = getStockValueForDate(stockSeries, firstPoint.date);
  if (firstStockValue === null) {
    return null;
  }

  const projectedStockByDay = new Map<number, ProjectedStockByDayPoint>();
  let runningProjectedStock = firstStockValue + (Number(firstPoint.material_quantity) || 0);

  houseComparison.points.forEach((point) => {
    runningProjectedStock -= Number(point.expected_material_quantity) || 0;
    projectedStockByDay.set(toStartOfDay(point.date).getTime(), {
      projectedStockValue: roundTo4(runningProjectedStock),
    });
  });

  return projectedStockByDay;
}

export function buildHouseComparisonChart(
  houseComparison: MaterialDashboardMappedHouseComparisonData,
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
  const stockValueByDay = new Map<number, number>();
  stockSeries.forEach((point) => {
    stockValueByDay.set(toStartOfDay(point.date).getTime(), point.value);
  });
  const finalStock = stockAxisBaseline ?? (stockSeries.length ? stockSeries[stockSeries.length - 1].value : 0);
  const totalHouseStarts = Math.max(houseComparison.total_house_starts, 0);

  const chartPoints = houseComparison.points.map((point, index) => {
    const pointTime = toStartOfDay(point.date).getTime();
    const x =
      houseComparison.points.length === 1
        ? padding.left + plotWidth / 2
        : padding.left + (index / (houseComparison.points.length - 1)) * plotWidth;
    const projectedPoint = projectedStockByDay?.get(pointTime) ?? null;
    return {
      ...point,
      index,
      x,
      stockValue: stockValueByDay.get(pointTime) ?? null,
      projectedStockValue: projectedPoint?.projectedStockValue ?? null,
      // Stock values represent the end of each day, so keep the house series
      // on the same boundary: starts remaining after that day's starts.
      remainingHouseStarts: Math.max(totalHouseStarts - point.cumulative_house_starts, 0),
    };
  });
  const combinedStockValues = chartPoints.flatMap((point) =>
    [point.stockValue, point.projectedStockValue].filter((value): value is number => value !== null),
  );
  const projectedStockValues = chartPoints
    .map((point) => point.projectedStockValue)
    .filter((value): value is number => value !== null);
  const projectedStart = projectedStockValues[0] ?? null;
  const projectedEnd = projectedStockValues[projectedStockValues.length - 1] ?? null;
  const hasProjectedReference = projectedStart !== null && projectedEnd !== null && projectedStart > projectedEnd;
  // In house-comparison mode the expected curve is the reference. Its first
  // and last values define the axis so it always runs from the top-left to the
  // bottom-right. Actual stock shares that frame and is free to deviate.
  const maxStock = hasProjectedReference
    ? projectedStart
    : Math.max(...combinedStockValues, stockAxisCeiling ?? Number.NEGATIVE_INFINITY, 1);
  const minStock = hasProjectedReference ? projectedEnd : Math.max(finalStock, 0);
  const stockRange = Math.max(maxStock - minStock, 1);
  const maxRemainingHouseStarts = Math.max(...chartPoints.map((point) => point.remainingHouseStarts), 1);
  const toStockY = (value: number) => padding.top + plotHeight - ((value - minStock) / stockRange) * plotHeight;
  const positionedPoints: HouseTrendChartPoint[] = chartPoints.map((point) => ({
    ...point,
    stockY: point.stockValue !== null ? toStockY(point.stockValue) : null,
    projectedStockY: point.projectedStockValue !== null ? toStockY(point.projectedStockValue) : null,
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

/** Recomputes the comparison's cumulative columns for a narrower date range. */
export function getHouseComparisonForRange(
  houseComparison: MaterialDashboardMappedHouseComparisonData | null,
  range: { startDate: string; endDate: string },
): MaterialDashboardMappedHouseComparisonData | null {
  if (!houseComparison) {
    return null;
  }
  const startTime = toStartOfDay(range.startDate).getTime();
  const endTime = toStartOfDay(range.endDate).getTime();
  let cumulativeMaterialQuantity = 0;
  let cumulativeHouseStarts = 0;
  let cumulativeMappedHouseStarts = 0;
  let cumulativePartialHouseStarts = 0;
  let cumulativeExpectedQuantity = 0;
  let latestHouseStartDate: string | null = null;
  const points = houseComparison.points
    .filter((point) => {
      const pointTime = toStartOfDay(point.date).getTime();
      return pointTime >= startTime && pointTime <= endTime;
    })
    .map((point) => {
      const materialQuantity = Number(point.material_quantity) || 0;
      const houseStarts = Number(point.house_starts) || 0;
      const mappedHouseStarts = Number(point.mapped_house_starts) || 0;
      const partialHouseStarts = Number(point.partial_house_starts) || 0;
      const expectedQuantity = Number(point.expected_material_quantity) || 0;
      cumulativeMaterialQuantity += materialQuantity;
      cumulativeHouseStarts += houseStarts;
      cumulativeMappedHouseStarts += mappedHouseStarts;
      cumulativePartialHouseStarts += partialHouseStarts;
      cumulativeExpectedQuantity += expectedQuantity;
      if (houseStarts > 0) {
        latestHouseStartDate = point.date;
      }
      return {
        ...point,
        material_quantity: materialQuantity,
        house_starts: houseStarts,
        mapped_house_starts: mappedHouseStarts,
        partial_house_starts: partialHouseStarts,
        expected_material_quantity: expectedQuantity,
        cumulative_material_quantity: roundTo4(cumulativeMaterialQuantity),
        cumulative_house_starts: cumulativeHouseStarts,
        cumulative_mapped_house_starts: cumulativeMappedHouseStarts,
        cumulative_partial_house_starts: cumulativePartialHouseStarts,
        cumulative_expected_material_quantity: roundTo4(cumulativeExpectedQuantity),
        material_per_house: cumulativeHouseStarts > 0 ? roundTo4(cumulativeMaterialQuantity / cumulativeHouseStarts) : null,
      };
    });

  return {
    ...houseComparison,
    movement_days: inclusiveDaySpan(range.startDate, range.endDate),
    range_start: range.startDate,
    range_end: range.endDate,
    total_material_quantity: roundTo4(cumulativeMaterialQuantity),
    total_house_starts: cumulativeHouseStarts,
    total_mapped_house_starts: cumulativeMappedHouseStarts,
    total_unmapped_house_starts: cumulativeHouseStarts - cumulativeMappedHouseStarts,
    total_partial_house_starts: cumulativePartialHouseStarts,
    total_expected_material_quantity: roundTo4(cumulativeExpectedQuantity),
    material_per_house: cumulativeHouseStarts > 0 ? roundTo4(cumulativeMaterialQuantity / cumulativeHouseStarts) : null,
    expected_material_per_mapped_house:
      cumulativeMappedHouseStarts > 0 ? roundTo4(cumulativeExpectedQuantity / cumulativeMappedHouseStarts) : null,
    expected_breakdown: aggregateExpectedBreakdown(points),
    latest_house_start_date: latestHouseStartDate,
    points,
  };
}

export function getHouseSeriesSummary(points: HouseTrendChartPoint[], selection?: ChartSelection | null) {
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
  const mappedHousesProduced =
    end.cumulative_mapped_house_starts - (start.cumulative_mapped_house_starts - start.mapped_house_starts);
  const partialHousesProduced =
    (end.cumulative_partial_house_starts || 0) -
    ((start.cumulative_partial_house_starts || 0) - (start.partial_house_starts || 0));
  const projectedMaterialConsumed =
    end.cumulative_expected_material_quantity - (start.cumulative_expected_material_quantity - start.expected_material_quantity);
  const selectedPoints = points.slice(bounds.startIndex, bounds.endIndex + 1);

  return {
    start,
    end,
    elapsedDays,
    stockDelta: start.stockValue !== null && end.stockValue !== null ? end.stockValue - start.stockValue : null,
    materialConsumed,
    projectedMaterialConsumed,
    housesProduced,
    mappedHousesProduced,
    partialHousesProduced,
    averageConsumptionPerHouse: housesProduced > 0 ? materialConsumed / housesProduced : null,
    expectedConsumptionPerMappedHouse: mappedHousesProduced > 0 ? projectedMaterialConsumed / mappedHousesProduced : null,
    expectedBreakdown: aggregateExpectedBreakdown(selectedPoints),
    averageProjectedConsumptionPerBusinessDay: projectedMaterialConsumed / elapsedDays,
    averageProjectedConsumptionPerWeek: (projectedMaterialConsumed / elapsedDays) * 5,
  };
}

export function getHouseStockSeriesSummary(points: HouseTrendChartPoint[], selection?: ChartSelection | null): StockTrendSummary | null {
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
  if (start.stockValue === null || end.stockValue === null) {
    return {
      start,
      end,
      elapsedDays,
      stockDelta: null,
      consumed: null,
      averageConsumptionPerDay: null,
      averageConsumptionPerWeek: null,
    };
  }
  const consumed = start.stockValue - end.stockValue;
  return {
    start,
    end,
    elapsedDays,
    stockDelta: end.stockValue - start.stockValue,
    consumed,
    averageConsumptionPerDay: consumed / elapsedDays,
    averageConsumptionPerWeek: (consumed / elapsedDays) * 5,
  };
}
