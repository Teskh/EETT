import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { GROUP_CATALOG_CACHE_KEY } from "../lib/materialDashboardCacheKeys";
import { canEditPage } from "../lib/pageAccess";
import type { MaterialStudyGroupRow, ProjectSummary, SessionUser } from "../lib/types";
import { belongsToScenario, buildBudgetLine, pendingSuggestions, projectMixAverage, sortBudgetLines, summarizeBudget, type BudgetSort } from "./costModel/budget";
import { BudgetRow } from "./costModel/BudgetRow";
import { BudgetEvidence } from "./costModel/BudgetEvidence";
import { CecoExclusionsModal } from "./costModel/CecoExclusionsModal";
import { ConsumptionTrend } from "./costModel/ConsumptionTrend";
import { ProductionTimeline } from "./costModel/ProductionTimeline";
import { UnbudgetedTable } from "./costModel/UnbudgetedTable";
import { SuggestionSettings, describeCriteria, useSuggestionCriteria } from "./costModel/SuggestionSettings";
import { GroupAnalysis } from "./costModel/GroupAnalysis";
import { useDashboardResource } from "./materialDashboard/useDashboardResource";
import { defaultRange, formatChange, formatMoney, studyWarnings } from "./costModel/format";
import { useCecoExclusions, useCostBudget, useCostExtras, useCostStudy, useCostTimeline, type BudgetSave } from "./costModel/useCostBudget";
import { exportCostBudget } from "./costModel/export";
import { buildExtraLines, includedExtrasPerHouse, type ExtraLine } from "./costModel/extras";

type Props = {
  projectId: number | null;
  onNavigate: (to: string, replace?: boolean) => void;
  onTitleChange?: (title: string) => void;
  currentUser: SessionUser;
};
type Range = { startDate: string; endDate: string };

const control = "border border-black/15 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-red-600 focus:ring-1 focus:ring-red-600 disabled:opacity-50 dark:border-white/15 dark:bg-zinc-900 dark:text-white";
const rangeStorageKey = (projectId: number) => `cost-model:range:${projectId}`;

function readStoredRange(projectId: number | null): Range | null {
  if (projectId === null) return null;
  try {
    const value = JSON.parse(window.localStorage.getItem(rangeStorageKey(projectId)) ?? "null");
    return value && typeof value.startDate === "string" && typeof value.endDate === "string" ? value : null;
  } catch {
    return null;
  }
}

export function CostModelPage({ projectId, onNavigate, onTitleChange, currentUser }: Props) {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [projectsRevision, setProjectsRevision] = useState(0);
  const [subtypeSelection, setSubtypeSelection] = useState<{ projectId: number; id: number } | null>(null);
  const [chosen, setChosen] = useState<{ projectId: number; range: Range } | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState<BudgetSort>("estimated_cost");
  const [view, setView] = useState<"budget" | "unbudgeted">("budget");
  const [inspectedKey, setInspectedKey] = useState<string | null>(null);
  const [trendKey, setTrendKey] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [exclusionsOpen, setExclusionsOpen] = useState(false);
  const [applying, setApplying] = useState<{ done: number; total: number } | null>(null);
  const [criteria, setCriteria] = useSuggestionCriteria();
  const [groupId, setGroupId] = useState<number | null>(null);
  // Material dashboard groups, shared cache with that page.
  const groupCatalog = useDashboardResource<MaterialStudyGroupRow[]>({
    cacheKey: GROUP_CATALOG_CACHE_KEY, enabled: true, fetcher: () => api.getMaterialStudyGroupCatalog(),
    errorMessage: "No se pudieron cargar los grupos de materiales.",
  });
  const groupsBySku = useMemo(() => {
    const map = new Map<string, MaterialStudyGroupRow[]>();
    for (const group of groupCatalog.data ?? []) for (const member of group.members) {
      const sku = member.sku.trim().toUpperCase();
      map.set(sku, [...(map.get(sku) ?? []), group]);
    }
    return map;
  }, [groupCatalog.data]);
  const openGroup = groupCatalog.data?.find((group) => group.group_id === groupId) ?? null;
  const budget = useCostBudget(projectId);
  const subtypes = budget.view?.flat_subtypes ?? [];
  const subtypeId = subtypeSelection?.projectId === projectId && subtypes.some((item) => item.id === subtypeSelection.id)
    ? subtypeSelection.id : subtypes[0]?.id ?? null;
  const subtypeName = subtypes.find((item) => item.id === subtypeId)?.name ?? "General";
  const canEdit = currentUser.permissions.project_edit && canEditPage(currentUser, "cost_model");
  const today = defaultRange().endDate;

  // Period: the one chosen for this project, else the suggested one, where
  // the project's houses dominate production.
  const timeline = useCostTimeline(projectId);
  const stored = useMemo(() => readStoredRange(projectId), [projectId]);
  const suggested = timeline.data?.suggested
    ? { startDate: timeline.data.suggested.start_date, endDate: timeline.data.suggested.end_date < today ? timeline.data.suggested.end_date : today } : null;
  const range = chosen?.projectId === projectId ? chosen.range : stored ?? suggested ?? defaultRange();
  const rangeReady = chosen?.projectId === projectId || stored !== null || timeline.data !== null || timeline.error !== null;
  const [draftRange, setDraftRange] = useState(range);
  useEffect(() => { setDraftRange(range); }, [range.startDate, range.endDate]);
  const setRange = (next: Range) => {
    if (projectId === null) return;
    setChosen({ projectId, range: next });
    try { window.localStorage.setItem(rangeStorageKey(projectId), JSON.stringify(next)); } catch { /* per-viewer convenience only */ }
  };

  const exclusions = useCecoExclusions();
  const study = useCostStudy(projectId, range, rangeReady ? exclusions.key : null);
  const extras = useCostExtras(projectId);
  const disabled = budget.saving !== null || exporting || applying !== null;

  useEffect(() => {
    let active = true;
    setProjectsError(null);
    api.getProjects().then((board) => {
      if (active) setProjects(Object.values(board.grouped_projects).flat().sort((a, b) => a.name.localeCompare(b.name, "es")));
    }).catch((err: Error) => { if (active) setProjectsError(err.message || "No se pudieron cargar los proyectos."); });
    return () => { active = false; };
  }, [projectsRevision]);

  useEffect(() => { onTitleChange?.(budget.view?.project.name ?? "Modelo de costos"); }, [budget.view?.project.name, onTitleChange]);
  useEffect(() => { setInspectedKey(null); setExportError(null); }, [projectId, subtypeId]);

  const bySku = useMemo(() => new Map(study.data?.materials.map((item) => [item.sku.trim().toUpperCase(), item])), [study.data]);
  const linesFor = (subtype: number | null) => (budget.view?.rows ?? []).filter((row) => belongsToScenario(row, subtype))
    .map((row) => buildBudgetLine(row, subtype, row.is_auxiliary ? null : bySku.get(row.sku.trim().toUpperCase()) ?? null, criteria));
  const lines = useMemo(() => linesFor(subtypeId), [budget.view, subtypeId, bySku, criteria]);
  const totals = useMemo(() => summarizeBudget(lines), [lines]);
  const extraLines = useMemo(() => buildExtraLines(study.data?.unbudgeted ?? [], extras.data), [study.data, extras.data]);
  // Included materials outside the BOM count in every subtype's budget per house.
  const extrasPerHouse = includedExtrasPerHouse(extraLines);
  const budgetPerHouse = totals.budget + extrasPerHouse;
  // The project's budget per house follows the mix actually produced in the period.
  const mixAverage = useMemo(() => {
    if (!study.data || !budget.view) return null;
    const perSubtype = (subtypes.length ? subtypes.map((item) => item.id) : [null]).map((id) => ({ subtypeId: id, budget: summarizeBudget(linesFor(id)).budget }));
    const average = projectMixAverage(perSubtype, study.data.houses.target_by_subtype);
    return average === null ? null : average + extrasPerHouse;
  }, [study.data, budget.view, bySku, extrasPerHouse]);
  const pending = useMemo(() => pendingSuggestions(lines), [lines]);
  const visible = useMemo(() => sortBudgetLines(lines.filter((line) => {
    const matches = `${line.row.sku} ${line.row.material_name}`.toLowerCase().includes(search.trim().toLowerCase());
    const suggestion = line.suggestion;
    return matches && (filter === "all" || filter === "adjusted" && line.source !== "estimated"
      || filter === "incomplete" && line.budgetCost === null || filter === "history" && line.historic !== null
      || filter === "suggested" && suggestion === "historic" || filter === "review" && suggestion === "review");
  }), sort), [lines, search, filter, sort]);
  const rowKey = (line: typeof lines[number]) => `${line.row.material_id ?? `aux:${line.row.subtypes.map((item) => item.subtype_id).join(",")}`}:${line.row.sku}`;
  const inspected = lines.find((line) => rowKey(line) === inspectedKey);
  const trend = visible.find((line) => rowKey(line) === trendKey && !line.row.is_auxiliary) ?? visible.find((line) => !line.row.is_auxiliary);
  useEffect(() => { if (trend) setTrendKey(rowKey(trend)); }, [trend?.row.material_id, trend?.row.sku]);
  const validRange = Boolean(draftRange.startDate && draftRange.endDate && draftRange.startDate <= draftRange.endDate && draftRange.endDate <= today);
  const rangeChanged = draftRange.startDate !== range.startDate || draftRange.endDate !== range.endDate;
  const grades = study.data ? study.data.materials.reduce((count, item) => ({ ...count, [item.grade]: (count[item.grade] ?? 0) + 1 }), {} as Record<string, number>) : null;
  const mixLabel = study.data?.houses.target_by_subtype.map((item) => `${subtypes.find((subtype) => subtype.id === item.subtype_id)?.name ?? "General"} ${item.houses}`).join(" · ");
  const studyWeeks = study.data?.materials[0]?.signals.weeks.length ?? 0;

  async function toggleExtra(line: ExtraLine) {
    await extras.upsert({
      sku: line.sku, included: !line.included, name: line.name, unit: line.unit,
      quantity_per_house: line.pinned ? line.quantityPerHouse : null, unit_cost: line.pinned ? line.unitCost : null,
      replaces_sku: line.replacesSku, source_range_start: line.decision?.source_range_start ?? null,
      source_range_end: line.decision?.source_range_end ?? null, note: line.decision?.note ?? null,
    });
  }

  // A replacement brings the new material in at its rate since the switch and
  // leaves the old one at its level after the switch, in every subtype. The
  // old material stays in the BOM, so earlier houses keep their history.
  async function adoptReplacement(line: ExtraLine, replacement: ExtraLine["replaces"][number]) {
    const previous = bySku.get(replacement.sku);
    const after = previous?.signals.stability?.ratio_after;
    if (replacement.quantity_per_house_since === null || after === undefined || !replacement.since_week) return;
    const note = `Reemplazado por ${line.sku} (${line.name}) desde la semana del ${replacement.since_week}.`;
    const message = [
      `${line.name} reemplaza a ${replacement.name} desde la semana del ${replacement.since_week}.`,
      `Se incluirá ${line.name} con ${replacement.quantity_per_house_since.toFixed(2)} ${line.unit || "un"}/viv. y ${replacement.name} quedará en su nivel posterior al cambio (×${after.toFixed(2)} de lo estimado) en todas las subtipologías. ¿Continuar?`,
    ].join("\n\n");
    if (!window.confirm(message)) return;
    if (!(await extras.upsert({
      sku: line.sku, included: true, name: line.name, unit: line.unit, quantity_per_house: replacement.quantity_per_house_since,
      unit_cost: line.unitCost, replaces_sku: replacement.sku, source_range_start: replacement.since_week, source_range_end: range.endDate, note,
    }))) return;
    const saves: BudgetSave[] = [];
    for (const id of subtypes.length ? subtypes.map((item) => item.id) : [null]) {
      const target = linesFor(id).find((candidate) => candidate.row.sku.trim().toUpperCase() === replacement.sku);
      if (target && target.estimate !== null) saves.push({ line: target, subtypeId: id, source: "manual", quantity: Math.round(target.estimate * after * 10000) / 10000, note });
    }
    if (saves.length) await budget.saveMany(saves, null);
  }

  async function applySuggestions() {
    const targets = [...pending];
    if (!targets.length || !window.confirm(`Se usará la cantidad histórica en ${targets.length} materiales de ${subtypeName}. ${describeCriteria(criteria)} ¿Continuar?`)) return;
    setApplying({ done: 0, total: targets.length });
    await budget.saveMany(targets.flatMap((line) => line.historic === null ? [] : [{ line, subtypeId, source: "historic_allocated" as const, quantity: line.historic }]), study.data);
    setApplying(null);
  }

  return (
    <section className="absolute inset-0 top-16 flex flex-col overflow-auto bg-white text-zinc-800 dark:bg-zinc-950 dark:text-zinc-200 xl:overflow-hidden">
      <div className="grid shrink-0 border-b border-black/10 dark:border-white/10 xl:grid-cols-[minmax(0,1fr)_minmax(420px,36%)]">
      <div className="flex min-w-0 flex-col">
      <header className="shrink-0 border-b border-black/10 px-4 py-2 dark:border-white/10 md:px-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <h1 className="sr-only">Modelo de costos</h1>
              <label htmlFor="budget-project" className="mb-1 block text-[10px] uppercase tracking-wider text-zinc-500">Proyecto</label>
              <select id="budget-project" className={`${control} w-[220px] max-w-full`} value={projectId ?? ""} disabled={disabled}
                onChange={(event) => onNavigate(event.target.value ? `/cost-model?project_id=${event.target.value}` : "/cost-model")}>
                <option value="">Seleccionar proyecto</option>
                {projectId !== null && !projects.some((project) => project.id === projectId) ? <option value={projectId}>{budget.view?.project.name ?? "Cargando proyecto…"}</option> : null}
                {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
              </select>
            </div>
            {budget.view ? <div>
              <label htmlFor="budget-subtype" className="mb-1 block text-[10px] uppercase tracking-wider text-zinc-500">Subtipología</label>
              <select id="budget-subtype" className={`${control} w-[160px] max-w-full`} value={subtypeId ?? "general"} disabled={disabled || !subtypes.length}
                onChange={(event) => { if (projectId !== null) setSubtypeSelection({ projectId, id: Number(event.target.value) }); }}>
                {!subtypes.length ? <option value="general">General</option> : subtypes.map((subtype) => <option key={subtype.id} value={subtype.id}>{subtype.name}</option>)}
              </select>
            </div> : null}
          </div>
          {budget.view && currentUser.permissions.cost_model_export ? <button type="button" className="border border-zinc-950 bg-zinc-950 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50 dark:border-white dark:bg-white dark:text-zinc-950" disabled={disabled}
            onClick={async () => {
              if (projectId === null) return;
              setExporting(true); setExportError(null);
              try {
                await exportCostBudget(projectId, extraLines.filter((line) => line.included).map((line) => ({
                  sku: line.sku, name: line.name, unit: line.unit, quantity_per_house: line.quantityPerHouse, unit_cost: line.unitCost,
                  value_per_house: line.valuePerHouse, replaces_sku: line.replacesSku,
                  origin: line.pinned ? `Fija${line.decision?.source_range_start ? ` desde ${line.decision.source_range_start}` : ""}` : `Período ${range.startDate} a ${range.endDate}`,
                })));
              } catch (err) { setExportError(err instanceof Error ? err.message : "No se pudo exportar."); }
              finally { setExporting(false); }
            }}>{exporting ? "Generando Excel…" : "Exportar Excel"}</button> : null}
        </div>
      </header>
      {budget.view ? <>
          <div className="grid shrink-0 grid-cols-2 border-b border-black/10 dark:border-white/10 sm:grid-cols-5" aria-label="Totales de la subtipología">
            <Total label="Estimado / vivienda" value={formatMoney(totals.estimated)} detail={totals.missingEstimate ? `Parcial · ${totals.missingEstimate} materiales incompletos` : `${lines.length} materiales`} />
            <Total label="Presupuesto / vivienda" value={formatMoney(budgetPerHouse)} detail={totals.missingBudget ? `Parcial · ${totals.missingBudget} materiales incompletos` : extrasPerHouse ? `Incluye ${formatMoney(extrasPerHouse)} fuera de presupuesto` : "Incluye materiales generales"} emphasis />
            <Total label="Cambio vs estimación" value={totals.missingEstimate || totals.missingBudget ? "—" : formatChange(budgetPerHouse - totals.estimated)} detail={`${totals.adjusted} materiales ajustados`} />
            <Total label="Fuera de presupuesto / viv." value={formatMoney(extrasPerHouse)}
              detail={`${extraLines.filter((line) => line.included).length} de ${extraLines.length} incluidos · por defecto ${extras.data?.default === "exclude" ? "excluir" : "incluir"}`}
              title="Materiales retirados que ningún presupuesto explica, incluidos en el presupuesto. Revísalos en «Fuera de presupuesto»." />
            <Total label="Proyecto / vivienda" value={mixAverage === null ? "—" : formatMoney(mixAverage)} detail={mixLabel ? `Mezcla del período: ${mixLabel}` : "Según la mezcla del período"}
              title="Presupuesto por vivienda del proyecto completo, ponderando cada subtipología por las viviendas que inició en el período." />
          </div>

          <details className="shrink-0 grow border-b border-black/10 bg-zinc-50 dark:border-white/10 dark:bg-white/[0.025]" open>
            <summary className="cursor-pointer px-4 py-2 text-xs font-medium md:px-6">Referencia histórica <span className="ml-2 font-normal text-zinc-500">{range.startDate} a {range.endDate}{study.loading ? " · Calculando…" : study.data
              ? ` · ${study.data.houses.target} viviendas del proyecto${study.data.houses.target_share !== null ? ` (${Math.round(study.data.houses.target_share * 100)}% de la producción)` : ""}` : ""}</span></summary>
            <div className="flex flex-wrap items-end gap-2 px-4 pb-2 md:px-6">
              <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); if (validRange) { setRange({ ...draftRange }); if (!rangeChanged) study.reload(); } }}>
                <label className="text-[10px] text-zinc-500">Desde<input aria-label="Inicio del histórico" className={`${control} ml-2 text-xs`} type="date" required value={draftRange.startDate} max={draftRange.endDate} disabled={disabled} onChange={(event) => setDraftRange({ ...draftRange, startDate: event.target.value })} /></label>
                <label className="text-[10px] text-zinc-500">Hasta<input aria-label="Fin del histórico" className={`${control} ml-2 text-xs`} type="date" required value={draftRange.endDate} min={draftRange.startDate} max={today} disabled={disabled} onChange={(event) => setDraftRange({ ...draftRange, endDate: event.target.value })} /></label>
                <button type="submit" disabled={disabled || !validRange || study.loading} className={`${control} text-xs`}>Consultar</button>
              </form>
              <button type="button" className={`${control} text-xs`} disabled={!timeline.data} onClick={() => setTimelineOpen(true)}>Elegir en la producción…</button>
              <button type="button" className={`${control} text-xs`} disabled={!exclusions.data} onClick={() => setExclusionsOpen(true)}>Centros de costo excluidos ({exclusions.data?.rules.length ?? "…"})</button>
            </div>
            {study.data ? <p className="px-4 pb-2 text-[11px] text-zinc-500 md:px-6">
              {mixLabel ? `Mezcla: ${mixLabel}. ` : ""}{study.data.houses.other_projects} viviendas de otros proyectos{study.data.houses.unmapped ? ` y ${study.data.houses.unmapped} sin vincular` : ""} en el período.
              {grades ? ` Confianza: ${grades.high ?? 0} alta · ${grades.medium ?? 0} media · ${grades.low ?? 0} baja.` : ""}
            </p> : null}
            {study.error ? <p role="alert" className="px-4 pb-3 text-xs text-red-700 dark:text-red-400 md:px-6">{study.error} <button onClick={study.reload} className="underline">Reintentar</button></p> : null}
            {study.data?.warnings.map((warning) => <p key={warning} className="px-4 pb-2 text-xs text-amber-800 dark:text-amber-400 md:px-6">{studyWarnings[warning] ?? warning}</p>)}
          </details>

          {/* The view toolbar closes the left column, so the chart beside it can use the full height. */}
          <div className="flex shrink-0 flex-wrap items-center gap-2 px-4 py-2 md:px-6">
            <div role="group" aria-label="Vista" className="flex">
              <button type="button" aria-pressed={view === "budget"} className={`${control} text-xs ${view === "budget" ? "bg-zinc-950 text-white dark:bg-white dark:text-zinc-950" : ""}`} onClick={() => setView("budget")}>Presupuesto</button>
              <button type="button" aria-pressed={view === "unbudgeted"} className={`${control} -ml-px text-xs ${view === "unbudgeted" ? "bg-zinc-950 text-white dark:bg-white dark:text-zinc-950" : ""}`} onClick={() => setView("unbudgeted")}>Fuera de presupuesto ({extraLines.length})</button>
            </div>
            {view === "unbudgeted" ? <label className="flex items-center gap-2 text-xs text-zinc-500" title="Criterio para los materiales que no has decidido. Cada material puede incluirse o excluirse a mano.">Por defecto
              <select className={`${control} text-xs`} value={extras.data?.default ?? "include"} disabled={!canEdit || disabled || !extras.data?.stored}
                onChange={(event) => void extras.setDefault(event.target.value as "include" | "exclude")}>
                <option value="include">Incluir</option><option value="exclude">Excluir</option>
              </select></label> : null}
            <input type="search" aria-label="Buscar material o SKU" placeholder="Buscar material o SKU…" title="Buscar material o SKU" value={search} onChange={(event) => setSearch(event.target.value)} className={`${control} min-w-[7rem] flex-1 basis-32 text-xs`} />
            {view === "unbudgeted" && extras.data && !extras.data.stored ? <span role="status" className="text-xs text-amber-800 dark:text-amber-400"
              title="Las tablas de decisiones no existen en la base. Ejecuta «alembic upgrade head» en Backend.">Solo lectura: falta aplicar la migración de la base</span>
              : view === "unbudgeted" && !canEdit ? <span className="text-xs text-zinc-500">Solo lectura: sin permiso de edición</span> : null}
            {view === "budget" ? <>
              <select aria-label="Filtrar materiales" className={`${control} text-xs`} value={filter} onChange={(event) => setFilter(event.target.value)}>
                <option value="all">Todos</option><option value="suggested">Sugeridos</option><option value="review">Por revisar</option><option value="history">Con histórica</option><option value="adjusted">Ajustados</option><option value="incomplete">Por completar</option>
              </select>
              <div className="flex">
                {canEdit ? <button type="button" className={`${control} text-xs`} disabled={disabled || !pending.length} onClick={() => void applySuggestions()}
                  title={`Usa la cantidad histórica en los materiales que cumplen: ${describeCriteria(criteria)}`}>
                  {applying ? `Aplicando ${applying.total}…` : `Aplicar sugerencias (${pending.length})`}</button> : null}
                <SuggestionSettings criteria={criteria} onChange={setCriteria} className={`${control} px-2 ${canEdit ? "" : "ml-px"}`} />
              </div>
              <select aria-label="Ordenar por" title="Ordenar por" className={`${control} text-xs`} value={sort} onChange={(event) => setSort(event.target.value as BudgetSort)}>
                <option value="estimated_cost">↓ Costo estimado</option><option value="impact">↓ Cambio vs est.</option><option value="budget_cost">↓ Costo presup.</option><option value="name">A–Z Nombre</option>
              </select>
            </> : null}
          </div>
      </> : null}
      </div>
      {trend ? <ConsumptionTrend sku={trend.row.sku} name={trend.row.material_name} unit={trend.row.unit}
        projectId={projectId} studyKey={exclusions.key} price={trend.row.price && trend.row.price > 0 ? trend.row.price : null}
        missingSubtypes={trend.row.subtypes.filter((entry) => entry.has_missing_quantity).map((entry) => entry.subtype_name)} range={range} disabled={disabled} onRangeChange={setRange} onDetails={() => setInspectedKey(rowKey(trend))} /> : null}
      </div>

      {projectsError ? <div role="alert" className="border-b border-red-200 bg-red-50 px-6 py-2 text-xs text-red-800 dark:bg-red-950/20 dark:text-red-300">{projectsError} <button onClick={() => setProjectsRevision((value) => value + 1)} className="underline">Reintentar</button></div> : null}
      {extras.error ? <div role="alert" className="border-b border-red-200 bg-red-50 px-6 py-2 text-xs text-red-800 dark:bg-red-950/20 dark:text-red-300">{extras.error}</div> : null}
      {budget.error || exportError ? <div role="alert" className="border-b border-red-200 bg-red-50 px-6 py-3 text-sm text-red-800 dark:bg-red-950/20 dark:text-red-300">{budget.error || exportError}{!budget.view ? <button className="ml-3 underline" onClick={budget.reload}>Reintentar</button> : null}</div> : null}
      {projectId === null ? <div className="m-auto p-8 text-center text-sm text-zinc-500">Selecciona un proyecto para revisar su presupuesto.</div>
        : budget.loading ? <div className="m-auto p-8 text-sm text-zinc-500" role="status">Cargando presupuesto…</div>
        : budget.view ? <>
          <div className="min-h-[300px] shrink-0 overflow-auto xl:min-h-0 xl:flex-1">
            {view === "unbudgeted" ? study.data || extraLines.length ? <UnbudgetedTable lines={extraLines} search={search} weeks={studyWeeks} canEdit={canEdit && Boolean(extras.data?.stored)} disabled={disabled}
                onToggle={(line) => void toggleExtra(line)} onReset={(line) => void extras.reset(line.sku)} onAdopt={(line, replacement) => void adoptReplacement(line, replacement)} />
              : <p className="p-12 text-center text-sm text-zinc-500" role="status">{study.loading ? "Calculando consumo del período…" : "Consulta un período para ver el consumo fuera de presupuesto."}</p>
            : <>
            <table className="w-full min-w-[1180px] text-xs">
              <thead className="sticky top-0 z-10 bg-zinc-100 text-[10px] text-zinc-500 dark:bg-zinc-900">
                <tr>{["Material", "Precio / un.", "Estimada / viv.", "Costo estimado", "Histórica / viv.", "Cambio vs est.", "Usar", "Presup. / viv.", "Costo presup."].map((label, index) => <th key={label} className={`border-b border-black/10 px-3 py-3 font-semibold dark:border-white/10 ${index === 0 || index === 6 ? "text-left" : "text-right"}`} title={label === "Cambio vs est." ? "Presupuesto menos estimado, en costo por vivienda: lo que cambia la fuente elegida (histórica o manual)." : label === "Usar" ? "Punto verde: se sugiere la histórica (diferencia relevante, confianza alta). Punto ámbar: por revisar." : undefined}>{label}</th>)}</tr>
              </thead>
              <tbody>{visible.map((line) => <BudgetRow key={`${projectId}:${subtypeId}:${rowKey(line)}`} line={line} canEdit={canEdit} disabled={disabled} saving={budget.saving !== null && budget.saving === line.row.material_id} historyLoading={study.loading}
                groups={groupsBySku.get(line.row.sku.trim().toUpperCase())} onGroup={setGroupId} selected={trend === line} onInspect={() => line.row.is_auxiliary ? setInspectedKey(rowKey(line)) : setTrendKey(rowKey(line))} onSave={(source, quantity) => budget.save(line, subtypeId, source, quantity, study.data)} />)}</tbody>
            </table>
            {!visible.length ? <p className="p-12 text-center text-sm text-zinc-500">{lines.length ? "No hay materiales que coincidan con estos filtros." : "Esta subtipología todavía no tiene materiales presupuestados."}</p> : null}
            </>}
          </div>
          <footer className="flex shrink-0 flex-wrap justify-between gap-2 border-t border-black/10 px-6 py-2 text-[10px] text-zinc-500 dark:border-white/10">
            {view === "budget" ? <><span>{visible.length} de {lines.length} materiales · Totales de toda la subtipología</span><span>Cambio vs est.: presupuesto menos estimado, por vivienda · en gris, lo que cambiaría usar la histórica</span></>
              : <><span>Retiros que ningún presupuesto del período explica · por vivienda que consumía</span><span>Adoptar un reemplazo incluye el material nuevo a su ritmo desde el cambio y deja el anterior en su nivel posterior</span></>}
          </footer>
        </> : null}
      {inspected ? <BudgetEvidence line={inspected} subtypeId={subtypeId} subtypeName={subtypeName} study={study.data} onClose={() => setInspectedKey(null)} /> : null}
      {timelineOpen && timeline.data && projectId !== null ? <ProductionTimeline timeline={timeline.data} projectId={projectId} projectName={budget.view?.project.name ?? ""} range={range}
        onClose={() => setTimelineOpen(false)} onApply={(next) => { setRange({ startDate: next.startDate, endDate: next.endDate < today ? next.endDate : today }); setTimelineOpen(false); }} /> : null}
      {openGroup ? <GroupAnalysis group={openGroup} lines={lines} subtypeName={subtypeName}
        unbudgeted={new Map(extraLines.map((line) => [line.sku.trim().toUpperCase(), { included: line.included, valuePerHouse: line.valuePerHouse }]))} range={range} disabled={disabled}
        onRangeChange={setRange} onClose={() => setGroupId(null)} /> : null}
      {exclusionsOpen && exclusions.data ? <CecoExclusionsModal exclusions={exclusions.data} canEdit={canEdit} onSave={exclusions.save} onClose={() => setExclusionsOpen(false)} /> : null}
    </section>
  );
}

function Total({ label, value, detail, emphasis = false, title }: { label: string; value: string; detail: string; emphasis?: boolean; title?: string }) {
  return <div title={title} className={`min-w-0 border-r border-black/10 px-4 py-2 dark:border-white/10 md:px-6 ${emphasis ? "bg-zinc-950 text-white dark:bg-white dark:text-zinc-950" : ""}`}>
    <p className={`truncate text-[10px] uppercase tracking-wider ${emphasis ? "opacity-60" : "text-zinc-500"}`}>{label}</p>
    <p className="mt-1 font-mono text-lg font-semibold tabular-nums">{value}</p>
    <p className={`mt-1 truncate text-[10px] ${emphasis ? "opacity-60" : "text-zinc-500"}`}>{detail}</p>
  </div>;
}
