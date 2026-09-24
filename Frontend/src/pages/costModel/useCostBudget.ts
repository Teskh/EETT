import { useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import type { CostModelAdjustment, CostModelHistory, CostModelView } from "../../lib/types";
import type { BudgetLine, BudgetSource } from "./budget";
import { useDashboardResource } from "../materialDashboard/useDashboardResource";

export function useCostBudget(projectId: number | null) {
  const [view, setView] = useState<CostModelView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<number | null>(null);
  const [revision, setRevision] = useState(0);
  const projectRef = useRef(projectId);
  projectRef.current = projectId;
  const saveLock = useRef(false);

  useEffect(() => {
    let active = true;
    setView(null);
    setError(null);
    if (projectId === null) { setLoading(false); return; }
    setLoading(true);
    api.getCostModel(projectId).then((data) => { if (active) setView(data); })
      .catch((err: Error) => { if (active) setError(err.message || "No se pudo cargar el presupuesto."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [projectId, revision]);

  async function save(line: BudgetLine, subtypeId: number | null, source: BudgetSource, quantity: number, history: CostModelHistory | null) {
    if (!view || projectId === null || line.row.material_id === null || saveLock.current) return false;
    saveLock.current = true;
    const previous = view;
    const reference = line.reference;
    const historic = source === "historic_allocated" && history && reference;
    const payload = {
      material_id: line.row.material_id, subtype_id: subtypeId, quantity_scope: "scenario" as const,
      adjusted_quantity: quantity, source_kind: source,
      source_note: historic ? `Reparto según presupuesto: ${reference.factory_consumption} consumidas / ${reference.factory_expected_consumption} estimadas en fábrica × ${reference.estimated_quantity_per_house} por vivienda. ${history.sample_houses} viviendas de la subtipología; ${history.total_houses} en total.` : null,
      source_range_start: historic ? history.range_start : null,
      source_range_end: historic ? history.range_end : null,
      source_sample_houses: historic ? history.sample_houses : null,
      source_total_consumption: historic ? reference.allocated_consumption : null,
    };
    const optimistic: CostModelAdjustment = {
      ...payload, id: line.adjustment?.id ?? -1, source_house_type_id: null,
      updated_at: new Date().toISOString(), created_by: null,
    };
    setSaving(line.row.material_id);
    setError(null);
    setView({ ...view, rows: view.rows.map((row) => row.material_id === payload.material_id
      ? { ...row, adjustments: [...row.adjustments.filter((item) => item.subtype_id !== subtypeId), optimistic] } : row) });
    try {
      const next = await api.upsertCostModelAdjustment(projectId, payload);
      if (projectRef.current === projectId) setView(next);
      return true;
    } catch (err) {
      if (projectRef.current === projectId) {
        setView(previous);
        setError(err instanceof Error ? err.message : "No se pudo guardar la cantidad.");
      }
      return false;
    } finally {
      setSaving(null);
      saveLock.current = false;
    }
  }
  return { view: view?.project.id === projectId ? view : null, loading, error, saving, save, reload: () => setRevision((value) => value + 1) };
}

export function useCostHistory(projectId: number | null, subtypeId: number | null, range: { startDate: string; endDate: string }) {
  const [revision, setRevision] = useState(0);
  // Stale-while-revalidate through the dashboard cache: revisiting a
  // subtypology or period shows the stored reference at once and refreshes it
  // in the background. Budget overrides never enter the reference, so saving
  // quantities does not invalidate it.
  const resource = useDashboardResource<CostModelHistory>({
    cacheKey: projectId === null ? null : `cost-history::v1::${projectId}::${subtypeId ?? "general"}::${range.startDate}::${range.endDate}`,
    refreshNonce: revision,
    fetcher: () => api.getCostModelHistory(projectId as number, subtypeId, range),
    errorMessage: "No se pudo cargar el histórico.",
  });
  const data = resource.data;
  const current = data?.project_id === projectId && data.subtype_id === subtypeId
    && data.range_start === range.startDate && data.range_end === range.endDate ? data : null;
  return { data: current, loading: resource.loading && current === null, error: resource.error, reload: () => setRevision((value) => value + 1) };
}
