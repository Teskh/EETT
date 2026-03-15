import type {
  ActivityGroup,
  CatalogAttribute,
  CatalogMaterialRule,
  CatalogMaterialSearchResponse,
  CatalogPageData,
  CreateProjectSubtypeRequest,
  CreateUserRequest,
  CreateCategoryRequest,
  CreateComponentRequest,
  CreateProjectInstanceRequest,
  CreateProjectRequest,
  LoginRequest,
  ManagedUser,
  MaterialDashboardCecoResponse,
  MaterialDashboardHouseComparisonData,
  MaterialDashboardHouseTypesResponse,
  MaterialDashboardData,
  MaterialDashboardDetailData,
  MaterialDashboardMovementData,
  MutationResult,
  ProjectDetailData,
  ProjectsBoardData,
  SessionUser,
  UpdateMaterialOccurrenceRequest,
  UpdateProjectOccurrenceRequest,
  UpdateProjectSubtypeRequest,
  UpdateUserRequest,
  UpdateComponentRequest,
  UpdateProjectInstanceRequest,
  UserDirectory,
} from "./types";

class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

function mergeHeaders(...headerSets: Array<HeadersInit | undefined>): Headers {
  const headers = new Headers();
  for (const headerSet of headerSets) {
    if (!headerSet) {
      continue;
    }
    const nextHeaders = new Headers(headerSet);
    nextHeaders.forEach((value, key) => {
      headers.set(key, value);
    });
  }
  return headers;
}

async function request<T>(input: string, init?: RequestInit): Promise<T> {
  const headers = mergeHeaders(
    {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
    init?.headers,
  );
  const response = await fetch(input, {
    credentials: "same-origin",
    ...init,
    headers,
  });

  if (!response.ok) {
    let message = response.statusText;
    try {
      const rawText = await response.text();
      const payload = rawText ? (JSON.parse(rawText) as { detail?: unknown; message?: unknown }) : {};
      message = extractErrorMessage(payload, message);
    } catch {
      // Ignore non-JSON failures and fall back to status text.
    }
    throw new ApiError(response.status, message);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export { ApiError };

function stringifyErrorDetail(detail: unknown): string | null {
  if (typeof detail === "string") {
    return detail;
  }
  if (Array.isArray(detail)) {
    return detail
      .map((item) => stringifyErrorDetail(item))
      .filter((item): item is string => Boolean(item))
      .join("; ");
  }
  if (detail && typeof detail === "object") {
    const record = detail as Record<string, unknown>;
    if (typeof record.msg === "string") {
      return record.msg;
    }
    if (typeof record.message === "string") {
      return record.message;
    }
    try {
      return JSON.stringify(detail);
    } catch {
      return null;
    }
  }
  return null;
}

function extractErrorMessage(payload: { detail?: unknown; message?: unknown }, fallback: string): string {
  const detailMessage = stringifyErrorDetail(payload.detail);
  if (detailMessage) {
    return detailMessage;
  }
  const messageValue = stringifyErrorDetail(payload.message);
  if (messageValue) {
    return messageValue;
  }
  return fallback;
}

function generateMutationBatchId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `batch-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function mutationHeaders(mutationBatchId?: string) {
  return { "X-Mutation-Batch-Id": mutationBatchId || generateMutationBatchId() };
}

type MaterialDashboardRequestOptions = {
  refresh?: boolean;
  movementDays?: number;
  startDate?: string;
  endDate?: string;
};

export const api = {
  login(payload: LoginRequest) {
    return request<SessionUser>("/api/v1/login", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  logout() {
    return request<void>("/api/v1/logout", {
      method: "POST",
    });
  },
  getSession() {
    return request<SessionUser>("/api/v1/session");
  },
  getUsers() {
    return request<UserDirectory>("/api/v1/users");
  },
  createUser(payload: CreateUserRequest) {
    return request<ManagedUser>("/api/v1/users", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  updateUser(userId: number, payload: UpdateUserRequest) {
    return request<ManagedUser>(`/api/v1/users/${userId}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
  },
  deleteUser(userId: number) {
    return request<MutationResult>(`/api/v1/users/${userId}`, {
      method: "DELETE",
    });
  },
  getCatalog(categoryId?: number | null) {
    const query = categoryId ? `?category_id=${categoryId}` : "";
    return request<CatalogPageData>(`/api/v1/catalog${query}`);
  },
  createCategory(payload: CreateCategoryRequest) {
    return request<MutationResult>("/api/v1/catalog/categories", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  createComponent(payload: CreateComponentRequest) {
    return request<MutationResult>("/api/v1/catalog/components", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  updateComponent(componentId: number, payload: UpdateComponentRequest) {
    return request<MutationResult>(`/api/v1/catalog/components/${componentId}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
  },
  deleteComponent(componentId: number) {
    return request<MutationResult>(`/api/v1/catalog/components/${componentId}`, {
      method: "DELETE",
    });
  },
  replaceComponentAttributes(componentId: number, scope: string, attributes: CatalogAttribute[]) {
    return request<MutationResult>(`/api/v1/catalog/components/${componentId}/attributes`, {
      method: "PUT",
      body: JSON.stringify({ scope, attributes }),
    });
  },
  updateCategoryLinks(categoryId: number, linkedCategoryIds: number[]) {
    return request<MutationResult>(`/api/v1/catalog/categories/${categoryId}/links`, {
      method: "PUT",
      body: JSON.stringify({ linked_category_ids: linkedCategoryIds }),
    });
  },
  replaceComponentMaterialRules(componentId: number, rules: CatalogMaterialRule[]) {
    return request<MutationResult>(`/api/v1/catalog/components/${componentId}/materials`, {
      method: "PUT",
      body: JSON.stringify({ rules }),
    });
  },
  searchCatalogMaterials(query: string, limit = 12) {
    const params = new URLSearchParams({ q: query, limit: String(limit) });
    return request<CatalogMaterialSearchResponse>(`/api/v1/catalog/materials/search?${params.toString()}`);
  },
  getProjects() {
    return request<ProjectsBoardData>("/api/v1/projects");
  },
  getMaterialDashboard(cecos: string[] = [], options: MaterialDashboardRequestOptions = {}) {
    const params = new URLSearchParams();
    cecos.forEach((ceco) => params.append("ceco", ceco));
    if (options.movementDays && Number.isFinite(options.movementDays)) {
      params.set("movement_days", String(Math.max(Math.floor(options.movementDays), 1)));
    }
    if (options.refresh) {
      params.set("refresh", "1");
    }
    const query = params.toString();
    return request<MaterialDashboardData>(`/api/v1/dashboard/materials${query ? `?${query}` : ""}`);
  },
  getMaterialDashboardCostCenters(options: MaterialDashboardRequestOptions = {}) {
    const params = new URLSearchParams();
    if (options.refresh) {
      params.set("refresh", "1");
    }
    const query = params.toString();
    return request<MaterialDashboardCecoResponse>(`/api/v1/dashboard/materials/cecos${query ? `?${query}` : ""}`);
  },
  getMaterialDashboardHouseTypes() {
    return request<MaterialDashboardHouseTypesResponse>("/api/v1/dashboard/materials/house-types");
  },
  getMaterialDashboardDetail(sku: string, cecos: string[] = [], options: MaterialDashboardRequestOptions = {}) {
    const params = new URLSearchParams();
    cecos.forEach((ceco) => params.append("ceco", ceco));
    if (options.refresh) {
      params.set("refresh", "1");
    }
    const query = params.toString();
    return request<MaterialDashboardDetailData>(`/api/v1/dashboard/materials/${encodeURIComponent(sku)}${query ? `?${query}` : ""}`);
  },
  getMaterialDashboardHistory(sku: string, cecos: string[] = [], options: MaterialDashboardRequestOptions = {}) {
    const params = new URLSearchParams();
    cecos.forEach((ceco) => params.append("ceco", ceco));
    if (options.startDate) {
      params.set("start_date", options.startDate);
    }
    if (options.endDate) {
      params.set("end_date", options.endDate);
    }
    if (options.refresh) {
      params.set("refresh", "1");
    }
    const query = params.toString();
    return request<MaterialDashboardMovementData>(`/api/v1/dashboard/materials/${encodeURIComponent(sku)}/movements${query ? `?${query}` : ""}`);
  },
  getMaterialDashboardHouseComparison(
    sku: string,
    houseTypeId: number,
    cecos: string[] = [],
    options: MaterialDashboardRequestOptions = {},
  ) {
    const params = new URLSearchParams();
    params.set("house_type_id", String(houseTypeId));
    if (options.startDate) {
      params.set("start_date", options.startDate);
    }
    if (options.endDate) {
      params.set("end_date", options.endDate);
    }
    cecos.forEach((ceco) => params.append("ceco", ceco));
    if (options.refresh) {
      params.set("refresh", "1");
    }
    const query = params.toString();
    return request<MaterialDashboardHouseComparisonData>(
      `/api/v1/dashboard/materials/${encodeURIComponent(sku)}/house-comparison${query ? `?${query}` : ""}`,
    );
  },
  getActivityHistory() {
    return request<ActivityGroup[]>("/api/v1/activity");
  },
  createProject(payload: CreateProjectRequest, mutationBatchId?: string) {
    return request<MutationResult>("/api/v1/projects", {
      method: "POST",
      body: JSON.stringify(payload),
      headers: mutationHeaders(mutationBatchId),
    });
  },
  getProject(projectId: number) {
    return request<ProjectDetailData>(`/api/v1/projects/${projectId}`);
  },
  getProjectActivity(projectId: number) {
    return request<ActivityGroup[]>(`/api/v1/projects/${projectId}/activity`);
  },
  createProjectSubtype(projectId: number, payload: CreateProjectSubtypeRequest, mutationBatchId?: string) {
    return request<MutationResult>(`/api/v1/projects/${projectId}/subtypes`, {
      method: "POST",
      body: JSON.stringify(payload),
      headers: mutationHeaders(mutationBatchId),
    });
  },
  updateProjectSubtype(projectId: number, subtypeId: number, payload: UpdateProjectSubtypeRequest, mutationBatchId?: string) {
    return request<MutationResult>(`/api/v1/projects/${projectId}/subtypes/${subtypeId}`, {
      method: "PUT",
      body: JSON.stringify(payload),
      headers: mutationHeaders(mutationBatchId),
    });
  },
  deleteProjectSubtype(projectId: number, subtypeId: number, mutationBatchId?: string) {
    return request<MutationResult>(`/api/v1/projects/${projectId}/subtypes/${subtypeId}`, {
      method: "DELETE",
      headers: mutationHeaders(mutationBatchId),
    });
  },
  createProjectInstance(projectId: number, payload: CreateProjectInstanceRequest, mutationBatchId?: string) {
    return request<MutationResult>(`/api/v1/projects/${projectId}/instances`, {
      method: "POST",
      body: JSON.stringify(payload),
      headers: mutationHeaders(mutationBatchId),
    });
  },
  updateProjectInstance(projectId: number, instanceId: number, payload: UpdateProjectInstanceRequest, mutationBatchId?: string) {
    return request<MutationResult>(`/api/v1/projects/${projectId}/instances/${instanceId}`, {
      method: "PUT",
      body: JSON.stringify(payload),
      headers: mutationHeaders(mutationBatchId),
    });
  },
  createProjectOccurrence(projectId: number, instanceId: number, payload: UpdateProjectOccurrenceRequest, mutationBatchId?: string) {
    return request<MutationResult>(`/api/v1/projects/${projectId}/instances/${instanceId}/occurrences`, {
      method: "POST",
      body: JSON.stringify(payload),
      headers: mutationHeaders(mutationBatchId),
    });
  },
  updateProjectOccurrence(projectId: number, instanceId: number, occurrenceId: number, payload: UpdateProjectOccurrenceRequest, mutationBatchId?: string) {
    return request<MutationResult>(`/api/v1/projects/${projectId}/instances/${instanceId}/occurrences/${occurrenceId}`, {
      method: "PUT",
      body: JSON.stringify(payload),
      headers: mutationHeaders(mutationBatchId),
    });
  },
  deleteProjectOccurrence(projectId: number, instanceId: number, occurrenceId: number, mutationBatchId?: string) {
    return request<MutationResult>(`/api/v1/projects/${projectId}/instances/${instanceId}/occurrences/${occurrenceId}`, {
      method: "DELETE",
      headers: mutationHeaders(mutationBatchId),
    });
  },
  deleteProjectInstance(projectId: number, instanceId: number, mutationBatchId?: string) {
    return request<MutationResult>(`/api/v1/projects/${projectId}/instances/${instanceId}`, {
      method: "DELETE",
      headers: mutationHeaders(mutationBatchId),
    });
  },
  updateMaterialOccurrence(projectId: number, instanceId: number, ruleId: number, payload: UpdateMaterialOccurrenceRequest, mutationBatchId?: string) {
    return request<MutationResult>(`/api/v1/projects/${projectId}/instances/${instanceId}/materials/${ruleId}`, {
      method: "PUT",
      body: JSON.stringify(payload),
      headers: mutationHeaders(mutationBatchId),
    });
  },
};
