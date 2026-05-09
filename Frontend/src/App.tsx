import { useEffect, useState } from "react";

import { AppShell } from "./components/AppShell";
import { ApiError, api } from "./lib/api";
import { canEditPage, canReadPage } from "./lib/pageAccess";
import { applyTheme, getPreferredThemeForUser, persistThemeForUser, rememberThemeUser, type ThemeMode } from "./lib/theme";
import type { SessionUser } from "./lib/types";
import { CatalogPage } from "./pages/CatalogPage";
import { ChangeHistoryPage } from "./pages/ChangeHistoryPage";
import { CostModelPage } from "./pages/CostModelPage";
import { HomePage } from "./pages/HomePage";
import { LoginPage } from "./pages/LoginPage";
import { MaterialDashboardPage } from "./pages/MaterialDashboardPage";
import { ProjectDetailPage } from "./pages/ProjectDetailPage";
import { ProjectsPage } from "./pages/ProjectsPage";
import { SettingsPage } from "./pages/SettingsPage";

type Route =
  | { name: "home" }
  | { name: "login" }
  | { name: "catalog"; categoryId: number | null }
  | { name: "material-dashboard" }
  | { name: "cost-model"; projectId: number | null }
  | { name: "history" }
  | { name: "projects" }
  | { name: "project-detail"; projectId: number }
  | { name: "project-cost-model"; projectId: number }
  | { name: "settings" }
  | { name: "not-found" };

function parseCurrentRoute(): Route {
  const { pathname, search } = window.location;
  if (pathname === "/") {
    return { name: "home" };
  }
  if (pathname === "/login") {
    return { name: "login" };
  }
  if (pathname === "/catalog") {
    const params = new URLSearchParams(search);
    const categoryId = params.get("category_id");
    return { name: "catalog", categoryId: categoryId ? Number(categoryId) : null };
  }
  if (pathname === "/dashboard/materials") {
    return { name: "material-dashboard" };
  }
  if (pathname === "/cost-model") {
    const params = new URLSearchParams(search);
    const projectId = params.get("project_id");
    const parsedProjectId = projectId ? Number(projectId) : null;
    return { name: "cost-model", projectId: parsedProjectId !== null && Number.isFinite(parsedProjectId) ? parsedProjectId : null };
  }
  if (pathname === "/history") {
    return { name: "history" };
  }
  if (pathname === "/projects") {
    return { name: "projects" };
  }
  if (pathname === "/settings" || pathname === "/users") {
    return { name: "settings" };
  }
  const projectCostModelMatch = pathname.match(/^\/projects\/(\d+)\/cost-model$/);
  if (projectCostModelMatch) {
    return { name: "project-cost-model", projectId: Number(projectCostModelMatch[1]) };
  }
  const projectMatch = pathname.match(/^\/projects\/(\d+)$/);
  if (projectMatch) {
    return { name: "project-detail", projectId: Number(projectMatch[1]) };
  }
  return { name: "not-found" };
}

function currentPath() {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function AccessDenied({ message }: { message: string }) {
  return <div className="liquid-glass rounded-2xl p-8 text-sm text-zinc-600 dark:text-zinc-400">{message}</div>;
}

export function App() {
  const [route, setRoute] = useState<Route>(() => parseCurrentRoute());
  const [session, setSession] = useState<SessionUser | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [projectDetailTitle, setProjectDetailTitle] = useState("Proyecto");
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => (
    document.documentElement.classList.contains("dark") ? "dark" : "light"
  ));

  useEffect(() => {
    const handlePopstate = () => {
      setRoute(parseCurrentRoute());
    };
    window.addEventListener("popstate", handlePopstate);
    return () => window.removeEventListener("popstate", handlePopstate);
  }, []);

  function navigate(to: string, replace = false) {
    if (replace) {
      window.history.replaceState({}, "", to);
    } else {
      window.history.pushState({}, "", to);
    }
    setRoute(parseCurrentRoute());
  }

  function applyThemeForUser(user: SessionUser) {
    const preferredTheme = getPreferredThemeForUser(user.username);
    rememberThemeUser(user.username);
    applyTheme(preferredTheme);
    setThemeMode(preferredTheme);
  }

  function handleThemeModeChange(nextThemeMode: ThemeMode) {
    applyTheme(nextThemeMode);
    setThemeMode(nextThemeMode);
    if (session) {
      persistThemeForUser(session.username, nextThemeMode);
    }
  }

  async function loadSession() {
    setSessionLoading(true);
    try {
      const nextSession = await api.getSession();
      setSession(nextSession);
      applyThemeForUser(nextSession);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setSession(null);
      } else {
        setAuthError(err instanceof ApiError ? err.message : "No se pudo cargar la sesión.");
      }
    } finally {
      setSessionLoading(false);
    }
  }

  useEffect(() => {
    void loadSession();
  }, []);

  useEffect(() => {
    setProjectDetailTitle("Proyecto");
  }, [route]);

  useEffect(() => {
    if (route.name === "home") {
      document.title = "Inicio | EETT";
    } else if (route.name === "login") {
      document.title = "Ingreso | EETT";
    } else if (route.name === "catalog") {
      document.title = "Editor de Base de Datos | EETT";
    } else if (route.name === "material-dashboard") {
      document.title = "Panel de Materiales | EETT";
    } else if (route.name === "cost-model") {
      document.title = route.projectId ? `${projectDetailTitle} — Modelo de Costos | EETT` : "Modelo de Costos | EETT";
    } else if (route.name === "history") {
      document.title = "Historial de Cambios | EETT";
    } else if (route.name === "projects") {
      document.title = "Proyectos | EETT";
    } else if (route.name === "project-detail") {
      document.title = `${projectDetailTitle} | EETT`;
    } else if (route.name === "project-cost-model") {
      document.title = `${projectDetailTitle} — Modelo de Costos | EETT`;
    } else if (route.name === "settings") {
      document.title = "Configuracion | EETT";
    } else {
      document.title = "EETT";
    }
  }, [projectDetailTitle, route]);

  useEffect(() => {
    if (session && route.name === "login") {
      navigate("/", true);
    }
  }, [route, session]);

  useEffect(() => {
    if (route.name === "project-cost-model") {
      navigate(`/cost-model?project_id=${route.projectId}`, true);
    }
  }, [route]);

  async function handleLogin(username: string, password: string) {
    setAuthLoading(true);
    setAuthError(null);
    try {
      const user = await api.login({ username, password });
      setSession(user);
      applyThemeForUser(user);
      const nextPath = route.name === "login" ? "/" : currentPath();
      navigate(nextPath === "/login" ? "/" : nextPath, true);
    } catch (err) {
      setAuthError(err instanceof ApiError ? err.message : "No se pudo iniciar sesión.");
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleLogout() {
    setAuthLoading(true);
    setAuthError(null);
    try {
      await api.logout();
      setSession(null);
      navigate("/login", true);
    } catch (err) {
      setAuthError(err instanceof ApiError ? err.message : "No se pudo cerrar sesión.");
    } finally {
      setAuthLoading(false);
    }
  }

  if (sessionLoading) {
    return <div className="min-h-[100dvh] bg-zinc-50 dark:bg-zinc-950 text-zinc-500 flex items-center justify-center">Cargando sesión...</div>;
  }

  if (!session) {
    return <LoginPage onLogin={handleLogin} loading={authLoading} error={authError} />;
  }

  if (route.name === "login") {
    return null;
  }

  if (route.name === "home") {
    return (
      <AppShell
        title="Inicio"
        activeNav="home"
        currentUser={session}
        themeMode={themeMode}
        onThemeModeChange={handleThemeModeChange}
        onNavigate={navigate}
        onLogout={handleLogout}
      >
        <HomePage onNavigate={navigate} currentUser={session} />
      </AppShell>
    );
  }

  if (route.name === "projects") {
    return (
      <AppShell
        title="Proyectos"
        activeNav="projects"
        currentUser={session}
        themeMode={themeMode}
        onThemeModeChange={handleThemeModeChange}
        onNavigate={navigate}
        onLogout={handleLogout}
      >
        {canReadPage(session, "projects") ? (
          <ProjectsPage onNavigate={navigate} currentUser={session} />
        ) : (
          <AccessDenied message="Este rol no puede abrir proyectos." />
        )}
      </AppShell>
    );
  }

  if (route.name === "material-dashboard") {
    return (
        <AppShell
          title="Panel de Materiales"
          activeNav="dashboard"
          currentUser={session}
          themeMode={themeMode}
          onThemeModeChange={handleThemeModeChange}
          onNavigate={navigate}
          onLogout={handleLogout}
        >
        {canReadPage(session, "material_dashboard") ? (
          <MaterialDashboardPage canEditGroups={canEditPage(session, "material_dashboard")} />
        ) : (
          <AccessDenied message="Este rol no puede abrir el panel de materiales." />
        )}
      </AppShell>
    );
  }

  if (route.name === "cost-model") {
    return (
      <AppShell
        title={route.projectId ? `${projectDetailTitle} — Modelo de Costos` : "Modelo de Costos"}
        activeNav="cost-model"
        currentUser={session}
        themeMode={themeMode}
        onThemeModeChange={handleThemeModeChange}
        onNavigate={navigate}
        onLogout={handleLogout}
      >
        {canReadPage(session, "cost_model") ? (
          <CostModelPage
            projectId={route.projectId}
            onNavigate={navigate}
            onTitleChange={setProjectDetailTitle}
            currentUser={session}
          />
        ) : (
          <AccessDenied message="Este rol no puede abrir el modelo de costos." />
        )}
      </AppShell>
    );
  }

  if (route.name === "history") {
    return (
      <AppShell
        title="Historial de Cambios"
        activeNav="history"
        currentUser={session}
        themeMode={themeMode}
        onThemeModeChange={handleThemeModeChange}
        onNavigate={navigate}
        onLogout={handleLogout}
      >
        {canReadPage(session, "history") ? <ChangeHistoryPage /> : <AccessDenied message="Este rol no puede abrir el historial de cambios." />}
      </AppShell>
    );
  }

  if (route.name === "catalog") {
    return (
      <AppShell
        title="Editor de Base de Datos"
        activeNav="catalog"
        currentUser={session}
        themeMode={themeMode}
        onThemeModeChange={handleThemeModeChange}
        onNavigate={navigate}
        onLogout={handleLogout}
      >
        {canReadPage(session, "catalog") ? (
          <CatalogPage categoryId={route.categoryId} onNavigate={navigate} />
        ) : (
          <AccessDenied message="Este rol no puede abrir el editor de catálogo." />
        )}
      </AppShell>
    );
  }

  if (route.name === "project-detail") {
    return (
      <AppShell
        title={projectDetailTitle}
        activeNav="projects"
        currentUser={session}
        themeMode={themeMode}
        onThemeModeChange={handleThemeModeChange}
        onNavigate={navigate}
        onLogout={handleLogout}
      >
        {canReadPage(session, "projects") ? (
          <ProjectDetailPage projectId={route.projectId} onNavigate={navigate} onTitleChange={setProjectDetailTitle} />
        ) : (
          <AccessDenied message="Este rol no puede abrir proyectos." />
        )}
      </AppShell>
    );
  }

  if (route.name === "project-cost-model") {
    return null;
  }

  if (route.name === "settings") {
    return (
      <AppShell
        title="Configuracion"
        activeNav="settings"
        currentUser={session}
        themeMode={themeMode}
        onThemeModeChange={handleThemeModeChange}
        onNavigate={navigate}
        onLogout={handleLogout}
      >
        {canReadPage(session, "settings") ? (
          <SettingsPage currentUsername={session.username} canManageUsers={session.permissions.user_admin && canEditPage(session, "settings")} />
        ) : (
          <AccessDenied message="Solo la cuenta sysadmin reservada puede acceder a configuracion." />
        )}
      </AppShell>
    );
  }

  return (
    <AppShell
      title="EETT"
      activeNav="home"
      currentUser={session}
      themeMode={themeMode}
      onThemeModeChange={handleThemeModeChange}
      onNavigate={navigate}
      onLogout={handleLogout}
    >
      <div className="liquid-glass rounded-2xl p-8 text-sm text-zinc-600 dark:text-zinc-400">Esta ruta aún no está implementada.</div>
    </AppShell>
  );
}
