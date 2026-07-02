import type { ReactNode } from "react";

import type { MaterialDashboardPurchaseOrderLine } from "../../../lib/types";
import { formatCurrency, formatDate, formatNumber } from "../formatters";

export function MetricRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="group flex items-center justify-between border-b border-black/5 py-1.5 transition-colors last:border-0 hover:bg-black/[0.02] dark:border-white/5 dark:hover:bg-white/[0.02]">
      <div className="text-xs font-medium text-zinc-500 transition-colors group-hover:text-zinc-700 dark:group-hover:text-zinc-300">{label}</div>
      <div className="text-sm font-semibold text-zinc-900 dark:text-white">{value}</div>
    </div>
  );
}

const PURCHASE_ORDER_GRID = "grid grid-cols-[0.8fr_0.9fr_0.5fr_0.7fr_0.6fr_0.7fr_0.7fr_0.7fr] gap-2";

export function PurchaseOrderHoverValue({
  value,
  purchaseOrders,
}: {
  value: ReactNode;
  purchaseOrders: MaterialDashboardPurchaseOrderLine[];
}) {
  return (
    <div className="group/oc relative inline-flex justify-end">
      <button
        type="button"
        className="rounded px-1.5 py-0.5 -mr-1 text-sm font-semibold text-zinc-900 underline decoration-dotted underline-offset-4 outline-none transition-colors hover:bg-black/5 focus:bg-black/5 dark:text-white dark:hover:bg-white/10 dark:focus:bg-white/10"
      >
        {value}
      </button>
      <div className="pointer-events-auto absolute right-0 top-full z-40 mt-2 hidden w-[600px] max-w-[calc(100vw-2rem)] rounded-lg border border-black/10 bg-white p-3 text-left shadow-2xl group-hover/oc:block group-focus-within/oc:block dark:border-white/10 dark:bg-zinc-950">
        <div className="mb-2 flex items-center justify-between gap-3">
          <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-zinc-500">Últimas OC</div>
          <div className="text-[10px] font-medium text-zinc-500">Cuenta: AP/PE últimos 4 meses</div>
        </div>
        {purchaseOrders.length ? (
          <div className="max-h-80 overflow-y-auto">
            <div className={`${PURCHASE_ORDER_GRID} border-b border-black/10 pb-1 text-[10px] font-bold uppercase tracking-[0.12em] text-zinc-500 dark:border-white/10`}>
              <span>Fecha / Ent.</span>
              <span>OC</span>
              <span>Estado</span>
              <span className="text-right">Precio</span>
              <span className="text-right">Ord.</span>
              <span className="text-right">Rec.</span>
              <span className="text-right">No inv.</span>
              <span className="text-right">Pend.</span>
            </div>
            <div className="divide-y divide-black/5 dark:divide-white/10">
              {purchaseOrders.map((order, index) => {
                const received = (order.received_quantity ?? 0) + (order.received_not_invoiced_quantity ?? 0);
                const muted = !order.counted_in_pending;
                return (
                  <div
                    key={`${order.number || "oc"}-${order.line_number || index}-${index}`}
                    className={`${PURCHASE_ORDER_GRID} py-1.5 text-xs ${
                      muted ? "text-zinc-400 dark:text-zinc-600" : "text-zinc-800 dark:text-zinc-100"
                    }`}
                  >
                    <span>
                      <span className="block">{formatDate(order.date)}</span>
                      {order.estimated_delivery ? <span className="block text-[10px] opacity-75">Ent. {formatDate(order.estimated_delivery)}</span> : null}
                    </span>
                    <span className="truncate font-mono" title={order.line_number ? `${order.number || ""} línea ${order.line_number}` : order.number || ""}>
                      {order.number || "N/D"}
                    </span>
                    <span>{order.status_code || "N/D"}</span>
                    <span className="text-right tabular-nums">{formatCurrency(order.unit_price)}</span>
                    <span className="text-right tabular-nums">{formatNumber(order.ordered_quantity)}</span>
                    <span className="text-right tabular-nums" title={`Recibido total: ${formatNumber(received)}`}>
                      {formatNumber(order.received_quantity)}
                    </span>
                    <span className="text-right tabular-nums">{formatNumber(order.received_not_invoiced_quantity)}</span>
                    <span className="text-right tabular-nums font-semibold">{formatNumber(order.pending_quantity)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="py-3 text-xs font-medium text-zinc-500">No hay OC recientes para este material.</div>
        )}
      </div>
    </div>
  );
}
