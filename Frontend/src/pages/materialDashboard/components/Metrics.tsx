import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import type { MaterialDashboardPurchaseOrderLine } from "../../../lib/types";
import { formatCurrency, formatDate, formatNumber } from "../formatters";

export function MetricRow({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="group flex items-center justify-between border-b border-black/5 py-1.5 transition-colors last:border-0 hover:bg-black/[0.02] dark:border-white/5 dark:hover:bg-white/[0.02]">
      <div
        className="text-xs font-medium text-zinc-500 transition-colors group-hover:text-zinc-700 dark:group-hover:text-zinc-300"
        title={hint}
      >
        {label}
      </div>
      <div className="text-sm font-semibold text-zinc-900 dark:text-white">{value}</div>
    </div>
  );
}

const PURCHASE_ORDER_GRID = "grid grid-cols-[0.75fr_0.8fr_0.45fr_0.55fr_0.7fr_0.55fr_0.65fr_0.65fr_0.65fr] gap-2";

function normalizeUnit(value: string | null | undefined) {
  return (value || "").trim().toLowerCase();
}

function receiptUnitLabel(order: MaterialDashboardPurchaseOrderLine) {
  const units = order.receipt_units || [];
  if (!units.length) {
    return "—";
  }
  if (units.length === 1) {
    return units[0].unit;
  }
  const visibleUnits = units.slice(0, 2).map((entry) => entry.unit);
  return `${visibleUnits.join("/")}${units.length > visibleUnits.length ? ` +${units.length - visibleUnits.length}` : ""}`;
}

function receiptUnitTitle(order: MaterialDashboardPurchaseOrderLine, currentUnit?: string | null) {
  const units = order.receipt_units || [];
  const currentUnitText = currentUnit || "N/D";
  if (!units.length) {
    return `Sin recepción ERP con unidad trazable. Unidad actual del SKU: ${currentUnitText}.`;
  }
  const unitDetails = units.map((entry) => `${formatNumber(entry.received_quantity)} ${entry.unit}`).join(" · ");
  return `Recepciones ERP: ${unitDetails}. Unidad actual del SKU: ${currentUnitText}.`;
}

function receiptUnitMismatch(order: MaterialDashboardPurchaseOrderLine, currentUnit?: string | null) {
  const normalizedCurrentUnit = normalizeUnit(currentUnit);
  const units = order.receipt_units || [];
  if (!normalizedCurrentUnit || !units.length) {
    return false;
  }
  return units.some((entry) => normalizeUnit(entry.unit) !== normalizedCurrentUnit);
}

export function PurchaseOrderHoverValue({
  value,
  purchaseOrders,
  currentUnit,
}: {
  value: ReactNode;
  purchaseOrders: MaterialDashboardPurchaseOrderLine[];
  currentUnit?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number; width: number } | null>(null);
  const popupId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<number | null>(null);

  const cancelClose = useCallback(() => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const showPopup = useCallback(() => {
    cancelClose();
    setOpen(true);
  }, [cancelClose]);

  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimerRef.current = window.setTimeout(() => setOpen(false), 120);
  }, [cancelClose]);

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) {
      return;
    }
    const viewportPadding = 16;
    const gap = 8;
    const width = Math.min(720, window.innerWidth - viewportPadding * 2);
    const triggerRect = trigger.getBoundingClientRect();
    const popupHeight = popupRef.current?.offsetHeight ?? 360;
    const roomBelow = window.innerHeight - triggerRect.bottom - gap - viewportPadding;
    const top = roomBelow >= popupHeight
      ? triggerRect.bottom + gap
      : Math.max(viewportPadding, triggerRect.top - popupHeight - gap);
    const left = Math.min(
      Math.max(viewportPadding, triggerRect.right - width),
      window.innerWidth - width - viewportPadding,
    );
    setPosition({ top, left, width });
  }, []);

  useLayoutEffect(() => {
    if (open) {
      updatePosition();
    } else {
      setPosition(null);
    }
  }, [open, purchaseOrders.length, updatePosition]);

  useEffect(() => {
    if (!open) {
      return;
    }
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, updatePosition]);

  useEffect(() => () => cancelClose(), [cancelClose]);

  const popup = open
    ? createPortal(
        <div
          id={popupId}
          ref={popupRef}
          role="dialog"
          aria-label="Últimas órdenes de compra"
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
          onFocus={cancelClose}
          onBlur={scheduleClose}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setOpen(false);
              triggerRef.current?.focus();
            }
          }}
          style={{
            top: position?.top ?? 0,
            left: position?.left ?? 0,
            width: position?.width ?? Math.min(720, window.innerWidth - 32),
            visibility: position ? "visible" : "hidden",
          }}
          className="pointer-events-auto fixed z-[100] max-w-[calc(100vw-2rem)] rounded-lg border border-black/10 bg-white p-3 text-left shadow-2xl dark:border-white/10 dark:bg-zinc-950"
        >
          <div className="mb-2 flex items-center justify-between gap-3">
            <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-zinc-500">Últimas OC</div>
            <div className="text-[10px] font-medium text-zinc-500">UM recep. viene de movimientos ERP</div>
          </div>
          {purchaseOrders.length ? (
            <div className="max-h-80 overflow-y-auto">
              <div className={`${PURCHASE_ORDER_GRID} border-b border-black/10 pb-1 text-[10px] font-bold uppercase tracking-[0.12em] text-zinc-500 dark:border-white/10`}>
                <span>Fecha / Ent.</span>
                <span>OC</span>
                <span>Estado</span>
                <span className="text-right">UM recep.</span>
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
                  const unitMismatch = receiptUnitMismatch(order, currentUnit);
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
                      <span
                        className={`text-right tabular-nums ${
                          unitMismatch ? "font-semibold text-amber-700 dark:text-amber-300" : ""
                        }`}
                        title={receiptUnitTitle(order, currentUnit)}
                      >
                        {receiptUnitLabel(order)}
                      </span>
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
        </div>,
        document.body,
      )
    : null;

  return (
    <div className="inline-flex justify-end" onMouseEnter={showPopup} onMouseLeave={scheduleClose}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? setOpen(false) : showPopup())}
        onFocus={showPopup}
        onBlur={scheduleClose}
        aria-expanded={open}
        aria-controls={popupId}
        className="-mr-1 px-1.5 py-0.5 text-sm font-semibold text-zinc-900 underline decoration-dotted underline-offset-4 outline-none transition-colors hover:bg-black/5 focus:bg-black/5 dark:text-white dark:hover:bg-white/10 dark:focus:bg-white/10"
      >
        {value}
      </button>
      {popup}
    </div>
  );
}
