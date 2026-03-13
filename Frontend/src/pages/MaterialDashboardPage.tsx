import { startTransition, useDeferredValue, useEffect, useState } from "react";

import { ApiError, api } from "../lib/api";
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

function historyCacheKey(sku: string, cecos: string[]) {
  return `${sku}::${cecos.join("|")}`;
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

function buildLinePath(
  points: Array<{ date: string; value: number }>,
  width: number,
  height: number,
) {
  if (!points.length) {
    return null;
  }
  const padding = { top: 18, right: 18, bottom: 26, left: 40 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const maxValue = Math.max(...points.map((point) => point.value), 1);
  const minDate = new Date(points[0].date).getTime();
  const maxDate = new Date(points[points.length - 1].date).getTime();
  const span = Math.max(maxDate - minDate, 1);

  const path = points
    .map((point, index) => {
      const x =
        points.length === 1
          ? padding.left + plotWidth / 2
          : padding.left + ((new Date(point.date).getTime() - minDate) / span) * plotWidth;
      const y = padding.top + plotHeight - (point.value / maxValue) * plotHeight;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");

  return { path, maxValue, padding, plotHeight, plotWidth, width, height };
}

function buildHistoricalStockSeries(
  movements: MaterialDashboardMovementPoint[],
  currentStock: number | null | undefined,
) {
  if (currentStock === null || currentStock === undefined || Number.isNaN(currentStock)) {
    return [];
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const normalizedMovements = movements
    .map((point) => {
      const date = new Date(point.date);
      date.setHours(0, 0, 0, 0);
      return {
        date: date.toISOString(),
        quantity: Number(point.quantity) || 0,
        time: date.getTime(),
      };
    })
    .sort((left, right) => left.time - right.time);

  const history: Array<{ date: string; value: number }> = [];
  let runningStock = Number(currentStock);
  for (let index = normalizedMovements.length - 1; index >= 0; index -= 1) {
    const point = normalizedMovements[index];
    if (point.time !== today.getTime()) {
      runningStock += point.quantity;
    }
    history.unshift({
      date: point.date,
      value: runningStock,
    });
  }

  if (!history.length || new Date(history[history.length - 1].date).getTime() !== today.getTime()) {
    history.push({
      date: today.toISOString(),
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

function MovementHistoryCard({
  selected,
  detail,
  history,
  detailLoading,
  historyLoading,
}: {
  selected: MaterialDashboardListRow | null;
  detail: MaterialDashboardDetailData | null;
  history: MaterialDashboardMovementData | null;
  detailLoading: boolean;
  historyLoading: boolean;
}) {
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
  const chart = stockSeries.length ? buildLinePath(stockSeries, 760, 240) : null;

  return (
    <section className="liquid-glass rounded-[28px] border border-black/10 dark:border-white/10 p-6 md:p-8">
      <div className="flex flex-col gap-5">
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.35em] text-zinc-500 mb-2">Pinned Graph</p>
            <h2 className="text-2xl font-bold text-zinc-900 dark:text-white">{selected.material_name}</h2>
            <p className="text-sm text-zinc-500 mt-1">
              {selected.sku}
              {selected.unit ? ` | ${selected.unit}` : ""}
            </p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <MetricCard label="Mov. 60d" value={formatNumber(selected.movement_quantity_60d)} />
            <MetricCard label="Stock" value={detailLoading ? "..." : formatNumber(detail?.stock_on_hand)} />
            <MetricCard label="Pend. OC" value={detailLoading ? "..." : formatNumber(detail?.pending_purchase_quantity)} />
            <MetricCard label="Reorden 30d" value={detailLoading ? "..." : formatDate(detail?.reorder_date_recent_rate)} />
          </div>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
          <MetricCard label="Mov. 30d" value={detailLoading ? "..." : formatNumber(detail?.movement_quantity_30d)} />
          <MetricCard label="Precio prom." value={detailLoading ? "..." : formatCurrency(detail?.average_price)} />
          <MetricCard
            label="Lead time"
            value={
              detailLoading
                ? "..."
                : detail?.max_lead_time_days !== null && detail?.max_lead_time_days !== undefined
                  ? `${formatNumber(detail.max_lead_time_days, 0)} d`
                  : "—"
            }
          />
          <MetricCard label="Dias stock" value={detailLoading ? "..." : formatNumber(detail?.days_of_stock_30d)} />
          <MetricCard label="Ult. OC" value={detailLoading ? "..." : formatDate(detail?.last_purchase_order.date)} />
          <MetricCard label="No. OC" value={detailLoading ? "..." : detail?.last_purchase_order.number || "—"} />
        </div>
        <div className="rounded-[24px] border border-black/10 dark:border-white/10 bg-white/70 dark:bg-black/20 p-4">
          {historyLoading || detailLoading ? (
            <div className="h-[240px] flex items-center justify-center text-sm text-zinc-500">Loading movement history...</div>
          ) : history && chart ? (
            <svg viewBox={`0 0 ${chart.width} ${chart.height}`} className="w-full h-[240px] overflow-visible">
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
              <path d={chart.path} fill="none" stroke="rgb(245 158 11)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
              {stockSeries.map((point, index) => {
                const x =
                  stockSeries.length === 1
                    ? chart.padding.left + chart.plotWidth / 2
                    : chart.padding.left + (index / (stockSeries.length - 1)) * chart.plotWidth;
                const y = chart.padding.top + chart.plotHeight - (point.value / chart.maxValue) * chart.plotHeight;
                return <circle key={point.date} cx={x} cy={y} r={2.5} fill="rgb(245 158 11)" />;
              })}
              <text x={chart.padding.left} y={chart.height - 8} fontSize="11" fill="currentColor" opacity="0.55">
                {formatDate(history.range_start)}
              </text>
              <text x={chart.width - chart.padding.right} y={chart.height - 8} textAnchor="end" fontSize="11" fill="currentColor" opacity="0.55">
                {formatDate(history.range_end)}
              </text>
            </svg>
          ) : (
            <div className="h-[240px] flex items-center justify-center text-sm text-zinc-500">No movement history available for this material.</div>
          )}
        </div>
      </div>
    </section>
  );
}

export function MaterialDashboardPage() {
  const [data, setData] = useState<MaterialDashboardData | null>(null);
  const [cecos, setCecos] = useState<MaterialDashboardCeco[]>([]);
  const [selectedCecos, setSelectedCecos] = useState<string[]>([]);
  const [cecoSearch, setCecoSearch] = useState("");
  const [materialSearch, setMaterialSearch] = useState("");
  const [sort, setSort] = useState<SortState>({ key: "last_movement_date", direction: -1 });
  const [selectedSku, setSelectedSku] = useState<string | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<MaterialDashboardDetailData | null>(null);
  const [historyCache, setHistoryCache] = useState<Record<string, MaterialDashboardMovementData>>({});
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const deferredMaterialSearch = useDeferredValue(materialSearch);

  useEffect(() => {
    let cancelled = false;
    async function loadCostCenters() {
      try {
        const response = await api.getMaterialDashboardCostCenters();
        if (!cancelled) {
          setCecos(response.cecos);
        }
      } catch {
        if (!cancelled) {
          setCecos([]);
        }
      }
    }
    void loadCostCenters();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadDashboard() {
      setLoading(true);
      setError(null);
      setSelectedDetail(null);
      try {
        const response = await api.getMaterialDashboard(selectedCecos);
        if (cancelled) {
          return;
        }
        setData(response);
        setSelectedSku((current) => {
          if (current && response.materials.some((row) => row.sku === current)) {
            return current;
          }
          return response.materials[0]?.sku ?? null;
        });
      } catch (err) {
        if (cancelled) {
          return;
        }
        setError(err instanceof ApiError ? err.message : "Could not load dashboard materials.");
        setData(null);
        setSelectedSku(null);
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
  }, [selectedCecos]);

  useEffect(() => {
    const sku = selectedSku;
    if (!sku) {
      setSelectedDetail(null);
      return;
    }
    let cancelled = false;
    async function loadDetail() {
      setDetailLoading(true);
      setHistoryError(null);
      try {
        const response = await api.getMaterialDashboardDetail(sku, selectedCecos);
        if (!cancelled) {
          setSelectedDetail(response);
        }
      } catch (err) {
        if (!cancelled) {
          setSelectedDetail(null);
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
  }, [selectedCecos, selectedSku]);

  useEffect(() => {
    const sku = selectedSku;
    if (!sku) {
      return;
    }
    const cacheKey = historyCacheKey(sku, selectedCecos);
    if (historyCache[cacheKey]) {
      return;
    }
    let cancelled = false;
    async function loadHistory() {
      setHistoryLoading(true);
      setHistoryError(null);
      try {
        const response = await api.getMaterialDashboardHistory(sku, selectedCecos);
        if (!cancelled) {
          setHistoryCache((current) => ({ ...current, [cacheKey]: response }));
        }
      } catch (err) {
        if (!cancelled) {
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
  }, [historyCache, selectedCecos, selectedSku]);

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
  const currentHistory = selectedSku ? historyCache[historyCacheKey(selectedSku, selectedCecos)] || null : null;
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
    setSelectedCecos((current) => (current.includes(code) ? current.filter((item) => item !== code) : [...current, code]));
  }

  function handleReload() {
    setHistoryCache({});
    setSelectedDetail(null);
    setSelectedCecos((current) => [...current]);
  }

  return (
    <div className="max-w-[1800px] mx-auto flex flex-col gap-6">
      <MovementHistoryCard
        selected={selectedRow}
        detail={selectedDetail}
        history={currentHistory}
        detailLoading={detailLoading}
        historyLoading={historyLoading}
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
