import type { MaterialDashboardPurchaseOrderLine } from "../../lib/types";

import { addBusinessDays, daysFromToday, moveToNextBusinessDay, toStartOfDay } from "./dates";
import { isFiniteNumber } from "./formatters";
import type { DashboardDetailLike } from "./selection";
import type { StockTrendSummary } from "./stockSeries";

export type LeadTimeMode = "worst" | "median" | "average";

export type LeadTimeReference = {
  days: number;
  source: LeadTimeMode;
};

export type PurchaseOrderEstimate = {
  bufferWeeks: number;
  bufferBusinessDays: number;
  minimumExpectedStock: number;
  rateUsed: number;
  rateSource: "selection" | "recent_30d";
  leadTimeDays: number;
  thresholdDate: string;
  purchaseOrderDate: string;
};

export type EstimatedConsumptionPurchaseOrderEstimate = {
  bufferWeeks: number;
  minimumExpectedStock: number;
  estimatedConsumptionPerWeek: number;
  estimatedConsumptionPerBusinessDay: number;
  rateSource: "selection" | "range";
  leadTimeDays: number;
  thresholdDate: string;
  purchaseOrderDate: string;
};

export function getLeadTimeReference(detail: DashboardDetailLike | null, mode: LeadTimeMode): LeadTimeReference | null {
  if (!detail) {
    return null;
  }
  const days =
    mode === "worst" ? detail.max_lead_time_days : mode === "median" ? detail.median_lead_time_days : detail.average_lead_time_days;
  return isFiniteNumber(days) ? { days, source: mode } : null;
}

export function getLeadTimeDigits(mode: LeadTimeMode) {
  return mode === "worst" ? 0 : 1;
}

export function getLeadTimeModeLabel(mode: LeadTimeMode) {
  if (mode === "worst") {
    return "Worst";
  }
  return mode === "median" ? "Median" : "Average";
}

export function getPurchaseOrderUrgencyClasses(value: string | null | undefined) {
  if (!value) {
    return "";
  }
  const targetDate = toStartOfDay(value);
  if (Number.isNaN(targetDate.getTime())) {
    return "";
  }
  const daysUntilTarget = daysFromToday(targetDate);
  if (daysUntilTarget <= 7) {
    return "text-red-600 dark:text-red-400";
  }
  if (daysUntilTarget <= 14) {
    return "text-amber-600 dark:text-amber-400";
  }
  return "text-zinc-900 dark:text-white";
}

export function getPurchaseOrderPriceStats(purchaseOrders: MaterialDashboardPurchaseOrderLine[] | null | undefined) {
  const prices = (purchaseOrders || []).map((order) => order.unit_price).filter(isFiniteNumber);
  if (!prices.length) {
    return {
      lastPrice: null,
      minPrice: null,
      maxPrice: null,
      delta: null,
      deltaPercent: null,
    };
  }
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const delta = maxPrice - minPrice;
  return {
    lastPrice: prices[0],
    minPrice,
    maxPrice,
    delta,
    deltaPercent: minPrice > 0 ? (delta / minPrice) * 100 : null,
  };
}

/**
 * Projects, from a daily consumption rate, the business day on which stock
 * hits the buffer threshold and works back the lead time to suggest when the
 * next purchase order should be placed.
 */
function projectPurchaseOrderDates({
  stockOnHand,
  minimumStock,
  dailyRate,
  leadTimeReference,
}: {
  stockOnHand: number;
  minimumStock: number;
  dailyRate: number;
  leadTimeReference: LeadTimeReference;
}) {
  const today = moveToNextBusinessDay(new Date());
  const businessDaysUntilThreshold = stockOnHand <= minimumStock ? 0 : Math.ceil((stockOnHand - minimumStock) / dailyRate);
  const leadTimeDays = Math.max(Math.ceil(leadTimeReference.days), 0);
  const thresholdDate = addBusinessDays(today, businessDaysUntilThreshold);
  const purchaseOrderDate = addBusinessDays(thresholdDate, -leadTimeDays);
  return {
    leadTimeDays,
    thresholdDate: thresholdDate.toISOString(),
    purchaseOrderDate: purchaseOrderDate.toISOString(),
  };
}

export function getPurchaseOrderEstimate({
  detail,
  summary,
  leadTimeReference,
  isCustomSelection,
  bufferWeeks,
}: {
  detail: DashboardDetailLike | null;
  summary: StockTrendSummary | null;
  leadTimeReference: LeadTimeReference | null;
  isCustomSelection: boolean;
  bufferWeeks: number;
}): PurchaseOrderEstimate | null {
  if (!detail || !leadTimeReference || detail.stock_on_hand === null || detail.stock_on_hand === undefined || Number.isNaN(detail.stock_on_hand)) {
    return null;
  }

  const rateUsed = isCustomSelection ? summary?.averageConsumptionPerDay : detail.average_daily_outgoing_30d;
  if (!isFiniteNumber(rateUsed) || rateUsed <= 0) {
    return null;
  }

  const normalizedBufferWeeks = Math.max(bufferWeeks, 0);
  const bufferBusinessDays = normalizedBufferWeeks * 5;
  const minimumStock = rateUsed * bufferBusinessDays;

  return {
    bufferWeeks: normalizedBufferWeeks,
    bufferBusinessDays,
    minimumExpectedStock: minimumStock,
    rateUsed,
    rateSource: isCustomSelection ? "selection" : "recent_30d",
    ...projectPurchaseOrderDates({
      stockOnHand: detail.stock_on_hand,
      minimumStock,
      dailyRate: rateUsed,
      leadTimeReference,
    }),
  };
}

export function getEstimatedConsumptionPurchaseOrderEstimate({
  detail,
  leadTimeReference,
  estimatedConsumptionPerWeek,
  isCustomSelection,
  bufferWeeks,
}: {
  detail: DashboardDetailLike | null;
  leadTimeReference: LeadTimeReference | null;
  estimatedConsumptionPerWeek: number | null | undefined;
  isCustomSelection: boolean;
  bufferWeeks: number;
}): EstimatedConsumptionPurchaseOrderEstimate | null {
  if (!detail || !leadTimeReference || detail.stock_on_hand === null || detail.stock_on_hand === undefined || Number.isNaN(detail.stock_on_hand)) {
    return null;
  }

  if (!isFiniteNumber(estimatedConsumptionPerWeek) || estimatedConsumptionPerWeek <= 0) {
    return null;
  }

  const normalizedBufferWeeks = Math.max(bufferWeeks, 0);
  const minimumStock = estimatedConsumptionPerWeek * normalizedBufferWeeks;
  const estimatedConsumptionPerBusinessDay = estimatedConsumptionPerWeek / 5;

  return {
    bufferWeeks: normalizedBufferWeeks,
    minimumExpectedStock: minimumStock,
    estimatedConsumptionPerWeek,
    estimatedConsumptionPerBusinessDay,
    rateSource: isCustomSelection ? "selection" : "range",
    ...projectPurchaseOrderDates({
      stockOnHand: detail.stock_on_hand,
      minimumStock,
      dailyRate: estimatedConsumptionPerBusinessDay,
      leadTimeReference,
    }),
  };
}
