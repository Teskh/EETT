import { Modal } from "../../components/Modal";
import type { CostModelStudy } from "../../lib/types";
import type { BudgetLine } from "./budget";
import { formatMoney, formatQuantity, gradeDescriptions, gradeLabels, studyReasons, sourceLabels } from "./format";

export function BudgetEvidence({ line, subtypeId, subtypeName, study, onClose }: {
  line: BudgetLine; subtypeId: number | null; subtypeName: string; study: CostModelStudy | null; onClose: () => void;
}) {
  const material = line.study;
  const instances = line.row.instances.filter((item) => item.subtype_id === null || item.subtype_id === subtypeId);
  const bars = [
    { label: "Estimada", value: line.estimate },
    { label: "Histórica", value: line.historic },
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
          <h3 className="font-semibold text-zinc-950 dark:text-white">Referencia del período {material ? <span className={`ml-2 text-xs font-normal ${material.grade === "high" ? "text-emerald-700 dark:text-emerald-400" : material.grade === "medium" ? "text-amber-700 dark:text-amber-400" : "text-zinc-500"}`}>Confianza {gradeLabels[material.grade].toLowerCase()}</span> : null}</h3>
          {study ? <p className="mt-1 text-xs text-zinc-500">{study.range_start} a {study.range_end} · {study.houses.target} viviendas del proyecto · {study.houses.other_projects} de otros proyectos{study.houses.unmapped ? ` · ${study.houses.unmapped} sin vincular` : ""}</p> : null}
          {material && material.ratio !== null ? <>
            <p className="mt-3 font-mono text-xs leading-6">
              {formatQuantity(material.actual)} retiradas ÷ {formatQuantity(material.expected)} esperadas = ×{formatQuantity(Math.round(material.ratio * 1000) / 1000)}
              {" "}→ {formatQuantity(line.estimate)} estimadas × {formatQuantity(Math.round(material.ratio * 1000) / 1000)} = {formatQuantity(line.historic)} {line.row.unit}/viv.
            </p>
            <p className="mt-2 text-xs leading-5">
              {material.method === "separated"
                ? "La mezcla de proyectos cambió durante el período, lo que permitió separar el consumo de este proyecto del de los demás."
                : material.target_share !== null && material.target_share < 0.9
                  ? `Este proyecto explica ${Math.round(material.target_share * 100)}% del consumo esperado. El resto se reparte suponiendo que los demás proyectos se desvían igual.`
                  : "El período lo ocupa casi solo este proyecto."}
              {material.site_share > 0.3 ? ` ${Math.round(material.site_share * 100)}% de sus salidas son de obra, que se retiran meses después del inicio.` : ""}
            </p>
            <p className="mt-2 text-xs leading-5 text-zinc-500">{gradeDescriptions[material.grade]}</p>
            {material.reasons.length ? <ul className="mt-2 list-disc space-y-1 pl-4 text-xs">{material.reasons.map((reason) => <li key={reason}>{studyReasons[reason] ?? reason}
              {reason === "change_point" && material.signals.stability ? ` Semana del ${material.signals.stability.change_week}: ×${formatQuantity(Math.round(material.signals.stability.ratio_before * 100) / 100)} antes, ×${formatQuantity(Math.round(material.signals.stability.ratio_after * 100) / 100)} después`
                + (line.estimate !== null ? ` (${formatQuantity(Math.round(line.estimate * material.signals.stability.ratio_after * 100) / 100)} ${line.row.unit}/viv. desde entonces). Si fue un reemplazo, búscalo en "Fuera de presupuesto".` : ".") : ""}</li>)}</ul> : null}
            <WeeklyBars weeks={material.signals.weeks} actual={material.signals.weekly_actual} expected={material.signals.weekly_expected} />
          </> : <p className="mt-3 text-xs text-amber-700 dark:text-amber-400">{material ? material.reasons.map((reason) => studyReasons[reason] ?? reason).join(" ") : "Este material no tiene referencia histórica en el período."}</p>}
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

/** Weekly withdrawals against the consumption expected from started houses. */
function WeeklyBars({ weeks, actual, expected }: { weeks: string[]; actual: number[]; expected: number[] }) {
  const max = Math.max(1e-9, ...actual, ...expected);
  if (!weeks.length) return null;
  return <figure className="mt-4">
    <div className="flex h-24 items-end gap-px" role="img" aria-label="Salidas semanales frente al consumo esperado">
      {weeks.map((week, index) => <div key={week} className="relative flex h-full flex-1 items-end" title={`Semana del ${week}: ${formatQuantity(Math.round(actual[index] * 100) / 100)} retiradas, ${formatQuantity(Math.round(expected[index] * 100) / 100)} esperadas`}>
        <div className="w-full bg-amber-500/80" style={{ height: `${actual[index] / max * 100}%` }} />
        <div className="absolute inset-x-0 border-t-2 border-emerald-600" style={{ bottom: `${expected[index] / max * 100}%` }} />
      </div>)}
    </div>
    <figcaption className="mt-1 flex gap-4 text-[10px] text-zinc-500"><span><span className="mr-1 inline-block h-2 w-2 bg-amber-500/80" />Retirado por semana</span><span><span className="mr-1 inline-block h-0.5 w-3 bg-emerald-600 align-middle" />Esperado según viviendas iniciadas</span></figcaption>
  </figure>;
}
