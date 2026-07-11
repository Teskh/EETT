import { memo } from "react";

import type {
  MaterialDashboardCeco,
  MaterialDashboardEconomicMetric,
  MaterialDashboardListRow,
  MaterialStudyGroupRow,
} from "../../../lib/types";
import {
  formatCompactCurrency,
  formatCurrency,
  formatDate,
  formatNumber,
  formatPercent,
  formatUnsignedPercent,
  isFiniteNumber,
} from "../formatters";
import type { CecoFilterMode } from "../preferences";

function ActiveRowMarker() {
  return <span aria-hidden="true" className="absolute bottom-0 left-0 top-0 w-1 bg-amber-500" />;
}

function rowClasses(active: boolean) {
  return `relative block w-full cursor-pointer px-4 py-3 text-left transition-colors focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-500 ${
    active ? "bg-amber-50 dark:bg-amber-500/10 relative" : "hover:bg-zinc-100 dark:hover:bg-white/5"
  }`;
}

function rowTitleClasses(active: boolean) {
  return `text-sm font-semibold leading-snug line-clamp-2 ${active ? "text-amber-900 dark:text-amber-100" : "text-zinc-900 dark:text-white"}`;
}

const MaterialEconomicDeltaBadge = memo(function MaterialEconomicDeltaBadge({
  metric,
}: {
  metric: MaterialDashboardEconomicMetric | null | undefined;
}) {
  const costDelta = metric?.consumption_cost_delta_per_house;
  const deltaPercent = metric?.consumption_delta_percent;
  const priceDeltaPercent = metric?.purchase_price_delta_percent;
  const historicalOverprice = metric?.historical_weighted_overprice;
  const estimatedOverprice = metric?.estimated_weighted_overprice;

  const hasCostDelta = isFiniteNumber(costDelta);
  const hasConsumptionDelta = isFiniteNumber(deltaPercent);
  const hasPriceDelta = isFiniteNumber(priceDeltaPercent);
  const hasWeightedOverprice = isFiniteNumber(historicalOverprice) || isFiniteNumber(estimatedOverprice);
  if (!hasCostDelta && !hasConsumptionDelta && !hasPriceDelta && !hasWeightedOverprice) {
    return null;
  }

  const isOvercost = hasCostDelta && costDelta > 0;
  const isSavings = hasCostDelta && costDelta < 0;
  const colorClasses = isOvercost
    ? "text-red-600 dark:text-red-400"
    : "text-zinc-500 dark:text-zinc-400";

  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] leading-4 tabular-nums">
      {hasCostDelta ? (
        <span
          className={`inline-flex items-center gap-0.5 font-semibold ${colorClasses}`}
          title={isOvercost ? "Sobrecosto por vivienda vs. lo estimado" : isSavings ? "Ahorro por vivienda vs. lo estimado" : "Costo por vivienda vs. lo estimado"}
        >
          {isOvercost ? "↑" : isSavings ? "↓" : ""}
          {formatCompactCurrency(Math.abs(costDelta))}/viv.
        </span>
      ) : null}
      {hasConsumptionDelta ? (
        <span className="text-zinc-500 dark:text-zinc-400" title="Delta de consumo real vs. estimado en el rango">
          {formatPercent(deltaPercent)}
        </span>
      ) : null}
      {hasPriceDelta ? (
        <span
          className="text-zinc-500 dark:text-zinc-400"
          title={`Volatilidad OC: ${formatCurrency(metric?.purchase_price_delta)} entre precio mínimo y máximo`}
        >
          ↕ {formatUnsignedPercent(priceDeltaPercent)}
        </span>
      ) : null}
      {hasWeightedOverprice ? (
        <span
          className="text-zinc-400 dark:text-zinc-500"
          title={`Sobreprecio ponderado histórico: ${formatCurrency(historicalOverprice)} · estimado: ${formatCurrency(estimatedOverprice)}`}
        >
          H {formatCompactCurrency(historicalOverprice)} · E {formatCompactCurrency(estimatedOverprice)}
        </span>
      ) : null}
    </div>
  );
});

export const MaterialResultsList = memo(function MaterialResultsList({
  loading,
  rows,
  erpRows,
  erpLoading,
  erpError,
  hasMore,
  movementWindowDays,
  economicMetricsBySku,
  selectedMaterialSku,
  onSelect,
  onSelectErpMaterial,
}: {
  loading: boolean;
  rows: MaterialDashboardListRow[];
  erpRows: MaterialDashboardListRow[];
  erpLoading: boolean;
  erpError: string | null;
  hasMore: boolean;
  movementWindowDays: number;
  economicMetricsBySku: ReadonlyMap<string, MaterialDashboardEconomicMetric>;
  selectedMaterialSku: string | null;
  onSelect: (key: string) => void;
  onSelectErpMaterial: (row: MaterialDashboardListRow) => void;
}) {
  if (loading) {
    return <div role="status" className="p-10 text-center text-sm text-zinc-500">Cargando materiales...</div>;
  }

  if (!rows.length && !erpRows.length && !erpLoading && !erpError) {
    return <div className="p-10 text-center text-sm text-zinc-500">No hay materiales que coincidan con los filtros actuales.</div>;
  }

  return (
    <div className="divide-y divide-black/5 dark:divide-white/5">
      {rows.map((row) => {
        const active = row.sku === selectedMaterialSku;
        return (
          <button
            key={row.sku}
            type="button"
            onClick={() => onSelect(`material:${row.sku}`)}
            className={rowClasses(active)}
            aria-current={active ? "true" : undefined}
          >
            {active ? <ActiveRowMarker /> : null}
            <div className="flex justify-between items-start gap-3 mb-1.5">
              <div className="min-w-0 flex-1">
                <h4 className={rowTitleClasses(active)} title={row.material_name}>
                  {row.material_name}
                </h4>
                <MaterialEconomicDeltaBadge metric={active ? null : economicMetricsBySku.get(row.sku)} />
              </div>
              <div className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 flex-shrink-0">
                {row.sku}
              </div>
            </div>
            <div className="flex items-center justify-between gap-3 text-xs text-zinc-500 tabular-nums">
              <div className="min-w-0 truncate"><span className="font-medium text-zinc-700 dark:text-zinc-300">{formatNumber(row.movement_quantity_60d)}</span> {row.unit || "unidades"} ({movementWindowDays}d)</div>
              <div className="flex-shrink-0">Últ. mov: {formatDate(row.last_movement_date)}</div>
            </div>
          </button>
        );
      })}
      {hasMore ? <div className="px-4 py-3 text-[11px] font-medium text-zinc-400">Desplázate para cargar más materiales...</div> : null}
      {erpLoading ? <div className="px-4 py-3 text-xs font-medium text-zinc-500">Buscando en ERP...</div> : null}
      {erpError ? <div className="px-4 py-3 text-xs font-medium text-red-600 dark:text-red-400">{erpError}</div> : null}
      {erpRows.length ? (
        <div className="bg-zinc-50/80 dark:bg-white/[0.02]">
          <div className="px-4 py-2 text-[10px] font-bold uppercase tracking-[0.22em] text-zinc-500">ERP sin movimiento en rango</div>
          <div className="divide-y divide-black/5 dark:divide-white/5">
            {erpRows.map((row) => {
              const active = row.sku === selectedMaterialSku;
              return (
                <button
                  key={`erp-${row.sku}`}
                  type="button"
                  onClick={() => onSelectErpMaterial(row)}
                  className={rowClasses(active)}
                  aria-current={active ? "true" : undefined}
                >
                  {active ? <ActiveRowMarker /> : null}
                  <div className="flex justify-between items-start gap-4 mb-2">
                    <div className="min-w-0 flex-1">
                      <h4 className={rowTitleClasses(active)}>{row.material_name}</h4>
                    </div>
                    <div className="text-xs font-mono px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 flex-shrink-0">
                      {row.sku}
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-xs text-zinc-500">
                    <div>{row.unit || "Sin unidad"}</div>
                    <div>Sin movimiento en este rango</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
});

export const GroupResultsList = memo(function GroupResultsList({
  loading,
  rows,
  hasMore,
  movementWindowDays,
  economicMetricsByGroupId,
  selectedGroupId,
  onSelect,
}: {
  loading: boolean;
  rows: MaterialStudyGroupRow[];
  hasMore: boolean;
  movementWindowDays: number;
  economicMetricsByGroupId: ReadonlyMap<number, MaterialDashboardEconomicMetric>;
  selectedGroupId: number | null;
  onSelect: (key: string) => void;
}) {
  if (loading) {
    return <div role="status" className="p-10 text-center text-sm text-zinc-500">Cargando grupos...</div>;
  }

  if (!rows.length) {
    return <div className="p-10 text-center text-sm text-zinc-500">No hay grupos que coincidan con los filtros actuales.</div>;
  }

  return (
    <div className="divide-y divide-black/5 dark:divide-white/5">
      {rows.map((row) => {
        const active = row.group_id === selectedGroupId;
        return (
          <button
            key={row.group_id}
            type="button"
            onClick={() => onSelect(`group:${row.group_id}`)}
            className={rowClasses(active)}
            aria-current={active ? "true" : undefined}
          >
            {active ? <ActiveRowMarker /> : null}
            <div className="flex justify-between items-start gap-3 mb-1.5">
              <div className="min-w-0 flex-1">
                <h4 className={rowTitleClasses(active)} title={row.name}>
                  {row.name}
                </h4>
                <MaterialEconomicDeltaBadge metric={active ? null : economicMetricsByGroupId.get(row.group_id)} />
                <div className="mt-1 text-[11px] text-zinc-500">{formatNumber(row.member_count, 0)} miembros</div>
              </div>
              <div className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 flex-shrink-0">
                {row.study_unit}
              </div>
            </div>
            <div className="flex items-center justify-between gap-3 text-xs text-zinc-500 tabular-nums">
              <div className="min-w-0 truncate"><span className="font-medium text-zinc-700 dark:text-zinc-300">{formatNumber(row.movement_quantity_60d)}</span> {row.study_unit} ({movementWindowDays}d)</div>
              <div className="flex-shrink-0">Últ. mov: {formatDate(row.last_movement_date)}</div>
            </div>
          </button>
        );
      })}
      {hasMore ? <div className="px-4 py-3 text-[11px] font-medium text-zinc-400">Desplázate para cargar más grupos...</div> : null}
    </div>
  );
});

export const CecoResultsList = memo(function CecoResultsList({
  rows,
  hasMore,
  selectedCecoSet,
  cecoFilterMode,
  onToggle,
}: {
  rows: MaterialDashboardCeco[];
  hasMore: boolean;
  selectedCecoSet: Set<string>;
  cecoFilterMode: CecoFilterMode;
  onToggle: (code: string) => void;
}) {
  if (!rows.length) {
    return <div className="py-6 text-sm text-zinc-500 text-center">No hay centros de costo coincidentes.</div>;
  }

  return (
    <div className="space-y-1">
      {rows.map((ceco) => {
        const isSelected = selectedCecoSet.has(ceco.code);
        const excludeMode = cecoFilterMode === "exclude";
        return (
          <label
            key={ceco.code}
            className={`flex items-start gap-3 p-2.5 rounded-xl cursor-pointer transition-colors ${
              isSelected
                ? excludeMode
                  ? "bg-rose-50 dark:bg-rose-500/10 hover:bg-rose-100 dark:hover:bg-rose-500/20"
                  : "bg-accent-50 dark:bg-accent-500/10 hover:bg-accent-100 dark:hover:bg-accent-500/20"
                : "hover:bg-zinc-100 dark:hover:bg-white/5"
            }`}
          >
            <input
              type="checkbox"
              checked={isSelected}
              onChange={() => onToggle(ceco.code)}
              className="mt-1 flex-shrink-0"
            />
            <span className="min-w-0 flex-1">
              <span
                className={`block text-sm font-medium truncate ${
                  isSelected
                    ? excludeMode
                      ? "text-rose-900 dark:text-rose-100"
                      : "text-accent-900 dark:text-accent-100"
                    : "text-zinc-900 dark:text-white"
                }`}
              >
                {ceco.name || ceco.code}
              </span>
              <span
                className={`block text-[10px] uppercase tracking-wider ${
                  isSelected
                    ? excludeMode
                      ? "text-rose-700 dark:text-rose-300"
                      : "text-accent-700 dark:text-accent-300"
                    : "text-zinc-500"
                }`}
              >
                {ceco.code}
              </span>
            </span>
          </label>
        );
      })}
      {hasMore ? <div className="px-2 py-3 text-[11px] font-medium text-zinc-400">Desplázate para cargar más CECOs...</div> : null}
    </div>
  );
});
