import { startTransition, useDeferredValue, useEffect, useMemo, useState } from "react";

import { MaterialProjectUsageModal } from "../components/MaterialProjectUsageModal";
import { MaterialStudyGroupEditor } from "../components/MaterialStudyGroupEditor";
import { ApiError, api } from "../lib/api";
import {
  CECO_CACHE_KEY,
  HOUSE_TYPES_CACHE_KEY,
  dashboardCacheKey,
  detailCacheKey,
  economicMetricsCacheKey,
  groupDashboardCacheKey,
  groupDetailCacheKey,
  groupHistoryCacheKey,
  groupHouseComparisonCacheKey,
  historyCacheKey,
  houseComparisonCacheKey,
  normalizeCecos,
} from "../lib/materialDashboardCacheKeys";
import type {
  MaterialDashboardCeco,
  MaterialDashboardData,
  MaterialDashboardDetailData,
  MaterialDashboardEconomicMetricsResponse,
  MaterialDashboardGroupDetailData,
  MaterialDashboardGroupHouseComparisonData,
  MaterialDashboardGroupMovementData,
  MaterialDashboardHouseComparisonData,
  MaterialDashboardHouseType,
  MaterialDashboardListRow,
  MaterialDashboardMovementData,
  MaterialStudyGroupListResponse,
  ProjectsBoardData,
} from "../lib/types";

import { MovementHistoryCard } from "./materialDashboard/components/MovementHistoryCard";
import { CecoResultsList, GroupResultsList, MaterialResultsList } from "./materialDashboard/components/ResultsLists";
import {
  CecoFilterModeToggle,
  ErrorBanners,
  ReloadIconButton,
  SelectedCecoChips,
  SidebarSearchInput,
  SidebarTabBar,
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
} from "./materialDashboard/preferences";
import type { LeadTimeMode } from "./materialDashboard/procurement";
import {
  DEFAULT_SORT_STATE,
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

const SORT_SELECT_CLASSES =
  "rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-black/20 px-3 py-2.5 text-sm text-zinc-900 dark:text-white outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500 transition-colors";
const SIDEBAR_BUTTON_CLASSES =
  "rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-white/5 px-4 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-300 shadow-sm transition-colors hover:bg-zinc-50 dark:hover:bg-white/10";

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
  const [selectedHouseTypeId, setSelectedHouseTypeId] = useState<number | null>(
    () => storedHousePreferences?.selectedHouseTypeId ?? null,
  );
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(
    () => storedHousePreferences?.selectedProjectId ?? null,
  );
  const [leadTimeMode, setLeadTimeMode] = useState<LeadTimeMode>(() => storedHousePreferences?.leadTimeMode ?? "worst");
  const [houseRange, setHouseRange] = useState<HouseRange>(() =>
    clampHouseRange(storedHousePreferences?.houseRange || getDefaultHouseRange()),
  );

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

  const [projectsBoard, setProjectsBoard] = useState<ProjectsBoardData | null>(null);
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

  const houseTypesResource = useDashboardResource<MaterialDashboardHouseType[]>({
    cacheKey: HOUSE_TYPES_CACHE_KEY,
    fetcher: async () => (await api.getMaterialDashboardHouseTypes()).house_types,
    errorMessage: "No se pudieron cargar los tipos de vivienda.",
    onError: () => setSelectedHouseTypeId(null),
  });
  const houseTypes = useMemo(() => houseTypesResource.data ?? [], [houseTypesResource.data]);

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

  const houseComparisonResource = useDashboardResource<MaterialDashboardHouseComparisonData>({
    cacheKey:
      selectedMaterialSku && selectedHouseTypeId
        ? houseComparisonCacheKey(selectedMaterialSku, selectedHouseTypeId, normalizedSelectedCecos, houseRange, selectedProjectId)
        : null,
    enabled: !allCecosExcluded,
    refreshNonce,
    fetcher: (forceRefresh) =>
      api.getMaterialDashboardHouseComparison(selectedMaterialSku!, selectedHouseTypeId!, cecoApiFilters, {
        refresh: forceRefresh,
        startDate: houseRange.startDate,
        endDate: houseRange.endDate,
        projectId: selectedProjectId,
      }),
    errorMessage: "No se pudo cargar la comparación de inicios de vivienda.",
  });

  const groupHouseComparisonResource = useDashboardResource<MaterialDashboardGroupHouseComparisonData>({
    cacheKey:
      selectedGroupId && selectedHouseTypeId
        ? groupHouseComparisonCacheKey(selectedGroupId, selectedHouseTypeId, normalizedSelectedCecos, houseRange, selectedProjectId)
        : null,
    enabled: !allCecosExcluded,
    refreshNonce,
    fetcher: (forceRefresh) =>
      api.getMaterialStudyGroupHouseComparison(selectedGroupId!, selectedHouseTypeId!, cecoApiFilters, {
        refresh: forceRefresh,
        startDate: houseRange.startDate,
        endDate: houseRange.endDate,
        projectId: selectedProjectId,
      }),
    errorMessage: "No se pudo cargar la comparación de inicios de vivienda del grupo.",
  });

  const materialEconomicSortAvailable = Boolean(selectedHouseTypeId && selectedProjectId);
  const economicMetricsResource = useDashboardResource<MaterialDashboardEconomicMetricsResponse>({
    cacheKey:
      selectedHouseTypeId && selectedProjectId
        ? economicMetricsCacheKey(selectedHouseTypeId, normalizedSelectedCecos, houseRange, selectedProjectId)
        : null,
    enabled: !allCecosExcluded && activeTab === "materials" && materialEconomicSortAvailable,
    refreshNonce,
    fetcher: (forceRefresh) =>
      api.getMaterialDashboardEconomicMetrics(selectedHouseTypeId!, cecoApiFilters, {
        refresh: forceRefresh,
        startDate: houseRange.startDate,
        endDate: houseRange.endDate,
        projectId: selectedProjectId!,
      }),
    errorMessage: "No se pudieron cargar las métricas económicas.",
  });
  const currentEconomicMetrics = economicMetricsResource.data;
  const economicMetricsBySku = useMemo(
    () => new Map((currentEconomicMetrics?.metrics || []).map((metric) => [metric.sku, metric])),
    [currentEconomicMetrics],
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

  const projectOptions = useMemo(
    () =>
      Object.values(projectsBoard?.grouped_projects || {})
        .flat()
        .filter((project) => project.status === "execution")
        .slice()
        .sort((left, right) => left.name.localeCompare(right.name)),
    [projectsBoard],
  );

  useEffect(() => {
    let cancelled = false;
    async function loadProjects() {
      try {
        const response = await api.getProjects();
        if (!cancelled) {
          setProjectsBoard(response);
        }
      } catch {
        if (!cancelled) {
          setProjectsBoard({ grouped_projects: {}, status_labels: {} });
          setSelectedProjectId(null);
        }
      }
    }
    void loadProjects();
    return () => {
      cancelled = true;
    };
  }, []);

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
    saveHouseViewPreferences({ selectedHouseTypeId, selectedProjectId, leadTimeMode, houseRange });
  }, [houseRange, leadTimeMode, selectedHouseTypeId, selectedProjectId]);

  // Default to the first house type, unless the user explicitly chose "none".
  useEffect(() => {
    if (!houseTypes.length) {
      return;
    }
    setSelectedHouseTypeId((current) =>
      current === null
        ? storedHousePreferences?.hasSelectedHouseTypePreference
          ? null
          : houseTypes[0].id
        : houseTypes.some((houseType) => houseType.id === current)
          ? current
          : houseTypes[0].id,
    );
  }, [houseTypes, storedHousePreferences?.hasSelectedHouseTypePreference]);

  useEffect(() => {
    if (!projectsBoard || !selectedProjectId) {
      return;
    }
    if (projectOptions.some((project) => project.id === selectedProjectId)) {
      return;
    }
    setSelectedProjectId(null);
  }, [projectOptions, projectsBoard, selectedProjectId]);

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
        const leftValue = economicMetricsBySku.get(left.sku)?.[sort.key];
        const rightValue = economicMetricsBySku.get(right.sku)?.[sort.key];
        const leftMissing = leftValue === null || leftValue === undefined || Number.isNaN(leftValue);
        const rightMissing = rightValue === null || rightValue === undefined || Number.isNaN(rightValue);
        if (leftMissing && rightMissing) {
          return left.material_name.localeCompare(right.material_name);
        }
        if (leftMissing) {
          return 1;
        }
        if (rightMissing) {
          return -1;
        }
        if (leftValue === rightValue) {
          return left.material_name.localeCompare(right.material_name);
        }
        return (leftValue - rightValue) * sort.direction;
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
      .sort((left, right) => compareRows(left, right, groupSort));
  }, [groupData?.groups, normalizedMaterialSearch, sort]);

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
    if (!selectedProjectId) {
      return;
    }
    const projectName = projectOptions.find((project) => project.id === selectedProjectId)?.name || "Proyecto seleccionado";
    setProjectUsageTarget({
      projectId: selectedProjectId,
      projectName,
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
      <section className="w-full xl:w-[420px] 2xl:w-[480px] flex-shrink-0 flex flex-col border-r border-black/10 dark:border-white/10 bg-white/60 dark:bg-white/[0.01]">
        <div className="p-4 lg:p-6 pb-0 border-b border-black/5 dark:border-white/5 flex flex-col gap-4">
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
              <div className="p-4 lg:p-6 border-b border-black/5 dark:border-white/5 space-y-3">
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
                <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                  <select
                    value={sort.key}
                    onChange={(event) => {
                      const key = event.target.value as SortKey;
                      setSort((current) => (current.key === key ? current : { key, direction: -1 }));
                    }}
                    className={SORT_SELECT_CLASSES}
                  >
                    {materialSortOptions.map((option) => (
                      <option key={option.key} value={option.key}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => setSort((current) => ({ ...current, direction: current.direction === 1 ? -1 : 1 }))}
                    className={SIDEBAR_BUTTON_CLASSES}
                    title={sort.direction === -1 ? "Descendente" : "Ascendente"}
                  >
                    {sort.direction === -1 ? "Desc" : "Asc"}
                  </button>
                </div>
                {!materialEconomicSortAvailable ? (
                  <div className="text-[11px] text-zinc-500">
                    Selecciona un tipo de vivienda y proyecto para mostrar ahorro y sobrecosto por vivienda en la lista, y ordenar por ese dato.
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
              <div className="p-4 lg:p-6 border-b border-black/5 dark:border-white/5 space-y-3">
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
                <ErrorBanners errors={[error, historyError, houseComparisonError]} />
              </div>

              <div className="flex-1 overflow-y-auto">
                <GroupResultsList
                  rows={groupRows}
                  movementWindowDays={groupData?.movement_window_days || currentDashboardMovementDays}
                  selectedGroupId={selectedGroupId}
                  onSelect={setSelectedKey}
                />
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col min-h-0">
              <div className="p-4 lg:p-6 border-b border-black/5 dark:border-white/5 space-y-4">
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
          houseTypes={houseTypes}
          projects={projectOptions}
          selectedHouseTypeId={selectedHouseTypeId}
          selectedProjectId={selectedProjectId}
          leadTimeMode={leadTimeMode}
          onSelectHouseType={setSelectedHouseTypeId}
          onSelectProject={setSelectedProjectId}
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
          economicMetric={selectedMaterialSku ? economicMetricsBySku.get(selectedMaterialSku) ?? null : null}
          onInspectProjectUsage={selectedMaterialRow && selectedProjectId ? () => handleOpenProjectUsage(selectedMaterialRow) : null}
        />
      </main>

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
