import { parseDateValue } from "./dates";

const numberFormatter = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 1 });
const integerFormatter = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 0 });
const currencyFormatter = new Intl.NumberFormat("es-CL", {
  style: "currency",
  currency: "CLP",
  maximumFractionDigits: 0,
});

export const percentFormatter = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 1 });

const decimalFormatters = new Map<number, Intl.NumberFormat>([
  [0, integerFormatter],
  [1, numberFormatter],
]);

function getDecimalFormatter(digits: number) {
  let formatter = decimalFormatters.get(digits);
  if (!formatter) {
    formatter = new Intl.NumberFormat("es-CL", { maximumFractionDigits: digits });
    decimalFormatters.set(digits, formatter);
  }
  return formatter;
}

export function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function formatNumber(value: number | null | undefined, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "—";
  }
  return getDecimalFormatter(digits).format(value);
}

export function formatCurrency(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "—";
  }
  return currencyFormatter.format(value);
}

const compactCurrencyFormatter = new Intl.NumberFormat("es-CL", {
  style: "currency",
  currency: "CLP",
  notation: "compact",
  maximumFractionDigits: 1,
});

/** Short currency for dense list rows: $16,6 M instead of $16.614.042. */
export function formatCompactCurrency(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "—";
  }
  return compactCurrencyFormatter.format(value);
}

export function formatPercent(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "—";
  }
  const absolute = percentFormatter.format(Math.abs(value));
  if (value === 0) {
    return `${absolute}%`;
  }
  return `${value > 0 ? "+" : "-"}${absolute}%`;
}

export function formatUnsignedPercent(value: number | null | undefined, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "—";
  }
  return `${getDecimalFormatter(digits).format(value)}%`;
}

/**
 * Picks decimal places so that small magnitudes (e.g. consumption per house
 * below 1) stay readable instead of rounding away to zero.
 */
export function getAdaptiveDecimalPlaces(...values: Array<number | null | undefined>) {
  let digits = 1;
  for (const value of values) {
    if (!isFiniteNumber(value)) {
      continue;
    }
    const absolute = Math.abs(value);
    if (absolute === 0) {
      continue;
    }
    if (absolute < 0.1) {
      return 3;
    }
    if (absolute < 1) {
      digits = Math.max(digits, 2);
    }
  }
  return digits;
}

export function formatDate(value: string | null | undefined) {
  if (!value) {
    return "—";
  }
  const date = parseDateValue(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleDateString("es-CL", { year: "numeric", month: "short", day: "numeric" });
}

export function formatCondensedDate(value: string | null | undefined) {
  if (!value) {
    return "—";
  }
  const date = parseDateValue(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  const now = new Date();
  return date.toLocaleDateString("es-CL", {
    day: "2-digit",
    month: "short",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
}
