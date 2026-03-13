import { useEffect, useState } from "react";

import { AppShell } from "./components/AppShell";
import { ApiError, api } from "./lib/api";
import type { SessionUser } from "./lib/types";
import { CatalogPage } from "./pages/CatalogPage";
import { ChangeHistoryPage } from "./pages/ChangeHistoryPage";
import { HomePage } from "./pages/HomePage";
import { LoginPage } from "./pages/LoginPage";
import { MaterialDashboardPage } from "./pages/MaterialDashboardPage";
import { ProjectDetailPage } from "./pages/ProjectDetailPage";
import { ProjectsPage } from "./pages/ProjectsPage";
import { UsersPage } from "./pages/UsersPage";

type Route =
  | { name: "home" }
  | { name: "login" }
  | { name: "catalog"; categoryId: number | null }
  | { name: "material-dashboard" }
  | { name: "history" }
  | { name: "projects" }
  | { name: "project-detail"; projectId: number }
  | { name: "users" }
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
  if (pathname === "/history") {
    return { name: "history" };
  }
  if (pathname === "/projects") {
    return { name: "projects" };
  }
  if (pathname === "/users") {
    return { name: "users" };
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

  async function loadSession() {
    setSessionLoading(true);
    try {
      setSession(await api.getSession());
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setSession(null);
      } else {
        setAuthError(err instanceof ApiError ? err.message : "Could not load session.");
      }
    } finally {
      setSessionLoading(false);
    }
  }

  useEffect(() => {
    void loadSession();
  }, []);

  useEffect(() => {
    if (route.name === "home") {
      document.title = "Launcher | Spec Sheets";
    } else if (route.name === "login") {
      document.title = "Login | Spec Sheets";
    } else if (route.name === "catalog") {
      document.title = "Database Editor | Spec Sheets";
    } else if (route.name === "material-dashboard") {
      document.title = "Material Dashboard | Spec Sheets";
    } else if (route.name === "history") {
      document.title = "Change History | Spec Sheets";
    } else if (route.name === "projects") {
      document.title = "Projects | Spec Sheets";
    } else if (route.name === "project-detail") {
      document.title = "Project | Spec Sheets";
    } else if (route.name === "users") {
      document.title = "User Editor | Spec Sheets";
    } else {
      document.title = "Spec Sheets";
    }
  }, [route]);

  useEffect(() => {
    if (session && route.name === "login") {
      navigate("/", true);
    }
  }, [route, session]);

  async function handleLogin(username: string, password: string) {
    setAuthLoading(true);
    setAuthError(null);
    try {
      const user = await api.login({ username, password });
      setSession(user);
      const nextPath = route.name === "login" ? "/" : currentPath();
      navigate(nextPath === "/login" ? "/" : nextPath, true);
    } catch (err) {
      setAuthError(err instanceof ApiError ? err.message : "Could not sign in.");
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
      setAuthError(err instanceof ApiError ? err.message : "Could not sign out.");
    } finally {
      setAuthLoading(false);
    }
  }

  if (sessionLoading) {
    return <div className="min-h-[100dvh] bg-zinc-50 dark:bg-zinc-950 text-zinc-500 flex items-center justify-center">Loading session...</div>;
  }

  if (!session) {
    return <LoginPage onLogin={handleLogin} loading={authLoading} error={authError} />;
  }

  if (route.name === "login") {
    return null;
  }

  if (route.name === "home") {
    return (
      <AppShell title="Launcher" activeNav="home" currentUser={session} onNavigate={navigate} onLogout={handleLogout}>
        <HomePage onNavigate={navigate} currentUser={session} />
      </AppShell>
    );
  }

  if (route.name === "projects") {
    return (
      <AppShell title="Projects" activeNav="projects" currentUser={session} onNavigate={navigate} onLogout={handleLogout}>
        <ProjectsPage onNavigate={navigate} currentUser={session} />
      </AppShell>
    );
  }

  if (route.name === "material-dashboard") {
    return (
      <AppShell title="Material Dashboard" activeNav="dashboard" currentUser={session} onNavigate={navigate} onLogout={handleLogout}>
        {session.permissions.material_dashboard ? (
          <MaterialDashboardPage />
        ) : (
          <AccessDenied message="This role cannot open the material dashboard." />
        )}
      </AppShell>
    );
  }

  if (route.name === "history") {
    return (
      <AppShell title="Change History" activeNav="history" currentUser={session} onNavigate={navigate} onLogout={handleLogout}>
        <ChangeHistoryPage />
      </AppShell>
    );
  }

  if (route.name === "catalog") {
    return (
      <AppShell title="Database Editor" activeNav="catalog" currentUser={session} onNavigate={navigate} onLogout={handleLogout}>
        {session.permissions.catalog_edit ? (
          <CatalogPage categoryId={route.categoryId} onNavigate={navigate} />
        ) : (
          <AccessDenied message="This role cannot open the catalog editor." />
        )}
      </AppShell>
    );
  }

  if (route.name === "project-detail") {
    return (
      <AppShell title={`Project ${route.projectId}`} activeNav="projects" currentUser={session} onNavigate={navigate} onLogout={handleLogout}>
        <ProjectDetailPage projectId={route.projectId} onNavigate={navigate} />
      </AppShell>
    );
  }

  if (route.name === "users") {
    return (
      <AppShell title="User Editor" activeNav="users" currentUser={session} onNavigate={navigate} onLogout={handleLogout}>
        {session.permissions.user_admin ? (
          <UsersPage currentUsername={session.username} />
        ) : (
          <AccessDenied message="Only the reserved sysadmin account can access the user editor." />
        )}
      </AppShell>
    );
  }

  return (
    <AppShell title="Spec Sheets" activeNav="home" currentUser={session} onNavigate={navigate} onLogout={handleLogout}>
      <div className="liquid-glass rounded-2xl p-8 text-sm text-zinc-600 dark:text-zinc-400">This route is not implemented yet.</div>
    </AppShell>
  );
}
