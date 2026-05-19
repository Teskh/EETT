import type { PageAccessMap, SessionUser } from "./types";

export type PageKey = "catalog" | "material_dashboard" | "cost_model" | "history" | "projects" | "settings";

export type PageDefinition = {
  key: PageKey;
  label: string;
  href: string;
  navKey: "catalog" | "dashboard" | "cost-model" | "history" | "projects" | "settings";
  icon: string;
};

export const APP_PAGES: PageDefinition[] = [
  { key: "catalog", label: "Editor de Base de Datos", href: "/catalog", navKey: "catalog", icon: "ph-database" },
  { key: "material_dashboard", label: "Panel de Materiales", href: "/dashboard/materials", navKey: "dashboard", icon: "ph-chart-bar" },
  { key: "cost_model", label: "Modelo de Costos", href: "/cost-model", navKey: "cost-model", icon: "ph-coins" },
  { key: "history", label: "Historial de Cambios", href: "/history", navKey: "history", icon: "ph-clock-counter-clockwise" },
  { key: "projects", label: "Proyectos", href: "/projects", navKey: "projects", icon: "ph-kanban" },
  { key: "settings", label: "Configuracion", href: "/settings", navKey: "settings", icon: "ph-gear" },
];

export function canReadPage(user: SessionUser, pageKey: PageKey) {
  if (user.is_guest && pageKey === "cost_model") {
    return false;
  }
  return Boolean(user.page_access?.[pageKey]?.can_read || user.page_access?.[pageKey]?.can_edit);
}

export function canEditPage(user: SessionUser, pageKey: PageKey) {
  if (user.is_guest) {
    return false;
  }
  return Boolean(user.page_access?.[pageKey]?.can_edit);
}

export function normalizePageAccess(access: PageAccessMap = {}): PageAccessMap {
  return Object.fromEntries(
    APP_PAGES.map((page) => {
      const row = access[page.key] ?? { can_read: false, can_edit: false };
      return [page.key, { can_read: Boolean(row.can_read || row.can_edit), can_edit: Boolean(row.can_edit) }];
    }),
  );
}
