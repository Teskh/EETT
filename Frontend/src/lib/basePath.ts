const configuredBasePath = (import.meta.env.VITE_APP_BASE_PATH || "").trim().replace(/^\/*|\/*$/g, "");
const APP_BASE_PATH = configuredBasePath ? `/${configuredBasePath}` : "";

export function stripAppBasePath(pathname: string): string {
  if (!APP_BASE_PATH) {
    return pathname || "/";
  }
  if (pathname === APP_BASE_PATH) {
    return "/";
  }
  if (pathname.startsWith(`${APP_BASE_PATH}/`)) {
    return pathname.slice(APP_BASE_PATH.length) || "/";
  }
  return pathname || "/";
}

export function toAppPath(path: string): string {
  if (!path || !APP_BASE_PATH || /^(?:[a-z]+:)?\/\//i.test(path)) {
    return path;
  }
  const normalized = path.startsWith("/") ? path : `/${path}`;
  if (normalized === APP_BASE_PATH || normalized.startsWith(`${APP_BASE_PATH}/`)) {
    return normalized;
  }
  return `${APP_BASE_PATH}${normalized}`;
}
