import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { assessStockoutRisk, projectStockRunway } from "./stockRisk";

describe("material dashboard stock risk", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 10, 12));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("projects stockout across business days", () => {
    expect(projectStockRunway(100, 20, [])).toEqual({
      stockoutDate: "2026-07-17",
      businessDaysUntilStockout: 5,
    });
  });

  it("credits scheduled arrivals before daily consumption", () => {
    const arrivalTime = new Date(2026, 6, 14).setHours(0, 0, 0, 0);
    expect(projectStockRunway(100, 20, [{ time: arrivalTime, quantity: 40 }])).toEqual({
      stockoutDate: "2026-07-21",
      businessDaysUntilStockout: 7,
    });
  });

  it("marks a stockout inside lead time as critical and suggests replenishment", () => {
    const assessment = assessStockoutRisk({
      stockOnHand: 50,
      historicalDailyRate: 10,
      estimatedDailyRate: null,
      purchaseOrders: [],
      fallbackPendingQuantity: 0,
      leadTimeReference: { days: 7, source: "median" },
      bufferWeeks: 2,
    });

    expect(assessment.level).toBe("critical");
    expect(assessment.worst?.withArrivals.businessDaysUntilStockout).toBe(5);
    expect(assessment.suggestedOrderQuantity).toBe(120);
    expect(assessment.latestSafeOrderDate).toBe("2026-07-08");
  });

  it("stays neutral when no consumption rate is available", () => {
    const assessment = assessStockoutRisk({
      stockOnHand: 50,
      historicalDailyRate: null,
      estimatedDailyRate: 0,
      purchaseOrders: [],
      fallbackPendingQuantity: 0,
      leadTimeReference: null,
      bufferWeeks: 2,
    });

    expect(assessment.level).toBe("no_consumption");
    expect(assessment.worst).toBeNull();
  });
});
