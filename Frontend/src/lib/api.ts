import type {
  CatalogAttribute,
  CatalogPageData,
  CreateCategoryRequest,
  CreateComponentRequest,
  CreateProjectInstanceRequest,
  CreateProjectRequest,
  MutationResult,
  ProjectDetailData,
  ProjectsBoardData,
  SessionUser,
  UpdateComponentRequest,
  UpdateProjectInstanceRequest,
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
  getSession() {
    return request<SessionUser>("/api/v1/session");
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
  replaceComponentAttributes(componentId: number, attributes: CatalogAttribute[]) {
    return request<MutationResult>(`/api/v1/catalog/components/${componentId}/attributes`, {
      method: "PUT",
      body: JSON.stringify({ attributes }),
    });
  },
  updateCategoryLinks(categoryId: number, linkedCategoryIds: number[]) {
    return request<MutationResult>(`/api/v1/catalog/categories/${categoryId}/links`, {
      method: "PUT",
      body: JSON.stringify({ linked_category_ids: linkedCategoryIds }),
    });
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
  deleteProjectInstance(projectId: number, instanceId: number) {
    return request<MutationResult>(`/api/v1/projects/${projectId}/instances/${instanceId}`, {
      method: "DELETE",
    });
  },
};
