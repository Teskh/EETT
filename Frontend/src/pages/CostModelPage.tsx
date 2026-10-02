import { useEffect, useMemo, useState } from "react";
import { MaterialStudyGroupEditor } from "../components/MaterialStudyGroupEditor";
import { api } from "../lib/api";
import { GROUP_CATALOG_CACHE_KEY } from "../lib/materialDashboardCacheKeys";
import { canEditPage } from "../lib/pageAccess";
import type { MaterialStudyGroupRow, ProjectSummary, QuantityBasis, SessionUser } from "../lib/types";
import { belongsToScenario, buildBudgetLine, pendingSuggestions, type BudgetLine, type BudgetSource, projectMixAverage, sortBudgetLines, summarizeBudget, type BudgetSort } from "./costModel/budget";
import { BudgetRow } from "./costModel/BudgetRow";
import { BudgetEvidence } from "./costModel/BudgetEvidence";
import { CecoExclusionsModal } from "./costModel/CecoExclusionsModal";
import { ConsumptionTrend } from "./costModel/ConsumptionTrend";
import { ProductionTimeline } from "./costModel/ProductionTimeline";
import { UnbudgetedTable } from "./costModel/UnbudgetedTable";
import { SuggestionSettings, describeCriteria, useSuggestionCriteria } from "./costModel/SuggestionSettings";
import { GroupAnalysis } from "./costModel/GroupAnalysis";
import { applyGroupValidation, validateGroups } from "./costModel/groupValidation";
import { SubtypePicker } from "./costModel/SubtypePicker";
import { buildScopeLine, scopeSaves, scopeWeights } from "./costModel/scope";
import { dashboardExclusions } from "./costModel/studySeries";
import { useDashboardResource } from "./materialDashboard/useDashboardResource";
import { basisDescriptions, basisLabels, defaultRange, formatChange, formatMoney, sourceLabels, studyWarnings } from "./costModel/format";
import { useCecoExclusions, useCostBudget, useCostExtras, useCostStudy, useCostTimeline, type BudgetSave } from "./costModel/useCostBudget";
import { buildCostExport, exportCostBudget } from "./costModel/export";
import { buildExtraLines, includedExtrasPerHouse, type ExtraLine } from "./costModel/extras";

type Props = {
  projectId: number | null;
  onNavigate: (to: string, replace?: boolean) => void;
  onTitleChange?: (title: string) => void;
  currentUser: SessionUser;
};
type Range = { startDate: string; endDate: string };

const control = "border border-black/15 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-red-600 focus:ring-1 focus:ring-red-600 disabled:opacity-50 dark:border-white/15 dark:bg-zinc-900 dark:text-white";
/** A segmented-control button. Colors are exclusive: appending active colors to `control` loses to its text color. */
const segment = (active: boolean) => `border border-black/15 px-3 py-2 text-xs outline-none focus:border-red-600 focus:ring-1 focus:ring-red-600 disabled:opacity-50 dark:border-white/15 ${active
  ? "bg-zinc-950 text-white dark:bg-white dark:text-zinc-950"
  : "bg-white text-zinc-900 hover:bg-black/5 dark:bg-zinc-900 dark:text-white dark:hover:bg-white/5"}`;
const rangeStorageKey = (projectId: number) => `cost-model:range:${projectId}`;
const subtypesStorageKey = (projectId: number) => `cost-model:subtypes:${projectId}`;
const basisStorageKey = "cost-model:basis";
const BASES: QuantityBasis[] = ["factory", "work", "total"];

function readStoredBasis(): QuantityBasis {
  try {
    const value = window.localStorage.getItem(basisStorageKey);
    return BASES.includes(value as QuantityBasis) ? value as QuantityBasis : "factory";
  } catch {
    return "factory";
  }
}

function readStoredSubtypes(projectId: number | null): number[] | null {
  if (projectId === null) return null;
  try {
    const value = JSON.parse(window.localStorage.getItem(subtypesStorageKey(projectId)) ?? "null");
    return Array.isArray(value) && value.every((item) => typeof item === "number") ? value : null;
  } catch {
    return null;
  }
}

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
  const [subtypeSelection, setSubtypeSelection] = useState<{ projectId: number; ids: number[] } | null>(null);
  const [chosen, setChosen] = useState<{ projectId: number; range: Range } | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState<BudgetSort>("estimated_cost");
  const [view, setView] = useState<"budget" | "unbudgeted">("budget");
  const [inspectedKey, setInspectedKey] = useState<string | null>(null);
  const [trendKey, setTrendKey] = useState<string | null>(null);
  const [extraTrendSku, setExtraTrendSku] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [exclusionsOpen, setExclusionsOpen] = useState(false);
  const [applying, setApplying] = useState<{ done: number; total: number } | null>(null);
  const [criteria, setCriteria] = useSuggestionCriteria();
  const [groupId, setGroupId] = useState<number | null>(null);
  const [groupEditorOpen, setGroupEditorOpen] = useState(false);
  const [groupsRevision, setGroupsRevision] = useState(0);
  // The BOM quantity the budget follows: factory by default. Each basis keeps its own adjustments, exclusions and extras.
  const [basis, setBasisState] = useState<QuantityBasis>(readStoredBasis);
  const setBasis = (next: QuantityBasis) => {
    setBasisState(next);
    try { window.localStorage.setItem(basisStorageKey, next); } catch { /* per-viewer convenience only */ }
  };
  // Material dashboard groups, shared cache with that page.
  const groupCatalog = useDashboardResource<MaterialStudyGroupRow[]>({
    cacheKey: GROUP_CATALOG_CACHE_KEY, enabled: true, fetcher: () => api.getMaterialStudyGroupCatalog(),
    refreshNonce: groupsRevision,
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
  const budget = useCostBudget(projectId, basis);
  const subtypes = budget.view?.flat_subtypes ?? [];
  // One or more subtypes, analyzed as the average house of their mix.
  const storedSubtypes = useMemo(() => readStoredSubtypes(projectId), [projectId]);
  const requestedSubtypes = (subtypeSelection?.projectId === projectId ? subtypeSelection.ids : storedSubtypes ?? []).filter((id) => subtypes.some((item) => item.id === id));
  const scopeIds: (number | null)[] = subtypes.length ? requestedSubtypes.length ? requestedSubtypes : [subtypes[0].id] : [null];
  const scopeKey = scopeIds.join(",");
  const subtypeName = !subtypes.length ? "General" : scopeIds.length === subtypes.length && subtypes.length > 1 ? "todas las subtipologías"
    : scopeIds.map((id) => subtypes.find((item) => item.id === id)?.name ?? "General").join(" + ");
  const selectSubtypes = (ids: number[]) => {
    if (projectId === null) return;
    setSubtypeSelection({ projectId, ids });
    try { window.localStorage.setItem(subtypesStorageKey(projectId), JSON.stringify(ids)); } catch { /* per-viewer convenience only */ }
  };
  const canEdit = currentUser.permissions.project_edit && canEditPage(currentUser, "cost_model");
  const canEditGroups = canEditPage(currentUser, "material_dashboard");
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

  const exclusions = useCecoExclusions(basis);
  // The group chart leaves out the same cost centers as the study.
  const groupExclusions = useMemo(() => dashboardExclusions((exclusions.data?.rules ?? []).map((item) => item.rule)), [exclusions.data]);
  const study = useCostStudy(projectId, range, rangeReady ? exclusions.key : null, basis);
  const extras = useCostExtras(projectId, basis);
  const disabled = budget.saving !== null || exporting || applying !== null;
  // Rows arrive first; live prices, the study and the out-of-budget list follow.
  const extrasLoading = projectId !== null && extras.data === null && !extras.error;
  const background = [budget.pricesLoading ? "precios ERP" : null, study.loading ? "referencia histórica" : null, extrasLoading ? "fuera de presupuesto" : null]
    .filter((item): item is string => item !== null);

  useEffect(() => {
    let active = true;
    setProjectsError(null);
    api.getProjects().then((board) => {
      if (active) setProjects(Object.values(board.grouped_projects).flat().sort((a, b) => a.name.localeCompare(b.name, "es")));
    }).catch((err: Error) => { if (active) setProjectsError(err.message || "No se pudieron cargar los proyectos."); });
    return () => { active = false; };
  }, [projectsRevision]);

  useEffect(() => { onTitleChange?.(budget.view?.project.name ?? "Modelo de costos"); }, [budget.view?.project.name, onTitleChange]);
  useEffect(() => { setInspectedKey(null); setExportError(null); }, [projectId, scopeKey]);

  const bySku = useMemo(() => new Map(study.data?.materials.map((item) => [item.sku.trim().toUpperCase(), item])), [study.data]);
  const linesFor = (subtype: number | null) => (budget.view?.rows ?? []).filter((row) => belongsToScenario(row, subtype))
    .map((row) => buildBudgetLine(row, subtype, row.is_auxiliary ? null : bySku.get(row.sku.trim().toUpperCase()) ?? null, criteria));
  const scope = useMemo(() => scopeWeights(scopeIds.map((id) => ({ id, name: subtypes.find((item) => item.id === id)?.name ?? "General" })), study.data?.houses.target_by_subtype ?? null),
    [scopeKey, budget.view, study.data]);
  const extraLines = useMemo(() => buildExtraLines(study.data?.unbudgeted ?? [], extras.data), [study.data, extras.data]);
  const extraMarks = useMemo(() => new Map(extraLines.map((line) => [line.sku.trim().toUpperCase(), { included: line.included, valuePerHouse: line.valuePerHouse, quantityPerHouse: line.quantityPerHouse }])), [extraLines]);
  // Groups of substitutes that together match the estimate suggest each member's historic quantity.
  const lines = useMemo(() => {
    const scoped = (budget.view?.rows ?? []).flatMap((row) => {
      const line = buildScopeLine(row, scope.subtypes, row.is_auxiliary ? null : bySku.get(row.sku.trim().toUpperCase()) ?? null, criteria);
      return line ? [line] : [];
    });
    return applyGroupValidation(scoped, validateGroups(groupCatalog.data ?? [], scoped, extraMarks));
  }, [budget.view, scope, bySku, criteria, groupCatalog.data, extraMarks]);
  const mixText = scopeIds.length > 1 ? scope.subtypes.map((item) => `${item.name} ${Math.round(item.weight * 100)}%`).join(" · ") : null;
  const totals = useMemo(() => summarizeBudget(lines), [lines]);
  const missingPriceLines = lines.filter((line) => !(line.row.price !== null && line.row.price > 0)
    && ((line.estimate ?? 0) > 0 || (line.quantity ?? 0) > 0));
  const missingQuantityLines = lines.filter((line) => line.estimate === null || line.quantity === null || line.partial);
  const missingExtraLines = extraLines.filter((line) => line.included && line.valuePerHouse === null);
  const missingPrices = missingPriceLines.length;
  const missingQuantities = missingQuantityLines.length;
  const missingExtras = missingExtraLines.length;
  const partialTotalDetails = [
    missingPrices ? `SIN PRECIO UNITARIO (${missingPrices})\n${missingPriceLines.map((line) => {
      const affected = [line.estimate !== null && line.estimate > 0 ? "Estimado" : null, line.quantity !== null && line.quantity > 0 ? "Presupuesto" : null].filter(Boolean).join(" y ");
      return `• ${line.row.sku} · ${line.row.material_name}\n  No se incluye su costo en ${affected}.`;
    }).join("\n")}` : null,
    missingQuantities ? `CANTIDADES INCOMPLETAS (${missingQuantities})\n${missingQuantityLines.map((line) => {
      const subtypes = (line.parts ?? []).filter((part) => part.line.estimate === null || part.line.partial).map((part) => part.name);
      const detail = line.estimate === null ? "Falta cantidad en el BOM; no se incluye su costo estimado." : line.partial ? "Alguna instancia del BOM no tiene cantidad; el estimado solo suma las cantidades informadas." : "Falta la cantidad presupuestada.";
      const budgetResolved = (line.parts ?? []).every((part) => part.line.quantity !== null && (!part.line.partial || part.line.source === "manual" || part.line.source === "historic_allocated"));
      const budgetDetail = line.quantity === null ? " El presupuesto tampoco tiene una cantidad completa." : line.source === "manual" || line.source === "historic_allocated" ? ` El presupuesto usa la cantidad ${sourceLabels[line.source].toLowerCase()} guardada.` : budgetResolved ? " El presupuesto sí tiene una cantidad definida." : " El presupuesto también es parcial.";
      return `• ${line.row.sku} · ${line.row.material_name}${subtypes.length ? ` (${subtypes.join(", ")})` : ""}\n  ${detail}${budgetDetail}`;
    }).join("\n")}` : null,
    missingExtras ? `EXTRAS SIN VALORIZAR (${missingExtras})\n${missingExtraLines.map((line) => `• ${line.sku} · ${line.name}\n  ${[line.quantityPerHouse === null ? "Falta cantidad por vivienda" : null, line.unitCost === null ? "Falta precio unitario" : null].filter(Boolean).join(". ") || "No se pudo calcular el costo"}. Está incluido, pero no suma al presupuesto.`).join("\n")}` : null,
  ].filter(Boolean).join("\n\n");
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
  const visibleExtras = extraLines.filter((line) => `${line.sku} ${line.name}`.toLowerCase().includes(search.trim().toLowerCase()));
  const extraTrend = visibleExtras.find((line) => line.sku === extraTrendSku) ?? visibleExtras[0];
  useEffect(() => { if (trend) setTrendKey(rowKey(trend)); }, [trend?.row.material_id, trend?.row.sku]);
  useEffect(() => { if (extraTrend) setExtraTrendSku(extraTrend.sku); }, [extraTrend?.sku]);
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

  function toSaves(line: BudgetLine, source: "estimated" | "historic_allocated" | "manual", quantity: number): BudgetSave[] {
    return scopeSaves(line, source, quantity).map(({ part, quantity: value }) => ({ line: part.line, subtypeId: part.id, source, quantity: value }));
  }

  // Saves to every selected subtype that uses the material, each with its own quantity.
  async function saveScope(line: BudgetLine, source: BudgetSource, quantity: number) {
    if (source !== "estimated" && source !== "historic_allocated" && source !== "manual") return false;
    const parts = line.parts ?? [];
    if (line.source === "mixed" && !window.confirm(`${line.row.material_name} usa fuentes distintas: ${parts.map((part) => `${part.name}: ${sourceLabels[part.line.source]}`).join(" · ")}. ¿Usar ${sourceLabels[source]} en todas?`)) return false;
    return budget.saveMany(toSaves(line, source, quantity), study.data);
  }

  async function applySuggestions() {
    const targets = [...pending];
    if (!targets.length || !window.confirm(`Se usará la cantidad histórica en ${targets.length} materiales de ${subtypeName}. ${describeCriteria(criteria)} ¿Continuar?`)) return;
    setApplying({ done: 0, total: targets.length });
    await budget.saveMany(targets.flatMap((line) => line.historic === null ? [] : toSaves(line, "historic_allocated", line.historic)), study.data);
    setApplying(null);
  }

  return (
    <section className="absolute inset-0 top-16 flex flex-col overflow-auto bg-white text-zinc-800 dark:bg-zinc-950 dark:text-zinc-200 xl:overflow-hidden" aria-busy={background.length > 0}>
      {budget.view && background.length ? <div aria-hidden="true" className="absolute inset-x-0 top-0 z-20 h-0.5 animate-pulse bg-red-600" /> : null}
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
              {!subtypes.length ? <select id="budget-subtype" className={`${control} w-[160px] max-w-full`} disabled><option>General</option></select>
                : <SubtypePicker className={control} disabled={disabled} selected={scopeIds as number[]} onChange={selectSubtypes}
                  note={scopeIds.length > 1 && scope.equal ? scope.empty.length ? `Sin viviendas en el período: ${scope.empty.join(", ")}. Se ponderan por igual.` : "Sin mezcla del período todavía: se ponderan por igual." : null}
                  options={subtypes.map((subtype) => {
                    const weight = scope.subtypes.find((item) => item.id === subtype.id)?.weight ?? null;
                    const houses = study.data?.houses.target_by_subtype.find((item) => item.subtype_id === subtype.id)?.houses ?? (study.data ? 0 : null);
                    return { id: subtype.id, name: subtype.name, weight, houses };
                  })} />}
            </div> : null}
            <div>
              <span id="budget-basis" className="mb-1 block text-[10px] uppercase tracking-wider text-zinc-500">Cantidad</span>
              <div role="group" aria-labelledby="budget-basis" className="flex">
                {BASES.map((item, index) => <button key={item} type="button" aria-pressed={basis === item} disabled={disabled} title={basisDescriptions[item]}
                  className={`${segment(basis === item)} ${index ? "-ml-px" : ""}`}
                  onClick={() => setBasis(item)}>{basisLabels[item]}</button>)}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
          {canEditGroups ? <button type="button" className={`${control} text-xs`} disabled={disabled || groupCatalog.data === null}
            onClick={() => setGroupEditorOpen(true)}>Administrar grupos</button> : null}
          {budget.view && background.length ? <span role="status" className="flex items-center gap-1.5 text-xs text-zinc-500">
            <i className="ph ph-circle-notch animate-spin" aria-hidden="true" />Cargando {background.join(" · ")}…</span> : null}
          {budget.view && currentUser.permissions.cost_model_export ? <button type="button" className="border border-zinc-950 bg-zinc-950 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50 dark:border-white dark:bg-white dark:text-zinc-950"
            disabled={disabled || background.length > 0} title={background.length ? "Espera a que terminen de cargar los datos: el Excel refleja lo que muestra la página." : undefined}
            onClick={async () => {
              if (projectId === null || !budget.view) return;
              setExporting(true); setExportError(null);
              try {
                // Exactly what the page shows, for every subtype: the Excel's totals are these totals.
                await exportCostBudget(projectId, buildCostExport({
                  subtypes: (subtypes.length ? subtypes : [{ id: null, name: "General" }]).map((item) => ({ id: item.id, name: item.name, lines: linesFor(item.id) })),
                  mix: study.data?.houses.target_by_subtype ?? null, targetHouses: study.data?.houses.target ?? null,
                  range: study.data ? range : null, selection: scope.subtypes.map((item) => ({ name: item.name, weight: item.weight })),
                  extras: extraLines, rows: budget.view.rows, basis: basisLabels[basis],
                }));
              } catch (err) { setExportError(err instanceof Error ? err.message : "No se pudo exportar."); }
              finally { setExporting(false); }
            }}>{exporting ? "Generando Excel…" : "Exportar Excel"}</button> : null}
          </div>
        </div>
      </header>
      {budget.view ? <>
          {budget.priceError ? <div role="alert" className="flex shrink-0 flex-wrap items-center gap-2 border-b border-amber-300 bg-amber-50 px-4 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200 md:px-6">
            <span>{budget.priceError}</span>
            <button type="button" className="underline disabled:opacity-50" disabled={disabled || budget.loading || budget.pricesLoading} onClick={budget.reload}>Reintentar precios</button>
          </div> : null}
          {!budget.pricesLoading && (missingPrices > 0 || missingQuantities > 0 || missingExtras > 0) ? <div role="status" title={partialTotalDetails} className="shrink-0 cursor-help border-b border-amber-300 bg-amber-50 px-4 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200 md:px-6">
            <strong>Totales parciales.</strong> {[missingPrices ? `${missingPrices} materiales sin precio` : null, missingQuantities ? `${missingQuantities} materiales con cantidades incompletas` : null, missingExtras ? `${missingExtras} extras sin valorizar` : null].filter(Boolean).join(" · ")}. Las partidas sin costo quedan fuera de la suma.
          </div> : null}
          <div className="grid shrink-0 grid-cols-2 border-b border-black/10 dark:border-white/10 sm:grid-cols-5" aria-label="Totales de la subtipología">
            <Total loading={budget.pricesLoading ? "Actualizando precios…" : null} label="Estimado / vivienda" value={formatMoney(totals.estimated)} detail={totals.missingEstimate + totals.partial ? `Parcial · ${totals.missingEstimate + totals.partial} materiales incompletos` : `${lines.length} materiales`} />
            <Total loading={budget.pricesLoading ? "Actualizando precios…" : extrasLoading || study.loading ? "Calculando fuera de presupuesto…" : null} label="Presupuesto / vivienda" value={formatMoney(budgetPerHouse)} title={mixText ? `Promedio ponderado: ${mixText}` : undefined} detail={mixText ? `${totals.missingBudget + totals.partialBudget ? "Parcial · " : ""}Mezcla: ${mixText}` : totals.missingBudget + totals.partialBudget ? `Parcial · ${totals.missingBudget + totals.partialBudget} materiales incompletos` : extrasPerHouse ? `Incluye ${formatMoney(extrasPerHouse)} fuera de presupuesto` : "Incluye materiales generales"} emphasis />
            <Total loading={budget.pricesLoading ? "Actualizando precios…" : null} label="Cambio vs estimación" value={totals.missingEstimate || totals.missingBudget ? "—" : formatChange(budgetPerHouse - totals.estimated)} detail={`${totals.adjusted} materiales ajustados`} />
            <Total loading={study.loading || extrasLoading ? "Calculando…" : null} label="Fuera de presupuesto / viv." value={formatMoney(extrasPerHouse)}
              detail={`${extraLines.filter((line) => line.included).length} de ${extraLines.length} incluidos · por defecto ${extras.data?.default === "exclude" ? "excluir" : "incluir"}`}
              title="Materiales retirados que ningún presupuesto explica, incluidos en el presupuesto. Revísalos en «Fuera de presupuesto»." />
            <Total loading={budget.pricesLoading ? "Actualizando precios…" : study.loading ? "Calculando mezcla…" : null} label="Proyecto / vivienda" value={mixAverage === null ? "—" : formatMoney(mixAverage)} detail={mixLabel ? `Mezcla del período: ${mixLabel}` : "Según la mezcla del período"}
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
              <button type="button" aria-pressed={view === "budget"} className={segment(view === "budget")} onClick={() => setView("budget")}>Presupuesto</button>
              <button type="button" aria-pressed={view === "unbudgeted"} className={`${segment(view === "unbudgeted")} -ml-px`} onClick={() => setView("unbudgeted")}>Fuera de presupuesto ({extraLines.length})</button>
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
      {view === "unbudgeted" ? extraTrend ? <ConsumptionTrend sku={extraTrend.sku} name={extraTrend.name} unit={extraTrend.unit || "un"}
        projectId={projectId} studyKey={exclusions.key} basis={basis} price={extraTrend.unitCost} showExpected={false}
        range={range} disabled={disabled} onRangeChange={setRange} /> : null : trend ? <ConsumptionTrend sku={trend.row.sku} name={trend.row.material_name} unit={trend.row.unit}
        projectId={projectId} studyKey={exclusions.key} basis={basis} price={trend.row.price && trend.row.price > 0 ? trend.row.price : null}
        missingSubtypes={trend.row.subtypes.filter((entry) => entry.has_missing_quantity).map((entry) => entry.subtype_name)} range={range} disabled={disabled} onRangeChange={setRange} onDetails={() => setInspectedKey(rowKey(trend))} /> : null}
      </div>

      {projectsError ? <div role="alert" className="border-b border-red-200 bg-red-50 px-6 py-2 text-xs text-red-800 dark:bg-red-950/20 dark:text-red-300">{projectsError} <button onClick={() => setProjectsRevision((value) => value + 1)} className="underline">Reintentar</button></div> : null}
      {extras.error ? <div role="alert" className="border-b border-red-200 bg-red-50 px-6 py-2 text-xs text-red-800 dark:bg-red-950/20 dark:text-red-300">{extras.error}</div> : null}
      {groupCatalog.error ? <div role="alert" className="border-b border-red-200 bg-red-50 px-6 py-2 text-xs text-red-800 dark:bg-red-950/20 dark:text-red-300">{groupCatalog.error} <button className="underline" onClick={() => setGroupsRevision((value) => value + 1)}>Reintentar</button></div> : null}
      {budget.error || exportError ? <div role="alert" className="border-b border-red-200 bg-red-50 px-6 py-3 text-sm text-red-800 dark:bg-red-950/20 dark:text-red-300">{budget.error || exportError}{!budget.view ? <button className="ml-3 underline" onClick={budget.reload}>Reintentar</button> : null}</div> : null}
      {projectId === null ? <div className="m-auto p-8 text-center text-sm text-zinc-500">Selecciona un proyecto para revisar su presupuesto.</div>
        : budget.loading ? <div className="m-auto p-8 text-sm text-zinc-500" role="status">Cargando presupuesto…</div>
        : budget.view ? <>
          <div className="min-h-[300px] shrink-0 overflow-auto xl:min-h-0 xl:flex-1">
            {view === "unbudgeted" ? study.data || extraLines.length ? <UnbudgetedTable lines={extraLines} search={search} weeks={studyWeeks} canEdit={canEdit && Boolean(extras.data?.stored)} disabled={disabled}
                selectedSku={extraTrend?.sku} onInspect={(line) => setExtraTrendSku(line.sku)}
                onToggle={(line) => void toggleExtra(line)} onReset={(line) => void extras.reset(line.sku)} onAdopt={(line, replacement) => void adoptReplacement(line, replacement)} />
              : <p className="p-12 text-center text-sm text-zinc-500" role="status">{study.loading ? "Calculando consumo del período…" : "Consulta un período para ver el consumo fuera de presupuesto."}</p>
            : <>
            <table className="w-full min-w-[1180px] text-xs">
              <thead className="sticky top-0 z-10 bg-zinc-100 text-[10px] text-zinc-500 dark:bg-zinc-900">
                <tr>{["Material", "Precio / un.", "Estimada / viv.", "Costo estimado", "Histórica / viv.", "Cambio vs est.", "Usar", "Presup. / viv.", "Costo presup."].map((label, index) => <th key={label} className={`border-b border-black/10 px-3 py-3 font-semibold dark:border-white/10 ${index === 0 || index === 6 ? "text-left" : "text-right"}`} title={label === "Cambio vs est." ? "Presupuesto menos estimado, en costo por vivienda: lo que cambia la fuente elegida (histórica o manual)." : label === "Usar" ? "Punto verde: se sugiere la histórica (diferencia relevante con confianza alta, o validada por su grupo de reemplazos). Punto ámbar: por revisar." : undefined}>{label}</th>)}</tr>
              </thead>
              <tbody>{visible.map((line) => <BudgetRow pricesLoading={budget.pricesLoading} key={`${projectId}:${scopeKey}:${rowKey(line)}`} line={line} canEdit={canEdit} disabled={disabled} saving={budget.saving !== null && budget.saving === line.row.material_id} historyLoading={study.loading}
                groups={groupsBySku.get(line.row.sku.trim().toUpperCase())} onGroup={setGroupId} selected={trend === line} onInspect={() => line.row.is_auxiliary ? setInspectedKey(rowKey(line)) : setTrendKey(rowKey(line))} onSave={(source, quantity) => saveScope(line, source, quantity)} />)}</tbody>
            </table>
            {!visible.length ? <p className="p-12 text-center text-sm text-zinc-500">{lines.length ? "No hay materiales que coincidan con estos filtros." : "Esta subtipología todavía no tiene materiales presupuestados."}</p> : null}
            </>}
          </div>
          <footer className="flex shrink-0 flex-wrap justify-between gap-2 border-t border-black/10 px-6 py-2 text-[10px] text-zinc-500 dark:border-white/10">
            {view === "budget" ? <><span>{visible.length} de {lines.length} materiales · Totales de toda la subtipología</span><span>Cambio vs est.: presupuesto menos estimado, por vivienda · en gris, lo que cambiaría usar la histórica</span></>
              : <><span>Retiros que ningún presupuesto del período explica · por vivienda que consumía</span><span>Adoptar un reemplazo incluye el material nuevo a su ritmo desde el cambio y deja el anterior en su nivel posterior</span></>}
          </footer>
        </> : null}
      {inspected ? <BudgetEvidence line={inspected} subtypeIds={scopeIds} subtypeName={subtypeName} study={study.data} onClose={() => setInspectedKey(null)} /> : null}
      {timelineOpen && timeline.data && projectId !== null ? <ProductionTimeline timeline={timeline.data} projectId={projectId} projectName={budget.view?.project.name ?? ""} range={range}
        onClose={() => setTimelineOpen(false)} onApply={(next) => { setRange({ startDate: next.startDate, endDate: next.endDate < today ? next.endDate : today }); setTimelineOpen(false); }} /> : null}
      {openGroup ? <GroupAnalysis group={openGroup} lines={lines} subtypeName={subtypeName} study={study.data}
        excludedCecos={groupExclusions.cecos} unsupportedRules={groupExclusions.unsupported} basis={basis}
        unbudgeted={extraMarks} range={range} disabled={disabled}
        onRangeChange={setRange} onClose={() => setGroupId(null)} /> : null}
      {exclusionsOpen && exclusions.data ? <CecoExclusionsModal exclusions={exclusions.data} canEdit={canEdit} onSave={exclusions.save} onClose={() => setExclusionsOpen(false)} /> : null}
      {canEditGroups ? <MaterialStudyGroupEditor open={groupEditorOpen} groups={groupCatalog.data ?? []}
        onClose={() => setGroupEditorOpen(false)} onChanged={() => {
          setGroupId(null);
          setGroupsRevision((value) => value + 1);
        }} /> : null}
    </section>
  );
}

function Total({ label, value, detail, emphasis = false, title, loading = null }: { label: string; value: string; detail: string; emphasis?: boolean; title?: string; loading?: string | null }) {
  return <div title={title} className={`min-w-0 border-r border-black/10 px-4 py-2 dark:border-white/10 md:px-6 ${emphasis ? "bg-zinc-950 text-white dark:bg-white dark:text-zinc-950" : ""}`}>
    <p className={`truncate text-[10px] uppercase tracking-wider ${emphasis ? "opacity-60" : "text-zinc-500"}`}>{label}</p>
    <p className={`mt-1 font-mono text-lg font-semibold tabular-nums transition-opacity ${loading ? "animate-pulse opacity-40" : ""}`}>{value}</p>
    <p className={`mt-1 truncate text-[10px] ${emphasis ? "opacity-60" : "text-zinc-500"}`}>{loading ? <><i className="ph ph-circle-notch mr-1 animate-spin align-[-1px]" aria-hidden="true" />{loading}</> : detail}</p>
  </div>;
}
