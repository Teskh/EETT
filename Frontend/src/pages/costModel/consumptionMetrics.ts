/**
 * Material metrics for the compared period, defined as in the material
 * dashboard (MovementHistoryCard) so both pages report the same numbers.
 *
 * Real consumption covers every house started, while expected consumption
 * only covers linked houses. Differences therefore compare period totals and
 * divide by all houses started, like the dashboard's cost per house.
 */
export type ConsumptionMetricsInput = {
  materialConsumed: number;
  projectedMaterialConsumed: number;
  housesProduced: number;
  mappedHousesProduced: number;
  /** False when no house type is linked to a project, so nothing is expected. */
  hasExpected: boolean;
  averagePrice: number | null | undefined;
};

export type ConsumptionMetrics = {
  consumedPerHouse: number | null;
  expectedPerHouse: number | null;
  deltaPercent: number | null;
  overconsumptionPerHouse: number | null;
  overcostPerHouse: number | null;
  unmappedHouses: number;
};

const finite = (value: number | null | undefined): value is number => typeof value === "number" && Number.isFinite(value);

export function getConsumptionMetrics(input: ConsumptionMetricsInput): ConsumptionMetrics {
  const { materialConsumed: actual, projectedMaterialConsumed: expected, housesProduced: houses, mappedHousesProduced: mapped } = input;
  const comparable = input.hasExpected && mapped > 0;
  const overconsumptionPerHouse = comparable && houses > 0 ? (actual - expected) / houses : null;
  const price = finite(input.averagePrice) && input.averagePrice > 0 ? input.averagePrice : null;
  return {
    consumedPerHouse: houses > 0 ? actual / houses : null,
    expectedPerHouse: comparable ? expected / mapped : null,
    deltaPercent: comparable && expected !== 0 ? ((actual - expected) / expected) * 100 : null,
    overconsumptionPerHouse,
    overcostPerHouse: overconsumptionPerHouse !== null && price !== null ? overconsumptionPerHouse * price : null,
    unmappedHouses: Math.max(houses - mapped, 0),
  };
}
