import type { MaterialDashboardPurchaseOrderLine } from "../../lib/types";

import { addBusinessDays, isWeekend, toDateInputValue, toStartOfDay } from "./dates";
import { isFiniteNumber } from "./formatters";
import type { LeadTimeReference } from "./procurement";

/** Business days simulated forward when projecting the stock-out date. */
export const STOCK_RISK_HORIZON_BUSINESS_DAYS = 120;

/** Assumed lead time (business days) when the ERP has no lead time samples. */
const FALLBACK_LEAD_TIME_BUSINESS_DAYS = 10;

export type StockArrival = {
  time: number;
  quantity: number;
};

export type StockRunwayProjection = {
  /** Date input value (YYYY-MM-DD); null when no stock-out occurs within the horizon. */
  stockoutDate: string | null;
  businessDaysUntilStockout: number | null;
};

export type StockRiskScenarioKey = "historical" | "estimated";

export type StockRiskScenario = {
  key: StockRiskScenarioKey;
  dailyRate: number;
  withArrivals: StockRunwayProjection;
  withoutArrivals: StockRunwayProjection;
};

export type StockRiskLevel = "critical" | "warning" | "ok" | "no_consumption";

export type StockRiskAssessment = {
  level: StockRiskLevel;
  scenarios: StockRiskScenario[];
  /** Scenario with the earliest projected stock-out (arrivals included); drives the headline. */
  worst: StockRiskScenario | null;
  leadTimeDays: number | null;
  bufferBusinessDays: number;
  /** Arrival date of a purchase order placed today. */
  earliestReplenishmentDate: string | null;
  /** Last day an order can be placed and still arrive before the projected stock-out. */
  latestSafeOrderDate: string | null;
  /** Quantity to cover lead time + buffer at the worst rate, net of stock and scheduled arrivals. */
  suggestedOrderQuantity: number | null;
  scheduledArrivalQuantity: number;
  /** Pending quantity with a delivery date in the past (excluded from the projection). */
  overduePendingQuantity: number;
  /** Pending quantity without an estimated delivery date (excluded from the projection). */
  unscheduledPendingQuantity: number;
  stockOnHand: number;
};

/**
 * Splits open purchase order lines into projectable arrivals (future estimated
 * delivery) and quantities the projection cannot count on: lines without a
 * delivery date and lines whose delivery date already passed.
 */
export function getPendingArrivals(purchaseOrders: MaterialDashboardPurchaseOrderLine[] | null | undefined) {
  const todayTime = toStartOfDay(new Date()).getTime();
  const arrivals: StockArrival[] = [];
  let unscheduledQuantity = 0;
  let overdueQuantity = 0;

  for (const line of purchaseOrders || []) {
    if (!line.counted_in_pending || !isFiniteNumber(line.pending_quantity) || line.pending_quantity <= 0) {
      continue;
    }
    if (!line.estimated_delivery) {
      unscheduledQuantity += line.pending_quantity;
      continue;
    }
    const deliveryTime = toStartOfDay(line.estimated_delivery).getTime();
    if (Number.isNaN(deliveryTime) || deliveryTime <= todayTime) {
      overdueQuantity += line.pending_quantity;
      continue;
    }
    arrivals.push({ time: deliveryTime, quantity: line.pending_quantity });
  }

  arrivals.sort((left, right) => left.time - right.time);
  return { arrivals, unscheduledQuantity, overdueQuantity };
}

/**
 * Walks business days forward, draining stock at `dailyRate` and crediting
 * scheduled arrivals, until the level hits zero or the horizon ends.
 */
export function projectStockRunway(
  stockOnHand: number,
  dailyRate: number,
  arrivals: StockArrival[],
  horizonBusinessDays = STOCK_RISK_HORIZON_BUSINESS_DAYS,
): StockRunwayProjection {
  if (stockOnHand <= 0) {
    return { stockoutDate: toDateInputValue(new Date()), businessDaysUntilStockout: 0 };
  }

  let stock = stockOnHand;
  let arrivalIndex = 0;
  const cursor = toStartOfDay(new Date());
  for (let day = 1; day <= horizonBusinessDays; day += 1) {
    do {
      cursor.setDate(cursor.getDate() + 1);
    } while (isWeekend(cursor));
    while (arrivalIndex < arrivals.length && arrivals[arrivalIndex].time <= cursor.getTime()) {
      stock += arrivals[arrivalIndex].quantity;
      arrivalIndex += 1;
    }
    stock -= dailyRate;
    if (stock <= 0) {
      return { stockoutDate: toDateInputValue(cursor), businessDaysUntilStockout: day };
    }
  }

  return { stockoutDate: null, businessDaysUntilStockout: null };
}

export function assessStockoutRisk({
  stockOnHand,
  historicalDailyRate,
  estimatedDailyRate,
  purchaseOrders,
  fallbackPendingQuantity,
  leadTimeReference,
  bufferWeeks,
}: {
  stockOnHand: number;
  historicalDailyRate: number | null | undefined;
  estimatedDailyRate: number | null | undefined;
  purchaseOrders: MaterialDashboardPurchaseOrderLine[];
  /** Pending quantity when no per-line purchase orders exist (study groups). */
  fallbackPendingQuantity: number | null | undefined;
  leadTimeReference: LeadTimeReference | null;
  bufferWeeks: number;
}): StockRiskAssessment {
  const { arrivals, unscheduledQuantity, overdueQuantity } = getPendingArrivals(purchaseOrders);
  const scheduledArrivalQuantity = arrivals.reduce((sum, arrival) => sum + arrival.quantity, 0);
  const groupPendingQuantity =
    !purchaseOrders.length && isFiniteNumber(fallbackPendingQuantity) ? Math.max(fallbackPendingQuantity, 0) : 0;

  const rateCandidates: Array<{ key: StockRiskScenarioKey; rate: number | null | undefined }> = [
    { key: "historical", rate: historicalDailyRate },
    { key: "estimated", rate: estimatedDailyRate },
  ];
  const scenarios: StockRiskScenario[] = [];
  for (const candidate of rateCandidates) {
    if (!isFiniteNumber(candidate.rate) || candidate.rate <= 0) {
      continue;
    }
    scenarios.push({
      key: candidate.key,
      dailyRate: candidate.rate,
      withArrivals: projectStockRunway(stockOnHand, candidate.rate, arrivals),
      withoutArrivals: projectStockRunway(stockOnHand, candidate.rate, []),
    });
  }

  const worst = scenarios.reduce<StockRiskScenario | null>((current, scenario) => {
    if (!current) {
      return scenario;
    }
    const currentDays = current.withArrivals.businessDaysUntilStockout ?? Number.POSITIVE_INFINITY;
    const scenarioDays = scenario.withArrivals.businessDaysUntilStockout ?? Number.POSITIVE_INFINITY;
    return scenarioDays < currentDays ? scenario : current;
  }, null);

  const leadTimeDays = leadTimeReference ? Math.max(Math.ceil(leadTimeReference.days), 0) : null;
  const bufferBusinessDays = Math.max(bufferWeeks, 0) * 5;

  let level: StockRiskLevel = "no_consumption";
  if (worst) {
    const daysUntilStockout = worst.withArrivals.businessDaysUntilStockout;
    if (daysUntilStockout === null) {
      level = "ok";
    } else {
      const effectiveLeadTime = leadTimeDays ?? FALLBACK_LEAD_TIME_BUSINESS_DAYS;
      level = daysUntilStockout <= effectiveLeadTime ? "critical" : daysUntilStockout <= effectiveLeadTime + bufferBusinessDays ? "warning" : "ok";
    }
  }

  const today = new Date();
  const earliestReplenishmentDate = leadTimeDays !== null ? toDateInputValue(addBusinessDays(today, leadTimeDays)) : null;
  const latestSafeOrderDate =
    worst?.withArrivals.stockoutDate && leadTimeDays !== null
      ? toDateInputValue(addBusinessDays(toStartOfDay(worst.withArrivals.stockoutDate), -leadTimeDays))
      : null;
  const suggestedOrderQuantity =
    worst && leadTimeDays !== null
      ? Math.max(Math.ceil(worst.dailyRate * (leadTimeDays + bufferBusinessDays) - stockOnHand - scheduledArrivalQuantity), 0)
      : null;

  return {
    level,
    scenarios,
    worst,
    leadTimeDays,
    bufferBusinessDays,
    earliestReplenishmentDate,
    latestSafeOrderDate,
    suggestedOrderQuantity,
    scheduledArrivalQuantity,
    overduePendingQuantity: overdueQuantity,
    unscheduledPendingQuantity: unscheduledQuantity + groupPendingQuantity,
    stockOnHand,
  };
}
