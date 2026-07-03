import { useEffect, useMemo, useState } from "react";

import { Modal } from "../../../components/Modal";
import { ApiError, api } from "../../../lib/api";
import type {
  HouseTypeLink,
  HouseTypeLinkPayload,
  HouseTypeLinksBundle,
  LinkTargetProject,
  MaterialDashboardHouseType,
  ProductionHouseStartsData,
} from "../../../lib/types";
import type { HouseRange } from "../dates";
import { formatDate } from "../formatters";

export type HouseLinksModalTab = "links" | "starts";

type HouseLinksModalProps = {
  open: boolean;
  canEdit: boolean;
  range: HouseRange;
  initialTab: HouseLinksModalTab;
  onClose: () => void;
  onSaved: () => void;
};

type DraftTarget = {
  projectId: number | null;
  projectSubtypeId: number | null;
};

const SELECT_CLASSES =
  "w-full rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-zinc-900 px-2 py-1.5 text-sm text-zinc-900 dark:text-white outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500 transition-colors disabled:opacity-60";

function draftKey(houseTypeId: number, subTypeId: number | null) {
  return `${houseTypeId}:${subTypeId ?? "general"}`;
}

function buildDraftFromLinks(links: HouseTypeLink[]) {
  const draft = new Map<string, DraftTarget>();
  for (const link of links) {
    draft.set(draftKey(link.production_house_type_id, link.production_sub_type_id), {
      projectId: link.project_id,
      projectSubtypeId: link.project_subtype_id,
    });
  }
  return draft;
}

function LinkTargetSelects({
  target,
  projects,
  disabled,
  onChange,
}: {
  target: DraftTarget;
  projects: LinkTargetProject[];
  disabled: boolean;
  onChange: (next: DraftTarget) => void;
}) {
  const selectedProject = projects.find((project) => project.id === target.projectId) || null;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 min-w-0">
      <select
        value={target.projectId ?? ""}
        disabled={disabled}
        onChange={(event) => {
          const projectId = event.target.value ? Number(event.target.value) : null;
          onChange({ projectId, projectSubtypeId: null });
        }}
        className={SELECT_CLASSES}
      >
        <option value="">Sin vincular</option>
        {projects.map((project) => (
          <option key={project.id} value={project.id}>
            {project.name}
          </option>
        ))}
      </select>
      <select
        value={target.projectSubtypeId ?? ""}
        disabled={disabled || !selectedProject || !selectedProject.subtypes.length}
        onChange={(event) =>
          onChange({
            projectId: target.projectId,
            projectSubtypeId: event.target.value ? Number(event.target.value) : null,
          })
        }
        className={SELECT_CLASSES}
      >
        <option value="">General</option>
        {(selectedProject?.subtypes || []).map((subtype) => (
          <option key={subtype.id} value={subtype.id}>
            {subtype.name}
          </option>
        ))}
      </select>
    </div>
  );
}

function HouseTypeLinkRows({
  houseType,
  draft,
  projects,
  disabled,
  onChangeTarget,
}: {
  houseType: MaterialDashboardHouseType;
  draft: Map<string, DraftTarget>;
  projects: LinkTargetProject[];
  disabled: boolean;
  onChangeTarget: (houseTypeId: number, subTypeId: number | null, next: DraftTarget) => void;
}) {
  const generalTarget = draft.get(draftKey(houseType.id, null)) || { projectId: null, projectSubtypeId: null };
  const subTypes = houseType.sub_types || [];
  return (
    <div className="rounded-xl border border-black/10 dark:border-white/10 overflow-hidden">
      <div className="grid grid-cols-1 md:grid-cols-[minmax(0,220px)_1fr] items-center gap-2 px-4 py-3 bg-zinc-50/80 dark:bg-white/[0.03]">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-zinc-900 dark:text-white truncate">{houseType.name}</div>
          <div className="text-[11px] text-zinc-500">General (aplica a subtipos sin vínculo propio)</div>
        </div>
        <LinkTargetSelects
          target={generalTarget}
          projects={projects}
          disabled={disabled}
          onChange={(next) => onChangeTarget(houseType.id, null, next)}
        />
      </div>
      {subTypes.map((subType) => {
        const target = draft.get(draftKey(houseType.id, subType.id)) || { projectId: null, projectSubtypeId: null };
        return (
          <div
            key={subType.id}
            className="grid grid-cols-1 md:grid-cols-[minmax(0,220px)_1fr] items-center gap-2 px-4 py-2.5 border-t border-black/5 dark:border-white/5"
          >
            <div className="min-w-0 pl-4">
              <div className="text-sm text-zinc-700 dark:text-zinc-300 truncate">
                <span className="text-zinc-400 mr-1.5">↳</span>
                {subType.name}
              </div>
              {!target.projectId ? <div className="text-[11px] text-zinc-400 pl-5">Hereda el vínculo general</div> : null}
            </div>
            <LinkTargetSelects
              target={target}
              projects={projects}
              disabled={disabled}
              onChange={(next) => onChangeTarget(houseType.id, subType.id, next)}
            />
          </div>
        );
      })}
    </div>
  );
}

function ProductionStartsTable({ range }: { range: HouseRange }) {
  const [data, setData] = useState<ProductionHouseStartsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .getProductionHouseStarts(range)
      .then((response) => {
        if (!cancelled) {
          setData(response);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "No se pudieron cargar los inicios de vivienda.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [range.startDate, range.endDate]);

  if (loading && !data) {
    return <div className="py-10 text-center text-sm text-zinc-500">Cargando inicios de vivienda…</div>;
  }
  if (error) {
    return <div className="py-10 text-center text-sm text-red-600 dark:text-red-400">{error}</div>;
  }
  if (!data) {
    return null;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
        <span>
          {formatDate(data.range_start)} – {formatDate(data.range_end)}
        </span>
        <span className="rounded-full bg-zinc-100 dark:bg-white/10 px-2 py-0.5 font-medium text-zinc-700 dark:text-zinc-300">
          {data.total_house_starts} inicios
        </span>
        <span className="rounded-full bg-emerald-50 dark:bg-emerald-500/10 px-2 py-0.5 font-medium text-emerald-700 dark:text-emerald-300">
          {data.mapped_house_starts} vinculados
        </span>
        {data.unmapped_house_starts > 0 ? (
          <span className="rounded-full bg-amber-50 dark:bg-amber-500/10 px-2 py-0.5 font-medium text-amber-700 dark:text-amber-300">
            ⚠ {data.unmapped_house_starts} sin vincular
          </span>
        ) : null}
      </div>
      {data.unmapped_house_starts > 0 ? (
        <p className="text-[11px] leading-4 text-amber-700 dark:text-amber-400">
          Las viviendas sin vincular cuentan como inicios pero no aportan consumo estimado, por lo que la comparación contra el
          consumo real queda incompleta hasta vincularlas.
        </p>
      ) : null}
      <div className="overflow-x-auto rounded-xl border border-black/10 dark:border-white/10">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-zinc-50/80 dark:bg-white/[0.03] text-left text-[11px] uppercase tracking-wider text-zinc-500">
              <th className="px-3 py-2 font-semibold">Inicio</th>
              <th className="px-3 py-2 font-semibold">Vivienda</th>
              <th className="px-3 py-2 font-semibold">Tipo / Subtipo</th>
              <th className="px-3 py-2 font-semibold">Vínculo</th>
            </tr>
          </thead>
          <tbody>
            {data.houses.map((house) => (
              <tr key={house.work_order_id} className="border-t border-black/5 dark:border-white/5">
                <td className="px-3 py-2 whitespace-nowrap text-zinc-600 dark:text-zinc-300">{formatDate(house.start_date)}</td>
                <td className="px-3 py-2 min-w-[140px]">
                  <div className="text-zinc-900 dark:text-white">{house.house_identifier || `OT ${house.work_order_id}`}</div>
                  <div className="text-[11px] text-zinc-500">{house.production_project_name}</div>
                </td>
                <td className="px-3 py-2 text-zinc-700 dark:text-zinc-300">
                  {house.house_type_name}
                  {house.sub_type_name ? <span className="text-zinc-500"> · {house.sub_type_name}</span> : null}
                </td>
                <td className="px-3 py-2">
                  {house.mapped ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 dark:bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
                      {house.mapped_project_name}
                      {house.mapped_project_subtype_name ? ` · ${house.mapped_project_subtype_name}` : ""}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 dark:bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                      ⚠ Sin vincular
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {!data.houses.length ? (
              <tr>
                <td colSpan={4} className="px-3 py-8 text-center text-sm text-zinc-500">
                  No hubo inicios de vivienda en el rango seleccionado.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function HouseLinksModal({ open, canEdit, range, initialTab, onClose, onSaved }: HouseLinksModalProps) {
  const [tab, setTab] = useState<HouseLinksModalTab>(initialTab);
  const [bundle, setBundle] = useState<HouseTypeLinksBundle | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Map<string, DraftTarget>>(new Map());

  useEffect(() => {
    if (open) {
      setTab(initialTab);
    }
  }, [open, initialTab]);

  useEffect(() => {
    if (!open) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .getHouseTypeLinks()
      .then((response) => {
        if (!cancelled) {
          setBundle(response);
          setDraft(buildDraftFromLinks(response.links));
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "No se pudo cargar la vinculación de viviendas.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const isDirty = useMemo(() => {
    if (!bundle) {
      return false;
    }
    const original = buildDraftFromLinks(bundle.links);
    if (original.size !== [...draft.values()].filter((target) => target.projectId !== null).length) {
      return true;
    }
    for (const [key, target] of draft) {
      if (target.projectId === null) {
        if (original.has(key)) {
          return true;
        }
        continue;
      }
      const existing = original.get(key);
      if (!existing || existing.projectId !== target.projectId || existing.projectSubtypeId !== target.projectSubtypeId) {
        return true;
      }
    }
    return false;
  }, [bundle, draft]);

  function handleChangeTarget(houseTypeId: number, subTypeId: number | null, next: DraftTarget) {
    setDraft((current) => {
      const updated = new Map(current);
      updated.set(draftKey(houseTypeId, subTypeId), next);
      return updated;
    });
  }

  async function handleSave() {
    if (!bundle) {
      return;
    }
    const houseTypeById = new Map(bundle.house_types.map((houseType) => [houseType.id, houseType]));
    const links: HouseTypeLinkPayload[] = [];
    for (const [key, target] of draft) {
      if (target.projectId === null) {
        continue;
      }
      const [houseTypeIdRaw, subTypeRaw] = key.split(":");
      const houseTypeId = Number(houseTypeIdRaw);
      const subTypeId = subTypeRaw === "general" ? null : Number(subTypeRaw);
      const houseType = houseTypeById.get(houseTypeId);
      const subType = subTypeId !== null ? (houseType?.sub_types || []).find((item) => item.id === subTypeId) : null;
      links.push({
        production_house_type_id: houseTypeId,
        production_sub_type_id: subTypeId,
        production_house_type_name: houseType?.name || "",
        production_sub_type_name: subType?.name || null,
        project_id: target.projectId,
        project_subtype_id: target.projectSubtypeId,
      });
    }
    setSaving(true);
    setError(null);
    try {
      const response = await api.updateHouseTypeLinks(links);
      setBundle(response);
      setDraft(buildDraftFromLinks(response.links));
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo guardar la vinculación.");
    } finally {
      setSaving(false);
    }
  }

  const tabButton = (value: HouseLinksModalTab, label: string) => (
    <button
      type="button"
      onClick={() => setTab(value)}
      className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
        tab === value
          ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"
          : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
      }`}
    >
      {label}
    </button>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      kicker="Producción"
      title="Vinculación de viviendas"
      panelClassName="max-w-4xl"
    >
      <div className="space-y-4">
        <p className="text-xs leading-5 text-zinc-500">
          Vincula cada tipo de vivienda de producción con el proyecto (y subtipo) cuyas cantidades estimadas describen su consumo.
          El consumo esperado de una vivienda con subtipo suma las cantidades generales del proyecto más las de su subtipo. La
          vinculación es global: todos los usuarios ven y usan la misma tabla.
        </p>
        <div className="inline-flex items-center gap-1 rounded-full border border-black/10 dark:border-white/10 bg-zinc-50 dark:bg-white/[0.04] p-1">
          {tabButton("links", "Vinculación")}
          {tabButton("starts", "Inicios en rango")}
        </div>

        {tab === "links" ? (
          loading && !bundle ? (
            <div className="py-10 text-center text-sm text-zinc-500">Cargando vinculación…</div>
          ) : (
            <div className="space-y-3">
              {bundle?.production_error ? (
                <div className="rounded-xl border border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
                  No se pudieron cargar los tipos de vivienda de Producción II: {bundle.production_error}
                </div>
              ) : null}
              {error ? (
                <div className="rounded-xl border border-red-500/30 bg-red-50 dark:bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-300">
                  {error}
                </div>
              ) : null}
              {!canEdit ? (
                <p className="text-[11px] text-zinc-500">No tienes permisos de edición; la vinculación se muestra en modo lectura.</p>
              ) : null}
              <div className="space-y-3 max-h-[52vh] overflow-y-auto pr-1">
                {(bundle?.house_types || []).map((houseType) => (
                  <HouseTypeLinkRows
                    key={houseType.id}
                    houseType={houseType}
                    draft={draft}
                    projects={bundle?.projects || []}
                    disabled={!canEdit || saving}
                    onChangeTarget={handleChangeTarget}
                  />
                ))}
                {bundle && !bundle.house_types.length && !bundle.production_error ? (
                  <div className="py-8 text-center text-sm text-zinc-500">Producción II no tiene tipos de vivienda.</div>
                ) : null}
              </div>
              {canEdit ? (
                <div className="flex items-center justify-end gap-3 border-t border-black/10 dark:border-white/10 pt-4">
                  {isDirty ? <span className="text-[11px] text-amber-600 dark:text-amber-400">Cambios sin guardar</span> : null}
                  <button
                    type="button"
                    onClick={() => void handleSave()}
                    disabled={saving || !isDirty}
                    className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
                  >
                    {saving ? "Guardando…" : "Guardar vinculación"}
                  </button>
                </div>
              ) : null}
            </div>
          )
        ) : (
          <ProductionStartsTable range={range} />
        )}
      </div>
    </Modal>
  );
}
