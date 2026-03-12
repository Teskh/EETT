import type {
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

async function request<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
    ...init,
  });

  if (!response.ok) {
    let message = response.statusText;
    try {
      const payload = (await response.json()) as { detail?: string };
      message = payload.detail || message;
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
  createProject(payload: CreateProjectRequest) {
    return request<MutationResult>("/api/v1/projects", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  getProject(projectId: number) {
    return request<ProjectDetailData>(`/api/v1/projects/${projectId}`);
  },
  createProjectSubtype(projectId: number, payload: CreateProjectSubtypeRequest) {
    return request<MutationResult>(`/api/v1/projects/${projectId}/subtypes`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  updateProjectSubtype(projectId: number, subtypeId: number, payload: UpdateProjectSubtypeRequest) {
    return request<MutationResult>(`/api/v1/projects/${projectId}/subtypes/${subtypeId}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
  },
  deleteProjectSubtype(projectId: number, subtypeId: number) {
    return request<MutationResult>(`/api/v1/projects/${projectId}/subtypes/${subtypeId}`, {
      method: "DELETE",
    });
  },
  createProjectInstance(projectId: number, payload: CreateProjectInstanceRequest) {
    return request<MutationResult>(`/api/v1/projects/${projectId}/instances`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  updateProjectInstance(projectId: number, instanceId: number, payload: UpdateProjectInstanceRequest) {
    return request<MutationResult>(`/api/v1/projects/${projectId}/instances/${instanceId}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
  },
  createProjectOccurrence(projectId: number, instanceId: number, payload: UpdateProjectOccurrenceRequest) {
    return request<MutationResult>(`/api/v1/projects/${projectId}/instances/${instanceId}/occurrences`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  updateProjectOccurrence(projectId: number, instanceId: number, occurrenceId: number, payload: UpdateProjectOccurrenceRequest) {
    return request<MutationResult>(`/api/v1/projects/${projectId}/instances/${instanceId}/occurrences/${occurrenceId}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
  },
  deleteProjectOccurrence(projectId: number, instanceId: number, occurrenceId: number) {
    return request<MutationResult>(`/api/v1/projects/${projectId}/instances/${instanceId}/occurrences/${occurrenceId}`, {
      method: "DELETE",
    });
  },
  deleteProjectInstance(projectId: number, instanceId: number) {
    return request<MutationResult>(`/api/v1/projects/${projectId}/instances/${instanceId}`, {
      method: "DELETE",
    });
  },
  updateMaterialOccurrence(projectId: number, instanceId: number, ruleId: number, payload: UpdateMaterialOccurrenceRequest) {
    return request<MutationResult>(`/api/v1/projects/${projectId}/instances/${instanceId}/materials/${ruleId}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
  },
};
