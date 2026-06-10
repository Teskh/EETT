import { APP_PAGES, canReadPage } from "../lib/pageAccess";
import type { SessionUser } from "../lib/types";

type HomePageProps = {
  onNavigate: (to: string) => void;
  currentUser: SessionUser;
};

export function HomePage({ onNavigate, currentUser }: HomePageProps) {
  const availablePages = APP_PAGES.filter((page) => canReadPage(currentUser, page.key));
  const firstName = currentUser.display_name?.split(" ")[0] ?? "";

  return (
    <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col items-center justify-center py-12">
      <div className="mb-12 flex flex-col items-center text-center">
        <div className="mb-6 flex h-16 w-16 items-center justify-center">
          <div 
            className="h-12 w-12 bg-accent-500" 
            style={{ 
              WebkitMask: "url('/patagual-logo-white.png') no-repeat center / contain",
              mask: "url('/patagual-logo-white.png') no-repeat center / contain" 
            }} 
          />
        </div>
      </div>

      {availablePages.length ? (
        <div className="grid w-full grid-cols-2 gap-4 sm:grid-cols-3">
          {availablePages.map((page) => (
            <button
              key={page.key}
              type="button"
              onClick={() => onNavigate(page.href)}
              className="group flex flex-col items-center justify-center gap-4 rounded-2xl p-6 text-center transition-all hover:bg-zinc-100 dark:hover:bg-white/5"
            >
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-zinc-50 text-zinc-500 shadow-sm transition-all group-hover:scale-110 group-hover:bg-accent-500 group-hover:text-zinc-950 group-hover:shadow-md dark:bg-white/5 dark:text-zinc-400 dark:group-hover:bg-accent-500 dark:group-hover:text-zinc-950">
                <i className={`ph-bold ${page.icon} text-2xl`} />
              </span>
              <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300 group-hover:text-zinc-900 dark:group-hover:text-white">
                {page.label}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-black/10 bg-white/70 px-6 py-8 text-center text-sm text-zinc-600 dark:border-white/10 dark:bg-white/5 dark:text-zinc-400">
          No tienes páginas disponibles.
        </div>
      )}
    </div>
  );
}
