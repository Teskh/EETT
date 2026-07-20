import { describe, expect, it } from "vitest";

import type { MaterialDashboardStockRiskMetric } from "../../lib/types";
import { compareStockRiskMetricValues, hasPositiveEstimatedQuantityPerHouse } from "./selection";

function metric(
  sku: string,
  status: MaterialDashboardStockRiskMetric["status"],
  days: number | null = null,
): MaterialDashboardStockRiskMetric {
  return {
    sku,
    status,
    business_days_until_stockout: days,
    stockout_date: null,
  };
}

describe("material dashboard stock risk sorting", () => {
  it("puts the earliest projected stockout first in descending risk order", () => {
    const values = [
      { metric: metric("SAFE", "outside_horizon"), name: "Safe" },
      { metric: metric("LATER", "projected", 18), name: "Later" },
      { metric: metric("NONE", "no_consumption"), name: "No consumption" },
      { metric: metric("NOW", "projected", 0), name: "Now" },
      { metric: metric("MISSING", "unavailable"), name: "Missing" },
    ];

    values.sort((left, right) => compareStockRiskMetricValues(left, right, -1));

    expect(values.map((value) => value.metric.sku)).toEqual(["NOW", "LATER", "SAFE", "NONE", "MISSING"]);
  });

  it("keeps unavailable ERP metrics last in ascending order", () => {
    const values = [
      { metric: metric("MISSING", "unavailable"), name: "Missing" },
      { metric: metric("RISK", "projected", 3), name: "Risk" },
      { metric: metric("NONE", "no_consumption"), name: "No consumption" },
    ];

    values.sort((left, right) => compareStockRiskMetricValues(left, right, 1));

    expect(values.map((value) => value.metric.sku)).toEqual(["NONE", "RISK", "MISSING"]);
  });
});

describe("estimated quantity per house filter", () => {
  it("only accepts finite positive estimates", () => {
    expect(hasPositiveEstimatedQuantityPerHouse({ predicted_quantity_per_house: 1.25 })).toBe(true);
    expect(hasPositiveEstimatedQuantityPerHouse({ predicted_quantity_per_house: 0 })).toBe(false);
    expect(hasPositiveEstimatedQuantityPerHouse({ predicted_quantity_per_house: -1 })).toBe(false);
    expect(hasPositiveEstimatedQuantityPerHouse({ predicted_quantity_per_house: Number.NaN })).toBe(false);
    expect(hasPositiveEstimatedQuantityPerHouse({ predicted_quantity_per_house: null })).toBe(false);
    expect(hasPositiveEstimatedQuantityPerHouse(undefined)).toBe(false);
  });
});
