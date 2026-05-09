import { APP_PAGES, canReadPage } from "../lib/pageAccess";
import type { SessionUser } from "../lib/types";

type HomePageProps = {
  onNavigate: (to: string) => void;
  currentUser: SessionUser;
};

export function HomePage({ onNavigate, currentUser }: HomePageProps) {
  const availablePages = APP_PAGES.filter((page) => canReadPage(currentUser, page.key));

  return (
    <div className="mx-auto flex min-h-full max-w-5xl items-center justify-center">
      <section className="w-full">
        <div className="mb-8 flex items-center justify-center">
          <img src="/patagual-logo-white.png" alt="Patagual Home" className="h-14 w-14 object-contain" />
        </div>
        {availablePages.length ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            {availablePages.map((page) => (
              <button
                key={page.key}
                type="button"
                onClick={() => onNavigate(page.href)}
                className="group flex aspect-square flex-col items-center justify-center gap-3 rounded-xl border border-black/10 bg-white/70 p-4 text-center text-zinc-700 transition-all hover:-translate-y-0.5 hover:border-accent-500/50 hover:text-zinc-950 dark:border-white/10 dark:bg-white/5 dark:text-zinc-300 dark:hover:text-white"
              >
                <i className={`ph-bold ${page.icon} text-3xl text-zinc-500 transition-colors group-hover:text-accent-600 dark:text-zinc-400 dark:group-hover:text-accent-400`} />
                <span className="text-xs font-semibold leading-tight">{page.label}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-black/10 bg-white/70 p-6 text-center text-sm text-zinc-600 dark:border-white/10 dark:bg-white/5 dark:text-zinc-400">
            No tienes páginas disponibles.
          </div>
        )}
      </section>
    </div>
  );
}
