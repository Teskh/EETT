import { api } from "../../lib/api";
import type { CostModelRow } from "../../lib/types";
import type { BudgetLine } from "./budget";
import type { ExtraLine } from "./extras";
import { gradeLabels, sourceLabels } from "./format";

/**
 * The workbook is a snapshot of what the page shows: the same lines, prices,
 * mix and materials outside the BOM, so its totals are the page's totals.
 * The server only lays it out.
 */
export type CostExportLine = {
  sku: string; name: string; unit: string; auxiliary: boolean; price: number | null;
  estimate: number | null; historic: number | null; grade: string | null; source: string;
  quantity: number | null; note: string | null;
  /** Some instance leaves the quantity blank: only the filled ones count. */
  partial: boolean;
};
export type CostExportSubtype = { id: number | null; name: string; houses: number | null; lines: CostExportLine[] };
export type CostExportExtra = { sku: string; name: string; unit: string | null; quantity_per_house: number | null; unit_cost: number | null; value_per_house: number | null; replaces_sku: string | null; origin: string };
export type CostExportDetail = { subtype: string; category: string; instance: string; sku: string; name: string; unit: string; quantity: number | null; price: number | null };
export type CostExportPayload = {
  version: 2;
  generated_at: string;
  range: { start: string; end: string } | null;
  /** The BOM quantity the budget follows, e.g. "Fábrica". */
  basis?: string | null;
  target_houses: number | null;
  subtypes: CostExportSubtype[];
  /** The subtypes selected on the page and their weight, when more than one. */
  selection: { name: string; weight: number }[] | null;
  extras: CostExportExtra[];
  detail: CostExportDetail[];
};

export type CostExportInput = {
  subtypes: { id: number | null; name: string; lines: BudgetLine[] }[];
  mix: { subtype_id: number | null; houses: number }[] | null;
  targetHouses: number | null;
  range: { startDate: string; endDate: string } | null;
  selection: { name: string; weight: number }[] | null;
  extras: ExtraLine[];
  rows: CostModelRow[];
  basis?: string | null;
  now?: Date;
};

const usablePrice = (price: number | null) => price !== null && price > 0 ? price : null;

function lineNote(line: BudgetLine): string | null {
  const notes = [
    usablePrice(line.row.price) === null ? "Sin precio" : null,
    line.estimate === null ? "Sin cantidad en la ficha" : line.partial ? "Parcial: alguna instancia sin cantidad" : null,
    line.source === "legacy" ? "Ajuste anterior" : null,
  ].filter((note): note is string => note !== null);
  return notes.length ? notes.join(" · ") : null;
}

export function buildCostExport({ subtypes, mix, targetHouses, range, selection, extras, rows, basis = null, now = new Date() }: CostExportInput): CostExportPayload {
  return {
    version: 2,
    generated_at: now.toISOString(),
    range: range ? { start: range.startDate, end: range.endDate } : null,
    basis,
    target_houses: targetHouses,
    subtypes: subtypes.map(({ id, name, lines }) => ({
      id, name, houses: mix ? mix.find((item) => item.subtype_id === id)?.houses ?? 0 : null,
      // A material absent from this subtype and not budgeted costs nothing: leave it out.
      lines: lines.filter((line) => !(line.estimate === 0 && !line.quantity)).map((line) => ({
        sku: line.row.sku, name: line.row.material_name, unit: line.row.unit || "", auxiliary: line.row.is_auxiliary,
        price: usablePrice(line.row.price), estimate: line.estimate, historic: line.historic,
        grade: line.study && line.historic !== null ? gradeLabels[line.study.grade] : null,
        source: sourceLabels[line.source], quantity: line.quantity, note: lineNote(line), partial: line.partial,
      })),
    })),
    selection: selection && selection.length > 1 ? selection : null,
    extras: extras.filter((line) => line.included).map((line) => ({
      sku: line.sku, name: line.name, unit: line.unit, quantity_per_house: line.quantityPerHouse, unit_cost: line.unitCost,
      value_per_house: line.valuePerHouse, replaces_sku: line.replacesSku,
      origin: line.pinned ? `Fija${line.decision?.source_range_start ? ` desde ${line.decision.source_range_start}` : ""}` : range ? `Período ${range.startDate} a ${range.endDate}` : "Período consultado",
    })),
    // The BOM of each subtype's house, instance by instance: general quantities plus its own.
    detail: subtypes.flatMap(({ id, name }) => rows.filter((row) => !row.is_auxiliary).flatMap((row) => row.instances
      .filter((entry) => (entry.subtype_id === null || entry.subtype_id === id) && entry.quantity_state !== "zero")
      .map((entry) => ({
        subtype: name, category: entry.category_label ?? "", instance: entry.instance_name ?? "", sku: row.sku, name: row.material_name,
        unit: row.unit || "", quantity: entry.quantity_state === "blank" ? null : entry.quantity, price: usablePrice(row.price),
      })))),
  };
}

export async function exportCostBudget(projectId: number, payload: CostExportPayload) {
  const job = await api.requestProjectExport(projectId, { kind: "cost_model_workbook", payload });
  if (job.status !== "completed" || !job.artifact_uri) {
    throw new Error(typeof job.payload.error === "string" ? job.payload.error : "No se pudo generar la exportación.");
  }
  const response = await fetch(job.artifact_uri, { credentials: "same-origin" });
  if (!response.ok) throw new Error("No se pudo descargar la exportación.");
  const disposition = response.headers.get("content-disposition");
  const utf8 = disposition?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const plain = disposition?.match(/filename="?([^";]+)"?/i)?.[1];
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = utf8 ? decodeURIComponent(utf8) : plain || "modelo-de-costos.xlsx";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
