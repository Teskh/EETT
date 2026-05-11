import re
from pathlib import Path

content = Path('Frontend/src/pages/CatalogPage.tsx').read_text()

# Add Modal import
content = content.replace(
    'import { CatalogAttributeEditor }',
    'import { Modal } from "../components/Modal";\nimport { CatalogAttributeEditor }'
)

# Add Modal components
modals_code = """
function AddCategoryModal({ open, onClose, form, setForm, saving, onSubmit }: { open: boolean; onClose: () => void; form: CreateCategoryRequest; setForm: React.Dispatch<React.SetStateAction<CreateCategoryRequest>>; saving: boolean; onSubmit: (e: FormEvent<HTMLFormElement>) => void; }) {
  return (
    <Modal open={open} onClose={onClose} title="Nueva Categoría" kicker="Catálogo" panelClassName="max-w-md">
      <form className="flex flex-col gap-4" onSubmit={onSubmit}>
        <div className="space-y-3">
          <input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} required placeholder="Nombre de categoría" className="w-full bg-zinc-50 dark:bg-black/40 border border-black/10 dark:border-white/10 rounded-lg p-2.5 text-sm text-zinc-900 dark:text-zinc-200 focus:outline-none focus:border-accent-500/50 focus:ring-1 focus:ring-accent-500/50 transition-all font-mono" />
          <textarea value={form.description || ""} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} rows={3} placeholder="Descripción" className="w-full bg-zinc-50 dark:bg-black/40 border border-black/10 dark:border-white/10 rounded-lg p-2.5 text-sm text-zinc-900 dark:text-zinc-200 focus:outline-none focus:border-accent-500/50 focus:ring-1 focus:ring-accent-500/50 transition-all font-mono resize-none" />
          <select value={form.scope} onChange={(event) => setForm((current) => ({ ...current, scope: event.target.value }))} className="w-full bg-zinc-50 dark:bg-zinc-900 border border-black/10 dark:border-white/10 rounded-lg p-2.5 text-sm text-zinc-900 dark:text-zinc-200 focus:outline-none focus:border-accent-500/50 focus:ring-1 focus:ring-accent-500/50 transition-all font-mono">
            <option value="item">Ítem</option>
            <option value="accessory">Accesorio</option>
            <option value="mixed">Mixto</option>
          </select>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-semibold text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-white/5 transition-colors">Cancelar</button>
          <button type="submit" disabled={saving} className="px-4 py-2 bg-accent-500 hover:bg-accent-400 disabled:opacity-60 text-zinc-950 rounded-lg text-sm font-bold transition-all">{saving ? "Creando..." : "Crear categoría"}</button>
        </div>
      </form>
    </Modal>
  );
}

function AddComponentModal({ open, onClose, form, setForm, saving, onSubmit }: { open: boolean; onClose: () => void; form: CreateComponentRequest; setForm: React.Dispatch<React.SetStateAction<CreateComponentRequest>>; saving: boolean; onSubmit: (e: FormEvent<HTMLFormElement>) => void; }) {
  return (
    <Modal open={open} onClose={onClose} title="Nuevo Componente" kicker="Catálogo" panelClassName="max-w-xl">
      <form className="flex flex-col gap-4" onSubmit={onSubmit}>
        <div className="space-y-3">
          <div className="flex gap-3">
            <input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} required placeholder="Nombre" className="flex-1 bg-zinc-50 dark:bg-black/40 border border-black/10 dark:border-white/10 rounded-lg p-2.5 text-sm text-zinc-900 dark:text-zinc-200 focus:outline-none focus:border-accent-500/50 focus:ring-1 focus:ring-accent-500/50 transition-all font-mono" />
            <input value={form.short_name || ""} onChange={(event) => setForm((current) => ({ ...current, short_name: event.target.value }))} placeholder="SKU" className="w-1/3 bg-zinc-50 dark:bg-black/40 border border-black/10 dark:border-white/10 rounded-lg p-2.5 text-sm text-zinc-900 dark:text-zinc-200 focus:outline-none focus:border-accent-500/50 focus:ring-1 focus:ring-accent-500/50 transition-all font-mono" />
          </div>
          <div className="flex gap-3">
            <select value={form.component_type} onChange={(event) => setForm((current) => ({ ...current, component_type: event.target.value }))} className="w-1/2 bg-zinc-50 dark:bg-zinc-900 border border-black/10 dark:border-white/10 rounded-lg p-2.5 text-sm text-zinc-900 dark:text-zinc-200 focus:outline-none focus:border-accent-500/50 focus:ring-1 focus:ring-accent-500/50 transition-all font-mono">
              <option value="item">Ítem</option>
              <option value="accessory">Accesorio</option>
            </select>
            <input value={form.unit_type || ""} onChange={(event) => setForm((current) => ({ ...current, unit_type: event.target.value }))} placeholder="Unidad (m2, set)" className="w-1/2 bg-zinc-50 dark:bg-black/40 border border-black/10 dark:border-white/10 rounded-lg p-2.5 text-sm text-zinc-900 dark:text-zinc-200 focus:outline-none focus:border-accent-500/50 focus:ring-1 focus:ring-accent-500/50 transition-all font-mono" />
          </div>
          <textarea value={form.description || ""} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} rows={2} placeholder="Descripción" className="w-full bg-zinc-50 dark:bg-black/40 border border-black/10 dark:border-white/10 rounded-lg p-2.5 text-sm text-zinc-900 dark:text-zinc-200 focus:outline-none focus:border-accent-500/50 focus:ring-1 focus:ring-accent-500/50 transition-all font-mono resize-none" />
          <textarea value={form.short_description || ""} onChange={(event) => setForm((current) => ({ ...current, short_description: event.target.value }))} rows={2} placeholder="Descripción corta" className="w-full bg-zinc-50 dark:bg-black/40 border border-black/10 dark:border-white/10 rounded-lg p-2.5 text-sm text-zinc-900 dark:text-zinc-200 focus:outline-none focus:border-accent-500/50 focus:ring-1 focus:ring-accent-500/50 transition-all font-mono resize-none" />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-semibold text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-white/5 transition-colors">Cancelar</button>
          <button type="submit" disabled={saving} className="px-4 py-2 bg-accent-500 hover:bg-accent-400 disabled:opacity-60 text-zinc-950 rounded-lg text-sm font-bold transition-all">{saving ? "Creando..." : "Crear componente"}</button>
        </div>
      </form>
    </Modal>
  );
}

function ManageLinksModal({ open, onClose, targets, selectedLinks, setSelectedLinks, saving, onSave }: { open: boolean; onClose: () => void; targets: { id: number; name: string }[]; selectedLinks: number[]; setSelectedLinks: React.Dispatch<React.SetStateAction<number[]>>; saving: boolean; onSave: () => void; }) {
  return (
    <Modal open={open} onClose={onClose} title="Reglas de Vínculo" kicker="Catálogo" panelClassName="max-w-md">
      <div className="flex flex-col gap-4">
        <div className="flex-1 bg-zinc-50 dark:bg-black/20 shadow-sm border border-black/5 dark:border-white/5 rounded-lg p-3 max-h-[300px] overflow-y-auto space-y-2">
          {targets.length ? (
            targets.map((target) => (
              <label key={target.id} className="flex items-center gap-3 p-2 rounded hover:bg-zinc-100 dark:hover:bg-white/5 cursor-pointer text-sm text-zinc-800 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white transition-colors">
                <input
                  type="checkbox"
                  checked={selectedLinks.includes(target.id)}
                  onChange={(event) => setSelectedLinks((current) => event.target.checked ? [...current, target.id] : current.filter((item) => item !== target.id))}
                  className="rounded border-black/10 dark:border-white/10 bg-white dark:bg-black/40 text-accent-600 dark:text-accent-500 focus:ring-accent-500/50"
                />
                <span className="font-mono text-sm">{target.name}</span>
              </label>
            ))
          ) : (
            <p className="text-xs text-zinc-500 font-mono p-2">No hay destinos disponibles.</p>
          )}
        </div>
        <div className="mt-2 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-semibold text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-white/5 transition-colors">Cancelar</button>
          <button type="button" disabled={saving} className="px-4 py-2 bg-accent-500 hover:bg-accent-400 disabled:opacity-60 text-zinc-950 rounded-lg text-sm font-bold transition-all" onClick={onSave}>{saving ? "Guardando..." : "Guardar reglas"}</button>
        </div>
      </div>
    </Modal>
  );
}
"""

content = content.replace('export function CatalogPage({ categoryId, onNavigate }: CatalogPageProps) {', modals_code + '\nexport function CatalogPage({ categoryId, onNavigate }: CatalogPageProps) {')

# Add states
states_code = """
  const [savingCategory, setSavingCategory] = useState(false);
  const [savingComponent, setSavingComponent] = useState(false);
  
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [componentModalOpen, setComponentModalOpen] = useState(false);
  const [linksModalOpen, setLinksModalOpen] = useState(false);
"""
content = re.sub(r'  const \[savingCategory, setSavingCategory\] = useState\(false\);\n  const \[savingComponent, setSavingComponent\] = useState\(false\);', states_code, content)

# Modify handleCreateCategory to close modal
content = content.replace(
    'if (result.category_id) {\n        onNavigate(`/catalog?category_id=${result.category_id}`);\n      } else {\n        await loadCatalog();\n      }',
    'setCategoryModalOpen(false);\n      if (result.category_id) {\n        onNavigate(`/catalog?category_id=${result.category_id}`);\n      } else {\n        await loadCatalog();\n      }'
)

# Modify handleCreateComponent to close modal
content = content.replace(
    'if (result.component) {\n        setData((current) => (current ? upsertSelectedComponent(current, result.component as CatalogComponent) : current));\n      }',
    'setComponentModalOpen(false);\n      if (result.component) {\n        setData((current) => (current ? upsertSelectedComponent(current, result.component as CatalogComponent) : current));\n      }'
)

# Modify handleSaveLinks to close modal
content = content.replace(
    'setData((current) => (current ? patchSelectedLinks(current, selectedLinks) : current));',
    'setLinksModalOpen(false);\n      setData((current) => (current ? patchSelectedLinks(current, selectedLinks) : current));'
)

# Replace the layout
old_layout = """            <div className="flex items-end justify-between border-b border-black/10 dark:border-white/10 pb-4">
              <div>
                <h2 className="text-2xl font-bold text-zinc-900 dark:text-white tracking-tight flex items-center gap-3">
                  {selected.name}
                  <span className="px-2 py-0.5 border border-black/10 dark:border-white/10 bg-zinc-50 dark:bg-white/5 rounded text-[10px] font-mono text-zinc-600 dark:text-zinc-400 align-middle uppercase">
                    {selected.scope}
                  </span>
                </h2>
                <p className="text-sm text-zinc-500 mt-1">{selected.description || "Sin descripción."}</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="liquid-glass rounded-xl p-5">
                <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-3 flex items-center gap-2">
                  <i className="ph-bold ph-folders text-zinc-600 dark:text-zinc-400" /> Subcategorías
                </h3>
                <div className="flex flex-wrap gap-2">
                  {selected.child_categories.length ? (
                    selected.child_categories.map((child) => (
                      <button
                        key={child.id}
                        type="button"
                        className="px-3 py-1 bg-zinc-50 dark:bg-white/5 hover:bg-zinc-100 dark:hover:bg-white/10 border border-black/10 dark:border-white/10 rounded-lg text-xs font-semibold text-zinc-800 dark:text-zinc-300 transition-colors"
                        onClick={() => onNavigate(`/catalog?category_id=${child.id}`)}
                      >
                        {child.name} <span className="text-zinc-500 font-mono text-[10px] ml-2">{child.scope}</span>
                      </button>
                    ))
                  ) : (
                    <p className="text-xs text-zinc-500 font-mono">No hay subcategorías.</p>
                  )}
                </div>
              </div>
              <div className="liquid-glass rounded-xl p-5 border-accent-500/20">
                <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-3 flex items-center gap-2">
                  <i className="ph-bold ph-link text-accent-600 dark:text-accent-500" /> Categorías Vinculadas
                </h3>
                <div className="flex flex-wrap gap-2">
                  {selected.linked_categories.length ? (
                    selected.linked_categories.map((category) => (
                      <div key={category.id} className="px-2 py-1 bg-white dark:bg-black/40 border border-black/5 dark:border-white/5 rounded text-xs text-zinc-600 dark:text-zinc-400 font-mono">
                        {category.name}
                      </div>
                    ))
                  ) : (
                    <p className="text-xs text-zinc-500 font-mono">Ninguna</p>
                  )}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <form className="liquid-glass rounded-xl p-5 flex flex-col gap-4" onSubmit={handleCreateCategory}>
                <h3 className="text-xs font-bold text-zinc-900 dark:text-zinc-200 uppercase tracking-widest">
                  <i className="ph-bold ph-folder-plus text-zinc-600 dark:text-zinc-400 mr-2" /> Agregar Subcategoría
                </h3>
                <div className="space-y-3">
                  <input
                    value={categoryForm.name}
                    onChange={(event) => setCategoryForm((current) => ({ ...current, name: event.target.value }))}
                    required
                    placeholder="Nombre de categoría"
                    className="w-full bg-white dark:bg-black/40 border border-black/10 dark:border-white/10 rounded p-2 text-sm text-zinc-900 dark:text-zinc-200 focus:outline-none focus:border-accent-500/50 transition-all font-mono"
                  />
                  <textarea
                    value={categoryForm.description || ""}
                    onChange={(event) => setCategoryForm((current) => ({ ...current, description: event.target.value }))}
                    rows={2}
                    placeholder="Descripción"
                    className="w-full bg-white dark:bg-black/40 border border-black/10 dark:border-white/10 rounded p-2 text-sm text-zinc-900 dark:text-zinc-200 focus:outline-none focus:border-accent-500/50 transition-all font-mono"
                  />
                  <select
                    value={categoryForm.scope}
                    onChange={(event) => setCategoryForm((current) => ({ ...current, scope: event.target.value }))}
                    className="w-full bg-white dark:bg-zinc-900 border border-black/10 dark:border-white/10 rounded p-2 text-sm text-zinc-900 dark:text-zinc-200 focus:outline-none focus:border-accent-500/50 transition-all font-mono"
                  >
                    <option value="item">Ítem</option>
                    <option value="accessory">Accesorio</option>
                    <option value="mixed">Mixto</option>
                  </select>
                </div>
                <button
                  type="submit"
                  disabled={savingCategory}
                  className="mt-auto px-4 py-2 bg-zinc-50 dark:bg-white/5 hover:bg-zinc-100 dark:hover:bg-white/10 disabled:opacity-60 border border-black/10 dark:border-white/10 rounded-lg text-xs font-semibold text-zinc-900 dark:text-white transition-all w-full"
                >
                  {savingCategory ? "Creando..." : "Crear categoría"}
                </button>
              </form>

              <form className="liquid-glass rounded-xl p-5 flex flex-col gap-4" onSubmit={handleCreateComponent}>
                <h3 className="text-xs font-bold text-zinc-900 dark:text-zinc-200 uppercase tracking-widest">
                  <i className="ph-bold ph-cube text-zinc-600 dark:text-zinc-400 mr-2" /> Agregar Componente
                </h3>
                <div className="space-y-3">
                  <div className="flex gap-2">
                    <input
                      value={componentForm.name}
                      onChange={(event) => setComponentForm((current) => ({ ...current, name: event.target.value }))}
                      required
                      placeholder="Nombre"
                      className="w-2/3 bg-white dark:bg-black/40 border border-black/10 dark:border-white/10 rounded p-2 text-sm text-zinc-900 dark:text-zinc-200 focus:outline-none focus:border-accent-500/50 transition-all font-mono"
                    />
                    <input
                      value={componentForm.short_name || ""}
                      onChange={(event) => setComponentForm((current) => ({ ...current, short_name: event.target.value }))}
                      placeholder="SKU"
                      className="w-1/3 bg-white dark:bg-black/40 border border-black/10 dark:border-white/10 rounded p-2 text-sm text-zinc-900 dark:text-zinc-200 focus:outline-none focus:border-accent-500/50 transition-all font-mono"
                    />
                  </div>
                  <div className="flex gap-2">
                    <select
                      value={componentForm.component_type}
                      onChange={(event) => setComponentForm((current) => ({ ...current, component_type: event.target.value }))}
                      className="w-1/2 bg-white dark:bg-zinc-900 border border-black/10 dark:border-white/10 rounded p-2 text-sm text-zinc-900 dark:text-zinc-200 focus:outline-none focus:border-accent-500/50 transition-all font-mono"
                    >
                      <option value="item">Ítem</option>
                      <option value="accessory">Accesorio</option>
                    </select>
                    <input
                      value={componentForm.unit_type || ""}
                      onChange={(event) => setComponentForm((current) => ({ ...current, unit_type: event.target.value }))}
                      placeholder="Unidad (m2, set)"
                      className="w-1/2 bg-white dark:bg-black/40 border border-black/10 dark:border-white/10 rounded p-2 text-sm text-zinc-900 dark:text-zinc-200 focus:outline-none focus:border-accent-500/50 transition-all font-mono"
                    />
                  </div>
                  <textarea
                    value={componentForm.description || ""}
                    onChange={(event) => setComponentForm((current) => ({ ...current, description: event.target.value }))}
                    rows={2}
                    placeholder="Descripción"
                    className="w-full bg-white dark:bg-black/40 border border-black/10 dark:border-white/10 rounded p-2 text-sm text-zinc-900 dark:text-zinc-200 focus:outline-none focus:border-accent-500/50 transition-all font-mono"
                  />
                  <textarea
                    value={componentForm.short_description || ""}
                    onChange={(event) => setComponentForm((current) => ({ ...current, short_description: event.target.value }))}
                    rows={2}
                    placeholder="Descripción corta"
                    className="w-full bg-white dark:bg-black/40 border border-black/10 dark:border-white/10 rounded p-2 text-sm text-zinc-900 dark:text-zinc-200 focus:outline-none focus:border-accent-500/50 transition-all font-mono"
                  />
                </div>
                <button
                  type="submit"
                  disabled={savingComponent}
                  className="mt-auto px-4 py-2 bg-accent-500 hover:bg-accent-400 disabled:opacity-60 text-zinc-950 border border-transparent rounded-lg text-xs font-bold transition-all w-full"
                >
                  {savingComponent ? "Creando..." : "Crear componente"}
                </button>
              </form>

              <div className="liquid-glass rounded-xl p-5 flex flex-col gap-4">
                <h3 className="text-xs font-bold text-zinc-900 dark:text-zinc-200 uppercase tracking-widest">
                  <i className="ph-bold ph-plugs text-zinc-600 dark:text-zinc-400 mr-2" /> Reglas
                </h3>
                <div className="flex-1 bg-white dark:bg-black/20 shadow-sm border border-black/5 dark:border-white/5 rounded-lg p-3 max-h-[200px] overflow-y-auto space-y-2">
                  {data.link_targets.length ? (
                    data.link_targets.map((target) => (
                      <label key={target.id} className="flex items-center gap-2 text-sm text-zinc-800 dark:text-zinc-300 cursor-pointer hover:text-zinc-900 dark:text-white transition-colors">
                        <input
                          type="checkbox"
                          checked={selectedLinks.includes(target.id)}
                          onChange={(event) =>
                            setSelectedLinks((current) =>
                              event.target.checked ? [...current, target.id] : current.filter((item) => item !== target.id),
                            )
                          }
                          className="rounded border-black/10 dark:border-white/10 bg-white dark:bg-black/40 text-accent-600 dark:text-accent-500 focus:ring-accent-500/50"
                        />
                        <span className="font-mono text-xs">{target.name}</span>
                      </label>
                    ))
                  ) : (
                    <p className="text-xs text-zinc-500 font-mono">No hay destinos disponibles.</p>
                  )}
                </div>
                <button
                  type="button"
                  disabled={savingLinks}
                  className="mt-auto px-4 py-2 bg-zinc-50 dark:bg-white/5 hover:bg-zinc-100 dark:hover:bg-white/10 disabled:opacity-60 border border-black/10 dark:border-white/10 rounded-lg text-xs font-semibold text-zinc-900 dark:text-white transition-all w-full"
                  onClick={() => void handleSaveLinks()}
                >
                  {savingLinks ? "Guardando..." : "Guardar reglas"}
                </button>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-zinc-900 dark:text-white flex items-center gap-2">
                  <i className="ph-bold ph-stack text-zinc-600 dark:text-zinc-400" /> Componentes
                </h3>
                <div className="text-xs font-mono text-zinc-500">{selected.components.length} instancias</div>
              </div>
              <div className="w-full border border-black/10 dark:border-white/10 rounded-xl overflow-hidden bg-white dark:bg-zinc-900/50 backdrop-blur-sm">"""

new_layout = """            <div className="flex items-end justify-between border-b border-black/10 dark:border-white/10 pb-4">
              <div>
                <h2 className="text-3xl font-bold text-zinc-900 dark:text-white tracking-tight flex items-center gap-3">
                  {selected.name}
                  <span className="px-2 py-0.5 border border-black/10 dark:border-white/10 bg-zinc-50 dark:bg-white/5 rounded-md text-[10px] font-mono text-zinc-600 dark:text-zinc-400 align-middle uppercase">
                    {selected.scope}
                  </span>
                </h2>
                <p className="text-sm text-zinc-500 mt-1.5">{selected.description || "Sin descripción."}</p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setCategoryModalOpen(true)}
                  className="px-4 py-2 border border-black/10 dark:border-white/10 bg-white dark:bg-white/5 hover:bg-zinc-50 dark:hover:bg-white/10 rounded-lg text-sm font-semibold text-zinc-900 dark:text-zinc-200 transition-colors flex items-center gap-2 shadow-sm"
                >
                  <i className="ph-bold ph-folder-plus" />
                  Nueva Categoría
                </button>
                <button
                  type="button"
                  onClick={() => setComponentModalOpen(true)}
                  className="px-4 py-2 bg-accent-500 hover:bg-accent-400 text-zinc-950 border border-transparent rounded-lg text-sm font-bold transition-colors flex items-center gap-2 shadow-sm shadow-accent-500/20"
                >
                  <i className="ph-bold ph-cube" />
                  Nuevo Componente
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="liquid-glass rounded-2xl p-5 border border-black/5 dark:border-white/5">
                <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-4 flex items-center gap-2">
                  <i className="ph-bold ph-folders text-zinc-600 dark:text-zinc-400" /> Subcategorías
                </h3>
                <div className="flex flex-wrap gap-2">
                  {selected.child_categories.length ? (
                    selected.child_categories.map((child) => (
                      <button
                        key={child.id}
                        type="button"
                        className="px-3 py-1.5 bg-white dark:bg-white/5 hover:bg-zinc-50 dark:hover:bg-white/10 border border-black/10 dark:border-white/10 rounded-lg text-sm font-semibold text-zinc-800 dark:text-zinc-300 transition-colors shadow-sm"
                        onClick={() => onNavigate(`/catalog?category_id=${child.id}`)}
                      >
                        {child.name} <span className="text-zinc-500 font-mono text-[10px] ml-2">{child.scope}</span>
                      </button>
                    ))
                  ) : (
                    <p className="text-sm text-zinc-500">No hay subcategorías.</p>
                  )}
                </div>
              </div>

              <div className="liquid-glass rounded-2xl p-5 border border-black/5 dark:border-white/5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-widest flex items-center gap-2">
                    <i className="ph-bold ph-link text-accent-600 dark:text-accent-500" /> Categorías Vinculadas
                  </h3>
                  <button
                    type="button"
                    onClick={() => setLinksModalOpen(true)}
                    className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-300 transition-colors"
                  >
                    Editar
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {selected.linked_categories.length ? (
                    selected.linked_categories.map((category) => (
                      <div key={category.id} className="px-2 py-1 bg-white dark:bg-black/40 border border-black/5 dark:border-white/5 rounded text-xs text-zinc-600 dark:text-zinc-400 font-mono shadow-sm">
                        {category.name}
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-zinc-500">Ninguna</p>
                  )}
                </div>
              </div>
            </div>

            <div className="mt-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-zinc-900 dark:text-white flex items-center gap-2">
                  <i className="ph-bold ph-stack text-zinc-600 dark:text-zinc-400" /> Componentes
                </h3>
                <div className="text-xs font-mono text-zinc-500 bg-black/5 dark:bg-white/5 px-2 py-1 rounded-md">{selected.components.length} instancias</div>
              </div>
              <div className="w-full border border-black/10 dark:border-white/10 rounded-2xl overflow-hidden bg-white dark:bg-zinc-900/50 backdrop-blur-sm shadow-sm">"""

content = content.replace(old_layout, new_layout)

# Add Modals to the end of selected and data check block
end_block = """          </div>
        ) : (
          <div className="liquid-glass rounded-2xl p-6 text-center text-zinc-500 font-mono text-sm">No hay categoría seleccionada.</div>
        )}
      </div>
    </div>
  );
}"""

modals_render = """            <AddCategoryModal open={categoryModalOpen} onClose={() => setCategoryModalOpen(false)} form={categoryForm} setForm={setCategoryForm} saving={savingCategory} onSubmit={handleCreateCategory} />
            <AddComponentModal open={componentModalOpen} onClose={() => setComponentModalOpen(false)} form={componentForm} setForm={setComponentForm} saving={savingComponent} onSubmit={handleCreateComponent} />
            <ManageLinksModal open={linksModalOpen} onClose={() => setLinksModalOpen(false)} targets={data.link_targets} selectedLinks={selectedLinks} setSelectedLinks={setSelectedLinks} saving={savingLinks} onSave={() => void handleSaveLinks()} />
          </div>
        ) : (
          <div className="liquid-glass rounded-2xl p-6 text-center text-zinc-500 font-mono text-sm">No hay categoría seleccionada.</div>
        )}
      </div>
    </div>
  );
}"""

content = content.replace(end_block, modals_render)

Path('Frontend/src/pages/CatalogPage.tsx').write_text(content)
