import { useState } from "react";

import { MovementStationDistributionModal } from "../../../components/MovementStationDistributionModal";
import { FactoryQuantityLabel } from "../../../components/QuantityLabels";
import { formatDate, formatNumber } from "../formatters";
import type { DashboardHistoryDetailLike } from "../selection";

import { MovementBreakdownSkeleton } from "./Skeletons";

export function MovementBreakdownList({
  movements,
  loading,
  rangeStart,
  rangeEnd,
  unitLabel,
}: {
  movements: DashboardHistoryDetailLike[];
  loading: boolean;
  rangeStart: string | null;
  rangeEnd: string | null;
  unitLabel?: string | null;
}) {
  const [stationModalOpen, setStationModalOpen] = useState(false);

  if (loading) {
    return <MovementBreakdownSkeleton />;
  }

  const totalQuantity = movements.reduce((sum, movement) => sum + (Number(movement.quantity) || 0), 0);
  const uniqueCecos = new Set(movements.map((movement) => movement.ceco).filter(Boolean)).size;

  return (
    <div className="mt-3 pt-3 border-t border-black/5 dark:border-white/5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <h4 className="text-[10px] font-bold uppercase tracking-[0.25em] text-zinc-500">Desglose de Movimientos</h4>
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
          <span className="rounded-full border border-black/10 px-2.5 py-1 dark:border-white/10">{formatNumber(movements.length, 0)} movs.</span>
          <span className="rounded-full border border-black/10 px-2.5 py-1 dark:border-white/10">{formatNumber(uniqueCecos, 0)} CECOs</span>
          <span className="rounded-full border border-black/10 px-2.5 py-1 dark:border-white/10">{formatNumber(totalQuantity)} cant.</span>
        </div>
      </div>

      <div className="mt-3 flex h-[300px] flex-col overflow-hidden rounded-xl border border-black/10 bg-zinc-50/70 dark:border-white/10 dark:bg-white/[0.03]">
        {movements.length ? (
          <>
            <div className="grid gap-3 border-b border-black/5 bg-zinc-100/50 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.1em] text-zinc-500 dark:border-white/5 dark:bg-white/[0.02] md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
              <div className="flex items-center gap-2">
                <span>Detalles del Movimiento</span>
                <button
                  type="button"
                  onClick={() => setStationModalOpen(true)}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-black/10 bg-white/80 text-zinc-600 transition-colors hover:border-amber-400/60 hover:text-amber-600 dark:border-white/10 dark:bg-white/[0.04] dark:text-zinc-300 dark:hover:text-amber-300"
                  title="Ver distribución por estación"
                  aria-label="Ver distribución por estación"
                >
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" aria-hidden="true">
                    <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.7" opacity="0.35" />
                    <path d="M12 4a8 8 0 0 1 8 8h-8z" fill="currentColor" />
                    <path d="M12 12l-4.9 6.3A8 8 0 0 1 4 12z" fill="currentColor" opacity="0.6" />
                  </svg>
                </button>
              </div>
              <div className="text-left md:text-right"><FactoryQuantityLabel /></div>
            </div>
            <div className="flex-1 divide-y divide-black/5 overflow-y-auto dark:divide-white/5">
              {movements.map((movement, index) => {
                const cecoLabel = movement.ceco_name ? `${movement.ceco ?? "Sin CECO"} - ${movement.ceco_name}` : movement.ceco ?? "Sin CECO";
                const titleParts = [
                  `Fecha: ${formatDate(movement.date)}`,
                  `Cantidad: ${formatNumber(movement.quantity)}`,
                  `CECO: ${cecoLabel}`,
                  "sku" in movement ? `SKU: ${movement.sku}` : null,
                  movement.movement_internal_number ? `Mov. ERP: ${movement.movement_internal_number}` : null,
                  movement.line_count > 0 ? `Lineas SKU: ${formatNumber(movement.line_count, 0)}` : null,
                ].filter(Boolean);
                return (
                  <div
                    key={`${movement.date}-${movement.movement_internal_number ?? "movement"}-${index}`}
                    title={titleParts.join("\n")}
                    className="grid gap-3 px-4 py-3 transition-colors hover:bg-zinc-100/50 dark:hover:bg-white/[0.05] md:grid-cols-[minmax(0,1fr)_auto] md:items-center"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-zinc-900 dark:text-white">{formatDate(movement.date)}</span>
                        {"sku" in movement ? (
                          <span className="rounded-full border border-black/10 px-2 py-0.5 font-mono text-[10px] text-zinc-500 dark:border-white/10">
                            {movement.sku}
                          </span>
                        ) : null}
                        <span className="rounded-full bg-black/[0.05] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-600 dark:bg-white/[0.06] dark:text-zinc-300">
                          {movement.ceco ?? "Sin CECO"}
                        </span>
                        {movement.movement_internal_number ? (
                          <span className="rounded-full border border-black/10 px-2 py-0.5 font-mono text-[10px] text-zinc-500 dark:border-white/10">
                            ERP {movement.movement_internal_number}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 truncate text-xs text-zinc-500">
                        {"material_name" in movement ? `${movement.material_name} • ` : ""}
                        {movement.ceco_name || "Sin descripción de CECO"}
                        {movement.line_count > 0 ? ` • ${formatNumber(movement.line_count, 0)} lineas SKU` : ""}
                      </p>
                    </div>
                    <div className="text-left md:text-right">
                      <div className="text-base font-semibold text-zinc-900 dark:text-white">{formatNumber(movement.quantity)}</div>
                      <div className="text-[11px] text-zinc-500">
                        {"source_quantity" in movement ? `${formatNumber(movement.source_quantity)} src` : "Salida"}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <div className="flex h-full items-center justify-center px-4 py-8 text-sm text-zinc-500">
            No outgoing movements fell within this plotted period.
          </div>
        )}
      </div>

      <MovementStationDistributionModal
        open={stationModalOpen}
        movements={movements}
        rangeStart={rangeStart}
        rangeEnd={rangeEnd}
        unitLabel={unitLabel}
        onClose={() => setStationModalOpen(false)}
      />
    </div>
  );
}
