import { useEffect, useMemo, useRef, useState } from "react";
import { Check, FunnelSimple, Info, MagnifyingGlass } from "@phosphor-icons/react";

import { Modal } from "../../../components/Modal";
import { ApiError, api } from "../../../lib/api";
import type { ProductionHouseLink, ProductionHouseLinksBundle } from "../../../lib/types";
import type { HouseRange } from "../dates";
import { formatDate } from "../formatters";

export type HouseLinksModalTab = "links" | "starts";

type Props = {
  open: boolean;
  canEdit: boolean;
  range: HouseRange;
  initialTab: HouseLinksModalTab;
  onClose: () => void;
  onSaved: () => void;
};
type LifecycleFilter = "all" | "planned" | "started";
type MappingFilter = "all" | "unmapped" | "automatic" | "manual" | "legacy";

const CONTROL =
  "h-10 w-full rounded-lg border border-black/10 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500 disabled:opacity-50 dark:border-white/10 dark:bg-zinc-900 dark:text-white";
const SOURCE_LABEL = { manual: "Manual", automatic: "Automático", legacy: "Heredado" } as const;

function SelectionMark({ selected }: { selected: boolean }) {
  return (
    <span
      className={`flex h-5 w-5 items-center justify-center border ${
        selected
          ? "border-accent-500 bg-accent-500 text-zinc-950 dark:border-accent-400 dark:bg-accent-500 dark:text-zinc-950"
          : "border-black/20 bg-white text-transparent dark:border-white/25 dark:bg-zinc-900"
      }`}
    >
      <Check size={13} weight="bold" />
    </span>
  );
}

function LifecycleBadge({ house }: { house: ProductionHouseLink }) {
  const started = house.lifecycle_status === "started";
  return (
    <span
      className={`inline-flex border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] ${
        started
          ? "border-emerald-600/25 bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
          : "border-blue-600/25 bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300"
      }`}
    >
      {started ? "Iniciada" : "Planificada"}
    </span>
  );
}

function MappingBadge({ house }: { house: ProductionHouseLink }) {
  if (!house.mapped) {
    return (
      <div className="flex items-center gap-2 border-l-4 border-amber-500 bg-amber-50/80 px-3 py-2 dark:border-amber-400 dark:bg-amber-500/10">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-amber-500 ring-4 ring-amber-500/15" aria-hidden="true" />
        <span className="inline-flex border border-amber-500/45 bg-amber-100 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.1em] text-amber-800 dark:border-amber-400/35 dark:bg-amber-500/15 dark:text-amber-200">
          Sin vincular
        </span>
      </div>
    );
  }
  return (
    <div className="min-w-0 border-l-4 border-emerald-500 bg-emerald-50/80 px-3 py-2 dark:border-emerald-400 dark:bg-emerald-500/10">
      <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.1em] text-emerald-800 dark:text-emerald-200">Vinculada</div>
      <div className="truncate text-xs font-bold text-zinc-950 dark:text-white">
        {house.mapped_project_name || "Tipo sin nombre"}
        {house.mapped_project_subtype_name ? ` · ${house.mapped_project_subtype_name}` : " · General"}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        {house.mapping_source ? (
          <span
            title={SOURCE_LABEL[house.mapping_source]}
            aria-label={SOURCE_LABEL[house.mapping_source]}
            className={`inline-flex items-center text-zinc-400 transition-colors hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300 ${
              house.mapping_source === "manual"
                ? ""
                : house.mapping_source === "automatic"
                  ? "text-blue-500 dark:text-blue-400"
                  : "text-violet-500 dark:text-violet-400"
            }`}
          >
            <Info size={14} weight="bold" />
          </span>
        ) : null}
        {house.mapping_issue === "incomplete_bom" ? (
          <span className="text-[10px] font-medium text-amber-700 dark:text-amber-300">
            cubicación incompleta ({house.missing_quantity_count})
          </span>
        ) : null}
      </div>
    </div>
  );
}

function Metric({ value, label, tone = "" }: { value: number; label: string; tone?: string }) {
  return (
    <div className="min-w-[88px] border-l border-black/10 pl-3 first:border-l-0 first:pl-0 dark:border-white/10">
      <div className={`text-xl font-semibold tabular-nums ${tone || "text-zinc-900 dark:text-white"}`}>{value}</div>
      <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">{label}</div>
    </div>
  );
}

function searchText(house: ProductionHouseLink) {
  return [
    house.house_identifier,
    house.production_project_name,
    house.house_type_name,
    house.sub_type_name,
    house.mapped_project_name,
    house.mapped_project_subtype_name,
    house.work_order_id,
  ]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase("es");
}

export function HouseLinksModal({ open, canEdit, initialTab, onClose, onSaved }: Props) {
  const [bundle, setBundle] = useState<ProductionHouseLinksBundle | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [lifecycle, setLifecycle] = useState<LifecycleFilter>(initialTab === "starts" ? "started" : "all");
  const [mapping, setMapping] = useState<MappingFilter>("all");
  const [houseType, setHouseType] = useState<number | "all">("all");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [anchor, setAnchor] = useState<number | null>(null);
  const [projectId, setProjectId] = useState<number | null>(null);
  const [subtypeId, setSubtypeId] = useState<number | null>(null);
  const initialTabRef = useRef(initialTab);

  useEffect(() => {
    if (!open) return;
    if (initialTabRef.current !== initialTab) {
      initialTabRef.current = initialTab;
      setLifecycle(initialTab === "starts" ? "started" : "all");
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .getProductionHouseLinks()
      .then((response) => {
        if (!cancelled) {
          setBundle(response);
          setSelected(new Set());
          setAnchor(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "No se pudieron cargar las viviendas.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, initialTab]);

  const types = useMemo(() => {
    const values = new Map<number, string>();
    for (const house of bundle?.houses || []) values.set(house.house_type_id, house.house_type_name);
    return [...values.entries()].sort((a, b) => a[1].localeCompare(b[1], "es"));
  }, [bundle]);

  const houses = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("es");
    return (bundle?.houses || []).filter((house) => {
      if (lifecycle !== "all" && house.lifecycle_status !== lifecycle) return false;
      if (houseType !== "all" && house.house_type_id !== houseType) return false;
      if (mapping === "unmapped" && house.mapped) return false;
      if (mapping !== "all" && mapping !== "unmapped" && house.mapping_source !== mapping) return false;
      return !normalized || searchText(house).includes(normalized);
    });
  }, [bundle, houseType, lifecycle, mapping, query]);

  const visibleIds = houses.map((house) => house.work_order_id);
  const selectedVisible = visibleIds.filter((id) => selected.has(id)).length;
  const selectedProject = bundle?.projects.find((project) => project.id === projectId) || null;

  function selectRow(event: React.MouseEvent, id: number) {
    if (!canEdit || saving) return;
    if (event.shiftKey && anchor !== null) {
      const left = visibleIds.indexOf(anchor);
      const right = visibleIds.indexOf(id);
      if (left >= 0 && right >= 0) {
        event.preventDefault();
        setSelected((current) => {
          const next = new Set(current);
          visibleIds.slice(Math.min(left, right), Math.max(left, right) + 1).forEach((value) => next.add(value));
          return next;
        });
        return;
      }
    }
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      setSelected((current) => {
        const next = new Set(current);
        next.has(id) ? next.delete(id) : next.add(id);
        return next;
      });
    } else {
      setSelected(new Set([id]));
    }
    setAnchor(id);
  }

  function toggleVisible() {
    setSelected((current) => {
      const next = new Set(current);
      const remove = visibleIds.length > 0 && visibleIds.every((id) => next.has(id));
      visibleIds.forEach((id) => (remove ? next.delete(id) : next.add(id)));
      return next;
    });
    setAnchor(visibleIds[0] ?? null);
  }

  async function applyMapping(unmap = false) {
    if (!selected.size || (!unmap && projectId === null)) return;
    setSaving(true);
    setError(null);
    try {
      const response = await api.updateProductionHouseLinks({
        workOrderIds: [...selected],
        projectId: unmap ? null : projectId,
        projectSubtypeId: unmap ? null : subtypeId,
      });
      const updates = new Map(response.houses.map((house) => [house.work_order_id, house]));
      setBundle((current) => {
        if (!current) return current;
        const nextHouses = current.houses.map((house) => updates.get(house.work_order_id) || house);
        return {
          ...current,
          houses: nextHouses,
          mapped_houses: nextHouses.filter((house) => house.mapped).length,
          unmapped_houses: nextHouses.filter((house) => !house.mapped).length,
          automatic_houses: nextHouses.filter((house) => house.mapping_source === "automatic").length,
        };
      });
      setSelected(new Set());
      setAnchor(null);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo guardar la vinculación.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} kicker="Producción" title="Vinculación de viviendas" panelClassName="max-w-[min(96vw,1440px)]">
      <div className="flex min-h-0 flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-4 border-y border-black/10 py-3 dark:border-white/10">
          <div>
            <p className="max-w-3xl text-xs leading-5 text-zinc-600 dark:text-zinc-400">
              Cada vivienda se vincula por separado. El subtipo de Producción II se muestra como referencia y no limita el destino.
            </p>
            <p className="mt-1 text-[11px] text-zinc-500">
              Click selecciona una; Ctrl+click agrega o quita; Shift+click agrega un rango.
            </p>
          </div>
          {bundle ? (
            <div className="flex flex-wrap gap-4">
              <Metric value={bundle.total_houses} label="Total" />
              <Metric value={bundle.planned_houses} label="Planificadas" tone="text-blue-700 dark:text-blue-300" />
              <Metric value={bundle.started_houses} label="Iniciadas" tone="text-emerald-700 dark:text-emerald-300" />
              <Metric value={bundle.unmapped_houses} label="Sin vincular" tone="text-amber-700 dark:text-amber-300" />
            </div>
          ) : null}
        </div>

        {bundle?.production_error ? (
          <div className="border border-amber-500/30 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
            Se muestra la última copia sincronizada. Producción II respondió: {bundle.production_error}
          </div>
        ) : null}
        {error ? (
          <div className="border border-red-500/30 bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-500/10 dark:text-red-300">{error}</div>
        ) : null}

        <div className="grid min-h-0 gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
          <section className="min-w-0">
            <div className="grid gap-2 border border-black/10 bg-zinc-50 p-3 dark:border-white/10 dark:bg-white/[0.025] sm:grid-cols-2 xl:grid-cols-[minmax(220px,1fr)_170px_190px_190px]">
              <label className="relative">
                <MagnifyingGlass size={17} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
                <input value={query} onChange={(event) => setQuery(event.target.value)} className={`${CONTROL} pl-9`} placeholder="Buscar vivienda, proyecto o tipo" />
              </label>
              <select value={lifecycle} onChange={(event) => setLifecycle(event.target.value as LifecycleFilter)} className={CONTROL}>
                <option value="all">Planificadas e iniciadas</option>
                <option value="planned">Solo planificadas</option>
                <option value="started">Solo iniciadas</option>
              </select>
              <select value={mapping} onChange={(event) => setMapping(event.target.value as MappingFilter)} className={CONTROL}>
                <option value="all">Todos los vínculos</option>
                <option value="unmapped">Sin vincular</option>
                <option value="automatic">Automáticos</option>
                <option value="manual">Manuales</option>
                <option value="legacy">Heredados</option>
              </select>
              <select value={houseType} onChange={(event) => setHouseType(event.target.value === "all" ? "all" : Number(event.target.value))} className={CONTROL}>
                <option value="all">Todos los tipos de Producción II</option>
                {types.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
            </div>

            <div className="mt-2 flex justify-between text-[11px] text-zinc-500">
              <span>{houses.length} viviendas visibles</span>
              {selected.size ? <span>{selected.size} seleccionadas</span> : null}
            </div>

            <div className="mt-2 max-h-[56vh] overflow-auto border border-black/10 dark:border-white/10">
              <table className="w-full min-w-[900px] table-fixed text-left text-sm">
                <thead className="sticky top-0 z-10 bg-zinc-100 text-[10px] font-bold uppercase tracking-[0.12em] text-zinc-500 dark:bg-zinc-900">
                  <tr>
                    <th className="w-11 border-b border-r border-black/10 px-3 py-2 dark:border-white/10">
                      <button type="button" onClick={toggleVisible} disabled={!canEdit || !visibleIds.length} aria-label="Seleccionar visibles">
                        <SelectionMark selected={visibleIds.length > 0 && selectedVisible === visibleIds.length} />
                      </button>
                    </th>
                    <th className="w-[126px] border-b border-black/10 px-3 py-2 dark:border-white/10">Estado</th>
                    <th className="w-[165px] border-b border-black/10 px-3 py-2 dark:border-white/10">Vivienda</th>
                    <th className="w-[175px] border-b border-black/10 px-3 py-2 dark:border-white/10">Proyecto producción</th>
                    <th className="w-[210px] border-b border-black/10 px-3 py-2 dark:border-white/10">Tipo / subtipo origen</th>
                    <th className="border-b border-black/10 px-3 py-2 dark:border-white/10">Vínculo en esta aplicación</th>
                  </tr>
                </thead>
                <tbody>
                  {houses.map((house) => {
                    const isSelected = selected.has(house.work_order_id);
                    const date = house.start_date || house.planned_start_date;
                    return (
                      <tr
                        key={house.work_order_id}
                        onMouseDown={(event) => {
                          if (event.shiftKey || event.ctrlKey || event.metaKey) event.preventDefault();
                        }}
                        onClick={(event) => selectRow(event, house.work_order_id)}
                        className={`cursor-pointer select-none border-t border-black/5 dark:border-white/5 ${
                          isSelected
                            ? "bg-accent-500/20 ring-1 ring-inset ring-accent-500/60 dark:bg-accent-500/10 dark:ring-accent-400/50"
                            : house.mapped
                              ? "bg-emerald-50/35 hover:bg-emerald-50/70 dark:bg-emerald-500/[0.035] dark:hover:bg-emerald-500/[0.08]"
                            : house.lifecycle_status === "planned"
                              ? "bg-blue-50/30 hover:bg-blue-50/60 dark:bg-blue-500/[0.035]"
                              : "bg-white hover:bg-zinc-50 dark:bg-transparent dark:hover:bg-white/[0.035]"
                        }`}
                      >
                        <td className={`border-l-4 border-r px-3 py-2.5 dark:border-white/10 ${isSelected ? "border-l-accent-500 border-r-accent-500 dark:border-l-accent-400 dark:border-r-accent-400" : "border-l-transparent border-r-black/10"}`}>
                          <SelectionMark selected={isSelected} />
                        </td>
                        <td className="px-3 py-2.5">
                          <LifecycleBadge house={house} />
                          <div className="mt-1 text-[10px] tabular-nums text-zinc-500">{date ? formatDate(date) : "Sin fecha planificada"}</div>
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="truncate font-semibold text-zinc-900 dark:text-white">{house.house_identifier || `OT ${house.work_order_id}`}</div>
                          <div className="text-[10px] tabular-nums text-zinc-500">OT {house.work_order_id}</div>
                        </td>
                        <td className="px-3 py-2.5 text-xs text-zinc-600 dark:text-zinc-300"><div className="truncate">{house.production_project_name || "Sin proyecto"}</div></td>
                        <td className="px-3 py-2.5">
                          <div className="truncate text-xs font-semibold text-zinc-800 dark:text-zinc-200">{house.house_type_name}</div>
                          <div className="truncate text-[11px] text-zinc-500">Subtipo Producción II: {house.sub_type_name || "Sin subtipo"}</div>
                        </td>
                        <td className="border-l-2 border-black/5 px-3 py-2.5 dark:border-white/5"><MappingBadge house={house} /></td>
                      </tr>
                    );
                  })}
                  {!loading && !houses.length ? (
                    <tr><td colSpan={6} className="px-4 py-12 text-center text-sm text-zinc-500">No hay viviendas que coincidan con los filtros.</td></tr>
                  ) : null}
                </tbody>
              </table>
              {loading && !bundle ? <div className="py-12 text-center text-sm text-zinc-500">Sincronizando viviendas…</div> : null}
            </div>
          </section>

          <aside className="border border-black/10 bg-zinc-50 p-4 dark:border-white/10 dark:bg-white/[0.025]">
            <div className="flex items-center gap-2 text-zinc-900 dark:text-white"><FunnelSimple size={18} /><h3 className="text-sm font-semibold">Asignar selección</h3></div>
            <p className="mt-1 text-[11px] leading-4 text-zinc-500">La asignación manual reemplaza cualquier vínculo automático o heredado.</p>
            <div className="mt-5 text-3xl font-semibold tabular-nums text-zinc-900 dark:text-white">{selected.size}</div>
            <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-zinc-500">viviendas seleccionadas</div>

            <label className="mt-5 block text-[11px] font-semibold text-zinc-600 dark:text-zinc-300">
              Tipo
              <select value={projectId ?? ""} onChange={(event) => { setProjectId(event.target.value ? Number(event.target.value) : null); setSubtypeId(null); }} disabled={!canEdit || saving} className={`${CONTROL} mt-1`}>
                <option value="">Seleccionar tipo</option>
                {(bundle?.projects || []).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
              </select>
            </label>
            <label className="mt-3 block text-[11px] font-semibold text-zinc-600 dark:text-zinc-300">
              Subtipo opcional
              <select value={subtypeId ?? ""} onChange={(event) => setSubtypeId(event.target.value ? Number(event.target.value) : null)} disabled={!canEdit || saving || !selectedProject} className={`${CONTROL} mt-1`}>
                <option value="">General / sin subtipo</option>
                {(selectedProject?.subtypes || []).map((subtype) => <option key={subtype.id} value={subtype.id}>{subtype.name}</option>)}
              </select>
            </label>

            {!canEdit ? <p className="mt-4 text-[11px] text-zinc-500">No tienes permisos para editar.</p> : null}
            <button type="button" onClick={() => void applyMapping(false)} disabled={saving || !selected.size || projectId === null || !canEdit} className="mt-5 h-10 w-full bg-zinc-900 px-4 text-sm font-semibold text-white hover:bg-zinc-700 disabled:opacity-40 dark:bg-white dark:text-zinc-900">
              {saving ? "Guardando…" : "Asignar Tipo / Subtipo"}
            </button>
            <button type="button" onClick={() => void applyMapping(true)} disabled={saving || !selected.size || !canEdit} className="mt-2 h-9 w-full border border-black/10 px-3 text-xs font-semibold text-zinc-600 hover:text-zinc-900 disabled:opacity-40 dark:border-white/10 dark:text-zinc-300">
              Quitar vínculo
            </button>
            {selected.size ? <button type="button" onClick={() => { setSelected(new Set()); setAnchor(null); }} className="mt-2 w-full py-2 text-xs text-zinc-500">Limpiar selección</button> : null}

            <div className="mt-6 border-t border-black/10 pt-4 text-[10px] leading-4 text-zinc-500 dark:border-white/10">
              <p><span className="font-semibold text-zinc-700 dark:text-zinc-300">Automático:</span> nuevo trabajo cuyo tipo tiene un único destino confirmado en todo su historial.</p>
              <p className="mt-2"><span className="font-semibold text-zinc-700 dark:text-zinc-300">Heredado:</span> importado desde la antigua tabla y todavía no revisado manualmente.</p>
            </div>
          </aside>
        </div>
      </div>
    </Modal>
  );
}
