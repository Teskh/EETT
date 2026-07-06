import { memo, useEffect, useMemo, useState } from "react";

import type { MaterialDashboardEconomicMetric, MaterialDashboardHouseType, ProjectSummary } from "../../../lib/types";
import {
  getDefaultHouseRange,
  isDateWithinRange,
  isWeekend,
  moveToNextBusinessDay,
  moveToPreviousBusinessDay,
  toDateInputValue,
  toStartOfDay,
  type HouseRange,
} from "../dates";
import {
  formatCondensedDate,
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
  getLeadTimeDigits,
  getLeadTimeModeLabel,
  getLeadTimeReference,
  getPurchaseOrderEstimate,
  getPurchaseOrderPriceStats,
  getPurchaseOrderUrgencyClasses,
  type EstimatedConsumptionPurchaseOrderEstimate,
  type LeadTimeMode,
  type LeadTimeReference,
  type PurchaseOrderEstimate,
} from "../procurement";
import {
  isGroupDetail,
  isGroupRow,
  type DashboardDetailLike,
  type DashboardHistoryLike,
  type DashboardHouseComparisonLike,
  type DashboardSelectionRow,
} from "../selection";
import {
  CHART_HEIGHT,
  CHART_WIDTH,
  buildHistoricalStockSeries,
  buildLinePath,
  getClampedSelectionBounds,
  getSeriesSummary,
} from "../stockSeries";
import { useChartSelection } from "../useChartSelection";

import { MetricRow, PurchaseOrderHoverValue } from "./Metrics";
import { MovementBreakdownList } from "./MovementBreakdownList";
import { TrendChartSkeleton } from "./Skeletons";
import { HouseTrendChart, StockTrendChart } from "./TrendCharts";

type PriceDisplayMode = "average" | "last";

const SELECT_CLASSES =
  "rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-zinc-900 px-3 py-1.5 text-sm text-zinc-900 dark:text-white outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500 transition-colors";
const RANGE_DATE_INPUT_CLASSES =
  "w-[106px] rounded-full bg-transparent px-2 py-0.5 text-[11px] font-medium text-zinc-600 outline-none transition-colors hover:bg-black/[0.03] focus:bg-white/80 focus:ring-1 focus:ring-accent-500/50 dark:text-zinc-300 dark:hover:bg-white/[0.04] dark:focus:bg-white/[0.06] [color-scheme:light] dark:[color-scheme:dark]";

function NoSelectionPlaceholder() {
  return (
    <section className="flex-1 flex items-center justify-center bg-white dark:bg-zinc-950 h-full">
      <div className="text-center max-w-xl p-8">
        <div className="w-16 h-16 rounded-2xl bg-zinc-100 dark:bg-white/5 mx-auto flex items-center justify-center mb-6">
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
  return <div className="text-[10px] font-bold uppercase tracking-[0.25em] text-zinc-500 mb-1">{children}</div>;
}

function HeaderStatDivider() {
  return <div className="w-px h-10 bg-black/10 dark:bg-white/10 hidden md:block" />;
}

function ProcurementMetricsPanel({
  movementQuantity,
  detail,
  detailLoading,
  groupSelection,
  leadTimeMode,
  onLeadTimeModeChange,
  leadTimeReference,
  bufferWeeks,
  bufferWeeksInput,
  onBufferWeeksInputChange,
  isEditingBufferWeeks,
  onEditingBufferWeeksChange,
  isEditingLeadTimeMode,
  onEditingLeadTimeModeChange,
  purchaseOrderEstimate,
  estimatedConsumptionPurchaseOrderEstimate,
}: {
  movementQuantity: number;
  detail: DashboardDetailLike | null;
  detailLoading: boolean;
  groupSelection: boolean;
  leadTimeMode: LeadTimeMode;
  onLeadTimeModeChange: (mode: LeadTimeMode) => void;
  leadTimeReference: LeadTimeReference | null;
  bufferWeeks: number;
  bufferWeeksInput: string;
  onBufferWeeksInputChange: (value: string) => void;
  isEditingBufferWeeks: boolean;
  onEditingBufferWeeksChange: (editing: boolean) => void;
  isEditingLeadTimeMode: boolean;
  onEditingLeadTimeModeChange: (editing: boolean) => void;
  purchaseOrderEstimate: PurchaseOrderEstimate | null;
  estimatedConsumptionPurchaseOrderEstimate: EstimatedConsumptionPurchaseOrderEstimate | null;
}) {
  const closeOnEnterOrEscape = (close: () => void) => (event: React.KeyboardEvent) => {
    if (event.key === "Enter" || event.key === "Escape") {
      close();
    }
  };

  return (
    <div className="p-6 md:p-8 bg-zinc-50/50 dark:bg-white/[0.02] flex flex-col gap-6">
      <div>
        <h3 className="text-[10px] font-bold uppercase tracking-[0.25em] text-zinc-500 mb-4">Métricas de Compras</h3>
        <div className="space-y-3">
          <MetricRow label="Período mov." value={formatNumber(movementQuantity)} />
          <MetricRow
            label="Pend. OC"
            value={
              detail ? (
                !groupSelection && !isGroupDetail(detail) ? (
                  <PurchaseOrderHoverValue value={formatNumber(detail.pending_purchase_quantity)} purchaseOrders={detail.purchase_orders || []} />
                ) : (
                  formatNumber(detail.pending_purchase_quantity)
                )
              ) : detailLoading ? (
                "..."
              ) : (
                "—"
              )
            }
          />
          <MetricRow
            label="Plazo"
            value={
              !detail ? (detailLoading ? "..." : "—") : isEditingLeadTimeMode ? (
                <select
                  autoFocus
                  value={leadTimeMode}
                  onChange={(event) => onLeadTimeModeChange(event.target.value as LeadTimeMode)}
                  onBlur={() => onEditingLeadTimeModeChange(false)}
                  onKeyDown={closeOnEnterOrEscape(() => onEditingLeadTimeModeChange(false))}
                  className="rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-zinc-900 px-2 py-1 text-sm font-semibold text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-400/50"
                >
                  <option value="worst">Peor</option>
                  <option value="median">Mediana</option>
                  <option value="average">Promedio</option>
                </select>
              ) : (
                <button
                  type="button"
                  onClick={() => onEditingLeadTimeModeChange(true)}
                  className="rounded-lg px-2 py-1 -mx-2 text-sm font-semibold text-zinc-900 dark:text-white hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                  title="Haz clic para elegir la métrica de plazo usada en esta página"
                >
                  {leadTimeReference ? `${formatNumber(leadTimeReference.days, getLeadTimeDigits(leadTimeReference.source))} d` : "—"}
                  <span className="ml-2 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">
                    {getLeadTimeModeLabel(leadTimeMode)}
                  </span>
                </button>
              )
            }
          />
          <MetricRow
            label="Buffer sem."
            value={
              isEditingBufferWeeks ? (
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    autoFocus
                    value={bufferWeeksInput}
                    onChange={(event) => onBufferWeeksInputChange(event.target.value)}
                    onBlur={() => onEditingBufferWeeksChange(false)}
                    onKeyDown={closeOnEnterOrEscape(() => onEditingBufferWeeksChange(false))}
                    className="w-24 rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-zinc-900 px-2 py-1 text-right text-sm font-semibold text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-400/50"
                  />
                  <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">semanas</span>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => onEditingBufferWeeksChange(true)}
                  className="rounded-lg px-2 py-1 -mx-2 text-sm font-semibold text-zinc-900 dark:text-white hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                  title="Haz clic para editar el colchón de stock en semanas"
                >
                  {formatNumber(bufferWeeks)}
                  <span className="ml-2 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">semanas</span>
                </button>
              )
            }
          />
          <MetricRow
            label="Min. stock calc."
            value={purchaseOrderEstimate ? formatNumber(purchaseOrderEstimate.minimumExpectedStock) : "—"}
          />
          <MetricRow
            label="Cons. usada"
            value={
              purchaseOrderEstimate
                ? `${formatNumber(purchaseOrderEstimate.rateUsed)} / d${purchaseOrderEstimate.rateSource === "selection" ? " sel." : ""}`
                : "—"
            }
          />
          <div className="group border-b border-black/5 py-1.5 transition-colors last:border-0 hover:bg-black/[0.02] dark:border-white/5 dark:hover:bg-white/[0.02]">
            <div className="flex items-start justify-between">
              <div className="text-xs font-medium text-zinc-500 transition-colors group-hover:text-zinc-700 dark:group-hover:text-zinc-300">Nueva OC</div>
              <div className="text-right">
                <div className="text-xs text-zinc-500">
                  <span className="font-medium">histórico:</span>{" "}
                  <span className={getPurchaseOrderUrgencyClasses(purchaseOrderEstimate?.purchaseOrderDate)}>
                    {formatCondensedDate(purchaseOrderEstimate?.purchaseOrderDate)}
                  </span>
                </div>
                <div className="text-xs text-zinc-500 mt-0.5">
                  <span className="font-medium">estimado:</span>{" "}
                  <span className={getPurchaseOrderUrgencyClasses(estimatedConsumptionPurchaseOrderEstimate?.purchaseOrderDate)}>
                    {formatCondensedDate(estimatedConsumptionPurchaseOrderEstimate?.purchaseOrderDate)}
                  </span>
                </div>
              </div>
            </div>
          </div>
          <MetricRow
            label="Cons. est./sem"
            value={
              estimatedConsumptionPurchaseOrderEstimate
                ? `${formatNumber(estimatedConsumptionPurchaseOrderEstimate.estimatedConsumptionPerWeek)}${estimatedConsumptionPurchaseOrderEstimate.rateSource === "selection" ? " sel." : ""}`
                : "—"
            }
          />
          <MetricRow
            label="Min. est. calc."
            value={estimatedConsumptionPurchaseOrderEstimate ? formatNumber(estimatedConsumptionPurchaseOrderEstimate.minimumExpectedStock) : "—"}
          />
          <MetricRow label="Dias stock" value={detail ? formatNumber(detail.days_of_stock_30d) : detailLoading ? "..." : "—"} />
          <MetricRow label="Ult. OC" value={!groupSelection && detail ? formatDate(detail.last_purchase_order.date) : "—"} />
          <MetricRow label="No. OC" value={!groupSelection && detail ? detail.last_purchase_order.number || "—" : "—"} />
        </div>
      </div>
    </div>
  );
}

export const MovementHistoryCard = memo(function MovementHistoryCard({
  selected,
  detail,
  history,
  houseTypes,
  projects,
  selectedHouseTypeId,
  selectedProjectId,
  leadTimeMode,
  onSelectHouseType,
  onSelectProject,
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
  houseTypes: MaterialDashboardHouseType[];
  projects: ProjectSummary[];
  selectedHouseTypeId: number | null;
  selectedProjectId: number | null;
  leadTimeMode: LeadTimeMode;
  onSelectHouseType: (houseTypeId: number | null) => void;
  onSelectProject: (projectId: number | null) => void;
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
  const selectedGroup = isGroupRow(selected) ? selected : null;
  const groupSelection = Boolean(selectedGroup);

  const latestHouseRangeDate = moveToPreviousBusinessDay(new Date());
  const latestHouseRangeValue = toDateInputValue(latestHouseRangeDate);
  const selectedHouseType = houseTypes.find((houseType) => houseType.id === selectedHouseTypeId) || null;

  const houseComparisonInRange = useMemo(
    () => getHouseComparisonForRange(houseComparison, houseRange),
    [houseComparison, houseRange],
  );
  const projectComparisonInRange = houseComparisonInRange?.project_comparison ?? null;
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

  const activeChart = selectedHouseType ? houseChart : stockRangeChart;
  const { activeSelection, hoveredPointIndex, clearSelection, reset, pointerHandlers } = useChartSelection(activeChart);

  useEffect(() => {
    reset();
    setIsEditingBufferWeeks(false);
    setIsEditingLeadTimeMode(false);
  }, [selected?.sku, history?.generated_at, detail?.stock_on_hand, selectedHouseTypeId, selectedProjectId, houseComparison?.generated_at, houseRange.startDate, houseRange.endDate]);

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
  const isHouseBlockingLoad = !historyError && !houseComparisonError && Boolean(selectedHouseType) && (!detail || !history || !houseComparison);
  const isRefreshing = detailRefreshing || historyRefreshing;

  const bufferWeeks = Math.max(Number(bufferWeeksInput) || 0, 0);
  const leadTimeReference = getLeadTimeReference(detail, leadTimeMode);
  const purchaseOrderEstimate = getPurchaseOrderEstimate({
    detail,
    summary: selectedHouseType ? houseStockSummary : stockSummary,
    leadTimeReference,
    isCustomSelection,
    bufferWeeks,
  });
  const estimatedConsumptionPurchaseOrderEstimate = getEstimatedConsumptionPurchaseOrderEstimate({
    detail,
    leadTimeReference,
    estimatedConsumptionPerWeek:
      selectedHouseType && projectComparisonInRange
        ? isCustomSelection
          ? houseSummary?.averageProjectedConsumptionPerWeek ?? null
          : projectComparisonInRange.projected_total_material_quantity / Math.max((houseChart?.points.length ?? 0) / 5, 0.2)
        : null,
    isCustomSelection,
    bufferWeeks,
  });

  const selectedBadge = groupSelection ? `Group #${selectedGroup?.group_id}` : selected.sku;
  const selectedUnitLabel = groupSelection ? selectedGroup?.study_unit : selected.unit;
  const canInspectProjectUsage = Boolean(selectedProjectId && !groupSelection && onInspectProjectUsage);
  const detailMembers = isGroupDetail(detail) ? detail.members : [];
  const actualConsumptionPerHouse = houseSummary?.averageConsumptionPerHouse ?? houseComparisonInRange?.material_per_house ?? null;
  const projectedConsumptionPerHouse = projectComparisonInRange?.predicted_quantity_per_house ?? null;
  const purchaseOrders = detail && "purchase_orders" in detail ? detail.purchase_orders : [];
  const purchasePriceStats = groupSelection ? null : getPurchaseOrderPriceStats(purchaseOrders);
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
  const consumptionDeltaPercent =
    actualConsumptionPerHouse !== null && projectedConsumptionPerHouse && projectedConsumptionPerHouse !== 0
      ? ((actualConsumptionPerHouse - projectedConsumptionPerHouse) / projectedConsumptionPerHouse) * 100
      : null;
  const consumptionCostDeltaPerHouse =
    actualConsumptionPerHouse !== null &&
    projectedConsumptionPerHouse !== null &&
    detail?.average_price !== null &&
    detail?.average_price !== undefined
      ? (actualConsumptionPerHouse - projectedConsumptionPerHouse) * detail.average_price
      : null;
  const activeMovementRangeStart = selectedHouseType
    ? houseSummary?.start.date ?? houseComparisonInRange?.range_start ?? houseRange.startDate
    : stockSummary?.start.date ?? houseRange.startDate;
  const activeMovementRangeEnd = selectedHouseType
    ? houseSummary?.end.date ?? houseComparisonInRange?.range_end ?? houseRange.endDate
    : stockSummary?.end.date ?? houseRange.endDate;
  const filteredHouseMovementDetails = (history?.movement_details || []).filter((movement) =>
    isDateWithinRange(movement.date, activeMovementRangeStart, activeMovementRangeEnd),
  );

  function handleHouseRangeStartChange(value: string) {
    if (!value) {
      return;
    }
    let nextStart = moveToNextBusinessDay(toStartOfDay(value));
    let nextEnd = toStartOfDay(houseRange.endDate);
    if (nextStart.getTime() > latestHouseRangeDate.getTime()) {
      nextStart = latestHouseRangeDate;
    }
    if (nextStart.getTime() > nextEnd.getTime()) {
      nextEnd = new Date(nextStart);
    }
    onHouseRangeChange({
      startDate: toDateInputValue(nextStart),
      endDate: toDateInputValue(nextEnd),
    });
  }

  function handleHouseRangeEndChange(value: string) {
    if (!value) {
      return;
    }
    let nextStart = toStartOfDay(houseRange.startDate);
    let nextEnd = moveToPreviousBusinessDay(toStartOfDay(value));
    if (nextEnd.getTime() > latestHouseRangeDate.getTime()) {
      nextEnd = latestHouseRangeDate;
    }
    if (nextEnd.getTime() < nextStart.getTime()) {
      nextStart = new Date(nextEnd);
    }
    onHouseRangeChange({
      startDate: toDateInputValue(nextStart),
      endDate: toDateInputValue(nextEnd),
    });
  }

  return (
    <section className="flex-1 flex flex-col h-full bg-white dark:bg-zinc-950 overflow-hidden">
      <div className="p-6 md:p-8 border-b border-black/10 dark:border-white/10 bg-white/40 dark:bg-black/20 flex flex-col md:flex-row justify-between gap-6">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.35em] text-zinc-500 mb-2">Gráfico Fijado</p>
          <div className="flex min-w-0 items-start gap-3">
            <h2 className="min-w-0 flex-1 break-words text-3xl font-bold tracking-tight text-zinc-900 dark:text-white">{selected.material_name}</h2>
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
          <p className="text-sm font-medium text-zinc-500 mt-2 flex items-center gap-2">
            <span className="bg-zinc-200 dark:bg-zinc-800 px-2 py-0.5 rounded text-xs text-zinc-700 dark:text-zinc-300 font-mono">{selectedBadge}</span>
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
        <div className="flex gap-6 items-end">
          <div className="text-right">
            <HeaderStatLabel>{selectedHouseType ? "Cons./Vivienda" : "Stock Disponible"}</HeaderStatLabel>
            <div className="flex items-center justify-end gap-2">
              <div className="text-3xl font-light tracking-tight text-zinc-900 dark:text-white">
                {selectedHouseType
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
              </div>
              {selectedHouseType && projectComparisonInRange && consumptionDeltaPercent !== null ? (
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold ${
                    consumptionDeltaPercent > 0
                      ? "bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300"
                      : consumptionDeltaPercent < 0
                        ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
                        : "bg-zinc-100 text-zinc-600 dark:bg-white/10 dark:text-zinc-300"
                  }`}
                >
                  <span>{consumptionDeltaPercent > 0 ? "↑" : consumptionDeltaPercent < 0 ? "↓" : "→"}</span>
                  <span>{percentFormatter.format(Math.abs(consumptionDeltaPercent))}%</span>
                </span>
              ) : null}
            </div>
          </div>
          {selectedHouseType && projectComparisonInRange ? (
            <>
              <HeaderStatDivider />
              <div className="text-right">
                <HeaderStatLabel>Proy./Vivienda</HeaderStatLabel>
                <div className="text-3xl font-light tracking-tight text-zinc-900 dark:text-white">
                  {formatNumber(projectComparisonInRange.predicted_quantity_per_house, houseMetricDigits)}
                </div>
              </div>
            </>
          ) : null}
          {selectedHouseType && projectComparisonInRange && consumptionCostDeltaPerHouse !== null ? (
            <>
              <HeaderStatDivider />
              <div className="text-right">
                <HeaderStatLabel>
                  {consumptionCostDeltaPerHouse > 0 ? "Sobrecosto/Vivienda" : consumptionCostDeltaPerHouse < 0 ? "Ahorro/Vivienda" : "Costo/Vivienda"}
                </HeaderStatLabel>
                <div
                  className={`text-3xl font-light tracking-tight ${
                    consumptionCostDeltaPerHouse > 0
                      ? "text-red-700 dark:text-red-300"
                      : consumptionCostDeltaPerHouse < 0
                        ? "text-emerald-700 dark:text-emerald-300"
                        : "text-zinc-900 dark:text-white"
                  }`}
                >
                  {formatCurrency(Math.abs(consumptionCostDeltaPerHouse))}
                </div>
              </div>
            </>
          ) : null}
          <HeaderStatDivider />
          <div className="text-right">
            {groupSelection ? (
              <>
                <HeaderStatLabel>Unidad de Estudio</HeaderStatLabel>
                <div className="text-3xl font-light tracking-tight text-zinc-900 dark:text-white">{detail?.unit || selectedGroup?.study_unit}</div>
              </>
            ) : (
              <>
                <div className="mb-1 flex items-center justify-end gap-2">
                  <div
                    className="group/price relative inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.25em] text-zinc-500"
                    tabIndex={0}
                  >
                    <span>{priceDisplayMode === "last" ? "Último Precio" : "Precio Prom."}</span>
                    <i className="ph-bold ph-info text-[11px]" />
                    <div className="pointer-events-none absolute right-0 top-full z-30 mt-2 hidden w-80 rounded-lg border border-black/10 bg-white p-3 text-left text-[11px] font-medium normal-case leading-5 tracking-normal text-zinc-600 shadow-xl group-hover/price:block group-focus/price:block dark:border-white/10 dark:bg-zinc-950 dark:text-zinc-300">
                      Precio Prom. es el costo promedio ERP calculado a la fecha actual para el SKU completo. No promedia solo el rango visible, ni solo movimientos consumidos, ni CECOs del historial. Último precio usa la OC más reciente con precio unitario. La volatilidad compara el mayor y menor precio unitario dentro de las últimas 10 líneas de OC mostradas para este SKU.
                    </div>
                  </div>
                  <div className="inline-flex rounded-full border border-black/10 bg-zinc-50 p-0.5 dark:border-white/10 dark:bg-white/[0.04]">
                    {(["average", "last"] as PriceDisplayMode[]).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setPriceDisplayMode(mode)}
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold transition-colors ${
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
                  <div className="text-3xl font-light tracking-tight text-zinc-900 dark:text-white">
                    {detail ? formatCurrency(displayPrice) : detailLoading ? "..." : "—"}
                  </div>
                  {priceVolatility && isFiniteNumber(priceVolatility.deltaPercent) ? (
                    <span
                      className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-700 dark:bg-amber-500/10 dark:text-amber-300"
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

      <div className="grid grid-cols-1 lg:grid-cols-[1fr,320px] flex-1">
        <div className="p-6 md:p-8 flex flex-col border-b lg:border-b-0 lg:border-r border-black/10 dark:border-white/10">
          <div className="flex items-start justify-between mb-2 gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-3">
                <h3 className="text-sm font-semibold text-zinc-900 dark:text-white">
                  {selectedHouseType
                    ? isCustomSelection
                      ? "Período de Viviendas Seleccionado"
                      : houseChart
                        ? `Tendencia de Viviendas de ${houseChart.points.length} Días Hábiles`
                        : "Tendencia de Viviendas"
                    : isCustomSelection
                      ? "Período de Stock Seleccionado"
                      : stockRangeChart
                        ? `Tendencia de Stock de ${stockRangeChart.points.length} Días Hábiles`
                        : "Tendencia de Stock"}
                </h3>
                <select
                  value={selectedHouseTypeId === null ? "none" : String(selectedHouseTypeId)}
                  onChange={(event) => onSelectHouseType(event.target.value === "none" ? null : Number(event.target.value))}
                  className={SELECT_CLASSES}
                >
                  <option value="none">Ninguno</option>
                  {houseTypes.map((houseType) => (
                    <option key={houseType.id} value={houseType.id}>
                      {houseType.name}
                    </option>
                  ))}
                </select>
                <select
                  value={selectedProjectId ?? ""}
                  onChange={(event) => onSelectProject(event.target.value ? Number(event.target.value) : null)}
                  className={SELECT_CLASSES}
                >
                  <option value="">Sin proyecto</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
                <div className="inline-flex items-center gap-1 rounded-full border border-black/10 bg-black/[0.02] px-1.5 py-1 dark:border-white/10 dark:bg-white/[0.03]">
                  <input
                    type="date"
                    value={houseRange.startDate}
                    max={houseRange.endDate}
                    onChange={(event) => handleHouseRangeStartChange(event.target.value)}
                    aria-label="Fecha de inicio"
                    className={RANGE_DATE_INPUT_CLASSES}
                  />
                  <span className="text-[11px] text-zinc-400">-</span>
                  <input
                    type="date"
                    value={houseRange.endDate}
                    min={houseRange.startDate}
                    max={latestHouseRangeValue}
                    onChange={(event) => handleHouseRangeEndChange(event.target.value)}
                    aria-label="Fecha de término"
                    className={RANGE_DATE_INPUT_CLASSES}
                  />
                  <button
                    type="button"
                    onClick={() => onHouseRangeChange(getDefaultHouseRange())}
                    className="rounded-full px-2.5 py-0.5 text-[11px] font-medium text-zinc-500 transition-colors hover:bg-black/[0.05] hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-white/[0.06] dark:hover:text-zinc-200"
                  >
                    90d
                  </button>
                </div>
              </div>
              {selectedHouseType ? (
                <div className="mt-1 flex flex-wrap items-center gap-4 text-[11px] text-zinc-500">
                  <div className="flex items-center gap-2">
                    <span className="block h-0.5 w-6 rounded-full bg-amber-500" />
                    <span>Stock de material</span>
                  </div>
                  {projectComparisonInRange ? (
                    <div className="flex items-center gap-2">
                      <span className="block h-0.5 w-6 rounded-full bg-emerald-500" />
                      <span>{projectComparisonInRange.project_name}</span>
                    </div>
                  ) : null}
                  <div className="flex items-center gap-2">
                    <span className="block h-0.5 w-6 rounded-full bg-slate-700 dark:bg-slate-300" />
                    <span>Inicios de vivienda restantes</span>
                  </div>
                </div>
              ) : (
                <p className="mt-1.5 text-xs text-zinc-500 max-w-sm">
                  Haz clic y arrastra sobre la curva para revisar la variación de stock y el consumo promedio en días hábiles. Se omiten los fines de semana.
                </p>
              )}
              {isRefreshing ? <p className="mt-1 text-xs text-amber-600 dark:text-amber-500">Actualizando datos ERP en caché...</p> : null}
              {houseComparisonRefreshing && selectedHouseType ? (
                <p className="mt-1 text-xs text-amber-600 dark:text-amber-500">Actualizando comparación de inicios de vivienda...</p>
              ) : null}
              {houseComparisonError && selectedHouseType ? <p className="mt-1 text-xs text-red-600 dark:text-red-400">{houseComparisonError}</p> : null}
            </div>
            {isCustomSelection ? (
              <div className="shrink-0">
                <button
                  type="button"
                  onClick={clearSelection}
                  className="rounded-full border border-black/10 px-3 py-1 text-[11px] font-medium text-zinc-600 transition-colors hover:bg-black/[0.04] hover:text-zinc-900 dark:border-white/10 dark:text-zinc-300 dark:hover:bg-white/[0.06] dark:hover:text-white"
                >
                  Reset Selection
                </button>
              </div>
            ) : null}
          </div>

          <div className="flex-1 w-full relative min-h-[180px]">
            {!selectedHouseType ? (
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
              <div className="absolute inset-0 flex items-center justify-center text-sm text-zinc-500">No hay datos de inicios de vivienda para este rango y tipo de vivienda.</div>
            )}
          </div>

          <MovementBreakdownList
            movements={filteredHouseMovementDetails}
            loading={!history && !historyError}
            rangeStart={activeMovementRangeStart}
            rangeEnd={activeMovementRangeEnd}
            unitLabel={selectedUnitLabel}
          />
        </div>

        <ProcurementMetricsPanel
          movementQuantity={selected.movement_quantity_60d}
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
    </section>
  );
});
