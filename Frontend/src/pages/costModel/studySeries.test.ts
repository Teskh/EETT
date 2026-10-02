import { describe, expect, it } from "vitest";
import type { CostModelSeries } from "../../lib/types";
import { dashboardExclusions, seriesToComparison, studyPerHouse, sumSeries } from "./studySeries";

const series: CostModelSeries = {
  project_id: 1, sku: "PLAC0045", range_start: "2026-01-05", range_end: "2026-01-07", site_share: 0, other_houses: 1, unmapped_houses: 0,
  points: [
    { date: "2026-01-05", actual: 30, expected_target: 20, expected_other: 5, target_starts: 1, equivalent_houses: 0.8 },
    { date: "2026-01-06", actual: 30, expected_target: 25, expected_other: 0, target_starts: 1, equivalent_houses: 1 },
    { date: "2026-01-07", actual: 0, expected_target: 5, expected_other: 0, target_starts: 0, equivalent_houses: 0.2 },
  ],
};

describe("study series in the chart", () => {
  it("draws only the project's houses and every linked house's expected consumption", () => {
    const comparison = seriesToComparison(series);
    expect(comparison.total_house_starts).toBe(2);
    expect(comparison.total_expected_material_quantity).toBe(55);
    expect(comparison.points.map((point) => point.cumulative_material_quantity)).toEqual([30, 60, 60]);
  });

  it("gives the budget table's numbers: the BOM of the mix and BOM × ratio", () => {
    const { ratio, estimated, consumed } = studyPerHouse(sumSeries(series.points));
    expect(ratio).toBeCloseTo(60 / 55);
    expect(estimated).toBeCloseTo(25);
    expect(consumed).toBeCloseTo(25 * 60 / 55);
  });
});

describe("study exclusions as dashboard filters", () => {
  it("maps areas to their scope, keeps exact centers and reports what it cannot map", () => {
    expect(dashboardExclusions(["05", "11", "02-41-41", "*-34"])).toEqual({ cecos: ["05-00-00", "11-00-00", "02-41-41"], unsupported: ["*-34"] });
  });
});
