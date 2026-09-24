import { describe, expect, it } from "vitest";

import { getConsumptionMetrics } from "./consumptionMetrics";

const base = { materialConsumed: 4200, projectedMaterialConsumed: 4000, housesProduced: 100, mappedHousesProduced: 80, hasExpected: true, averagePrice: 10 };

describe("getConsumptionMetrics", () => {
  it("compares period totals and divides differences by every house started", () => {
    const metrics = getConsumptionMetrics(base);
    expect(metrics.consumedPerHouse).toBe(42);
    expect(metrics.expectedPerHouse).toBe(50);
    expect(metrics.deltaPercent).toBe(5);
    expect(metrics.overconsumptionPerHouse).toBe(2);
    expect(metrics.overcostPerHouse).toBe(20);
    expect(metrics.unmappedHouses).toBe(20);
  });

  it("reports no comparison without linked houses or a price", () => {
    const unlinked = getConsumptionMetrics({ ...base, hasExpected: false });
    expect(unlinked.expectedPerHouse).toBeNull();
    expect(unlinked.overconsumptionPerHouse).toBeNull();
    expect(unlinked.consumedPerHouse).toBe(42);
    expect(getConsumptionMetrics({ ...base, averagePrice: null }).overcostPerHouse).toBeNull();
    expect(getConsumptionMetrics({ ...base, housesProduced: 0, mappedHousesProduced: 0 }).consumedPerHouse).toBeNull();
  });
});
