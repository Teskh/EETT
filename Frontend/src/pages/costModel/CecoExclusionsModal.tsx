import { useState } from "react";
import { Modal } from "../../components/Modal";
import type { CecoExclusions } from "../../lib/types";
import { basisDescriptions, basisLabels } from "./format";

const RULE = /^(\d{2}|\*-\d{2}|\d{2}-\d{2}-\d{2})$/;

/**
 * Cost centers left out of historic consumption, for every project. Rules
 * cover an area ("06"), a site in any area ("*-34") or an exact center.
 */
export function CecoExclusionsModal({ exclusions, canEdit, onSave, onClose }: {
  exclusions: CecoExclusions; canEdit: boolean; onSave: (rules: CecoExclusions["rules"]) => Promise<unknown>; onClose: () => void;
}) {
  const [rules, setRules] = useState(exclusions.rules);
  const [draft, setDraft] = useState({ rule: "", note: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = RULE.test(draft.rule.trim()) && !rules.some((item) => item.rule === draft.rule.trim());
  const changed = JSON.stringify(rules) !== JSON.stringify(exclusions.rules);
  const describe = (rule: string) => rule.startsWith("*-") ? `Sitio ${rule.slice(2)} en todas las áreas` : rule.includes("-") ? "Centro exacto" : `Área ${rule}`;
  return (
    <Modal open title="Centros de costo excluidos" kicker={`Referencia histórica · ${basisLabels[exclusions.basis ?? "factory"]} · todos los proyectos`} kickerIcon={<i className="ph-bold ph-funnel" />} onClose={onClose} panelClassName="max-w-3xl">
      <div className="space-y-4 text-xs text-zinc-700 dark:text-zinc-300">
        <p className="text-zinc-500">Las salidas de estos centros no cuentan como consumo de las viviendas: mantención, postventa, urbanización u otros negocios. Todo lo demás cuenta, incluidos los materiales que no están en ningún presupuesto.</p>
        <p className="text-zinc-500">Esta lista es de la base <strong>{basisLabels[exclusions.basis ?? "factory"]}</strong> ({basisDescriptions[exclusions.basis ?? "factory"]}). Cada base tiene la suya.</p>
        {!exclusions.stored ? <p className="border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">Se usan las exclusiones predeterminadas. Para guardar cambios, primero hay que aplicar la migración de la base de datos.</p> : null}
        <ul className="max-h-[50vh] divide-y divide-black/5 overflow-auto border border-black/10 dark:divide-white/5 dark:border-white/10">
          {rules.map((item) => <li key={item.rule} className="flex items-start gap-3 px-3 py-2">
            <span className="w-16 shrink-0 font-mono font-semibold">{item.rule}</span>
            <span className="min-w-0 flex-1">{item.note || "—"}<span className="block text-[10px] text-zinc-500">{describe(item.rule)}</span></span>
            {canEdit ? <button type="button" className="text-zinc-500 underline" onClick={() => setRules(rules.filter((other) => other.rule !== item.rule))}>Quitar</button> : null}
          </li>)}
          {!rules.length ? <li className="px-3 py-6 text-center text-zinc-500">Sin exclusiones: cuentan todos los centros de costo.</li> : null}
        </ul>
        {canEdit ? <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => {
          event.preventDefault();
          if (!valid) return;
          setRules([...rules, { rule: draft.rule.trim(), note: draft.note.trim() || null }].sort((a, b) => a.rule.localeCompare(b.rule)));
          setDraft({ rule: "", note: "" });
        }}>
          <label className="text-[10px] text-zinc-500">Regla<input value={draft.rule} onChange={(event) => setDraft({ ...draft, rule: event.target.value })} placeholder="06, *-34 o 04-16-16" aria-invalid={Boolean(draft.rule) && !valid}
            className="mt-1 block w-40 border border-black/15 bg-transparent px-2 py-1.5 font-mono dark:border-white/15" /></label>
          <label className="min-w-[200px] flex-1 text-[10px] text-zinc-500">Motivo<input value={draft.note} onChange={(event) => setDraft({ ...draft, note: event.target.value })}
            className="mt-1 block w-full border border-black/15 bg-transparent px-2 py-1.5 dark:border-white/15" /></label>
          <button type="submit" disabled={!valid} className="border border-black/15 px-3 py-1.5 disabled:opacity-40 dark:border-white/15">Agregar</button>
        </form> : null}
        {error ? <p role="alert" className="text-red-700 dark:text-red-400">{error}</p> : null}
        <div className="flex justify-end gap-2 border-t border-black/10 pt-3 dark:border-white/10">
          <button type="button" className="border border-black/15 px-3 py-1.5 dark:border-white/15" onClick={onClose}>{canEdit ? "Cancelar" : "Cerrar"}</button>
          {canEdit ? <button type="button" disabled={!changed || saving || !exclusions.stored} className="border border-zinc-950 bg-zinc-950 px-3 py-1.5 font-semibold text-white disabled:opacity-40 dark:border-white dark:bg-white dark:text-zinc-950"
            onClick={async () => {
              setSaving(true); setError(null);
              try { await onSave(rules); onClose(); } catch (err) { setError(err instanceof Error ? err.message : "No se pudieron guardar las exclusiones."); }
              finally { setSaving(false); }
            }}>{saving ? "Guardando…" : "Guardar y recalcular"}</button> : null}
        </div>
      </div>
    </Modal>
  );
}
