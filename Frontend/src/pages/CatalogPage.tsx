import { FormEvent, ReactNode, useEffect, useRef, useState } from "react";

import { Modal } from "../components/Modal";
import { CatalogAttributeEditor } from "../components/CatalogAttributeEditor";
import { CatalogMaterialRuleEditor } from "../components/CatalogMaterialRuleEditor";
import { MediaPicker } from "../components/MediaPicker";
import { FactoryQuantityLabel } from "../components/QuantityLabels";
import { SearchField } from "../components/SearchField";
import { ApiError, api } from "../lib/api";
import { matchesSearchText, normalizeSearchText, searchTreeBranchMatches } from "../lib/search";
import type {
  CatalogAttribute,
  CatalogCategoryDeletionImpact,
  CatalogComponent,
  CatalogMaterialRule,
  CatalogPageData,
  CatalogTreeComponent,
  CatalogTreeNode,
  CreateCategoryRequest,
  CreateComponentRequest,
  MediaAsset,
  UpdateComponentRequest,
} from "../lib/types";

type CatalogPageProps = {
  categoryId: number | null;
  onNavigate: (to: string) => void;
};

type ComponentCardProps = {
  component: CatalogComponent;
  focused: boolean;
  onComponentSaved: (component: CatalogComponent) => void;
  onComponentDeleted: (componentId: number) => void;
};

type CategoryActionTarget = {
  id: number;
  name: string;
};

const initialCategoryForm: CreateCategoryRequest = {
  name: "",
  description: "",
  scope: "item",
  parent_id: null,
};

const initialComponentForm: CreateComponentRequest = {
  category_id: 0,
  component_type: "item",
  name: "",
  short_name: "",
  description: "",
  short_description: "",
  installation: "",
  unit_type: "",
};

const control = "border border-black/15 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-red-600 focus:ring-1 focus:ring-red-600 disabled:opacity-50 dark:border-white/15 dark:bg-zinc-900 dark:text-white";
const field = "mt-0.5 block h-8 w-full border border-black/15 bg-white px-2 py-1 text-xs text-zinc-900 outline-none focus:border-red-600 focus:ring-1 focus:ring-red-600 disabled:opacity-50 dark:border-white/15 dark:bg-zinc-900 dark:text-white";
const primaryButton = "border border-zinc-950 bg-zinc-950 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50 dark:border-white dark:bg-white dark:text-zinc-950";
const scopeLabels: Record<string, string> = { item: "Ítem", accessory: "Accesorio", mixed: "Mixto" };

function formatCondition(rule: CatalogMaterialRule) {
  if (!rule.conditions.length) {
    return <span className="text-zinc-500 text-xs italic">Siempre aplica</span>;
  }
  return rule.conditions.map((group) => {
    const clauses = group.clauses
      .map((clause) =>
        [clause.attribute_name, clause.operator, clause.comparison_value, clause.comparison_value_secondary]
          .filter(Boolean)
          .join(" "),
      )
      .join(" Y ");
    return (
      <span key={`${rule.sku}-${group.group}`} className="px-1.5 py-0.5 bg-white dark:bg-black/40 border border-black/5 dark:border-white/5 rounded text-[10px] font-mono text-zinc-600 dark:text-zinc-400">
        {group.group}: {clauses}
      </span>
    );
  });
}

function componentMatches(component: CatalogTreeComponent, term: string): boolean {
  return matchesSearchText(term, component.name, component.short_name, ...component.material_skus);
}

export function treeMatches(node: CatalogTreeNode, term: string): boolean {
  return searchTreeBranchMatches(node, term, (current) => [
    current.name,
    ...current.components.flatMap((component) => [component.name, component.short_name, ...component.material_skus]),
  ]);
}

function CatalogTree({
  nodes,
  selectedCategoryId,
  filterTerm,
  onSelect,
  onSelectComponent,
  onManageCategory,
  depth = 0,
}: {
  nodes: CatalogTreeNode[];
  selectedCategoryId: number | null;
  filterTerm: string;
  onSelect: (categoryId: number) => void;
  onSelectComponent: (categoryId: number, componentId: number) => void;
  onManageCategory: (category: CategoryActionTarget) => void;
  depth?: number;
}) {
  return (
    <ul className={depth === 0 ? "" : "ml-4 border-l border-black/10 pl-2 dark:border-white/10"}>
      {nodes
        .filter((node) => treeMatches(node, filterTerm))
        .map((node) => {
          const active = node.id === selectedCategoryId;
          const matchingComponents = normalizeSearchText(filterTerm)
            ? node.components.filter((component) => componentMatches(component, filterTerm))
            : [];
          return (
            <li key={node.id}>
              <div className={`group/category flex items-center border-l-2 ${active ? "border-red-600 bg-zinc-100 dark:bg-white/[0.06]" : "border-transparent hover:bg-black/[0.03] dark:hover:bg-white/[0.03]"}`}>
                <button
                  type="button"
                  onClick={() => onSelect(node.id)}
                  aria-current={active ? "page" : undefined}
                  className={`flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left text-xs ${
                    active ? "font-semibold text-zinc-950 dark:text-white" : "text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-100"
                  }`}
                >
                  {depth === 0 ? <i className={`${active ? "ph-fill ph-folder-open text-red-600" : "ph-fill ph-folder text-zinc-400 dark:text-zinc-500"}`} aria-hidden="true" /> : null}
                  <span className="min-w-0 flex-1 truncate">{node.name}</span>
                  {depth === 0 ? <span className="shrink-0 font-mono text-[10px] font-normal tabular-nums text-zinc-500">{node.component_count}</span> : null}
                </button>
                <button
                  type="button"
                  onClick={() => onManageCategory(node)}
                  aria-label={`Editar o eliminar ${node.name}`}
                  title={depth === 0 ? "Editar categoría" : "Editar subcategoría"}
                  className="pointer-events-none flex h-7 w-7 shrink-0 items-center justify-center text-zinc-500 opacity-0 hover:bg-black/5 hover:text-zinc-900 focus:pointer-events-auto focus:opacity-100 group-hover/category:pointer-events-auto group-hover/category:opacity-100 dark:hover:bg-white/10 dark:hover:text-zinc-100"
                >
                  <i className="ph-bold ph-dots-three" />
                </button>
              </div>
              {matchingComponents.length ? (
                <ul className="ml-4 border-l border-black/10 pl-2 dark:border-white/10">
                  {matchingComponents.map((component) => {
                    const isAccessory = component.type === "accessory";
                    return (
                      <li key={component.id}>
                        <button
                          type="button"
                          onClick={() => onSelectComponent(node.id, component.id)}
                          className="flex w-full items-center gap-2 px-2 py-1 text-left text-xs text-zinc-600 hover:bg-black/[0.03] hover:text-zinc-950 dark:text-zinc-400 dark:hover:bg-white/[0.03] dark:hover:text-zinc-100"
                        >
                          <i className={`ph-fill ${isAccessory ? "ph-flask" : "ph-wall"} text-zinc-400 dark:text-zinc-500`} aria-hidden="true" />
                          <span className="min-w-0 flex-1 truncate">{component.name}</span>
                          <span className="shrink-0 text-[10px] text-zinc-500">{isAccessory ? "Accesorio" : "Ítem"}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
              {node.children.length ? (
                <CatalogTree
                  nodes={node.children}
                  selectedCategoryId={selectedCategoryId}
                  filterTerm={filterTerm}
                  onSelect={onSelect}
                  onSelectComponent={onSelectComponent}
                  onManageCategory={onManageCategory}
                  depth={depth + 1}
                />
              ) : null}
            </li>
          );
        })}
    </ul>
  );
}

/** Categories from the root down to the given one, for the breadcrumb. */
function categoryPath(nodes: CatalogTreeNode[], categoryId: number): CatalogTreeNode[] {
  for (const node of nodes) {
    if (node.id === categoryId) return [node];
    const below = categoryPath(node.children, categoryId);
    if (below.length) return [node, ...below];
  }
  return [];
}

function componentForm(component: CatalogComponent): UpdateComponentRequest {
  return {
    name: component.name,
    short_name: component.short_name || "",
    description: component.description || "",
    short_description: component.short_description || "",
    installation: component.installation || "",
    unit_type: component.unit_type || "",
    component_type: component.type,
  };
}

type TextField = "description" | "short_description" | "installation";
const textFields: [TextField, string][] = [["description", "Descripción"], ["short_description", "Descripción comercial"], ["installation", "Instalación"]];

function SectionTitle({ icon, children, action }: { icon: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-3">
      <h4 className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
        <i className={`ph-bold ${icon}`} aria-hidden="true" /> {children}
      </h4>
      {action}
    </div>
  );
}

function ComponentCard({ component, focused, onComponentSaved, onComponentDeleted }: ComponentCardProps) {
  const [expanded, setExpanded] = useState(focused);
  const [saving, setSaving] = useState(false);
  const [attributeSaving, setAttributeSaving] = useState(false);
  const [materialSaving, setMaterialSaving] = useState(false);
  const [materialEditorOpen, setMaterialEditorOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [textTab, setTextTab] = useState<TextField>("description");
  const isAccessory = component.type === "accessory";
  const [form, setForm] = useState<UpdateComponentRequest>(() => componentForm(component));
  const dirty = JSON.stringify(form) !== JSON.stringify(componentForm(component));
  const attributeCount = component.base_attributes.length + (isAccessory ? component.usage_attributes.length : 0);

  useEffect(() => {
    setForm(componentForm(component));
  }, [component]);

  useEffect(() => {
    if (focused) {
      setExpanded(true);
    }
  }, [focused]);

  // Every save reports its failure in the card instead of failing silently.
  async function run(setBusy: (busy: boolean) => void, action: () => Promise<void>, fallback: string) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : fallback);
    } finally {
      setBusy(false);
    }
  }

  function handleSaveComponent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void run(setSaving, async () => {
      const result = await api.updateComponent(component.id, form);
      if (result.component) {
        onComponentSaved(result.component);
      }
    }, "No se pudo guardar el componente.");
  }

  function handleDeleteComponent() {
    const confirmed = window.confirm(`¿Eliminar «${component.name}» del catálogo?`);
    if (!confirmed) {
      return;
    }
    void run(setSaving, async () => {
      await api.deleteComponent(component.id);
      onComponentDeleted(component.id);
    }, "No se pudo eliminar el componente. Si está en uso en algún proyecto, la eliminación se bloquea.");
  }

  async function handleSaveAttributes(scope: string, attributes: CatalogAttribute[]) {
    await run(setAttributeSaving, async () => {
      const result = await api.replaceComponentAttributes(component.id, scope, attributes);
      if (result.component) {
        onComponentSaved(result.component);
      }
    }, "No se pudieron guardar los atributos.");
  }

  // The rule editor shows its own errors and stays open on failure, so this one rethrows.
  async function handleSaveMaterialRules(rules: CatalogMaterialRule[]) {
    setMaterialSaving(true);
    try {
      const result = await api.replaceComponentMaterialRules(component.id, rules);
      if (result.component) {
        onComponentSaved(result.component);
      }
    } finally {
      setMaterialSaving(false);
    }
  }

  function handleMediaChange(asset: MediaAsset | null) {
    void run(setSaving, async () => {
      const result = await api.updateComponentMedia(component.id, asset?.id ?? null);
      if (result.component) {
        onComponentSaved(result.component);
      }
    }, "No se pudo actualizar la imagen.");
  }

  const busy = saving || attributeSaving || materialSaving;

  return (
    <div id={`component-${component.id}`} className={`scroll-mt-24 border-b border-black/10 dark:border-white/10 ${focused ? "bg-red-50/40 dark:bg-red-500/[0.04]" : ""}`}>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
        className={`grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-2.5 text-left text-xs hover:bg-black/[0.03] dark:hover:bg-white/[0.03] md:grid-cols-[auto_minmax(0,1fr)_6rem_7rem_6rem_auto] md:px-6 ${expanded ? "bg-zinc-100 dark:bg-white/[0.05]" : ""}`}
      >
        <i className={`ph-fill ${isAccessory ? "ph-flask" : "ph-wall"} text-base text-zinc-400 dark:text-zinc-500`} aria-hidden="true" />
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-semibold text-zinc-950 dark:text-white">{component.name}</span>
          {component.short_name ? <span className="shrink-0 border border-black/10 px-1.5 py-0.5 font-mono text-[10px] text-zinc-500 dark:border-white/10">{component.short_name}</span> : null}
        </span>
        <span className="hidden text-zinc-500 md:block">{isAccessory ? "Accesorio" : "Ítem"}</span>
        <span className={`hidden text-right tabular-nums md:block ${component.material_rules.length ? "text-zinc-600 dark:text-zinc-400" : "text-amber-700 dark:text-amber-400"}`}>
          {component.material_rules.length ? `${component.material_rules.length} materiales` : "Sin materiales"}
        </span>
        <span className="hidden text-right tabular-nums text-zinc-500 md:block">{attributeCount} atributos</span>
        <span className="flex items-center gap-2 text-zinc-500">
          {busy ? <i className="ph ph-circle-notch animate-spin" aria-label="Guardando" /> : null}
          <i className={`ph-bold ${expanded ? "ph-caret-up" : "ph-caret-down"}`} aria-hidden="true" />
        </span>
      </button>
      {expanded ? (
        <div className="border-t border-black/10 bg-zinc-50 px-4 py-3 dark:border-white/10 dark:bg-white/[0.025] md:px-6">
          {error ? <div role="alert" className="mb-3 border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-500/20 dark:bg-red-950/20 dark:text-red-300">{error}</div> : null}
          <div className="grid gap-5 md:grid-cols-[13rem_minmax(0,1fr)]">
            <div className="min-w-0">
              <p className="mb-0.5 text-[10px] text-zinc-500">Imagen de catálogo</p>
              <MediaPicker value={component.media[0] || null} onChange={(asset) => handleMediaChange(asset)} tile />
            </div>
            <form className="flex min-w-0 flex-col gap-3" onSubmit={handleSaveComponent}>
              <div className="grid grid-cols-2 gap-x-3 gap-y-2 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_8rem_7rem]">
                <label className="col-span-2 text-[10px] text-zinc-500 lg:col-span-1">Nombre
                  <input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} required className={`${field} font-medium`} />
                </label>
                <label className="col-span-2 text-[10px] text-zinc-500 lg:col-span-1">Nombre comercial
                  <input value={form.short_name || ""} onChange={(event) => setForm((current) => ({ ...current, short_name: event.target.value }))} className={field} />
                </label>
                <label className="text-[10px] text-zinc-500">Tipo
                  <select value={form.component_type} onChange={(event) => setForm((current) => ({ ...current, component_type: event.target.value }))} className={field}>
                    <option value="item">Ítem</option>
                    <option value="accessory">Accesorio</option>
                  </select>
                </label>
                <label className="text-[10px] text-zinc-500">Unidad
                  <input value={form.unit_type || ""} onChange={(event) => setForm((current) => ({ ...current, unit_type: event.target.value }))} placeholder="m2, set…" className={field} />
                </label>
              </div>
              {/* The three texts share one box; a dot marks the ones with content. */}
              <div className="border border-black/15 bg-white focus-within:border-red-600 focus-within:ring-1 focus-within:ring-red-600 dark:border-white/15 dark:bg-zinc-900">
                <div role="tablist" aria-label="Textos del componente" className="flex border-b border-black/10 dark:border-white/10">
                  {textFields.map(([key, label]) => (
                    <button key={key} type="button" role="tab" aria-selected={textTab === key} onClick={() => setTextTab(key)}
                      className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-1.5 text-xs ${textTab === key ? "border-red-600 font-semibold text-zinc-950 dark:text-white" : "border-transparent text-zinc-500 hover:text-zinc-950 dark:hover:text-white"}`}>
                      {label}
                      <span aria-label={form[key] ? "con texto" : "vacío"} className={`h-1.5 w-1.5 rounded-full ${form[key] ? "bg-zinc-500" : "border border-zinc-300 dark:border-zinc-600"}`} />
                    </button>
                  ))}
                </div>
                <textarea
                  role="tabpanel"
                  aria-label={textFields.find(([key]) => key === textTab)?.[1]}
                  value={form[textTab] || ""}
                  onChange={(event) => setForm((current) => ({ ...current, [textTab]: event.target.value }))}
                  placeholder="Sin texto."
                  className="description-textarea block min-h-[6rem] w-full bg-transparent px-3 py-2 text-sm leading-relaxed text-zinc-900 outline-none dark:text-zinc-100"
                />
              </div>
              <div className="flex items-center gap-3">
                <button className="border border-zinc-950 bg-zinc-950 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50 dark:border-white dark:bg-white dark:text-zinc-950" type="submit" disabled={saving || !dirty}>
                  {saving ? "Guardando…" : "Guardar cambios"}
                </button>
                {dirty && !saving ? <span className="text-[10px] text-amber-700 dark:text-amber-400">Cambios sin guardar</span> : null}
                {dirty && !saving ? <button type="button" className="text-[10px] text-zinc-500 underline" onClick={() => setForm(componentForm(component))}>Descartar</button> : null}
                <button className="ml-auto flex items-center gap-1 text-[10px] text-zinc-500 hover:text-red-700 disabled:opacity-50 dark:hover:text-red-400" type="button" disabled={saving}
                  title="La eliminación se bloquea si el componente está en uso en algún proyecto." onClick={handleDeleteComponent}>
                  <i className="ph-bold ph-trash" aria-hidden="true" /> Eliminar componente
                </button>
              </div>
            </form>
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-2">
            <div className="flex min-w-0 flex-col gap-3">
              <div>
                <SectionTitle icon="ph-list-dashes">Atributos base</SectionTitle>
                <CatalogAttributeEditor
                  initialAttributes={component.base_attributes}
                  saving={attributeSaving}
                  onSave={(attributes) => handleSaveAttributes("base", attributes)}
                />
              </div>
              {isAccessory ? (
                <div>
                  <SectionTitle icon="ph-flow-arrow">Atributos de uso</SectionTitle>
                  <CatalogAttributeEditor
                    initialAttributes={component.usage_attributes}
                    saving={attributeSaving}
                    onSave={(attributes) => handleSaveAttributes("usage", attributes)}
                  />
                </div>
              ) : null}
            </div>

            <div className="min-w-0">
              <SectionTitle icon="ph-boxes" action={
                <button type="button" onClick={() => setMaterialEditorOpen(true)} className="flex items-center gap-1 text-xs text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-white">
                  <i className="ph-bold ph-sliders-horizontal" aria-hidden="true" /> Administrar
                </button>
              }>Reglas de materiales ({component.material_rules.length})</SectionTitle>
              <div className="overflow-x-auto border border-black/10 bg-white dark:border-white/10 dark:bg-zinc-950">
                <table className="w-full text-xs">
                  <thead className="bg-zinc-100 text-[10px] text-zinc-500 dark:bg-zinc-900">
                    <tr>
                      <th className="border-b border-black/10 px-2 py-1.5 text-left font-semibold dark:border-white/10">Material</th>
                      <th className="border-b border-black/10 px-2 py-1.5 text-right font-semibold dark:border-white/10"><FactoryQuantityLabel /> / un.</th>
                      <th className="border-b border-black/10 px-2 py-1.5 text-right font-semibold dark:border-white/10">Condiciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {component.material_rules.length ? (
                      component.material_rules.map((rule) => (
                        <tr key={`${rule.sku}-${rule.material_name}`} className="border-b border-black/5 align-top last:border-0 dark:border-white/5">
                          <td className="px-2 py-1.5">
                            <span className="block font-medium text-zinc-900 dark:text-zinc-200">{rule.material_name}</span>
                            <span className="font-mono text-[10px] text-zinc-500">{rule.sku} · {rule.unit || "-"}</span>
                          </td>
                          <td className="px-2 py-1.5 text-right font-mono tabular-nums text-zinc-900 dark:text-zinc-100">{rule.unit_qty_per_unit ?? "n/d"}</td>
                          <td className="px-2 py-1.5 text-right">
                            <div className="flex flex-wrap justify-end gap-1">{formatCondition(rule)}</div>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={3} className="px-2 py-4 text-center text-zinc-500">
                          No hay reglas de materiales definidas.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <CatalogMaterialRuleEditor
            component={component}
            open={materialEditorOpen}
            saving={materialSaving}
            onClose={() => setMaterialEditorOpen(false)}
            onSave={handleSaveMaterialRules}
            onSearch={(query) => api.searchCatalogMaterials(query)}
          />
        </div>
      ) : null}
    </div>
  );
}

function sortComponents(components: CatalogComponent[]) {
  return [...components].sort((left, right) => left.name.localeCompare(right.name));
}

function toTreeComponent(component: CatalogComponent): CatalogTreeComponent {
  return {
    id: component.id,
    name: component.name,
    short_name: component.short_name,
    type: component.type,
    material_skus: [...new Set(component.material_rules.map((rule) => rule.sku))].sort(),
  };
}

function upsertTreeComponent(nodes: CatalogTreeNode[], component: CatalogComponent): CatalogTreeNode[] {
  return nodes.map((node) => ({
    ...node,
    component_count:
      node.id === component.category_id && !node.components.some((item) => item.id === component.id)
        ? node.component_count + 1
        : node.component_count,
    components:
      node.id === component.category_id
        ? [...node.components.filter((item) => item.id !== component.id), toTreeComponent(component)].sort((left, right) =>
            left.name.localeCompare(right.name),
          )
        : node.components,
    children: upsertTreeComponent(node.children, component),
  }));
}

function removeTreeComponent(nodes: CatalogTreeNode[], categoryId: number, componentId: number): CatalogTreeNode[] {
  return nodes.map((node) => ({
    ...node,
    component_count: node.id === categoryId ? Math.max(0, node.component_count - 1) : node.component_count,
    components: node.id === categoryId ? node.components.filter((component) => component.id !== componentId) : node.components,
    children: removeTreeComponent(node.children, categoryId, componentId),
  }));
}

function upsertSelectedComponent(data: CatalogPageData, nextComponent: CatalogComponent): CatalogPageData {
  if (!data.selected || data.selected.id !== nextComponent.category_id) {
    return data;
  }

  const exists = data.selected.components.some((component) => component.id === nextComponent.id);
  return {
    ...data,
    selected: {
      ...data.selected,
      components: sortComponents(
        exists
          ? data.selected.components.map((component) => (component.id === nextComponent.id ? nextComponent : component))
          : [...data.selected.components, nextComponent],
      ),
    },
    summary: exists
      ? data.summary
      : {
          ...data.summary,
          components: data.summary.components + 1,
        },
    tree: upsertTreeComponent(data.tree, nextComponent),
  };
}

function removeSelectedComponent(data: CatalogPageData, componentId: number): CatalogPageData {
  if (!data.selected) {
    return data;
  }

  const nextComponents = data.selected.components.filter((component) => component.id !== componentId);
  if (nextComponents.length === data.selected.components.length) {
    return data;
  }

  return {
    ...data,
    summary: {
      ...data.summary,
      components: Math.max(0, data.summary.components - 1),
    },
    tree: removeTreeComponent(data.tree, data.selected.id, componentId),
    selected: {
      ...data.selected,
      components: nextComponents,
    },
  };
}

function patchSelectedLinks(data: CatalogPageData, linkedCategoryIds: number[]): CatalogPageData {
  if (!data.selected) {
    return data;
  }

  const linkedIdSet = new Set(linkedCategoryIds);
  const linkedCategories = data.link_targets
    .filter((target) => linkedIdSet.has(target.id))
    .map((target) => ({ id: target.id, name: target.name }))
    .sort((left, right) => left.name.localeCompare(right.name));

  return {
    ...data,
    selected: {
      ...data.selected,
      linked_category_ids: [...linkedCategoryIds],
      linked_categories: linkedCategories,
    },
  };
}

function CategoryActionsModal({
  target,
  name,
  setName,
  impact,
  saving,
  error,
  onClose,
  onRename,
  onInspectDelete,
  onConfirmDelete,
  onCancelDelete,
}: {
  target: CategoryActionTarget | null;
  name: string;
  setName: (name: string) => void;
  impact: CatalogCategoryDeletionImpact | null;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onRename: (event: FormEvent<HTMLFormElement>) => void;
  onInspectDelete: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
}) {
  return (
    <Modal open={Boolean(target)} title="Editar categoría" kicker={target?.name || "Categoría"} onClose={onClose} panelClassName="max-w-lg">
      <div className="space-y-6">
        {error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300">
            {error}
          </div>
        ) : null}

        <form className="space-y-4" onSubmit={onRename}>
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300" htmlFor="catalog-category-name">
              Nombre de la categoría
            </label>
            <input
              id="catalog-category-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              className="w-full rounded-lg border border-black/10 bg-white px-3 py-2.5 text-sm text-zinc-900 focus:border-accent-500/50 focus:outline-none focus:ring-2 focus:ring-accent-500/10 dark:border-white/10 dark:bg-black/40 dark:text-zinc-200"
            />
          </div>
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={saving || !name.trim() || name.trim() === target?.name}
              className="rounded-lg bg-accent-500 px-4 py-2 text-sm font-semibold text-zinc-950 transition-colors hover:bg-accent-400 disabled:opacity-50"
            >
              {saving ? "Guardando..." : "Guardar nombre"}
            </button>
          </div>
        </form>

        <div className="border-t border-black/10 pt-5 dark:border-white/10">
          {!impact?.requires_confirmation ? (
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Eliminar categoría</div>
                <p className="mt-0.5 text-xs text-zinc-500">Se comprobará su contenido antes de continuar.</p>
              </div>
              <button
                type="button"
                onClick={onInspectDelete}
                disabled={saving}
                className="shrink-0 rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 disabled:opacity-50 dark:border-red-500/30 dark:text-red-300 dark:hover:bg-red-500/10"
              >
                {saving ? "Comprobando..." : "Eliminar"}
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-lg border border-black/10 bg-zinc-50 p-4 dark:border-white/10 dark:bg-white/[0.03]">
                <div className="flex items-start gap-3">
                  <i className="ph-bold ph-warning-circle mt-0.5 text-lg text-amber-600 dark:text-amber-400" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">La categoría contiene información</div>
                    <p className="mt-1 text-xs leading-5 text-zinc-600 dark:text-zinc-400">
                      Al eliminarla también se eliminarán los siguientes elementos:
                    </p>
                    <dl className="mt-3 grid grid-cols-2 gap-x-5 gap-y-2 text-sm">
                      {impact.descendant_count ? (
                        <div className="flex justify-between gap-2 border-b border-black/5 pb-1 dark:border-white/5">
                          <dt className="text-zinc-500">Subcategorías</dt><dd className="font-mono text-zinc-900 dark:text-zinc-200">{impact.descendant_count}</dd>
                        </div>
                      ) : null}
                      {impact.component_count ? (
                        <div className="flex justify-between gap-2 border-b border-black/5 pb-1 dark:border-white/5">
                          <dt className="text-zinc-500">Componentes</dt><dd className="font-mono text-zinc-900 dark:text-zinc-200">{impact.component_count}</dd>
                        </div>
                      ) : null}
                      {impact.instance_count ? (
                        <div className="flex justify-between gap-2 border-b border-black/5 pb-1 dark:border-white/5">
                          <dt className="text-zinc-500">Instancias</dt><dd className="font-mono text-zinc-900 dark:text-zinc-200">{impact.instance_count}</dd>
                        </div>
                      ) : null}
                      {impact.linked_category_count ? (
                        <div className="flex justify-between gap-2 border-b border-black/5 pb-1 dark:border-white/5">
                          <dt className="text-zinc-500">Vínculos</dt><dd className="font-mono text-zinc-900 dark:text-zinc-200">{impact.linked_category_count}</dd>
                        </div>
                      ) : null}
                    </dl>
                    {impact.affected_projects.length ? (
                      <div className="mt-3 border-t border-black/5 pt-3 text-xs dark:border-white/5">
                        <div className="mb-1.5 font-medium text-zinc-600 dark:text-zinc-300">Proyectos afectados</div>
                        <div className="space-y-1 text-zinc-500">
                          {impact.affected_projects.map((project) => (
                            <div key={project.id} className="flex justify-between gap-3">
                              <span className="truncate">{project.name}</span>
                              <span className="shrink-0 font-mono">{project.instance_count}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-zinc-500">Esta acción no se puede deshacer.</p>
                <div className="flex gap-2">
                  <button type="button" onClick={onCancelDelete} disabled={saving} className="rounded-lg px-3 py-2 text-sm text-zinc-600 transition-colors hover:bg-black/5 disabled:opacity-50 dark:text-zinc-300 dark:hover:bg-white/5">
                    Volver
                  </button>
                  <button type="button" onClick={onConfirmDelete} disabled={saving} className="rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-500 disabled:opacity-50">
                    {saving ? "Eliminando..." : "Eliminar categoría"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}


function AddCategoryModal({ open, onClose, form, setForm, saving, onSubmit }: { open: boolean; onClose: () => void; form: CreateCategoryRequest; setForm: React.Dispatch<React.SetStateAction<CreateCategoryRequest>>; saving: boolean; onSubmit: (e: FormEvent<HTMLFormElement>) => void; }) {
  return (
    <Modal open={open} onClose={onClose} title="Nueva Categoría" kicker="Catálogo" panelClassName="max-w-md">
      <form className="flex flex-col gap-4" onSubmit={onSubmit}>
        <div className="space-y-3">
          <input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} required placeholder="Nombre de categoría" className="w-full bg-zinc-50 dark:bg-black/40 border border-black/10 dark:border-white/10 rounded-lg p-2.5 text-sm text-zinc-900 dark:text-zinc-200 focus:outline-none focus:border-accent-500/50 focus:ring-1 focus:ring-accent-500/50 transition-all font-mono" />
          <textarea value={form.description || ""} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} rows={3} placeholder="Descripción" className="description-textarea w-full bg-zinc-50 dark:bg-black/40 border border-black/10 dark:border-white/10 rounded-lg p-2.5 text-sm text-zinc-900 dark:text-zinc-200 focus:outline-none focus:border-accent-500/50 focus:ring-1 focus:ring-accent-500/50 transition-all font-mono" />
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
            <input value={form.short_name || ""} onChange={(event) => setForm((current) => ({ ...current, short_name: event.target.value }))} placeholder="Nombre comercial" className="w-1/3 bg-zinc-50 dark:bg-black/40 border border-black/10 dark:border-white/10 rounded-lg p-2.5 text-sm text-zinc-900 dark:text-zinc-200 focus:outline-none focus:border-accent-500/50 focus:ring-1 focus:ring-accent-500/50 transition-all font-mono" />
          </div>
          <div className="flex gap-3">
            <select value={form.component_type} onChange={(event) => setForm((current) => ({ ...current, component_type: event.target.value }))} className="w-1/2 bg-zinc-50 dark:bg-zinc-900 border border-black/10 dark:border-white/10 rounded-lg p-2.5 text-sm text-zinc-900 dark:text-zinc-200 focus:outline-none focus:border-accent-500/50 focus:ring-1 focus:ring-accent-500/50 transition-all font-mono">
              <option value="item">Ítem</option>
              <option value="accessory">Accesorio</option>
            </select>
            <input value={form.unit_type || ""} onChange={(event) => setForm((current) => ({ ...current, unit_type: event.target.value }))} placeholder="Unidad (m2, set)" className="w-1/2 bg-zinc-50 dark:bg-black/40 border border-black/10 dark:border-white/10 rounded-lg p-2.5 text-sm text-zinc-900 dark:text-zinc-200 focus:outline-none focus:border-accent-500/50 focus:ring-1 focus:ring-accent-500/50 transition-all font-mono" />
          </div>
          <textarea value={form.description || ""} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} rows={2} placeholder="Descripción" className="description-textarea w-full bg-zinc-50 dark:bg-black/40 border border-black/10 dark:border-white/10 rounded-lg p-2.5 text-sm text-zinc-900 dark:text-zinc-200 focus:outline-none focus:border-accent-500/50 focus:ring-1 focus:ring-accent-500/50 transition-all font-mono" />
          <textarea value={form.short_description || ""} onChange={(event) => setForm((current) => ({ ...current, short_description: event.target.value }))} rows={2} placeholder="Descripción comercial" className="description-textarea w-full bg-zinc-50 dark:bg-black/40 border border-black/10 dark:border-white/10 rounded-lg p-2.5 text-sm text-zinc-900 dark:text-zinc-200 focus:outline-none focus:border-accent-500/50 focus:ring-1 focus:ring-accent-500/50 transition-all font-mono" />
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

export function CatalogPage({ categoryId, onNavigate }: CatalogPageProps) {
  const [data, setData] = useState<CatalogPageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [focusedComponentId, setFocusedComponentId] = useState<number | null>(() => {
    const match = window.location.hash.match(/^#component-(\d+)$/);
    return match ? Number(match[1]) : null;
  });
  const [categoryForm, setCategoryForm] = useState<CreateCategoryRequest>(initialCategoryForm);
  const [componentForm, setComponentForm] = useState<CreateComponentRequest>(initialComponentForm);
  const [selectedLinks, setSelectedLinks] = useState<number[]>([]);
  const [savingLinks, setSavingLinks] = useState(false);
  const [categoryActionTarget, setCategoryActionTarget] = useState<CategoryActionTarget | null>(null);
  const [categoryActionName, setCategoryActionName] = useState("");
  const [categoryDeletionImpact, setCategoryDeletionImpact] = useState<CatalogCategoryDeletionImpact | null>(null);
  const [categoryActionSaving, setCategoryActionSaving] = useState(false);
  const [categoryActionError, setCategoryActionError] = useState<string | null>(null);

  const [savingCategory, setSavingCategory] = useState(false);
  const [savingComponent, setSavingComponent] = useState(false);
  
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [componentModalOpen, setComponentModalOpen] = useState(false);
  const [linksModalOpen, setLinksModalOpen] = useState(false);
  const [typeFilter, setTypeFilter] = useState<"all" | "item" | "accessory">("all");
  const [componentFilter, setComponentFilter] = useState("");


  // Only the latest request may update the page: fast category clicks can
  // otherwise land out of order.
  const loadRequest = useRef(0);

  async function loadCatalog() {
    const request = ++loadRequest.current;
    setLoading(true);
    setError(null);
    try {
      const next = await api.getCatalog(categoryId);
      if (request === loadRequest.current) setData(next);
    } catch (err) {
      if (request !== loadRequest.current) return;
      const message = err instanceof ApiError ? err.message : "No se pudo cargar el catálogo.";
      setError(message);
    } finally {
      if (request === loadRequest.current) setLoading(false);
    }
  }

  useEffect(() => {
    void loadCatalog();
    setComponentFilter("");
  }, [categoryId]);

  useEffect(() => {
    if (!focusedComponentId || data?.selected?.id !== categoryId) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(`component-${focusedComponentId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [categoryId, data?.selected?.id, focusedComponentId]);

  useEffect(() => {
    setSelectedLinks(data?.selected?.linked_category_ids || []);
    if (data?.selected) {
      setCategoryForm((current) => ({ ...current, parent_id: data.selected?.id || null }));
      setComponentForm((current) => ({ ...current, category_id: data.selected?.id || 0 }));
    }
  }, [data?.selected]);

  async function handleCreateCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!data?.selected) {
      return;
    }
    setSavingCategory(true);
    setError(null);
    try {
      const result = await api.createCategory({
        ...categoryForm,
        parent_id: data.selected.id,
      });
      setCategoryForm((current) => ({ ...initialCategoryForm, parent_id: current.parent_id }));
      setCategoryModalOpen(false);
      if (result.category_id) {
        onNavigate(`/catalog?category_id=${result.category_id}`);
      } else {
        await loadCatalog();
      }
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "No se pudo crear la categoría.";
      setError(message);
    } finally {
      setSavingCategory(false);
    }
  }

  async function handleCreateComponent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!data?.selected) {
      return;
    }
    setSavingComponent(true);
    setError(null);
    try {
      const result = await api.createComponent({
        ...componentForm,
        category_id: data.selected.id,
      });
      setComponentForm((current) => ({ ...initialComponentForm, category_id: current.category_id }));
      setComponentModalOpen(false);
      if (result.component) {
        setData((current) => (current ? upsertSelectedComponent(current, result.component as CatalogComponent) : current));
      }
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "No se pudo crear el componente.";
      setError(message);
    } finally {
      setSavingComponent(false);
    }
  }

  async function handleSaveLinks() {
    if (!data?.selected) {
      return;
    }
    setSavingLinks(true);
    setError(null);
    try {
      await api.updateCategoryLinks(data.selected.id, selectedLinks);
      setLinksModalOpen(false);
      setData((current) => (current ? patchSelectedLinks(current, selectedLinks) : current));
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "No se pudieron guardar las reglas de categorías vinculadas.";
      setError(message);
    } finally {
      setSavingLinks(false);
    }
  }

  function openCategoryActions(target: CategoryActionTarget) {
    setCategoryActionTarget(target);
    setCategoryActionName(target.name);
    setCategoryDeletionImpact(null);
    setCategoryActionError(null);
  }

  function closeCategoryActions() {
    if (categoryActionSaving) {
      return;
    }
    setCategoryActionTarget(null);
    setCategoryDeletionImpact(null);
    setCategoryActionError(null);
  }

  async function handleRenameCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!categoryActionTarget || !categoryActionName.trim()) {
      return;
    }
    setCategoryActionSaving(true);
    setCategoryActionError(null);
    try {
      await api.updateCategory(categoryActionTarget.id, { name: categoryActionName.trim() });
      setCategoryActionTarget(null);
      setCategoryDeletionImpact(null);
      await loadCatalog();
    } catch (err) {
      setCategoryActionError(err instanceof ApiError ? err.message : "No se pudo renombrar la categoría.");
    } finally {
      setCategoryActionSaving(false);
    }
  }

  async function finishCategoryDeletion(impact: CatalogCategoryDeletionImpact, confirmCascade: boolean) {
    if (!categoryActionTarget) {
      return;
    }
    const result = await api.deleteCategory(categoryActionTarget.id, confirmCascade);
    const selectedWasDeleted = Boolean(selected && impact.affected_category_ids.includes(selected.id));
    setCategoryActionTarget(null);
    setCategoryDeletionImpact(null);
    if (selectedWasDeleted) {
      onNavigate(result.category_id ? `/catalog?category_id=${result.category_id}` : "/catalog");
    } else {
      await loadCatalog();
    }
  }

  async function handleInspectCategoryDeletion() {
    if (!categoryActionTarget) {
      return;
    }
    setCategoryActionSaving(true);
    setCategoryActionError(null);
    try {
      const impact = await api.getCategoryDeletionImpact(categoryActionTarget.id);
      if (impact.requires_confirmation) {
        setCategoryDeletionImpact(impact);
      } else {
        await finishCategoryDeletion(impact, false);
      }
    } catch (err) {
      setCategoryActionError(err instanceof ApiError ? err.message : "No se pudo comprobar el impacto de la eliminación.");
    } finally {
      setCategoryActionSaving(false);
    }
  }

  async function handleConfirmCategoryDeletion() {
    if (!categoryDeletionImpact) {
      return;
    }
    setCategoryActionSaving(true);
    setCategoryActionError(null);
    try {
      await finishCategoryDeletion(categoryDeletionImpact, true);
    } catch (err) {
      setCategoryActionError(err instanceof ApiError ? err.message : "No se pudo eliminar la categoría.");
    } finally {
      setCategoryActionSaving(false);
    }
  }

  const selected = data?.selected || null;

  function selectCategory(nextCategoryId: number) {
    setFocusedComponentId(null);
    onNavigate(`/catalog?category_id=${nextCategoryId}`);
  }

  function selectComponent(nextCategoryId: number, componentId: number) {
    setFocusedComponentId(componentId);
    setSearchTerm("");
    onNavigate(`/catalog?category_id=${nextCategoryId}#component-${componentId}`);
  }

  // The previous category stays on screen while the next one loads.
  const refreshing = loading && data !== null;
  const pendingCategory = refreshing && categoryId !== null && selected?.id !== categoryId;
  const path = selected && data ? categoryPath(data.tree, selected.id) : [];
  const filteredComponents = selected
    ? selected.components.filter((component) =>
        (typeFilter === "all" || component.type === typeFilter) &&
        matchesSearchText(componentFilter, component.name, component.short_name, ...component.material_rules.map((rule) => rule.sku), ...component.material_rules.map((rule) => rule.material_name)),
      )
    : [];

  return (
    <section className="absolute inset-0 top-16 flex flex-col overflow-auto bg-white text-zinc-800 dark:bg-zinc-950 dark:text-zinc-200 lg:overflow-hidden" aria-busy={loading}>
      {refreshing ? <div aria-hidden="true" className="absolute inset-x-0 top-0 z-20 h-0.5 animate-pulse bg-red-600" /> : null}
      <h1 className="sr-only">Editor de base de datos</h1>
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <aside className="flex shrink-0 flex-col border-b border-black/10 dark:border-white/10 lg:w-[300px] lg:border-b-0 lg:border-r xl:w-[340px]" aria-label="Taxonomía">
          <div className="shrink-0 border-b border-black/10 px-4 py-2 dark:border-white/10">
            <label htmlFor="catalog-search" className="mb-1 block text-[10px] uppercase tracking-wider text-zinc-500">Taxonomía</label>
            <SearchField
              value={searchTerm}
              onChange={setSearchTerm}
              placeholder="Buscar categoría, ítem o SKU…"
              className="relative"
              inputClassName={`${control} w-full pr-14 text-xs`}
            />
          </div>
          <nav className="max-h-72 min-h-0 flex-1 overflow-y-auto py-1 lg:max-h-none">
            {data ? (
              data.tree.some((node) => treeMatches(node, searchTerm)) ? (
                <CatalogTree
                  nodes={data.tree}
                  selectedCategoryId={categoryId ?? selected?.id ?? null}
                  filterTerm={searchTerm}
                  onSelect={selectCategory}
                  onSelectComponent={selectComponent}
                  onManageCategory={openCategoryActions}
                />
              ) : (
                <p className="px-4 py-3 text-xs text-zinc-500">No hay categorías, ítems ni accesorios que coincidan.</p>
              )
            ) : (
              <p className="px-4 py-3 text-xs text-zinc-500" role="status">
                <i className="ph ph-circle-notch mr-1 animate-spin align-[-1px]" aria-hidden="true" />Cargando categorías…
              </p>
            )}
          </nav>
          <div className="grid shrink-0 grid-cols-3 border-t border-black/10 dark:border-white/10" aria-label="Alcance total">
            {[
              ["Categorías", data?.summary.categories],
              ["Componentes", data?.summary.components],
              ["Materiales", data?.summary.materials],
            ].map(([label, value]) => (
              <div key={label} className="min-w-0 border-r border-black/10 px-4 py-2 last:border-r-0 dark:border-white/10">
                <p className="truncate text-[10px] uppercase tracking-wider text-zinc-500">{label}</p>
                <p className={`font-mono text-base font-semibold tabular-nums ${value === undefined ? "animate-pulse opacity-40" : ""}`}>{value ?? "—"}</p>
              </div>
            ))}
          </div>
        </aside>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {error ? (
            <div role="alert" className="shrink-0 border-b border-red-200 bg-red-50 px-6 py-2 text-xs text-red-800 dark:bg-red-950/20 dark:text-red-300">
              {error} <button type="button" onClick={() => void loadCatalog()} className="underline">Reintentar</button>
            </div>
          ) : null}

          {!data && loading ? (
            <div className="m-auto p-8 text-sm text-zinc-500" role="status">Cargando catálogo…</div>
          ) : selected && data ? (
            <>
              <header className="shrink-0 border-b border-black/10 px-4 py-2 dark:border-white/10 md:px-6">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div className="min-w-0">
                    <nav aria-label="Ruta" className="mb-1 flex min-w-0 items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-500">
                      {path.slice(0, -1).map((node) => (
                        <span key={node.id} className="flex min-w-0 items-center gap-1">
                          <button type="button" className="truncate hover:text-zinc-950 hover:underline dark:hover:text-white" onClick={() => selectCategory(node.id)}>{node.name}</button>
                          <i className="ph ph-caret-right" aria-hidden="true" />
                        </span>
                      ))}
                      <span>{scopeLabels[selected.scope] ?? selected.scope}</span>
                    </nav>
                    <h2 className={`flex items-center gap-2 truncate text-lg font-semibold text-zinc-950 transition-opacity dark:text-white ${pendingCategory ? "opacity-40" : ""}`}>
                      {selected.name}
                      <button type="button" onClick={() => openCategoryActions(selected)} title="Editar categoría" aria-label={`Editar o eliminar ${selected.name}`}
                        className="flex h-6 w-6 items-center justify-center text-sm font-normal text-zinc-500 hover:bg-black/5 hover:text-zinc-950 dark:hover:bg-white/10 dark:hover:text-white">
                        <i className="ph ph-pencil-simple" aria-hidden="true" />
                      </button>
                    </h2>
                    {selected.description ? <p className="truncate text-xs text-zinc-500" title={selected.description}>{selected.description}</p> : null}
                  </div>
                  <div className="flex items-center gap-2">
                    {refreshing ? (
                      <span role="status" className="flex items-center gap-1.5 text-xs text-zinc-500">
                        <i className="ph ph-circle-notch animate-spin" aria-hidden="true" />Cargando {pendingCategory ? "categoría" : "catálogo"}…
                      </span>
                    ) : null}
                    <button type="button" onClick={() => setCategoryModalOpen(true)} disabled={pendingCategory} className={`${control} flex items-center gap-1.5 text-xs`}>
                      <i className="ph-bold ph-folder-plus" aria-hidden="true" /> Nueva subcategoría
                    </button>
                    <button type="button" onClick={() => setComponentModalOpen(true)} disabled={pendingCategory} className={`${primaryButton} flex items-center gap-1.5`}>
                      <i className="ph-bold ph-plus" aria-hidden="true" /> Nuevo componente
                    </button>
                  </div>
                </div>
              </header>

              <div className="grid shrink-0 border-b border-black/10 dark:border-white/10 sm:grid-cols-2">
                <div className="min-w-0 border-b border-black/10 px-4 py-2 dark:border-white/10 sm:border-b-0 sm:border-r md:px-6">
                  <p className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">Subcategorías</p>
                  <div className="flex flex-wrap gap-1">
                    {selected.child_categories.length ? (
                      selected.child_categories.map((child) => (
                        <button key={child.id} type="button" onClick={() => selectCategory(child.id)}
                          className="flex items-center gap-1.5 border border-black/10 px-2 py-1 text-xs hover:border-black/30 hover:bg-black/[0.03] dark:border-white/10 dark:hover:border-white/30 dark:hover:bg-white/[0.03]">
                          {child.name} <span className="text-[10px] text-zinc-500">{scopeLabels[child.scope] ?? child.scope}</span>
                        </button>
                      ))
                    ) : (
                      <p className="py-1 text-xs text-zinc-500">No hay subcategorías.</p>
                    )}
                  </div>
                </div>
                <div className="min-w-0 px-4 py-2 md:px-6">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <p className="text-[10px] uppercase tracking-wider text-zinc-500">Categorías vinculadas</p>
                    <button type="button" onClick={() => setLinksModalOpen(true)} disabled={pendingCategory} className="text-[10px] text-zinc-500 underline hover:text-zinc-950 disabled:opacity-50 dark:hover:text-white">Editar</button>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {selected.linked_categories.length ? (
                      selected.linked_categories.map((category) => (
                        <span key={category.id} className="flex items-center gap-1 border border-black/10 px-2 py-1 text-xs text-zinc-600 dark:border-white/10 dark:text-zinc-400">
                          <i className="ph ph-link text-zinc-400" aria-hidden="true" />{category.name}
                        </span>
                      ))
                    ) : (
                      <p className="py-1 text-xs text-zinc-500">Ninguna</p>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-black/10 px-4 py-2 dark:border-white/10 md:px-6">
                <h3 className="mr-2 text-xs font-semibold">Componentes <span className="font-normal text-zinc-500">({selected.components.length})</span></h3>
                <div role="group" aria-label="Tipo" className="flex">
                  {([["all", "Todos"], ["item", "Ítems"], ["accessory", "Accesorios"]] as const).map(([value, label], index) => (
                    <button key={value} type="button" aria-pressed={typeFilter === value} onClick={() => setTypeFilter(value)}
                      className={`border border-black/15 px-3 py-2 text-xs outline-none focus:border-red-600 focus:ring-1 focus:ring-red-600 dark:border-white/15 ${index ? "-ml-px" : ""} ${typeFilter === value ? "bg-zinc-950 text-white dark:bg-white dark:text-zinc-950" : "bg-white text-zinc-900 hover:bg-black/5 dark:bg-zinc-900 dark:text-white dark:hover:bg-white/5"}`}>{label}</button>
                  ))}
                </div>
                <input type="search" aria-label="Filtrar componentes" placeholder="Filtrar por nombre, SKU o material…" value={componentFilter}
                  onChange={(event) => setComponentFilter(event.target.value)} className={`${control} min-w-[7rem] flex-1 basis-40 text-xs`} />
              </div>

              <div className={`min-h-[300px] shrink-0 overflow-auto transition-opacity lg:min-h-0 lg:flex-1 ${pendingCategory ? "pointer-events-none opacity-40" : ""}`}>
                {filteredComponents.length ? (
                  filteredComponents.map((component) => (
                    <ComponentCard
                      key={component.id}
                      component={component}
                      focused={focusedComponentId === component.id}
                      onComponentSaved={(nextComponent) =>
                        setData((current) => (current ? upsertSelectedComponent(current, nextComponent) : current))
                      }
                      onComponentDeleted={(componentId) =>
                        setData((current) => (current ? removeSelectedComponent(current, componentId) : current))
                      }
                    />
                  ))
                ) : (
                  <p className="p-12 text-center text-sm text-zinc-500">
                    {selected.components.length ? "No hay componentes que coincidan con estos filtros." : "Aún no hay componentes en esta categoría."}
                  </p>
                )}
              </div>
              <footer className="flex shrink-0 flex-wrap justify-between gap-2 border-t border-black/10 px-6 py-2 text-[10px] text-zinc-500 dark:border-white/10">
                <span>{filteredComponents.length} de {selected.components.length} componentes</span>
                <span>Haz clic en un componente para editarlo · Ctrl K busca en toda la taxonomía</span>
              </footer>
              <AddCategoryModal open={categoryModalOpen} onClose={() => setCategoryModalOpen(false)} form={categoryForm} setForm={setCategoryForm} saving={savingCategory} onSubmit={handleCreateCategory} />
              <AddComponentModal open={componentModalOpen} onClose={() => setComponentModalOpen(false)} form={componentForm} setForm={setComponentForm} saving={savingComponent} onSubmit={handleCreateComponent} />
              <ManageLinksModal open={linksModalOpen} onClose={() => setLinksModalOpen(false)} targets={data.link_targets} selectedLinks={selectedLinks} setSelectedLinks={setSelectedLinks} saving={savingLinks} onSave={() => void handleSaveLinks()} />
            </>
          ) : (
            <div className="m-auto p-8 text-center text-sm text-zinc-500">Selecciona una categoría en la taxonomía.</div>
          )}
        </div>
      </div>
      <CategoryActionsModal
        target={categoryActionTarget}
        name={categoryActionName}
        setName={setCategoryActionName}
        impact={categoryDeletionImpact}
        saving={categoryActionSaving}
        error={categoryActionError}
        onClose={closeCategoryActions}
        onRename={handleRenameCategory}
        onInspectDelete={() => void handleInspectCategoryDeletion()}
        onConfirmDelete={() => void handleConfirmCategoryDeletion()}
        onCancelDelete={() => {
          setCategoryDeletionImpact(null);
          setCategoryActionError(null);
        }}
      />
    </section>
  );
}
