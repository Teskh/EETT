import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../lib/api";
import type { MaterialDashboardDetailData, MaterialDashboardGroupDetailData, MaterialDashboardGroupMovementData, MaterialDashboardMovementData, MaterialDashboardMappedHouseComparisonData } from "../../lib/types";
import { detailCacheKey, groupDetailCacheKey, groupHistoryCacheKey, groupHouseComparisonCacheKey, historyCacheKey, houseComparisonCacheKey } from "../../lib/materialDashboardCacheKeys";
import { useDashboardResource } from "../materialDashboard/useDashboardResource";
import { HouseTrendChart, StockTrendChart } from "../materialDashboard/components/TrendCharts";
import { useChartSelection } from "../materialDashboard/useChartSelection";
import { buildHistoricalStockSeries, buildLinePath, getClampedSelectionBounds, getSeriesSummary } from "../materialDashboard/stockSeries";
import { buildHouseComparisonChart, buildProjectedStockByDay, getHouseComparisonForRange, getHouseSeriesSummary, getStockValueForDate } from "../materialDashboard/houseComparison";
import { isDateWithinRange, isWeekend, moveToPreviousBusinessDay, toDateInputValue, toStartOfDay } from "../materialDashboard/dates";
import { formatQuantity } from "./format";
import { formatCurrency, formatNumber, getAdaptiveDecimalPlaces, percentFormatter } from "../materialDashboard/formatters";
import { getConsumptionMetrics } from "./consumptionMetrics";
import { seriesToComparison, studyPerHouse, sumSeries } from "./studySeries";
import type { CostModelSeries } from "../../lib/types";

type Range = { startDate: string; endDate: string };
/** Consumed and expected in the selection, in the chart's unit. For a group, also each member's withdrawals in its own unit. */
export type TrendTotals = { consumed: number; expected: number; houses: number; mappedHouses: number; bySku: Record<string, number> | null };

export function ConsumptionTrend({ sku, name, unit, range, onDetails, onRangeChange, disabled, missingSubtypes = [], groupId = null, embedded = false, onTotals, projectId = null, studyKey = null, price = null }: {
  sku: string; name: string; unit: string; range: Range; onDetails?: () => void; onRangeChange: (range: Range) => void; disabled: boolean;
  /** Subtypes whose BOM leaves this material blank: the expected line leaves their houses out. */
  missingSubtypes?: string[];
  /** A material dashboard group instead of one material, in the group's study unit. */
  groupId?: number | null;
  /** Inside another dialog: drawn wide, without its own maximize. */
  embedded?: boolean;
  onTotals?: (totals: TrendTotals | null) => void;
  /** Draw the project's houses in the budget study's terms instead of the dashboard's. */
  projectId?: number | null;
  /** Cost center exclusion policy, so editing it refetches. */
  studyKey?: string | null;
  /** Price the budget uses, for overconsumption in pesos. */
  price?: number | null;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [maximized, setExpanded] = useState(false);
  const expanded = maximized && !embedded;
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!expanded) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    dialogRef.current?.showModal();
    return () => { previousFocus?.focus(); };
  }, [expanded]);
  const [mode, setMode] = useState<"houses" | "stock">("houses");
  useEffect(() => {
    if (embedded) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey || event.code !== "Space" || event.altKey || event.metaKey || event.shiftKey) return;
      event.preventDefault();
      setCollapsed(false);
      setExpanded((value) => !value);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [embedded]);
  const [revision, setRevision] = useState(0);
  // Same requests and cache keys as the material dashboard (all cost centers),
  // so both pages share the memory/IndexedDB cache and in-flight requests.
  // Past stock is reconstructed from today's stock, so movements run through
  // the latest business day even when the comparison period ends earlier.
  const today = toDateInputValue(moveToPreviousBusinessDay(new Date()));
  const historyRange = { startDate: range.startDate, endDate: today };
  const enabled = !collapsed;
  const detail = useDashboardResource<MaterialDashboardDetailData | MaterialDashboardGroupDetailData>({
    cacheKey: groupId === null ? detailCacheKey(sku, []) : groupDetailCacheKey(groupId, []), enabled, refreshNonce: revision,
    fetcher: (refresh) => groupId === null ? api.getMaterialDashboardDetail(sku, {}, { refresh }) : api.getMaterialStudyGroupDetail(groupId, {}, { refresh }),
    errorMessage: "No se pudo cargar el stock del material.",
  });
  const history = useDashboardResource<MaterialDashboardMovementData | MaterialDashboardGroupMovementData>({
    cacheKey: groupId === null ? historyCacheKey(sku, [], historyRange) : groupHistoryCacheKey(groupId, [], historyRange), enabled, refreshNonce: revision,
    fetcher: (refresh) => groupId === null ? api.getMaterialDashboardHistory(sku, {}, { ...historyRange, refresh }) : api.getMaterialStudyGroupHistory(groupId, {}, { ...historyRange, refresh }),
    errorMessage: "No se pudieron cargar los movimientos.",
  });
  // In the budget, the chart follows the study: only the project's houses, the
  // excluded cost centers left out, other projects' BOM discounted.
  const projectMode = projectId !== null && groupId === null;
  const series = useDashboardResource<CostModelSeries>({
    cacheKey: `cost-model-series::${projectId}::${sku}::${range.startDate}::${range.endDate}::${studyKey}`, enabled: enabled && projectMode && studyKey !== null, refreshNonce: revision,
    fetcher: () => api.getCostModelSeries(projectId as number, sku, range),
    errorMessage: "No se pudo cargar el consumo del proyecto.",
  });
  const houses = useDashboardResource<MaterialDashboardMappedHouseComparisonData>({
    cacheKey: groupId === null ? houseComparisonCacheKey(sku, [], range) : groupHouseComparisonCacheKey(groupId, [], range), enabled: enabled && !projectMode, refreshNonce: revision,
    fetcher: (refresh) => groupId === null ? api.getMaterialDashboardHouseComparison(sku, {}, { ...range, refresh }) : api.getMaterialStudyGroupHouseComparison(groupId, {}, { ...range, refresh }),
    errorMessage: "No se pudo cargar la producción.",
  });
  const error = detail.error || history.error || (projectMode ? series.error : houses.error);
  const comparisonData = useMemo(() => projectMode ? series.data ? seriesToComparison(series.data) : null : houses.data, [projectMode, series.data, houses.data]);
  const data = useMemo(() => detail.data && history.data && comparisonData
    ? { detail: detail.data, history: history.data, comparison: comparisonData } : null, [detail.data, history.data, comparisonData]);
  const key = `${groupId ?? sku}:${range.startDate}:${range.endDate}`;
  // Beside the table the chart fills the height the header row leaves it, drawn at its pixel size.
  const [box, boxRef] = useElementSize();
  const height = expanded ? 360 : embedded ? 260 : Math.min(400, Math.max(140, box?.height ?? 140));
  const width = expanded ? 1100 : Math.max(320, box?.width ?? 520);
  const comparison = useMemo(() => getHouseComparisonForRange(data?.comparison ?? null, range), [data, range.startDate, range.endDate]);
  const stock = useMemo(() => data ? buildHistoricalStockSeries(data.history.movements, data.detail.stock_on_hand, { startDate: range.startDate, endDate: today }) : [], [data, range.startDate, today]);
  const stockChart = useMemo(() => buildLinePath(stock.filter(point => isDateWithinRange(point.date, range.startDate, range.endDate)), width, height, { fitValues: true }), [stock, range.startDate, range.endDate, height, width]);
  const houseChart = useMemo(() => comparison ? buildHouseComparisonChart(
    { ...comparison, points: comparison.points.filter(point => !isWeekend(toStartOfDay(point.date))) }, stock, width, height,
    getStockValueForDate(stock, range.endDate), data?.detail.stock_on_hand ?? null, buildProjectedStockByDay(comparison, stock),
    { fitStockValues: true },
  ) : null, [comparison, stock, height, width, data, range.endDate]);
  const chart = mode === "houses" ? houseChart : stockChart;
  const { activeSelection, hoveredPointIndex, pointerHandlers, clearSelection, reset } = useChartSelection(chart);
  useEffect(() => { reset(); }, [key, mode, collapsed]);
  const bounds = activeSelection && chart ? getClampedSelectionBounds(activeSelection, chart.points.length) : null;
  const edges = bounds && chart ? { start: chart.points[bounds.startIndex], end: chart.points[bounds.endIndex] } : null;
  const houseSummary = houseChart ? getHouseSeriesSummary(houseChart.points, activeSelection) : null;
  const stockSummary = stockChart ? getSeriesSummary(stockChart.points, activeSelection) : null;
  const selectedPeriod = edges ? { startDate: toDateInputValue(edges.start.date), endDate: toDateInputValue(edges.end.date) } : range;
  const hasSelection = edges !== null;
  const consumed = houseSummary?.materialConsumed ?? null, expectedTotal = houseSummary?.projectedMaterialConsumed ?? null;
  const details = groupId !== null && data && "group_id" in data.history ? data.history.movement_details : null;
  const bySku = useMemo(() => {
    if (!details) return null;
    const totals: Record<string, number> = {};
    for (const detail of details) {
      const day = String(detail.date).slice(0, 10);
      if (day < selectedPeriod.startDate || day > selectedPeriod.endDate) continue;
      const sku = detail.sku.trim().toUpperCase();
      totals[sku] = (totals[sku] ?? 0) + detail.source_quantity;
    }
    return totals;
  }, [details, selectedPeriod.startDate, selectedPeriod.endDate]);
  useEffect(() => {
    onTotals?.(consumed !== null && expectedTotal !== null && houseSummary
      ? { consumed, expected: expectedTotal, houses: houseSummary.housesProduced, mappedHouses: houseSummary.mappedHousesProduced, bySku } : null);
  }, [consumed, expectedTotal, houseSummary?.housesProduced, houseSummary?.mappedHousesProduced, bySku]);
  // The study's accounting over the selection: per equivalent house of the
  // project, the BOM of its mix and BOM × real / expected (the table's Histórica).
  const study = useMemo(() => {
    if (!projectMode || !houseChart) return null;
    const selected = bounds ? houseChart.points.slice(bounds.startIndex, bounds.endIndex + 1) : houseChart.points;
    const totals = sumSeries(selected as unknown as Partial<CostModelSeries["points"][number]>[]);
    return { totals, ...studyPerHouse(totals) };
  }, [projectMode, houseChart, bounds?.startIndex, bounds?.endIndex]);
  const metrics = study ? getConsumptionMetrics({
    materialConsumed: study.ratio === null ? 0 : study.ratio * study.totals.target, projectedMaterialConsumed: study.totals.target,
    housesProduced: study.totals.equivalentHouses, mappedHousesProduced: study.totals.equivalentHouses,
    hasExpected: study.ratio !== null, averagePrice: price ?? data?.detail.average_price,
  }) : houseSummary ? getConsumptionMetrics({
    materialConsumed: houseSummary.materialConsumed, projectedMaterialConsumed: houseSummary.projectedMaterialConsumed,
    housesProduced: houseSummary.housesProduced, mappedHousesProduced: houseSummary.mappedHousesProduced,
    hasExpected: (comparison?.link_count ?? 0) > 0, averagePrice: data?.detail.average_price,
  }) : null;
  const digits = getAdaptiveDecimalPlaces(metrics?.consumedPerHouse, metrics?.expectedPerHouse);
  const over = metrics?.overconsumptionPerHouse ?? null;
  const stockDays = data?.detail.days_of_stock_30d ?? null;
  useEffect(() => {
    if (!hasSelection) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.key !== "Escape" || event.defaultPrevented || target?.closest("input, textarea, select")) return;
      // Inside the expanded dialog, the first Escape clears the selection instead of closing.
      event.preventDefault();
      clearSelection();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [hasSelection, clearSelection]);
  const button = "px-2 py-1 text-[10px] border border-black/15 dark:border-white/15 hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-red-500";
  const content = <section className={`flex min-w-0 flex-col ${embedded ? "" : "border-l border-black/10 bg-zinc-50/50 px-4 py-3 dark:border-white/10 dark:bg-zinc-950"}`} aria-label={`Estudio de consumo de ${name}`}>
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" aria-expanded={!collapsed} onClick={() => setCollapsed(!collapsed)} className="min-w-0 truncate text-left text-xs font-semibold" title={name}>{collapsed ? "▸" : "▾"} {name}</button>
      <span className="text-[10px] text-zinc-500">{groupId === null ? sku : `Grupo en ${unit}`} · Fábrica</span>
      <div className="flex w-full flex-wrap gap-1">
        {!collapsed ? <>
          <div role="group" aria-label="Vista del gráfico" className="flex">
            <button type="button" className={button} aria-pressed={mode === "houses"} onClick={() => setMode("houses")}>Stock + viviendas {mode === "houses" ? "✓" : ""}</button>
            <button type="button" className={button} aria-pressed={mode === "stock"} onClick={() => setMode("stock")}>Solo stock {mode === "stock" ? "✓" : ""}</button>
          </div>
          {embedded ? null : <button type="button" className={button} aria-expanded={expanded} aria-keyshortcuts="Control+Space" title="Ctrl + Espacio" onClick={() => setExpanded(!expanded)}>{expanded ? "Reducir" : "Ampliar"}</button>}
        </> : null}
        {onDetails ? <button type="button" className={button} onClick={onDetails}>Ver detalle</button> : null}
      </div>
    </div>
    {!collapsed ? <>
      {missingSubtypes.length ? <p role="note" className="mt-2 border-l-2 border-amber-500 bg-amber-50 px-2 py-1 text-[10px] text-amber-900 dark:bg-amber-500/10 dark:text-amber-300">
        BOM incompleta: {missingSubtypes.join(", ")} sin cantidad. El esperado no cuenta esas viviendas, así que el sobreconsumo aparece inflado.</p> : null}
      <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-[10px]">
        <span className="text-amber-600">━ Stock</span>
        {mode === "houses" ? <><span className="text-emerald-600">━ Esperado</span><span className="text-slate-500">━ Viviendas</span></> : null}
      </div>
      {error ? <p role="alert" className="py-4 text-xs text-red-700 dark:text-red-400">{error} <button className="underline" onClick={() => setRevision(revision + 1)}>Reintentar</button></p>
        : <div ref={boxRef} style={expanded || embedded ? { height } : undefined} className={`relative mt-1 ${expanded || embedded ? "" : "min-h-[140px] flex-1"}`}><div className="absolute inset-0">
          {!data ? <p className="flex h-full items-center text-xs text-zinc-500" role="status">Cargando stock y producción…</p>
          : <>
          {mode === "houses" && houseChart ? <HouseTrendChart chart={houseChart} selectionBounds={bounds} selectionEdges={edges} hoveredPoint={hoveredPointIndex === null ? null : houseChart.points[hoveredPointIndex] ?? null} pointerHandlers={pointerHandlers} />
            : mode === "stock" && stockChart ? <StockTrendChart chart={stockChart} selectionBounds={bounds} selectionEdges={edges} hoveredPoint={hoveredPointIndex === null ? null : stockChart.points[hoveredPointIndex] ?? null} pointerHandlers={pointerHandlers} />
            : <p className="py-8 text-xs text-zinc-500">No hay datos suficientes para este período.</p>}
          </>}
        </div></div>}
      {!error ? <div className="mt-1 border-t border-black/5 pt-2 text-xs dark:border-white/10">
        {/* Same definitions as the material dashboard; they follow the chart selection. */}
        <div className="grid grid-cols-4 gap-x-3" aria-label="Métricas del período">
          <Metric label="Cons./viv." title={study ? "Real ÷ esperado × BOM: la Histórica de la tabla, para la selección." : "Consumo real del período dividido por todas las viviendas iniciadas"}
            value={metrics ? `${formatNumber(metrics.consumedPerHouse, digits)} ${unit}` : "—"}
            detail={metrics?.deltaPercent != null ? `${metrics.deltaPercent > 0 ? "↑" : metrics.deltaPercent < 0 ? "↓" : "→"} ${percentFormatter.format(Math.abs(metrics.deltaPercent))}% vs est.` : "Sin estimado"}
            tone={metrics?.deltaPercent != null && metrics.deltaPercent > 0 && !missingSubtypes.length ? "bad" : undefined} />
          <Metric label="Est./viv." title={study ? "BOM por vivienda del proyecto, según la mezcla de subtipologías del período." : "Consumo estimado según el presupuesto de las viviendas vinculadas, por vivienda vinculada"}
            value={metrics?.expectedPerHouse != null ? `${formatNumber(metrics.expectedPerHouse, digits)} ${unit}` : "—"}
            detail={study ? `BOM · ${formatNumber(study.totals.starts, 0)} viv. del proyecto` : houseSummary ? `${formatNumber(houseSummary.mappedHousesProduced, 0)} viv. vinculadas` : "—"} />
          <Metric label={over !== null && over < 0 ? "Ahorro/viv." : "Sobrecons./viv."}
            title="(Consumo real − estimado) del período, dividido por todas las viviendas iniciadas. En pesos, al precio promedio ERP."
            value={over !== null ? `${formatNumber(Math.abs(over), digits)} ${unit}` : "—"}
            detail={metrics?.overcostPerHouse != null ? `${formatCurrency(Math.abs(metrics.overcostPerHouse))}/viv.` : "Sin precio"}
            tone={over !== null && over > 0 && !missingSubtypes.length ? "bad" : undefined} />
          <Metric label="Stock" title="Stock disponible hoy y su cobertura al ritmo de salida de los últimos 30 días"
            value={data ? `${formatNumber(data.detail.stock_on_hand, 0)} ${unit}` : "—"}
            detail={stockDays != null ? `≈ ${formatNumber(stockDays, 0)} días háb.` : data?.detail.average_price ? `Prom. ${formatCurrency(data.detail.average_price)}` : "—"} />
        </div>
        <p className="mt-1.5 truncate text-[10px] text-zinc-500">
          {mode === "houses" && study
            ? <>Real {formatQuantity(study.totals.actual)} {unit} · Esperado {formatQuantity(study.totals.target)} {unit}{study.totals.other > 0 ? ` + ${formatQuantity(study.totals.other)} de otros proyectos` : ""} · ×{study.ratio === null ? "—" : formatNumber(study.ratio, 3)} · Sin centros excluidos{series.data?.other_houses ? `, descontando ${series.data.other_houses} viv. de otros proyectos` : ""}</>
            : mode === "houses"
            ? <>Consumo {formatQuantity(houseSummary?.materialConsumed)} {unit} · Esperado {formatQuantity(houseSummary?.projectedMaterialConsumed)} {unit} · {formatQuantity(houseSummary?.housesProduced)} viviendas{metrics?.unmappedHouses ? ` (${metrics.unmappedHouses} sin vincular)` : ""}{data?.detail.average_price ? ` · Precio prom. ${formatCurrency(data.detail.average_price)}` : ""}</>
            : <>Consumo {formatQuantity(stockSummary?.consumed)} {unit} · Promedio/semana {formatQuantity(stockSummary?.averageConsumptionPerWeek)} {unit}</>}
        </p>
        {/* Always rendered so selecting a period never shifts the layout. */}
        <div className="mt-1 flex items-center gap-1">
          <span className={`mr-auto min-w-0 truncate text-[10px] ${hasSelection ? "font-medium text-zinc-700 dark:text-zinc-300" : "text-zinc-500"}`}>
            {hasSelection ? `Selección: ${selectedPeriod.startDate} a ${selectedPeriod.endDate} · Esc para limpiar` : "Arrastra sobre el gráfico para seleccionar un período"}
          </span>
          <button type="button" className={button} disabled={!hasSelection} onClick={clearSelection}>Limpiar selección</button>
          <button type="button" disabled={disabled || !hasSelection} className={button} onClick={() => onRangeChange(selectedPeriod)}>Consultar este período</button>
        </div>
      </div> : null}
      {expanded ? <p className="mt-2 text-[10px] text-zinc-500">Datos compartidos de fábrica. La referencia de la subtipología se calcula al consultar el período; seleccionar el gráfico no cambia cantidades guardadas.</p> : null}
      {expanded && data && chart ? <details className="mt-1 text-[10px] text-zinc-500"><summary className="cursor-pointer">Ver datos del gráfico</summary><div className="max-h-32 overflow-auto"><table className="w-full text-right"><thead><tr><th className="text-left">Fecha</th><th>Stock</th>{mode === "houses" ? <><th>Esperado</th><th>Inicios</th><th>Consumo</th></> : null}</tr></thead><tbody>{mode === "houses" ? houseChart?.points.map(point => <tr key={point.date}><td className="text-left">{toDateInputValue(point.date)}</td><td>{formatQuantity(point.stockValue)}</td><td>{formatQuantity(point.projectedStockValue)}</td><td>{point.house_starts}</td><td>{formatQuantity(point.material_quantity)}</td></tr>) : stockChart?.points.map(point => <tr key={point.date}><td className="text-left">{toDateInputValue(point.date)}</td><td>{formatQuantity(point.value)}</td></tr>)}</tbody></table></div></details> : null}
    </> : null}
  </section>;
  return expanded ? createPortal(
    <dialog ref={dialogRef} aria-label={`Estudio de consumo de ${name}`} onClose={() => setExpanded(false)}
      className="m-auto max-h-[90vh] w-[min(1100px,94vw)] max-w-none overflow-auto border border-black/15 bg-white p-0 text-zinc-800 shadow-xl backdrop:bg-black/40 dark:bg-zinc-950 dark:text-zinc-200">
      {content}
    </dialog>, document.body,
  ) : content;
}

function Metric({ label, value, detail, title, tone }: { label: string; value: string; detail: string; title: string; tone?: "bad" }) {
  return <div className="min-w-0" title={title}>
    <p className="truncate text-[10px] text-zinc-500">{label}</p>
    <p className={`truncate font-mono text-sm font-semibold tabular-nums ${tone === "bad" ? "text-red-700 dark:text-red-400" : "text-zinc-950 dark:text-white"}`}>{value}</p>
    <p className={`truncate text-[10px] ${tone === "bad" ? "text-red-700 dark:text-red-400" : "text-zinc-500"}`}>{detail}</p>
  </div>;
}

function useElementSize() {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const observer = useRef<ResizeObserver | null>(null);
  const ref = useCallback((element: HTMLElement | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!element) return;
    observer.current = new ResizeObserver(([entry]) => {
      const width = Math.round(entry.contentRect.width), height = Math.round(entry.contentRect.height);
      if (width && height) setSize((current) => current?.width === width && current.height === height ? current : { width, height });
    });
    observer.current.observe(element);
  }, []);
  return [size, ref] as const;
}
