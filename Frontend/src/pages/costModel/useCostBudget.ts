import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../lib/api";
import type { CecoExclusions, CostModelAdjustment, CostModelExtra, CostModelExtras, CostModelStudy, CostModelTimeline, CostModelView } from "../../lib/types";
import type { BudgetLine, BudgetSource } from "./budget";
import { gradeLabels } from "./format";
import { useDashboardResource } from "../materialDashboard/useDashboardResource";

export type BudgetSave = { line: BudgetLine; subtypeId: number | null; source: BudgetSource; quantity: number; note?: string | null };

export function useCostBudget(projectId: number | null) {
  const [view, setView] = useState<CostModelView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<number | null>(null);
  const [revision, setRevision] = useState(0);
  // Live ERP prices arrive after the rows, which load from cached prices.
  const [prices, setPrices] = useState<{ projectId: number; values: Record<string, number | null> } | null>(null);
  const projectRef = useRef(projectId);
  projectRef.current = projectId;
  const saveLock = useRef(false);
  // Saves must build on the latest view, not one captured before an await.
  const viewRef = useRef(view);
  viewRef.current = view;
  const commit = (next: CostModelView | null) => { viewRef.current = next; setView(next); };

  useEffect(() => {
    let active = true;
    setView(null);
    setError(null);
    if (projectId === null) { setLoading(false); return; }
    setLoading(true);
    api.getCostModel(projectId).then((data) => {
      if (!active) return;
      setView(data);
      if (data.prices_pending) {
        api.getCostModelPrices(projectId).then(({ prices: values }) => { if (active) setPrices({ projectId, values }); }).catch(() => { /* cached prices stay */ });
      }
    })
      .catch((err: Error) => { if (active) setError(err.message || "No se pudo cargar el presupuesto."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [projectId, revision]);

  const priced = useMemo(() => {
    if (!view || prices?.projectId !== view.project.id) return view;
    return { ...view, rows: view.rows.map((row) => {
      const price = prices.values[row.sku.trim().toUpperCase()];
      return price != null && price !== row.price ? { ...row, price } : row;
    }) };
  }, [view, prices]);

  /** Saves several quantities in one request; all are kept or none. */
  async function saveMany(entries: BudgetSave[], study: CostModelStudy | null) {
    const view = viewRef.current;
    const valid = entries.filter((entry) => entry.line.row.material_id !== null);
    if (!view || projectId === null || !valid.length || saveLock.current) return false;
    saveLock.current = true;
    const previous = view;
    const payloads = valid.map(({ line, subtypeId, source, quantity, note = null }) => {
      const material = line.study;
      const historic = source === "historic_allocated" && study && material;
      return {
        material_id: line.row.material_id as number, subtype_id: subtypeId, quantity_scope: "scenario" as const,
        adjusted_quantity: quantity, source_kind: source,
        source_note: !historic ? note : `Consumo real ${material.actual} / esperado ${material.expected} en el período (×${material.ratio}, ${material.method === "separated" ? "separado de otros proyectos" : "repartido entre proyectos"}). Confianza ${gradeLabels[material.grade].toLowerCase()}. ${study.houses.target} viviendas del proyecto; ${study.houses.other_projects} de otros.`,
        source_range_start: historic ? study.range_start : null,
        source_range_end: historic ? study.range_end : null,
        source_sample_houses: historic ? study.houses.target : null,
        source_total_consumption: historic ? material.actual : null,
      };
    });
    const bySlot = new Map(payloads.map((payload, index) => [`${payload.material_id}:${payload.subtype_id}`, { payload, id: valid[index].line.adjustment?.id ?? -1 }]));
    setSaving(valid.length === 1 ? payloads[0].material_id : -1);
    setError(null);
    commit({ ...view, rows: view.rows.map((row) => {
      const mine = payloads.filter((payload) => payload.material_id === row.material_id);
      if (!mine.length) return row;
      const optimistic: CostModelAdjustment[] = mine.map((payload) => ({
        ...payload, id: bySlot.get(`${payload.material_id}:${payload.subtype_id}`)?.id ?? -1, source_house_type_id: null,
        updated_at: new Date().toISOString(), created_by: null,
      }));
      return { ...row, adjustments: [...row.adjustments.filter((item) => !mine.some((payload) => payload.subtype_id === item.subtype_id)), ...optimistic] };
    }) });
    try {
      const next = payloads.length === 1 ? await api.upsertCostModelAdjustment(projectId, payloads[0]) : await api.upsertCostModelAdjustments(projectId, payloads);
      if (projectRef.current === projectId) commit(next);
      return true;
    } catch (err) {
      if (projectRef.current === projectId) {
        commit(previous);
        setError(err instanceof Error ? err.message : "No se pudo guardar la cantidad.");
      }
      return false;
    } finally {
      setSaving(null);
      saveLock.current = false;
    }
  }
  const save = (line: BudgetLine, subtypeId: number | null, source: BudgetSource, quantity: number, study: CostModelStudy | null, note: string | null = null) =>
    saveMany([{ line, subtypeId, source, quantity, note }], study);
  return { view: priced?.project.id === projectId ? priced : null, loading, error, saving, save, saveMany, reload: () => setRevision((value) => value + 1) };
}

export function useCostStudy(projectId: number | null, range: { startDate: string } & { endDate: string }, policyKey: string | null) {
  const [revision, setRevision] = useState(0);
  // Stale-while-revalidate through the dashboard cache. The key includes the
  // exclusion policy, so editing it never serves a study computed without it.
  // Budget choices never enter the study, so saving does not invalidate it.
  const resource = useDashboardResource<CostModelStudy>({
    cacheKey: projectId === null || policyKey === null ? null : `cost-study::v1::${projectId}::${range.startDate}::${range.endDate}::${policyKey}`,
    refreshNonce: revision,
    fetcher: () => api.getCostModelStudy(projectId as number, range),
    errorMessage: "No se pudo calcular la referencia histórica.",
  });
  const data = resource.data;
  const current = data?.project_id === projectId && data.range_start === range.startDate && data.range_end === range.endDate ? data : null;
  return { data: current, loading: resource.loading && current === null, error: resource.error, reload: () => setRevision((value) => value + 1) };
}

export function useCostTimeline(projectId: number | null) {
  return useDashboardResource<CostModelTimeline>({
    cacheKey: projectId === null ? null : `cost-timeline::v1::${projectId}`,
    fetcher: () => api.getCostModelTimeline(projectId as number),
    errorMessage: "No se pudo cargar la producción.",
  });
}

export function useCecoExclusions() {
  const [data, setData] = useState<CecoExclusions | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    api.getCecoExclusions().then((value) => { if (active) setData(value); })
      .catch((err: Error) => { if (active) setError(err.message || "No se pudieron cargar los centros de costo excluidos."); });
    return () => { active = false; };
  }, []);
  async function save(rules: CecoExclusions["rules"]) {
    const next = await api.updateCecoExclusions(rules);
    setData(next);
    return next;
  }
  const key = data ? data.rules.map((item) => item.rule).sort().join("|") || "none" : error ? "default" : null;
  return { data, error, save, key };
}

export function useCostExtras(projectId: number | null) {
  const [data, setData] = useState<CostModelExtras | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setData(null);
    setError(null);
    if (projectId === null) return;
    api.getCostModelExtras(projectId).then((value) => { if (active) setData(value); })
      .catch((err: Error) => { if (active) setError(err.message || "No se pudieron cargar los materiales fuera de presupuesto."); });
    return () => { active = false; };
  }, [projectId]);
  async function run(action: () => Promise<CostModelExtras>) {
    setError(null);
    try { setData(await action()); return true; }
    catch (err) { setError(err instanceof Error ? err.message : "No se pudo guardar."); return false; }
  }
  return {
    data: data && projectId !== null ? data : null, error,
    setDefault: (mode: CostModelExtras["default"]) => run(() => api.setCostModelExtrasDefault(projectId as number, mode)),
    upsert: (extra: Partial<CostModelExtra> & { sku: string; included: boolean }) => run(() => api.upsertCostModelExtra(projectId as number, extra)),
    reset: (sku: string) => run(() => api.deleteCostModelExtra(projectId as number, sku)),
  };
}
