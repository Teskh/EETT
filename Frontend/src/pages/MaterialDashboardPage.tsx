import { startTransition, useDeferredValue, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import { ApiError, api } from "../lib/api";
import { getMaterialDashboardCacheValue, setMaterialDashboardCacheValue } from "../lib/materialDashboardCache";
import type {
  MaterialDashboardCeco,
  MaterialDashboardData,
  MaterialDashboardDetailData,
  MaterialDashboardListRow,
  MaterialDashboardMovementData,
  MaterialDashboardMovementPoint,
} from "../lib/types";

type SortKey = "material_name" | "sku" | "last_movement_date" | "movement_quantity_60d" | "movement_count_60d";

type SortState = {
  key: SortKey;
  direction: 1 | -1;
};

const numberFormatter = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 1 });
const integerFormatter = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 0 });
const currencyFormatter = new Intl.NumberFormat("es-CL", {
  style: "currency",
  currency: "CLP",
  maximumFractionDigits: 0,
});

function formatNumber(value: number | null | undefined, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "—";
  }
  return digits === 0 ? integerFormatter.format(value) : numberFormatter.format(value);
}

function formatCurrency(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "—";
  }
  return currencyFormatter.format(value);
}

function formatSignedNumber(value: number | null | undefined, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "—";
  }
  const absolute = digits === 0 ? integerFormatter.format(Math.abs(value)) : numberFormatter.format(Math.abs(value));
  if (value === 0) {
    return absolute;
  }
  return `${value > 0 ? "+" : "-"}${absolute}`;
}

function formatDate(value: string | null | undefined) {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleDateString("es-CL", { year: "numeric", month: "short", day: "numeric" });
}

const CECO_CACHE_KEY = "material-dashboard::cecos";

function normalizeCecos(cecos: string[]) {
  return Array.from(new Set(cecos.map((ceco) => ceco.trim()).filter(Boolean))).sort((left, right) => left.localeCompare(right));
}

function dashboardCacheKey(cecos: string[]) {
  const normalized = normalizeCecos(cecos);
  return `dashboard::${normalized.join("|") || "all"}`;
}

function detailCacheKey(sku: string, cecos: string[]) {
  return `detail::${sku}::${normalizeCecos(cecos).join("|") || "all"}`;
}

function historyCacheKey(sku: string, cecos: string[]) {
  return `history::${sku}::${normalizeCecos(cecos).join("|") || "all"}`;
}

function compareRows(left: MaterialDashboardListRow, right: MaterialDashboardListRow, sort: SortState) {
  const leftValue = left[sort.key];
  const rightValue = right[sort.key];

  if (typeof leftValue === "string" || typeof rightValue === "string") {
    return String(leftValue || "").localeCompare(String(rightValue || "")) * sort.direction;
  }

  const leftNumber = typeof leftValue === "number" ? leftValue : leftValue ? Date.parse(String(leftValue)) : Number.NEGATIVE_INFINITY;
  const rightNumber = typeof rightValue === "number" ? rightValue : rightValue ? Date.parse(String(rightValue)) : Number.NEGATIVE_INFINITY;
  if (leftNumber === rightNumber) {
    return left.material_name.localeCompare(right.material_name) * sort.direction;
  }
  return (leftNumber - rightNumber) * sort.direction;
}

const CHART_PADDING = { top: 18, right: 18, bottom: 26, left: 40 };
const CHART_WIDTH = 760;
const CHART_HEIGHT = 240;
const DAY_IN_MS = 24 * 60 * 60 * 1000;

type StockSeriesPoint = {
  date: string;
  value: number;
  time: number;
};

type ChartPoint = StockSeriesPoint & {
  index: number;
  x: number;
  y: number;
};

type ChartSelection = {
  startIndex: number;
  endIndex: number;
};

function buildLinePath(
  points: StockSeriesPoint[],
  width: number,
  height: number,
) {
  if (!points.length) {
    return null;
  }
  const padding = CHART_PADDING;
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const maxValue = Math.max(...points.map((point) => point.value), 1);
  const minDate = points[0].time;
  const maxDate = points[points.length - 1].time;
  const span = Math.max(maxDate - minDate, 1);

  const chartPoints = points
    .map((point, index) => {
      const x =
        points.length === 1
          ? padding.left + plotWidth / 2
          : padding.left + ((point.time - minDate) / span) * plotWidth;
      const y = padding.top + plotHeight - (point.value / maxValue) * plotHeight;
      return { ...point, index, x, y };
    });

  const path = chartPoints
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(" ");

  return { path, points: chartPoints, maxValue, padding, plotHeight, plotWidth, width, height };
}

function getSelectionBounds(selection: ChartSelection) {
  return {
    startIndex: Math.min(selection.startIndex, selection.endIndex),
    endIndex: Math.max(selection.startIndex, selection.endIndex),
  };
}

function getSeriesSummary(points: ChartPoint[], selection?: ChartSelection | null) {
  if (!points.length) {
    return null;
  }
  const bounds = selection ? getSelectionBounds(selection) : { startIndex: 0, endIndex: points.length - 1 };
  const start = points[bounds.startIndex];
  const end = points[bounds.endIndex];
  const elapsedDays = Math.max((end.time - start.time) / DAY_IN_MS, 1);
  const stockDelta = end.value - start.value;
  const consumed = start.value - end.value;
  return {
    start,
    end,
    elapsedDays,
    stockDelta,
    consumed,
    averageConsumptionPerDay: consumed / elapsedDays,
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function getClosestPointIndex(points: ChartPoint[], x: number) {
  let closestIndex = 0;
  let closestDistance = Number.POSITIVE_INFINITY;

  for (const point of points) {
    const distance = Math.abs(point.x - x);
    if (distance < closestDistance) {
      closestDistance = distance;
      closestIndex = point.index;
    }
  }

  return closestIndex;
}

function buildHistoricalStockSeries(
  movements: MaterialDashboardMovementPoint[],
  currentStock: number | null | undefined,
): StockSeriesPoint[] {
  if (currentStock === null || currentStock === undefined || Number.isNaN(currentStock)) {
    return [];
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dailyMovementMap = new Map<number, { date: string; quantity: number; time: number }>();
  for (const point of movements) {
    const date = new Date(point.date);
    date.setHours(0, 0, 0, 0);
    const time = date.getTime();
    const existing = dailyMovementMap.get(time);
    if (existing) {
      existing.quantity += Number(point.quantity) || 0;
    } else {
      dailyMovementMap.set(time, {
        date: date.toISOString(),
        quantity: Number(point.quantity) || 0,
        time,
      });
    }
  }

  const normalizedMovements = Array.from(dailyMovementMap.values()).sort((left, right) => left.time - right.time);

  const history: StockSeriesPoint[] = [];
  let runningStock = Number(currentStock);
  for (let index = normalizedMovements.length - 1; index >= 0; index -= 1) {
    const point = normalizedMovements[index];
    if (point.time !== today.getTime()) {
      runningStock += point.quantity;
    }
    history.unshift({
      date: point.date,
      time: point.time,
      value: runningStock,
    });
  }

  if (!history.length || new Date(history[history.length - 1].date).getTime() !== today.getTime()) {
    history.push({
      date: today.toISOString(),
      time: today.getTime(),
      value: Number(currentStock),
    });
  }

  return history;
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-black/10 dark:border-white/10 bg-zinc-50 dark:bg-white/5 px-4 py-3">
      <div className="text-[10px] font-bold uppercase tracking-[0.25em] text-zinc-500">{label}</div>
      <div className="mt-1 text-sm font-semibold text-zinc-900 dark:text-white">{value}</div>
    </div>
  );
}

function SelectionMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-[132px] rounded-2xl border border-black/10 dark:border-white/10 bg-zinc-50/90 dark:bg-white/5 px-4 py-3">
      <div className="text-[10px] font-bold uppercase tracking-[0.25em] text-zinc-500">{label}</div>
      <div className="mt-1 text-sm font-semibold text-zinc-900 dark:text-white">{value}</div>
    </div>
  );
}

function MetricRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-1 border-b border-black/5 dark:border-white/5 last:border-0">
      <div className="text-xs font-medium text-zinc-500">{label}</div>
      <div className="text-sm font-semibold text-zinc-900 dark:text-white">{value}</div>
    </div>
  );
}

function MovementHistoryCard({
  selected,
  detail,
  history,
  detailLoading,
  historyLoading,
  detailRefreshing,
  historyRefreshing,
}: {
  selected: MaterialDashboardListRow | null;
  detail: MaterialDashboardDetailData | null;
  history: MaterialDashboardMovementData | null;
  detailLoading: boolean;
  historyLoading: boolean;
  detailRefreshing: boolean;
  historyRefreshing: boolean;
}) {
  const [selection, setSelection] = useState<ChartSelection | null>(null);
  const [dragAnchorIndex, setDragAnchorIndex] = useState<number | null>(null);
  const [dragCurrentIndex, setDragCurrentIndex] = useState<number | null>(null);

  useEffect(() => {
    setSelection(null);
    setDragAnchorIndex(null);
    setDragCurrentIndex(null);
  }, [selected?.sku, history?.generated_at, detail?.stock_on_hand]);

  if (!selected) {
    return (
      <section className="liquid-glass rounded-[28px] border border-black/10 dark:border-white/10 p-8 min-h-[320px] flex items-center justify-center">
        <div className="text-center max-w-xl">
          <p className="text-[10px] font-bold uppercase tracking-[0.35em] text-zinc-500 mb-3">Pinned Graph</p>
          <h2 className="text-2xl font-bold text-zinc-900 dark:text-white mb-2">Select a material</h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Click any row below to pin its 90-day movement history and load the procurement metrics.
          </p>
        </div>
      </section>
    );
  }

  const stockSeries = detail ? buildHistoricalStockSeries(history?.movements || [], detail.stock_on_hand) : [];
  const chart = stockSeries.length ? buildLinePath(stockSeries, CHART_WIDTH, CHART_HEIGHT) : null;
  const activeSelection =
    dragAnchorIndex !== null && dragCurrentIndex !== null ? { startIndex: dragAnchorIndex, endIndex: dragCurrentIndex } : selection;
  const summary = chart ? getSeriesSummary(chart.points, activeSelection) : null;
  const selectionBounds = activeSelection ? getSelectionBounds(activeSelection) : null;
  const selectionStart = selectionBounds && chart ? chart.points[selectionBounds.startIndex] : null;
  const selectionEnd = selectionBounds && chart ? chart.points[selectionBounds.endIndex] : null;
  const isCustomSelection = Boolean(activeSelection && selectionBounds && selectionBounds.startIndex !== selectionBounds.endIndex);
  const isBlockingLoad = (!detail && detailLoading) || (!history && historyLoading);
  const isRefreshing = detailRefreshing || historyRefreshing;

  function getPointIndexFromEvent(event: ReactPointerEvent<SVGSVGElement>) {
    if (!chart) {
      return null;
    }
    const svg = event.currentTarget;
    const pt = svg.createSVGPoint();
    pt.x = event.clientX;
    pt.y = event.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) {
      return null;
    }
    const cursorPt = pt.matrixTransform(ctm.inverse());
    const chartX = clamp(cursorPt.x, chart.padding.left, chart.padding.left + chart.plotWidth);
    return getClosestPointIndex(chart.points, chartX);
  }

  function handlePointerDown(event: ReactPointerEvent<SVGSVGElement>) {
    const pointIndex = getPointIndexFromEvent(event);
    if (pointIndex === null) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragAnchorIndex(pointIndex);
    setDragCurrentIndex(pointIndex);
  }

  function handlePointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    if (dragAnchorIndex === null) {
      return;
    }
    const pointIndex = getPointIndexFromEvent(event);
    if (pointIndex === null) {
      return;
    }
    setDragCurrentIndex(pointIndex);
  }

  function handlePointerUp(event: ReactPointerEvent<SVGSVGElement>) {
    if (dragAnchorIndex === null) {
      return;
    }
    const pointIndex = getPointIndexFromEvent(event);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (pointIndex !== null && pointIndex !== dragAnchorIndex) {
      setSelection({ startIndex: dragAnchorIndex, endIndex: pointIndex });
    }
    setDragAnchorIndex(null);
    setDragCurrentIndex(null);
  }

  function handlePointerCancel(event: ReactPointerEvent<SVGSVGElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDragAnchorIndex(null);
    setDragCurrentIndex(null);
  }

  return (
    <section className="liquid-glass rounded-[28px] border border-black/10 dark:border-white/10 overflow-hidden flex flex-col">
      <div className="p-6 md:p-8 border-b border-black/10 dark:border-white/10 bg-white/40 dark:bg-black/20 flex flex-col md:flex-row justify-between gap-6">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.35em] text-zinc-500 mb-2">Pinned Graph</p>
          <h2 className="text-3xl font-bold text-zinc-900 dark:text-white tracking-tight">{selected.material_name}</h2>
          <p className="text-sm font-medium text-zinc-500 mt-2 flex items-center gap-2">
            <span className="bg-zinc-200 dark:bg-zinc-800 px-2 py-0.5 rounded text-xs text-zinc-700 dark:text-zinc-300 font-mono">{selected.sku}</span>
            {selected.unit ? <span>&bull; {selected.unit}</span> : null}
          </p>
        </div>
        <div className="flex gap-6 items-end">
          <div className="text-right">
            <div className="text-[10px] font-bold uppercase tracking-[0.25em] text-zinc-500 mb-1">Stock on Hand</div>
            <div className="text-3xl font-light tracking-tight text-zinc-900 dark:text-white">{detail ? formatNumber(detail.stock_on_hand) : detailLoading ? "..." : "—"}</div>
          </div>
          <div className="w-px h-10 bg-black/10 dark:bg-white/10 hidden md:block" />
          <div className="text-right">
            <div className="text-[10px] font-bold uppercase tracking-[0.25em] text-zinc-500 mb-1">Avg Price</div>
            <div className="text-3xl font-light tracking-tight text-zinc-900 dark:text-white">{detail ? formatCurrency(detail.average_price) : detailLoading ? "..." : "—"}</div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr,320px] flex-1">
        <div className="p-6 md:p-8 flex flex-col border-b lg:border-b-0 lg:border-r border-black/10 dark:border-white/10">
          <div className="flex items-start justify-between mb-6 gap-4">
            <div>
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-white">
                {isCustomSelection ? "Selected Period" : history ? `${history.movement_days}-Day Trend` : "Trend"}
              </h3>
              <div className="text-xs text-zinc-500 mt-1">
                {summary ? `${formatDate(summary.start.date)} - ${formatDate(summary.end.date)}` : "—"}
              </div>
              <p className="mt-1.5 text-xs text-zinc-500 max-w-sm">
                Click and drag across the curve to inspect the stock variation and average consumption per day.
              </p>
              {isRefreshing ? <p className="mt-1 text-xs text-amber-600 dark:text-amber-500">Refreshing cached ERP data...</p> : null}
            </div>
            {isCustomSelection ? (
              <button
                type="button"
                onClick={() => setSelection(null)}
                className="text-xs font-semibold px-3 py-1.5 rounded-full bg-zinc-100 dark:bg-white/10 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-white/20 transition-colors"
              >
                Reset Selection
              </button>
            ) : null}
          </div>

          <div className="flex-1 w-full relative min-h-[240px]">
            {isBlockingLoad ? (
              <div className="absolute inset-0 flex items-center justify-center text-sm text-zinc-500">Loading movement history...</div>
            ) : history && chart ? (
              <svg
                viewBox={`0 0 ${chart.width} ${chart.height}`}
                className="w-full h-[240px] overflow-visible cursor-crosshair touch-none"
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerCancel}
              >
                <defs>
                  {selectionStart && selectionEnd ? (
                    <clipPath id="selection-clip">
                      <rect
                        x={Math.min(selectionStart.x, selectionEnd.x)}
                        y={0}
                        width={Math.max(Math.abs(selectionEnd.x - selectionStart.x), 0.001)}
                        height={chart.height}
                      />
                    </clipPath>
                  ) : null}
                </defs>
                {[0, 0.25, 0.5, 0.75, 1].map((stop) => {
                  const y = chart.padding.top + chart.plotHeight - stop * chart.plotHeight;
                  return (
                    <g key={stop}>
                      <line
                        x1={chart.padding.left}
                        y1={y}
                        x2={chart.width - chart.padding.right}
                        y2={y}
                        stroke="rgba(113,113,122,0.18)"
                        strokeDasharray="4 6"
                      />
                      <text x={chart.padding.left - 10} y={y + 4} textAnchor="end" fontSize="11" fill="currentColor" opacity="0.55">
                        {formatNumber(chart.maxValue * stop)}
                      </text>
                    </g>
                  );
                })}
                {selectionStart && selectionEnd ? (
                  <g>
                    <rect
                      x={Math.min(selectionStart.x, selectionEnd.x)}
                      y={chart.padding.top}
                      width={Math.max(Math.abs(selectionEnd.x - selectionStart.x), 2)}
                      height={chart.plotHeight}
                      fill="rgba(245, 158, 11, 0.12)"
                    />
                    <line
                      x1={selectionStart.x}
                      y1={chart.padding.top}
                      x2={selectionStart.x}
                      y2={chart.padding.top + chart.plotHeight}
                      stroke="rgba(245, 158, 11, 0.55)"
                      strokeDasharray="4 4"
                    />
                    <line
                      x1={selectionEnd.x}
                      y1={chart.padding.top}
                      x2={selectionEnd.x}
                      y2={chart.padding.top + chart.plotHeight}
                      stroke="rgba(245, 158, 11, 0.55)"
                      strokeDasharray="4 4"
                    />
                  </g>
                ) : null}
                
                <path 
                  d={chart.path} 
                  fill="none" 
                  stroke="rgb(245 158 11)" 
                  strokeWidth="3" 
                  strokeLinecap="round" 
                  strokeLinejoin="round" 
                  opacity={selectionBounds ? 0.25 : 1}
                  className="transition-opacity duration-300"
                />
                
                {chart.points.map((point) => (
                  <circle
                    key={`base-${point.date}`}
                    cx={point.x}
                    cy={point.y}
                    r={2.5}
                    fill="rgb(245 158 11)"
                    opacity={selectionBounds ? 0.25 : 1}
                    className="transition-opacity duration-300"
                  />
                ))}

                {selectionBounds ? (
                  <g clipPath="url(#selection-clip)">
                    <path 
                      d={chart.path} 
                      fill="none" 
                      stroke="rgb(245 158 11)" 
                      strokeWidth="3.5" 
                      strokeLinecap="round" 
                      strokeLinejoin="round" 
                    />
                    {chart.points.map((point) => {
                      const highlighted = point.index >= selectionBounds.startIndex && point.index <= selectionBounds.endIndex;
                      if (!highlighted) return null;
                      return (
                        <circle
                          key={`hi-${point.date}`}
                          cx={point.x}
                          cy={point.y}
                          r={4.5}
                          fill="rgb(245 158 11)"
                          stroke="rgb(255 255 255)"
                          strokeWidth="1.5"
                          className="dark:stroke-zinc-900"
                        />
                      );
                    })}
                  </g>
                ) : null}

                <text x={chart.padding.left} y={chart.height - 8} fontSize="11" fill="currentColor" opacity="0.55">
                  {formatDate(history.range_start)}
                </text>
                <text x={chart.width - chart.padding.right} y={chart.height - 8} textAnchor="end" fontSize="11" fill="currentColor" opacity="0.55">
                  {formatDate(history.range_end)}
                </text>
              </svg>
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-sm text-zinc-500">No movement history available for this material.</div>
            )}
          </div>

          {history && chart ? (
            <div className="grid grid-cols-3 gap-4 mt-6 pt-6 border-t border-black/5 dark:border-white/5">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500 mb-1">Variation</div>
                <div className={`text-lg font-medium ${summary ? (summary.stockDelta < 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400') : 'text-zinc-900 dark:text-white'}`}>
                  {summary ? formatSignedNumber(summary.stockDelta) : "—"}
                </div>
              </div>
              <div>
                <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500 mb-1">Cons./day</div>
                <div className="text-lg font-medium text-zinc-900 dark:text-white">
                  {summary ? formatNumber(summary.averageConsumptionPerDay) : "—"}
                </div>
              </div>
              <div>
                <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500 mb-1">Span</div>
                <div className="text-lg font-medium text-zinc-900 dark:text-white">
                  {summary ? `${formatNumber(summary.elapsedDays, 0)} d` : "—"}
                </div>
              </div>
            </div>
          ) : null}
        </div>

        <div className="p-6 md:p-8 bg-zinc-50/50 dark:bg-white/[0.02] flex flex-col gap-6">
           <div>
             <h3 className="text-[10px] font-bold uppercase tracking-[0.25em] text-zinc-500 mb-4">Procurement Metrics</h3>
             <div className="space-y-3">
                <MetricRow label="Mov. 60d" value={formatNumber(selected.movement_quantity_60d)} />
                <MetricRow label="Pend. OC" value={detail ? formatNumber(detail.pending_purchase_quantity) : detailLoading ? "..." : "—"} />
                <MetricRow label="Reorden 30d" value={detail ? formatDate(detail.reorder_date_recent_rate) : detailLoading ? "..." : "—"} />
                <MetricRow label="Mov. 30d" value={detail ? formatNumber(detail.movement_quantity_30d) : detailLoading ? "..." : "—"} />
                <MetricRow 
                  label="Lead time" 
                  value={
                    !detail ? (detailLoading ? "..." : "—") 
                    : detail.max_lead_time_days !== null && detail.max_lead_time_days !== undefined 
                      ? `${formatNumber(detail.max_lead_time_days, 0)} d` : "—"
                  } 
                />
                <MetricRow label="Dias stock" value={detail ? formatNumber(detail.days_of_stock_30d) : detailLoading ? "..." : "—"} />
                <MetricRow label="Ult. OC" value={detail ? formatDate(detail.last_purchase_order.date) : detailLoading ? "..." : "—"} />
                <MetricRow label="No. OC" value={detail ? detail.last_purchase_order.number || "—" : detailLoading ? "..." : "—"} />
             </div>
           </div>
        </div>
      </div>
    </section>
  );
}

export function MaterialDashboardPage() {
  const [cecos, setCecos] = useState<MaterialDashboardCeco[]>([]);
  const [dashboardCache, setDashboardCache] = useState<Record<string, MaterialDashboardData>>({});
  const [detailCache, setDetailCache] = useState<Record<string, MaterialDashboardDetailData>>({});
  const [historyCache, setHistoryCache] = useState<Record<string, MaterialDashboardMovementData>>({});
  const [selectedCecos, setSelectedCecos] = useState<string[]>([]);
  const [cecoSearch, setCecoSearch] = useState("");
  const [materialSearch, setMaterialSearch] = useState("");
  const [sort, setSort] = useState<SortState>({ key: "last_movement_date", direction: -1 });
  const [selectedSku, setSelectedSku] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const deferredMaterialSearch = useDeferredValue(materialSearch);
  const cecoRefreshNonceRef = useRef(0);
  const dashboardRefreshNonceRef = useRef(0);
  const detailRefreshNonceRef = useRef(0);
  const historyRefreshNonceRef = useRef(0);
  const normalizedSelectedCecos = normalizeCecos(selectedCecos);
  const currentDashboardKey = dashboardCacheKey(normalizedSelectedCecos);
  const data = dashboardCache[currentDashboardKey] || null;
  const currentDetailKey = selectedSku ? detailCacheKey(selectedSku, normalizedSelectedCecos) : null;
  const selectedDetail = currentDetailKey ? detailCache[currentDetailKey] || null : null;
  const currentHistoryKey = selectedSku ? historyCacheKey(selectedSku, normalizedSelectedCecos) : null;
  const currentHistory = currentHistoryKey ? historyCache[currentHistoryKey] || null : null;

  function syncSelectedSku(response: MaterialDashboardData) {
    setSelectedSku((current) => {
      if (current && response.materials.some((row) => row.sku === current)) {
        return current;
      }
      return response.materials[0]?.sku ?? null;
    });
  }

  useEffect(() => {
    let cancelled = false;
    async function loadCostCenters() {
      const forceRefresh = refreshNonce > 0 && cecoRefreshNonceRef.current !== refreshNonce;
      if (forceRefresh) {
        cecoRefreshNonceRef.current = refreshNonce;
      }
      let hasCached = false;
      if (!forceRefresh) {
        const cached = await getMaterialDashboardCacheValue<MaterialDashboardCeco[]>(CECO_CACHE_KEY);
        if (cancelled) {
          return;
        }
        if (cached !== null) {
          hasCached = true;
          setCecos(cached);
        }
      }
      try {
        const response = await api.getMaterialDashboardCostCenters({ refresh: forceRefresh });
        if (!cancelled) {
          setCecos(response.cecos);
          void setMaterialDashboardCacheValue(CECO_CACHE_KEY, response.cecos);
        }
      } catch {
        if (!cancelled && !hasCached) {
          setCecos([]);
        }
      }
    }
    void loadCostCenters();
    return () => {
      cancelled = true;
    };
  }, [refreshNonce]);

  useEffect(() => {
    let cancelled = false;
    async function loadDashboard() {
      const forceRefresh = refreshNonce > 0 && dashboardRefreshNonceRef.current !== refreshNonce;
      if (forceRefresh) {
        dashboardRefreshNonceRef.current = refreshNonce;
      }
      let hasCached = false;
      setError(null);
      if (!forceRefresh) {
        const cached =
          dashboardCache[currentDashboardKey] || (await getMaterialDashboardCacheValue<MaterialDashboardData>(currentDashboardKey));
        if (cancelled) {
          return;
        }
        if (cached) {
          hasCached = true;
          setDashboardCache((current) => (current[currentDashboardKey] ? current : { ...current, [currentDashboardKey]: cached }));
          syncSelectedSku(cached);
          setLoading(false);
        }
      }
      if (!hasCached) {
        setLoading(true);
      }
      try {
        const response = await api.getMaterialDashboard(normalizedSelectedCecos, { refresh: forceRefresh });
        if (cancelled) {
          return;
        }
        setDashboardCache((current) => ({ ...current, [currentDashboardKey]: response }));
        syncSelectedSku(response);
        void setMaterialDashboardCacheValue(currentDashboardKey, response);
      } catch (err) {
        if (cancelled) {
          return;
        }
        if (!hasCached) {
          setError(err instanceof ApiError ? err.message : "Could not load dashboard materials.");
          setSelectedSku(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    void loadDashboard();
    return () => {
      cancelled = true;
    };
  }, [currentDashboardKey, refreshNonce]);

  useEffect(() => {
    const sku = selectedSku;
    const cacheKey = sku ? detailCacheKey(sku, normalizedSelectedCecos) : null;
    if (!sku || !cacheKey) {
      setDetailLoading(false);
      return;
    }
    const activeSku = sku;
    let cancelled = false;
    async function loadDetail() {
      const forceRefresh = refreshNonce > 0 && detailRefreshNonceRef.current !== refreshNonce;
      if (forceRefresh) {
        detailRefreshNonceRef.current = refreshNonce;
      }
      let hasCached = false;
      setHistoryError(null);
      if (!forceRefresh) {
        const cached = detailCache[cacheKey] || (await getMaterialDashboardCacheValue<MaterialDashboardDetailData>(cacheKey));
        if (cancelled) {
          return;
        }
        if (cached) {
          hasCached = true;
          setDetailCache((current) => (current[cacheKey] ? current : { ...current, [cacheKey]: cached }));
          setDetailLoading(false);
        }
      }
      if (!hasCached) {
        setDetailLoading(true);
      }
      try {
        const response = await api.getMaterialDashboardDetail(activeSku, normalizedSelectedCecos, { refresh: forceRefresh });
        if (!cancelled) {
          setDetailCache((current) => ({ ...current, [cacheKey]: response }));
          void setMaterialDashboardCacheValue(cacheKey, response);
        }
      } catch (err) {
        if (!cancelled && !hasCached) {
          setHistoryError(err instanceof ApiError ? err.message : "Could not load material detail.");
        }
      } finally {
        if (!cancelled) {
          setDetailLoading(false);
        }
      }
    }
    void loadDetail();
    return () => {
      cancelled = true;
    };
  }, [currentDetailKey, refreshNonce, selectedSku]);

  useEffect(() => {
    const sku = selectedSku;
    const cacheKey = sku ? historyCacheKey(sku, normalizedSelectedCecos) : null;
    if (!sku || !cacheKey) {
      setHistoryLoading(false);
      return;
    }
    const activeSku = sku;
    let cancelled = false;
    async function loadHistory() {
      const forceRefresh = refreshNonce > 0 && historyRefreshNonceRef.current !== refreshNonce;
      if (forceRefresh) {
        historyRefreshNonceRef.current = refreshNonce;
      }
      let hasCached = false;
      setHistoryError(null);
      if (!forceRefresh) {
        const cached = historyCache[cacheKey] || (await getMaterialDashboardCacheValue<MaterialDashboardMovementData>(cacheKey));
        if (cancelled) {
          return;
        }
        if (cached) {
          hasCached = true;
          setHistoryCache((current) => (current[cacheKey] ? current : { ...current, [cacheKey]: cached }));
          setHistoryLoading(false);
        }
      }
      if (!hasCached) {
        setHistoryLoading(true);
      }
      try {
        const response = await api.getMaterialDashboardHistory(activeSku, normalizedSelectedCecos, { refresh: forceRefresh });
        if (!cancelled) {
          setHistoryCache((current) => ({ ...current, [cacheKey]: response }));
          void setMaterialDashboardCacheValue(cacheKey, response);
        }
      } catch (err) {
        if (!cancelled && !hasCached) {
          setHistoryError(err instanceof ApiError ? err.message : "Could not load movement history.");
        }
      } finally {
        if (!cancelled) {
          setHistoryLoading(false);
        }
      }
    }
    void loadHistory();
    return () => {
      cancelled = true;
    };
  }, [currentHistoryKey, refreshNonce, selectedSku]);

  const normalizedMaterialSearch = deferredMaterialSearch.trim().toLowerCase();
  const rows = (data?.materials || [])
    .filter((row) => {
      if (!normalizedMaterialSearch) {
        return true;
      }
      return row.material_name.toLowerCase().includes(normalizedMaterialSearch) || row.sku.toLowerCase().includes(normalizedMaterialSearch);
    })
    .slice()
    .sort((left, right) => compareRows(left, right, sort));

  const selectedRow = (data?.materials || []).find((row) => row.sku === selectedSku) || null;
  const visibleCecos = cecos.filter((ceco) => {
    const term = cecoSearch.trim().toLowerCase();
    if (!term) {
      return true;
    }
    return ceco.code.toLowerCase().includes(term) || ceco.name.toLowerCase().includes(term);
  });

  function toggleSort(key: SortKey) {
    setSort((current) => (current.key === key ? { key, direction: current.direction === 1 ? -1 : 1 } : { key, direction: -1 }));
  }

  function toggleCeco(code: string) {
    setSelectedCecos((current) => normalizeCecos(current.includes(code) ? current.filter((item) => item !== code) : [...current, code]));
  }

  function handleReload() {
    setRefreshNonce((current) => current + 1);
  }

  return (
    <div className="max-w-[1800px] mx-auto flex flex-col gap-6">
      <MovementHistoryCard
        selected={selectedRow}
        detail={selectedDetail}
        history={currentHistory}
        detailLoading={detailLoading}
        historyLoading={historyLoading}
        detailRefreshing={detailLoading && Boolean(selectedDetail)}
        historyRefreshing={historyLoading && Boolean(currentHistory)}
      />

      <section className="grid grid-cols-1 xl:grid-cols-[340px,minmax(0,1fr)] gap-6">
        <aside className="liquid-glass rounded-[28px] border border-black/10 dark:border-white/10 p-6 flex flex-col gap-5">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.35em] text-zinc-500 mb-3">Filters</p>
            <h2 className="text-xl font-bold text-zinc-900 dark:text-white">ERP movement activity</h2>
            <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-2">
              Materials with outgoing ERP movement in the last {data?.movement_window_days ?? 60} days.
            </p>
          </div>

          <div className="space-y-3">
            <label className="block text-xs font-bold uppercase tracking-[0.25em] text-zinc-500">
              Search materials
              <input
                value={materialSearch}
                onChange={(event) => {
                  const nextValue = event.target.value;
                  startTransition(() => setMaterialSearch(nextValue));
                }}
                className="mt-2 w-full rounded-2xl border border-black/10 dark:border-white/10 bg-white dark:bg-white/5 px-4 py-3 text-sm text-zinc-900 dark:text-white outline-none focus:border-accent-500"
                placeholder="SKU or material name"
              />
            </label>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={handleReload}
                className="flex-1 rounded-2xl bg-accent-500 text-zinc-950 font-bold text-sm px-4 py-3 hover:bg-accent-400 transition-colors"
              >
                Reload
              </button>
              <button
                type="button"
                onClick={() => setSelectedCecos([])}
                className="rounded-2xl border border-black/10 dark:border-white/10 bg-zinc-50 dark:bg-white/5 text-sm font-semibold px-4 py-3 text-zinc-900 dark:text-white hover:bg-zinc-100 dark:hover:bg-white/10 transition-colors"
              >
                Clear CECO
              </button>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold uppercase tracking-[0.25em] text-zinc-500">Selected CECO</p>
              <span className="text-xs text-zinc-500">{selectedCecos.length}</span>
            </div>
            <div className="flex flex-wrap gap-2 min-h-10">
              {selectedCecos.length ? (
                selectedCecos.map((code) => (
                  <button
                    key={code}
                    type="button"
                    onClick={() => toggleCeco(code)}
                    className="rounded-full border border-black/10 dark:border-white/10 bg-zinc-50 dark:bg-white/10 px-3 py-1.5 text-xs font-semibold text-zinc-900 dark:text-white"
                  >
                    {code}
                  </button>
                ))
              ) : (
                <p className="text-sm text-zinc-500">No CECO filters selected.</p>
              )}
            </div>
            <input
              value={cecoSearch}
              onChange={(event) => setCecoSearch(event.target.value)}
              className="w-full rounded-2xl border border-black/10 dark:border-white/10 bg-white dark:bg-white/5 px-4 py-3 text-sm text-zinc-900 dark:text-white outline-none focus:border-accent-500"
              placeholder="Search CECO"
            />
            <div className="max-h-[360px] overflow-y-auto rounded-2xl border border-black/10 dark:border-white/10 bg-white/70 dark:bg-black/20 divide-y divide-black/5 dark:divide-white/5">
              {visibleCecos.length ? (
                visibleCecos.map((ceco) => {
                  const checked = selectedCecos.includes(ceco.code);
                  return (
                    <label key={ceco.code} className="flex items-start gap-3 px-4 py-3 cursor-pointer hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors">
                      <input type="checkbox" checked={checked} onChange={() => toggleCeco(ceco.code)} className="mt-1" />
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-zinc-900 dark:text-white">{ceco.name || ceco.code}</span>
                        <span className="block text-xs text-zinc-500">{ceco.code}</span>
                      </span>
                    </label>
                  );
                })
              ) : (
                <div className="px-4 py-6 text-sm text-zinc-500 text-center">No cost centers match the current filter.</div>
              )}
            </div>
          </div>
        </aside>

        <section className="liquid-glass rounded-[28px] border border-black/10 dark:border-white/10 p-6">
          <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4 mb-5">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.35em] text-zinc-500 mb-2">Materials</p>
              <h2 className="text-xl font-bold text-zinc-900 dark:text-white">{data?.materials.length ?? 0} ERP-active materials</h2>
              <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-2">
                Click a row to pin its history graph. Last refresh: {formatDate(data?.generated_at)}
              </p>
            </div>
            {historyError ? <div className="text-sm text-red-600 dark:text-red-400">{historyError}</div> : null}
          </div>

          {error ? <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

          <div className="overflow-x-auto rounded-[24px] border border-black/10 dark:border-white/10">
            <table className="min-w-full text-sm">
              <thead className="bg-zinc-100/80 dark:bg-white/5 text-zinc-600 dark:text-zinc-400">
                <tr>
                  <SortableHeader label="Material" active={sort.key === "material_name"} direction={sort.direction} onClick={() => toggleSort("material_name")} />
                  <SortableHeader label="SKU" active={sort.key === "sku"} direction={sort.direction} onClick={() => toggleSort("sku")} />
                  <th className="px-4 py-3 text-left font-semibold">Un.</th>
                  <SortableHeader label="Last move" active={sort.key === "last_movement_date"} direction={sort.direction} onClick={() => toggleSort("last_movement_date")} />
                  <SortableHeader label="Mov. 60d" active={sort.key === "movement_quantity_60d"} direction={sort.direction} onClick={() => toggleSort("movement_quantity_60d")} />
                  <SortableHeader label="Movements" active={sort.key === "movement_count_60d"} direction={sort.direction} onClick={() => toggleSort("movement_count_60d")} />
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-zinc-500">
                      Loading materials...
                    </td>
                  </tr>
                ) : rows.length ? (
                  rows.map((row) => {
                    const active = row.sku === selectedSku;
                    return (
                      <tr
                        key={row.sku}
                        className={`cursor-pointer border-t border-black/5 dark:border-white/5 transition-colors ${
                          active ? "bg-amber-50 dark:bg-amber-500/10" : "hover:bg-zinc-50 dark:hover:bg-white/5"
                        }`}
                        onClick={() => setSelectedSku(row.sku)}
                      >
                        <td className="px-4 py-3 font-semibold text-zinc-900 dark:text-white">{row.material_name}</td>
                        <td className="px-4 py-3 font-mono text-xs text-zinc-600 dark:text-zinc-300">{row.sku}</td>
                        <td className="px-4 py-3 text-zinc-600 dark:text-zinc-300">{row.unit || "—"}</td>
                        <td className="px-4 py-3 text-zinc-600 dark:text-zinc-300">{formatDate(row.last_movement_date)}</td>
                        <td className="px-4 py-3 text-zinc-900 dark:text-white">{formatNumber(row.movement_quantity_60d)}</td>
                        <td className="px-4 py-3 text-zinc-900 dark:text-white">{formatNumber(row.movement_count_60d, 0)}</td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-zinc-500">
                      No materials match the current filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </section>
    </div>
  );
}

function SortableHeader({
  label,
  active,
  direction,
  onClick,
}: {
  label: string;
  active: boolean;
  direction: 1 | -1;
  onClick: () => void;
}) {
  return (
    <th className="px-4 py-3 text-left font-semibold">
      <button type="button" onClick={onClick} className="inline-flex items-center gap-2">
        <span>{label}</span>
        <span className={`text-xs ${active ? "opacity-100" : "opacity-35"}`}>{direction === 1 ? "↑" : "↓"}</span>
      </button>
    </th>
  );
}
