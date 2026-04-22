export type ThemeMode = "light" | "dark";

const LAST_THEME_USER_KEY = "spec-sheets.theme.last-user";
const USER_THEME_KEY_PREFIX = "spec-sheets.theme.user.";
const DEFAULT_THEME_MODE: ThemeMode = "dark";

function isThemeMode(value: string | null): value is ThemeMode {
  return value === "light" || value === "dark";
}

function themeStorageKey(username: string) {
  return `${USER_THEME_KEY_PREFIX}${username}`;
}

export function applyTheme(mode: ThemeMode) {
  document.documentElement.classList.toggle("dark", mode === "dark");
}

export function readStoredThemeForUser(username: string): ThemeMode | null {
  const storedTheme = window.localStorage.getItem(themeStorageKey(username));
  return isThemeMode(storedTheme) ? storedTheme : null;
}

export function getPreferredThemeForUser(username: string): ThemeMode {
  return readStoredThemeForUser(username) ?? DEFAULT_THEME_MODE;
}

export function persistThemeForUser(username: string, mode: ThemeMode) {
  window.localStorage.setItem(themeStorageKey(username), mode);
  window.localStorage.setItem(LAST_THEME_USER_KEY, username);
}

export function rememberThemeUser(username: string) {
  window.localStorage.setItem(LAST_THEME_USER_KEY, username);
}
