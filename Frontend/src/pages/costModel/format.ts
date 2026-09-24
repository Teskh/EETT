const numbers = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 6 });
const currency = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });
export const formatQuantity = (value: number | null | undefined) => value == null ? "—" : numbers.format(value);
const twoDecimals = new Intl.NumberFormat("es-CL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const formatQuantity2 = (value: number | null | undefined) => value == null ? "—" : twoDecimals.format(value);
export const formatMoney = (value: number | null | undefined) => value == null ? "—" : currency.format(value);
export const formatChange = (value: number | null | undefined) => value == null ? "—" : `${value > 0 ? "+" : value < 0 ? "−" : ""}${currency.format(Math.abs(value))}`;
export const sourceLabels = { estimated: "Estimada", historic_allocated: "Histórica", manual: "Manual", legacy: "Ajuste anterior" };
export const historyReasons: Record<string, string> = {
  no_sample: "No hay viviendas vinculadas a esta subtipología en el período.",
  unmapped_houses: "Más del 5% de las viviendas del período no están vinculadas. El reparto no sería confiable.",
  incomplete_budgets: "Hay viviendas con cantidades estimadas incompletas. Falta completar la base del reparto.",
  incomplete_material: "Faltan cantidades estimadas de este material en las viviendas del período.",
  no_movements: "No hay movimientos disponibles para este material en el período.",
  no_allocation_basis: "No hay una cantidad estimada positiva para repartir este consumo.",
};

export function defaultRange() {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 89);
  const localDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  return { startDate: localDate(start), endDate: localDate(end) };
}
