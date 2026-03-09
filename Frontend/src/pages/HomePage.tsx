type HomePageProps = {
  onNavigate: (to: string) => void;
};

export function HomePage({ onNavigate }: HomePageProps) {
  return (
    <div className="max-w-[1600px] mx-auto flex flex-col gap-6">
      <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <article className="liquid-glass rounded-2xl p-8 border border-white/10 relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-32 h-32 bg-accent-500/10 blur-3xl rounded-full group-hover:bg-accent-500/20 transition-colors" />
          <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2 relative z-10">Central Catalog</p>
          <h2 className="text-3xl font-bold text-white tracking-tight mb-3 relative z-10">Database editor views</h2>
          <p className="text-sm text-zinc-400 leading-relaxed mb-6 relative z-10">
            Browse nested categories, inspect reusable item and accessory templates, review attribute definitions, and
            manage linked accessory categories without the legacy text-field hacks.
          </p>
          <button 
            className="px-4 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-sm font-semibold text-white transition-all flex items-center gap-2 relative z-10" 
            onClick={() => onNavigate("/catalog")}
          >
            <i className="ph-bold ph-database" /> Open database editor
          </button>
        </article>
        <article className="liquid-glass rounded-2xl p-8 border border-white/10 relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-32 h-32 bg-accent-500/10 blur-3xl rounded-full group-hover:bg-accent-500/20 transition-colors" />
          <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2 relative z-10">Projects</p>
          <h2 className="text-3xl font-bold text-white tracking-tight mb-3 relative z-10">Project viewing workspace</h2>
          <p className="text-sm text-zinc-400 leading-relaxed mb-6 relative z-10">
            Open grouped projects, inspect subtype trees, and browse project instances by category with material
            applicability and BOM state preserved.
          </p>
          <button 
            className="px-4 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-sm font-semibold text-white transition-all flex items-center gap-2 relative z-10" 
            onClick={() => onNavigate("/projects")}
          >
            <i className="ph-bold ph-kanban" /> Open projects
          </button>
        </article>
      </section>
      <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <article className="liquid-glass rounded-2xl p-6">
          <h3 className="text-lg font-bold text-white mb-4">What is implemented</h3>
          <ul className="space-y-2 text-sm text-zinc-400">
            <li className="flex gap-2"><i className="ph-bold ph-check text-accent-500 shrink-0 mt-0.5" /> Single normalized schema for categories, components, materials, projects, instances, links, and BOM entries.</li>
            <li className="flex gap-2"><i className="ph-bold ph-check text-accent-500 shrink-0 mt-0.5" /> Seeded demo dataset that demonstrates linked accessories, subtype BOM rows, and blank-versus-zero quantity behavior.</li>
            <li className="flex gap-2"><i className="ph-bold ph-check text-accent-500 shrink-0 mt-0.5" /> Typed JSON endpoints that now back the React frontend directly.</li>
          </ul>
        </article>
        <article className="liquid-glass rounded-2xl p-6">
          <h3 className="text-lg font-bold text-white mb-4">Current scope</h3>
          <ul className="space-y-2 text-sm text-zinc-400">
            <li className="flex gap-2"><i className="ph-bold ph-arrow-right text-zinc-500 shrink-0 mt-0.5" /> Catalog view with create and edit actions for categories, components, attributes, and linked-category rules.</li>
            <li className="flex gap-2"><i className="ph-bold ph-arrow-right text-zinc-500 shrink-0 mt-0.5" /> Project board with create action and project detail browsing plus project instance create/edit/delete flows.</li>
            <li className="flex gap-2"><i className="ph-bold ph-arrow-right text-zinc-500 shrink-0 mt-0.5" /> Exports, comments, auth UX, dashboard, and ERP tools still exist primarily at the API/domain layer and remain to be surfaced.</li>
          </ul>
        </article>
      </section>
    </div>
  );
}
