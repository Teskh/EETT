import { memo, useEffect, useMemo, useState } from "react";

import type {
  MaterialDashboardEconomicMetric,
  MaterialDashboardExpectedBreakdown,
  MaterialDashboardGroupCostBreakdown,
} from "../../../lib/types";
import {
  clampHouseRange,
  getDefaultHouseRange,
  isDateWithinRange,
  isWeekend,
  moveToPreviousBusinessDay,
  toDateInputValue,
  toStartOfDay,
  type HouseRange,
} from "../dates";
import {
  formatCurrency,
  formatDate,
  formatNumber,
  formatUnsignedPercent,
  getAdaptiveDecimalPlaces,
  isFiniteNumber,
  percentFormatter,
} from "../formatters";
import {
  buildHouseComparisonChart,
  buildProjectedStockByDay,
  getHouseComparisonForRange,
  getHouseSeriesSummary,
  getHouseStockSeriesSummary,
  getStockValueForDate,
} from "../houseComparison";
import {
  getEstimatedConsumptionPurchaseOrderEstimate,
  getLeadTimeReference,
  getPurchaseOrderEstimate,
  getPurchaseOrderPriceStats,
  type LeadTimeMode,
} from "../procurement";
import {
  isGroupDetail,
  isGroupRow,
  type DashboardDetailLike,
  type DashboardHistoryLike,
  type DashboardHouseComparisonLike,
  type DashboardSelectionRow,
} from "../selection";
import { assessStockoutRisk } from "../stockRisk";
import {
  CHART_HEIGHT,
  CHART_WIDTH,
  buildHistoricalStockSeries,
  buildLinePath,
  getClampedSelectionBounds,
  getSeriesSummary,
} from "../stockSeries";
import { useChartSelection } from "../useChartSelection";
import type { HouseViewMode } from "../preferences";

import type { HouseLinksModalTab } from "./HouseLinksModal";
import { MovementBreakdownList } from "./MovementBreakdownList";
import { ProcurementMetricsPanel } from "./ProcurementMetricsPanel";
import { TrendChartSkeleton } from "./Skeletons";
import { StockRiskPanel } from "./StockRiskPanel";
import { HouseTrendChart, StockTrendChart } from "./TrendCharts";

type PriceDisplayMode = "average" | "last";

const RANGE_DATE_INPUT_CLASSES =
  "h-7 w-[106px] bg-transparent px-2 text-[11px] font-medium text-zinc-600 outline-none transition-colors hover:bg-black/[0.03] focus:bg-white/80 focus:ring-1 focus:ring-accent-500/50 dark:text-zinc-300 dark:hover:bg-white/[0.04] dark:focus:bg-white/[0.06] [color-scheme:light] dark:[color-scheme:dark]";

function NoSelectionPlaceholder() {
  return (
    <section className="flex-1 flex items-center justify-center bg-white dark:bg-zinc-950 h-full">
      <div className="text-center max-w-xl p-8">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center bg-zinc-100 dark:bg-white/5">
          <svg className="w-8 h-8 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z" />
          </svg>
        </div>
        <p className="text-[10px] font-bold uppercase tracking-[0.35em] text-zinc-500 mb-3">Gráfico Fijado</p>
        <h2 className="text-xl font-medium text-zinc-900 dark:text-white mb-2">No hay estudio seleccionado</h2>
        <p className="text-sm text-zinc-500">
          Selecciona un material o grupo de la lista para analizar el historial de movimientos normalizado y las tendencias de stock.
        </p>
      </div>
    </section>
  );
}

function HeaderStatLabel({ children }: { children: React.ReactNode }) {
  return <div className="mb-1 whitespace-nowrap text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-500">{children}</div>;
}

function HeaderStatDivider() {
  return <div className="w-px h-8 bg-black/10 dark:bg-white/10 hidden md:block" />;
}

function getExpectedBreakdownLabel(row: MaterialDashboardExpectedBreakdown) {
  return row.sub_type_name ? `${row.house_type_name} · ${row.sub_type_name}` : row.house_type_name;
}

function ExpectedBreakdownTooltip({
  breakdown,
  digits,
}: {
  breakdown: MaterialDashboardExpectedBreakdown[];
  digits: number;
}) {
  if (!breakdown.length) {
    return null;
  }
  const visibleRows = breakdown.slice(0, 8);
  const hiddenCount = breakdown.length - visibleRows.length;
  const incompleteRows = breakdown.filter((row) => (row.missing_quantity_count || 0) > 0);

  return (
    <div className="pointer-events-none absolute right-0 top-full z-40 mt-2 w-80 translate-y-1 rounded-lg border border-black/10 bg-white p-3 text-left opacity-0 shadow-xl shadow-black/10 ring-1 ring-black/[0.03] transition-all duration-150 group-hover/estimate:translate-y-0 group-hover/estimate:opacity-100 group-focus-within/estimate:translate-y-0 group-focus-within/estimate:opacity-100 dark:border-white/10 dark:bg-zinc-900 dark:shadow-black/30 dark:ring-white/[0.04]">
      <div className="mb-2 flex items-center justify-between gap-3 border-b border-black/5 pb-2 dark:border-white/10">
        <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">Promedio ponderado</span>
        <span className="text-[10px] font-semibold text-zinc-400">viv. vinculadas</span>
      </div>
      <div className="space-y-1.5">
        {visibleRows.map((row) => (
          <div
            key={`${row.house_type_id}-${row.sub_type_id ?? "general"}`}
            className="grid grid-cols-[1fr_auto_auto] items-baseline gap-3 text-xs"
          >
            <span className="min-w-0 truncate font-medium text-zinc-800 dark:text-zinc-100" title={getExpectedBreakdownLabel(row)}>
              {(row.missing_quantity_count || 0) > 0 ? <span className="mr-1 text-amber-600 dark:text-amber-400">⚠</span> : null}
              {getExpectedBreakdownLabel(row)}
            </span>
            <span className="font-mono text-zinc-500 dark:text-zinc-400">{formatNumber(row.house_starts, 0)} viv.</span>
            <span className="font-mono text-zinc-900 dark:text-white">{formatNumber(row.expected_quantity_per_house, digits)}/viv.</span>
          </div>
        ))}
      </div>
      {hiddenCount > 0 ? <div className="mt-2 text-[11px] text-zinc-500">+{hiddenCount} tipos mas</div> : null}
      {incompleteRows.length ? (
        <div className="mt-2 border-t border-black/5 pt-2 text-[11px] leading-4 text-amber-700 dark:border-white/10 dark:text-amber-400">
          ⚠ {incompleteRows.length === 1 ? "Un tipo tiene" : `${incompleteRows.length} tipos tienen`} cantidades sin definir: suman
          solo lo ya definido, por lo que el estimado es un piso.
        </div>
      ) : null}
    </div>
  );
}

function getGroupCostBreakdown(metric: MaterialDashboardEconomicMetric | null): MaterialDashboardGroupCostBreakdown[] {
  if (!metric || !("cost_breakdown" in metric) || !Array.isArray(metric.cost_breakdown)) {
    return [];
  }
  return metric.cost_breakdown;
}

function GroupCostBreakdownTooltip({
  breakdown,
  studyUnit,
}: {
  breakdown: MaterialDashboardGroupCostBreakdown[];
  studyUnit?: string | null;
}) {
  if (!breakdown.length) {
    return null;
  }
  const visibleRows = breakdown.slice(0, 8);
  const hiddenCount = breakdown.length - visibleRows.length;

  return (
    <div className="pointer-events-none absolute right-0 top-full z-40 mt-2 w-[520px] max-w-[calc(100vw-2rem)] translate-y-1 rounded-lg border border-black/10 bg-white p-3 text-left opacity-0 shadow-xl shadow-black/10 ring-1 ring-black/[0.03] transition-all duration-150 group-hover/cost:translate-y-0 group-hover/cost:opacity-100 group-focus-within/cost:translate-y-0 group-focus-within/cost:opacity-100 dark:border-white/10 dark:bg-zinc-900 dark:shadow-black/30 dark:ring-white/[0.04]">
      <div className="mb-2 flex items-center justify-between gap-3 border-b border-black/5 pb-2 dark:border-white/10">
        <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">Desglose por material</span>
        <span className="text-[10px] font-semibold text-zinc-400">real - estimado</span>
      </div>
      <div className="space-y-1.5">
        {visibleRows.map((row) => {
          const delta = row.cost_delta_per_house;
          const overcost = delta !== null && delta > 0;
          return (
            <div key={row.sku} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-baseline gap-3 text-xs">
              <span className="min-w-0">
                <span className="block truncate font-medium text-zinc-800 dark:text-zinc-100" title={row.material_name}>
                  {row.material_name}
                </span>
                <span className="block truncate font-mono text-[10px] text-zinc-500">
                  {row.sku} · {formatNumber(row.actual_study_quantity)} / {formatNumber(row.expected_study_quantity)} {studyUnit || ""}
                </span>
              </span>
              <span className="font-mono text-zinc-500 dark:text-zinc-400" title={`Precio promedio: ${formatCurrency(row.average_price)}`}>
                {formatCurrency(row.cost_delta)}
              </span>
              <span
                className={`font-mono ${
                  overcost
                    ? "text-red-700 dark:text-red-300"
                    : "text-zinc-900 dark:text-white"
                }`}
              >
                {delta === null ? "—" : `${delta > 0 ? "+" : delta < 0 ? "-" : ""}${formatCurrency(Math.abs(delta))}/viv.`}
              </span>
            </div>
          );
        })}
      </div>
      {hiddenCount > 0 ? <div className="mt-2 text-[11px] text-zinc-500">+{hiddenCount} materiales mas</div> : null}
    </div>
  );
}

export const MovementHistoryCard = memo(function MovementHistoryCard({
  selected,
  detail,
  history,
  houseViewMode,
  onHouseViewModeChange,
  onOpenLinksModal,
  leadTimeMode,
  onLeadTimeModeChange,
  houseRange,
  onHouseRangeChange,
  houseComparison,
  detailLoading,
  houseComparisonLoading,
  detailRefreshing,
  historyRefreshing,
  houseComparisonRefreshing,
  historyError,
  houseComparisonError,
  economicMetric,
  onInspectProjectUsage,
}: {
  selected: DashboardSelectionRow | null;
  detail: DashboardDetailLike | null;
  history: DashboardHistoryLike | null;
  houseViewMode: HouseViewMode;
  onHouseViewModeChange: (mode: HouseViewMode) => void;
  onOpenLinksModal: (tab: HouseLinksModalTab) => void;
  leadTimeMode: LeadTimeMode;
  onLeadTimeModeChange: (mode: LeadTimeMode) => void;
  houseRange: HouseRange;
  onHouseRangeChange: (range: HouseRange) => void;
  houseComparison: DashboardHouseComparisonLike | null;
  detailLoading: boolean;
  houseComparisonLoading: boolean;
  detailRefreshing: boolean;
  historyRefreshing: boolean;
  houseComparisonRefreshing: boolean;
  historyError: string | null;
  houseComparisonError: string | null;
  economicMetric: MaterialDashboardEconomicMetric | null;
  onInspectProjectUsage: (() => void) | null;
}) {
  const [bufferWeeksInput, setBufferWeeksInput] = useState("2");
  const [isEditingBufferWeeks, setIsEditingBufferWeeks] = useState(false);
  const [isEditingLeadTimeMode, setIsEditingLeadTimeMode] = useState(false);
  const [priceDisplayMode, setPriceDisplayMode] = useState<PriceDisplayMode>("average");
  const [draftRange, setDraftRange] = useState<HouseRange>(houseRange);
  const selectedGroup = isGroupRow(selected) ? selected : null;
  const groupSelection = Boolean(selectedGroup);

  const latestHouseRangeDate = moveToPreviousBusinessDay(new Date());
  const latestHouseRangeValue = toDateInputValue(latestHouseRangeDate);
  const housesMode = houseViewMode === "houses";

  useEffect(() => {
    setDraftRange(houseRange);
  }, [houseRange.startDate, houseRange.endDate]);

  const houseComparisonInRange = useMemo(
    () => getHouseComparisonForRange(houseComparison, houseRange),
    [houseComparison, houseRange],
  );
  const hasExpectedComparison = Boolean(houseComparisonInRange && houseComparisonInRange.link_count > 0);
  const weekdayHouseComparison = useMemo(
    () =>
      houseComparisonInRange
        ? {
            ...houseComparisonInRange,
            points: houseComparisonInRange.points.filter((point) => !isWeekend(toStartOfDay(point.date))),
          }
        : null,
    [houseComparisonInRange],
  );
  const houseStockSeries = useMemo(
    () =>
      detail && history
        ? buildHistoricalStockSeries(history.movements, detail.stock_on_hand, {
            startDate: houseRange.startDate,
            endDate: latestHouseRangeValue,
          })
        : [],
    [detail, history, houseRange.startDate, latestHouseRangeValue],
  );
  const projectedStockByDay = useMemo(
    () => buildProjectedStockByDay(houseComparisonInRange, houseStockSeries),
    [houseComparisonInRange, houseStockSeries],
  );
  const houseRangeEndStockValue = useMemo(
    () => getStockValueForDate(houseStockSeries, houseRange.endDate),
    [houseStockSeries, houseRange.endDate],
  );
  const stockRangeChart = useMemo(
    () => (houseStockSeries.length ? buildLinePath(houseStockSeries, CHART_WIDTH, CHART_HEIGHT) : null),
    [houseStockSeries],
  );
  const houseChart = useMemo(
    () =>
      weekdayHouseComparison
        ? buildHouseComparisonChart(
            weekdayHouseComparison,
            houseStockSeries,
            CHART_WIDTH,
            CHART_HEIGHT,
            houseRangeEndStockValue,
            detail?.stock_on_hand ?? null,
            projectedStockByDay,
          )
        : null,
    [weekdayHouseComparison, houseStockSeries, houseRangeEndStockValue, detail?.stock_on_hand, projectedStockByDay],
  );

  const activeChart = housesMode ? houseChart : stockRangeChart;
  const { activeSelection, hoveredPointIndex, clearSelection, reset, pointerHandlers } = useChartSelection(activeChart);

  useEffect(() => {
    reset();
    setIsEditingBufferWeeks(false);
    setIsEditingLeadTimeMode(false);
  }, [selected?.sku, history?.generated_at, detail?.stock_on_hand, houseViewMode, houseComparison?.generated_at, houseRange.startDate, houseRange.endDate]);

  if (!selected) {
    return <NoSelectionPlaceholder />;
  }

  const stockSummary = stockRangeChart ? getSeriesSummary(stockRangeChart.points, activeSelection) : null;
  const houseSummary = houseChart ? getHouseSeriesSummary(houseChart.points, activeSelection) : null;
  const houseStockSummary = houseChart ? getHouseStockSeriesSummary(houseChart.points, activeSelection) : null;
  const selectionBounds = activeSelection && activeChart ? getClampedSelectionBounds(activeSelection, activeChart.points.length) : null;
  const selectionEdges =
    selectionBounds && activeChart
      ? { start: activeChart.points[selectionBounds.startIndex], end: activeChart.points[selectionBounds.endIndex] }
      : null;
  const hoveredStockPoint = stockRangeChart && hoveredPointIndex !== null ? stockRangeChart.points[hoveredPointIndex] || null : null;
  const hoveredHousePoint = houseChart && hoveredPointIndex !== null ? houseChart.points[hoveredPointIndex] || null : null;
  const isCustomSelection = Boolean(selectionBounds && selectionBounds.startIndex !== selectionBounds.endIndex);
  const isBlockingLoad = !historyError && (!detail || !history);
  const isHouseBlockingLoad = !historyError && !houseComparisonError && housesMode && (!detail || !history || !houseComparison);
  const isRefreshing = detailRefreshing || historyRefreshing;

  const bufferWeeks = Math.max(Number(bufferWeeksInput) || 0, 0);
  const leadTimeReference = getLeadTimeReference(detail, leadTimeMode);
  const activeStockSummary = housesMode ? houseStockSummary : stockSummary;
  const purchaseOrderEstimate = getPurchaseOrderEstimate({
    detail,
    summary: activeStockSummary,
    leadTimeReference,
    isCustomSelection,
    bufferWeeks,
  });
  const estimatedConsumptionPerWeek =
    housesMode && hasExpectedComparison && houseComparisonInRange
      ? isCustomSelection
        ? houseSummary?.averageProjectedConsumptionPerWeek ?? null
        : houseComparisonInRange.total_expected_material_quantity / Math.max((houseChart?.points.length ?? 0) / 5, 0.2)
      : null;
  const estimatedConsumptionPurchaseOrderEstimate = getEstimatedConsumptionPurchaseOrderEstimate({
    detail,
    leadTimeReference,
    estimatedConsumptionPerWeek,
    isCustomSelection,
    bufferWeeks,
  });

  const selectedBadge = groupSelection ? `Grupo #${selectedGroup?.group_id}` : selected.sku;
  const selectedUnitLabel = groupSelection ? selectedGroup?.study_unit : selected.unit;
  const canInspectProjectUsage = Boolean(!groupSelection && onInspectProjectUsage);
  const detailMembers = isGroupDetail(detail) ? detail.members : [];
  const actualConsumptionPerHouse = houseSummary?.averageConsumptionPerHouse ?? houseComparisonInRange?.material_per_house ?? null;
  const projectedConsumptionPerHouse = hasExpectedComparison
    ? houseSummary?.expectedConsumptionPerMappedHouse ?? houseComparisonInRange?.expected_material_per_mapped_house ?? null
    : null;
  const projectedConsumptionBreakdown = hasExpectedComparison
    ? houseSummary?.expectedBreakdown ?? houseComparisonInRange?.expected_breakdown ?? []
    : [];
  const actualConsumptionTotal = houseSummary?.materialConsumed ?? houseComparisonInRange?.total_material_quantity ?? null;
  const expectedConsumptionTotal = hasExpectedComparison
    ? houseSummary?.projectedMaterialConsumed ?? houseComparisonInRange?.total_expected_material_quantity ?? null
    : null;
  const housesProducedInRange = houseSummary?.housesProduced ?? houseComparisonInRange?.total_house_starts ?? null;
  const unmappedStartsInRange = houseComparisonInRange?.total_unmapped_house_starts ?? 0;
  // Houses linked to a project whose BOM still has undefined quantities: their
  // consumption is counted with what is defined so far, so the estimate is a
  // lower bound rather than a gap in the analysis.
  const partialStartsInRange =
    houseSummary?.partialHousesProduced ?? houseComparisonInRange?.total_partial_house_starts ?? 0;
  const partialMissingQuantityCount = (houseComparisonInRange?.partial_summary || []).reduce(
    (total, row) => total + (row.missing_quantity_count || 0),
    0,
  );
  const purchaseOrders = detail && "purchase_orders" in detail ? detail.purchase_orders : [];
  const purchasePriceStats = groupSelection ? null : getPurchaseOrderPriceStats(purchaseOrders);
  // Stock-out risk uses the same consumption rates as the purchase order
  // estimates, but simulates day by day so scheduled PO arrivals count.
  const historicalDailyRate = isCustomSelection
    ? activeStockSummary?.averageConsumptionPerDay ?? null
    : detail?.average_daily_outgoing_30d ?? null;
  const stockRisk =
    detail && isFiniteNumber(detail.stock_on_hand)
      ? assessStockoutRisk({
          stockOnHand: detail.stock_on_hand,
          historicalDailyRate,
          estimatedDailyRate:
            isFiniteNumber(estimatedConsumptionPerWeek) && estimatedConsumptionPerWeek > 0 ? estimatedConsumptionPerWeek / 5 : null,
          purchaseOrders,
          fallbackPendingQuantity: detail.pending_purchase_quantity,
          leadTimeReference,
          bufferWeeks,
        })
      : null;
  const priceVolatility = !groupSelection
    ? {
        deltaPercent: economicMetric?.purchase_price_delta_percent ?? purchasePriceStats?.deltaPercent ?? null,
        delta: economicMetric?.purchase_price_delta ?? purchasePriceStats?.delta ?? null,
        minPrice: economicMetric?.min_purchase_price ?? purchasePriceStats?.minPrice ?? null,
        maxPrice: economicMetric?.max_purchase_price ?? purchasePriceStats?.maxPrice ?? null,
      }
    : null;
  const lastPurchasePrice = detail && "last_purchase_price" in detail ? detail.last_purchase_price : null;
  const displayPrice =
    priceDisplayMode === "last"
      ? lastPurchasePrice ?? purchasePriceStats?.lastPrice ?? null
      : detail?.average_price ?? null;
  const houseMetricDigits = getAdaptiveDecimalPlaces(actualConsumptionPerHouse, projectedConsumptionPerHouse);
  // Deltas compare range totals: real consumption covers every house started,
  // expected consumption only the mapped ones, so per-house ratios would mix
  // denominators.
  const consumptionDeltaPercent =
    actualConsumptionTotal !== null && expectedConsumptionTotal !== null && expectedConsumptionTotal !== 0
      ? ((actualConsumptionTotal - expectedConsumptionTotal) / expectedConsumptionTotal) * 100
      : null;
  const calculatedConsumptionCostDeltaPerHouse =
    actualConsumptionTotal !== null &&
    expectedConsumptionTotal !== null &&
    housesProducedInRange !== null &&
    housesProducedInRange > 0 &&
    detail?.average_price !== null &&
    detail?.average_price !== undefined
      ? ((actualConsumptionTotal - expectedConsumptionTotal) * detail.average_price) / housesProducedInRange
      : null;
  const consumptionCostDeltaPerHouse =
    !isCustomSelection && economicMetric?.consumption_cost_delta_per_house !== null && economicMetric?.consumption_cost_delta_per_house !== undefined
      ? economicMetric.consumption_cost_delta_per_house
      : calculatedConsumptionCostDeltaPerHouse;
  const groupCostBreakdown = groupSelection && !isCustomSelection ? getGroupCostBreakdown(economicMetric) : [];
  const activeMovementRangeStart = housesMode
    ? houseSummary?.start.date ?? houseComparisonInRange?.range_start ?? houseRange.startDate
    : stockSummary?.start.date ?? houseRange.startDate;
  const activeMovementRangeEnd = housesMode
    ? houseSummary?.end.date ?? houseComparisonInRange?.range_end ?? houseRange.endDate
    : stockSummary?.end.date ?? houseRange.endDate;
  const filteredHouseMovementDetails = (history?.movement_details || []).filter((movement) =>
    isDateWithinRange(movement.date, activeMovementRangeStart, activeMovementRangeEnd),
  );

  // Range edits stay in draftRange until the range is complete: picking a
  // start date alone must not reload the dashboard (the end date comes next).
  const isDraftRangeDirty = draftRange.startDate !== houseRange.startDate || draftRange.endDate !== houseRange.endDate;

  function applyDraftRange(range: HouseRange) {
    const clamped = clampHouseRange(range);
    setDraftRange(clamped);
    if (clamped.startDate !== houseRange.startDate || clamped.endDate !== houseRange.endDate) {
      onHouseRangeChange(clamped);
    }
  }

  function handleDraftStartChange(value: string) {
    if (!value) {
      return;
    }
    setDraftRange((current) => ({ ...current, startDate: value }));
  }

  function handleDraftEndChange(value: string) {
    if (!value) {
      return;
    }
    // Choosing the end date completes the range, so apply immediately.
    applyDraftRange({ startDate: draftRange.startDate, endDate: value });
  }

  return (
    <section className="flex h-full flex-1 flex-col overflow-y-auto bg-zinc-100/60 dark:bg-zinc-950 lg:overflow-hidden">
      <div className="z-10 flex shrink-0 flex-col justify-between gap-4 border-b border-black/[0.07] bg-white px-5 py-4 shadow-[0_4px_18px_rgba(0,0,0,0.025)] dark:border-white/10 dark:bg-zinc-950 md:flex-row md:items-start md:px-6">
        <div className="min-w-0 md:flex-1">
          <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">Gráfico fijado</p>
          <div className="flex min-w-0 items-start gap-3">
            <h2 className="min-w-0 flex-1 break-words text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">{selected.material_name}</h2>
            {canInspectProjectUsage ? (
              <button
                type="button"
                onClick={() => onInspectProjectUsage?.()}
                className="mt-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-black/10 bg-white/80 text-zinc-500 transition-colors hover:border-accent-500/50 hover:text-accent-700 dark:border-white/10 dark:bg-white/[0.06] dark:text-zinc-400 dark:hover:text-accent-300"
                title="Ver dónde se especifica este material en el proyecto seleccionado"
                aria-label={`Ver uso de ${selected.material_name} en el proyecto seleccionado`}
              >
                <i className="ph-bold ph-info text-sm" />
              </button>
            ) : null}
          </div>
          <p className="mt-2 flex min-w-0 flex-wrap items-center gap-2 text-sm font-medium text-zinc-500">
            <span className="bg-zinc-200 px-2 py-0.5 font-mono text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">{selectedBadge}</span>
            {selectedUnitLabel ? <span>&bull; {selectedUnitLabel}</span> : null}
            {groupSelection ? <span>&bull; {formatNumber(selectedGroup?.member_count, 0)} miembros</span> : null}
          </p>
          {groupSelection && detailMembers.length ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {detailMembers.map((member) => (
                <span
                  key={member.sku}
                  className="rounded-full border border-black/10 bg-white/80 px-2.5 py-1 text-[10px] font-medium text-zinc-600 dark:border-white/10 dark:bg-white/[0.05] dark:text-zinc-300"
                >
                  {member.sku} = {formatNumber(member.factor_to_study_unit)} {detail?.unit || selectedGroup?.study_unit}
                </span>
              ))}
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap items-end gap-x-4 gap-y-3 tabular-nums md:min-w-0 md:justify-end xl:shrink-0 xl:flex-nowrap">
          <div className="text-right">
            <HeaderStatLabel>{housesMode ? "Cons./Vivienda" : "Stock Disponible"}</HeaderStatLabel>
            <div className="flex items-center justify-end gap-2">
              <div className="flex items-baseline justify-end gap-1.5 text-2xl font-medium tracking-tight text-zinc-900 dark:text-white">
                <span>
                {housesMode
                  ? houseSummary
                    ? formatNumber(houseSummary.averageConsumptionPerHouse, houseMetricDigits)
                    : houseComparisonInRange
                      ? formatNumber(houseComparisonInRange.material_per_house, houseMetricDigits)
                      : houseComparisonLoading
                        ? "..."
                        : "—"
                  : detail
                    ? formatNumber(detail.stock_on_hand)
                    : detailLoading
                      ? "..."
                      : "—"}
                </span>
                {selectedUnitLabel ? <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">{selectedUnitLabel}</span> : null}
              </div>
              {housesMode && consumptionDeltaPercent !== null ? (
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold ${
                    consumptionDeltaPercent > 0
                      ? "bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300"
                      : "bg-zinc-100 text-zinc-600 dark:bg-white/10 dark:text-zinc-300"
                  }`}
                  title="Diferencia entre el consumo real total y el consumo estimado de las viviendas vinculadas en el rango"
                >
                  <span>{consumptionDeltaPercent > 0 ? "↑" : consumptionDeltaPercent < 0 ? "↓" : "→"}</span>
                  <span>{percentFormatter.format(Math.abs(consumptionDeltaPercent))}%</span>
                </span>
              ) : null}
            </div>
          </div>
          {housesMode && projectedConsumptionPerHouse !== null ? (
            <>
              <HeaderStatDivider />
              <div className="group/estimate relative text-right" tabIndex={0}>
                <HeaderStatLabel>
                  <span className="inline-flex items-center gap-1">
                    Est./Vivienda
                    {projectedConsumptionBreakdown.length ? <i className="ph-bold ph-info text-[11px] text-zinc-400" /> : null}
                  </span>
                </HeaderStatLabel>
                <div className="flex items-baseline justify-end gap-1.5 text-2xl font-medium tracking-tight text-zinc-900 dark:text-white">
                  <span>{formatNumber(projectedConsumptionPerHouse, houseMetricDigits)}</span>
                  {selectedUnitLabel ? <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">{selectedUnitLabel}</span> : null}
                </div>
                <ExpectedBreakdownTooltip breakdown={projectedConsumptionBreakdown} digits={houseMetricDigits} />
              </div>
            </>
          ) : null}
          {housesMode && consumptionCostDeltaPerHouse !== null ? (
            <>
              <HeaderStatDivider />
              <div className={groupCostBreakdown.length ? "group/cost relative text-right" : "text-right"} tabIndex={groupCostBreakdown.length ? 0 : undefined}>
                <HeaderStatLabel>
                  <span className="inline-flex items-center gap-1">
                    {consumptionCostDeltaPerHouse > 0 ? "Sobrecosto/Vivienda" : consumptionCostDeltaPerHouse < 0 ? "Ahorro/Vivienda" : "Costo/Vivienda"}
                    {groupCostBreakdown.length ? <i className="ph-bold ph-info text-[11px] text-zinc-400" /> : null}
                  </span>
                </HeaderStatLabel>
                <div
                  className={`text-2xl font-medium tracking-tight ${
                    consumptionCostDeltaPerHouse > 0
                      ? "text-red-700 dark:text-red-300"
                      : "text-zinc-900 dark:text-white"
                  }`}
                >
                  {formatCurrency(Math.abs(consumptionCostDeltaPerHouse))}
                </div>
                <GroupCostBreakdownTooltip breakdown={groupCostBreakdown} studyUnit={selectedUnitLabel} />
              </div>
            </>
          ) : null}
          <HeaderStatDivider />
          <div className="text-right">
            {groupSelection ? (
              <>
                <HeaderStatLabel>Unidad de Estudio</HeaderStatLabel>
                <div className="text-2xl font-medium tracking-tight text-zinc-900 dark:text-white">{detail?.unit || selectedGroup?.study_unit}</div>
              </>
            ) : (
              <>
                <div className="mb-1 flex items-center justify-end gap-2">
                  <div
                    className="group/price relative inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-500"
                    tabIndex={0}
                  >
                    <span>{priceDisplayMode === "last" ? "Último Precio" : "Precio Prom."}</span>
                    <i className="ph-bold ph-info text-[11px]" />
                    <div className="pointer-events-none absolute right-0 top-full z-30 mt-2 hidden w-80 rounded-lg border border-black/10 bg-white p-3 text-left text-[11px] font-medium normal-case leading-5 tracking-normal text-zinc-600 shadow-xl group-hover/price:block group-focus/price:block dark:border-white/10 dark:bg-zinc-950 dark:text-zinc-300">
                      Precio Prom. es el costo promedio ERP calculado a la fecha actual para el SKU completo. No promedia solo el rango visible, ni solo movimientos consumidos, ni CECOs del historial. Último precio usa la OC más reciente con precio unitario. La volatilidad compara el mayor y menor precio unitario dentro de las últimas 10 líneas de OC; revisa UM recep. en el detalle de OC para detectar cambios históricos de unidad.
                    </div>
                  </div>
                  <div className="inline-flex border border-black/10 bg-zinc-100/80 p-0.5 dark:border-white/10 dark:bg-white/[0.04]">
                    {(["average", "last"] as PriceDisplayMode[]).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setPriceDisplayMode(mode)}
                        className={`px-2 py-0.5 text-[10px] font-semibold transition-colors ${
                          priceDisplayMode === mode
                            ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-900 dark:text-white"
                            : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
                        }`}
                      >
                        {mode === "average" ? "Prom." : "Últ."}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex items-center justify-end gap-2">
                  <div className="text-2xl font-medium tracking-tight text-zinc-900 dark:text-white">
                    {detail ? formatCurrency(displayPrice) : detailLoading ? "..." : "—"}
                  </div>
                  {priceVolatility && isFiniteNumber(priceVolatility.deltaPercent) ? (
                    <span
                      className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-1 text-[11px] font-semibold text-zinc-600 dark:bg-white/10 dark:text-zinc-300"
                      title={`Mayor ${formatCurrency(priceVolatility.maxPrice)} - menor ${formatCurrency(priceVolatility.minPrice)} = ${formatCurrency(priceVolatility.delta)}`}
                    >
                      <span>↕</span>
                      <span>{formatUnsignedPercent(priceVolatility.deltaPercent)}</span>
                    </span>
                  ) : null}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="grid flex-1 grid-cols-1 lg:min-h-0 lg:grid-cols-[minmax(0,1fr),328px]">
        <div className="flex flex-col border-b border-black/[0.07] bg-white p-5 dark:border-white/10 dark:bg-zinc-950 md:p-6 lg:min-h-0 lg:overflow-y-auto lg:border-b-0 lg:border-r">
          <div className="flex items-start justify-between mb-2 gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-3">
                <div className="inline-flex h-8 border border-black/10 bg-zinc-100/80 p-0.5 dark:border-white/10 dark:bg-white/[0.04]">
                  {([
                    { mode: "houses" as HouseViewMode, label: "Viviendas" },
                    { mode: "stock" as HouseViewMode, label: "Stock" },
                  ]).map(({ mode, label }) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => onHouseViewModeChange(mode)}
                      className={`px-3 text-xs font-semibold transition-colors ${
                        houseViewMode === mode
                          ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-900 dark:text-white"
                          : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="inline-flex h-8 items-center gap-1 border border-black/10 bg-zinc-50 px-1 dark:border-white/10 dark:bg-white/[0.03]">
                  <input
                    type="date"
                    value={draftRange.startDate}
                    max={draftRange.endDate}
                    onChange={(event) => handleDraftStartChange(event.target.value)}
                    aria-label="Fecha de inicio"
                    className={RANGE_DATE_INPUT_CLASSES}
                  />
                  <span className="text-[11px] text-zinc-400">-</span>
                  <input
                    type="date"
                    value={draftRange.endDate}
                    min={draftRange.startDate}
                    max={latestHouseRangeValue}
                    onChange={(event) => handleDraftEndChange(event.target.value)}
                    aria-label="Fecha de término"
                    className={RANGE_DATE_INPUT_CLASSES}
                  />
                  {isDraftRangeDirty ? (
                    <button
                      type="button"
                      onClick={() => applyDraftRange(draftRange)}
                      className="h-7 bg-accent-600 px-2.5 text-[11px] font-semibold text-white transition-colors hover:bg-accent-500"
                    >
                      Aplicar
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => applyDraftRange(getDefaultHouseRange())}
                    className="h-7 px-2.5 text-[11px] font-medium text-zinc-500 transition-colors hover:bg-black/[0.05] hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-white/[0.06] dark:hover:text-zinc-200"
                  >
                    90d
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => onOpenLinksModal("links")}
                  className="inline-flex h-8 items-center gap-1.5 border border-black/10 bg-white px-3 text-xs font-medium text-zinc-600 shadow-sm transition-colors hover:border-accent-500/50 hover:text-accent-700 dark:border-white/10 dark:bg-white/[0.06] dark:text-zinc-300 dark:hover:text-accent-300"
                  title="Ver y editar la vinculación de tipos de vivienda con proyectos, y revisar los inicios del rango"
                >
                  <i className="ph-bold ph-link" />
                  Vinculación
                </button>
              </div>
              {!housesMode ? (
                <p className="mt-1.5 text-xs text-zinc-500 max-w-sm">
                  Haz clic y arrastra sobre la curva para revisar la variación de stock y el consumo promedio en días hábiles. Se omiten los fines de semana.
                </p>
              ) : null}
              {isRefreshing ? <p className="mt-1 text-xs text-zinc-500">Actualizando datos ERP en caché...</p> : null}
              {houseComparisonRefreshing && housesMode ? (
                <p className="mt-1 text-xs text-zinc-500">Actualizando comparación de inicios de vivienda...</p>
              ) : null}
              {houseComparisonError && housesMode ? <p className="mt-1 text-xs text-red-600 dark:text-red-400">{houseComparisonError}</p> : null}
            </div>
            {isCustomSelection ? (
              <div className="shrink-0">
                <button
                  type="button"
                  onClick={clearSelection}
                  className="h-8 border border-black/10 px-3 text-[11px] font-medium text-zinc-600 transition-colors hover:bg-black/[0.04] hover:text-zinc-900 dark:border-white/10 dark:text-zinc-300 dark:hover:bg-white/[0.06] dark:hover:text-white"
                >
                  Limpiar selección
                </button>
              </div>
            ) : null}
          </div>

          <div className="flex-1 w-full relative min-h-[220px]">
            {!housesMode ? (
              isBlockingLoad ? (
                <TrendChartSkeleton />
              ) : stockRangeChart ? (
                <StockTrendChart
                  chart={stockRangeChart}
                  selectionBounds={selectionBounds}
                  selectionEdges={selectionEdges}
                  hoveredPoint={hoveredStockPoint}
                  pointerHandlers={pointerHandlers}
                />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center text-sm text-zinc-500">No hay historial de movimientos disponible para este estudio.</div>
              )
            ) : isHouseBlockingLoad ? (
              <TrendChartSkeleton dualSeries />
            ) : houseComparison && houseChart ? (
              <HouseTrendChart
                chart={houseChart}
                selectionBounds={selectionBounds}
                selectionEdges={selectionEdges}
                hoveredPoint={hoveredHousePoint}
                pointerHandlers={pointerHandlers}
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-sm text-zinc-500">No hay datos de inicios de vivienda para este rango.</div>
            )}
          </div>

          {activeChart?.points.length ? (
            <details className="mt-2 text-xs text-zinc-500">
              <summary className="w-fit cursor-pointer px-1 py-0.5 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500">
                Ver datos del gráfico
              </summary>
              <div className="mt-2 max-h-56 overflow-auto border border-black/10 dark:border-white/10">
                <table className="w-full border-collapse text-left tabular-nums">
                  <thead className="sticky top-0 bg-zinc-50 text-[10px] uppercase tracking-wider dark:bg-zinc-900">
                    <tr>
                      <th className="px-3 py-2">Fecha</th>
                      <th className="px-3 py-2 text-right">Stock</th>
                      {housesMode ? <th className="px-3 py-2 text-right">Inicios restantes</th> : null}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-black/5 dark:divide-white/5">
                    {activeChart.points.map((point) => (
                      <tr key={point.date}>
                        <td className="px-3 py-1.5">{formatDate(point.date)}</td>
                        <td className="px-3 py-1.5 text-right">
                          {formatNumber("stockValue" in point ? point.stockValue : point.value)}
                        </td>
                        {housesMode ? (
                          <td className="px-3 py-1.5 text-right">
                            {formatNumber("remainingHouseStarts" in point ? point.remainingHouseStarts : null, 0)}
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          ) : null}

          {housesMode ? (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
              <div className="flex items-center gap-2 bg-zinc-100/70 px-2.5 py-1.5 dark:bg-white/[0.04]">
                <span className="block h-0.5 w-6 rounded-full bg-amber-500" />
                <span>Stock de material</span>
              </div>
              {hasExpectedComparison ? (
                <div className="flex items-center gap-2 bg-zinc-100/70 px-2.5 py-1.5 dark:bg-white/[0.04]">
                  <span className="block h-0.5 w-6 rounded-full bg-emerald-500" />
                  <span>
                    Stock proyectado según vinculación
                    {houseComparisonInRange?.mapped_projects.length
                      ? ` (${houseComparisonInRange.mapped_projects.map((project) => project.project_name).join(", ")})`
                      : ""}
                  </span>
                </div>
              ) : null}
              <div className="flex items-center gap-2 bg-zinc-100/70 px-2.5 py-1.5 dark:bg-white/[0.04]">
                <span className="block h-0.5 w-6 rounded-full bg-slate-700 dark:bg-slate-300" />
                <span>Inicios de vivienda restantes</span>
              </div>
              {!hasExpectedComparison && houseComparisonInRange ? (
                <button
                  type="button"
                  onClick={() => onOpenLinksModal("links")}
                  className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 font-semibold text-amber-700 transition-colors hover:bg-amber-100 dark:bg-amber-500/10 dark:text-amber-300 dark:hover:bg-amber-500/20"
                >
                  ⚠ Sin vinculación configurada
                </button>
              ) : null}
              {unmappedStartsInRange > 0 ? (
                <button
                  type="button"
                  onClick={() => onOpenLinksModal("starts")}
                  className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 font-semibold text-amber-700 transition-colors hover:bg-amber-100 dark:bg-amber-500/10 dark:text-amber-300 dark:hover:bg-amber-500/20"
                  title="Estas viviendas cuentan como inicios pero no aportan consumo estimado"
                >
                  ⚠ {unmappedStartsInRange} {unmappedStartsInRange === 1 ? "inicio sin vincular" : "inicios sin vincular"}
                </button>
              ) : null}
              {partialStartsInRange > 0 ? (
                <button
                  type="button"
                  onClick={() => onOpenLinksModal("starts")}
                  className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 font-semibold text-amber-700 transition-colors hover:bg-amber-100 dark:bg-amber-500/10 dark:text-amber-300 dark:hover:bg-amber-500/20"
                  title={`Estas viviendas sí aportan consumo estimado, pero su proyecto vinculado aún tiene ${
                    partialMissingQuantityCount || "algunas"
                  } cantidades sin definir: el consumo estimado es un piso, no el total.`}
                >
                  ⚠ {partialStartsInRange} {partialStartsInRange === 1 ? "inicio con BOM incompleta" : "inicios con BOM incompleta"}
                </button>
              ) : null}
            </div>
          ) : null}

          <MovementBreakdownList
            movements={filteredHouseMovementDetails}
            loading={!history && !historyError}
            rangeStart={activeMovementRangeStart}
            rangeEnd={activeMovementRangeEnd}
            unitLabel={selectedUnitLabel}
          />
        </div>

        <div className="flex flex-col bg-zinc-100/70 dark:bg-white/[0.025] lg:min-h-0 lg:overflow-y-auto">
          <StockRiskPanel assessment={stockRisk} unitLabel={selectedUnitLabel} loading={detailLoading} />
          <ProcurementMetricsPanel
            detail={detail}
            detailLoading={detailLoading}
            groupSelection={groupSelection}
            leadTimeMode={leadTimeMode}
            onLeadTimeModeChange={onLeadTimeModeChange}
            leadTimeReference={leadTimeReference}
            bufferWeeks={bufferWeeks}
            bufferWeeksInput={bufferWeeksInput}
            onBufferWeeksInputChange={setBufferWeeksInput}
            isEditingBufferWeeks={isEditingBufferWeeks}
            onEditingBufferWeeksChange={setIsEditingBufferWeeks}
            isEditingLeadTimeMode={isEditingLeadTimeMode}
            onEditingLeadTimeModeChange={setIsEditingLeadTimeMode}
            purchaseOrderEstimate={purchaseOrderEstimate}
            estimatedConsumptionPurchaseOrderEstimate={estimatedConsumptionPurchaseOrderEstimate}
          />
        </div>
      </div>
    </section>
  );
});
