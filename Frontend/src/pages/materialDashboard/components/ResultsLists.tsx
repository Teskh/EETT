import { memo } from "react";

import type {
  MaterialDashboardCeco,
  MaterialDashboardEconomicMetric,
  MaterialDashboardListRow,
  MaterialStudyGroupRow,
} from "../../../lib/types";
import { formatCurrency, formatDate, formatNumber, formatPercent, formatUnsignedPercent, isFiniteNumber } from "../formatters";
import type { CecoFilterMode } from "../preferences";

function ActiveRowMarker() {
  return <div className="absolute left-0 top-0 bottom-0 w-1 bg-amber-500" />;
}

function rowClasses(active: boolean) {
  return `cursor-pointer p-4 transition-colors ${
    active ? "bg-amber-50 dark:bg-amber-500/10 relative" : "hover:bg-zinc-100 dark:hover:bg-white/5"
  }`;
}

function rowTitleClasses(active: boolean) {
  return `text-sm font-semibold leading-tight ${active ? "text-amber-900 dark:text-amber-100" : "text-zinc-900 dark:text-white"}`;
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
    : isSavings
    ? "text-emerald-600 dark:text-emerald-400"
    : "text-zinc-500 dark:text-zinc-400";
  const separator = <span className="text-zinc-300 dark:text-zinc-600">•</span>;

  return (
    <div className="mt-1 flex items-center gap-1.5 text-[11px]">
      {hasCostDelta ? (
        <span className={`inline-flex items-center gap-1 font-medium ${colorClasses}`}>
          {isOvercost && (
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 10l7-7m0 0l7 7m-7-7v18" />
            </svg>
          )}
          {isSavings && (
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
            </svg>
          )}
          <span>{formatCurrency(Math.abs(costDelta))}/house</span>
        </span>
      ) : null}
      {hasConsumptionDelta && (
        <>
          {hasCostDelta ? separator : null}
          <span className="text-zinc-500 dark:text-zinc-400">{formatPercent(deltaPercent)}</span>
        </>
      )}
      {hasPriceDelta ? (
        <>
          {hasCostDelta || hasConsumptionDelta ? separator : null}
          <span
            className="text-amber-600 dark:text-amber-400"
            title={`Volatilidad OC: ${formatCurrency(metric?.purchase_price_delta)} entre precio mínimo y máximo`}
          >
            ↕ {formatUnsignedPercent(priceDeltaPercent)}
          </span>
        </>
      ) : null}
      {hasWeightedOverprice ? (
        <>
          {hasCostDelta || hasConsumptionDelta || hasPriceDelta ? separator : null}
          <span
            className="text-zinc-500 dark:text-zinc-400"
            title="Sobreprecio ponderado por consumo histórico / cantidad estimada"
          >
            H {formatCurrency(historicalOverprice)} · E {formatCurrency(estimatedOverprice)}
          </span>
        </>
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
    return <div className="p-10 text-center text-sm text-zinc-500">Cargando materiales...</div>;
  }

  if (!rows.length && !erpRows.length && !erpLoading && !erpError) {
    return <div className="p-10 text-center text-sm text-zinc-500">No hay materiales que coincidan con los filtros actuales.</div>;
  }

  return (
    <div className="divide-y divide-black/5 dark:divide-white/5">
      {rows.map((row) => {
        const active = row.sku === selectedMaterialSku;
        return (
          <div key={row.sku} onClick={() => onSelect(`material:${row.sku}`)} className={rowClasses(active)}>
            {active ? <ActiveRowMarker /> : null}
            <div className="flex justify-between items-start gap-4 mb-2">
              <div className="min-w-0 flex-1">
                <h4 className={rowTitleClasses(active)}>{row.material_name}</h4>
                <MaterialEconomicDeltaBadge metric={economicMetricsBySku.get(row.sku)} />
              </div>
              <div className="text-xs font-mono px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 flex-shrink-0">
                {row.sku}
              </div>
            </div>
            <div className="flex items-center justify-between text-xs text-zinc-500">
              <div><span className="font-medium text-zinc-700 dark:text-zinc-300">{formatNumber(row.movement_quantity_60d)}</span> {row.unit || "unidades"} ({movementWindowDays}d)</div>
              <div>Últ. mov: {formatDate(row.last_movement_date)}</div>
            </div>
          </div>
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
                <div key={`erp-${row.sku}`} onClick={() => onSelectErpMaterial(row)} className={rowClasses(active)}>
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
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
});

export const GroupResultsList = memo(function GroupResultsList({
  rows,
  movementWindowDays,
  selectedGroupId,
  onSelect,
}: {
  rows: MaterialStudyGroupRow[];
  movementWindowDays: number;
  selectedGroupId: number | null;
  onSelect: (key: string) => void;
}) {
  if (!rows.length) {
    return <div className="p-10 text-center text-sm text-zinc-500">No hay grupos que coincidan con los filtros actuales.</div>;
  }

  return (
    <div className="divide-y divide-black/5 dark:divide-white/5">
      {rows.map((row) => {
        const active = row.group_id === selectedGroupId;
        return (
          <div key={row.group_id} onClick={() => onSelect(`group:${row.group_id}`)} className={rowClasses(active)}>
            {active ? <ActiveRowMarker /> : null}
            <div className="flex justify-between items-start gap-4 mb-2">
              <div>
                <h4 className={rowTitleClasses(active)}>{row.name}</h4>
                <div className="mt-1 text-[11px] text-zinc-500">{formatNumber(row.member_count, 0)} members</div>
              </div>
              <div className="text-xs font-mono px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 flex-shrink-0">
                {row.study_unit}
              </div>
            </div>
            <div className="flex items-center justify-between text-xs text-zinc-500">
              <div><span className="font-medium text-zinc-700 dark:text-zinc-300">{formatNumber(row.movement_quantity_60d)}</span> {row.study_unit} ({movementWindowDays}d)</div>
              <div>Last mov: {formatDate(row.last_movement_date)}</div>
            </div>
          </div>
        );
      })}
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
