import { type ReactNode, useEffect, useState } from "react";

import { ApiError, api } from "../lib/api";
import type { SessionUser } from "../lib/types";
import type { CommentNotification } from "../lib/types";
import type { ThemeMode } from "../lib/theme";
import { APP_PAGES, canReadPage } from "../lib/pageAccess";

type NavKey = "home" | "catalog" | "dashboard" | "cost-model" | "history" | "projects" | "settings";

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
      aria-current={active ? "page" : undefined}
      className={
        active
          ? "w-full aspect-square rounded-xl bg-accent-500/10 text-accent-600 dark:text-accent-400 flex items-center justify-center transition-colors group relative"
          : "w-full aspect-square rounded-xl text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-200/70 dark:hover:bg-white/5 flex items-center justify-center transition-colors group relative"
      }
      onClick={(event) => {
        event.preventDefault();
        onNavigate(href);
      }}
    >
      {active ? (
        <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-0.5 rounded-r-full bg-accent-500" />
      ) : null}
      <i className={`ph-bold ${icon} text-xl`} />
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
        Cambiar tema
      </div>
    </button>
  );
}

const PENDING_COMMENT_NOTIFICATION_KEY = "spec-sheets.pendingCommentNotification";

function NotificationButton({ onNavigate }: { onNavigate: (to: string) => void }) {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<CommentNotification[]>([]);
  const [error, setError] = useState<string | null>(null);
  const unreadCount = notifications.filter((notification) => !notification.is_read).length;

  async function loadNotifications() {
    try {
      setNotifications(await api.getNotifications());
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudieron cargar las notificaciones.");
    }
  }

  useEffect(() => {
    void loadNotifications();
    const intervalId = window.setInterval(() => void loadNotifications(), 60000);
    return () => window.clearInterval(intervalId);
  }, []);

  function handleNotificationClick(notification: CommentNotification) {
    window.sessionStorage.setItem(
      PENDING_COMMENT_NOTIFICATION_KEY,
      JSON.stringify({
        notificationId: notification.id,
        projectId: notification.project_id,
        instanceId: notification.instance_id,
        commentId: notification.comment_id,
      }),
    );
    setOpen(false);
    onNavigate(`/projects/${notification.project_id}#comment-${notification.comment_id}`);
    window.dispatchEvent(new Event("spec-sheets:comment-navigation"));
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen((current) => !current);
          void loadNotifications();
        }}
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-lg border border-black/10 dark:border-white/10 bg-zinc-50 dark:bg-white/5 text-zinc-700 dark:text-zinc-200 hover:bg-black/5 dark:hover:bg-white/10"
        aria-label="Notificaciones"
        title="Notificaciones"
      >
        <i className="ph-bold ph-bell" />
        {unreadCount ? (
          <span className="absolute -right-1 -top-1 min-w-4 rounded-full bg-accent-500 px-1 text-[10px] font-bold text-zinc-950">
            {unreadCount}
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="absolute right-0 top-11 z-50 w-80 overflow-hidden rounded-xl border border-black/10 dark:border-white/10 bg-white shadow-xl dark:bg-zinc-900">
          <div className="border-b border-black/10 dark:border-white/10 px-3 py-2 text-xs font-bold uppercase tracking-widest text-zinc-500">
            Notificaciones
          </div>
          {error ? <div className="px-3 py-2 text-xs text-red-700 dark:text-red-300">{error}</div> : null}
          <div className="max-h-96 overflow-y-auto">
            {notifications.length ? (
              notifications.map((notification) => (
                <button
                  key={notification.id}
                  type="button"
                  onClick={() => handleNotificationClick(notification)}
                  className={`block w-full border-b border-black/5 dark:border-white/5 px-3 py-2 text-left last:border-b-0 ${
                    notification.is_read ? "bg-white dark:bg-zinc-900" : "bg-accent-50 dark:bg-accent-500/10"
                  }`}
                >
                  <div className="flex items-center gap-2 text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                    <i className={`ph-bold ${notification.type === "comment_reply" ? "ph-arrow-bend-up-left" : "ph-at"}`} />
                    <span>{notification.type === "comment_reply" ? "Respuesta" : "Mención"}</span>
                  </div>
                  <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                    {notification.project_name || `Proyecto ${notification.project_id}`}
                    {notification.instance_name ? ` · ${notification.instance_name}` : ""}
                  </div>
                  {notification.body ? <div className="mt-1 line-clamp-2 text-xs text-zinc-500">{notification.body}</div> : null}
                </button>
              ))
            ) : (
              <div className="px-3 py-4 text-sm text-zinc-500">No hay notificaciones.</div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function AppShell({ title, activeNav, currentUser, themeMode, onThemeModeChange, onNavigate, onLogout, children }: AppShellProps) {
  const roleLabels = currentUser.roles.map((role) => role.toUpperCase()).join(" · ");

  return (
    <div className="min-h-[100dvh] font-sans selection:bg-accent-500/30 selection:text-accent-700 dark:text-accent-400 overflow-x-hidden relative bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-200">
      <div className="ambient-glow" />
      <div className="flex h-screen overflow-hidden relative z-10">
        <nav className="w-16 border-r border-zinc-200 dark:border-white/10 bg-zinc-50/80 dark:bg-zinc-950/80 backdrop-blur-md flex flex-col items-center py-6 shrink-0 z-50">
          <button
            type="button"
            onClick={() => onNavigate("/")}
            className="mb-8 flex h-9 w-9 items-center justify-center transition-transform active:scale-95 hover:opacity-80"
            aria-label="Abrir lanzador"
          >
            <div 
              className="h-full w-full bg-accent-500" 
              style={{ 
                WebkitMask: "url('/patagual-logo-white.png') no-repeat center / contain",
                mask: "url('/patagual-logo-white.png') no-repeat center / contain" 
              }} 
            />
          </button>
          <div className="flex flex-col gap-4 w-full px-2">
            {APP_PAGES.filter((page) => page.key !== "settings" && canReadPage(currentUser, page.key)).map((page) => (
              <NavButton key={page.key} href={page.href} icon={page.icon} label={page.label} active={activeNav === page.navKey} onNavigate={onNavigate} />
            ))}
          </div>
          <div className="mt-auto w-full px-2 space-y-4">
            {canReadPage(currentUser, "settings") ? (
              <NavButton href="/settings" icon="ph-sliders-horizontal" label="Configuracion" active={activeNav === "settings"} onNavigate={onNavigate} />
            ) : null}
            <ThemePicker themeMode={themeMode} onThemeModeChange={onThemeModeChange} />
          </div>
        </nav>
        <main className="flex-1 flex flex-col h-full relative">
          <header className="h-16 border-b border-zinc-200 dark:border-white/5 bg-zinc-50/50 dark:bg-zinc-950/50 backdrop-blur-xl flex items-center justify-between px-6 shrink-0 z-40">
            <div className="flex items-center gap-4">
              <div className="font-mono text-xs text-zinc-500 tracking-widest uppercase">EETT</div>
              <div className="h-4 w-px bg-zinc-300 dark:bg-white/10" />
              <h1 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                {title}
                <span className="w-2 h-2 rounded-full bg-accent-500 animate-pulse" />
              </h1>
            </div>
            <div className="flex items-center gap-3">
              <NotificationButton onNavigate={onNavigate} />
              <div className="text-right">
                <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{currentUser.display_name}</div>
                <div className="text-[10px] font-mono uppercase tracking-widest text-zinc-500">{roleLabels}</div>
              </div>
              <button
                type="button"
                onClick={() => void onLogout()}
                className="px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-zinc-50 dark:bg-white/5 text-xs font-semibold text-zinc-900 dark:text-zinc-100 hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
              >
                Cerrar sesión
              </button>
            </div>
          </header>
          <div className="flex-1 overflow-y-auto overflow-x-hidden p-6 lg:p-10">{children}</div>
        </main>
      </div>
    </div>
  );
}
