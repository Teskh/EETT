import { APP_PAGES, canReadPage, type PageDefinition, type PageKey } from "../lib/pageAccess";
import type { SessionUser } from "../lib/types";

const PATAGUAL_LOGO_URL = `${import.meta.env.BASE_URL}patagual-logo-white.png`;

const PAGE_DESCRIPTIONS: Record<PageKey, string> = {
  projects: "Especificaciones técnicas por proyecto y exportación a PDF.",
  catalog: "Categorías, componentes y reglas de materiales.",
  material_dashboard: "Stock, movimientos y consumo de materiales.",
  cost_model: "Presupuesto frente a gasto real por proyecto.",
  history: "Qué se cambió, quién lo hizo y cuándo.",
  settings: "Copias de seguridad, usuarios y permisos.",
};

type HomePageProps = {
  onNavigate: (to: string) => void;
  currentUser: SessionUser;
};

function greetingForHour(hour: number) {
  if (hour < 12) {
    return "Buenos días";
  }
  if (hour < 20) {
    return "Buenas tardes";
  }
  return "Buenas noches";
}

function PageLink({ page, onNavigate, compact = false }: { page: PageDefinition; onNavigate: (to: string) => void; compact?: boolean }) {
  return (
    <a
      href={page.href}
      onClick={(event) => {
        // Let modified clicks open a new tab like a normal link.
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) {
          return;
        }
        event.preventDefault();
        onNavigate(page.href);
      }}
      className={`group relative flex items-start gap-4 overflow-hidden rounded-2xl border border-black/[0.07] bg-white/80 text-left shadow-sm shadow-zinc-950/[0.03] transition-all duration-200 hover:-translate-y-0.5 hover:border-accent-500/40 hover:shadow-md hover:shadow-accent-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-50 motion-reduce:transition-none motion-reduce:hover:translate-y-0 dark:border-white/[0.08] dark:bg-white/[0.03] dark:hover:border-accent-500/40 dark:hover:bg-white/[0.05] dark:focus-visible:ring-offset-zinc-950 ${
        compact ? "p-4" : "p-5"
      }`}
    >
      <span className="absolute inset-y-0 left-0 w-0.5 origin-center scale-y-0 bg-accent-500 transition-transform duration-200 group-hover:scale-y-100" />
      <span
        className={`flex shrink-0 items-center justify-center rounded-xl bg-zinc-100 text-zinc-600 transition-colors group-hover:bg-accent-500 group-hover:text-zinc-950 dark:bg-white/[0.06] dark:text-zinc-300 ${
          compact ? "h-10 w-10" : "h-11 w-11"
        }`}
      >
        <i className={`ph-bold ${page.icon} ${compact ? "text-lg" : "text-xl"}`} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2">
          <span className="text-[15px] font-semibold text-zinc-900 dark:text-zinc-100">{page.label}</span>
          <i className="ph-bold ph-arrow-right -translate-x-1 text-sm text-zinc-400 opacity-0 transition-all group-hover:translate-x-0 group-hover:text-accent-500 group-hover:opacity-100" />
        </span>
        <span className="mt-1 block text-[13px] leading-snug text-zinc-500 dark:text-zinc-400">{PAGE_DESCRIPTIONS[page.key]}</span>
      </span>
    </a>
  );
}

export function HomePage({ onNavigate, currentUser }: HomePageProps) {
  const availablePages = APP_PAGES.filter((page) => canReadPage(currentUser, page.key));
  const toolPages = availablePages.filter((page) => page.key !== "settings");
  const adminPages = availablePages.filter((page) => page.key === "settings");
  const firstName = currentUser.display_name?.split(" ")[0] ?? "";
  const now = new Date();
  const today = now.toLocaleDateString("es-CL", { weekday: "long", day: "numeric", month: "long" });

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col py-4 lg:py-10">
      <header className="mb-10 flex items-center gap-5">
        <div
          aria-hidden="true"
          className="h-12 w-12 shrink-0 bg-accent-500"
          style={{
            WebkitMask: `url('${PATAGUAL_LOGO_URL}') no-repeat center / contain`,
            mask: `url('${PATAGUAL_LOGO_URL}') no-repeat center / contain`,
          }}
        />
        <div>
          <p className="text-xs font-medium text-zinc-500 first-letter:uppercase">{today}</p>
          <h2 className="mt-0.5 text-2xl font-semibold text-zinc-900 sm:text-3xl dark:text-zinc-50">
            {greetingForHour(now.getHours())}
            {firstName ? `, ${firstName}` : ""}
          </h2>
        </div>
      </header>

      {availablePages.length ? (
        <div className="flex flex-col gap-10">
          {toolPages.length ? (
            <section aria-labelledby="home-tools-heading">
              <h3 id="home-tools-heading" className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-zinc-500">
                Herramientas
              </h3>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {toolPages.map((page) => (
                  <PageLink key={page.key} page={page} onNavigate={onNavigate} />
                ))}
              </div>
            </section>
          ) : null}

          {adminPages.length ? (
            <section aria-labelledby="home-admin-heading">
              <h3 id="home-admin-heading" className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-zinc-500">
                Administración
              </h3>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {adminPages.map((page) => (
                  <PageLink key={page.key} page={page} onNavigate={onNavigate} compact />
                ))}
              </div>
            </section>
          ) : null}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-black/10 px-6 py-10 text-center dark:border-white/10">
          <i className="ph-bold ph-lock-simple text-2xl text-zinc-400" />
          <p className="mt-3 text-sm font-semibold text-zinc-800 dark:text-zinc-200">Tu cuenta aún no tiene páginas asignadas</p>
          <p className="mt-1 text-sm text-zinc-500">Pide a un administrador que te asigne un rol con acceso.</p>
        </div>
      )}
    </div>
  );
}
