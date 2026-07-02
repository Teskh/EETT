import { normalizeCecos } from "../../lib/materialDashboardCacheKeys";

import type { HouseRange } from "./dates";
import type { LeadTimeMode } from "./procurement";

const HOUSE_VIEW_PREFERENCES_KEY = "material-dashboard::house-view-preferences";
const CECO_FILTER_PREFERENCES_KEY = "material-dashboard::ceco-filter-preferences";

export type CecoFilterMode = "exclude" | "include";

export type HouseViewPreferences = {
  hasSelectedHouseTypePreference: boolean;
  selectedHouseTypeId: number | null;
  selectedProjectId: number | null;
  leadTimeMode: LeadTimeMode;
  houseRange: HouseRange | null;
};

export type CecoFilterPreferences = {
  mode: CecoFilterMode;
  cecos: string[];
};

function isLeadTimeMode(value: unknown): value is LeadTimeMode {
  return value === "worst" || value === "median" || value === "average";
}

function asFiniteNumberOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function loadHouseViewPreferences(): HouseViewPreferences | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(HOUSE_VIEW_PREFERENCES_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as {
      selectedHouseTypeId?: number | null;
      selectedProjectId?: number | null;
      leadTimeMode?: string;
      houseRange?: Partial<HouseRange> | null;
    };
    return {
      hasSelectedHouseTypePreference: Object.prototype.hasOwnProperty.call(parsed, "selectedHouseTypeId"),
      selectedHouseTypeId: asFiniteNumberOrNull(parsed.selectedHouseTypeId),
      selectedProjectId: asFiniteNumberOrNull(parsed.selectedProjectId),
      leadTimeMode: isLeadTimeMode(parsed.leadTimeMode) ? parsed.leadTimeMode : "worst",
      houseRange:
        parsed.houseRange?.startDate && parsed.houseRange?.endDate
          ? {
              startDate: parsed.houseRange.startDate,
              endDate: parsed.houseRange.endDate,
            }
          : null,
    };
  } catch {
    return null;
  }
}

export function saveHouseViewPreferences(preferences: {
  selectedHouseTypeId: number | null;
  selectedProjectId: number | null;
  leadTimeMode: LeadTimeMode;
  houseRange: HouseRange;
}) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(HOUSE_VIEW_PREFERENCES_KEY, JSON.stringify(preferences));
}

export function loadCecoFilterPreferences(): CecoFilterPreferences | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(CECO_FILTER_PREFERENCES_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as { mode?: string; cecos?: unknown };
    return {
      mode: parsed.mode === "include" ? "include" : "exclude",
      cecos: Array.isArray(parsed.cecos) ? normalizeCecos(parsed.cecos.map((value) => String(value ?? ""))) : [],
    };
  } catch {
    return null;
  }
}

export function saveCecoFilterPreferences(preferences: CecoFilterPreferences) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(CECO_FILTER_PREFERENCES_KEY, JSON.stringify(preferences));
}
