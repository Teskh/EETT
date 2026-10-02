export type PriceSnapshot = { projectId: number; values: Record<string, number | null> };

/** An incomplete ERP response must not erase a price already available to the user. */
export function mergePrices(previous: PriceSnapshot | null, projectId: number, incoming: Record<string, number | null>): PriceSnapshot {
  const values = previous?.projectId === projectId ? { ...previous.values } : {};
  for (const [sku, price] of Object.entries(incoming)) {
    if (price !== null && Number.isFinite(price) && price > 0) values[sku.trim().toUpperCase()] = price;
  }
  return { projectId, values };
}
