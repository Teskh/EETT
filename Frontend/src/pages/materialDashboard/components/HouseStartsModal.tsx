import { useEffect, useState } from "react";

import { Modal } from "../../../components/Modal";
import { ApiError, api } from "../../../lib/api";
import type { ProductionHouseStart, ProductionHouseStartsData } from "../../../lib/types";
import type { HouseRange } from "../dates";
import { formatDate } from "../formatters";

type Props = {
  open: boolean;
  range: HouseRange;
  onClose: () => void;
};

function Metric({ value, label, tone = "" }: { value: number; label: string; tone?: string }) {
  return (
    <div className="min-w-[82px] border-l border-black/10 pl-3 first:border-l-0 first:pl-0 dark:border-white/10">
      <div className={`text-xl font-semibold tabular-nums ${tone || "text-zinc-900 dark:text-white"}`}>{value}</div>
      <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">{label}</div>
    </div>
  );
}

function MappingStatus({ house }: { house: ProductionHouseStart }) {
  if (!house.mapped) {
    return (
      <span className="inline-flex border border-amber-500/35 bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">
        Sin vincular
      </span>
    );
  }

  const projectLabel = house.mapped_project_name
    ? `${house.mapped_project_name} · ${house.mapped_project_subtype_name || "General"}`
    : "Vinculada";

  return (
    <div className="min-w-0">
      <span className="inline-flex border border-emerald-600/25 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
        Vinculada
      </span>
      <div className="mt-1 truncate text-xs font-medium text-zinc-700 dark:text-zinc-200" title={projectLabel}>
        {projectLabel}
      </div>
      {house.mapping_issue === "incomplete_bom" ? (
        <div className="mt-0.5 text-[10px] text-amber-700 dark:text-amber-300">
          BOM incompleta{house.missing_quantity_count ? ` · ${house.missing_quantity_count} cantidades` : ""}
        </div>
      ) : null}
    </div>
  );
}

function getHouseLabel(house: ProductionHouseStart) {
  return house.house_identifier || `OT #${house.work_order_id}`;
}

export function HouseStartsModal({ open, range, onClose }: Props) {
  const [data, setData] = useState<ProductionHouseStartsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    let cancelled = false;
    setData(null);
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
          setError(err instanceof ApiError ? err.message : "No se pudieron cargar los inicios del rango.");
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
  }, [open, range.endDate, range.startDate]);

  const displayStart = data?.range_start || range.startDate;
  const displayEnd = data?.range_end || range.endDate;

  return (
    <Modal
      open={open}
      onClose={onClose}
      kicker="Consulta de producción"
      kickerIcon={<i className="ph-bold ph-chart-line-up" />}
      title="Inicios del rango"
      panelClassName="max-w-[min(96vw,1240px)]"
    >
      <div className="flex min-h-0 flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-4 border-y border-black/10 py-3 dark:border-white/10">
          <div>
            <p className="text-xs leading-5 text-zinc-600 dark:text-zinc-400">
              Viviendas cuyo primer panel se inició dentro del rango seleccionado. Esta vista es solo de consulta.
            </p>
            <p className="mt-1 text-[11px] font-semibold text-zinc-500">
              {formatDate(displayStart)} — {formatDate(displayEnd)}
            </p>
          </div>
          {data ? (
            <div className="flex flex-wrap gap-4">
              <Metric value={data.total_house_starts} label="Total" />
              <Metric value={data.mapped_house_starts} label="Vinculadas" tone="text-emerald-700 dark:text-emerald-300" />
              <Metric value={data.unmapped_house_starts} label="Sin vincular" tone="text-amber-700 dark:text-amber-300" />
              <Metric value={data.partial_house_starts} label="BOM incompleta" tone="text-orange-700 dark:text-orange-300" />
            </div>
          ) : null}
        </div>

        {error ? (
          <div role="alert" className="border border-red-500/25 bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-500/10 dark:text-red-300">
            {error}
          </div>
        ) : null}

        {loading && !data ? <div className="py-12 text-center text-sm text-zinc-500">Cargando inicios del rango…</div> : null}

        {data ? (
          <section>
            <div className="mb-2 flex items-center justify-between gap-3 text-[11px] text-zinc-500">
              <span>{data.houses.length} viviendas visibles</span>
              <span>Actualizado {formatDate(data.generated_at)}</span>
            </div>
            <div className="max-h-[58vh] overflow-auto border border-black/10 dark:border-white/10">
              <table className="w-full min-w-[920px] table-fixed text-left text-sm">
                <thead className="sticky top-0 z-10 bg-zinc-100 text-[10px] font-bold uppercase tracking-[0.12em] text-zinc-500 dark:bg-zinc-900">
                  <tr>
                    <th className="w-[125px] border-b border-black/10 px-3 py-2 dark:border-white/10">Fecha</th>
                    <th className="w-[155px] border-b border-black/10 px-3 py-2 dark:border-white/10">Vivienda</th>
                    <th className="w-[220px] border-b border-black/10 px-3 py-2 dark:border-white/10">Tipo / subtipo</th>
                    <th className="w-[220px] border-b border-black/10 px-3 py-2 dark:border-white/10">Proyecto producción</th>
                    <th className="border-b border-black/10 px-3 py-2 dark:border-white/10">Vinculación</th>
                  </tr>
                </thead>
                <tbody>
                  {data.houses.map((house) => (
                    <tr key={house.work_order_id} className="border-t border-black/5 align-top hover:bg-zinc-50 dark:border-white/5 dark:hover:bg-white/[0.035]">
                      <td className="px-3 py-2.5 text-xs text-zinc-600 dark:text-zinc-300">{formatDate(house.start_date)}</td>
                      <td className="px-3 py-2.5">
                        <div className="truncate text-xs font-semibold text-zinc-800 dark:text-zinc-100" title={getHouseLabel(house)}>
                          {getHouseLabel(house)}
                        </div>
                        <div className="mt-0.5 text-[10px] text-zinc-500">OT #{house.work_order_id}</div>
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="truncate text-xs font-medium text-zinc-800 dark:text-zinc-100" title={house.house_type_name}>
                          {house.house_type_name}
                        </div>
                        <div className="mt-0.5 truncate text-[11px] text-zinc-500" title={house.sub_type_name || "Sin subtipo"}>
                          {house.sub_type_name || "Sin subtipo"}
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="truncate text-xs text-zinc-700 dark:text-zinc-200" title={house.production_project_name}>
                          {house.production_project_name}
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <MappingStatus house={house} />
                      </td>
                    </tr>
                  ))}
                  {!data.houses.length ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-12 text-center text-sm text-zinc-500">
                        No hay inicios en el rango seleccionado.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}
      </div>
    </Modal>
  );
}
