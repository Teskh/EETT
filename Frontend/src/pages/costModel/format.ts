const numbers = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 6 });
const currency = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });
export const formatQuantity = (value: number | null | undefined) => value == null ? "—" : numbers.format(value);
const twoDecimals = new Intl.NumberFormat("es-CL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const formatQuantity2 = (value: number | null | undefined) => value == null ? "—" : twoDecimals.format(value);
export const formatMoney = (value: number | null | undefined) => value == null ? "—" : currency.format(value);
export const formatChange = (value: number | null | undefined) => value == null ? "—" : `${value > 0 ? "+" : value < 0 ? "−" : ""}${currency.format(Math.abs(value))}`;
export const sourceLabels = { estimated: "Estimada", historic_allocated: "Histórica", manual: "Manual", legacy: "Ajuste anterior" };
export const gradeLabels = { high: "Alta", medium: "Media", low: "Baja", none: "—" } as const;
export const gradeDescriptions = {
  high: "Confianza alta: en pruebas con períodos anteriores, la referencia se mantuvo dentro de ~10%.",
  medium: "Confianza media: la referencia varió ~20% entre períodos. Revisa el gráfico antes de adoptarla.",
  low: "Confianza baja: la referencia cambió mucho entre períodos. Conviene mantener la estimación.",
  none: "Sin referencia histórica.",
} as const;
export const studyReasons: Record<string, string> = {
  few_houses: "Pocas viviendas del proyecto en el período.",
  shared_production: "Producción compartida con otros proyectos: el consumo se reparte suponiendo que todos se desvían igual.",
  irregular: "El consumo no sigue el ritmo de producción.",
  lumpy: "Retiros esporádicos, en bloque: varias semanas sin salidas.",
  edge_sensitive: "El resultado cambia mucho al mover dos semanas los bordes del período.",
  change_point: "Cambio de nivel dentro del período: posible reemplazo por otro material o cambio de proceso.",
  site_before_data_start: "Material de obra: parte de su consumo corresponde a viviendas anteriores al registro de producción.",
  site_material: "Material de obra: se retira meses después del inicio de la vivienda.",
  no_consumption: "Sin salidas en el período.",
  extreme_ratio: "Diferencia extrema con la estimación: revisa la unidad o si fue reemplazado.",
  unmapped_houses: "Hay viviendas sin vincular en el período.",
  no_expected: "Ninguna vivienda del período usa este material.",
  incomplete_bom: "Hay cantidades sin definir en algún presupuesto del período.",
  excluded_centers: "Se retira principalmente en centros de costo excluidos (por ejemplo, obra): lo que queda no representa su consumo.",
};
export const studyWarnings: Record<string, string> = {
  before_data_start: "El período empieza junto al inicio del registro de producción: faltan viviendas anteriores que aún consumían.",
  site_before_data_start: "Los materiales de obra incluyen consumo de viviendas anteriores al registro de producción.",
  unmapped_houses: "Más del 5% de las viviendas del período no están vinculadas.",
  no_target_houses: "El proyecto no inició viviendas en este período.",
};
export const reasonList = (reasons: string[]) => reasons.map((reason) => studyReasons[reason] ?? reason).join(" ");

export function defaultRange() {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 89);
  const localDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  return { startDate: localDate(start), endDate: localDate(end) };
}
