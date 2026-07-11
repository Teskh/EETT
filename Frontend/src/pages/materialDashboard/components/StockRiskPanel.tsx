import { formatCondensedDate, formatNumber } from "../formatters";
import type { StockRiskAssessment, StockRiskLevel, StockRiskScenario } from "../stockRisk";
import { STOCK_RISK_HORIZON_BUSINESS_DAYS } from "../stockRisk";

const LEVEL_META: Record<
  StockRiskLevel,
  { label: string; pillClasses: string; accentClasses: string; barClasses: string }
> = {
  critical: {
    label: "Crítico",
    pillClasses: "bg-red-600 text-white dark:bg-red-500",
    accentClasses: "text-red-700 dark:text-red-300",
    barClasses: "bg-red-500",
  },
  warning: {
    label: "Atención",
    pillClasses: "bg-amber-500 text-white",
    accentClasses: "text-amber-700 dark:text-amber-300",
    barClasses: "bg-amber-500",
  },
  ok: {
    label: "Cubierto",
    pillClasses: "bg-emerald-600 text-white dark:bg-emerald-500",
    accentClasses: "text-emerald-700 dark:text-emerald-300",
    barClasses: "bg-emerald-500",
  },
  no_consumption: {
    label: "Sin consumo",
    pillClasses: "bg-zinc-200 text-zinc-700 dark:bg-white/10 dark:text-zinc-300",
    accentClasses: "text-zinc-600 dark:text-zinc-300",
    barClasses: "bg-zinc-400",
  },
};

const SCENARIO_LABELS: Record<StockRiskScenario["key"], string> = {
  historical: "Ritmo histórico",
  estimated: "Ritmo proyecto",
};

function RiskRow({ label, value, hint, emphasized }: { label: string; value: React.ReactNode; hint?: string; emphasized?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1" title={hint}>
      <div className="text-xs font-medium text-zinc-500">{label}</div>
      <div className={`text-right text-sm ${emphasized ? "font-bold" : "font-semibold"} text-zinc-900 dark:text-white`}>{value}</div>
    </div>
  );
}

function formatRunwayDays(days: number | null) {
  if (days === null) {
    return `+${STOCK_RISK_HORIZON_BUSINESS_DAYS}`;
  }
  return formatNumber(days, 0);
}

function ScenarioChip({ scenario, isWorst, unitLabel }: { scenario: StockRiskScenario; isWorst: boolean; unitLabel?: string | null }) {
  const runway = scenario.withArrivals;
  return (
    <div
      className={`rounded-lg border px-2.5 py-1.5 text-[11px] leading-4 ${
        isWorst
          ? "border-black/15 bg-white font-semibold text-zinc-800 dark:border-white/20 dark:bg-white/[0.06] dark:text-zinc-100"
          : "border-black/5 bg-white/60 text-zinc-500 dark:border-white/10 dark:bg-white/[0.02] dark:text-zinc-400"
      }`}
      title={`Consumo diario usado: ${formatNumber(scenario.dailyRate)} ${unitLabel || ""}/día hábil. Sin contar OC pendientes el quiebre sería el ${formatCondensedDate(scenario.withoutArrivals.stockoutDate) || "—"}.`}
    >
      <span className="block truncate">{SCENARIO_LABELS[scenario.key]}</span>
      <span className="block font-mono whitespace-nowrap">{formatNumber(scenario.dailyRate)}/d</span>
      <span className="block font-mono whitespace-nowrap">
        → {runway.stockoutDate ? formatCondensedDate(runway.stockoutDate) : `+${STOCK_RISK_HORIZON_BUSINESS_DAYS} d`}
      </span>
    </div>
  );
}

export function StockRiskPanel({
  assessment,
  unitLabel,
  loading,
}: {
  assessment: StockRiskAssessment | null;
  unitLabel?: string | null;
  loading: boolean;
}) {
  if (!assessment) {
    return (
      <div className="border-b border-black/10 p-5 dark:border-white/10">
        <h3 className="mb-3 text-[10px] font-bold uppercase tracking-[0.25em] text-zinc-500">Riesgo de Quiebre</h3>
        <p className="text-xs text-zinc-500">{loading ? "Calculando proyección de stock..." : "Sin datos de stock para proyectar el quiebre."}</p>
      </div>
    );
  }

  const meta = LEVEL_META[assessment.level];
  const worst = assessment.worst;
  const worstRunway = worst?.withArrivals ?? null;
  const runwayWithoutArrivals = worst?.withoutArrivals ?? null;
  const arrivalsChangeOutcome =
    worstRunway && runwayWithoutArrivals && worstRunway.stockoutDate !== runwayWithoutArrivals.stockoutDate;

  return (
    <div className="border-b border-black/10 p-5 dark:border-white/10">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-[10px] font-bold uppercase tracking-[0.25em] text-zinc-500">Riesgo de Quiebre</h3>
        <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] ${meta.pillClasses}`}>
          {meta.label}
        </span>
      </div>

      {worst && worstRunway ? (
        <>
          <div className="flex items-baseline gap-2">
            <span className={`text-3xl font-light tracking-tight ${meta.accentClasses}`}>{formatRunwayDays(worstRunway.businessDaysUntilStockout)}</span>
            <span className="text-xs font-medium text-zinc-500">días hábiles de cobertura</span>
          </div>

          <div className="mt-3 divide-y divide-black/5 dark:divide-white/5">
            <RiskRow
              label="Quiebre proyectado"
              value={
                worstRunway.stockoutDate ? (
                  <span className={meta.accentClasses}>{formatCondensedDate(worstRunway.stockoutDate)}</span>
                ) : (
                  <span>Fuera de horizonte</span>
                )
              }
              hint={`Fecha en que el stock llega a cero al ritmo más exigente disponible, contando las OC pendientes con fecha de entrega. Horizonte: ${STOCK_RISK_HORIZON_BUSINESS_DAYS} días hábiles.`}
            />
            {arrivalsChangeOutcome ? (
              <RiskRow
                label="Sin OC pendientes"
                value={runwayWithoutArrivals?.stockoutDate ? formatCondensedDate(runwayWithoutArrivals.stockoutDate) : "Fuera de horizonte"}
                hint="Quiebre proyectado si no llegara ninguna OC pendiente."
              />
            ) : null}
            {assessment.latestSafeOrderDate ? (
              <RiskRow
                label="Ordenar antes de"
                value={<span className={meta.accentClasses}>{formatCondensedDate(assessment.latestSafeOrderDate)}</span>}
                hint="Última fecha para emitir una OC que alcance a llegar antes del quiebre proyectado, según el plazo de entrega seleccionado."
                emphasized
              />
            ) : null}
            {assessment.earliestReplenishmentDate ? (
              <RiskRow
                label="Llegada si ordenas hoy"
                value={formatCondensedDate(assessment.earliestReplenishmentDate)}
                hint="Fecha estimada de recepción de una OC emitida hoy, según el plazo de entrega seleccionado."
              />
            ) : null}
            {assessment.suggestedOrderQuantity !== null && assessment.suggestedOrderQuantity > 0 ? (
              <RiskRow
                label="Cantidad sugerida"
                value={`${formatNumber(assessment.suggestedOrderQuantity, 0)} ${unitLabel || ""}`.trim()}
                hint="Cubre plazo de entrega + buffer al ritmo más exigente, descontando stock y OC pendientes con fecha."
                emphasized
              />
            ) : null}
          </div>

          {assessment.scenarios.length ? (
            <div className="mt-3 grid grid-cols-2 gap-2">
              {assessment.scenarios.map((scenario) => (
                <ScenarioChip key={scenario.key} scenario={scenario} isWorst={scenario.key === worst.key} unitLabel={unitLabel} />
              ))}
              {assessment.scenarios.length === 1 ? (
                <div className="rounded-lg border border-dashed border-black/10 px-2.5 py-1.5 text-[11px] leading-4 text-zinc-400 dark:border-white/10">
                  {assessment.scenarios[0].key === "historical"
                    ? "Ritmo según proyecto disponible en la vista Viviendas con vinculación configurada."
                    : "Sin ritmo histórico en el rango."}
                </div>
              ) : null}
            </div>
          ) : null}
        </>
      ) : (
        <p className="text-xs leading-5 text-zinc-500">
          No hay consumo activo (histórico ni estimado por proyecto) para proyectar un quiebre de stock en este estudio.
        </p>
      )}

      {assessment.overduePendingQuantity > 0 || assessment.unscheduledPendingQuantity > 0 ? (
        <p className="mt-3 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] leading-4 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
          {assessment.overduePendingQuantity > 0
            ? `${formatNumber(assessment.overduePendingQuantity)} pendiente con entrega vencida. `
            : ""}
          {assessment.unscheduledPendingQuantity > 0
            ? `${formatNumber(assessment.unscheduledPendingQuantity)} pendiente sin fecha de entrega. `
            : ""}
          La proyección no cuenta con esas cantidades.
        </p>
      ) : null}
    </div>
  );
}
