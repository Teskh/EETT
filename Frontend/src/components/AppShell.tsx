import { type ReactNode } from "react";

type NavKey = "home" | "catalog" | "projects";

type AppShellProps = {
  title: string;
  activeNav: NavKey;
  onNavigate: (to: string) => void;
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
          ? "w-full aspect-square rounded-xl bg-white/10 text-white flex items-center justify-center border border-white/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] transition-transform active:scale-95 group relative"
          : "w-full aspect-square rounded-xl text-zinc-500 hover:text-zinc-200 hover:bg-white/5 flex items-center justify-center transition-all group relative"
      }
      onClick={(event) => {
        event.preventDefault();
        onNavigate(href);
      }}
    >
      <i className={`${active ? "ph-fill" : "ph-bold"} ${icon} text-xl`} />
      <div className="absolute left-full ml-4 px-2 py-1 bg-zinc-800 text-xs rounded border border-white/10 opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap z-50">
        {label}
      </div>
    </a>
  );
}

export function AppShell({ title, activeNav, onNavigate, children }: AppShellProps) {
  return (
    <div className="min-h-[100dvh] font-sans selection:bg-accent-500/30 selection:text-accent-400 overflow-x-hidden relative bg-zinc-950 text-zinc-200">
      <div className="ambient-glow" />
      <div className="flex h-screen overflow-hidden relative z-10">
        <nav className="w-16 border-r border-white/10 bg-zinc-950/80 backdrop-blur-md flex flex-col items-center py-6 shrink-0 z-50">
          <div className="w-8 h-8 rounded-lg bg-accent-500 flex items-center justify-center text-zinc-950 font-bold mb-8 shadow-[0_0_15px_rgba(245,158,11,0.4)]">
            <i className="ph-bold ph-database text-xl" />
          </div>
          <div className="flex flex-col gap-4 w-full px-2">
            <NavButton href="/" icon="ph-rocket" label="Launcher" active={activeNav === "home"} onNavigate={onNavigate} />
            <NavButton href="/catalog" icon="ph-database" label="Database Editor" active={activeNav === "catalog"} onNavigate={onNavigate} />
            <NavButton href="/projects" icon="ph-kanban" label="Projects" active={activeNav === "projects"} onNavigate={onNavigate} />
          </div>
        </nav>
        <main className="flex-1 flex flex-col h-full relative">
          <header className="h-16 border-b border-white/5 bg-zinc-950/50 backdrop-blur-xl flex items-center justify-between px-6 shrink-0 z-40">
            <div className="flex items-center gap-4">
              <div className="font-mono text-xs text-zinc-500 tracking-widest uppercase">Spec Sheets</div>
              <div className="h-4 w-px bg-white/10" />
              <h1 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
                {title}
                <span className="w-2 h-2 rounded-full bg-accent-500 shadow-[0_0_8px_rgba(245,158,11,0.6)] animate-pulse" />
              </h1>
            </div>
          </header>
          <div className="flex-1 overflow-y-auto overflow-x-hidden p-6 lg:p-10">{children}</div>
        </main>
      </div>
    </div>
  );
}
