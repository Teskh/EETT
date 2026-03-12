import type { SessionUser } from "../lib/types";

type HomePageProps = {
  onNavigate: (to: string) => void;
  currentUser: SessionUser;
};

export function HomePage({ onNavigate, currentUser }: HomePageProps) {
  return (
    <div className="max-w-[1600px] mx-auto flex flex-col gap-6">
      <section className={`grid grid-cols-1 ${currentUser.permissions.user_admin ? "md:grid-cols-3" : "md:grid-cols-2"} gap-6`}>
        <article className="liquid-glass rounded-2xl p-8 border border-black/10 dark:border-white/10 relative overflow-hidden group">
          
          <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2 relative z-10">Central Catalog</p>
          <h2 className="text-3xl font-bold text-zinc-900 dark:text-white tracking-tight mb-3 relative z-10">Database editor views</h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed mb-6 relative z-10">
            Browse nested categories, inspect reusable item and accessory templates, review attribute definitions, and
            manage linked accessory categories without the legacy text-field hacks.
          </p>
          <button
            disabled={!currentUser.permissions.catalog_edit}
            className="px-4 py-2.5 bg-zinc-50 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-zinc-100 dark:hover:bg-white/10 border border-black/10 dark:border-white/10 rounded-lg text-sm font-semibold text-zinc-900 dark:text-white transition-all flex items-center gap-2 relative z-10" 
            onClick={() => onNavigate("/catalog")}
          >
            <i className="ph-bold ph-database" /> {currentUser.permissions.catalog_edit ? "Open database editor" : "Catalog access required"}
          </button>
        </article>
        <article className="liquid-glass rounded-2xl p-8 border border-black/10 dark:border-white/10 relative overflow-hidden group">
          
          <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2 relative z-10">Projects</p>
          <h2 className="text-3xl font-bold text-zinc-900 dark:text-white tracking-tight mb-3 relative z-10">Project viewing workspace</h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed mb-6 relative z-10">
            Open grouped projects, inspect subtype trees, and browse project instances by category with material
            applicability and BOM state preserved.
          </p>
          <button 
            className="px-4 py-2.5 bg-zinc-50 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-zinc-100 dark:hover:bg-white/10 border border-black/10 dark:border-white/10 rounded-lg text-sm font-semibold text-zinc-900 dark:text-white transition-all flex items-center gap-2 relative z-10" 
            onClick={() => onNavigate("/projects")}
          >
            <i className="ph-bold ph-kanban" /> Open projects
          </button>
        </article>
        {currentUser.permissions.user_admin ? (
          <article className="liquid-glass rounded-2xl p-8 border border-black/10 dark:border-white/10 relative overflow-hidden group">
            <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2 relative z-10">User Access</p>
            <h2 className="text-3xl font-bold text-zinc-900 dark:text-white tracking-tight mb-3 relative z-10">Internal user editor</h2>
            <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed mb-6 relative z-10">
              Create, update, and retire internal accounts. This page stays restricted to the reserved sysadmin access path.
            </p>
            <button
              className="px-4 py-2.5 bg-zinc-50 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-zinc-100 dark:hover:bg-white/10 border border-black/10 dark:border-white/10 rounded-lg text-sm font-semibold text-zinc-900 dark:text-white transition-all flex items-center gap-2 relative z-10"
              onClick={() => onNavigate("/users")}
            >
              <i className="ph-bold ph-users-three" /> Open user editor
            </button>
          </article>
        ) : null}
      </section>
      <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <article className="liquid-glass rounded-2xl p-6 border border-black/10 dark:border-white/10">
          <h3 className="text-lg font-bold text-zinc-900 dark:text-white mb-4">What is implemented</h3>
          <ul className="space-y-2 text-sm text-zinc-600 dark:text-zinc-400">
            <li className="flex gap-2"><i className="ph-bold ph-check text-accent-600 dark:text-accent-500 shrink-0 mt-0.5" /> Single normalized schema for categories, components, materials, projects, instances, links, and BOM entries.</li>
            <li className="flex gap-2"><i className="ph-bold ph-check text-accent-600 dark:text-accent-500 shrink-0 mt-0.5" /> Seeded demo dataset that demonstrates linked accessories, subtype BOM rows, and blank-versus-zero quantity behavior.</li>
            <li className="flex gap-2"><i className="ph-bold ph-check text-accent-600 dark:text-accent-500 shrink-0 mt-0.5" /> Typed JSON endpoints that now back the React frontend directly.</li>
          </ul>
        </article>
        <article className="liquid-glass rounded-2xl p-6 border border-black/10 dark:border-white/10">
          <h3 className="text-lg font-bold text-zinc-900 dark:text-white mb-4">Current scope</h3>
          <ul className="space-y-2 text-sm text-zinc-600 dark:text-zinc-400">
            <li className="flex gap-2"><i className="ph-bold ph-arrow-right text-zinc-500 shrink-0 mt-0.5" /> Catalog view with create and edit actions for categories, components, attributes, and linked-category rules.</li>
            <li className="flex gap-2"><i className="ph-bold ph-arrow-right text-zinc-500 shrink-0 mt-0.5" /> Project board with create action and project detail browsing plus project instance create/edit/delete flows.</li>
            <li className="flex gap-2"><i className="ph-bold ph-arrow-right text-zinc-500 shrink-0 mt-0.5" /> Exports, comments, auth UX, dashboard, and ERP tools still exist primarily at the API/domain layer and remain to be surfaced.</li>
          </ul>
        </article>
      </section>
    </div>
  );
}
