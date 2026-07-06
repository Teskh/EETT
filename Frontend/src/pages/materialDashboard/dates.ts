const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 1000 * 60 * 60 * 24;

export const DEFAULT_HOUSE_RANGE_DAYS = 90;

export type HouseRange = {
  startDate: string;
  endDate: string;
};

export function parseDateValue(value: string | Date) {
  if (value instanceof Date) {
    return new Date(value);
  }
  if (DATE_ONLY_PATTERN.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    return new Date(year, month - 1, day);
  }
  return new Date(value);
}

export function toStartOfDay(value: string | Date) {
  const date = parseDateValue(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

export function toDateInputValue(value: string | Date) {
  const date = toStartOfDay(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function isWeekend(date: Date) {
  const day = date.getDay();
  return day === 0 || day === 6;
}

export function moveToPreviousBusinessDay(value: Date) {
  const date = toStartOfDay(value);
  while (isWeekend(date)) {
    date.setDate(date.getDate() - 1);
  }
  return date;
}

export function moveToNextBusinessDay(value: Date) {
  const date = toStartOfDay(value);
  while (isWeekend(date)) {
    date.setDate(date.getDate() + 1);
  }
  return date;
}

export function addBusinessDays(value: Date, offset: number) {
  const roundedOffset = offset >= 0 ? Math.ceil(offset) : -Math.ceil(Math.abs(offset));
  const date = roundedOffset >= 0 ? moveToNextBusinessDay(value) : moveToPreviousBusinessDay(value);
  let remaining = Math.max(Math.abs(roundedOffset), 0);
  while (remaining > 0) {
    date.setDate(date.getDate() + (roundedOffset >= 0 ? 1 : -1));
    if (!isWeekend(date)) {
      remaining -= 1;
    }
  }
  return date;
}

export function isDateWithinRange(value: string, startDate: string | null | undefined, endDate: string | null | undefined) {
  const time = toStartOfDay(value).getTime();
  if (startDate && time < toStartOfDay(startDate).getTime()) {
    return false;
  }
  if (endDate && time > toStartOfDay(endDate).getTime()) {
    return false;
  }
  return true;
}

export function inclusiveDaySpan(startDate: string, endDate: string) {
  return Math.max(Math.round((toStartOfDay(endDate).getTime() - toStartOfDay(startDate).getTime()) / MS_PER_DAY) + 1, 1);
}

export function daysFromToday(value: string | Date) {
  return Math.round((toStartOfDay(value).getTime() - toStartOfDay(new Date()).getTime()) / MS_PER_DAY);
}

export function getDefaultHouseRange(referenceDate = new Date()): HouseRange {
  const endDate = moveToPreviousBusinessDay(referenceDate);
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - (DEFAULT_HOUSE_RANGE_DAYS - 1));
  return {
    startDate: toDateInputValue(moveToNextBusinessDay(startDate)),
    endDate: toDateInputValue(endDate),
  };
}

export function clampHouseRange(range: HouseRange, referenceDate = new Date()): HouseRange {
  const latestDate = moveToPreviousBusinessDay(referenceDate);
  let startDate = moveToNextBusinessDay(toStartOfDay(range.startDate));
  let endDate = moveToPreviousBusinessDay(toStartOfDay(range.endDate));

  if (startDate.getTime() > latestDate.getTime()) {
    startDate = latestDate;
  }
  if (endDate.getTime() > latestDate.getTime()) {
    endDate = latestDate;
  }
  if (startDate.getTime() > endDate.getTime()) {
    startDate = new Date(endDate);
  }

  return {
    startDate: toDateInputValue(startDate),
    endDate: toDateInputValue(endDate),
  };
}
