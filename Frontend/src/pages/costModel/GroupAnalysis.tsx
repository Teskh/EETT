import { useEffect, useState } from "react";
import { Modal } from "../../components/Modal";
import { api } from "../../lib/api";
import type { CostModelStudy, MaterialStudyGroupRow, QuantityBasis } from "../../lib/types";
import type { BudgetLine } from "./budget";
import { ConsumptionTrend, type TrendTotals } from "./ConsumptionTrend";
import { formatChange, formatMoney, formatQuantity2, sourceLabels } from "./format";
import { groupBudget, groupHistoric, type ExtraMark, type MemberBudgetSource } from "./groupValidation";
import { quantityCost } from "./model";

type Range = { startDate: string; endDate: string };

const sum = (values: (number | null)[]) => values.some((value) => value === null) ? null : values.reduce<number>((total, value) => total + (value as number), 0);

/** Average ERP price of members the budget does not price, e.g. a substitute outside the BOM. */
function useMissingPrices(skus: string[]) {
  const [prices, setPrices] = useState<Record<string, number | null>>({});
  const key = skus.join("|");
  useEffect(() => {
    if (!skus.length) return;
    let active = true;
    Promise.all(skus.map((sku) => api.getMaterialDashboardDetail(sku).then((detail) => [sku, detail.average_price] as const).catch(() => [sku, null] as const)))
      .then((entries) => { if (active) setPrices(Object.fromEntries(entries)); });
    return () => { active = false; };
  }, [key]);
  return prices;
}

export type UnbudgetedMark = ExtraMark;

const budgetSourceLabels: Record<MemberBudgetSource, string> = {
  ...sourceLabels, extra_included: "Fuera de presup. · incluido", extra_excluded: "Fuera de presup. · excluido", none: "No se presupuesta",
};
/** Budget within this share of the historic consumption covers it. */
const COVERAGE_TOLERANCE = 0.1;

/**
 * The material's dashboard group as one material: its members in this
 * subtype, what the budget counts for each, and what each historically
 * consumed in the study's terms (excluded cost centers left out), at each
 * member's own price. Nothing is saved from here.
 */
export function GroupAnalysis({ group, lines, unbudgeted, study, excludedCecos, unsupportedRules = [], basis = "factory", subtypeName, range, disabled, onRangeChange, onClose }: {
  group: MaterialStudyGroupRow; lines: BudgetLine[]; unbudgeted: Map<string, UnbudgetedMark>; study: CostModelStudy | null;
  /** The study's excluded cost centers, as dashboard filters for the chart. */
  excludedCecos: string[];
  /** Exclusion rules the dashboard cannot apply (e.g. a site in every area). */
  unsupportedRules?: string[];
  /** The dashboard's expected line follows Q_fábrica: under another basis the chart shows withdrawals only. */
  basis?: QuantityBasis;
  subtypeName: string; range: Range; disabled: boolean;
  onRangeChange: (range: Range) => void; onClose: () => void;
}) {
  const [totals, setTotals] = useState<TrendTotals | null>(null);
  const bySku = new Map(lines.map((line) => [line.row.sku.trim().toUpperCase(), line]));
  const priceOf = (line: BudgetLine | null) => line?.row.price && line.row.price > 0 ? line.row.price : null;
  const ordered = [...group.members].sort((a, b) => a.display_order - b.display_order).map((member) => ({ member, key: member.sku.trim().toUpperCase(), line: bySku.get(member.sku.trim().toUpperCase()) ?? null }));
  const erpPrices = useMissingPrices(ordered.filter((item) => priceOf(item.line) === null).map((item) => item.key));
  const skus = ordered.map((item) => item.key);
  // What the current configuration counts for the group, and what it historically consumed.
  const current = groupBudget(skus, lines, unbudgeted);
  const history = groupHistoric(skus, lines, study);
  const memberBudget = new Map(current.members.map((item) => [item.sku, item]));
  const memberHistory = new Map(history.members.map((item) => [item.sku, item]));
  // The chart's withdrawals per house in its selection, at each member's own price.
  const members = ordered.map((item) => {
    const price = priceOf(item.line) ?? erpPrices[item.key] ?? null;
    const actual = totals?.bySku && totals.houses > 0 ? (totals.bySku[item.key] ?? 0) / totals.houses : null;
    return { ...item, price, actualCost: quantityCost(actual, price), extra: unbudgeted.get(item.key) ?? null };
  });
  const budgeted = members.filter((item) => item.line !== null) as { member: typeof members[number]["member"]; line: BudgetLine }[];
  const inStudyUnit = (quantity: number | null, factor: number) => quantity === null ? null : quantity * factor;
  const estimatedCost = sum(budgeted.map(({ line }) => line.estimatedCost));
  const ratio = totals && totals.expected > 0 ? totals.consumed / totals.expected : null;
  const chartCost = totals?.bySku ? members.reduce((total, item) => total + (item.actualCost ?? 0), 0) : null;
  const historicCost = history.total;
  const coverage = historicCost !== null && historicCost > 0 && current.total !== null ? current.total / historicCost - 1 : null;
  const validated = lines.find((line) => line.groupValidation?.groupId === group.group_id)?.groupValidation ?? null;
  // Substitutes counted while the BOM members stay at their estimate: the material may be budgeted twice.
  const doubled = current.outsideCount > 0 && coverage !== null && coverage > COVERAGE_TOLERANCE
    && budgeted.some(({ line }) => line.source === "estimated" && line.historic !== null && line.estimate !== null && line.historic < line.estimate);
  const incomplete = budgeted.filter(({ line }) => line.estimate === null || line.missingSubtypes.length);
  const unattributedNote = history.unattributed.length
    ? `Sin histórica atribuible a ${subtypeName}: ${history.unattributed.join(", ")} (p. ej., la otra mano de una puerta cuando producción no distingue subtipologías). El histórico del grupo no los incluye.` : null;

  return (
    <Modal open title={group.name} kicker={`Grupo · ${group.study_unit}`} kickerIcon={<i className="ph-bold ph-stack" />} onClose={onClose} panelClassName="max-w-5xl">
      <div className="space-y-5 text-xs text-zinc-700 dark:text-zinc-300">
        <p className="text-zinc-500">{group.description ? `${group.description} · ` : ""}Analiza los miembros como un solo material, en {group.study_unit}. Útil cuando se reemplazan entre sí y por separado cada uno parece sobre o subconsumido. No cambia el presupuesto.</p>

        {/* At a glance: what the current configuration budgets for the group against what it historically consumed. */}
        <dl aria-label="Presupuesto actual del grupo" className="grid grid-cols-1 gap-x-6 gap-y-3 border border-black/10 p-4 dark:border-white/10 sm:grid-cols-3">
          <Figure label="Presupuesto actual del grupo / viv." value={formatMoney(current.total)}
            detail={`BOM ${formatMoney(current.bom)}${current.outsideCount ? ` + fuera de presup. ${formatMoney(current.outside)} (${current.outsideCount})` : ""}`}
            title="Lo que cuenta hoy el presupuesto de la selección: cada miembro del BOM con su fuente (estimada, histórica o manual) y los miembros fuera del BOM incluidos en «Fuera de presupuesto»." />
          <Figure label="Histórico del grupo / viv." value={study ? formatMoney(historicCost) : "…"}
            detail={history.unattributed.length ? `Parcial · sin ${history.unattributed.join(", ")}` : "Estudio del período, sin centros excluidos"}
            title="Consumo histórico del estudio: la «Histórica» de cada miembro del BOM y lo medido en «Fuera de presupuesto» para los demás, a su precio. Sin los centros de costo excluidos." />
          <div className="min-w-0" title="Presupuesto actual menos histórico del grupo, por vivienda.">
            <dt className="text-[10px] text-zinc-500">Presupuesto vs histórico</dt>
            <dd className={`font-mono text-sm font-semibold tabular-nums ${coverage === null ? "text-zinc-950 dark:text-white" : Math.abs(coverage) <= COVERAGE_TOLERANCE ? "text-emerald-700 dark:text-emerald-400" : coverage < 0 ? "text-red-700 dark:text-red-400" : "text-amber-700 dark:text-amber-400"}`}>
              {coverage === null || historicCost === null || current.total === null ? "—" : `${formatChange(current.total - historicCost)} (${coverage > 0 ? "+" : coverage < 0 ? "−" : ""}${(Math.round(Math.abs(coverage) * 1000) / 10).toLocaleString("es-CL")}%)`}</dd>
            <dd className="text-[10px] text-zinc-500">{coverage === null ? study ? "Sin consumo histórico" : "Cargando referencia histórica…"
              : Math.abs(coverage) <= COVERAGE_TOLERANCE ? "El presupuesto cubre el histórico" : coverage < 0 ? "El presupuesto queda bajo el histórico"
              : doubled ? "Sobre el histórico: posible doble conteo" : "El presupuesto queda sobre el histórico"}</dd>
          </div>
          {validated || doubled || unattributedNote ? <p className="text-[10px] text-zinc-500 sm:col-span-3">
            {validated ? `Históricas validadas por este grupo: con sus reemplazos, consumió ×${validated.ratio.toLocaleString("es-CL", { maximumFractionDigits: 2 })} de lo estimado. ` : ""}
            {doubled ? "Hay miembros fuera del BOM incluidos mientras los del BOM siguen en su estimada: el mismo material podría contarse dos veces. Usa la histórica en los miembros del BOM o excluye el reemplazo. " : ""}
            {unattributedNote ?? ""}</p> : null}
        </dl>

        {/* Estimate, current budget and history, all in the group's unit. */}
        <table className="w-full">
          <thead className="text-[10px] text-zinc-500">
            <tr>{[
              ["Miembro", ""],
              [`1 un. = ${group.study_unit}`, "Factor de conversión a la unidad del grupo."],
              [`Estimada / viv.`, `Cantidad de la BOM de ${subtypeName}, en ${group.study_unit}.`],
              [`Presup. / viv.`, `Cantidad que cuenta hoy el presupuesto, en ${group.study_unit}, y de dónde sale.`],
              [`Histórica / viv.`, `Consumo histórico del estudio, en ${group.study_unit}, sin centros excluidos: la «Histórica» de la tabla o lo medido en «Fuera de presupuesto».`],
              ["Costo estimado", ""],
              ["Costo presup.", "Lo que cuenta hoy el presupuesto para el miembro."],
              ["Costo histórico", "Histórica a su precio."],
            ].map(([label, title], index) =>
              <th key={label} title={title || undefined} className={`border-b border-black/10 px-2 py-2 font-semibold dark:border-white/10 ${index ? "text-right" : "text-left"}`}>{label}</th>)}</tr>
          </thead>
          <tbody>{members.map(({ member, key, line, extra }) => {
            const budget = memberBudget.get(key);
            const past = memberHistory.get(key);
            return <tr key={member.sku} className="border-b border-black/[0.06] dark:border-white/[0.06]">
              <td className="px-2 py-2"><p className="font-medium text-zinc-950 dark:text-white">{member.material_name}</p><p className="text-[10px] text-zinc-500">{member.sku} · {member.unit || "un"}</p>
                {!line ? <p className="text-[10px] text-zinc-500">No está en el presupuesto de {subtypeName}</p> : null}
                {extra && line ? <p className="text-[10px] text-amber-700 dark:text-amber-400">También en «Fuera de presupuesto» · {extra.included ? `incluido, ${formatMoney(extra.valuePerHouse)}/viv.` : "excluido"}</p> : null}</td>
              <td className="px-2 py-2 text-right font-mono tabular-nums">{formatQuantity2(member.factor_to_study_unit)}</td>
              <td className="px-2 py-2 text-right font-mono tabular-nums">{line ? formatQuantity2(inStudyUnit(line.estimate, member.factor_to_study_unit)) : "—"}
                {line?.missingSubtypes.length ? <span className="block text-[10px] font-sans text-amber-700 dark:text-amber-400">Sin cantidad en {line.missingSubtypes.join(", ")}</span> : null}</td>
              <td className="px-2 py-2 text-right font-mono tabular-nums">{formatQuantity2(inStudyUnit(budget?.quantity ?? null, member.factor_to_study_unit))}
                {budget ? <span className={`block text-[10px] font-sans ${budget.source === "extra_included" ? "text-amber-700 dark:text-amber-400" : budget.source === "historic_allocated" ? "text-emerald-700 dark:text-emerald-400" : "text-zinc-500"}`}>{budgetSourceLabels[budget.source]}</span> : null}</td>
              <td className="px-2 py-2 text-right font-mono tabular-nums">{study ? formatQuantity2(inStudyUnit(past?.quantity ?? null, member.factor_to_study_unit)) : "…"}
                {past?.source === "unattributed" ? <span className="block text-[10px] font-sans text-amber-700 dark:text-amber-400" title={unattributedNote ?? undefined}>Sin atribución</span>
                  : past?.source === "outside" ? <span className="block text-[10px] font-sans text-zinc-500">Fuera de presup.</span> : null}</td>
              <td className="px-2 py-2 text-right font-mono tabular-nums text-zinc-500">{line ? formatMoney(line.estimatedCost) : "—"}</td>
              <td className="px-2 py-2 text-right font-mono tabular-nums">{formatMoney(budget?.cost ?? null)}</td>
              <td className="px-2 py-2 text-right font-mono font-semibold tabular-nums">{study ? formatMoney(past?.cost ?? null) : "…"}</td>
            </tr>;
          })}</tbody>
          <tfoot><tr className="font-semibold">
            <td className="px-2 py-2" colSpan={2}>Grupo</td>
            <td className="px-2 py-2 text-right font-mono tabular-nums">{formatQuantity2(sum(budgeted.map(({ member, line }) => inStudyUnit(line.estimate, member.factor_to_study_unit))))}</td>
            <td className="px-2 py-2 text-right font-mono tabular-nums">{formatQuantity2(sum(members.map((item) => inStudyUnit(memberBudget.get(item.key)?.quantity ?? 0, item.member.factor_to_study_unit))))}</td>
            <td className="px-2 py-2 text-right font-mono tabular-nums">{study ? formatQuantity2(members.reduce((total, item) => total + (inStudyUnit(memberHistory.get(item.key)?.quantity ?? null, item.member.factor_to_study_unit) ?? 0), 0)) : "…"}</td>
            <td className="px-2 py-2 text-right font-mono tabular-nums text-zinc-500">{formatMoney(estimatedCost)}</td>
            <td className="px-2 py-2 text-right font-mono tabular-nums">{formatMoney(current.total)}</td>
            <td className="px-2 py-2 text-right font-mono tabular-nums">{study ? formatMoney(historicCost) : "…"}</td>
          </tr></tfoot>
        </table>

        <ConsumptionTrend sku={group.sku} name={group.name} unit={group.study_unit} groupId={group.group_id} excludedCecos={excludedCecos} basis={basis} showExpected={basis === "factory"} embedded range={range} disabled={disabled}
          onRangeChange={onRangeChange} onTotals={setTotals} />

        <section className="border border-black/10 p-4 dark:border-white/10" aria-label="Consumo del gráfico">
          <p className="font-semibold text-zinc-950 dark:text-white">Según el gráfico</p>
          {basis !== "factory" ? <p className="mt-2 text-zinc-500">El esperado del gráfico sigue Q_fábrica: con esta base, compara el presupuesto con el histórico del resumen, que sí sigue la base y sus centros excluidos.</p>
            : ratio === null ? <p className="mt-2 text-zinc-500">{totals ? "Sin consumo esperado en la selección: no hay base de comparación." : "Cargando consumo del grupo…"}</p> : <>
            <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
              <Figure label="Real ÷ esperado del grupo" value={`×${ratio.toLocaleString("es-CL", { maximumFractionDigits: 2 })}`} detail={`${formatQuantity2(totals?.consumed ?? null)} / ${formatQuantity2(totals?.expected ?? null)} ${group.study_unit}`} />
              <Figure label="Retirado / viv. iniciada" value={formatMoney(chartCost)} detail={`Cada miembro a su precio · ${formatChange(chartCost === null || estimatedCost === null ? null : chartCost - estimatedCost)} vs est.`} />
              <Figure label="Histórico del grupo / viv." value={formatMoney(historicCost)} detail="El del resumen, del estudio" />
            </dl>
            <p className="mt-3 text-[10px] text-zinc-500">El gráfico usa los retiros del Material Dashboard sin los centros de costo excluidos{unsupportedRules.length ? ` (no aplica: ${unsupportedRules.join(", ")})` : ""}, divididos por todas las viviendas iniciadas en la selección, de cualquier proyecto. El histórico del resumen reparte el consumo según lo que cada vivienda debía consumir: es la referencia del presupuesto.{incomplete.length ? ` ${incomplete.length} miembro${incomplete.length === 1 ? " tiene" : "s tienen"} la BOM incompleta: el esperado del grupo queda bajo y el ratio, inflado.` : ""}</p>
          </>}
        </section>
      </div>
    </Modal>
  );
}

function Figure({ label, value, detail, title }: { label: string; value: string; detail: string; title?: string }) {
  return <div className="min-w-0" title={title}><dt className="text-[10px] text-zinc-500">{label}</dt><dd className="font-mono text-sm font-semibold tabular-nums text-zinc-950 dark:text-white">{value}</dd><dd className="truncate text-[10px] text-zinc-500">{detail}</dd></div>;
}
