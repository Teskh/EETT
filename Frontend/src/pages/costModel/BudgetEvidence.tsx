import { Modal } from "../../components/Modal";
import type { CostModelHistory } from "../../lib/types";
import type { BudgetLine } from "./budget";
import { formatMoney, formatQuantity, historyReasons, sourceLabels } from "./format";

export function BudgetEvidence({ line, subtypeId, subtypeName, history, onClose }: {
  line: BudgetLine; subtypeId: number | null; subtypeName: string; history: CostModelHistory | null; onClose: () => void;
}) {
  const reference = line.reference;
  const instances = line.row.instances.filter((item) => item.subtype_id === null || item.subtype_id === subtypeId);
  const bars = [
    { label: "Estimada", value: line.estimate },
    { label: "Histórica repartida", value: reference?.quantity_per_house ?? null },
    { label: "Presupuestada", value: line.quantity },
  ];
  const maximum = Math.max(1, ...bars.map((bar) => bar.value ?? 0));
  return (
    <Modal open title={line.row.material_name} kicker={`${subtypeName} · ${line.row.sku}`} onClose={onClose} panelClassName="max-w-3xl">
      <div className="space-y-6 text-sm text-zinc-700 dark:text-zinc-300">
        <div className="space-y-3" aria-label="Cantidades por vivienda">
          {bars.map((bar) => <div key={bar.label} className="grid grid-cols-[150px_1fr_85px] items-center gap-3 text-xs">
            <span>{bar.label}</span><div className="h-3 bg-zinc-100 dark:bg-white/5"><div className={`h-full ${bar.label === "Presupuestada" ? "bg-red-600" : "bg-zinc-400 dark:bg-zinc-600"}`} style={{ width: `${Math.max(0, (bar.value ?? 0) / maximum * 100)}%` }} /></div>
            <span className="text-right font-mono">{formatQuantity(bar.value)} {line.row.unit}</span>
          </div>)}
        </div>
        <section className="border border-black/10 p-4 dark:border-white/10">
          <h3 className="font-semibold text-zinc-950 dark:text-white">Referencia del período</h3>
          {history ? <p className="mt-1 text-xs text-zinc-500">{history.range_start} a {history.range_end} · {history.sample_houses} viviendas de esta subtipología · {history.total_houses} viviendas en fábrica</p> : null}
          <p className="mt-3 text-xs leading-5">El consumo es compartido. Se reparte según las cantidades estimadas de todas las viviendas iniciadas en el período. No es una medición individual de esta subtipología.</p>
          {reference?.quantity_per_house != null ? <p className="mt-3 font-mono text-xs leading-6">
            {formatQuantity(reference.factory_consumption)} consumidas ÷ {formatQuantity(reference.factory_expected_consumption)} estimadas en fábrica × {formatQuantity(reference.estimated_quantity_per_house)} estimadas por vivienda = {formatQuantity(reference.quantity_per_house)} {line.row.unit}/viv.
          </p> : <p className="mt-3 text-xs text-amber-700 dark:text-amber-400">{historyReasons[reference?.reason ?? history?.blocked_reason ?? "no_movements"] ?? "Referencia no disponible."}</p>}
        </section>
        <section>
          <h3 className="font-semibold text-zinc-950 dark:text-white">Decisión guardada</h3>
          <p className="mt-2">{sourceLabels[line.source]} · {formatQuantity(line.quantity)} {line.row.unit}/viv. · {formatMoney(line.budgetCost)}/viv.</p>
          {line.adjustment?.source_range_start ? <p className="mt-1 text-xs text-zinc-500">Período utilizado: {line.adjustment.source_range_start} a {line.adjustment.source_range_end} · {line.adjustment.source_sample_houses ?? 0} viviendas</p> : null}
          {line.adjustment?.source_note ? <p className="mt-2 text-xs leading-5">{line.adjustment.source_note}</p> : null}
          {line.source === "historic_allocated" ? <p className="mt-2 text-xs text-zinc-500">La cantidad guardada se mantiene al cambiar el período. Puedes adoptar la nueva referencia desde la tabla.</p> : null}
          {line.source === "legacy" ? <p className="mt-2 text-xs text-zinc-500">Este ajuste anterior combina las contribuciones generales y de la subtipología. Elegir una fuente reemplazará la cantidad completa de esta subtipología.</p> : null}
        </section>
        <section>
          <h3 className="mb-2 font-semibold text-zinc-950 dark:text-white">Origen de la estimación</h3>
          <ul className="divide-y divide-black/5 dark:divide-white/5">
            {instances.map((instance, index) => <li key={index} className="flex justify-between gap-4 py-2 text-xs">
              <span>{instance.instance_name ?? "Material"}<span className="block text-[10px] text-zinc-500">{instance.subtype_id === null ? "General" : instance.subtype_name} · {instance.category_label}</span></span>
              <span className="font-mono">{instance.quantity_state === "blank" ? "Sin definir" : formatQuantity(instance.quantity_state === "zero" ? 0 : instance.quantity)}</span>
            </li>)}
          </ul>
          {!instances.length ? <p className="text-xs text-zinc-500">Sin desglose por instancia.</p> : null}
        </section>
      </div>
    </Modal>
  );
}
