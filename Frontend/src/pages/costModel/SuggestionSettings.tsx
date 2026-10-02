import { useEffect, useRef, useState } from "react";
import { defaultSuggestionCriteria, type SuggestionCriteria } from "./budget";

const storageKey = "cost-model:suggestion-criteria";

/** The viewer's criteria, remembered in this browser only. */
export function useSuggestionCriteria() {
  const [criteria, setCriteria] = useState<SuggestionCriteria>(() => {
    try {
      const stored = JSON.parse(window.localStorage.getItem(storageKey) ?? "null");
      return stored ? { ...defaultSuggestionCriteria, ...stored } : defaultSuggestionCriteria;
    } catch {
      return defaultSuggestionCriteria;
    }
  });
  const update = (next: SuggestionCriteria) => {
    setCriteria(next);
    try { window.localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* per-viewer convenience only */ }
  };
  return [criteria, update] as const;
}

export function describeCriteria(criteria: SuggestionCriteria) {
  return `Diferencia ≥ ${Math.round(criteria.minDeviation * 100)}%, confianza ${criteria.minGrade === "high" ? "alta" : "media o alta"}${criteria.minImpact > 0 ? `, impacto ≥ $${criteria.minImpact.toLocaleString("es-CL")} / viv.` : ""}.`;
}

export function SuggestionSettings({ criteria, onChange, className }: { criteria: SuggestionCriteria; onChange: (next: SuggestionCriteria) => void; className: string }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", close); };
  }, [open]);
  const field = "w-20 border border-black/15 bg-white px-2 py-1 text-right text-xs tabular-nums outline-none focus:border-red-600 dark:border-white/15 dark:bg-zinc-900";
  const customized = JSON.stringify(criteria) !== JSON.stringify(defaultSuggestionCriteria);
  return <div ref={root} className="relative -ml-px">
    <button type="button" aria-label="Criterios de sugerencia" aria-expanded={open} title={`Criterios de sugerencia: ${describeCriteria(criteria)}`}
      className={`${className} relative flex items-center`} onClick={() => setOpen(!open)}>
      <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor" aria-hidden="true"><path fillRule="evenodd" d="M8.34 1.804A1 1 0 0 1 9.32 1h1.36a1 1 0 0 1 .98.804l.295 1.473c.497.144.971.342 1.416.587l1.25-.834a1 1 0 0 1 1.262.125l.962.962a1 1 0 0 1 .125 1.262l-.834 1.25c.245.445.443.919.587 1.416l1.473.295a1 1 0 0 1 .804.98v1.36a1 1 0 0 1-.804.98l-1.473.295a6.95 6.95 0 0 1-.587 1.416l.834 1.25a1 1 0 0 1-.125 1.262l-.962.962a1 1 0 0 1-1.262.125l-1.25-.834a6.953 6.953 0 0 1-1.416.587l-.295 1.473a1 1 0 0 1-.98.804H9.32a1 1 0 0 1-.98-.804l-.295-1.473a6.957 6.957 0 0 1-1.416-.587l-1.25.834a1 1 0 0 1-1.262-.125l-.962-.962a1 1 0 0 1-.125-1.262l.834-1.25a6.957 6.957 0 0 1-.587-1.416l-1.473-.295A1 1 0 0 1 1 10.68V9.32a1 1 0 0 1 .804-.98l1.473-.295c.144-.497.342-.971.587-1.416l-.834-1.25a1 1 0 0 1 .125-1.262l.962-.962A1 1 0 0 1 5.38 3.03l1.25.834a6.957 6.957 0 0 1 1.416-.587l.294-1.473ZM13 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" clipRule="evenodd" /></svg>
      {customized ? <span aria-label="personalizado" className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-red-600" /> : null}
    </button>
    {open ? <div role="dialog" aria-label="Criterios de sugerencia" className="absolute left-0 top-full z-30 mt-1 w-72 border border-black/15 bg-white p-3 text-xs shadow-lg dark:border-white/15 dark:bg-zinc-900">
      <p className="font-semibold">Criterios para sugerir la histórica</p>
      <p className="mt-1 text-[10px] text-zinc-500">Se guarda en este navegador. Afecta a «Aplicar sugerencias», los puntos de «Usar» y los filtros.</p>
      <label className="mt-3 flex items-center justify-between gap-2" title="Diferencia mínima entre el consumo real y el estimado, en cualquier dirección.">Diferencia mínima
        <span className="flex items-center gap-1"><input type="number" min={0} max={100} step={1} className={field} value={Math.round(criteria.minDeviation * 100)}
          onChange={(event) => { const value = Number(event.target.value); if (Number.isFinite(value) && value >= 0) onChange({ ...criteria, minDeviation: value / 100 }); }} />%</span></label>
      <label className="mt-2 flex items-center justify-between gap-2" title="Con «media o alta», los materiales por revisar también se aplican.">Confianza mínima
        <select className={`${field} w-auto text-left`} value={criteria.minGrade} onChange={(event) => onChange({ ...criteria, minGrade: event.target.value as SuggestionCriteria["minGrade"] })}>
          <option value="high">Alta</option><option value="medium">Media o alta</option>
        </select></label>
      <label className="mt-2 flex items-center justify-between gap-2" title="Cambio mínimo en costo por vivienda respecto a la estimación. 0 no filtra por monto.">Impacto mínimo / viv.
        <span className="flex items-center gap-1">$<input type="number" min={0} step={1000} className={`${field} w-24`} value={criteria.minImpact}
          onChange={(event) => { const value = Number(event.target.value); if (Number.isFinite(value) && value >= 0) onChange({ ...criteria, minImpact: value }); }} /></span></label>
      <div className="mt-3 flex justify-end">
        <button type="button" className="text-[10px] underline disabled:opacity-40" disabled={!customized} onClick={() => onChange(defaultSuggestionCriteria)}>Restablecer</button>
      </div>
    </div> : null}
  </div>;
}
