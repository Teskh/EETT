import { FormEvent, useEffect, useState } from "react";

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
    <ul className={depth === 0 ? "space-y-1" : "ml-5 border-l border-black/10 dark:border-white/10 mt-1 pl-3 space-y-1"}>
      {nodes
        .filter((node) => treeMatches(node, filterTerm))
        .map((node) => {
          const active = node.id === selectedCategoryId;
          const matchingComponents = normalizeSearchText(filterTerm)
            ? node.components.filter((component) => componentMatches(component, filterTerm))
            : [];
          return (
            <li key={node.id}>
              {depth === 0 ? (
                <div className="group/category flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => onSelect(node.id)}
                    className={`min-w-0 flex-1 flex items-center justify-between text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                      active
                        ? "bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/5 text-zinc-900 dark:text-zinc-200 font-medium"
                        : "hover:bg-black/5 dark:hover:bg-white/5 border border-transparent text-zinc-600 dark:text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-300"
                    }`}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <i className={`${active ? "ph-fill ph-folder-open text-accent-600 dark:text-accent-400" : "ph-fill ph-folder text-zinc-400 dark:text-zinc-500"}`} />
                      <span className="truncate">{node.name}</span>
                    </span>
                    <span className="shrink-0 font-mono text-[10px] text-zinc-500">{node.component_count} ítems</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onManageCategory(node)}
                    aria-label={`Editar o eliminar ${node.name}`}
                    title="Editar categoría"
                    className="pointer-events-none flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-zinc-500 opacity-0 transition-all hover:bg-black/5 hover:text-zinc-900 focus:pointer-events-auto focus:opacity-100 group-hover/category:pointer-events-auto group-hover/category:opacity-100 dark:hover:bg-white/10 dark:hover:text-zinc-100"
                  >
                    <i className="ph-bold ph-dots-three" />
                  </button>
                </div>
              ) : (
                <div className="group/category flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => onSelect(node.id)}
                    className={`min-w-0 flex-1 block text-left px-2 py-1 text-sm transition-colors relative before:absolute before:w-2 before:h-px before:-left-3 before:top-1/2 ${
                      active
                        ? "text-accent-600 dark:text-accent-400 font-semibold before:bg-accent-600/50 dark:before:bg-accent-400/50"
                        : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 before:bg-black/10 dark:before:bg-white/10"
                    }`}
                  >
                    <span className="block truncate">{node.name}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onManageCategory(node)}
                    aria-label={`Editar o eliminar ${node.name}`}
                    title="Editar subcategoría"
                    className="pointer-events-none flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-zinc-500 opacity-0 transition-all hover:bg-black/5 hover:text-zinc-900 focus:pointer-events-auto focus:opacity-100 group-hover/category:pointer-events-auto group-hover/category:opacity-100 dark:hover:bg-white/10 dark:hover:text-zinc-100"
                  >
                    <i className="ph-bold ph-dots-three" />
                  </button>
                </div>
              )}
              {matchingComponents.length ? (
                <ul className="ml-5 mt-1 space-y-1 border-l border-black/10 pl-3 dark:border-white/10">
                  {matchingComponents.map((component) => {
                    const isAccessory = component.type === "accessory";
                    return (
                      <li key={component.id}>
                        <button
                          type="button"
                          onClick={() => onSelectComponent(node.id, component.id)}
                          className="relative flex w-full items-center gap-2 px-2 py-1 text-left text-sm text-zinc-600 transition-colors before:absolute before:-left-3 before:top-1/2 before:h-px before:w-2 before:bg-black/10 hover:text-zinc-900 dark:text-zinc-400 dark:before:bg-white/10 dark:hover:text-zinc-200"
                        >
                          <i className={`ph-fill ${isAccessory ? "ph-flask" : "ph-wall"} text-zinc-400 dark:text-zinc-500`} />
                          <span className="min-w-0 flex-1 truncate">{component.name}</span>
                          <span className="shrink-0 font-mono text-[9px] uppercase tracking-wide text-zinc-500">
                            {isAccessory ? "Accesorio" : "Ítem"}
                          </span>
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

function ComponentCard({ component, focused, onComponentSaved, onComponentDeleted }: ComponentCardProps) {
  const [expanded, setExpanded] = useState(focused);
  const [saving, setSaving] = useState(false);
  const [attributeSaving, setAttributeSaving] = useState(false);
  const [materialSaving, setMaterialSaving] = useState(false);
  const [materialEditorOpen, setMaterialEditorOpen] = useState(false);
  const isAccessory = component.type === "accessory";
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

  useEffect(() => {
    if (focused) {
      setExpanded(true);
    }
  }, [focused]);

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
    const confirmed = window.confirm("¿Eliminar este componente del catálogo?");
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

  async function handleMediaChange(asset: MediaAsset | null) {
    setSaving(true);
    try {
      const result = await api.updateComponentMedia(component.id, asset?.id ?? null);
      if (result.component) {
        onComponentSaved(result.component);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div id={`component-${component.id}`} className="scroll-mt-6 border-b border-black/10 dark:border-white/10 last:border-0">
      <div 
        className="flex items-center justify-between p-4 bg-white dark:bg-black/20 shadow-sm group hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors cursor-pointer"
        onClick={() => setExpanded((current) => !current)}
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded bg-zinc-50 dark:bg-white/5 border border-black/10 dark:border-white/10 flex items-center justify-center text-zinc-600 dark:text-zinc-400">
            <i className={`ph-fill ${isAccessory ? "ph-flask" : "ph-wall"}`} />
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
              isAccessory
                ? "bg-white dark:bg-white/10 shadow-sm text-zinc-800 dark:text-zinc-300 border-black/20 dark:border-white/20"
                : "bg-white dark:bg-black/40 text-zinc-600 dark:text-zinc-400 border-black/10 dark:border-white/10"
            }`}
          >
            {isAccessory ? "ACCESORIO" : "ÍTEM"}
          </span>
          <div
            className="px-3 py-1.5 text-xs font-semibold text-zinc-800 dark:text-zinc-300 border border-black/10 dark:border-white/10 bg-zinc-50 dark:bg-white/5 group-hover:bg-zinc-100 dark:group-hover:bg-white/10 rounded transition-colors flex items-center gap-2"
          >
            <i className={`ph-bold ${expanded ? "ph-caret-up" : "ph-caret-down"}`} /> Detalles
          </div>
        </div>
      </div>
      {expanded ? (
        <div className="border-t border-black/5 dark:border-white/5 bg-white dark:bg-black/40 p-4">
          <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-6">{component.description || "Sin descripción."}</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            <div className="flex flex-col gap-4">
              <form className="bg-zinc-50 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-lg p-4 flex flex-col gap-3" onSubmit={handleSaveComponent}>
                <h6 className="text-xs font-bold text-zinc-800 dark:text-zinc-300 uppercase tracking-widest flex items-center gap-2">
                  <i className="ph-bold ph-pencil-simple text-zinc-500" /> Editar Componente
                </h6>
                <div className="flex gap-2">
                  <input
                    value={form.name}
                    onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                    required
                    placeholder="Nombre"
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
                    className="w-1/2 bg-white dark:bg-zinc-900 border border-black/10 dark:border-white/10 rounded p-1.5 text-xs text-zinc-900 dark:text-zinc-200 focus:outline-none focus:border-accent-500/50 transition-colors font-mono"
                  >
                    <option value="item">Ítem</option>
                    <option value="accessory">Accesorio</option>
                  </select>
                  <input
                    value={form.unit_type || ""}
                    onChange={(event) => setForm((current) => ({ ...current, unit_type: event.target.value }))}
                    placeholder="Tipo de unidad"
                    className="w-1/2 bg-white dark:bg-black/40 border border-black/10 dark:border-white/10 rounded p-1.5 text-xs text-zinc-900 dark:text-zinc-200 focus:outline-none focus:border-accent-500/50 transition-colors font-mono"
                  />
                </div>
                <textarea
                  value={form.description || ""}
                  onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                  rows={2}
                  placeholder="Descripción"
                  className="description-textarea w-full bg-white dark:bg-black/40 border border-black/10 dark:border-white/10 rounded p-1.5 text-xs text-zinc-900 dark:text-zinc-200 focus:outline-none focus:border-accent-500/50 transition-colors font-mono"
                />
                <textarea
                  value={form.short_description || ""}
                  onChange={(event) => setForm((current) => ({ ...current, short_description: event.target.value }))}
                  rows={2}
                  placeholder="Descripción comercial"
                  className="description-textarea w-full bg-white dark:bg-black/40 border border-black/10 dark:border-white/10 rounded p-1.5 text-xs text-zinc-900 dark:text-zinc-200 focus:outline-none focus:border-accent-500/50 transition-colors font-mono"
                />
                <textarea
                  value={form.installation || ""}
                  onChange={(event) => setForm((current) => ({ ...current, installation: event.target.value }))}
                  rows={2}
                  placeholder="Instalación"
                  className="description-textarea w-full bg-white dark:bg-black/40 border border-black/10 dark:border-white/10 rounded p-1.5 text-xs text-zinc-900 dark:text-zinc-200 focus:outline-none focus:border-accent-500/50 transition-colors font-mono"
                />
                <div className="flex justify-between items-center mt-2">
                  <button className="px-3 py-1.5 bg-white dark:bg-white/10 shadow-sm hover:bg-zinc-50 dark:hover:bg-white/20 text-zinc-900 dark:text-white rounded text-xs font-semibold transition-colors" type="submit" disabled={saving}>
                    {saving ? "Guardando..." : "Guardar cambios"}
                  </button>
                </div>
              </form>

              <div className="bg-zinc-50 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-lg p-4 flex flex-col gap-3">
                <h6 className="text-xs font-bold text-zinc-800 dark:text-zinc-300 uppercase tracking-widest flex items-center gap-2">
                  <i className="ph-bold ph-image text-zinc-500" /> Imagen de Catálogo
                </h6>
                <MediaPicker value={component.media[0] || null} onChange={(asset) => void handleMediaChange(asset)} compact />
              </div>

              <div className="flex items-center justify-between bg-red-100 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-lg p-3">
                <span className="text-[10px] text-red-700 dark:text-red-400 font-mono">La eliminación se bloquea si está en uso.</span>
                <button className="px-2 py-1 bg-red-200 dark:bg-red-500/20 hover:bg-red-300 dark:bg-red-500/30 text-red-700 dark:text-red-300 rounded text-xs font-semibold transition-colors flex items-center gap-1" type="button" onClick={() => void handleDeleteComponent()}>
                  <i className="ph-bold ph-trash" /> Eliminar
                </button>
              </div>
            </div>

            <div>
              <div className="space-y-5">
                <div>
                  <h6 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-3 flex items-center gap-2">
                    <i className="ph-bold ph-list-dashes text-zinc-600" /> Atributos Base
                  </h6>
                  <CatalogAttributeEditor
                    initialAttributes={component.base_attributes}
                    saving={attributeSaving}
                    onSave={(attributes) => handleSaveAttributes("base", attributes)}
                  />
                </div>
                {isAccessory ? (
                  <div>
                    <h6 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-3 flex items-center gap-2">
                      <i className="ph-bold ph-flow-arrow text-zinc-600" /> Atributos de Uso
                    </h6>
                    <CatalogAttributeEditor
                      initialAttributes={component.usage_attributes}
                      saving={attributeSaving}
                      onSave={(attributes) => handleSaveAttributes("usage", attributes)}
                    />
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <div>
            <div className="mb-3 flex items-center justify-between gap-3">
              <h6 className="text-xs font-bold text-zinc-500 uppercase tracking-widest flex items-center gap-2">
                <i className="ph-bold ph-boxes text-zinc-600" /> Reglas de Materiales
              </h6>
              <button
                type="button"
                onClick={() => setMaterialEditorOpen(true)}
                className="px-3 py-1.5 border border-black/10 dark:border-white/10 bg-white dark:bg-white/5 hover:bg-zinc-50 dark:hover:bg-white/10 rounded text-xs font-semibold text-zinc-900 dark:text-zinc-200 transition-colors flex items-center gap-2"
              >
                <i className="ph-bold ph-sliders-horizontal" />
                Administrar materiales
              </button>
            </div>
            <table className="w-full text-left border-collapse text-sm border border-black/10 dark:border-white/10 rounded overflow-hidden">
              <thead className="bg-white dark:bg-black/60 border-b border-black/10 dark:border-white/10">
                <tr>
                  <th className="px-3 py-2 text-zinc-500 font-medium w-1/3">Material</th>
                  <th className="px-3 py-2 text-zinc-500 font-medium w-1/4">SKU / Unidad</th>
                  <th className="px-3 py-2 text-zinc-500 font-medium text-right w-1/4"><FactoryQuantityLabel /> por unidad</th>
                  <th className="px-3 py-2 text-zinc-500 font-medium text-right">Condiciones</th>
                </tr>
              </thead>
              <tbody className="bg-zinc-50 dark:bg-white/5 divide-y divide-white/5">
                {component.material_rules.length ? (
                  component.material_rules.map((rule) => (
                    <tr key={`${rule.sku}-${rule.material_name}`} className="group hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors">
                      <td className="px-3 py-3 text-zinc-900 dark:text-zinc-200 font-medium text-sm">
                        {rule.material_name}
                      </td>
                      <td className="px-3 py-3 text-zinc-500 font-mono text-xs">
                        {rule.sku} <br /> ({rule.unit || "-"})
                      </td>
                      <td className="px-3 py-3 text-right font-mono text-sm text-accent-700 dark:text-accent-400">
                        {rule.unit_qty_per_unit ?? "n/d"}
                      </td>
                      <td className="px-3 py-3 text-right">
                        <div className="flex flex-wrap justify-end gap-1">{formatCondition(rule)}</div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4} className="py-4 text-center text-zinc-500 font-mono text-xs">
                      No hay reglas de materiales definidas.
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
            <input value={form.short_name || ""} onChange={(event) => setForm((current) => ({ ...current, short_name: event.target.value }))} placeholder="SKU" className="w-1/3 bg-zinc-50 dark:bg-black/40 border border-black/10 dark:border-white/10 rounded-lg p-2.5 text-sm text-zinc-900 dark:text-zinc-200 focus:outline-none focus:border-accent-500/50 focus:ring-1 focus:ring-accent-500/50 transition-all font-mono" />
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


  async function loadCatalog() {
    setLoading(true);
    setError(null);
    try {
      const next = await api.getCatalog(categoryId);
      setData(next);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "No se pudo cargar el catálogo.";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadCatalog();
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

  return (
    <div className="max-w-[1600px] mx-auto grid grid-cols-1 xl:grid-cols-12 gap-6">
      <div className="xl:col-span-3 space-y-6">
        <div className="liquid-glass rounded-2xl p-4 flex flex-col h-[500px]">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xs font-bold text-zinc-500 uppercase tracking-widest flex items-center gap-2">
              <i className="ph-bold ph-tree-structure" /> Taxonomía
            </h2>
            <i className="ph-bold ph-magnifying-glass text-zinc-600" />
          </div>
          <SearchField value={searchTerm} onChange={setSearchTerm} />
          <div className="flex-1 overflow-y-auto pr-2">
            {data ? (
              data.tree.some((node) => treeMatches(node, searchTerm)) ? (
                <CatalogTree
                  nodes={data.tree}
                  selectedCategoryId={selected?.id || categoryId}
                  filterTerm={searchTerm}
                  onSelect={selectCategory}
                  onSelectComponent={selectComponent}
                  onManageCategory={openCategoryActions}
                />
              ) : (
                <p className="px-2 py-3 text-xs text-zinc-500">No hay categorías, ítems ni accesorios que coincidan.</p>
              )
            ) : (
              <p className="text-xs text-zinc-500 font-mono">Cargando categorías...</p>
            )}
          </div>
        </div>

        {data ? (
          <div className="liquid-glass rounded-2xl p-5 flex flex-col gap-4">
            <div className="flex justify-between items-end mb-2">
              <span className="text-xs text-zinc-500 uppercase tracking-widest font-bold">Alcance Total</span>
              <i className="ph-bold ph-chart-bar text-zinc-600 dark:text-zinc-400" />
            </div>
            {[
              ["Categorías", data.summary.categories],
              ["Componentes", data.summary.components],
              ["Materiales", data.summary.materials],
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
          <div className="liquid-glass rounded-2xl p-6 text-center text-zinc-500 font-mono text-sm">Cargando catálogo...</div>
        ) : selected && data ? (
          <div className="flex flex-col gap-6">
            <div className="flex items-end justify-between border-b border-black/10 dark:border-white/10 pb-4">
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
                        onClick={() => selectCategory(child.id)}
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
              <div className="w-full border border-black/10 dark:border-white/10 rounded-2xl overflow-hidden bg-white dark:bg-zinc-900/50 backdrop-blur-sm shadow-sm">
                {selected.components.length ? (
                  selected.components.map((component) => (
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
                  <div className="p-8 text-center text-zinc-500 font-mono text-sm border border-black/5 dark:border-white/5 bg-zinc-50 dark:bg-white/5 rounded-lg">
                    Aún no hay componentes.
                  </div>
                )}
              </div>
            </div>
            <AddCategoryModal open={categoryModalOpen} onClose={() => setCategoryModalOpen(false)} form={categoryForm} setForm={setCategoryForm} saving={savingCategory} onSubmit={handleCreateCategory} />
            <AddComponentModal open={componentModalOpen} onClose={() => setComponentModalOpen(false)} form={componentForm} setForm={setComponentForm} saving={savingComponent} onSubmit={handleCreateComponent} />
            <ManageLinksModal open={linksModalOpen} onClose={() => setLinksModalOpen(false)} targets={data.link_targets} selectedLinks={selectedLinks} setSelectedLinks={setSelectedLinks} saving={savingLinks} onSave={() => void handleSaveLinks()} />
          </div>
        ) : (
          <div className="liquid-glass rounded-2xl p-6 text-center text-zinc-500 font-mono text-sm">No hay categoría seleccionada.</div>
        )}
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
    </div>
  );
}
