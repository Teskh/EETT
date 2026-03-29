import { useEffect, useMemo, useState } from "react";

import { Modal } from "./Modal";
import { MaterialCalculationSheetPreview } from "./MaterialCalculationSheetPreview";
import { ApiError, api } from "../lib/api";
import type {
  MaterialDashboardListRow,
  MaterialDashboardProjectUsageData,
  MaterialDashboardProjectUsageItem,
} from "../lib/types";

type MaterialProjectUsageModalProps = {
  open: boolean;
  projectId: number;
  projectName: string;
  material: Pick<MaterialDashboardListRow, "sku" | "material_name" | "unit">;
  onClose: () => void;
};

const quantityFormatter = new Intl.NumberFormat("es-CL", {
  maximumFractionDigits: 2,
});

function formatQuantity(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "—";
  }
  return quantityFormatter.format(value);
}

function formatUpdatedAt(value: string | null) {
  if (!value) {
    return "Not saved";
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function projectUsageItemKey(item: MaterialDashboardProjectUsageItem) {
  return `${item.instance_id}:${item.rule_id}`;
}

function quantityStateLabel(value: number | null, state: string) {
  if (state === "blank") {
    return "Blank";
  }
  if (state === "zero") {
    return "0";
  }
  return formatQuantity(value);
}

function calculationLabel(item: MaterialDashboardProjectUsageItem, breakdown: MaterialDashboardProjectUsageItem["breakdown"][number]) {
  if (breakdown.calculation_formula) {
    return breakdown.calculation_formula;
  }
  if (breakdown.calculation_explanation) {
    return breakdown.calculation_explanation;
  }
  if (item.rule_notes) {
    return item.rule_notes;
  }
  return breakdown.calculation_mode;
}

export function MaterialProjectUsageModal({
  open,
  projectId,
  projectName,
  material,
  onClose,
}: MaterialProjectUsageModalProps) {
  const [data, setData] = useState<MaterialDashboardProjectUsageData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedItemKey, setSelectedItemKey] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    let cancelled = false;
    async function loadUsage() {
      setLoading(true);
      setError(null);
      try {
        const response = await api.getMaterialDashboardProjectUsage(material.sku, projectId);
        if (cancelled) {
          return;
        }
        setData(response);
        setSelectedItemKey(response.items[0] ? projectUsageItemKey(response.items[0]) : null);
      } catch (err) {
        if (cancelled) {
          return;
        }
        setError(err instanceof ApiError ? err.message : "Could not load project usage for this material.");
        setData(null);
        setSelectedItemKey(null);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadUsage();
    return () => {
      cancelled = true;
    };
  }, [material.sku, open, projectId]);

  const selectedItem = useMemo(() => {
    if (!data?.items.length) {
      return null;
    }
    return data.items.find((item) => projectUsageItemKey(item) === selectedItemKey) || data.items[0];
  }, [data?.items, selectedItemKey]);

  return (
    <Modal
      open={open}
      title={`${material.material_name} in ${projectName}`}
      kicker="Project Usage"
      onClose={onClose}
      panelClassName="!max-w-[96vw] xl:!max-w-7xl"
    >
      <div className="space-y-4">
        <div className="rounded-2xl border border-black/10 bg-zinc-50/80 p-4 dark:border-white/10 dark:bg-white/[0.03]">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-zinc-900 dark:text-white">
                {projectName} | {material.sku}
              </p>
              <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                Inspect which items specify this material, how each partida contributes to the total, and the saved quantity sheet for the selected item.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-black/10 px-3 py-1 text-[11px] font-mono text-zinc-600 dark:border-white/10 dark:text-zinc-300">
                {(data?.item_count ?? 0).toString()} items
              </span>
              <span className="rounded-full border border-black/10 px-3 py-1 text-[11px] font-mono text-zinc-600 dark:border-white/10 dark:text-zinc-300">
                {formatQuantity(data?.total_quantity ?? 0)} {data?.unit || material.unit || ""}
              </span>
            </div>
          </div>
        </div>

        {error ? (
          <div className="rounded-xl border border-red-200 bg-red-100 px-4 py-3 text-sm text-red-800 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-200">
            {error}
          </div>
        ) : null}

        {loading ? (
          <div className="rounded-2xl border border-dashed border-black/10 px-6 py-10 text-sm text-zinc-500 dark:border-white/10 dark:text-zinc-400">
            Loading project usage...
          </div>
        ) : null}

        {!loading && data && data.items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-black/10 px-6 py-10 text-sm text-zinc-500 dark:border-white/10 dark:text-zinc-400">
            This material is not specified anywhere in the selected project.
          </div>
        ) : null}

        {!loading && data && data.items.length > 0 ? (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(420px,520px)]">
            <div className="space-y-3 overflow-y-auto pr-1 xl:max-h-[72vh]">
              {data.items.map((item) => {
                const active = selectedItem ? projectUsageItemKey(item) === projectUsageItemKey(selectedItem) : false;
                return (
                  <div
                    key={projectUsageItemKey(item)}
                    onClick={() => setSelectedItemKey(projectUsageItemKey(item))}
                    className={`cursor-pointer rounded-2xl border p-4 transition-colors ${
                      active
                        ? "border-accent-500/50 bg-accent-50/60 dark:border-accent-500/40 dark:bg-accent-500/10"
                        : "border-black/10 bg-white hover:bg-zinc-50 dark:border-white/10 dark:bg-black/20 dark:hover:bg-white/[0.04]"
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-zinc-900 dark:text-white">{item.instance_name}</p>
                        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                          {[item.category_name, item.component_name].filter(Boolean).join(" • ") || "No category context"}
                        </p>
                        {item.rule_notes ? (
                          <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">{item.rule_notes}</p>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <span className="rounded-full border border-black/10 px-2.5 py-1 text-[11px] font-mono text-zinc-600 dark:border-white/10 dark:text-zinc-300">
                          Qty {formatQuantity(item.total_quantity)} {item.unit || material.unit || ""}
                        </span>
                        <span className="rounded-full border border-black/10 px-2.5 py-1 text-[11px] font-mono text-zinc-600 dark:border-white/10 dark:text-zinc-300">
                          {item.has_calculation_sheet ? `${item.calculation_sheet_cell_count} sheet cells` : "No saved sheet"}
                        </span>
                        {item.unit_qty_per_unit !== null ? (
                          <span className="rounded-full border border-black/10 px-2.5 py-1 text-[11px] font-mono text-zinc-600 dark:border-white/10 dark:text-zinc-300">
                            Rule {formatQuantity(item.unit_qty_per_unit)} {item.unit || material.unit || ""}
                          </span>
                        ) : null}
                        {item.blank_quantity_count > 0 ? (
                          <span className="rounded-full border border-amber-300/50 bg-amber-50 px-2.5 py-1 text-[11px] font-mono text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
                            {item.blank_quantity_count} blank
                          </span>
                        ) : null}
                        {item.zero_quantity_count > 0 ? (
                          <span className="rounded-full border border-zinc-300/60 bg-zinc-100 px-2.5 py-1 text-[11px] font-mono text-zinc-700 dark:bg-white/[0.06] dark:text-zinc-300">
                            {item.zero_quantity_count} zero
                          </span>
                        ) : null}
                      </div>
                    </div>

                    <div className="mt-4 overflow-x-auto rounded-xl border border-black/10 dark:border-white/10">
                      <table className="w-full border-collapse text-left text-xs">
                        <thead className="bg-zinc-100/70 dark:bg-white/[0.04]">
                          <tr>
                            <th className="px-3 py-2 font-semibold text-zinc-500">Partida</th>
                            <th className="px-3 py-2 font-semibold text-zinc-500 text-right">Qty</th>
                            <th className="px-3 py-2 font-semibold text-zinc-500 text-right">Kit</th>
                            <th className="px-3 py-2 font-semibold text-zinc-500">Calc</th>
                          </tr>
                        </thead>
                        <tbody>
                          {item.breakdown.map((breakdown, index) => (
                            <tr key={`${projectUsageItemKey(item)}-${breakdown.subtype_id ?? "general"}-${index}`} className="border-t border-black/5 dark:border-white/5">
                              <td className="px-3 py-2 text-zinc-900 dark:text-white">{breakdown.subtype_name}</td>
                              <td className="px-3 py-2 text-right font-mono text-zinc-700 dark:text-zinc-200">
                                {quantityStateLabel(breakdown.quantity, breakdown.quantity_state)}
                              </td>
                              <td className="px-3 py-2 text-right font-mono text-zinc-700 dark:text-zinc-200">
                                {quantityStateLabel(breakdown.assembly_quantity, breakdown.assembly_quantity_state)}
                              </td>
                              <td className="px-3 py-2 text-zinc-500 dark:text-zinc-400">
                                {calculationLabel(item, breakdown)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="min-h-[420px]">
              {selectedItem ? (
                <MaterialCalculationSheetPreview
                  projectId={projectId}
                  instanceId={selectedItem.instance_id}
                  instanceName={selectedItem.instance_name}
                  material={{
                    rule_id: selectedItem.rule_id,
                    material_name: data.material_name || material.material_name,
                    sku: data.sku,
                  }}
                />
              ) : (
                <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-black/10 px-6 py-10 text-sm text-zinc-500 dark:border-white/10 dark:text-zinc-400">
                  Select an item to preview its calculation sheet.
                </div>
              )}
              {selectedItem ? (
                <p className="mt-2 px-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                  Selected item updated: {formatUpdatedAt(selectedItem.calculation_sheet_updated_at)}
                </p>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
