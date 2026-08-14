import { Modal } from "../../../components/Modal";
import type { MaterialDashboardExpectedBreakdown } from "../../../lib/types";
import type { HouseRange } from "../dates";
import { formatDate, formatNumber } from "../formatters";

type Props = {
  open: boolean;
  breakdown: MaterialDashboardExpectedBreakdown[];
  digits: number;
  unitLabel?: string | null;
  range: HouseRange;
  onClose: () => void;
};

function getExpectedBreakdownLabel(row: MaterialDashboardExpectedBreakdown) {
  const projectName = row.mapped_project_name || row.house_type_name;
  const subtypeName = row.mapped_project_subtype_name
    || (row.mapped_project_subtype_id !== null ? row.sub_type_name : null);
  return subtypeName ? `${projectName} · ${subtypeName}` : projectName;
}

function getInstanceContextLabel(instance: NonNullable<MaterialDashboardExpectedBreakdown["instance_breakdown"]>[number]) {
  return [instance.category_name, instance.component_name].filter(Boolean).join(" · ") || "Sin contexto de categoría";
}

export function ExpectedBreakdownModal({ open, breakdown, digits, unitLabel, range, onClose }: Props) {
  const totalStarts = breakdown.reduce((total, row) => total + row.house_starts, 0);
  const totalExpected = breakdown.reduce((total, row) => total + row.total_expected_material_quantity, 0);

  return (
    <Modal
      open={open}
      onClose={onClose}
      kicker="Desglose de inicios"
      kickerIcon={<i className="ph-bold ph-chart-line-up" />}
      title="Estimado por vivienda"
      panelClassName="max-w-[min(96vw,1120px)]"
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-4 border-y border-black/10 py-3 dark:border-white/10">
          <div>
            <p className="text-xs leading-5 text-zinc-600 dark:text-zinc-400">
              Todos los inicios agrupados por tipo y subtipo configurados en este app. Las instancias muestran la cantidad definida por vivienda.
            </p>
            <p className="mt-1 text-[11px] font-semibold text-zinc-500">
              {formatDate(range.startDate)} — {formatDate(range.endDate)}
            </p>
          </div>
          <div className="flex flex-wrap gap-4">
            <div className="min-w-[76px] border-l border-black/10 pl-3 first:border-l-0 first:pl-0 dark:border-white/10">
              <div className="text-xl font-semibold tabular-nums text-zinc-900 dark:text-white">{formatNumber(totalStarts, 0)}</div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">Inicios</div>
            </div>
            <div className="min-w-[96px] border-l border-black/10 pl-3 dark:border-white/10">
              <div className="text-xl font-semibold tabular-nums text-zinc-900 dark:text-white">{formatNumber(totalExpected, digits)}</div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">Total estimado</div>
            </div>
          </div>
        </div>

        {breakdown.length ? (
          <div className="max-h-[58vh] overflow-y-auto border-y border-black/10 dark:border-white/10">
            {breakdown.map((row) => {
              const instances = row.instance_breakdown || [];
              return (
                <div key={`${row.mapped_project_id}-${row.mapped_project_subtype_id ?? "general"}`} className="border-b border-black/[0.07] py-3 last:border-b-0 dark:border-white/10">
                  <div className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] items-baseline gap-3 px-1 text-xs">
                    <div className="min-w-0">
                      <div className="truncate font-semibold text-zinc-900 dark:text-white" title={getExpectedBreakdownLabel(row)}>
                        {getExpectedBreakdownLabel(row)}
                      </div>
                      <div className="mt-0.5 text-[10px] text-zinc-500">
                        {instances.length ? `${instances.length} ${instances.length === 1 ? "instancia" : "instancias"} con material definido` : "Sin detalle de instancias"}
                      </div>
                    </div>
                    <span className="font-mono text-zinc-500 dark:text-zinc-400">{formatNumber(row.house_starts, 0)} viv.</span>
                    <span className="font-mono text-zinc-900 dark:text-white">{formatNumber(row.expected_quantity_per_house, digits)}/viv.</span>
                    <span className="font-mono text-zinc-500 dark:text-zinc-400">{formatNumber(row.total_expected_material_quantity, digits)} total</span>
                  </div>

                  {instances.length ? (
                    <div className="mt-2 ml-3 border-l border-black/10 pl-3 dark:border-white/10">
                      <div className="mb-1 grid grid-cols-[minmax(0,1fr)_auto] gap-3 text-[10px] font-bold uppercase tracking-[0.12em] text-zinc-400">
                        <span>Instancia</span>
                        <span>Cantidad / vivienda</span>
                      </div>
                      <div className="space-y-1">
                        {instances.map((instance) => (
                          <div key={instance.instance_id} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-3 text-xs">
                            <div className="min-w-0">
                              <span className="block truncate font-medium text-zinc-700 dark:text-zinc-200" title={instance.instance_name}>
                                {instance.instance_name}
                              </span>
                              <span className="block truncate text-[10px] text-zinc-500">{getInstanceContextLabel(instance)}</span>
                            </div>
                            <span className="font-mono text-zinc-700 dark:text-zinc-200">
                              {formatNumber(instance.quantity, digits)}{unitLabel ? ` ${unitLabel}` : ""}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="border border-dashed border-black/10 px-5 py-8 text-sm text-zinc-500 dark:border-white/10 dark:text-zinc-400">
            No hay inicios vinculados para mostrar en este rango.
          </div>
        )}
      </div>
    </Modal>
  );
}
