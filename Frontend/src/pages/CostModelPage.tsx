import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { canEditPage } from "../lib/pageAccess";
import type { ProjectSummary, SessionUser } from "../lib/types";
import { belongsToScenario, buildBudgetLine, sortBudgetLines, summarizeBudget, type BudgetSort } from "./costModel/budget";
import { BudgetRow } from "./costModel/BudgetRow";
import { BudgetEvidence } from "./costModel/BudgetEvidence";
import { ConsumptionTrend } from "./costModel/ConsumptionTrend";
import { defaultRange, formatChange, formatMoney, historyReasons } from "./costModel/format";
import { useCostBudget, useCostHistory } from "./costModel/useCostBudget";
import { exportCostBudget } from "./costModel/export";

type Props = {
  projectId: number | null;
  onNavigate: (to: string, replace?: boolean) => void;
  onTitleChange?: (title: string) => void;
  currentUser: SessionUser;
};

const control = "border border-black/15 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-red-600 focus:ring-1 focus:ring-red-600 disabled:opacity-50 dark:border-white/15 dark:bg-zinc-900 dark:text-white";

export function CostModelPage({ projectId, onNavigate, onTitleChange, currentUser }: Props) {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [projectsRevision, setProjectsRevision] = useState(0);
  const [subtypeSelection, setSubtypeSelection] = useState<{ projectId: number; id: number } | null>(null);
  const [range, setRange] = useState(defaultRange);
  const [draftRange, setDraftRange] = useState(range);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState<BudgetSort>("estimated_cost");
  const [inspectedKey, setInspectedKey] = useState<string | null>(null);
  const [trendKey, setTrendKey] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const budget = useCostBudget(projectId);
  const subtypes = budget.view?.flat_subtypes ?? [];
  const subtypeId = subtypeSelection?.projectId === projectId && subtypes.some((item) => item.id === subtypeSelection.id)
    ? subtypeSelection.id : subtypes[0]?.id ?? null;
  const subtypeName = subtypes.find((item) => item.id === subtypeId)?.name ?? "General";
  const history = useCostHistory(budget.view?.project.id ?? null, subtypeId, range);
  const canEdit = currentUser.permissions.project_edit && canEditPage(currentUser, "cost_model");
  const disabled = budget.saving !== null || exporting;

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

  const lines = useMemo(() => {
    const bySku = new Map(history.data?.references.map((item) => [item.sku.trim().toUpperCase(), item]));
    return (budget.view?.rows ?? []).filter((row) => belongsToScenario(row, subtypeId))
      .map((row) => buildBudgetLine(row, subtypeId, row.is_auxiliary ? null : bySku.get(row.sku.trim().toUpperCase()) ?? null));
  }, [budget.view, subtypeId, history.data]);
  const totals = useMemo(() => summarizeBudget(lines), [lines]);
  const visible = useMemo(() => sortBudgetLines(lines.filter((line) => {
    const matches = `${line.row.sku} ${line.row.material_name}`.toLowerCase().includes(search.trim().toLowerCase());
    return matches && (filter === "all" || filter === "adjusted" && line.source !== "estimated"
      || filter === "review" && line.budgetCost === null || filter === "history" && line.reference?.quantity_per_house != null);
  }), sort), [lines, search, filter, sort]);
  const rowKey = (line: typeof lines[number]) => `${line.row.material_id ?? `aux:${line.row.subtypes.map((item) => item.subtype_id).join(",")}`}:${line.row.sku}`;
  const inspected = lines.find((line) => rowKey(line) === inspectedKey);
  const trend = visible.find((line) => rowKey(line) === trendKey && !line.row.is_auxiliary) ?? visible.find((line) => !line.row.is_auxiliary);
  useEffect(() => { if (trend) setTrendKey(rowKey(trend)); }, [trend?.row.material_id, trend?.row.sku]);
  const today = defaultRange().endDate;
  const validRange = Boolean(draftRange.startDate && draftRange.endDate && draftRange.startDate <= draftRange.endDate && draftRange.endDate <= today);
  const rangeChanged = draftRange.startDate !== range.startDate || draftRange.endDate !== range.endDate;

  return (
    <section className="absolute inset-0 top-16 flex flex-col overflow-auto bg-white text-zinc-800 dark:bg-zinc-950 dark:text-zinc-200 xl:overflow-hidden">
      <div className="grid shrink-0 border-b border-black/10 dark:border-white/10 xl:grid-cols-[minmax(0,1fr)_minmax(420px,36%)]">
      <div className="min-w-0">
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
              try { await exportCostBudget(projectId); } catch (err) { setExportError(err instanceof Error ? err.message : "No se pudo exportar."); }
              finally { setExporting(false); }
            }}>{exporting ? "Generando Excel…" : "Exportar Excel"}</button> : null}
        </div>
      </header>
      {budget.view ? <>
          <div className="grid shrink-0 grid-cols-2 border-b border-black/10 dark:border-white/10 sm:grid-cols-4" aria-label="Totales de la subtipología">
            <Total label="Estimado / vivienda" value={formatMoney(totals.estimated)} detail={totals.missingEstimate ? `Parcial · ${totals.missingEstimate} materiales incompletos` : `${lines.length} materiales`} />
            <Total label="Presupuesto / vivienda" value={formatMoney(totals.budget)} detail={totals.missingBudget ? `Parcial · ${totals.missingBudget} materiales incompletos` : "Incluye materiales generales"} emphasis />
            <Total label="Cambio vs estimación" value={totals.missingEstimate || totals.missingBudget ? "—" : formatChange(totals.budget - totals.estimated)} detail={`${totals.adjusted} materiales ajustados`} />
            <Total label="Por completar" value={String(totals.missingBudget)} detail="Materiales sin cantidad o precio" />
          </div>

          <details className="shrink-0 border-b border-black/10 bg-zinc-50 dark:border-white/10 dark:bg-white/[0.025]" open>
            <summary className="cursor-pointer px-4 py-2 text-xs font-medium md:px-6">Referencia histórica <span className="ml-2 font-normal text-zinc-500">{range.startDate} a {range.endDate}{history.loading ? " · Cargando…" : history.data ? ` · ${history.data.sample_houses} viviendas vinculadas` : ""}</span></summary>
            <div className="flex flex-wrap items-end justify-between gap-3 px-4 pb-3 md:px-6">
              <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); if (validRange) { setRange({ ...draftRange }); if (!rangeChanged) history.reload(); } }}>
                <label className="text-[10px] text-zinc-500">Desde<input aria-label="Inicio del histórico" className={`${control} ml-2 text-xs`} type="date" required value={draftRange.startDate} max={draftRange.endDate} disabled={disabled} onChange={(event) => setDraftRange({ ...draftRange, startDate: event.target.value })} /></label>
                <label className="text-[10px] text-zinc-500">Hasta<input aria-label="Fin del histórico" className={`${control} ml-2 text-xs`} type="date" required value={draftRange.endDate} min={draftRange.startDate} max={today} disabled={disabled} onChange={(event) => setDraftRange({ ...draftRange, endDate: event.target.value })} /></label>
                <button type="submit" disabled={disabled || !validRange || history.loading} className={`${control} text-xs`}>Consultar</button>
              </form>
            </div>
            {history.error ? <p role="alert" className="px-6 pb-3 text-xs text-red-700 dark:text-red-400">{history.error} <button onClick={history.reload} className="underline">Reintentar</button></p> : null}
            {history.data?.blocked_reason ? <p className="px-6 pb-3 text-xs text-amber-800 dark:text-amber-400">{historyReasons[history.data.blocked_reason]} {history.data.unmapped_houses ? `${history.data.unmapped_houses} sin vincular. ` : ""}{history.data.incomplete_houses ? `${history.data.incomplete_houses} con cantidades incompletas.` : ""}</p> : null}
            {history.data && !history.data.blocked_reason && history.data.unmapped_houses > 0 ? <p className="px-6 pb-3 text-xs text-amber-800 dark:text-amber-400">{history.data.unmapped_houses} de {history.data.total_houses} viviendas del período no están vinculadas. Su consumo se reparte entre las vinculadas, por lo que la referencia puede quedar levemente alta.</p> : null}
            {history.data && !history.data.blocked_reason && history.data.incomplete_houses > 0 ? <p className="px-6 pb-3 text-xs text-amber-800 dark:text-amber-400">Hay cantidades sin definir en {history.data.incomplete_houses} viviendas. Las referencias se muestran solo para materiales con una base completa.</p> : null}
          </details>

      </> : null}
      </div>
      {trend ? <ConsumptionTrend sku={trend.row.sku} name={trend.row.material_name} unit={trend.row.unit} range={range} disabled={disabled} onRangeChange={(next) => { setRange(next); setDraftRange(next); }} onDetails={() => setInspectedKey(rowKey(trend))} /> : null}
      </div>

      {projectsError ? <div role="alert" className="border-b border-red-200 bg-red-50 px-6 py-2 text-xs text-red-800 dark:bg-red-950/20 dark:text-red-300">{projectsError} <button onClick={() => setProjectsRevision((value) => value + 1)} className="underline">Reintentar</button></div> : null}
      {budget.error || exportError ? <div role="alert" className="border-b border-red-200 bg-red-50 px-6 py-3 text-sm text-red-800 dark:bg-red-950/20 dark:text-red-300">{budget.error || exportError}{!budget.view ? <button className="ml-3 underline" onClick={budget.reload}>Reintentar</button> : null}</div> : null}
      {projectId === null ? <div className="m-auto p-8 text-center text-sm text-zinc-500">Selecciona un proyecto para revisar su presupuesto.</div>
        : budget.loading ? <div className="m-auto p-8 text-sm text-zinc-500" role="status">Cargando presupuesto…</div>
        : budget.view ? <>
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-black/10 px-4 py-2 dark:border-white/10 md:px-6">
            <input type="search" aria-label="Buscar material o SKU" placeholder="Buscar material o SKU" value={search} onChange={(event) => setSearch(event.target.value)} className={`${control} w-56 text-xs`} />
            <select aria-label="Filtrar materiales" className={`${control} text-xs`} value={filter} onChange={(event) => setFilter(event.target.value)}>
              <option value="all">Todos los materiales</option><option value="history">Con referencia histórica</option><option value="adjusted">Ajustados</option><option value="review">Por completar</option>
            </select>
            <label className="flex items-center gap-2 text-xs text-zinc-500 sm:ml-auto">Ordenar por
              <select className={`${control} text-xs`} value={sort} onChange={(event) => setSort(event.target.value as BudgetSort)}>
                <option value="estimated_cost">Mayor costo estimado</option><option value="impact">Mayor impacto del histórico</option><option value="budget_cost">Mayor costo presupuestado</option><option value="name">Nombre</option>
              </select>
            </label>
          </div>

          <div className="min-h-[300px] shrink-0 overflow-auto xl:min-h-0 xl:flex-1">
            <table className="w-full min-w-[1180px] text-xs">
              <thead className="sticky top-0 z-10 bg-zinc-100 text-[10px] text-zinc-500 dark:bg-zinc-900">
                <tr>{["Material", "Precio / un.", "Estimada / viv.", "Costo estimado", "Histórica / viv.", "Impacto histórico", "Usar", "Presup. / viv.", "Costo presup."].map((label, index) => <th key={label} className={`border-b border-black/10 px-3 py-3 font-semibold dark:border-white/10 ${index === 0 || index === 6 ? "text-left" : "text-right"}`} title={label === "Impacto histórico" ? "Cambio en costo por vivienda si adoptas la referencia histórica, respecto al presupuesto actual. Ordenado por magnitud, incluye aumentos y ahorros." : undefined}>{label}</th>)}</tr>
              </thead>
              <tbody>{visible.map((line) => <BudgetRow key={`${projectId}:${subtypeId}:${rowKey(line)}`} line={line} canEdit={canEdit} disabled={disabled} saving={budget.saving !== null && budget.saving === line.row.material_id} historyLoading={history.loading}
                selected={trend === line} onInspect={() => line.row.is_auxiliary ? setInspectedKey(rowKey(line)) : setTrendKey(rowKey(line))} onSave={(source, quantity) => budget.save(line, subtypeId, source, quantity, history.data)} />)}</tbody>
            </table>
            {!visible.length ? <p className="p-12 text-center text-sm text-zinc-500">{lines.length ? "No hay materiales que coincidan con estos filtros." : "Esta subtipología todavía no tiene materiales presupuestados."}</p> : null}
          </div>
          <footer className="flex shrink-0 flex-wrap justify-between gap-2 border-t border-black/10 px-6 py-2 text-[10px] text-zinc-500 dark:border-white/10">
            <span>{visible.length} de {lines.length} materiales · Totales de toda la subtipología</span><span>Impacto histórico: cambio por vivienda al adoptar la referencia</span>
          </footer>
        </> : null}
      {inspected ? <BudgetEvidence line={inspected} subtypeId={subtypeId} subtypeName={subtypeName} history={history.data} onClose={() => setInspectedKey(null)} /> : null}
    </section>
  );
}

function Total({ label, value, detail, emphasis = false }: { label: string; value: string; detail: string; emphasis?: boolean }) {
  return <div className={`min-w-0 border-r border-black/10 px-4 py-2 dark:border-white/10 md:px-6 ${emphasis ? "bg-zinc-950 text-white dark:bg-white dark:text-zinc-950" : ""}`}>
    <p className={`text-[10px] uppercase tracking-wider ${emphasis ? "opacity-60" : "text-zinc-500"}`}>{label}</p>
    <p className="mt-1 font-mono text-lg font-semibold tabular-nums">{value}</p>
    <p className={`mt-1 text-[10px] ${emphasis ? "opacity-60" : "text-zinc-500"}`}>{detail}</p>
  </div>;
}
