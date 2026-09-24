import { describe, expect, it } from "vitest";

import type { MaterialDashboardMappedHouseComparisonData } from "../../lib/types";

import { buildHouseComparisonChart, buildProjectedStockByDay } from "./houseComparison";
import type { StockSeriesPoint } from "./stockSeries";

const WIDTH = 760;
const HEIGHT = 240;

function comparison(
  materialByDay: number[],
  expectedByDay: number[],
  startsByDay: number[],
): MaterialDashboardMappedHouseComparisonData {
  let cumulativeMaterial = 0;
  let cumulativeExpected = 0;
  let cumulativeStarts = 0;
  const points = startsByDay.map((houseStarts, index) => {
    cumulativeMaterial += materialByDay[index] ?? 0;
    cumulativeExpected += expectedByDay[index] ?? 0;
    cumulativeStarts += houseStarts;
    return {
      date: `2026-08-${String(index + 3).padStart(2, "0")}`,
      material_quantity: materialByDay[index] ?? 0,
      house_starts: houseStarts,
      mapped_house_starts: houseStarts,
      partial_house_starts: 0,
      expected_material_quantity: expectedByDay[index] ?? 0,
      cumulative_material_quantity: cumulativeMaterial,
      cumulative_house_starts: cumulativeStarts,
      cumulative_mapped_house_starts: cumulativeStarts,
      cumulative_partial_house_starts: 0,
      cumulative_expected_material_quantity: cumulativeExpected,
      material_per_house: cumulativeStarts ? cumulativeMaterial / cumulativeStarts : null,
      expected_breakdown: [],
    };
  });

  return {
    sku: "TEST-001",
    movement_days: points.length,
    ceco_filters: [],
    range_start: points[0]?.date ?? null,
    range_end: points[points.length - 1]?.date ?? null,
    total_material_quantity: cumulativeMaterial,
    total_house_starts: cumulativeStarts,
    total_mapped_house_starts: cumulativeStarts,
    total_unmapped_house_starts: 0,
    total_partial_house_starts: 0,
    total_expected_material_quantity: cumulativeExpected,
    material_per_house: cumulativeStarts ? cumulativeMaterial / cumulativeStarts : null,
    expected_material_per_mapped_house: cumulativeStarts ? cumulativeExpected / cumulativeStarts : null,
    expected_breakdown: [],
    latest_house_start_date: points[points.length - 1]?.date ?? null,
    link_count: 1,
    mapped_projects: [],
    unmapped_summary: [],
    partial_summary: [],
    points,
    generated_at: "2026-08-16T00:00:00Z",
  };
}

function stock(values: number[]): StockSeriesPoint[] {
  return values.map((value, index) => ({
    date: `2026-08-${String(index + 3).padStart(2, "0")}`,
    time: index,
    value,
  }));
}

function chartFor(actualStock: number[], actualConsumption: number[], expectedConsumption: number[], starts: number[]) {
  const data = comparison(actualConsumption, expectedConsumption, starts);
  const stockSeries = stock(actualStock);
  const projected = buildProjectedStockByDay(data, stockSeries);
  return buildHouseComparisonChart(data, stockSeries, WIDTH, HEIGHT, actualStock.at(-1) ?? null, actualStock[0] ?? null, projected);
}

describe("material dashboard house comparison chart", () => {
  it("anchors expected consumption and remaining starts to opposite corners", () => {
    const chart = chartFor([90, 80, 70], [10, 10, 10], [10, 10, 10], [1, 1, 1]);

    expect(chart).not.toBeNull();
    expect(chart?.points[0].projectedStockY).toBe(chart?.padding.top);
    expect(chart?.points.at(-1)?.projectedStockY).toBe((chart?.padding.top ?? 0) + (chart?.plotHeight ?? 0));
    expect(chart?.points[0].houseY).toBe(chart?.padding.top);
    expect(chart?.points.at(-1)?.houseY).toBe((chart?.padding.top ?? 0) + (chart?.plotHeight ?? 0));
  });

  it("overlays actual stock when actual and expected consumption agree", () => {
    const chart = chartFor([90, 80, 70], [10, 10, 10], [10, 10, 10], [1, 1, 1]);

    expect(chart?.points.map((point) => point.stockY)).toEqual(chart?.points.map((point) => point.projectedStockY));
  });

  it("does not clamp actual consumption deviations to the expected frame", () => {
    const chart = chartFor([85, 70, 55], [15, 15, 15], [10, 10, 10], [1, 1, 1]);
    const plotBottom = (chart?.padding.top ?? 0) + (chart?.plotHeight ?? 0);

    expect(chart?.points.at(-1)?.projectedStockY).toBe(plotBottom);
    expect(chart?.points.at(-1)?.stockY).toBeGreaterThan(plotBottom);
  });

  it("projects expected stock when the range starts on a weekend", () => {
    const data = comparison([10, 10, 10], [10, 10, 10], [1, 1, 1]);
    // 2026-08-01 is a Saturday: the stock series has no value for it.
    data.points = [{ ...data.points[0], date: "2026-08-01", material_quantity: 0, expected_material_quantity: 0, house_starts: 0 }, ...data.points];
    const projected = buildProjectedStockByDay(data, stock([90, 80, 70]));

    expect(projected).not.toBeNull();
    expect([...(projected?.values() ?? [])].map((point) => point.projectedStockValue)).toEqual([90, 80, 70]);
  });
});
