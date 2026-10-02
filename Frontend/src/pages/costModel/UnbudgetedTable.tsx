import type { ExtraLine } from "./extras";
import { formatMoney, formatQuantity2 } from "./format";

type Replacement = ExtraLine["replaces"][number];

/**
 * Materials withdrawn in the period that the BOMs do not explain, as budget
 * lines. With cost centers filtered well they are unbudgeted consumables or
 * equivalents replacing a budgeted material.
 */
export function UnbudgetedTable({ lines, search, weeks, canEdit, disabled, selectedSku, onInspect, onToggle, onReset, onAdopt }: {
  lines: ExtraLine[]; search: string; weeks: number; canEdit: boolean; disabled: boolean;
  selectedSku?: string; onInspect: (line: ExtraLine) => void;
  onToggle: (line: ExtraLine) => void; onReset: (line: ExtraLine) => void; onAdopt: (line: ExtraLine, replacement: Replacement) => void;
}) {
  const query = search.trim().toLowerCase();
  const visible = lines.filter((line) => `${line.sku} ${line.name}`.toLowerCase().includes(query));
  return <>
    <table className="w-full min-w-[1080px] text-xs">
      <thead className="sticky top-0 z-10 bg-zinc-100 text-[10px] text-zinc-500 dark:bg-zinc-900">
        <tr>{["Incluir", "Material", "Cant. / viv.", "Costo / viv.", "Semanas con salidas", "Posible reemplazo de"].map((label, index) =>
          <th key={label} className={`border-b border-black/10 px-3 py-3 font-semibold dark:border-white/10 ${index <= 1 || index === 5 ? "text-left" : "text-right"}`}>{label}</th>)}</tr>
      </thead>
      <tbody>{visible.map((line) => <tr key={line.sku}
        onClick={(event) => { if (!(event.target as HTMLElement).closest("button, input, a, form, select, textarea")) onInspect(line); }}
        className={`cursor-pointer border-b border-black/[0.06] dark:border-white/[0.06] ${selectedSku === line.sku ? "bg-amber-50 dark:bg-amber-500/10" : "hover:bg-zinc-50 dark:hover:bg-white/[0.025]"} ${line.included ? "" : "text-zinc-400"}`}>
        <td className="px-3 py-3">
          <input type="checkbox" aria-label={`Incluir ${line.name} en el presupuesto`} checked={line.included} disabled={!canEdit || disabled} onChange={() => onToggle(line)} />
          {line.decided && canEdit ? <button type="button" disabled={disabled} className="ml-2 text-[10px] underline" title="Volver a seguir el criterio del proyecto y el período" onClick={() => onReset(line)}>Restablecer</button> : null}
        </td>
        <td className="max-w-[320px] px-3 py-3"><button type="button" aria-pressed={selectedSku === line.sku} title="Ver tendencia de consumo"
          onClick={() => onInspect(line)} className={`text-left font-medium hover:underline ${line.included ? "text-zinc-950 dark:text-white" : ""}`}>{line.name}</button>
          <p className="mt-1 text-[10px] text-zinc-500">{line.sku} · {line.unit || "un"}{line.decided ? " · decidido" : ""}{!line.inStudy ? " · sin salidas en este período" : ""}</p>
          {line.mainCostCenter ? <p className="mt-0.5 text-[10px] text-zinc-500" title="Centro de costo con más salidas de este material en el período. Si es de otro sitio, puede ser un error de imputación.">
            Principalmente {line.mainCostCenter.code}{line.mainCostCenter.name ? ` · ${line.mainCostCenter.name}` : ""}{line.mainCostCenter.share !== null ? ` (${Math.round(line.mainCostCenter.share * 100)}%)` : ""}</p> : null}</td>
        <td className="px-3 py-3 text-right font-mono tabular-nums">{formatQuantity2(line.quantityPerHouse)}
          <span className="block text-[10px] font-sans text-zinc-500">{line.pinned ? line.decision?.source_range_start ? `Fija desde ${line.decision.source_range_start}` : "Fija" : "Según período"}</span></td>
        <td className="px-3 py-3 text-right font-mono font-semibold tabular-nums">{formatMoney(line.valuePerHouse)}</td>
        <td className="px-3 py-3 text-right font-mono tabular-nums" title="Pocas semanas con salidas suele indicar un retiro puntual, no un consumo habitual.">{line.activeWeeks === null ? "—" : `${line.activeWeeks} de ${weeks}`}</td>
        <td className="px-3 py-3">{line.replacesSku && !line.replaces.some((candidate) => candidate.sku === line.replacesSku)
          ? <span>Reemplaza a {line.replacesSku}</span>
          : line.replaces.length ? line.replaces.map((candidate) => <div key={candidate.sku} className="flex flex-wrap items-baseline gap-x-2"
            title={candidate.evidence === "switch" ? "El material presupuestado casi dejó de retirarse cuando este empezó, por un monto parecido." : "Nombre similar y un faltante parecido del material presupuestado."}>
            <span>{candidate.name} <span className="text-[10px] text-zinc-500">{candidate.sku} · {candidate.evidence === "switch" && candidate.since_week
              ? `cambio desde la semana del ${candidate.since_week}${candidate.quantity_per_house_since !== null ? ` · ${formatQuantity2(candidate.quantity_per_house_since)} ${line.unit || "un"}/viv. desde entonces` : ""}`
              : `nombre similar · faltó ${formatMoney(candidate.shortfall_value_per_house)}/viv.`}</span></span>
            {line.replacesSku === candidate.sku ? <span className="text-[10px] font-semibold text-emerald-700 dark:text-emerald-400">Adoptado</span>
              : canEdit && candidate.evidence === "switch" && candidate.quantity_per_house_since !== null
                ? <button type="button" disabled={disabled} className="text-[10px] underline" onClick={() => onAdopt(line, candidate)}>Adoptar reemplazo</button> : null}
          </div>) : <span className="text-zinc-400">—</span>}</td>
      </tr>)}</tbody>
    </table>
    {!visible.length ? <p className="p-12 text-center text-sm text-zinc-500">{lines.length ? "No hay materiales que coincidan con la búsqueda." : "Todo lo retirado en el período está explicado por algún presupuesto."}</p> : null}
  </>;
}
