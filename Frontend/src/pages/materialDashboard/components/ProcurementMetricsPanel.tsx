import type { KeyboardEvent, ReactNode } from "react";

import { formatCondensedDate, formatDate, formatNumber } from "../formatters";
import {
  getLeadTimeDigits,
  getLeadTimeModeLabel,
  getPurchaseOrderUrgencyClasses,
  type EstimatedConsumptionPurchaseOrderEstimate,
  type LeadTimeMode,
  type LeadTimeReference,
  type PurchaseOrderEstimate,
} from "../procurement";
import { isGroupDetail, type DashboardDetailLike } from "../selection";

import { MetricRow, PurchaseOrderHoverValue } from "./Metrics";

function MetricSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mb-5 last:mb-0">
      <h4 className="mb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-400 dark:text-zinc-500">{title}</h4>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

export function ProcurementMetricsPanel({
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
  const closeOnEnterOrEscape = (close: () => void) => (event: KeyboardEvent) => {
    if (event.key === "Enter" || event.key === "Escape") {
      close();
    }
  };

  return (
    <div className="flex flex-col gap-5 bg-transparent p-5">
      <div>
        <h3 className="mb-3 text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-500">Métricas de compras</h3>
        <MetricSection title="Consumo y stock">
          <MetricRow
            label="Cons. usada"
            hint="Consumo diario usado en la proyección histórica: promedio de los últimos 30 días, o la selección del gráfico si arrastraste un rango."
            value={
              purchaseOrderEstimate
                ? `${formatNumber(purchaseOrderEstimate.rateUsed)} / d${purchaseOrderEstimate.rateSource === "selection" ? " sel." : ""}`
                : "—"
            }
          />
          <MetricRow
            label="Cons. est./sem"
            hint="Consumo semanal estimado según las viviendas vinculadas iniciadas en el rango."
            value={
              estimatedConsumptionPurchaseOrderEstimate
                ? `${formatNumber(estimatedConsumptionPurchaseOrderEstimate.estimatedConsumptionPerWeek)}${estimatedConsumptionPurchaseOrderEstimate.rateSource === "selection" ? " sel." : ""}`
                : "—"
            }
          />
          <MetricRow
            label="Días stock"
            hint="Días de stock restantes al consumo promedio de los últimos 30 días."
            value={detail ? formatNumber(detail.days_of_stock_30d) : detailLoading ? "..." : "—"}
          />
        </MetricSection>
        <MetricSection title="Reposición">
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
                  className="border border-black/10 bg-white px-2 py-1 text-sm font-semibold text-zinc-900 focus:outline-none focus:ring-2 focus:ring-amber-400/50 dark:border-white/10 dark:bg-zinc-900 dark:text-white"
                >
                  <option value="worst">Peor</option>
                  <option value="median">Mediana</option>
                  <option value="average">Promedio</option>
                </select>
              ) : (
                <button
                  type="button"
                  onClick={() => onEditingLeadTimeModeChange(true)}
                  className="-mx-2 px-2 py-1 text-sm font-semibold text-zinc-900 transition-colors hover:bg-black/5 dark:text-white dark:hover:bg-white/5"
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
                    className="w-24 border border-black/10 bg-white px-2 py-1 text-right text-sm font-semibold text-zinc-900 focus:outline-none focus:ring-2 focus:ring-amber-400/50 dark:border-white/10 dark:bg-zinc-900 dark:text-white"
                  />
                  <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">semanas</span>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => onEditingBufferWeeksChange(true)}
                  className="-mx-2 px-2 py-1 text-sm font-semibold text-zinc-900 transition-colors hover:bg-black/5 dark:text-white dark:hover:bg-white/5"
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
            hint="Stock mínimo objetivo según el consumo histórico × buffer."
            value={purchaseOrderEstimate ? formatNumber(purchaseOrderEstimate.minimumExpectedStock) : "—"}
          />
          <MetricRow
            label="Min. est. calc."
            hint="Stock mínimo objetivo según el consumo estimado por proyecto × buffer."
            value={estimatedConsumptionPurchaseOrderEstimate ? formatNumber(estimatedConsumptionPurchaseOrderEstimate.minimumExpectedStock) : "—"}
          />
          <div className="group border-b border-black/5 py-1.5 transition-colors last:border-0 hover:bg-black/[0.02] dark:border-white/5 dark:hover:bg-white/[0.02]">
            <div className="flex items-start justify-between">
              <div
                className="text-xs font-medium text-zinc-500 transition-colors group-hover:text-zinc-700 dark:group-hover:text-zinc-300"
                title="Fecha sugerida para emitir la próxima OC: se retrocede el plazo de entrega desde el día en que el stock tocaría el mínimo."
              >
                Nueva OC
              </div>
              <div className="text-right">
                <div className="text-xs text-zinc-500">
                  <span className="font-medium">histórico:</span>{" "}
                  <span className={getPurchaseOrderUrgencyClasses(purchaseOrderEstimate?.purchaseOrderDate)}>
                    {formatCondensedDate(purchaseOrderEstimate?.purchaseOrderDate)}
                  </span>
                </div>
                <div className="mt-0.5 text-xs text-zinc-500">
                  <span className="font-medium">estimado:</span>{" "}
                  <span className={getPurchaseOrderUrgencyClasses(estimatedConsumptionPurchaseOrderEstimate?.purchaseOrderDate)}>
                    {formatCondensedDate(estimatedConsumptionPurchaseOrderEstimate?.purchaseOrderDate)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </MetricSection>
        <MetricSection title="Órdenes de compra">
          <MetricRow
            label="Pend. OC"
            hint="Cantidad pendiente de recepción en órdenes de compra abiertas."
            value={
              detail ? (
                !groupSelection && !isGroupDetail(detail) ? (
                  <PurchaseOrderHoverValue
                    value={formatNumber(detail.pending_purchase_quantity)}
                    purchaseOrders={detail.purchase_orders || []}
                    currentUnit={detail.unit}
                  />
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
          <MetricRow label="Últ. OC" hint="Fecha de la última orden de compra." value={!groupSelection && detail ? formatDate(detail.last_purchase_order.date) : "—"} />
          <MetricRow label="No. OC" hint="Número de la última orden de compra." value={!groupSelection && detail ? detail.last_purchase_order.number || "—" : "—"} />
        </MetricSection>
      </div>
    </div>
  );
}
