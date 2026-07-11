import { describe, expect, it } from "vitest";

import { buildLinePath, getSeriesSummary } from "./stockSeries";

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
