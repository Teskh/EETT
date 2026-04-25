import { type ReactNode } from "react";

import type { SessionUser } from "../lib/types";
import type { ThemeMode } from "../lib/theme";

type NavKey = "home" | "catalog" | "dashboard" | "cost-model" | "history" | "projects" | "users";

type AppShellProps = {
  title: string;
  activeNav: NavKey;
  currentUser: SessionUser;
  themeMode: ThemeMode;
  onThemeModeChange: (mode: ThemeMode) => void;
  onNavigate: (to: string) => void;
  onLogout: () => Promise<void>;
  children: ReactNode;
};

function NavButton({
  href,
  icon,
  label,
  active,
  onNavigate,
}: {
  href: string;
  icon: string;
  label: string;
  active: boolean;
  onNavigate: (to: string) => void;
}) {
  return (
    <a
      href={href}
      className={
        active
          ? "w-full aspect-square rounded-xl bg-zinc-200 dark:bg-white/10 text-zinc-900 dark:text-white flex items-center justify-center border border-zinc-300 dark:border-white/10 transition-transform active:scale-95 group relative"
          : "w-full aspect-square rounded-xl text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-900 dark:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-50 dark:hover:bg-white/5 flex items-center justify-center transition-all group relative"
      }
      onClick={(event) => {
        event.preventDefault();
        onNavigate(href);
      }}
    >
      <i className={`${active ? "ph-fill" : "ph-bold"} ${icon} text-xl`} />
      <div className="absolute left-full ml-4 px-2 py-1 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-200 text-xs rounded border border-zinc-200 dark:border-white/10 opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap z-50">
        {label}
      </div>
    </a>
  );
}

function ThemePicker({ themeMode, onThemeModeChange }: { themeMode: ThemeMode; onThemeModeChange: (mode: ThemeMode) => void }) {
  const isDark = themeMode === "dark";

  return (
    <button
      type="button"
      onClick={() => onThemeModeChange(isDark ? "light" : "dark")}
      className="w-full aspect-square rounded-xl text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-900 dark:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-50 dark:hover:bg-white/5 flex items-center justify-center transition-all group relative"
    >
      <i className={`ph-bold ${isDark ? "ph-sun" : "ph-moon"} text-xl`} />
      <div className="absolute left-full ml-4 px-2 py-1 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-200 text-xs rounded border border-zinc-200 dark:border-white/10 opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap z-50">
        Toggle Theme
      </div>
    </button>
  );
}

export function AppShell({ title, activeNav, currentUser, themeMode, onThemeModeChange, onNavigate, onLogout, children }: AppShellProps) {
  const roleLabels = currentUser.roles.map((role) => role.toUpperCase()).join(" · ");

  return (
    <div className="min-h-[100dvh] font-sans selection:bg-accent-500/30 selection:text-accent-700 dark:text-accent-400 overflow-x-hidden relative bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-200">
      <div className="ambient-glow" />
      <div className="flex h-screen overflow-hidden relative z-10">
        <nav className="w-16 border-r border-zinc-200 dark:border-white/10 bg-zinc-50/80 dark:bg-zinc-950/80 backdrop-blur-md flex flex-col items-center py-6 shrink-0 z-50">
          <div className="w-8 h-8 rounded-lg bg-accent-500 flex items-center justify-center text-zinc-950 font-bold mb-8">
            <i className="ph-bold ph-lock-key text-xl" />
          </div>
          <div className="flex flex-col gap-4 w-full px-2">
            <NavButton href="/" icon="ph-rocket" label="Launcher" active={activeNav === "home"} onNavigate={onNavigate} />
            {currentUser.permissions.catalog_edit ? (
              <NavButton href="/catalog" icon="ph-database" label="Database Editor" active={activeNav === "catalog"} onNavigate={onNavigate} />
            ) : null}
            {currentUser.permissions.material_dashboard ? (
              <NavButton href="/dashboard/materials" icon="ph-chart-line-up" label="Material Dashboard" active={activeNav === "dashboard"} onNavigate={onNavigate} />
            ) : null}
            <NavButton href="/cost-model" icon="ph-chart-pie-slice" label="Cost Model" active={activeNav === "cost-model"} onNavigate={onNavigate} />
            <NavButton href="/history" icon="ph-clock-counter-clockwise" label="Change History" active={activeNav === "history"} onNavigate={onNavigate} />
            <NavButton href="/projects" icon="ph-kanban" label="Projects" active={activeNav === "projects"} onNavigate={onNavigate} />
            {currentUser.permissions.user_admin ? (
              <NavButton href="/users" icon="ph-users-three" label="User Editor" active={activeNav === "users"} onNavigate={onNavigate} />
            ) : null}
          </div>
          <div className="mt-auto w-full px-2 space-y-4">
            <ThemePicker themeMode={themeMode} onThemeModeChange={onThemeModeChange} />
          </div>
        </nav>
        <main className="flex-1 flex flex-col h-full relative">
          <header className="h-16 border-b border-zinc-200 dark:border-white/5 bg-zinc-50/50 dark:bg-zinc-950/50 backdrop-blur-xl flex items-center justify-between px-6 shrink-0 z-40">
            <div className="flex items-center gap-4">
              <div className="font-mono text-xs text-zinc-500 tracking-widest uppercase">Spec Sheets</div>
              <div className="h-4 w-px bg-zinc-300 dark:bg-white/10" />
              <h1 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                {title}
                <span className="w-2 h-2 rounded-full bg-accent-500 animate-pulse" />
              </h1>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-right">
                <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{currentUser.display_name}</div>
                <div className="text-[10px] font-mono uppercase tracking-widest text-zinc-500">{roleLabels}</div>
              </div>
              <button
                type="button"
                onClick={() => void onLogout()}
                className="px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-zinc-50 dark:bg-white/5 text-xs font-semibold text-zinc-900 dark:text-zinc-100 hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
              >
                Log Out
              </button>
            </div>
          </header>
          <div className="flex-1 overflow-y-auto overflow-x-hidden p-6 lg:p-10">{children}</div>
        </main>
      </div>
    </div>
  );
}
