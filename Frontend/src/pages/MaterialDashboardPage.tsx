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
  stockRiskMetricsCacheKey,
} from "../lib/materialDashboardCacheKeys";
import type {
  ProductionHouseLink,
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
  MaterialDashboardStockRiskMetricsResponse,
  MaterialStudyGroupListResponse,
} from "../lib/types";

import { HouseLinksModal } from "./materialDashboard/components/HouseLinksModal";
import { HouseStartsModal } from "./materialDashboard/components/HouseStartsModal";
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
import {
  buildCecoTree,
  compressCecoSelections,
  expandCecoSelections,
  filterCecoTree,
  type CecoTreeNode,
} from "./materialDashboard/cecoTree";
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
  compareStockRiskMetricValues,
  hasPositiveEstimatedQuantityPerHouse,
  isEconomicSortKey,
  isStockRiskSortKey,
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
  const [selectedMaterialSku, setSelectedMaterialSku] = useState<string | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
  const [activeStudyTab, setActiveStudyTab] = useState<"materials" | "groups">("materials");
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(true);
  const [houseViewMode, setHouseViewMode] = useState<HouseViewMode>(() => storedHousePreferences?.houseViewMode ?? "houses");
  const [leadTimeMode, setLeadTimeMode] = useState<LeadTimeMode>(() => storedHousePreferences?.leadTimeMode ?? "worst");
  const [houseRange, setHouseRange] = useState<HouseRange>(() =>
    clampHouseRange(storedHousePreferences?.houseRange || getDefaultHouseRange()),
  );

  // House type → project mapping (global, DB-stored). linksVersion bumps when
  // the mapping is edited so comparison/economics resources refetch.
  const [links, setLinks] = useState<ProductionHouseLink[]>([]);
  const [linksLoaded, setLinksLoaded] = useState(false);
  const [linksVersion, setLinksVersion] = useState(0);
  const [linksModalOpen, setLinksModalOpen] = useState(false);
  const [startsModalRange, setStartsModalRange] = useState<HouseRange | null>(null);

  // UI state.
  const [groupEditorOpen, setGroupEditorOpen] = useState(false);
  const [projectUsageTarget, setProjectUsageTarget] = useState<{
    projectId: number;
    projectName: string;
    material: MaterialDashboardListRow;
  } | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [visibleMaterialCount, setVisibleMaterialCount] = useState(LIST_PAGE_SIZE);
  const [visibleGroupCount, setVisibleGroupCount] = useState(LIST_PAGE_SIZE);
  const [onlyEstimatedPerHouse, setOnlyEstimatedPerHouse] = useState(false);

  // ERP-wide material search (materials without recent movements).
  const [erpMaterialSearchRows, setErpMaterialSearchRows] = useState<MaterialDashboardListRow[]>([]);
  const [erpMaterialSearchLoading, setErpMaterialSearchLoading] = useState(false);
  const [erpMaterialSearchError, setErpMaterialSearchError] = useState<string | null>(null);
  const [externalMaterialRows, setExternalMaterialRows] = useState<Record<string, MaterialDashboardListRow>>({});

  const deferredMaterialSearch = useDeferredValue(materialSearch);

  const cecosResource = useDashboardResource<MaterialDashboardCeco[]>({
    cacheKey: CECO_CACHE_KEY,
    refreshNonce,
    fetcher: async (forceRefresh) => (await api.getMaterialDashboardCostCenters({ refresh: forceRefresh })).cecos,
    errorMessage: "No se pudieron cargar los centros de costo.",
  });
  const cecos = useMemo(() => cecosResource.data ?? [], [cecosResource.data]);
  const cecoNameByCode = useMemo(() => new Map(cecos.map((ceco) => [ceco.code, ceco.name])), [cecos]);
  const cecoTree = useMemo(() => buildCecoTree(cecos), [cecos]);
  const cecoNodeByCode = useMemo(() => {
    const nodes = new Map<string, CecoTreeNode>();
    function visit(node: CecoTreeNode) {
      nodes.set(node.code, node);
      node.children.forEach(visit);
    }
    cecoTree.forEach(visit);
    return nodes;
  }, [cecoTree]);
  const normalizedSelectedCecoCodes = useMemo(() => normalizeCecos(selectedCecos), [selectedCecos]);
  const selectedCecoLeafCodes = useMemo(
    () => expandCecoSelections(cecoTree, normalizedSelectedCecoCodes),
    [cecoTree, normalizedSelectedCecoCodes],
  );
  const selectedCecoLeafSet = useMemo(() => new Set(selectedCecoLeafCodes), [selectedCecoLeafCodes]);
  const selectedCecoScopes = useMemo(
    () => compressCecoSelections(cecoTree, selectedCecoLeafCodes),
    [cecoTree, selectedCecoLeafCodes],
  );
  const allCecoLeafCodes = useMemo(
    () => normalizeCecos(cecoTree.flatMap((node) => node.leafCodes)),
    [cecoTree],
  );

  useEffect(() => {
    let cancelled = false;
    async function loadLinks() {
      try {
        const response = await api.getProductionHouseLinks();
        if (!cancelled) {
          setLinks(response.houses.filter((house) => house.mapped));
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
      ? selectedCecoLeafCodes.length === 0
        ? []
        : allCecoLeafCodes.filter((code) => !selectedCecoLeafSet.has(code))
      : selectedCecoLeafCodes;
  const cecoApiFilters =
    cecoFilterMode === "exclude"
      ? selectedCecoLeafCodes.length === 0
        ? {}
        : { excludedCecos: selectedCecoLeafCodes }
      : { cecos: selectedCecoLeafCodes };
  const allCecosExcluded = allCecoLeafCodes.length > 0 && normalizedSelectedCecos.length === 0;

  const currentDashboardMovementDays = inclusiveDaySpan(houseRange.startDate, houseRange.endDate);
  const latestHistoryDate = toDateInputValue(moveToPreviousBusinessDay(new Date()));
  const historyRequestRange = { startDate: houseRange.startDate, endDate: latestHistoryDate };
  const currentDashboardRange = { startDate: houseRange.startDate, endDate: houseRange.endDate };

  function syncSelectedMaterial(response: MaterialDashboardData) {
    setSelectedMaterialSku((current) => {
      if (current && response.materials.some((row) => row.sku === current)) {
        return current;
      }
      return response.materials[0]?.sku ?? null;
    });
  }

  function syncSelectedGroup(response: MaterialStudyGroupListResponse) {
    setSelectedGroupId((current) => {
      if (current !== null && response.groups.some((row) => row.group_id === current)) {
        return current;
      }
      return response.groups[0]?.group_id ?? null;
    });
  }

  const currentDashboardKey = dashboardCacheKey(normalizedSelectedCecos, currentDashboardRange, currentDashboardMovementDays);
  const dashboardResource = useDashboardResource<MaterialDashboardData>({
    cacheKey: currentDashboardKey,
    enabled: !allCecosExcluded && activeStudyTab === "materials",
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
    onError: () => setSelectedMaterialSku(null),
  });

  const stockRiskMetricsResource = useDashboardResource<MaterialDashboardStockRiskMetricsResponse>({
    cacheKey: stockRiskMetricsCacheKey(normalizedSelectedCecos, currentDashboardRange),
    enabled: !allCecosExcluded && activeStudyTab === "materials" && isStockRiskSortKey(sort.key),
    refreshNonce,
    fetcher: (forceRefresh) =>
      api.getMaterialDashboardStockRiskMetrics(cecoApiFilters, {
        refresh: forceRefresh,
        movementDays: currentDashboardMovementDays,
        startDate: houseRange.startDate,
        endDate: houseRange.endDate,
      }),
    errorMessage: "No se pudo calcular el riesgo de quiebre de los materiales.",
  });
  const stockRiskMetricsBySku = useMemo(
    () => new Map((stockRiskMetricsResource.data?.metrics || []).map((metric) => [metric.sku, metric])),
    [stockRiskMetricsResource.data],
  );

  const groupListResource = useDashboardResource<MaterialStudyGroupListResponse>({
    cacheKey: groupDashboardCacheKey(normalizedSelectedCecos, currentDashboardRange, currentDashboardMovementDays),
    enabled: !allCecosExcluded && activeStudyTab === "groups",
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
    enabled: !allCecosExcluded && activeStudyTab === "materials",
    refreshNonce,
    fetcher: (forceRefresh) => api.getMaterialDashboardDetail(selectedMaterialSku!, cecoApiFilters, { refresh: forceRefresh }),
    errorMessage: "No se pudo cargar el detalle del material.",
  });

  const groupDetailResource = useDashboardResource<MaterialDashboardGroupDetailData>({
    cacheKey: selectedGroupId ? groupDetailCacheKey(selectedGroupId, normalizedSelectedCecos) : null,
    enabled: !allCecosExcluded && activeStudyTab === "groups",
    refreshNonce,
    fetcher: (forceRefresh) => api.getMaterialStudyGroupDetail(selectedGroupId!, cecoApiFilters, { refresh: forceRefresh }),
    errorMessage: "No se pudo cargar el detalle del grupo de materiales.",
  });

  const historyResource = useDashboardResource<MaterialDashboardMovementData>({
    cacheKey: selectedMaterialSku ? historyCacheKey(selectedMaterialSku, normalizedSelectedCecos, historyRequestRange) : null,
    enabled: !allCecosExcluded && activeStudyTab === "materials",
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
    enabled: !allCecosExcluded && activeStudyTab === "groups",
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
    enabled: !allCecosExcluded && housesMode && activeStudyTab === "materials",
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
    enabled: !allCecosExcluded && housesMode && activeStudyTab === "groups",
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
    enabled: !allCecosExcluded && activeStudyTab === "materials" && materialEconomicSortAvailable,
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
    enabled: !allCecosExcluded && activeStudyTab === "groups" && materialEconomicSortAvailable,
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
  const selectedRow = activeStudyTab === "materials" ? selectedMaterialRow : selectedGroupRow;
  const selectedDetailLike = activeStudyTab === "materials" ? detailResource.data : groupDetailResource.data;
  const selectedHistoryLike = activeStudyTab === "materials" ? historyResource.data : groupHistoryResource.data;
  const selectedHouseComparisonLike =
    activeStudyTab === "materials" ? houseComparisonResource.data : groupHouseComparisonResource.data;

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
      if (link.mapped_project_id !== null) {
        distinct.set(link.mapped_project_id, link.mapped_project_name || `Proyecto ${link.mapped_project_id}`);
      }
    }
    if (distinct.size !== 1) {
      return null;
    }
    const [id, name] = [...distinct.entries()][0];
    return { id, name };
  }, [links]);

  // Canonicalize parent selections into their operational leaf CECOs once the ERP catalog is loaded.
  useEffect(() => {
    if (!cecoTree.length) {
      return;
    }
    const availableCodes = new Set(cecos.map((ceco) => ceco.code));
    setSelectedCecos((current) => {
      const validCodes = current.filter((code) => availableCodes.has(code));
      const next = expandCecoSelections(cecoTree, validCodes);
      if (next.length === current.length && next.every((code, index) => code === current[index])) {
        return current;
      }
      return next;
    });
  }, [cecoTree, cecos]);

  useEffect(() => {
    saveCecoFilterPreferences({ mode: cecoFilterMode, cecos: selectedCecoLeafCodes });
  }, [cecoFilterMode, selectedCecoLeafCodes]);

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
    const controller = new AbortController();
    let timer: number | null = null;
    setErpMaterialSearchLoading(true);
    setErpMaterialSearchError(null);
    async function loadErpMaterialSearch() {
      try {
        const response = await api.searchMaterialDashboardMaterials(query, 10, controller.signal);
        if (cancelled) {
          return;
        }
        setErpMaterialSearchRows(response.results.map(materialSearchResultToDashboardRow));
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          return;
        }
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
    timer = window.setTimeout(() => void loadErpMaterialSearch(), 250);
    return () => {
      cancelled = true;
      controller.abort();
      if (timer !== null) {
        window.clearTimeout(timer);
      }
    };
  }, [activeTab, deferredMaterialSearch]);

  const rows = useMemo(() => {
    const fallbackSort = toBaseSort(sort);
    return (data?.materials || [])
      .filter((row) => {
        if (onlyEstimatedPerHouse && !hasPositiveEstimatedQuantityPerHouse(economicMetricsBySku.get(row.sku))) {
          return false;
        }
        if (!normalizedMaterialSearch) {
          return true;
        }
        if (!row.material_name.toLowerCase().includes(normalizedMaterialSearch) && !row.sku.toLowerCase().includes(normalizedMaterialSearch)) {
          return false;
        }
        return true;
      })
      .slice()
      .sort((left, right) => {
        if (isStockRiskSortKey(sort.key)) {
          return compareStockRiskMetricValues(
            { metric: stockRiskMetricsBySku.get(left.sku), name: left.material_name },
            { metric: stockRiskMetricsBySku.get(right.sku), name: right.material_name },
            sort.direction,
          );
        }
        if (!isEconomicSortKey(sort.key) || !currentEconomicMetrics) {
          return compareRows(left, right, fallbackSort);
        }
        return compareEconomicMetricValues(
          { value: economicMetricsBySku.get(left.sku)?.[sort.key], name: left.material_name },
          { value: economicMetricsBySku.get(right.sku)?.[sort.key], name: right.material_name },
          sort.direction,
        );
      });
  }, [currentEconomicMetrics, data?.materials, economicMetricsBySku, normalizedMaterialSearch, onlyEstimatedPerHouse, sort, stockRiskMetricsBySku]);

  const erpOnlyRows = useMemo(() => {
    if (!normalizedMaterialSearch || onlyEstimatedPerHouse) {
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
  }, [data?.materials, erpMaterialSearchRows, normalizedMaterialSearch, onlyEstimatedPerHouse]);

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

  const filteredCecoTree = useMemo(() => filterCecoTree(cecoTree, cecoSearch), [cecoSearch, cecoTree]);

  const shouldLimitMaterialRows = !normalizedMaterialSearch;
  const visibleMaterialRows = shouldLimitMaterialRows ? rows.slice(0, visibleMaterialCount) : rows;
  const visibleGroupRows = shouldLimitMaterialRows ? groupRows.slice(0, visibleGroupCount) : groupRows;
  const hasMoreMaterialRows = shouldLimitMaterialRows && visibleMaterialRows.length < rows.length;
  const hasMoreGroupRows = shouldLimitMaterialRows && visibleGroupRows.length < groupRows.length;

  const shouldCollapseSelectedCecos = selectedCecoScopes.length > MAX_COLLAPSED_SELECTED_CECOS;
  const visibleSelectedCecoCodes =
    showAllSelectedCecos || !shouldCollapseSelectedCecos
      ? selectedCecoScopes
      : selectedCecoScopes.slice(0, MAX_COLLAPSED_SELECTED_CECOS);

  function toggleCecoSelection(target: string | CecoTreeNode) {
    const node = typeof target === "string" ? cecoNodeByCode.get(target) : target;
    const leafCodes = node?.leafCodes ?? [typeof target === "string" ? target : target.code];
    if (!leafCodes.length) {
      return;
    }
    setSelectedCecos((current) => {
      const selectedLeaves = new Set(expandCecoSelections(cecoTree, normalizeCecos(current)));
      const shouldSelect = leafCodes.some((code) => !selectedLeaves.has(code));
      leafCodes.forEach((code) => {
        if (shouldSelect) {
          selectedLeaves.add(code);
        } else {
          selectedLeaves.delete(code);
        }
      });
      return normalizeCecos([...selectedLeaves]);
    });
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
      setSelectedGroupId(groupId);
      setActiveTab("groups");
      setActiveStudyTab("groups");
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
    setSelectedMaterialSku(row.sku);
    setMobileSidebarOpen(false);
  }

  function handleSidebarTabChange(tab: SidebarTab) {
    setActiveTab(tab);
    if (tab === "materials" || tab === "groups") {
      setActiveStudyTab(tab);
    }
    if (tab === "groups" && isStockRiskSortKey(sort.key)) {
      setSort(DEFAULT_SORT_STATE);
    }
  }

  function handleSelectMaterial(key: string) {
    setSelectedMaterialSku(key.slice("material:".length));
    setMobileSidebarOpen(false);
  }

  function handleSelectGroup(key: string) {
    const groupId = Number(key.slice("group:".length));
    if (Number.isFinite(groupId)) {
      setSelectedGroupId(groupId);
      setMobileSidebarOpen(false);
    }
  }

  // When the active tab has no valid selection, fall back to its first row.
  useEffect(() => {
    if (activeTab === "materials" && !selectedMaterialRow && rows[0]) {
      setSelectedMaterialSku(rows[0].sku);
    }
    if (activeTab === "groups" && !selectedGroupRow && groupRows[0]) {
      setSelectedGroupId(groupRows[0].group_id);
    }
  }, [activeTab, groupRows, rows, selectedGroupRow, selectedMaterialRow]);

  useEffect(() => {
    setVisibleMaterialCount(LIST_PAGE_SIZE);
  }, [currentDashboardKey, normalizedMaterialSearch, onlyEstimatedPerHouse, sort.direction, sort.key]);

  useEffect(() => {
    setVisibleGroupCount(LIST_PAGE_SIZE);
  }, [currentDashboardKey, normalizedMaterialSearch, sort.direction, sort.key]);

  useEffect(() => {
    if (!shouldCollapseSelectedCecos && showAllSelectedCecos) {
      setShowAllSelectedCecos(false);
    }
  }, [shouldCollapseSelectedCecos, showAllSelectedCecos]);

  const sharedSortOptions: Array<{ key: SortKey; label: string }> = [
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
  const materialSortOptions: Array<{ key: SortKey; label: string }> = [
    { key: "stockout_risk", label: "Riesgo de quiebre" },
    ...sharedSortOptions,
  ];
  const groupSortOptions = sharedSortOptions;

  return (
    <div className="absolute inset-0 top-16 z-30 flex min-h-0 flex-col overflow-hidden bg-zinc-100/70 dark:bg-zinc-950 xl:flex-row">
      {/* Panel 1: sidebar with tabs */}
      <section className={`${mobileSidebarOpen ? "flex" : "hidden"} max-h-[48vh] w-full flex-shrink-0 flex-col border-b border-black/10 bg-zinc-50/95 shadow-[4px_0_18px_rgba(0,0,0,0.025)] dark:border-white/10 dark:bg-zinc-950 xl:flex xl:max-h-none xl:w-[380px] xl:border-b-0 xl:border-r 2xl:w-[440px]`}>
        <div className="flex flex-col gap-4 border-b border-black/5 p-4 pb-0 dark:border-white/5 lg:p-5 lg:pb-0">
          <div>
            <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">Filtros</p>
            <div className="flex items-end justify-between mb-4">
              <h2 className="text-lg font-bold text-zinc-900 dark:text-white">Actividad ERP</h2>
              <div className="text-xs text-zinc-500">Actualizado: {formatDate(activeTab === "groups" ? groupData?.generated_at : data?.generated_at)}</div>
            </div>
          </div>

            <SidebarTabBar activeTab={activeTab} onTabChange={handleSidebarTabChange} selectedCecoCount={selectedCecoScopes.length} />
        </div>

        <div className="flex-1 overflow-hidden flex flex-col">
          {activeTab === "materials" ? (
            <div className="flex-1 flex flex-col min-h-0">
              <div className="space-y-3 border-b border-black/5 bg-white/55 p-4 dark:border-white/5 dark:bg-white/[0.015] lg:p-5">
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
                <SortControls
                  options={materialSortOptions}
                  sort={sort}
                  onChange={setSort}
                  filter={{
                    active: onlyEstimatedPerHouse,
                    label: "Estimado/vivienda > 0",
                    description: !materialEconomicSortAvailable
                      ? "Configura la vinculación de tipos de vivienda con proyectos para habilitar este filtro."
                      : "Solo materiales especificados en proyectos con viviendas iniciadas dentro del rango seleccionado.",
                    disabled: !onlyEstimatedPerHouse && (!materialEconomicSortAvailable || !currentEconomicMetrics),
                    loading: economicMetricsResource.loading && !currentEconomicMetrics,
                    onToggle: () => setOnlyEstimatedPerHouse((current) => !current),
                  }}
                />
                {isStockRiskSortKey(sort.key) ? (
                  <div className="text-[11px] text-zinc-500">
                    {stockRiskMetricsResource.loading && !stockRiskMetricsResource.data
                      ? "Calculando riesgo de quiebre por material..."
                      : "Proyección basada en consumo histórico de 30 días, stock actual y OC pendientes con fecha de entrega."}
                  </div>
                ) : null}
                {linksLoaded && !materialEconomicSortAvailable ? (
                  <div className="text-[11px] text-zinc-500">
                    Configura la vinculación de tipos de vivienda con proyectos (botón &quot;Vinculación&quot; junto al gráfico) para
                    mostrar ahorro y sobrecosto por vivienda en la lista, y ordenar por ese dato.
                  </div>
                ) : null}
                {materialEconomicSortAvailable && economicMetricsResource.loading && !currentEconomicMetrics ? (
                  <div className="text-[11px] text-zinc-500">Calculando ahorro y sobrecosto por vivienda para el rango seleccionado...</div>
                ) : null}
                <ErrorBanners errors={[error, historyError, houseComparisonError, economicMetricsResource.error, stockRiskMetricsResource.error]} />
              </div>

              <div
                className="flex-1 overflow-y-auto"
                onScroll={(event) =>
                  maybeLoadMoreRows(event.currentTarget, visibleMaterialRows.length, rows.length, setVisibleMaterialCount)
                }
              >
                <MaterialResultsList
                  loading={listLoading || (onlyEstimatedPerHouse && economicMetricsResource.loading && !currentEconomicMetrics)}
                  rows={visibleMaterialRows}
                  erpRows={erpOnlyRows}
                  erpLoading={erpMaterialSearchLoading}
                  erpError={erpMaterialSearchError}
                  hasMore={hasMoreMaterialRows}
                  movementWindowDays={data?.movement_window_days || currentDashboardMovementDays}
                  economicMetricsBySku={economicMetricsBySku}
                  stockRiskMetricsBySku={stockRiskMetricsBySku}
                  selectedMaterialSku={selectedMaterialSku}
                  onSelect={handleSelectMaterial}
                  onSelectErpMaterial={handleSelectErpMaterial}
                />
              </div>
            </div>
          ) : activeTab === "groups" ? (
            <div className="flex-1 flex flex-col min-h-0">
              <div className="space-y-3 border-b border-black/5 bg-white/55 p-4 dark:border-white/5 dark:bg-white/[0.015] lg:p-5">
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
                <SortControls options={groupSortOptions} sort={sort} onChange={setSort} />
                {linksLoaded && !materialEconomicSortAvailable ? (
                  <div className="text-[11px] text-zinc-500">
                    Configura la vinculación de tipos de vivienda con proyectos para mostrar sobreconsumo y costo por vivienda en grupos.
                  </div>
                ) : null}
                {materialEconomicSortAvailable && groupEconomicMetricsResource.loading && !currentGroupEconomicMetrics ? (
                  <div className="text-[11px] text-zinc-500">Calculando ahorro y sobrecosto por vivienda para grupos...</div>
                ) : null}
                <ErrorBanners errors={[error, historyError, houseComparisonError, groupEconomicMetricsResource.error]} />
              </div>

              <div
                className="flex-1 overflow-y-auto"
                onScroll={(event) =>
                  maybeLoadMoreRows(event.currentTarget, visibleGroupRows.length, groupRows.length, setVisibleGroupCount)
                }
              >
                <GroupResultsList
                  loading={groupListResource.loading && !groupData}
                  rows={visibleGroupRows}
                  hasMore={hasMoreGroupRows}
                  movementWindowDays={groupData?.movement_window_days || currentDashboardMovementDays}
                  economicMetricsByGroupId={groupEconomicMetricsById}
                  selectedGroupId={selectedGroupId}
                  onSelect={handleSelectGroup}
                />
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col min-h-0">
              <div className="border-b border-black/5 bg-white/55 px-3 py-3 dark:border-white/5 dark:bg-white/[0.015] lg:px-4 lg:py-3">
                <div className="flex items-center gap-2">
                  <input
                    value={cecoSearch}
                    onChange={(event) => setCecoSearch(event.target.value)}
                    aria-label="Buscar centro de costo"
                    className="h-9 min-w-0 flex-1 border border-black/10 bg-white px-3 text-[13px] text-zinc-900 outline-none transition-colors focus:border-accent-500 focus:ring-1 focus:ring-accent-500 dark:border-white/10 dark:bg-black/20 dark:text-white"
                    placeholder="Buscar CECO..."
                  />
                  <button
                    type="button"
                    onClick={handleResetCecoFilter}
                    className="inline-flex h-9 shrink-0 items-center justify-center border border-black/10 bg-white px-3 text-xs font-medium text-zinc-700 shadow-sm transition-colors hover:border-black/15 hover:bg-zinc-50 dark:border-white/10 dark:bg-white/5 dark:text-zinc-300 dark:hover:bg-white/10"
                    title="Reiniciar filtro CECO"
                    aria-label="Reiniciar filtro CECO"
                  >
                    Reiniciar
                  </button>
                </div>

                <div className="mt-2">
                  <CecoFilterModeToggle mode={cecoFilterMode} onChange={setCecoFilterMode} />
                </div>

                <p className="mt-2 text-[11px] leading-4 text-zinc-500">
                  {cecoFilterMode === "exclude"
                    ? "Selecciona para ocultar CECOs completos o sus subniveles."
                    : "Selecciona los CECOs que deben permanecer visibles."}
                </p>

                <div className="mt-2">
                  <SelectedCecoChips
                    allCodes={selectedCecoScopes}
                    visibleCodes={visibleSelectedCecoCodes}
                    mode={cecoFilterMode}
                    cecoNameByCode={cecoNameByCode}
                    collapsible={shouldCollapseSelectedCecos}
                    showAll={showAllSelectedCecos}
                    onToggleShowAll={setShowAllSelectedCecos}
                    onToggleCeco={toggleCecoSelection}
                  />
                </div>
              </div>

              <div className="flex-1 overflow-y-auto px-2 py-2 lg:px-4">
                <CecoResultsList
                  nodes={filteredCecoTree}
                  selectedLeafSet={selectedCecoLeafSet}
                  cecoFilterMode={cecoFilterMode}
                  onToggle={toggleCecoSelection}
                  searchActive={Boolean(cecoSearch.trim())}
                />
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Panel 2: trend charts and procurement metrics */}
      <main className="flex-1 min-w-0 bg-white dark:bg-zinc-950 flex flex-col h-full relative overflow-hidden">
        <div className="flex items-center justify-between border-b border-black/10 bg-white px-4 py-2 dark:border-white/10 dark:bg-zinc-950 xl:hidden">
          <span className="text-xs font-semibold text-zinc-500">Panel de materiales</span>
          <button
            type="button"
            onClick={() => setMobileSidebarOpen((current) => !current)}
            className="border border-black/10 px-3 py-1.5 text-xs font-semibold text-zinc-700 dark:border-white/10 dark:text-zinc-200"
            aria-expanded={mobileSidebarOpen}
          >
            {mobileSidebarOpen ? "Ocultar filtros" : "Mostrar filtros"}
          </button>
        </div>
        <MovementHistoryCard
          selected={selectedRow}
          detail={selectedDetailLike}
          history={selectedHistoryLike}
          houseViewMode={houseViewMode}
          onHouseViewModeChange={setHouseViewMode}
          onOpenLinksModal={() => setLinksModalOpen(true)}
          onOpenStartsModal={setStartsModalRange}
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
            activeStudyTab === "materials" && selectedMaterialSku
              ? economicMetricsBySku.get(selectedMaterialSku) ?? null
              : activeStudyTab === "groups" && selectedGroupId
                ? groupEconomicMetricsById.get(selectedGroupId) ?? null
                : null
          }
          onInspectProjectUsage={activeStudyTab === "materials" && selectedMaterialRow && singleMappedProject ? () => handleOpenProjectUsage(selectedMaterialRow) : null}
        />
      </main>

      <HouseLinksModal
        open={linksModalOpen}
        canEdit={canEditGroups}
        onClose={() => setLinksModalOpen(false)}
        onSaved={() => setLinksVersion((current) => current + 1)}
      />

      <HouseStartsModal
        open={startsModalRange !== null}
        range={startsModalRange || houseRange}
        onClose={() => setStartsModalRange(null)}
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
