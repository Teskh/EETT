import { useEffect, useState } from "react";

import { AppShell } from "./components/AppShell";
import { HomePage } from "./pages/HomePage";
import { CatalogPage } from "./pages/CatalogPage";
import { ProjectDetailPage } from "./pages/ProjectDetailPage";
import { ProjectsPage } from "./pages/ProjectsPage";

type Route =
  | { name: "home" }
  | { name: "catalog"; categoryId: number | null }
  | { name: "projects" }
  | { name: "project-detail"; projectId: number }
  | { name: "not-found" };

function parseCurrentRoute(): Route {
  const { pathname, search } = window.location;
  if (pathname === "/") {
    return { name: "home" };
  }
  if (pathname === "/catalog") {
    const params = new URLSearchParams(search);
    const categoryId = params.get("category_id");
    return { name: "catalog", categoryId: categoryId ? Number(categoryId) : null };
  }
  if (pathname === "/projects") {
    return { name: "projects" };
  }
  const projectMatch = pathname.match(/^\/projects\/(\d+)$/);
  if (projectMatch) {
    return { name: "project-detail", projectId: Number(projectMatch[1]) };
  }
  return { name: "not-found" };
}

export function App() {
  const [route, setRoute] = useState<Route>(() => parseCurrentRoute());

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

  useEffect(() => {
    if (route.name === "home") {
      document.title = "Launcher | Spec Sheets";
    } else if (route.name === "catalog") {
      document.title = "Database Editor | Spec Sheets";
    } else if (route.name === "projects") {
      document.title = "Projects | Spec Sheets";
    } else if (route.name === "project-detail") {
      document.title = "Project | Spec Sheets";
    } else {
      document.title = "Spec Sheets";
    }
  }, [route]);

  if (route.name === "home") {
    return (
      <AppShell title="Launcher" activeNav="home" onNavigate={navigate}>
        <HomePage onNavigate={navigate} />
      </AppShell>
    );
  }

  if (route.name === "projects") {
    return (
      <AppShell title="Projects" activeNav="projects" onNavigate={navigate}>
        <ProjectsPage onNavigate={navigate} />
      </AppShell>
    );
  }

  if (route.name === "catalog") {
    return (
      <AppShell title="Database Editor" activeNav="catalog" onNavigate={navigate}>
        <CatalogPage categoryId={route.categoryId} onNavigate={navigate} />
      </AppShell>
    );
  }

  if (route.name === "project-detail") {
    return (
      <AppShell title={`Project ${route.projectId}`} activeNav="projects" onNavigate={navigate}>
        <ProjectDetailPage projectId={route.projectId} onNavigate={navigate} />
      </AppShell>
    );
  }

  return (
    <AppShell title="Spec Sheets" activeNav="home" onNavigate={navigate}>
      <div className="liquid-glass rounded-2xl p-8 text-sm text-zinc-400">This route is not implemented yet.</div>
    </AppShell>
  );
}
