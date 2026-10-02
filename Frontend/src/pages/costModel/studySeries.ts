import type { CostModelSeries, MaterialDashboardMappedHouseComparisonData } from "../../lib/types";

type SeriesPoint = CostModelSeries["points"][number];

/**
 * The study's series in the material dashboard's comparison shape, so the
 * same chart draws it: only the project's houses, withdrawals outside the
 * excluded cost centers, and expected consumption of every linked house
 * (the project's and, to discount them, other projects').
 */
export function seriesToComparison(series: CostModelSeries): MaterialDashboardMappedHouseComparisonData {
  let material = 0, houses = 0, expected = 0;
  const points = series.points.map((point) => {
    material += point.actual;
    houses += point.target_starts;
    expected += point.expected_target + point.expected_other;
    return {
      ...point,
      material_quantity: point.actual,
      house_starts: point.target_starts,
      mapped_house_starts: point.target_starts,
      partial_house_starts: 0,
      expected_material_quantity: point.expected_target + point.expected_other,
      cumulative_material_quantity: material,
      cumulative_house_starts: houses,
      cumulative_mapped_house_starts: houses,
      cumulative_partial_house_starts: 0,
      cumulative_expected_material_quantity: expected,
      material_per_house: houses > 0 ? material / houses : null,
      expected_breakdown: [],
    };
  });
  return {
    sku: series.sku, movement_days: points.length, ceco_filters: [], range_start: series.range_start, range_end: series.range_end,
    total_material_quantity: material, total_house_starts: houses, total_mapped_house_starts: houses, total_unmapped_house_starts: 0,
    total_partial_house_starts: 0, total_expected_material_quantity: expected,
    material_per_house: houses > 0 ? material / houses : null, expected_material_per_mapped_house: houses > 0 ? expected / houses : null,
    expected_breakdown: [], latest_house_start_date: null, link_count: 1, mapped_projects: [], unmapped_summary: [], partial_summary: [],
    points, generated_at: "",
  };
}

export type StudyTotals = { actual: number; target: number; other: number; equivalentHouses: number; starts: number };

export function sumSeries(points: Partial<SeriesPoint>[]): StudyTotals {
  return points.reduce<StudyTotals>((sum, point) => ({
    actual: sum.actual + (point.actual ?? 0),
    target: sum.target + (point.expected_target ?? 0),
    other: sum.other + (point.expected_other ?? 0),
    equivalentHouses: sum.equivalentHouses + (point.equivalent_houses ?? 0),
    starts: sum.starts + (point.target_starts ?? 0),
  }), { actual: 0, target: 0, other: 0, equivalentHouses: 0, starts: 0 });
}

/**
 * The study's accounting over a span: the pooled ratio real / expected, and
 * per house of the project the BOM of its mix and that BOM times the ratio,
 * which is the historic quantity the budget table shows.
 */
export function studyPerHouse(totals: StudyTotals) {
  const expected = totals.target + totals.other;
  const ratio = expected > 0 ? totals.actual / expected : null;
  const estimated = totals.equivalentHouses > 0 ? totals.target / totals.equivalentHouses : null;
  return { ratio, estimated, consumed: ratio !== null && estimated !== null ? ratio * estimated : null };
}

/**
 * The study's cost center exclusion rules as Material Dashboard filters: an
 * area ("05") is the dashboard's "05-00-00" scope, an exact center stays as
 * is. A site in every area ("*-34") has no dashboard equivalent.
 */
export function dashboardExclusions(rules: string[]) {
  const cecos: string[] = [];
  const unsupported: string[] = [];
  for (const rule of rules) {
    if (/^\d{2}$/.test(rule)) cecos.push(`${rule}-00-00`);
    else if (/^\d{2}-\d{2}-\d{2}$/.test(rule)) cecos.push(rule);
    else unsupported.push(rule);
  }
  return { cecos, unsupported };
}
