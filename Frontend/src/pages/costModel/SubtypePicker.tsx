import { useEffect, useRef, useState } from "react";

type Option = { id: number; name: string; weight: number | null; houses: number | null };

/**
 * One or more subtypes to analyze together. The period's mix weights them;
 * each subtype keeps its own saved budget.
 */
export function SubtypePicker({ options, selected, onChange, disabled, className, note }: {
  options: Option[]; selected: number[]; onChange: (ids: number[]) => void; disabled: boolean; className: string;
  /** Why the weights are what they are, e.g. equal because a subtype has no houses in the period. */
  note: string | null;
}) {
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
  const chosen = options.filter((option) => selected.includes(option.id));
  const label = chosen.length === options.length && options.length > 1 ? `Todas (${options.length})` : chosen.map((option) => option.name).join(" + ") || "Elegir";
  const percent = (value: number | null) => value === null ? "" : `${Math.round(value * 100)}%`;
  const toggle = (id: number) => {
    const next = selected.includes(id) ? selected.filter((value) => value !== id) : [...selected, id];
    if (next.length) onChange(options.filter((option) => next.includes(option.id)).map((option) => option.id));
  };
  return <div ref={root} className="relative">
    <button id="budget-subtype" type="button" aria-haspopup="true" aria-expanded={open} disabled={disabled} onClick={() => setOpen(!open)}
      title={chosen.length > 1 ? `Mezcla: ${chosen.map((option) => `${option.name} ${percent(option.weight)}`).join(" · ")}` : undefined}
      className={`${className} flex w-[200px] max-w-full items-center justify-between gap-2 text-left`}>
      <span className="truncate">{label}</span><i className="ph ph-caret-down text-xs" aria-hidden="true" />
    </button>
    {open ? <div role="dialog" aria-label="Subtipologías" className="absolute left-0 top-full z-30 mt-1 w-72 border border-black/15 bg-white p-2 text-xs shadow-lg dark:border-white/15 dark:bg-zinc-900">
      {options.length > 1 ? <label className="flex cursor-pointer items-center gap-2 border-b border-black/10 px-2 py-1.5 font-medium dark:border-white/10">
        <input type="checkbox" checked={chosen.length === options.length} onChange={() => onChange(chosen.length === options.length ? [options[0].id] : options.map((option) => option.id))} />
        Todas</label> : null}
      {options.map((option) => <label key={option.id} className="flex cursor-pointer items-center gap-2 px-2 py-1.5 hover:bg-black/5 dark:hover:bg-white/5">
        <input type="checkbox" checked={selected.includes(option.id)} onChange={() => toggle(option.id)} />
        <span className="min-w-0 flex-1 truncate">{option.name}</span>
        <span className="font-mono text-[10px] tabular-nums text-zinc-500">{option.houses === null ? "" : `${option.houses} viv.`}{selected.includes(option.id) && chosen.length > 1 ? ` · ${percent(option.weight)}` : ""}</span>
      </label>)}
      <p className="mt-1 border-t border-black/10 px-2 pt-2 text-[10px] text-zinc-500 dark:border-white/10">
        {note ?? "Con varias, cada material se promedia según las viviendas de cada una en el período. Los cambios se guardan en cada subtipología."}</p>
    </div> : null}
  </div>;
}
