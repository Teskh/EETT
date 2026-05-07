import type { SessionUser } from "../lib/types";

type HomePageProps = {
  onNavigate: (to: string) => void;
  currentUser: SessionUser;
};

export function HomePage({ onNavigate, currentUser }: HomePageProps) {
  const featureCount = [currentUser.permissions.material_dashboard, currentUser.permissions.user_admin].filter(Boolean).length + 3;
  const columnClass = featureCount >= 5 ? "md:grid-cols-5" : featureCount === 4 ? "md:grid-cols-4" : "md:grid-cols-3";

  return (
    <div className="max-w-[1600px] mx-auto flex flex-col gap-6">
      <section className={`grid grid-cols-1 ${columnClass} gap-6`}>
        <article className="liquid-glass rounded-2xl p-8 border border-black/10 dark:border-white/10 relative overflow-hidden group">
          
          <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2 relative z-10">Catálogo Central</p>
          <h2 className="text-3xl font-bold text-zinc-900 dark:text-white tracking-tight mb-3 relative z-10">Vistas del editor de base de datos</h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed mb-6 relative z-10">
            Navega por categorías anidadas, revisa plantillas reutilizables de ítems y accesorios, consulta definiciones de atributos y
            administra categorías de accesorios vinculadas sin los antiguos campos de texto.
          </p>
          <button
            disabled={!currentUser.permissions.catalog_edit}
            className="px-4 py-2.5 bg-zinc-50 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-zinc-100 dark:hover:bg-white/10 border border-black/10 dark:border-white/10 rounded-lg text-sm font-semibold text-zinc-900 dark:text-white transition-all flex items-center gap-2 relative z-10" 
            onClick={() => onNavigate("/catalog")}
          >
            <i className="ph-bold ph-database" /> {currentUser.permissions.catalog_edit ? "Abrir editor de base de datos" : "Se requiere acceso al catálogo"}
          </button>
        </article>
        {currentUser.permissions.material_dashboard ? (
          <article className="liquid-glass rounded-2xl p-8 border border-black/10 dark:border-white/10 relative overflow-hidden group">
            <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2 relative z-10">Operaciones</p>
            <h2 className="text-3xl font-bold text-zinc-900 dark:text-white tracking-tight mb-3 relative z-10">Panel de materiales</h2>
            <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed mb-6 relative z-10">
              Revisa materiales activos en ERP, filtra por CECO y fija un gráfico de movimientos de 90 días sin partir desde un proyecto.
            </p>
            <button
              className="px-4 py-2.5 bg-zinc-50 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-zinc-100 dark:hover:bg-white/10 border border-black/10 dark:border-white/10 rounded-lg text-sm font-semibold text-zinc-900 dark:text-white transition-all flex items-center gap-2 relative z-10"
              onClick={() => onNavigate("/dashboard/materials")}
            >
              <i className="ph-bold ph-chart-line-up" /> Abrir panel de materiales
            </button>
          </article>
        ) : null}
        <article className="liquid-glass rounded-2xl p-8 border border-black/10 dark:border-white/10 relative overflow-hidden group">
          
          <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2 relative z-10">Proyectos</p>
          <h2 className="text-3xl font-bold text-zinc-900 dark:text-white tracking-tight mb-3 relative z-10">Espacio de revisión de proyectos</h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed mb-6 relative z-10">
            Abre proyectos agrupados, inspecciona árboles de subtipos y navega instancias por categoría manteniendo la
            aplicabilidad de materiales y el estado de la BOM.
          </p>
          <button 
            className="px-4 py-2.5 bg-zinc-50 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-zinc-100 dark:hover:bg-white/10 border border-black/10 dark:border-white/10 rounded-lg text-sm font-semibold text-zinc-900 dark:text-white transition-all flex items-center gap-2 relative z-10" 
            onClick={() => onNavigate("/projects")}
          >
            <i className="ph-bold ph-kanban" /> Abrir proyectos
          </button>
        </article>
        <article className="liquid-glass rounded-2xl p-8 border border-black/10 dark:border-white/10 relative overflow-hidden group">
          <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2 relative z-10">Gobernanza</p>
          <h2 className="text-3xl font-bold text-zinc-900 dark:text-white tracking-tight mb-3 relative z-10">Historial de cambios</h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed mb-6 relative z-10">
            Revisa cambios agrupados entre proyectos, filtra por estado del flujo y oculta ediciones ruidosas de cantidades de material cuando necesites una auditoría más limpia.
          </p>
          <button
            className="px-4 py-2.5 bg-zinc-50 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-zinc-100 dark:hover:bg-white/10 border border-black/10 dark:border-white/10 rounded-lg text-sm font-semibold text-zinc-900 dark:text-white transition-all flex items-center gap-2 relative z-10"
            onClick={() => onNavigate("/history")}
          >
            <i className="ph-bold ph-clock-counter-clockwise" /> Abrir historial de cambios
          </button>
        </article>
        {currentUser.permissions.user_admin ? (
          <article className="liquid-glass rounded-2xl p-8 border border-black/10 dark:border-white/10 relative overflow-hidden group">
            <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2 relative z-10">Administracion</p>
            <h2 className="text-3xl font-bold text-zinc-900 dark:text-white tracking-tight mb-3 relative z-10">Configuracion</h2>
            <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed mb-6 relative z-10">
              Administra copias de seguridad programadas y cuentas internas desde una ruta reservada para sysadmin.
            </p>
            <button
              className="px-4 py-2.5 bg-zinc-50 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-zinc-100 dark:hover:bg-white/10 border border-black/10 dark:border-white/10 rounded-lg text-sm font-semibold text-zinc-900 dark:text-white transition-all flex items-center gap-2 relative z-10"
              onClick={() => onNavigate("/settings")}
            >
              <i className="ph-bold ph-gear-six" /> Abrir configuracion
            </button>
          </article>
        ) : null}
      </section>
      <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <article className="liquid-glass rounded-2xl p-6 border border-black/10 dark:border-white/10">
          <h3 className="text-lg font-bold text-zinc-900 dark:text-white mb-4">Qué está implementado</h3>
          <ul className="space-y-2 text-sm text-zinc-600 dark:text-zinc-400">
            <li className="flex gap-2"><i className="ph-bold ph-check text-accent-600 dark:text-accent-500 shrink-0 mt-0.5" /> Esquema normalizado único para categorías, componentes, materiales, proyectos, instancias, vínculos y entradas de BOM.</li>
            <li className="flex gap-2"><i className="ph-bold ph-check text-accent-600 dark:text-accent-500 shrink-0 mt-0.5" /> Datos demo iniciales que muestran accesorios vinculados, filas BOM por subtipo y comportamiento de cantidades en blanco versus cero.</li>
            <li className="flex gap-2"><i className="ph-bold ph-check text-accent-600 dark:text-accent-500 shrink-0 mt-0.5" /> Endpoints JSON tipados que ahora respaldan directamente el frontend React.</li>
          </ul>
        </article>
        <article className="liquid-glass rounded-2xl p-6 border border-black/10 dark:border-white/10">
          <h3 className="text-lg font-bold text-zinc-900 dark:text-white mb-4">Alcance actual</h3>
          <ul className="space-y-2 text-sm text-zinc-600 dark:text-zinc-400">
            <li className="flex gap-2"><i className="ph-bold ph-arrow-right text-zinc-500 shrink-0 mt-0.5" /> Vista de catálogo con acciones para crear y editar categorías, componentes, atributos y reglas de categorías vinculadas.</li>
            <li className="flex gap-2"><i className="ph-bold ph-arrow-right text-zinc-500 shrink-0 mt-0.5" /> Tablero de proyectos con creación, navegación de detalles y flujos para crear, editar y eliminar instancias de proyecto.</li>
            <li className="flex gap-2"><i className="ph-bold ph-arrow-right text-zinc-500 shrink-0 mt-0.5" /> Página dedicada de historial con filtros por estado, proyecto, texto y cambios ruidosos.</li>
            <li className="flex gap-2"><i className="ph-bold ph-arrow-right text-zinc-500 shrink-0 mt-0.5" /> El panel de materiales ahora parte desde la actividad de movimientos ERP en vez de la selección de proyecto; exportaciones, comentarios y herramientas ERP más profundas aún deben exponerse.</li>
          </ul>
        </article>
      </section>
    </div>
  );
}
