import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { toDateInputValue } from "./dates";
import { buildHistoricalStockSeries, buildLinePath, getSeriesSummary } from "./stockSeries";

describe("material dashboard stock series", () => {
  it("builds a bounded chart and summarizes a selected range", () => {
    const chart = buildLinePath(
      [
        { date: "2026-07-06", time: 1, value: 100 },
        { date: "2026-07-07", time: 2, value: 90 },
        { date: "2026-07-08", time: 3, value: 70 },
      ],
      760,
      240,
    );

    expect(chart).not.toBeNull();
    expect(chart?.points[0].x).toBeLessThan(chart?.points[2].x ?? 0);
    expect(getSeriesSummary(chart?.points ?? [], { startIndex: 0, endIndex: 2 })).toMatchObject({
      elapsedDays: 2,
      stockDelta: -30,
      consumed: 30,
      averageConsumptionPerDay: 15,
      averageConsumptionPerWeek: 75,
    });
  });

  it("clamps reversed selections before calculating consumption", () => {
    const chart = buildLinePath(
      [
        { date: "2026-07-06", time: 1, value: 100 },
        { date: "2026-07-07", time: 2, value: 80 },
      ],
      760,
      240,
    );

    expect(getSeriesSummary(chart?.points ?? [], { startIndex: 1, endIndex: 0 })?.consumed).toBe(20);
  });
});

describe("buildHistoricalStockSeries across a DST change", () => {
  beforeEach(() => {
    // Chile starts DST at midnight on 2026-09-06, so that midnight does not exist.
    vi.stubEnv("TZ", "America/Santiago");
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 9, 10));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("keeps undoing movements before the transition", () => {
    const movements = ["2026-09-02", "2026-09-03", "2026-09-04", "2026-09-07", "2026-09-08", "2026-09-09"]
      .map((date) => ({ date, quantity: 10 }));
    const series = buildHistoricalStockSeries(movements, 100, { startDate: "2026-09-02", endDate: "2026-09-09" });
    expect(series.map((point) => [toDateInputValue(point.date), point.value])).toEqual([
      ["2026-09-02", 150], ["2026-09-03", 140], ["2026-09-04", 130],
      ["2026-09-07", 120], ["2026-09-08", 110], ["2026-09-09", 100],
    ]);
  });
});
