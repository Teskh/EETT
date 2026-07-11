import { startTransition, useDeferredValue, useEffect, useMemo, useState } from "react";

import { MaterialProjectUsageModal } from "../components/MaterialProjectUsageModal";
import { MaterialStudyGroupEditor } from "../components/MaterialStudyGroupEditor";
import { ApiError, api } from "../lib/api";
import {
  CECO_CACHE_KEY,
  dashboardCacheKey,
  detailCacheKey,
  economicMetricsCacheKey,
  groupDashboardCacheKey,
  groupDetailCacheKey,
  groupEconomicMetricsCacheKey,
  groupHistoryCacheKey,
  groupHouseComparisonCacheKey,
  historyCacheKey,
  houseComparisonCacheKey,
  normalizeCecos,
} from "../lib/materialDashboardCacheKeys";
import type {
  HouseTypeLink,
  MaterialDashboardCeco,
  MaterialDashboardData,
  MaterialDashboardDetailData,
  MaterialDashboardEconomicMetricsResponse,
  MaterialDashboardGroupDetailData,
  MaterialDashboardGroupEconomicMetricsResponse,
  MaterialDashboardGroupHouseComparisonData,
  MaterialDashboardGroupMovementData,
  MaterialDashboardListRow,
  MaterialDashboardMappedHouseComparisonData,
  MaterialDashboardMovementData,
  MaterialStudyGroupListResponse,
} from "../lib/types";

import { HouseLinksModal, type HouseLinksModalTab } from "./materialDashboard/components/HouseLinksModal";
import { MovementHistoryCard } from "./materialDashboard/components/MovementHistoryCard";
import { CecoResultsList, GroupResultsList, MaterialResultsList } from "./materialDashboard/components/ResultsLists";
import {
  CecoFilterModeToggle,
  ErrorBanners,
  ReloadIconButton,
  SelectedCecoChips,
  SidebarSearchInput,
  SidebarTabBar,
  SortControls,
  SIDEBAR_BUTTON_CLASSES,
  type SidebarTab,
} from "./materialDashboard/components/SidebarControls";
import {
  clampHouseRange,
  getDefaultHouseRange,
  inclusiveDaySpan,
  moveToPreviousBusinessDay,
  toDateInputValue,
  type HouseRange,
} from "./materialDashboard/dates";
import { formatDate } from "./materialDashboard/formatters";
import {
  loadCecoFilterPreferences,
  loadHouseViewPreferences,
  saveCecoFilterPreferences,
  saveHouseViewPreferences,
  type CecoFilterMode,
  type HouseViewMode,
} from "./materialDashboard/preferences";
import type { LeadTimeMode } from "./materialDashboard/procurement";
import {
  DEFAULT_SORT_STATE,
  compareEconomicMetricValues,
  compareRows,
  isEconomicSortKey,
  materialSearchResultToDashboardRow,
  toBaseSort,
  type SortKey,
  type SortState,
} from "./materialDashboard/selection";
import { useDashboardResource } from "./materialDashboard/useDashboardResource";

const LIST_PAGE_SIZE = 50;
const MAX_COLLAPSED_SELECTED_CECOS = 8;

function maybeLoadMoreRows(
  element: HTMLDivElement,
  visibleCount: number,
  totalCount: number,
  setVisibleCount: (updater: (current: number) => number) => void,
) {
  if (visibleCount >= totalCount) {
    return;
  }
  if (element.scrollTop + element.clientHeight < element.scrollHeight - 120) {
    return;
  }
  setVisibleCount((current) => Math.min(current + LIST_PAGE_SIZE, totalCount));
}

export function MaterialDashboardPage({ canEditGroups = false }: { canEditGroups?: boolean }) {
  const [storedHousePreferences] = useState(() => loadHouseViewPreferences());
  const [storedCecoPreferences] = useState(() => loadCecoFilterPreferences());

  // Filters and selection.
  const [cecoFilterMode, setCecoFilterMode] = useState<CecoFilterMode>(storedCecoPreferences?.mode ?? "exclude");
  const [selectedCecos, setSelectedCecos] = useState<string[]>(storedCecoPreferences?.cecos ?? []);
  const [activeTab, setActiveTab] = useState<SidebarTab>("materials");
  const [cecoSearch, setCecoSearch] = useState("");
  const [showAllSelectedCecos, setShowAllSelectedCecos] = useState(false);
  const [materialSearchInput, setMaterialSearchInput] = useState("");
  const [materialSearch, setMaterialSearch] = useState("");
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT_STATE);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [houseViewMode, setHouseViewMode] = useState<HouseViewMode>(() => storedHousePreferences?.houseViewMode ?? "houses");
  const [leadTimeMode, setLeadTimeMode] = useState<LeadTimeMode>(() => storedHousePreferences?.leadTimeMode ?? "worst");
  const [houseRange, setHouseRange] = useState<HouseRange>(() =>
    clampHouseRange(storedHousePreferences?.houseRange || getDefaultHouseRange()),
  );

  // House type → project mapping (global, DB-stored). linksVersion bumps when
  // the mapping is edited so comparison/economics resources refetch.
  const [links, setLinks] = useState<HouseTypeLink[]>([]);
  const [linksLoaded, setLinksLoaded] = useState(false);
  const [linksVersion, setLinksVersion] = useState(0);
  const [linksModal, setLinksModal] = useState<{ open: boolean; tab: HouseLinksModalTab }>({ open: false, tab: "links" });

  // UI state.
  const [groupEditorOpen, setGroupEditorOpen] = useState(false);
  const [projectUsageTarget, setProjectUsageTarget] = useState<{
    projectId: number;
    projectName: string;
    material: MaterialDashboardListRow;
  } | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [visibleMaterialCount, setVisibleMaterialCount] = useState(LIST_PAGE_SIZE);
  const [visibleCecoCount, setVisibleCecoCount] = useState(LIST_PAGE_SIZE);

  // ERP-wide material search (materials without recent movements).
  const [erpMaterialSearchRows, setErpMaterialSearchRows] = useState<MaterialDashboardListRow[]>([]);
  const [erpMaterialSearchLoading, setErpMaterialSearchLoading] = useState(false);
  const [erpMaterialSearchError, setErpMaterialSearchError] = useState<string | null>(null);
  const [externalMaterialRows, setExternalMaterialRows] = useState<Record<string, MaterialDashboardListRow>>({});

  const deferredMaterialSearch = useDeferredValue(materialSearch);

  const normalizedSelectedCecoCodes = normalizeCecos(selectedCecos);
  const selectedCecoSet = useMemo(() => new Set(normalizedSelectedCecoCodes), [normalizedSelectedCecoCodes]);
  const selectedMaterialSku = selectedKey?.startsWith("material:") ? selectedKey.slice("material:".length) : null;
  const parsedSelectedGroupId = selectedKey?.startsWith("group:") ? Number(selectedKey.slice("group:".length)) : null;
  const selectedGroupId = parsedSelectedGroupId !== null && Number.isFinite(parsedSelectedGroupId) ? parsedSelectedGroupId : null;

  const cecosResource = useDashboardResource<MaterialDashboardCeco[]>({
    cacheKey: CECO_CACHE_KEY,
    refreshNonce,
    fetcher: async (forceRefresh) => (await api.getMaterialDashboardCostCenters({ refresh: forceRefresh })).cecos,
    errorMessage: "No se pudieron cargar los centros de costo.",
  });
  const cecos = useMemo(() => cecosResource.data ?? [], [cecosResource.data]);
  const cecoNameByCode = useMemo(() => new Map(cecos.map((ceco) => [ceco.code, ceco.name])), [cecos]);

  useEffect(() => {
    let cancelled = false;
    async function loadLinks() {
      try {
        const response = await api.getHouseTypeLinks();
        if (!cancelled) {
          setLinks(response.links);
          setLinksLoaded(true);
        }
      } catch {
        if (!cancelled) {
          setLinks([]);
          setLinksLoaded(true);
        }
      }
    }
    void loadLinks();
    return () => {
      cancelled = true;
    };
  }, [linksVersion]);

  // In "exclude" mode the API receives the complement of the selection.
  const normalizedSelectedCecos =
    cecoFilterMode === "exclude"
      ? normalizeCecos(cecos.map((ceco) => ceco.code).filter((code) => !selectedCecoSet.has(code)))
      : normalizedSelectedCecoCodes;
  const cecoApiFilters = cecoFilterMode === "exclude" ? { excludedCecos: normalizedSelectedCecoCodes } : { cecos: normalizedSelectedCecoCodes };
  const allCecosExcluded = cecos.length > 0 && normalizedSelectedCecos.length === 0;

  const currentDashboardMovementDays = inclusiveDaySpan(houseRange.startDate, houseRange.endDate);
  const latestHistoryDate = toDateInputValue(moveToPreviousBusinessDay(new Date()));
  const historyRequestRange = { startDate: houseRange.startDate, endDate: latestHistoryDate };
  const currentDashboardRange = { startDate: houseRange.startDate, endDate: houseRange.endDate };

  function syncSelectedMaterial(response: MaterialDashboardData) {
    setSelectedKey((current) => {
      if (current?.startsWith("material:")) {
        const currentSku = current.slice("material:".length);
        if (response.materials.some((row) => row.sku === currentSku)) {
          return current;
        }
      }
      return !current && response.materials[0] ? `material:${response.materials[0].sku}` : current;
    });
  }

  function syncSelectedGroup(response: MaterialStudyGroupListResponse) {
    setSelectedKey((current) => {
      if (current?.startsWith("group:")) {
        const currentGroupId = Number(current.slice("group:".length));
        if (response.groups.some((row) => row.group_id === currentGroupId)) {
          return current;
        }
      }
      if ((!current || activeTab === "groups") && response.groups[0]) {
        return `group:${response.groups[0].group_id}`;
      }
      return current;
    });
  }

  const currentDashboardKey = dashboardCacheKey(normalizedSelectedCecos, currentDashboardRange, currentDashboardMovementDays);
  const dashboardResource = useDashboardResource<MaterialDashboardData>({
    cacheKey: currentDashboardKey,
    enabled: !allCecosExcluded,
    refreshNonce,
    fetcher: (forceRefresh) =>
      api.getMaterialDashboard(cecoApiFilters, {
        refresh: forceRefresh,
        movementDays: currentDashboardMovementDays,
        startDate: houseRange.startDate,
        endDate: houseRange.endDate,
      }),
    errorMessage: "No se pudieron cargar los materiales del panel.",
    onData: syncSelectedMaterial,
    onError: () => setSelectedKey((current) => (current?.startsWith("material:") ? null : current)),
  });

  const groupListResource = useDashboardResource<MaterialStudyGroupListResponse>({
    cacheKey: groupDashboardCacheKey(normalizedSelectedCecos, currentDashboardRange, currentDashboardMovementDays),
    enabled: !allCecosExcluded,
    refreshNonce,
    fetcher: (forceRefresh) =>
      api.getMaterialStudyGroups(cecoApiFilters, {
        movementDays: currentDashboardMovementDays,
        startDate: houseRange.startDate,
        endDate: houseRange.endDate,
        refresh: forceRefresh,
      }),
    errorMessage: "No se pudieron cargar los grupos de materiales.",
    onData: syncSelectedGroup,
  });

  const detailResource = useDashboardResource<MaterialDashboardDetailData>({
    cacheKey: selectedMaterialSku ? detailCacheKey(selectedMaterialSku, normalizedSelectedCecos) : null,
    enabled: !allCecosExcluded,
    refreshNonce,
    fetcher: (forceRefresh) => api.getMaterialDashboardDetail(selectedMaterialSku!, cecoApiFilters, { refresh: forceRefresh }),
    errorMessage: "No se pudo cargar el detalle del material.",
  });

  const groupDetailResource = useDashboardResource<MaterialDashboardGroupDetailData>({
    cacheKey: selectedGroupId ? groupDetailCacheKey(selectedGroupId, normalizedSelectedCecos) : null,
    enabled: !allCecosExcluded,
    refreshNonce,
    fetcher: (forceRefresh) => api.getMaterialStudyGroupDetail(selectedGroupId!, cecoApiFilters, { refresh: forceRefresh }),
    errorMessage: "No se pudo cargar el detalle del grupo de materiales.",
  });

  const historyResource = useDashboardResource<MaterialDashboardMovementData>({
    cacheKey: selectedMaterialSku ? historyCacheKey(selectedMaterialSku, normalizedSelectedCecos, historyRequestRange) : null,
    enabled: !allCecosExcluded,
    refreshNonce,
    fetcher: (forceRefresh) =>
      api.getMaterialDashboardHistory(selectedMaterialSku!, cecoApiFilters, {
        refresh: forceRefresh,
        startDate: historyRequestRange.startDate,
        endDate: historyRequestRange.endDate,
      }),
    errorMessage: "No se pudo cargar el historial de movimientos.",
  });

  const groupHistoryResource = useDashboardResource<MaterialDashboardGroupMovementData>({
    cacheKey: selectedGroupId ? groupHistoryCacheKey(selectedGroupId, normalizedSelectedCecos, historyRequestRange) : null,
    enabled: !allCecosExcluded,
    refreshNonce,
    fetcher: (forceRefresh) =>
      api.getMaterialStudyGroupHistory(selectedGroupId!, cecoApiFilters, {
        refresh: forceRefresh,
        startDate: historyRequestRange.startDate,
        endDate: historyRequestRange.endDate,
      }),
    errorMessage: "No se pudo cargar el historial del grupo de materiales.",
  });

  const housesMode = houseViewMode === "houses";
  const houseComparisonResource = useDashboardResource<MaterialDashboardMappedHouseComparisonData>({
    cacheKey: selectedMaterialSku
      ? houseComparisonCacheKey(selectedMaterialSku, normalizedSelectedCecos, houseRange, linksVersion)
      : null,
    enabled: !allCecosExcluded && housesMode,
    refreshNonce,
    fetcher: (forceRefresh) =>
      api.getMaterialDashboardHouseComparison(selectedMaterialSku!, cecoApiFilters, {
        refresh: forceRefresh,
        startDate: houseRange.startDate,
        endDate: houseRange.endDate,
      }),
    errorMessage: "No se pudo cargar la comparación de inicios de vivienda.",
  });

  const groupHouseComparisonResource = useDashboardResource<MaterialDashboardGroupHouseComparisonData>({
    cacheKey: selectedGroupId
      ? groupHouseComparisonCacheKey(selectedGroupId, normalizedSelectedCecos, houseRange, linksVersion)
      : null,
    enabled: !allCecosExcluded && housesMode,
    refreshNonce,
    fetcher: (forceRefresh) =>
      api.getMaterialStudyGroupHouseComparison(selectedGroupId!, cecoApiFilters, {
        refresh: forceRefresh,
        startDate: houseRange.startDate,
        endDate: houseRange.endDate,
      }),
    errorMessage: "No se pudo cargar la comparación de inicios de vivienda del grupo.",
  });

  const materialEconomicSortAvailable = links.length > 0;
  const economicMetricsResource = useDashboardResource<MaterialDashboardEconomicMetricsResponse>({
    cacheKey: materialEconomicSortAvailable
      ? economicMetricsCacheKey(normalizedSelectedCecos, houseRange, linksVersion)
      : null,
    enabled: !allCecosExcluded && activeTab === "materials" && materialEconomicSortAvailable,
    refreshNonce,
    fetcher: (forceRefresh) =>
      api.getMaterialDashboardEconomicMetrics(cecoApiFilters, {
        refresh: forceRefresh,
        startDate: houseRange.startDate,
        endDate: houseRange.endDate,
      }),
    errorMessage: "No se pudieron cargar las métricas económicas.",
  });
  const currentEconomicMetrics = economicMetricsResource.data;
  const economicMetricsBySku = useMemo(
    () => new Map((currentEconomicMetrics?.metrics || []).map((metric) => [metric.sku, metric])),
    [currentEconomicMetrics],
  );
  const groupEconomicMetricsResource = useDashboardResource<MaterialDashboardGroupEconomicMetricsResponse>({
    cacheKey: materialEconomicSortAvailable
      ? groupEconomicMetricsCacheKey(normalizedSelectedCecos, houseRange, linksVersion)
      : null,
    enabled: !allCecosExcluded && Boolean(selectedGroupId || activeTab === "groups") && materialEconomicSortAvailable,
    refreshNonce,
    fetcher: (forceRefresh) =>
      api.getMaterialDashboardGroupEconomicMetrics(cecoApiFilters, {
        refresh: forceRefresh,
        startDate: houseRange.startDate,
        endDate: houseRange.endDate,
      }),
    errorMessage: "No se pudieron cargar las métricas económicas de grupos.",
  });
  const currentGroupEconomicMetrics = groupEconomicMetricsResource.data;
  const groupEconomicMetricsById = useMemo(
    () => new Map((currentGroupEconomicMetrics?.metrics || []).map((metric) => [metric.group_id, metric])),
    [currentGroupEconomicMetrics],
  );

  const data = useMemo<MaterialDashboardData | null>(
    () =>
      allCecosExcluded
        ? { materials: [], movement_window_days: currentDashboardMovementDays, ceco_filters: [], generated_at: "" }
        : dashboardResource.data,
    [allCecosExcluded, currentDashboardMovementDays, dashboardResource.data],
  );
  const groupData = useMemo<MaterialStudyGroupListResponse | null>(
    () =>
      allCecosExcluded
        ? { groups: [], movement_window_days: currentDashboardMovementDays, ceco_filters: [], generated_at: "" }
        : groupListResource.data,
    [allCecosExcluded, currentDashboardMovementDays, groupListResource.data],
  );

  const selectedMaterialRow =
    (data?.materials || []).find((row) => row.sku === selectedMaterialSku) ||
    (selectedMaterialSku ? externalMaterialRows[selectedMaterialSku] || null : null);
  const selectedGroupRow = (groupData?.groups || []).find((row) => row.group_id === selectedGroupId) || null;
  const selectedRow = selectedMaterialRow || selectedGroupRow;
  const selectedDetailLike = selectedMaterialRow ? detailResource.data : selectedGroupRow ? groupDetailResource.data : null;
  const selectedHistoryLike = selectedMaterialRow ? historyResource.data : selectedGroupRow ? groupHistoryResource.data : null;
  const selectedHouseComparisonLike = selectedMaterialRow
    ? houseComparisonResource.data
    : selectedGroupRow
      ? groupHouseComparisonResource.data
      : null;

  // Combined status flags for the sidebar and the detail card.
  const dashboardLoading = !allCecosExcluded && dashboardResource.loading;
  const listLoading = dashboardLoading || (!data && !dashboardResource.error);
  const error = dashboardResource.error || groupListResource.error;
  const detailLoading = detailResource.loading || groupDetailResource.loading;
  const historyError = detailResource.error || groupDetailResource.error || historyResource.error || groupHistoryResource.error;
  const houseComparisonError = houseComparisonResource.error || groupHouseComparisonResource.error;
  const houseComparisonLoading = houseComparisonResource.loading || groupHouseComparisonResource.loading;

  // With the global mapping there is no single selected project; the project
  // usage inspector stays available when the mapping targets exactly one.
  const singleMappedProject = useMemo(() => {
    const distinct = new Map<number, string>();
    for (const link of links) {
      distinct.set(link.project_id, link.project_name || `Proyecto ${link.project_id}`);
    }
    if (distinct.size !== 1) {
      return null;
    }
    const [id, name] = [...distinct.entries()][0];
    return { id, name };
  }, [links]);

  // Drop selected CECOs that no longer exist in the ERP catalog.
  useEffect(() => {
    if (!cecos.length) {
      return;
    }
    const availableCodes = new Set(cecos.map((ceco) => ceco.code));
    setSelectedCecos((current) => {
      const next = normalizeCecos(current.filter((code) => availableCodes.has(code)));
      if (next.length === current.length && next.every((code, index) => code === current[index])) {
        return current;
      }
      return next;
    });
  }, [cecos]);

  useEffect(() => {
    saveCecoFilterPreferences({ mode: cecoFilterMode, cecos: normalizeCecos(selectedCecos) });
  }, [cecoFilterMode, selectedCecos]);

  useEffect(() => {
    saveHouseViewPreferences({ houseViewMode, leadTimeMode, houseRange });
  }, [houseRange, houseViewMode, leadTimeMode]);

  useEffect(() => {
    if (!isEconomicSortKey(sort.key) || materialEconomicSortAvailable) {
      return;
    }
    setSort(DEFAULT_SORT_STATE);
  }, [materialEconomicSortAvailable, sort.key]);

  const normalizedMaterialSearch = deferredMaterialSearch.trim().toLowerCase();
  const isMaterialSearchPending = materialSearchInput !== deferredMaterialSearch;

  useEffect(() => {
    const query = deferredMaterialSearch.trim();
    if (activeTab !== "materials" || query.length < 2) {
      setErpMaterialSearchRows([]);
      setErpMaterialSearchError(null);
      setErpMaterialSearchLoading(false);
      return;
    }

    let cancelled = false;
    setErpMaterialSearchLoading(true);
    setErpMaterialSearchError(null);
    async function loadErpMaterialSearch() {
      try {
        const response = await api.searchMaterialDashboardMaterials(query, 10);
        if (cancelled) {
          return;
        }
        setErpMaterialSearchRows(response.results.map(materialSearchResultToDashboardRow));
      } catch (err) {
        if (!cancelled) {
          setErpMaterialSearchRows([]);
          setErpMaterialSearchError(err instanceof ApiError ? err.message : "No se pudo buscar materiales en ERP.");
        }
      } finally {
        if (!cancelled) {
          setErpMaterialSearchLoading(false);
        }
      }
    }
    void loadErpMaterialSearch();
    return () => {
      cancelled = true;
    };
  }, [activeTab, deferredMaterialSearch]);

  const rows = useMemo(() => {
    const fallbackSort = toBaseSort(sort);
    return (data?.materials || [])
      .filter((row) => {
        if (!normalizedMaterialSearch) {
          return true;
        }
        return row.material_name.toLowerCase().includes(normalizedMaterialSearch) || row.sku.toLowerCase().includes(normalizedMaterialSearch);
      })
      .slice()
      .sort((left, right) => {
        if (!isEconomicSortKey(sort.key) || !currentEconomicMetrics) {
          return compareRows(left, right, fallbackSort);
        }
        return compareEconomicMetricValues(
          { value: economicMetricsBySku.get(left.sku)?.[sort.key], name: left.material_name },
          { value: economicMetricsBySku.get(right.sku)?.[sort.key], name: right.material_name },
          sort.direction,
        );
      });
  }, [currentEconomicMetrics, data?.materials, economicMetricsBySku, normalizedMaterialSearch, sort]);

  const erpOnlyRows = useMemo(() => {
    if (!normalizedMaterialSearch) {
      return [];
    }
    const movementSkus = new Set((data?.materials || []).map((row) => row.sku));
    const seen = new Set<string>();
    return erpMaterialSearchRows.filter((row) => {
      if (movementSkus.has(row.sku) || seen.has(row.sku)) {
        return false;
      }
      seen.add(row.sku);
      return true;
    });
  }, [data?.materials, erpMaterialSearchRows, normalizedMaterialSearch]);

  const groupRows = useMemo(() => {
    const groupSort = toBaseSort(sort);
    return (groupData?.groups || [])
      .filter((row) => {
        if (!normalizedMaterialSearch) {
          return true;
        }
        return row.material_name.toLowerCase().includes(normalizedMaterialSearch) || row.name.toLowerCase().includes(normalizedMaterialSearch);
      })
      .slice()
      .sort((left, right) => {
        if (!isEconomicSortKey(sort.key) || !currentGroupEconomicMetrics) {
          return compareRows(left, right, groupSort);
        }
        return compareEconomicMetricValues(
          { value: groupEconomicMetricsById.get(left.group_id)?.[sort.key], name: left.name },
          { value: groupEconomicMetricsById.get(right.group_id)?.[sort.key], name: right.name },
          sort.direction,
        );
      });
  }, [currentGroupEconomicMetrics, groupData?.groups, groupEconomicMetricsById, normalizedMaterialSearch, sort]);

  const filteredCecos = useMemo(() => {
    const term = cecoSearch.trim().toLowerCase();
    return cecos.filter((ceco) => {
      if (!term) {
        return true;
      }
      return ceco.code.toLowerCase().includes(term) || ceco.name.toLowerCase().includes(term);
    });
  }, [cecoSearch, cecos]);

  const shouldLimitMaterialRows = !normalizedMaterialSearch;
  const shouldLimitCecos = !cecoSearch.trim();
  const visibleMaterialRows = shouldLimitMaterialRows ? rows.slice(0, visibleMaterialCount) : rows;
  const visibleCecos = shouldLimitCecos ? filteredCecos.slice(0, visibleCecoCount) : filteredCecos;
  const hasMoreMaterialRows = shouldLimitMaterialRows && visibleMaterialRows.length < rows.length;
  const hasMoreCecos = shouldLimitCecos && visibleCecos.length < filteredCecos.length;

  const shouldCollapseSelectedCecos = normalizedSelectedCecoCodes.length > MAX_COLLAPSED_SELECTED_CECOS;
  const visibleSelectedCecoCodes =
    showAllSelectedCecos || !shouldCollapseSelectedCecos
      ? normalizedSelectedCecoCodes
      : normalizedSelectedCecoCodes.slice(0, MAX_COLLAPSED_SELECTED_CECOS);

  function toggleCecoSelection(code: string) {
    setSelectedCecos((current) =>
      normalizeCecos(current.includes(code) ? current.filter((item) => item !== code) : [...current, code]),
    );
  }

  function handleReload() {
    setRefreshNonce((current) => current + 1);
  }

  function handleMaterialSearchChange(value: string) {
    setMaterialSearchInput(value);
    startTransition(() => {
      setMaterialSearch(value);
    });
  }

  function handleResetCecoFilter() {
    setCecoFilterMode("exclude");
    setSelectedCecos([]);
  }

  function handleGroupEditorChanged(groupId: number | null) {
    setRefreshNonce((current) => current + 1);
    if (groupId) {
      setSelectedKey(`group:${groupId}`);
      setActiveTab("groups");
    }
  }

  function handleOpenProjectUsage(row: MaterialDashboardListRow) {
    if (!singleMappedProject) {
      return;
    }
    setProjectUsageTarget({
      projectId: singleMappedProject.id,
      projectName: singleMappedProject.name,
      material: row,
    });
  }

  function handleSelectErpMaterial(row: MaterialDashboardListRow) {
    setExternalMaterialRows((current) => ({ ...current, [row.sku]: row }));
    setSelectedKey(`material:${row.sku}`);
  }

  // When the active tab has no valid selection, fall back to its first row.
  useEffect(() => {
    if (activeTab === "materials" && !selectedMaterialRow && rows[0]) {
      setSelectedKey(`material:${rows[0].sku}`);
    }
    if (activeTab === "groups" && !selectedGroupRow && groupRows[0]) {
      setSelectedKey(`group:${groupRows[0].group_id}`);
    }
  }, [activeTab, groupRows, rows, selectedGroupRow, selectedMaterialRow]);

  useEffect(() => {
    setVisibleMaterialCount(LIST_PAGE_SIZE);
  }, [currentDashboardKey, normalizedMaterialSearch, sort.direction, sort.key]);

  useEffect(() => {
    setVisibleCecoCount(LIST_PAGE_SIZE);
  }, [cecoFilterMode, cecoSearch, cecos.length]);

  useEffect(() => {
    if (!shouldCollapseSelectedCecos && showAllSelectedCecos) {
      setShowAllSelectedCecos(false);
    }
  }, [shouldCollapseSelectedCecos, showAllSelectedCecos]);

  const materialSortOptions: Array<{ key: SortKey; label: string }> = [
    { key: "last_movement_date", label: "Último movimiento ERP" },
    { key: "movement_quantity_60d", label: "Cantidad de movimiento" },
    { key: "movement_count_60d", label: "Conteo de movimientos" },
    { key: "material_name", label: "Nombre de material" },
    { key: "sku", label: "SKU" },
    ...(materialEconomicSortAvailable
      ? [
          { key: "consumption_cost_delta_per_house" as const, label: "Delta de costo / vivienda" },
          { key: "consumption_delta_percent" as const, label: "Delta % / vivienda" },
          { key: "historical_weighted_overprice" as const, label: "Sobreprecio ponderado hist." },
          { key: "estimated_weighted_overprice" as const, label: "Sobreprecio ponderado est." },
        ]
      : []),
  ];

  return (
    <div className="absolute inset-0 top-16 flex flex-col xl:flex-row overflow-hidden bg-zinc-50 dark:bg-zinc-950/40 z-30">
      {/* Panel 1: sidebar with tabs */}
      <section className="w-full xl:w-[380px] 2xl:w-[440px] flex-shrink-0 flex flex-col border-r border-black/10 dark:border-white/10 bg-white/60 dark:bg-white/[0.01]">
        <div className="p-4 lg:p-5 pb-0 border-b border-black/5 dark:border-white/5 flex flex-col gap-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.35em] text-zinc-500 mb-2">Filtros</p>
            <div className="flex items-end justify-between mb-4">
              <h2 className="text-lg font-bold text-zinc-900 dark:text-white">Actividad ERP</h2>
              <div className="text-xs text-zinc-500">Actualizado: {formatDate(activeTab === "groups" ? groupData?.generated_at : data?.generated_at)}</div>
            </div>
          </div>

          <SidebarTabBar activeTab={activeTab} onTabChange={setActiveTab} selectedCecoCount={normalizedSelectedCecoCodes.length} />
        </div>

        <div className="flex-1 overflow-hidden flex flex-col">
          {activeTab === "materials" ? (
            <div className="flex-1 flex flex-col min-h-0">
              <div className="p-4 lg:p-5 border-b border-black/5 dark:border-white/5 space-y-3">
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <SidebarSearchInput
                      value={materialSearchInput}
                      pending={isMaterialSearchPending}
                      placeholder="SKU o nombre de material"
                      onChange={handleMaterialSearchChange}
                    />
                  </div>
                  <ReloadIconButton onClick={handleReload} />
                </div>
                <SortControls options={materialSortOptions} sort={sort} onChange={setSort} />
                {linksLoaded && !materialEconomicSortAvailable ? (
                  <div className="text-[11px] text-zinc-500">
                    Configura la vinculación de tipos de vivienda con proyectos (botón &quot;Vinculación&quot; junto al gráfico) para
                    mostrar ahorro y sobrecosto por vivienda en la lista, y ordenar por ese dato.
                  </div>
                ) : null}
                {materialEconomicSortAvailable && economicMetricsResource.loading && !currentEconomicMetrics ? (
                  <div className="text-[11px] text-amber-600 dark:text-amber-500">Calculando ahorro y sobrecosto por vivienda para el rango seleccionado...</div>
                ) : null}
                <ErrorBanners errors={[error, historyError, houseComparisonError, economicMetricsResource.error]} />
              </div>

              <div
                className="flex-1 overflow-y-auto"
                onScroll={(event) =>
                  maybeLoadMoreRows(event.currentTarget, visibleMaterialRows.length, rows.length, setVisibleMaterialCount)
                }
              >
                <MaterialResultsList
                  loading={listLoading}
                  rows={visibleMaterialRows}
                  erpRows={erpOnlyRows}
                  erpLoading={erpMaterialSearchLoading}
                  erpError={erpMaterialSearchError}
                  hasMore={hasMoreMaterialRows}
                  movementWindowDays={data?.movement_window_days || currentDashboardMovementDays}
                  economicMetricsBySku={economicMetricsBySku}
                  selectedMaterialSku={selectedMaterialSku}
                  onSelect={setSelectedKey}
                  onSelectErpMaterial={handleSelectErpMaterial}
                />
              </div>
            </div>
          ) : activeTab === "groups" ? (
            <div className="flex-1 flex flex-col min-h-0">
              <div className="p-4 lg:p-5 border-b border-black/5 dark:border-white/5 space-y-3">
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <SidebarSearchInput
                      value={materialSearchInput}
                      pending={isMaterialSearchPending}
                      placeholder="Nombre del grupo"
                      onChange={handleMaterialSearchChange}
                    />
                  </div>
                  <ReloadIconButton onClick={handleReload} />
                </div>
                {canEditGroups ? (
                  <div className="flex justify-end gap-2">
                    <button type="button" onClick={() => setGroupEditorOpen(true)} className={SIDEBAR_BUTTON_CLASSES}>
                      Administrar grupos
                    </button>
                  </div>
                ) : null}
                <SortControls options={materialSortOptions} sort={sort} onChange={setSort} />
                {linksLoaded && !materialEconomicSortAvailable ? (
                  <div className="text-[11px] text-zinc-500">
                    Configura la vinculación de tipos de vivienda con proyectos para mostrar sobreconsumo y costo por vivienda en grupos.
                  </div>
                ) : null}
                {materialEconomicSortAvailable && groupEconomicMetricsResource.loading && !currentGroupEconomicMetrics ? (
                  <div className="text-[11px] text-amber-600 dark:text-amber-500">Calculando ahorro y sobrecosto por vivienda para grupos...</div>
                ) : null}
                <ErrorBanners errors={[error, historyError, houseComparisonError, groupEconomicMetricsResource.error]} />
              </div>

              <div className="flex-1 overflow-y-auto">
                <GroupResultsList
                  rows={groupRows}
                  movementWindowDays={groupData?.movement_window_days || currentDashboardMovementDays}
                  economicMetricsByGroupId={groupEconomicMetricsById}
                  selectedGroupId={selectedGroupId}
                  onSelect={setSelectedKey}
                />
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col min-h-0">
              <div className="p-4 lg:p-5 border-b border-black/5 dark:border-white/5 space-y-4">
                <input
                  value={cecoSearch}
                  onChange={(event) => setCecoSearch(event.target.value)}
                  className="w-full rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-black/20 px-4 py-2.5 text-sm text-zinc-900 dark:text-white outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500 transition-colors"
                  placeholder="Buscar CECO..."
                />
                <div className="flex justify-end">
                  <button type="button" onClick={handleResetCecoFilter} className={SIDEBAR_BUTTON_CLASSES}>
                    Reiniciar filtro CECO
                  </button>
                </div>

                <CecoFilterModeToggle mode={cecoFilterMode} onChange={setCecoFilterMode} />

                <p className="text-xs leading-5 text-zinc-500">
                  {cecoFilterMode === "exclude"
                    ? "Selecciona CECOs para ocultarlos del panel."
                    : "Selecciona los únicos CECOs que deben permanecer visibles en el panel."}
                </p>

                <SelectedCecoChips
                  allCodes={normalizedSelectedCecoCodes}
                  visibleCodes={visibleSelectedCecoCodes}
                  mode={cecoFilterMode}
                  cecoNameByCode={cecoNameByCode}
                  collapsible={shouldCollapseSelectedCecos}
                  showAll={showAllSelectedCecos}
                  onToggleShowAll={setShowAllSelectedCecos}
                  onToggleCeco={toggleCecoSelection}
                />
              </div>

              <div
                className="flex-1 overflow-y-auto px-2 lg:px-4 py-2"
                onScroll={(event) =>
                  maybeLoadMoreRows(event.currentTarget, visibleCecos.length, filteredCecos.length, setVisibleCecoCount)
                }
              >
                <CecoResultsList
                  rows={visibleCecos}
                  hasMore={hasMoreCecos}
                  selectedCecoSet={selectedCecoSet}
                  cecoFilterMode={cecoFilterMode}
                  onToggle={toggleCecoSelection}
                />
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Panel 2: trend charts and procurement metrics */}
      <main className="flex-1 min-w-0 bg-white dark:bg-zinc-950 flex flex-col h-full relative overflow-hidden">
        <MovementHistoryCard
          selected={selectedRow}
          detail={selectedDetailLike}
          history={selectedHistoryLike}
          houseViewMode={houseViewMode}
          onHouseViewModeChange={setHouseViewMode}
          onOpenLinksModal={(tab) => setLinksModal({ open: true, tab })}
          leadTimeMode={leadTimeMode}
          onLeadTimeModeChange={setLeadTimeMode}
          houseRange={houseRange}
          onHouseRangeChange={setHouseRange}
          houseComparison={selectedHouseComparisonLike}
          detailLoading={detailLoading}
          houseComparisonLoading={houseComparisonLoading}
          detailRefreshing={detailLoading && Boolean(selectedDetailLike)}
          historyRefreshing={(historyResource.loading || groupHistoryResource.loading) && Boolean(selectedHistoryLike)}
          houseComparisonRefreshing={houseComparisonLoading && Boolean(selectedHouseComparisonLike)}
          historyError={historyError}
          houseComparisonError={houseComparisonError}
          economicMetric={
            selectedMaterialSku
              ? economicMetricsBySku.get(selectedMaterialSku) ?? null
              : selectedGroupId
                ? groupEconomicMetricsById.get(selectedGroupId) ?? null
                : null
          }
          onInspectProjectUsage={selectedMaterialRow && singleMappedProject ? () => handleOpenProjectUsage(selectedMaterialRow) : null}
        />
      </main>

      <HouseLinksModal
        open={linksModal.open}
        canEdit={canEditGroups}
        range={houseRange}
        initialTab={linksModal.tab}
        onClose={() => setLinksModal((current) => ({ ...current, open: false }))}
        onSaved={() => setLinksVersion((current) => current + 1)}
      />

      {canEditGroups ? (
        <MaterialStudyGroupEditor
          open={groupEditorOpen}
          groups={groupData?.groups || []}
          onClose={() => setGroupEditorOpen(false)}
          onChanged={handleGroupEditorChanged}
        />
      ) : null}
      {projectUsageTarget ? (
        <MaterialProjectUsageModal
          open={projectUsageTarget !== null}
          projectId={projectUsageTarget.projectId}
          projectName={projectUsageTarget.projectName}
          material={projectUsageTarget.material}
          onClose={() => setProjectUsageTarget(null)}
        />
      ) : null}
    </div>
  );
}
