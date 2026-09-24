import { useState } from "react";
import { parseBudgetQuantity, type BudgetLine, type BudgetSource } from "./budget";
import { formatChange, formatMoney, formatQuantity, formatQuantity2, historyReasons, sourceLabels } from "./format";

type Props = {
  line: BudgetLine;
  canEdit: boolean;
  disabled: boolean;
  saving: boolean;
  historyLoading: boolean;
  selected?: boolean;
  onSave: (source: BudgetSource, quantity: number) => Promise<boolean>;
  onInspect: () => void;
};

export function BudgetRow({ line, canEdit, disabled, saving, historyLoading, selected, onSave, onInspect }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [invalid, setInvalid] = useState(false);
  const { row, reference } = line;
  const historical = reference?.quantity_per_house ?? null;
  const available = !row.is_auxiliary && canEdit;
  return (
    // The whole row selects the material; controls inside it keep their own behavior.
    // Auxiliary rows open a dialog instead, so only their name does that.
    <tr onClick={(event) => { if (!row.is_auxiliary && !(event.target as HTMLElement).closest("button, input, a, form, select, textarea")) onInspect(); }}
      className={`${row.is_auxiliary ? "" : "cursor-pointer "}border-b border-black/[0.06] dark:border-white/[0.06] ${selected ? "bg-amber-50 dark:bg-amber-500/10" : "hover:bg-zinc-50 dark:hover:bg-white/[0.025]"}`}>
      <td className="px-4 py-3 min-w-[220px] max-w-[320px]">
        <button type="button" aria-pressed={selected} title="Ver tendencia de consumo" onClick={onInspect} className="text-left font-medium text-zinc-950 hover:underline dark:text-white">{row.material_name}</button>
        <p className="mt-1 text-[10px] text-zinc-500">{row.sku} · {row.unit || "un"}{row.is_auxiliary ? " · Auxiliar" : ""}</p>
      </td>
      <td className="px-3 py-3 text-right font-mono tabular-nums">{formatMoney(row.price && row.price > 0 ? row.price : null)}{!row.price || row.price < 0 ? <span className="block text-[10px] font-sans text-amber-700 dark:text-amber-400">Sin precio</span> : null}</td>
      <td className="px-3 py-3 text-right font-mono tabular-nums">{formatQuantity(line.estimate)}{line.estimate === null ? <span className="block text-[10px] font-sans text-amber-700 dark:text-amber-400">Incompleta</span> : null}</td>
      <td className="px-3 py-3 text-right font-mono tabular-nums text-zinc-500">{formatMoney(line.estimatedCost)}</td>
      <td className="px-3 py-3 text-right font-mono tabular-nums" title={reference?.reason ? historyReasons[reference.reason] : "Referencia repartida según cantidades estimadas"}>
        {historyLoading ? <span className="text-zinc-400">…</span> : formatQuantity2(historical)}
        {historical !== null ? <span className="block text-[10px] font-sans text-zinc-500">Repartida</span> : null}
      </td>
      <td className={`px-3 py-3 text-right font-mono tabular-nums ${line.historicalImpact !== null && line.historicalImpact > 0 ? "text-red-700 dark:text-red-400" : "text-zinc-600 dark:text-zinc-300"}`}>
        {formatChange(line.historicalImpact)}
      </td>
      <td className="px-3 py-3 min-w-[185px]">
        {editing ? (
          <form className="flex flex-wrap gap-1" onSubmit={async (event) => {
            event.preventDefault();
            const value = parseBudgetQuantity(draft);
            if (value === null) { setInvalid(true); return; }
            if (await onSave("manual", value)) setEditing(false);
          }}>
            <input autoFocus inputMode="decimal" aria-label={`Cantidad manual de ${row.material_name}`} aria-invalid={invalid} value={draft} disabled={disabled}
              onChange={(event) => { setDraft(event.target.value); setInvalid(false); }}
              onKeyDown={(event) => { if (event.key === "Escape") setEditing(false); }}
              className="w-24 border border-zinc-300 bg-transparent px-2 py-1.5 font-mono dark:border-zinc-600" />
            <button className="border border-zinc-300 px-2 dark:border-zinc-600" disabled={disabled} type="submit" aria-label={`Guardar cantidad de ${row.material_name}`}>✓</button>
            <button className="px-1 text-zinc-500" disabled={disabled} type="button" onClick={() => setEditing(false)} aria-label="Cancelar edición">×</button>
            {invalid ? <p className="w-full text-[10px] text-red-600">Usa un número positivo o cero, con coma decimal.</p> : null}
          </form>
        ) : available ? (
          <div role="group" aria-label={`Fuente de ${row.material_name}`} className="inline-flex overflow-hidden rounded border border-black/15 dark:border-white/15">
            {(["estimated", "historic_allocated", "manual"] as const).map((source) => <button key={source} type="button"
              aria-pressed={line.source === source} disabled={disabled || (source === "historic_allocated" && historical === null)}
              title={source === "historic_allocated" && historical === null ? historyLoading ? "Cargando referencia histórica…" : reference?.reason ? historyReasons[reference.reason] : "Sin referencia histórica disponible" : sourceLabels[source]}
              className={`border-r border-black/10 px-2 py-1.5 text-[10px] last:border-r-0 disabled:opacity-35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-red-500 dark:border-white/10 ${line.source === source ? "bg-zinc-950 text-white dark:bg-white dark:text-zinc-950" : "hover:bg-black/5 dark:hover:bg-white/5"}`}
              onClick={() => {
                if (source === "manual") { setDraft(line.quantity === null ? "" : formatQuantity(line.quantity)); setInvalid(false); setEditing(true); }
                else if (source === "estimated") void onSave(source, line.estimate ?? 0);
                else if (historical !== null) void onSave(source, historical);
              }}>{sourceLabels[source]}</button>)}
          </div>
        ) : <span className="text-zinc-500">{sourceLabels[line.source]}</span>}
        {available && line.source === "legacy" ? <span className="block text-[10px] text-zinc-500">Ajuste anterior</span> : null}
        {!editing && line.source === "manual" && available ? <button type="button" disabled={disabled} onClick={() => { setDraft(formatQuantity(line.quantity)); setEditing(true); }} className="mt-1 text-[10px] underline">Editar cantidad</button> : null}
        {!editing && line.source === "historic_allocated" && available && historical !== null && line.quantity !== historical ? <button type="button" disabled={disabled} onClick={() => void onSave("historic_allocated", historical)} className="mt-1 text-[10px] underline">Usar referencia actual</button> : null}
        {saving ? <span className="block text-[10px] text-zinc-500" role="status">Guardando…</span> : null}
      </td>
      <td className="bg-black/[0.015] px-3 py-3 text-right font-mono font-semibold tabular-nums dark:bg-white/[0.025]">{formatQuantity(line.quantity)}</td>
      <td className="bg-black/[0.015] px-4 py-3 text-right font-mono font-semibold tabular-nums dark:bg-white/[0.025]">{formatMoney(line.budgetCost)}</td>
    </tr>
  );
}

