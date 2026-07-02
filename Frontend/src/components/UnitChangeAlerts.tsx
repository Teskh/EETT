import { useEffect, useState } from "react";

import { ApiError, api } from "../lib/api";
import { canEditPage } from "../lib/pageAccess";
import type { MaterialUnitAlert, MaterialUnitAlertsResponse, SessionUser } from "../lib/types";

const POLL_INTERVAL_MS = 5 * 60 * 1000;

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

function UnitBadge({ oldUnit, newUnit }: { oldUnit: string | null; newUnit: string | null }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2 py-0.5 font-mono text-[11px] font-bold text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
      <span>{oldUnit || "—"}</span>
      <i className="ph-bold ph-arrow-right text-[10px]" />
      <span>{newUnit || "—"}</span>
    </span>
  );
}

function UsageSection({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  if (!count) {
    return null;
  }
  return (
    <div className="mt-2">
      <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">
        {title} <span className="font-mono">({count})</span>
      </div>
      <div className="mt-1 space-y-0.5 text-xs text-zinc-600 dark:text-zinc-300">{children}</div>
    </div>
  );
}

function UsageLine({ left, right }: { left: string; right?: string | null }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="min-w-0 truncate">{left}</span>
      {right ? <span className="shrink-0 font-mono text-[11px] text-zinc-500">{right}</span> : null}
    </div>
  );
}

const USAGE_PREVIEW_LIMIT = 6;

function AlertUsage({ alert }: { alert: MaterialUnitAlert }) {
  const usage = alert.usage;
  if (!usage) {
    return null;
  }
  const totalPlaces =
    usage.catalog_rules_count + usage.bom_entries_count + usage.calculation_sheets_count + usage.study_groups_count;
  if (!totalPlaces) {
    return (
      <p className="mt-2 text-xs text-zinc-500">
        No hay cantidades especificadas para este material. Puedes resolver la alerta directamente.
      </p>
    );
  }
  return (
    <>
      <UsageSection title="Reglas de catálogo" count={usage.catalog_rules_count}>
        {usage.catalog_rules.slice(0, USAGE_PREVIEW_LIMIT).map((rule) => (
          <UsageLine
            key={rule.rule_id}
            left={rule.component_name}
            right={rule.unit_qty_per_unit !== null ? `${rule.unit_qty_per_unit} ${rule.unit || alert.old_unit || ""}`.trim() : null}
          />
        ))}
        {usage.catalog_rules_count > USAGE_PREVIEW_LIMIT ? (
          <div className="text-[11px] text-zinc-500">+{usage.catalog_rules_count - USAGE_PREVIEW_LIMIT} más</div>
        ) : null}
      </UsageSection>
      <UsageSection title="Cantidades en proyectos" count={usage.bom_entries_count}>
        {usage.bom_entries.slice(0, USAGE_PREVIEW_LIMIT).map((entry, index) => (
          <UsageLine
            key={`${entry.project_id}-${index}`}
            left={`${entry.project_name}${entry.instance_name ? ` · ${entry.instance_name}` : ""}${entry.subtype_name ? ` (${entry.subtype_name})` : ""}`}
            right={entry.quantity !== null ? `${entry.quantity} ${entry.unit || alert.old_unit || ""}`.trim() : null}
          />
        ))}
        {usage.bom_entries_count > USAGE_PREVIEW_LIMIT ? (
          <div className="text-[11px] text-zinc-500">+{usage.bom_entries_count - USAGE_PREVIEW_LIMIT} más</div>
        ) : null}
      </UsageSection>
      <UsageSection title="Hojas de cálculo" count={usage.calculation_sheets_count}>
        {usage.calculation_sheets.slice(0, USAGE_PREVIEW_LIMIT).map((sheet, index) => (
          <UsageLine key={`${sheet.project_id}-${index}`} left={`${sheet.project_name}${sheet.instance_name ? ` · ${sheet.instance_name}` : ""}`} />
        ))}
      </UsageSection>
      <UsageSection title="Grupos de estudio" count={usage.study_groups_count}>
        {usage.study_groups.map((group) => (
          <UsageLine
            key={group.group_id}
            left={group.group_name}
            right={`factor ${group.factor_to_study_unit}${group.study_unit ? ` → ${group.study_unit}` : ""}`}
          />
        ))}
      </UsageSection>
    </>
  );
}

export function UnitChangeAlertsButton({ currentUser }: { currentUser: SessionUser }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<MaterialUnitAlertsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resolvingId, setResolvingId] = useState<number | null>(null);
  const canResolve = canEditPage(currentUser, "catalog");

  async function loadAlerts(refresh = false) {
    try {
      setData(await api.getMaterialUnitAlerts({ refresh }));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudieron cargar las alertas de unidades.");
    }
  }

  useEffect(() => {
    void loadAlerts();
    const intervalId = window.setInterval(() => void loadAlerts(), POLL_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
  }, []);

  async function handleResolve(alert: MaterialUnitAlert) {
    const confirmed = window.confirm(
      `¿Confirmas que todas las cantidades de ${alert.sku} ya están expresadas en "${alert.new_unit || "—"}"?\n` +
        `La unidad de referencia pasará de "${alert.old_unit || "—"}" a "${alert.new_unit || "—"}".`,
    );
    if (!confirmed) {
      return;
    }
    setResolvingId(alert.id);
    try {
      await api.resolveMaterialUnitAlert(alert.id);
      await loadAlerts();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo resolver la alerta.");
    } finally {
      setResolvingId(null);
    }
  }

  const pending = data?.pending ?? [];
  if (!pending.length && !open) {
    // Stay invisible until there is something to deal with.
    return null;
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen((current) => !current);
          void loadAlerts();
        }}
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-lg border border-amber-500/40 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-300 dark:hover:bg-amber-500/20"
        aria-label="Cambios de unidad ERP pendientes"
        title="Cambios de unidad ERP pendientes"
      >
        <i className="ph-bold ph-warning" />
        {pending.length ? (
          <span className="absolute -right-1 -top-1 min-w-4 rounded-full bg-amber-500 px-1 text-[10px] font-bold text-zinc-950">
            {pending.length}
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="absolute right-0 top-11 z-50 w-[26rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-black/10 dark:border-white/10 bg-white shadow-xl dark:bg-zinc-900">
          <div className="flex items-center justify-between border-b border-black/10 dark:border-white/10 px-3 py-2">
            <div className="text-xs font-bold uppercase tracking-widest text-zinc-500">Cambios de unidad ERP</div>
            <div className="text-[10px] text-zinc-500">Revisión: {formatDate(data?.last_sweep_at)}</div>
          </div>
          {error ? <div className="px-3 py-2 text-xs text-red-700 dark:text-red-300">{error}</div> : null}
          <div className="max-h-[28rem] overflow-y-auto">
            {pending.length ? (
              pending.map((alert) => (
                <div key={alert.id} className="border-b border-black/5 px-3 py-3 last:border-b-0 dark:border-white/5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">{alert.material_name}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <span className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[11px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                          {alert.sku}
                        </span>
                        <UnitBadge oldUnit={alert.old_unit} newUnit={alert.new_unit} />
                      </div>
                    </div>
                    <div className="shrink-0 text-right text-[10px] text-zinc-500">{formatDate(alert.detected_at)}</div>
                  </div>
                  <AlertUsage alert={alert} />
                  {canResolve ? (
                    <button
                      type="button"
                      disabled={resolvingId === alert.id}
                      onClick={() => void handleResolve(alert)}
                      className="mt-3 w-full rounded-lg border border-amber-500/40 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 transition-colors hover:bg-amber-100 disabled:opacity-50 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-300 dark:hover:bg-amber-500/20"
                      title="Confirma que ya revisaste y actualizaste todas las cantidades de este material"
                    >
                      {resolvingId === alert.id ? "Resolviendo..." : "Cantidades revisadas — marcar como resuelto"}
                    </button>
                  ) : (
                    <p className="mt-2 text-[11px] text-zinc-500">
                      Solo usuarios con edición de catálogo pueden marcar la alerta como resuelta.
                    </p>
                  )}
                </div>
              ))
            ) : (
              <div className="px-3 py-4 text-sm text-zinc-500">No hay cambios de unidad pendientes.</div>
            )}
          </div>
          {data?.history.length ? (
            <details className="border-t border-black/10 dark:border-white/10">
              <summary className="cursor-pointer px-3 py-2 text-[11px] font-semibold text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">
                Historial de unidades ({data.history.length})
              </summary>
              <div className="max-h-48 overflow-y-auto px-3 pb-2">
                {data.history.map((item) => (
                  <div key={item.id} className="flex items-center justify-between gap-3 border-b border-black/5 py-1.5 text-xs last:border-b-0 dark:border-white/5">
                    <span className="min-w-0 truncate text-zinc-600 dark:text-zinc-300">
                      <span className="font-mono">{item.sku}</span> · {item.material_name}
                    </span>
                    <span className="flex shrink-0 items-center gap-2 text-zinc-500">
                      <UnitBadge oldUnit={item.old_unit} newUnit={item.new_unit} />
                      <span className="text-[10px]">{item.resolved_by || "auto"} · {formatDate(item.resolved_at)}</span>
                    </span>
                  </div>
                ))}
              </div>
            </details>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
