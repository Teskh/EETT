import { useMemo, useState } from "react";
import { Modal } from "../../components/Modal";
import type { CostModelTimeline } from "../../lib/types";

type Range = { startDate: string; endDate: string };

const DAY = 24 * 60 * 60 * 1000;
const toTime = (value: string) => Date.parse(`${value}T00:00:00Z`);
const toDay = (time: number) => new Date(time).toISOString().slice(0, 10);
const weekOf = (value: string) => {
  const time = toTime(value);
  const weekday = (new Date(time).getUTCDay() + 6) % 7;
  return toDay(time - weekday * DAY);
};
const monthLabel = new Intl.DateTimeFormat("es-CL", { month: "short", year: "2-digit", timeZone: "UTC" });

/**
 * Weekly house starts of every project, to pick a period where the project's
 * houses dominate production. Drag across weeks to select a period.
 */
export function ProductionTimeline({ timeline, projectId, projectName, range, onApply, onClose }: {
  timeline: CostModelTimeline; projectId: number; projectName: string; range: Range;
  onApply: (range: Range) => void; onClose: () => void;
}) {
  const weeks = useMemo(() => {
    if (!timeline.data_start || !timeline.data_end) return [];
    const out: string[] = [];
    for (let time = toTime(weekOf(timeline.data_start)); time <= toTime(timeline.data_end); time += 7 * DAY) out.push(toDay(time));
    return out;
  }, [timeline.data_start, timeline.data_end]);
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const week of timeline.weeks) for (const item of week.starts) map.set(`${week.week}|${item.key}`, item.houses);
    return map;
  }, [timeline.weeks]);
  const rows = useMemo(() => [...timeline.groups].sort((a, b) =>
    Number(b.project_id === projectId) - Number(a.project_id === projectId)), [timeline.groups, projectId]);
  const share = weeks.map((week) => {
    let target = 0, total = 0;
    for (const group of timeline.groups) {
      const value = counts.get(`${week}|${group.key}`) ?? 0;
      total += value;
      if (group.project_id === projectId) target += value;
    }
    return { target, total };
  });
  const max = Math.max(1, ...Array.from(counts.values()));
  const indexOf = (value: string) => weeks.indexOf(weekOf(value));
  const suggested = timeline.suggested ? [indexOf(timeline.suggested.start_date), indexOf(timeline.suggested.end_date)] : null;
  const [selection, setSelection] = useState<[number, number] | null>(() => {
    const start = indexOf(range.startDate), end = indexOf(range.endDate);
    return start >= 0 && end >= 0 ? [start, end] : null;
  });
  const [anchor, setAnchor] = useState<number | null>(null);
  const [low, high] = selection ? [Math.min(...selection), Math.max(...selection)] : [-1, -1];
  const selected = selection ? share.slice(low, high + 1).reduce((sum, item) => ({ target: sum.target + item.target, total: sum.total + item.total }), { target: 0, total: 0 }) : null;
  const selectedRange = selection ? { startDate: weeks[low], endDate: toDay(toTime(weeks[high]) + 4 * DAY) } : null;
  const columns = { gridTemplateColumns: `repeat(${weeks.length}, minmax(6px, 1fr))` };
  const inside = (index: number, bounds: number[] | null) => bounds !== null && index >= Math.min(...bounds) && index <= Math.max(...bounds);
  const label = (group: CostModelTimeline["groups"][number]) => group.project_id === null ? "Sin vincular"
    : `${group.project_name ?? "Proyecto"}${group.subtype_name ? ` · ${group.subtype_name}` : ""}`;
  const pick = (index: number) => { if (anchor !== null) setSelection([anchor, index]); };

  return (
    <Modal open title="Elegir período" kicker={projectName} kickerIcon={<i className="ph-bold ph-calendar" />} onClose={onClose} panelClassName="max-w-6xl">
      <div className="space-y-4 text-xs text-zinc-700 dark:text-zinc-300">
        <p className="text-zinc-500">Viviendas iniciadas por semana. El período más confiable es el que concentra viviendas de este proyecto y pocas de otros. Arrastra sobre las semanas para elegirlo.</p>
        {!weeks.length ? <p className="py-8 text-center text-zinc-500">No hay producción registrada.</p> : <div className="overflow-x-auto">
          <div className="grid min-w-[760px] grid-cols-[200px_1fr] gap-x-2 select-none" onPointerUp={() => setAnchor(null)} onPointerLeave={() => setAnchor(null)}>
            <span className="self-end pb-1 text-[10px] text-zinc-500" title="Viviendas del proyecto sobre el total de viviendas iniciadas esa semana">Participación del proyecto</span>
            <div className="grid h-8 items-end" style={columns}>
              {share.map((item, index) => <div key={weeks[index]} className="h-full border-r border-transparent" title={`${weeks[index]}: ${item.target} de ${item.total}`}>
                <div className="flex h-full items-end"><div className="w-full bg-red-600/70" style={{ height: `${item.total ? item.target / item.total * 100 : 0}%` }} /></div>
              </div>)}
            </div>
            {rows.map((group) => {
              const target = group.project_id === projectId;
              return [
                <span key={`${group.key}-label`} className={`truncate py-px text-[11px] ${target ? "font-semibold text-zinc-950 dark:text-white" : "text-zinc-500"}`} title={`${label(group)} · ${group.houses} viviendas`}>{label(group)}</span>,
                <div key={`${group.key}-cells`} className="grid" style={columns}>
                  {weeks.map((week, index) => {
                    const value = counts.get(`${week}|${group.key}`) ?? 0;
                    const intensity = value ? 0.2 + 0.8 * value / max : 0;
                    return <div key={week} role="presentation"
                      onPointerDown={() => { setAnchor(index); setSelection([index, index]); }} onPointerEnter={() => pick(index)}
                      className={`h-4 cursor-crosshair border-r border-white/60 dark:border-zinc-950/60 ${inside(index, selection) ? "outline outline-1 -outline-offset-1 outline-zinc-900/40 dark:outline-white/40" : ""}`}
                      style={{ backgroundColor: value ? (target ? `rgba(220, 38, 38, ${intensity})` : `rgba(113, 113, 122, ${intensity})`) : inside(index, selection) ? "rgba(113,113,122,0.08)" : undefined }}
                      title={`${label(group)} · semana del ${week}: ${value} viviendas`} />;
                  })}
                </div>,
              ];
            })}
            <span />
            <div className="relative mt-1 h-3 text-[10px] text-zinc-500">
              {suggested ? <div className="absolute top-0 h-1 bg-emerald-500" title="Período sugerido" style={{ left: `${suggested[0] / weeks.length * 100}%`, width: `${(suggested[1] - suggested[0] + 1) / weeks.length * 100}%` }} /> : null}
            </div>
            <span />
            <div className="grid text-[10px] text-zinc-500" style={columns}>
              {weeks.map((week, index) => <span key={week} className="overflow-visible whitespace-nowrap">{index === 0 || week.slice(5, 7) !== weeks[index - 1].slice(5, 7) ? monthLabel.format(new Date(toTime(week))) : ""}</span>)}
            </div>
          </div>
        </div>}
        <div className="flex flex-wrap items-center gap-2 border-t border-black/10 pt-3 dark:border-white/10">
          <span className="mr-auto">
            {selectedRange && selected ? <>Selección: <strong>{selectedRange.startDate}</strong> a <strong>{selectedRange.endDate}</strong> · {selected.target} viviendas del proyecto de {selected.total} ({selected.total ? Math.round(selected.target / selected.total * 100) : 0}%)</> : "Arrastra sobre las semanas para elegir un período."}
            {timeline.data_start ? <span className="block text-[10px] text-zinc-500">El registro de producción comienza el {timeline.data_start}. <span className="inline-block h-1 w-3 bg-emerald-500 align-middle" /> Período sugerido.</span> : null}
          </span>
          {timeline.suggested ? <button type="button" className="border border-black/15 px-3 py-1.5 dark:border-white/15" onClick={() => onApply({ startDate: timeline.suggested!.start_date, endDate: timeline.suggested!.end_date })}>Usar sugerido</button> : null}
          <button type="button" disabled={!selectedRange} className="border border-zinc-950 bg-zinc-950 px-3 py-1.5 font-semibold text-white disabled:opacity-40 dark:border-white dark:bg-white dark:text-zinc-950" onClick={() => selectedRange && onApply(selectedRange)}>Consultar este período</button>
        </div>
      </div>
    </Modal>
  );
}
