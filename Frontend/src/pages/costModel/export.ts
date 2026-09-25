import { api } from "../../lib/api";

/** Materials outside the BOM depend on the period shown, so the page sends them. */
export type ExportExtra = { sku: string; name: string; unit: string | null; quantity_per_house: number | null; unit_cost: number | null; value_per_house: number | null; replaces_sku: string | null; origin: string };

export async function exportCostBudget(projectId: number, extras: ExportExtra[] = []) {
  const job = await api.requestProjectExport(projectId, { kind: "cost_model_workbook", payload: { extras } });
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
