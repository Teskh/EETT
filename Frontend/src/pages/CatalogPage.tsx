import { FormEvent, useEffect, useState } from "react";

import { CatalogAttributeEditor } from "../components/CatalogAttributeEditor";
import { CatalogMaterialRuleEditor } from "../components/CatalogMaterialRuleEditor";
import { ApiError, api } from "../lib/api";
import type {
  CatalogAttribute,
  CatalogComponent,
  CatalogMaterialRule,
  CatalogPageData,
  CatalogTreeNode,
  CreateCategoryRequest,
  CreateComponentRequest,
  UpdateComponentRequest,
} from "../lib/types";

type CatalogPageProps = {
  categoryId: number | null;
  onNavigate: (to: string) => void;
};

type ComponentCardProps = {
  component: CatalogComponent;
  onComponentSaved: (component: CatalogComponent) => void;
  onComponentDeleted: (componentId: number) => void;
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

function formatCondition(rule: CatalogMaterialRule) {
  if (!rule.conditions.length) {
    return <span className="text-zinc-500 text-xs italic">Always applies</span>;
  }
  return rule.conditions.map((group) => {
    const clauses = group.clauses
      .map((clause) =>
        [clause.attribute_name, clause.operator, clause.comparison_value, clause.comparison_value_secondary]
          .filter(Boolean)
          .join(" "),
      )
      .join(" AND ");
    return (
      <span key={`${rule.sku}-${group.group}`} className="px-1.5 py-0.5 bg-white dark:bg-black/40 border border-black/5 dark:border-white/5 rounded text-[10px] font-mono text-zinc-600 dark:text-zinc-400">
        {group.group}: {clauses}
      </span>
    );
  });
}

function treeMatches(node: CatalogTreeNode, term: string): boolean {
  if (!term) {
    return true;
  }
  if (node.name.toLowerCase().includes(term)) {
    return true;
  }
  return node.children.some((child) => treeMatches(child, term));
}

function CatalogTree({
  nodes,
  selectedCategoryId,
  filterTerm,
  onSelect,
  depth = 0,
}: {
  nodes: CatalogTreeNode[];
  selectedCategoryId: number | null;
  filterTerm: string;
  onSelect: (categoryId: number) => void;
  depth?: number;
}) {
  return (
    <ul className={depth === 0 ? "space-y-1" : "ml-5 border-l border-black/10 dark:border-white/10 mt-1 pl-3 space-y-1"}>
      {nodes
        .filter((node) => treeMatches(node, filterTerm))
        .map((node) => {
          const active = node.id === selectedCategoryId;
          return (
            <li key={node.id}>
              {depth === 0 ? (
                <button
                  type="button"
                  onClick={() => onSelect(node.id)}
                  className={`w-full flex items-center justify-between text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                    active
                      ? "bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/5 text-zinc-900 dark:text-zinc-200 font-medium"
                      : "hover:bg-black/5 dark:hover:bg-white/5 border border-transparent text-zinc-600 dark:text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-300"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <i className={`${active ? "ph-fill ph-folder-open text-accent-600 dark:text-accent-400" : "ph-fill ph-folder text-zinc-400 dark:text-zinc-500"}`} />
                    {node.name}
                  </span>
                  <span className="font-mono text-[10px] text-zinc-500">{node.component_count} items</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => onSelect(node.id)}
                  className={`w-full block text-left px-2 py-1 text-sm transition-colors relative before:absolute before:w-2 before:h-px before:-left-3 before:top-1/2 ${
                    active
                      ? "text-accent-600 dark:text-accent-400 font-semibold before:bg-accent-600/50 dark:before:bg-accent-400/50"
                      : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 before:bg-black/10 dark:before:bg-white/10"
                  }`}
                >
                  {node.name}
                </button>
              )}
              {node.children.length ? (
                <CatalogTree
                  nodes={node.children}
                  selectedCategoryId={selectedCategoryId}
                  filterTerm={filterTerm}
                  onSelect={onSelect}
                  depth={depth + 1}
                />
              ) : null}
            </li>
          );
        })}
    </ul>
  );
}

function ComponentCard({ component, onComponentSaved, onComponentDeleted }: ComponentCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [attributeSaving, setAttributeSaving] = useState(false);
  const [materialSaving, setMaterialSaving] = useState(false);
  const [materialEditorOpen, setMaterialEditorOpen] = useState(false);
  const [form, setForm] = useState<UpdateComponentRequest>({
    name: component.name,
    short_name: component.short_name || "",
    description: component.description || "",
    short_description: component.short_description || "",
    installation: component.installation || "",
    unit_type: component.unit_type || "",
    component_type: component.type,
  });

  useEffect(() => {
    setForm({
      name: component.name,
      short_name: component.short_name || "",
      description: component.description || "",
      short_description: component.short_description || "",
      installation: component.installation || "",
      unit_type: component.unit_type || "",
      component_type: component.type,
    });
  }, [component]);

  async function handleSaveComponent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    try {
      const result = await api.updateComponent(component.id, form);
      if (result.component) {
        onComponentSaved(result.component);
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteComponent() {
    const confirmed = window.confirm("Delete this catalog component?");
    if (!confirmed) {
      return;
    }
    setSaving(true);
    try {
      await api.deleteComponent(component.id);
      onComponentDeleted(component.id);
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveAttributes(scope: string, attributes: CatalogAttribute[]) {
    setAttributeSaving(true);
    try {
      const result = await api.replaceComponentAttributes(component.id, scope, attributes);
      if (result.component) {
        onComponentSaved(result.component);
      }
    } finally {
      setAttributeSaving(false);
    }
  }

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

  return (
    <div className="border-b border-black/10 dark:border-white/10 last:border-0">
      <div 
        className="flex items-center justify-between p-4 bg-white dark:bg-black/20 shadow-sm group hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors cursor-pointer"
        onClick={() => setExpanded((current) => !current)}
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded bg-zinc-50 dark:bg-white/5 border border-black/10 dark:border-white/10 flex items-center justify-center text-zinc-600 dark:text-zinc-400">
            <i className={`ph-fill ${component.type === "accessory" ? "ph-flask" : "ph-wall"}`} />
          </div>
          <div>
            <div className="font-bold text-zinc-900 dark:text-white text-[15px] flex items-center gap-2">
              {component.name}
              <span className="px-2 py-0.5 border border-black/10 dark:border-white/10 bg-white dark:bg-black/40 rounded text-[10px] font-mono text-zinc-500 align-middle ml-2">
                {component.short_name || ""}
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span
            className={`px-2 py-1 text-[10px] font-bold uppercase tracking-widest border rounded ${
              component.type === "accessory"
                ? "bg-white dark:bg-white/10 shadow-sm text-zinc-800 dark:text-zinc-300 border-black/20 dark:border-white/20"
                : "bg-white dark:bg-black/40 text-zinc-600 dark:text-zinc-400 border-black/10 dark:border-white/10"
            }`}
          >
            {component.type === "accessory" ? "ACCESSORY" : "ITEM"}
          </span>
          <div
            className="px-3 py-1.5 text-xs font-semibold text-zinc-800 dark:text-zinc-300 border border-black/10 dark:border-white/10 bg-zinc-50 dark:bg-white/5 group-hover:bg-zinc-100 dark:group-hover:bg-white/10 rounded transition-colors flex items-center gap-2"
          >
            <i className={`ph-bold ${expanded ? "ph-caret-up" : "ph-caret-down"}`} /> Details
          </div>
        </div>
      </div>
      {expanded ? (
        <div className="border-t border-black/5 dark:border-white/5 bg-white dark:bg-black/40 p-4">
          <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-6">{component.description || "No description provided."}</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            <div className="flex flex-col gap-4">
              <form className="bg-zinc-50 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-lg p-4 flex flex-col gap-3" onSubmit={handleSaveComponent}>
                <h6 className="text-xs font-bold text-zinc-800 dark:text-zinc-300 uppercase tracking-widest flex items-center gap-2">
                  <i className="ph-bold ph-pencil-simple text-zinc-500" /> Edit Component
                </h6>
                <div className="flex gap-2">
                  <input
                    value={form.name}
                    onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                    required
                    placeholder="Name"
                    className="w-2/3 bg-white dark:bg-black/40 border border-black/10 dark:border-white/10 rounded p-1.5 text-xs text-zinc-900 dark:text-zinc-200 focus:outline-none focus:border-accent-500/50 transition-colors font-mono"
                  />
                  <input
                    value={form.short_name || ""}
                    onChange={(event) => setForm((current) => ({ ...current, short_name: event.target.value }))}
                    placeholder="SKU"
                    className="w-1/3 bg-white dark:bg-black/40 border border-black/10 dark:border-white/10 rounded p-1.5 text-xs text-zinc-900 dark:text-zinc-200 focus:outline-none focus:border-accent-500/50 transition-colors font-mono"
                  />
                </div>
                <div className="flex gap-2">
                  <select
                    value={form.component_type}
                    onChange={(event) => setForm((current) => ({ ...current, component_type: event.target.value }))}
                    className="w-1/2 bg-white dark:bg-black/40 border border-black/10 dark:border-white/10 rounded p-1.5 text-xs text-zinc-900 dark:text-zinc-200 focus:outline-none focus:border-accent-500/50 transition-colors font-mono"
                  >
                    <option value="item">Item</option>
                    <option value="accessory">Accessory</option>
                  </select>
                  <input
                    value={form.unit_type || ""}
                    onChange={(event) => setForm((current) => ({ ...current, unit_type: event.target.value }))}
                    placeholder="Unit type"
                    className="w-1/2 bg-white dark:bg-black/40 border border-black/10 dark:border-white/10 rounded p-1.5 text-xs text-zinc-900 dark:text-zinc-200 focus:outline-none focus:border-accent-500/50 transition-colors font-mono"
                  />
                </div>
                <textarea
                  value={form.description || ""}
                  onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                  rows={2}
                  placeholder="Description"
                  className="w-full bg-white dark:bg-black/40 border border-black/10 dark:border-white/10 rounded p-1.5 text-xs text-zinc-900 dark:text-zinc-200 focus:outline-none focus:border-accent-500/50 transition-colors font-mono"
                />
                <textarea
                  value={form.short_description || ""}
                  onChange={(event) => setForm((current) => ({ ...current, short_description: event.target.value }))}
                  rows={2}
                  placeholder="Short description"
                  className="w-full bg-white dark:bg-black/40 border border-black/10 dark:border-white/10 rounded p-1.5 text-xs text-zinc-900 dark:text-zinc-200 focus:outline-none focus:border-accent-500/50 transition-colors font-mono"
                />
                <textarea
                  value={form.installation || ""}
                  onChange={(event) => setForm((current) => ({ ...current, installation: event.target.value }))}
                  rows={2}
                  placeholder="Installation"
                  className="w-full bg-white dark:bg-black/40 border border-black/10 dark:border-white/10 rounded p-1.5 text-xs text-zinc-900 dark:text-zinc-200 focus:outline-none focus:border-accent-500/50 transition-colors font-mono"
                />
                <div className="flex justify-between items-center mt-2">
                  <button className="px-3 py-1.5 bg-white dark:bg-white/10 shadow-sm hover:bg-zinc-50 dark:hover:bg-white/20 text-zinc-900 dark:text-white rounded text-xs font-semibold transition-colors" type="submit" disabled={saving}>
                    {saving ? "Saving..." : "Save changes"}
                  </button>
                </div>
              </form>

              <div className="flex items-center justify-between bg-red-100 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-lg p-3">
                <span className="text-[10px] text-red-700 dark:text-red-400 font-mono">Deletion blocked if in use.</span>
                <button className="px-2 py-1 bg-red-200 dark:bg-red-500/20 hover:bg-red-300 dark:bg-red-500/30 text-red-700 dark:text-red-300 rounded text-xs font-semibold transition-colors flex items-center gap-1" type="button" onClick={() => void handleDeleteComponent()}>
                  <i className="ph-bold ph-trash" /> Delete
                </button>
              </div>
            </div>

            <div>
              <div className="space-y-5">
                <div>
                  <h6 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-3 flex items-center gap-2">
                    <i className="ph-bold ph-list-dashes text-zinc-600" /> Base Attributes
                  </h6>
                  <CatalogAttributeEditor
                    initialAttributes={component.base_attributes}
                    saving={attributeSaving}
                    onSave={(attributes) => handleSaveAttributes("base", attributes)}
                  />
                </div>
                <div>
                  <h6 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-3 flex items-center gap-2">
                    <i className="ph-bold ph-flow-arrow text-zinc-600" /> Usage Attributes
                  </h6>
                  <CatalogAttributeEditor
                    initialAttributes={component.usage_attributes}
                    saving={attributeSaving}
                    onSave={(attributes) => handleSaveAttributes("usage", attributes)}
                  />
                </div>
              </div>
            </div>
          </div>

          <div>
            <div className="mb-3 flex items-center justify-between gap-3">
              <h6 className="text-xs font-bold text-zinc-500 uppercase tracking-widest flex items-center gap-2">
                <i className="ph-bold ph-boxes text-zinc-600" /> Material Rules
              </h6>
              <button
                type="button"
                onClick={() => setMaterialEditorOpen(true)}
                className="px-3 py-1.5 border border-black/10 dark:border-white/10 bg-white dark:bg-white/5 hover:bg-zinc-50 dark:hover:bg-white/10 rounded text-xs font-semibold text-zinc-900 dark:text-zinc-200 transition-colors flex items-center gap-2"
              >
                <i className="ph-bold ph-sliders-horizontal" />
                Manage materials
              </button>
            </div>
            <table className="w-full text-left border-collapse text-sm border border-black/10 dark:border-white/10 rounded overflow-hidden">
              <thead className="bg-white dark:bg-black/60 border-b border-black/10 dark:border-white/10">
                <tr>
                  <th className="px-3 py-2 text-zinc-500 font-medium w-1/3">Material</th>
                  <th className="px-3 py-2 text-zinc-500 font-medium w-1/4">SKU / Unit</th>
                  <th className="px-3 py-2 text-zinc-500 font-medium text-right w-1/4">Qty Per Unit</th>
                  <th className="px-3 py-2 text-zinc-500 font-medium text-right">Conditions</th>
                </tr>
              </thead>
              <tbody className="bg-zinc-50 dark:bg-white/5 divide-y divide-white/5">
                {component.material_rules.length ? (
                  component.material_rules.map((rule) => (
                    <tr key={`${rule.sku}-${rule.material_name}`} className="group hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors">
                      <td className="px-3 py-3 text-zinc-900 dark:text-zinc-200 font-medium text-sm flex flex-col gap-1">
                        {rule.material_name}
                        <span className="text-[10px] text-zinc-500 font-mono">{rule.notes || ""}</span>
                      </td>
                      <td className="px-3 py-3 text-zinc-500 font-mono text-xs">
                        {rule.sku} <br /> ({rule.unit || "-"})
                      </td>
                      <td className="px-3 py-3 text-right font-mono text-sm text-accent-700 dark:text-accent-400">
                        {rule.unit_qty_per_unit ?? "n/a"}
                      </td>
                      <td className="px-3 py-3 text-right">
                        <div className="flex flex-wrap justify-end gap-1">{formatCondition(rule)}</div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4} className="py-4 text-center text-zinc-500 font-mono text-xs">
                      No material rules defined.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
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

function updateTreeComponentCount(nodes: CatalogTreeNode[], categoryId: number, delta: number): CatalogTreeNode[] {
  return nodes.map((node) => ({
    ...node,
    component_count: node.id === categoryId ? Math.max(0, node.component_count + delta) : node.component_count,
    children: updateTreeComponentCount(node.children, categoryId, delta),
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
    tree: exists ? data.tree : updateTreeComponentCount(data.tree, nextComponent.category_id, 1),
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
    tree: updateTreeComponentCount(data.tree, data.selected.id, -1),
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

export function CatalogPage({ categoryId, onNavigate }: CatalogPageProps) {
  const [data, setData] = useState<CatalogPageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryForm, setCategoryForm] = useState<CreateCategoryRequest>(initialCategoryForm);
  const [componentForm, setComponentForm] = useState<CreateComponentRequest>(initialComponentForm);
  const [selectedLinks, setSelectedLinks] = useState<number[]>([]);
  const [savingLinks, setSavingLinks] = useState(false);
  const [savingCategory, setSavingCategory] = useState(false);
  const [savingComponent, setSavingComponent] = useState(false);

  async function loadCatalog() {
    setLoading(true);
    setError(null);
    try {
      const next = await api.getCatalog(categoryId);
      setData(next);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Could not load catalog.";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadCatalog();
  }, [categoryId]);

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
      if (result.category_id) {
        onNavigate(`/catalog?category_id=${result.category_id}`);
      } else {
        await loadCatalog();
      }
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Could not create category.";
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
      if (result.component) {
        setData((current) => (current ? upsertSelectedComponent(current, result.component as CatalogComponent) : current));
      }
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Could not create component.";
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
      setData((current) => (current ? patchSelectedLinks(current, selectedLinks) : current));
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Could not save linked-category rules.";
      setError(message);
    } finally {
      setSavingLinks(false);
    }
  }

  const selected = data?.selected || null;

  return (
    <div className="max-w-[1600px] mx-auto grid grid-cols-1 xl:grid-cols-12 gap-6">
      <div className="xl:col-span-3 space-y-6">
        <div className="liquid-glass rounded-2xl p-4 flex flex-col h-[500px]">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xs font-bold text-zinc-500 uppercase tracking-widest flex items-center gap-2">
              <i className="ph-bold ph-tree-structure" /> Taxonomy
            </h2>
            <i className="ph-bold ph-magnifying-glass text-zinc-600" />
          </div>
          <input
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value.toLowerCase())}
            placeholder="Filter categories..."
            className="w-full bg-white dark:bg-black/40 border border-black/10 dark:border-white/10 rounded-lg py-1.5 px-3 mb-4 text-sm text-zinc-800 dark:text-zinc-300 placeholder:text-zinc-600 focus:outline-none focus:border-accent-500/50 transition-all font-mono"
          />
          <div className="flex-1 overflow-y-auto pr-2">
            {data ? (
              <CatalogTree
                nodes={data.tree}
                selectedCategoryId={selected?.id || categoryId}
                filterTerm={searchTerm}
                onSelect={(nextCategoryId) => onNavigate(`/catalog?category_id=${nextCategoryId}`)}
              />
            ) : (
              <p className="text-xs text-zinc-500 font-mono">Loading categories...</p>
            )}
          </div>
        </div>

        {data ? (
          <div className="liquid-glass rounded-2xl p-5 flex flex-col gap-4">
            <div className="flex justify-between items-end mb-2">
              <span className="text-xs text-zinc-500 uppercase tracking-widest font-bold">Total Scope</span>
              <i className="ph-bold ph-chart-bar text-zinc-600 dark:text-zinc-400" />
            </div>
            {[
              ["Categories", data.summary.categories],
              ["Components", data.summary.components],
              ["Materials", data.summary.materials],
            ].map(([label, value]) => (
              <div key={label} className="flex flex-col gap-1 border-b border-black/5 dark:border-white/5 pb-3 last:border-0 last:pb-0">
                <div className="flex justify-between items-end">
                  <span className="text-[10px] text-zinc-500 uppercase tracking-widest font-bold">{label}</span>
                </div>
                <div className="font-mono text-2xl font-bold text-zinc-900 dark:text-white tracking-tighter">{value}</div>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <div className="xl:col-span-9">
        {error ? (
          <div className="mb-4 rounded-xl border border-red-200 dark:border-red-500/20 bg-red-100 dark:bg-red-500/10 px-4 py-3 text-sm text-red-800 dark:text-red-200">{error}</div>
        ) : null}

        {loading ? (
          <div className="liquid-glass rounded-2xl p-6 text-center text-zinc-500 font-mono text-sm">Loading catalog...</div>
        ) : selected && data ? (
          <div className="flex flex-col gap-6">
            <div className="flex items-end justify-between border-b border-black/10 dark:border-white/10 pb-4">
              <div>
                <h2 className="text-2xl font-bold text-zinc-900 dark:text-white tracking-tight flex items-center gap-3">
                  {selected.name}
                  <span className="px-2 py-0.5 border border-black/10 dark:border-white/10 bg-zinc-50 dark:bg-white/5 rounded text-[10px] font-mono text-zinc-600 dark:text-zinc-400 align-middle uppercase">
                    {selected.scope}
                  </span>
                </h2>
                <p className="text-sm text-zinc-500 mt-1">{selected.description || "No description provided."}</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="liquid-glass rounded-xl p-5">
                <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-3 flex items-center gap-2">
                  <i className="ph-bold ph-folders text-zinc-600 dark:text-zinc-400" /> Children
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
                    <p className="text-xs text-zinc-500 font-mono">No child categories.</p>
                  )}
                </div>
              </div>
              <div className="liquid-glass rounded-xl p-5 border-accent-500/20">
                <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-3 flex items-center gap-2">
                  <i className="ph-bold ph-link text-accent-600 dark:text-accent-500" /> Linked Categories
                </h3>
                <div className="flex flex-wrap gap-2">
                  {selected.linked_categories.length ? (
                    selected.linked_categories.map((category) => (
                      <div key={category.id} className="px-2 py-1 bg-white dark:bg-black/40 border border-black/5 dark:border-white/5 rounded text-xs text-zinc-600 dark:text-zinc-400 font-mono">
                        {category.name}
                      </div>
                    ))
                  ) : (
                    <p className="text-xs text-zinc-500 font-mono">None</p>
                  )}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <form className="liquid-glass rounded-xl p-5 flex flex-col gap-4" onSubmit={handleCreateCategory}>
                <h3 className="text-xs font-bold text-zinc-900 dark:text-zinc-200 uppercase tracking-widest">
                  <i className="ph-bold ph-folder-plus text-zinc-600 dark:text-zinc-400 mr-2" /> Add Child Category
                </h3>
                <div className="space-y-3">
                  <input
                    value={categoryForm.name}
                    onChange={(event) => setCategoryForm((current) => ({ ...current, name: event.target.value }))}
                    required
                    placeholder="Category Name"
                    className="w-full bg-white dark:bg-black/40 border border-black/10 dark:border-white/10 rounded p-2 text-sm text-zinc-900 dark:text-zinc-200 focus:outline-none focus:border-accent-500/50 transition-all font-mono"
                  />
                  <textarea
                    value={categoryForm.description || ""}
                    onChange={(event) => setCategoryForm((current) => ({ ...current, description: event.target.value }))}
                    rows={2}
                    placeholder="Description"
                    className="w-full bg-white dark:bg-black/40 border border-black/10 dark:border-white/10 rounded p-2 text-sm text-zinc-900 dark:text-zinc-200 focus:outline-none focus:border-accent-500/50 transition-all font-mono"
                  />
                  <select
                    value={categoryForm.scope}
                    onChange={(event) => setCategoryForm((current) => ({ ...current, scope: event.target.value }))}
                    className="w-full bg-white dark:bg-black/40 border border-black/10 dark:border-white/10 rounded p-2 text-sm text-zinc-900 dark:text-zinc-200 focus:outline-none focus:border-accent-500/50 transition-all font-mono"
                  >
                    <option value="item">Item</option>
                    <option value="accessory">Accessory</option>
                    <option value="mixed">Mixed</option>
                  </select>
                </div>
                <button
                  type="submit"
                  disabled={savingCategory}
                  className="mt-auto px-4 py-2 bg-zinc-50 dark:bg-white/5 hover:bg-zinc-100 dark:hover:bg-white/10 disabled:opacity-60 border border-black/10 dark:border-white/10 rounded-lg text-xs font-semibold text-zinc-900 dark:text-white transition-all w-full"
                >
                  {savingCategory ? "Creating..." : "Create Category"}
                </button>
              </form>

              <form className="liquid-glass rounded-xl p-5 flex flex-col gap-4" onSubmit={handleCreateComponent}>
                <h3 className="text-xs font-bold text-zinc-900 dark:text-zinc-200 uppercase tracking-widest">
                  <i className="ph-bold ph-cube text-zinc-600 dark:text-zinc-400 mr-2" /> Add Component
                </h3>
                <div className="space-y-3">
                  <div className="flex gap-2">
                    <input
                      value={componentForm.name}
                      onChange={(event) => setComponentForm((current) => ({ ...current, name: event.target.value }))}
                      required
                      placeholder="Name"
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
                      className="w-1/2 bg-white dark:bg-black/40 border border-black/10 dark:border-white/10 rounded p-2 text-sm text-zinc-900 dark:text-zinc-200 focus:outline-none focus:border-accent-500/50 transition-all font-mono"
                    >
                      <option value="item">Item</option>
                      <option value="accessory">Accessory</option>
                    </select>
                    <input
                      value={componentForm.unit_type || ""}
                      onChange={(event) => setComponentForm((current) => ({ ...current, unit_type: event.target.value }))}
                      placeholder="Unit (m2, set)"
                      className="w-1/2 bg-white dark:bg-black/40 border border-black/10 dark:border-white/10 rounded p-2 text-sm text-zinc-900 dark:text-zinc-200 focus:outline-none focus:border-accent-500/50 transition-all font-mono"
                    />
                  </div>
                  <textarea
                    value={componentForm.description || ""}
                    onChange={(event) => setComponentForm((current) => ({ ...current, description: event.target.value }))}
                    rows={2}
                    placeholder="Description"
                    className="w-full bg-white dark:bg-black/40 border border-black/10 dark:border-white/10 rounded p-2 text-sm text-zinc-900 dark:text-zinc-200 focus:outline-none focus:border-accent-500/50 transition-all font-mono"
                  />
                  <textarea
                    value={componentForm.short_description || ""}
                    onChange={(event) => setComponentForm((current) => ({ ...current, short_description: event.target.value }))}
                    rows={2}
                    placeholder="Short description"
                    className="w-full bg-white dark:bg-black/40 border border-black/10 dark:border-white/10 rounded p-2 text-sm text-zinc-900 dark:text-zinc-200 focus:outline-none focus:border-accent-500/50 transition-all font-mono"
                  />
                </div>
                <button
                  type="submit"
                  disabled={savingComponent}
                  className="mt-auto px-4 py-2 bg-accent-500 hover:bg-accent-400 disabled:opacity-60 text-zinc-950 border border-transparent rounded-lg text-xs font-bold transition-all w-full"
                >
                  {savingComponent ? "Creating..." : "Create Component"}
                </button>
              </form>

              <div className="liquid-glass rounded-xl p-5 flex flex-col gap-4">
                <h3 className="text-xs font-bold text-zinc-900 dark:text-zinc-200 uppercase tracking-widest">
                  <i className="ph-bold ph-plugs text-zinc-600 dark:text-zinc-400 mr-2" /> Rules
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
                    <p className="text-xs text-zinc-500 font-mono">No targets available.</p>
                  )}
                </div>
                <button
                  type="button"
                  disabled={savingLinks}
                  className="mt-auto px-4 py-2 bg-zinc-50 dark:bg-white/5 hover:bg-zinc-100 dark:hover:bg-white/10 disabled:opacity-60 border border-black/10 dark:border-white/10 rounded-lg text-xs font-semibold text-zinc-900 dark:text-white transition-all w-full"
                  onClick={() => void handleSaveLinks()}
                >
                  {savingLinks ? "Saving..." : "Save Rules"}
                </button>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-zinc-900 dark:text-white flex items-center gap-2">
                  <i className="ph-bold ph-stack text-zinc-600 dark:text-zinc-400" /> Components
                </h3>
                <div className="text-xs font-mono text-zinc-500">{selected.components.length} instances</div>
              </div>
              <div className="w-full border border-black/10 dark:border-white/10 rounded-xl overflow-hidden bg-white dark:bg-zinc-900/50 backdrop-blur-sm">
                {selected.components.length ? (
                  selected.components.map((component) => (
                    <ComponentCard
                      key={component.id}
                      component={component}
                      onComponentSaved={(nextComponent) =>
                        setData((current) => (current ? upsertSelectedComponent(current, nextComponent) : current))
                      }
                      onComponentDeleted={(componentId) =>
                        setData((current) => (current ? removeSelectedComponent(current, componentId) : current))
                      }
                    />
                  ))
                ) : (
                  <div className="p-8 text-center text-zinc-500 font-mono text-sm border border-black/5 dark:border-white/5 bg-zinc-50 dark:bg-white/5 rounded-lg">
                    No components yet.
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="liquid-glass rounded-2xl p-6 text-center text-zinc-500 font-mono text-sm">No category selected.</div>
        )}
      </div>
    </div>
  );
}
