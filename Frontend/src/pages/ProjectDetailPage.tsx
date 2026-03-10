import { FormEvent, useEffect, useState } from "react";

import { Modal } from "../components/Modal";
import { ApiError, api } from "../lib/api";
import type {
  AttributeValueInput,
  AvailableComponent,
  EditableAttribute,
  ProjectCategorySection,
  ProjectDetailData,
  ProjectInstance,
  ProjectSubtype,
  UpdateProjectInstanceRequest,
} from "../lib/types";

type ProjectDetailPageProps = {
  projectId: number;
  onNavigate: (to: string) => void;
};

type ModalState =
  | { kind: "create"; categoryId: number }
  | { kind: "edit"; categoryId: number; instanceId: number }
  | null;

type InstanceFormModalProps = {
  open: boolean;
  mode: "create" | "edit";
  categoryName: string;
  availableComponents: AvailableComponent[];
  initialInstance?: ProjectInstance;
  submitting: boolean;
  onClose: () => void;
  onSubmit: (payload: {
    component_id?: number;
    name: string;
    short_name: string | null;
    description: string | null;
    short_description: string | null;
    installation: string | null;
    unit_amount: number | null;
    attribute_values: AttributeValueInput[];
  }) => Promise<void>;
};

type CategoryNode = ProjectCategorySection & { children: CategoryNode[] };

function buildCategoryTree(flatCategories: ProjectCategorySection[]): CategoryNode[] {
  const rootNodes: CategoryNode[] = [];
  const stack: CategoryNode[] = [];

  for (const category of flatCategories) {
    const node: CategoryNode = { ...category, children: [] };
    
    while (stack.length > 0 && stack[stack.length - 1].depth >= node.depth) {
      stack.pop();
    }
    
    if (stack.length === 0) {
      rootNodes.push(node);
    } else {
      stack[stack.length - 1].children.push(node);
    }
    
    stack.push(node);
  }
  
  return rootNodes;
}

function ProjectCategoryTree({
  nodes,
  filterTerm,
  depth = 0,
}: {
  nodes: CategoryNode[];
  filterTerm: string;
  depth?: number;
}) {
  return (
    <ul className={depth === 0 ? "space-y-1" : "ml-5 border-l border-black/10 dark:border-white/10 mt-1 pl-3 space-y-1"}>
      {nodes
        .filter((node) => {
          const matches = (n: CategoryNode): boolean => {
            if (n.name.toLowerCase().includes(filterTerm.toLowerCase())) return true;
            return n.children.some(matches);
          };
          return matches(node);
        })
        .map((node) => {
          return (
            <li key={node.id}>
              {depth === 0 ? (
                <a
                  href={`#category-${node.id}`}
                  className="w-full flex items-center justify-between text-left px-3 py-2 rounded-lg text-sm transition-colors hover:bg-black/5 dark:hover:bg-white/5 border border-transparent text-zinc-600 dark:text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-300"
                >
                  <span className="flex items-center gap-2">
                    <i className="ph-fill ph-folder text-zinc-400 dark:text-zinc-500" />
                    {node.name}
                  </span>
                </a>
              ) : (
                <a
                  href={`#category-${node.id}`}
                  className="w-full block text-left px-2 py-1 text-sm transition-colors relative before:absolute before:w-2 before:h-px before:-left-3 before:top-1/2 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 before:bg-black/10 dark:before:bg-white/10"
                >
                  {node.name}
                </a>
              )}
              {node.children.length ? (
                <ProjectCategoryTree
                  nodes={node.children}
                  filterTerm={filterTerm}
                  depth={depth + 1}
                />
              ) : null}
            </li>
          );
        })}
    </ul>
  );
}

function renderSubtypeTree(subtype: ProjectSubtype, depth = 0): JSX.Element {
  return (
    <li key={subtype.id}>
      {depth === 0 ? (
        <div className="w-full flex items-center justify-between text-left px-3 py-2 rounded-lg text-sm bg-zinc-50 dark:bg-white/5 border border-black/5 dark:border-white/5 text-zinc-900 dark:text-zinc-200 font-medium">
          <span className="flex items-center gap-2">
            <i className="ph-fill ph-git-branch text-accent-700 dark:text-accent-400" />
            {subtype.name}
          </span>
        </div>
      ) : (
        <div className="w-full block text-left px-2 py-1 text-sm relative before:absolute before:w-2 before:h-px before:-left-3 before:top-1/2 text-zinc-600 dark:text-zinc-400 before:bg-black/10 dark:before:bg-white/10">
          {subtype.name}
        </div>
      )}
      {subtype.children.length ? (
        <ul className={depth === 0 ? "ml-5 border-l border-black/10 dark:border-white/10 mt-1 pl-3 space-y-1" : "ml-5 border-l border-black/10 dark:border-white/10 mt-1 pl-3 space-y-1"}>
          {subtype.children.map((child) => renderSubtypeTree(child, depth + 1))}
        </ul>
      ) : null}
    </li>
  );
}

function quantityClass(value: number | null) {
  if (value === null) {
    return "text-zinc-500";
  }
  if (value === 0) {
    return "opacity-50";
  }
  return "text-accent-700 dark:text-accent-400 font-bold";
}

function formatQuantity(value: number | null) {
  if (value === null) {
    return "Blank";
  }
  return String(value);
}

function normalizeEditableAttributes(attributes: EditableAttribute[]): EditableAttribute[] {
  return attributes.map((attribute) => ({
    ...attribute,
    value: attribute.value || "",
  }));
}

function buildAttributesFromComponent(component: AvailableComponent | undefined): EditableAttribute[] {
  if (!component) {
    return [];
  }
  return component.attributes.map((attribute) => ({
    name: attribute.name,
    value_type: attribute.value_type,
    options: attribute.options,
    value: "",
  }));
}

function InstanceFormModal({
  open,
  mode,
  categoryName,
  availableComponents,
  initialInstance,
  submitting,
  onClose,
  onSubmit,
}: InstanceFormModalProps) {
  const [componentId, setComponentId] = useState<number>(availableComponents[0]?.id || 0);
  const [name, setName] = useState("");
  const [shortName, setShortName] = useState("");
  const [description, setDescription] = useState("");
  const [shortDescription, setShortDescription] = useState("");
  const [installation, setInstallation] = useState("");
  const [unitAmount, setUnitAmount] = useState("");
  const [attributes, setAttributes] = useState<EditableAttribute[]>([]);

  useEffect(() => {
    if (!open) {
      return;
    }

    if (mode === "edit" && initialInstance) {
      setComponentId(0);
      setName(initialInstance.name);
      setShortName(initialInstance.short_name || "");
      setDescription(initialInstance.description || "");
      setShortDescription(initialInstance.short_description || "");
      setInstallation(initialInstance.installation || "");
      setUnitAmount(initialInstance.unit_amount === null ? "" : String(initialInstance.unit_amount));
      setAttributes(normalizeEditableAttributes(initialInstance.editable_attributes));
      return;
    }

    const defaultComponent = availableComponents[0];
    setComponentId(defaultComponent?.id || 0);
    setName(defaultComponent?.name || "");
    setShortName(defaultComponent?.short_name || "");
    setDescription(defaultComponent?.description || "");
    setShortDescription(defaultComponent?.short_description || "");
    setInstallation(defaultComponent?.installation || "");
    setUnitAmount("");
    setAttributes(buildAttributesFromComponent(defaultComponent));
  }, [availableComponents, initialInstance, mode, open]);

  useEffect(() => {
    if (!open || mode !== "create") {
      return;
    }
    const selectedComponent = availableComponents.find((component) => component.id === componentId) || availableComponents[0];
    if (!selectedComponent) {
      return;
    }
    setName(selectedComponent.name);
    setShortName(selectedComponent.short_name || "");
    setDescription(selectedComponent.description || "");
    setShortDescription(selectedComponent.short_description || "");
    setInstallation(selectedComponent.installation || "");
    setAttributes(buildAttributesFromComponent(selectedComponent));
  }, [availableComponents, componentId, mode, open]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onSubmit({
      component_id: mode === "create" ? componentId : undefined,
      name,
      short_name: shortName.trim() || null,
      description: description.trim() || null,
      short_description: shortDescription.trim() || null,
      installation: installation.trim() || null,
      unit_amount: unitAmount.trim() === "" ? null : Number(unitAmount),
      attribute_values: attributes.map((attribute) => ({
        name: attribute.name,
        value: (attribute.value || "").trim() || null,
      })),
    });
  }

  return (
    <Modal
      open={open}
      title={categoryName}
      kicker={mode === "create" ? "Create project instance" : "Edit project instance"}
      onClose={onClose}
    >
      <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
        {mode === "create" ? (
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold text-zinc-600 dark:text-zinc-400 uppercase tracking-widest">Template Component</label>
            <select
              value={componentId}
              onChange={(event) => setComponentId(Number(event.target.value))}
              className="w-full bg-white dark:bg-black/40 border border-black/10 dark:border-white/10 rounded-lg p-2.5 text-sm text-zinc-900 dark:text-zinc-200 focus:outline-none focus:border-accent-500/50 transition-all font-mono"
            >
              {availableComponents.map((component) => (
                <option key={component.id} value={component.id}>
                  {component.name} ({component.type})
                </option>
              ))}
            </select>
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold text-zinc-600 dark:text-zinc-400 uppercase tracking-widest">Instance Name</label>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              className="w-full bg-white dark:bg-black/40 border border-black/10 dark:border-white/10 rounded-lg p-2.5 text-sm text-zinc-900 dark:text-zinc-200 focus:outline-none focus:border-accent-500/50 transition-all font-mono"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold text-zinc-600 dark:text-zinc-400 uppercase tracking-widest">Short Name (SKU)</label>
            <input
              value={shortName}
              onChange={(event) => setShortName(event.target.value)}
              className="w-full bg-white dark:bg-black/40 border border-black/10 dark:border-white/10 rounded-lg p-2.5 text-sm text-zinc-900 dark:text-zinc-200 focus:outline-none focus:border-accent-500/50 transition-all font-mono"
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-bold text-zinc-600 dark:text-zinc-400 uppercase tracking-widest">Unit Amount</label>
          <input
            value={unitAmount}
            onChange={(event) => setUnitAmount(event.target.value)}
            placeholder="Optional quantity basis"
            className="w-full bg-white dark:bg-black/40 border border-black/10 dark:border-white/10 rounded-lg p-2.5 text-sm text-zinc-900 dark:text-zinc-200 focus:outline-none focus:border-accent-500/50 transition-all font-mono"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-bold text-zinc-600 dark:text-zinc-400 uppercase tracking-widest">Description</label>
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={3}
            className="w-full bg-white dark:bg-black/40 border border-black/10 dark:border-white/10 rounded-lg p-2.5 text-sm text-zinc-900 dark:text-zinc-200 focus:outline-none focus:border-accent-500/50 transition-all font-mono"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-bold text-zinc-600 dark:text-zinc-400 uppercase tracking-widest">Short Description</label>
          <textarea
            value={shortDescription}
            onChange={(event) => setShortDescription(event.target.value)}
            rows={3}
            className="w-full bg-white dark:bg-black/40 border border-black/10 dark:border-white/10 rounded-lg p-2.5 text-sm text-zinc-900 dark:text-zinc-200 focus:outline-none focus:border-accent-500/50 transition-all font-mono"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-bold text-zinc-600 dark:text-zinc-400 uppercase tracking-widest">Installation</label>
          <textarea
            value={installation}
            onChange={(event) => setInstallation(event.target.value)}
            rows={3}
            className="w-full bg-white dark:bg-black/40 border border-black/10 dark:border-white/10 rounded-lg p-2.5 text-sm text-zinc-900 dark:text-zinc-200 focus:outline-none focus:border-accent-500/50 transition-all font-mono"
          />
        </div>

        {attributes.length ? (
          <div className="rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-black/20 shadow-sm p-4 flex flex-col gap-3">
            <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Base Attributes</div>
            {attributes.map((attribute) => (
              <div key={attribute.name} className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-zinc-600 dark:text-zinc-400 uppercase tracking-widest">{attribute.name}</label>
                {attribute.value_type === "select" ? (
                  <select
                    value={attribute.value || ""}
                    onChange={(event) =>
                      setAttributes((current) =>
                        current.map((item) =>
                          item.name === attribute.name ? { ...item, value: event.target.value } : item,
                        ),
                      )
                    }
                    className="w-full bg-white dark:bg-black/40 border border-black/10 dark:border-white/10 rounded-lg p-2.5 text-sm text-zinc-900 dark:text-zinc-200 focus:outline-none focus:border-accent-500/50 transition-all font-mono"
                  >
                    <option value="">Select value</option>
                    {attribute.options.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    value={attribute.value || ""}
                    type={attribute.value_type === "number" ? "number" : "text"}
                    onChange={(event) =>
                      setAttributes((current) =>
                        current.map((item) =>
                          item.name === attribute.name ? { ...item, value: event.target.value } : item,
                        ),
                      )
                    }
                    className="w-full bg-white dark:bg-black/40 border border-black/10 dark:border-white/10 rounded-lg p-2.5 text-sm text-zinc-900 dark:text-zinc-200 focus:outline-none focus:border-accent-500/50 transition-all font-mono"
                  />
                )}
              </div>
            ))}
          </div>
        ) : null}

        {mode === "edit" ? (
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 mt-2 flex gap-3">
            <i className="ph-fill ph-warning-circle text-amber-500 text-lg" />
            <p className="text-xs text-amber-200 font-mono">
              Saving marks this snapshot as customized. Use refresh later if you want to pull catalog data forward instead.
            </p>
          </div>
        ) : null}

        <div className="flex items-center justify-end gap-3 mt-4 pt-4 border-t border-black/10 dark:border-white/10">
          <button type="button" className="px-4 py-2 bg-zinc-50 dark:bg-white/5 hover:bg-zinc-100 dark:hover:bg-white/10 text-zinc-900 dark:text-white rounded-lg text-sm font-semibold transition-colors" onClick={onClose}>
            Cancel
          </button>
          <button 
            type="submit" 
            disabled={submitting}
            className="px-4 py-2 bg-accent-500 hover:bg-accent-400 text-zinc-950 rounded-lg text-sm font-bold transition-colors disabled:opacity-50"
          >
            {submitting ? "Saving..." : mode === "create" ? "Create Instance" : "Save Instance"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function renderInstanceLinkBadge(link: { name: string; application_label: string | null }) {
  const label = link.application_label ? `${link.name} · ${link.application_label}` : link.name;
  return (
    <span key={`${link.name}-${link.application_label || "base"}`} className="px-2 py-0.5 bg-white dark:bg-black/40 border border-black/10 dark:border-white/10 rounded text-[10px] font-mono text-zinc-800 dark:text-zinc-300">
      {label}
    </span>
  );
}

function InstanceCard({
  projectId,
  categoryId,
  instance,
  onEdit,
  onDelete,
}: {
  projectId: number;
  categoryId: number;
  instance: ProjectInstance;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const iconClass = instance.type === "accessory" ? "ph-flask" : "ph-wall";
  const typeLabel = instance.type === "accessory" ? "ACCESSORY" : "ITEM";
  const badgeBg = instance.type === "accessory" ? "bg-white dark:bg-white/10 shadow-sm text-zinc-800 dark:text-zinc-300 border-black/20 dark:border-white/20" : "bg-white dark:bg-black/40 text-zinc-600 dark:text-zinc-400 border-black/10 dark:border-white/10";
  const syncColor = instance.sync_state.status === "up-to-date" ? "text-green-400" : "text-amber-400";

  return (
    <div className="border-b border-black/10 dark:border-white/10 last:border-0">
      <div 
        className="flex items-center justify-between p-4 bg-white dark:bg-black/20 shadow-sm group hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors cursor-pointer"
        onClick={() => setExpanded((current) => !current)}
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded bg-zinc-50 dark:bg-white/5 border border-black/10 dark:border-white/10 flex items-center justify-center text-zinc-600 dark:text-zinc-400">
            <i className={`ph-fill ${iconClass}`} />
          </div>
          <div>
            <div className="font-bold text-zinc-900 dark:text-white text-[15px] flex items-center gap-2">
              {instance.name}
              <span className="px-2 py-0.5 border border-black/10 dark:border-white/10 bg-white dark:bg-black/40 rounded text-[10px] font-mono text-zinc-500 align-middle ml-2">
                {instance.short_name || instance.name}
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className={`px-2 py-1 ${badgeBg} text-[10px] font-bold uppercase tracking-widest border rounded`}>
            {typeLabel}
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
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            <div className="space-y-6">
              <div>
                <h6 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-2 flex items-center gap-2">
                  <i className="ph-bold ph-info text-zinc-600" /> Info
                </h6>
                <p className="text-sm text-zinc-800 dark:text-zinc-300 mb-2">{instance.description || "No description provided."}</p>
                <p className="text-xs text-zinc-600 dark:text-zinc-400 mb-2">
                  Short: {instance.short_description || "No short description."}
                </p>
                <div className="flex items-center gap-4 text-xs font-mono">
                  <span className="text-zinc-600 dark:text-zinc-400">
                    Unit Amount: <strong className="text-zinc-900 dark:text-zinc-200">{instance.unit_amount ?? "-"}</strong>
                  </span>
                  <span className="text-zinc-600 dark:text-zinc-400">
                    Sync: <strong className={syncColor}>{instance.sync_state.status}</strong>
                  </span>
                </div>
              </div>

              <div className="bg-zinc-50 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-lg p-4">
                <h6 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-3 flex items-center gap-2">
                  <i className="ph-bold ph-plugs text-zinc-600" /> Relationships
                </h6>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-zinc-500 font-mono w-24">Linked Acc:</span>
                    <div className="flex flex-wrap gap-1">
                      {instance.linked_accessories.length ? (
                        instance.linked_accessories.map(renderInstanceLinkBadge)
                      ) : (
                        <span className="text-xs font-mono text-zinc-500">None</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-zinc-500 font-mono w-24">Attached To:</span>
                    <div className="flex flex-wrap gap-1">
                      {instance.linked_to.length ? (
                        instance.linked_to.map(renderInstanceLinkBadge)
                      ) : (
                        <span className="text-xs font-mono text-zinc-500">Standalone</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <h6 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-2 flex items-center gap-2">
                  <i className="ph-bold ph-wrench text-zinc-600" /> Installation
                </h6>
                <p className="text-sm text-zinc-600 dark:text-zinc-400">{instance.installation || "No installation notes."}</p>
              </div>

              <div className="flex items-center gap-3 pt-4 border-t border-black/10 dark:border-white/10">
                <button
                  type="button"
                  className="px-3 py-1.5 bg-white dark:bg-white/10 shadow-sm hover:bg-zinc-50 dark:hover:bg-white/20 text-zinc-900 dark:text-white rounded text-xs font-semibold transition-colors flex items-center gap-2"
                  onClick={onEdit}
                >
                  <i className="ph-bold ph-pencil-simple" /> Edit Instance
                </button>
                <button
                  type="button"
                  className="px-3 py-1.5 bg-red-100 dark:bg-red-500/10 hover:bg-red-200 dark:hover:bg-red-500/20 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-500/20 rounded text-xs font-semibold transition-colors flex items-center gap-2"
                  onClick={onDelete}
                >
                  <i className="ph-bold ph-trash" /> Delete
                </button>
              </div>
            </div>

            <div className="bg-white dark:bg-black/40 border border-black/5 dark:border-white/5 rounded-lg p-4">
              {instance.attributes.length ? (
                instance.attributes.map((group) => (
                  <div key={`${instance.id}-${group.name}`} className="mb-4 last:mb-0">
                    <h5 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-2 flex items-center gap-2">
                      <i className="ph-bold ph-list-dashes text-zinc-600" /> {group.name}{" "}
                      <span className="text-[10px] font-mono text-zinc-600 ml-auto">{group.application_label || "Base"}</span>
                    </h5>
                    <table className="w-full text-left border-collapse text-sm">
                      <tbody className="divide-y divide-white/10">
                        {group.values.map((row) => (
                          <tr key={`${group.name}-${row.name}`}>
                            <td className="py-1.5 text-zinc-500 w-1/2">{row.name}</td>
                            <td className="py-1.5 text-zinc-900 dark:text-zinc-200 font-mono w-1/2">{row.value || "-"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))
              ) : (
                <p className="text-xs text-zinc-500 font-mono italic">No attributes loaded.</p>
              )}
            </div>
          </div>

          <div className="border-t border-black/10 dark:border-white/10 pt-6">
            <h6 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-4 flex items-center gap-2">
              <i className="ph-bold ph-boxes text-zinc-600" /> Applicable Materials
            </h6>
            <div className="space-y-4">
              {instance.materials.length ? (
                instance.materials.map((material) => (
                  <div key={`${instance.id}-${material.sku}`} className="bg-white dark:bg-black/20 shadow-sm border border-black/5 dark:border-white/5 rounded-lg overflow-hidden">
                    <div className="flex items-center justify-between p-3 border-b border-black/5 dark:border-white/5 bg-white dark:bg-black/40">
                      <div className="flex items-center gap-3">
                        <h5 className="font-bold text-sm text-zinc-900 dark:text-white flex items-center gap-2">{material.material_name}</h5>
                        <span className="px-2 py-0.5 bg-white dark:bg-black/40 border border-black/5 dark:border-white/5 rounded text-[10px] font-mono text-zinc-600 dark:text-zinc-400">
                          {material.sku}
                        </span>
                      </div>
                      <div className="text-right flex flex-col items-end">
                        <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Rule Qty</span>
                        <span className="text-xs font-mono text-accent-700 dark:text-accent-400">
                          {material.unit_qty_per_unit ?? "-"} {material.unit || "-"}
                        </span>
                      </div>
                    </div>

                    {material.notes ? (
                      <div className="px-3 py-2 border-b border-black/5 dark:border-white/5 text-xs text-zinc-600 dark:text-zinc-400 bg-white dark:bg-black/20 shadow-sm">{material.notes}</div>
                    ) : null}

                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse text-sm">
                        <thead className="bg-white dark:bg-black/40 border-b border-black/5 dark:border-white/5">
                          <tr>
                            <th className="px-3 py-1.5 text-[10px] text-zinc-500 font-bold uppercase tracking-widest w-1/4">Subtype</th>
                            <th className="px-3 py-1.5 text-[10px] text-zinc-500 font-bold uppercase tracking-widest text-right w-1/6">
                              Quantity
                            </th>
                            <th className="px-3 py-1.5 text-[10px] text-zinc-500 font-bold uppercase tracking-widest text-right w-1/6">
                              Assembly Kit
                            </th>
                            <th className="px-3 py-1.5 text-[10px] text-zinc-500 font-bold uppercase tracking-widest w-1/6">Unit</th>
                            <th className="px-3 py-1.5 text-[10px] text-zinc-500 font-bold uppercase tracking-widest w-1/12">Source</th>
                            <th className="px-3 py-1.5 text-[10px] text-zinc-500 font-bold uppercase tracking-widest">Formula</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                          {material.bom_entries.length ? (
                            material.bom_entries.map((row, index) => (
                              <tr key={`${material.sku}-${index}`} className={`group hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors ${quantityClass(row.quantity)}`}>
                                <td className="px-3 py-2 text-zinc-800 dark:text-zinc-300 font-medium text-sm w-1/4">{row.subtype}</td>
                                <td className="px-3 py-2 text-right font-mono text-sm w-1/6">{formatQuantity(row.quantity)}</td>
                                <td className="px-3 py-2 text-right font-mono text-sm text-zinc-500 w-1/6">
                                  {formatQuantity(row.assembly_quantity)}
                                </td>
                                <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400 font-mono text-xs w-1/6">{row.unit || "-"}</td>
                                <td className="px-3 py-2 text-zinc-500 font-mono text-[10px] uppercase w-1/12">{row.calculation_mode}</td>
                                <td className="px-3 py-2 text-zinc-500 font-mono text-xs truncate max-w-[100px]" title={row.calculation_formula || "-"}>
                                  {row.calculation_formula || "-"}
                                </td>
                              </tr>
                            ))
                          ) : (
                            <tr>
                              <td colSpan={6} className="px-3 py-4 text-center text-zinc-500 font-mono text-xs">
                                Applicable, but no BOM row stored yet.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center py-6 text-xs text-zinc-500 font-mono border border-dashed border-black/10 dark:border-white/10 rounded">
                  No applicable materials resolved for this instance.
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function ProjectDetailPage({ projectId }: ProjectDetailPageProps) {
  const [data, setData] = useState<ProjectDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [categorySearch, setCategorySearch] = useState("");
  const [modalState, setModalState] = useState<ModalState>(null);
  const [submitting, setSubmitting] = useState(false);

  async function loadProject() {
    setLoading(true);
    setError(null);
    try {
      setData(await api.getProject(projectId));
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Could not load project.";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadProject();
  }, [projectId]);

  const activeCategory =
    modalState && data
      ? data.categories.find((category) => category.id === modalState.categoryId) || null
      : null;

  const activeInstance =
    modalState?.kind === "edit" && activeCategory
      ? activeCategory.instances.find((instance) => instance.id === modalState.instanceId)
      : undefined;

  async function handleCreateInstance(payload: {
    component_id?: number;
    name: string;
    short_name: string | null;
    description: string | null;
    short_description: string | null;
    installation: string | null;
    unit_amount: number | null;
    attribute_values: AttributeValueInput[];
  }) {
    if (!modalState || modalState.kind !== "create" || !activeCategory || !payload.component_id) {
      return;
    }
    setSubmitting(true);
    try {
      await api.createProjectInstance(projectId, {
        category_id: activeCategory.id,
        component_id: payload.component_id,
        name: payload.name,
        short_name: payload.short_name,
        description: payload.description,
        short_description: payload.short_description,
        installation: payload.installation,
        unit_amount: payload.unit_amount,
        attribute_values: payload.attribute_values,
      });
      setModalState(null);
      await loadProject();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Could not create project instance.";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUpdateInstance(payload: {
    name: string;
    short_name: string | null;
    description: string | null;
    short_description: string | null;
    installation: string | null;
    unit_amount: number | null;
    attribute_values: AttributeValueInput[];
  }) {
    if (!modalState || modalState.kind !== "edit" || !activeInstance) {
      return;
    }
    setSubmitting(true);
    try {
      const request: UpdateProjectInstanceRequest = {
        name: payload.name,
        short_name: payload.short_name,
        description: payload.description,
        short_description: payload.short_description,
        installation: payload.installation,
        unit_amount: payload.unit_amount,
        attribute_values: payload.attribute_values,
      };
      await api.updateProjectInstance(projectId, activeInstance.id, request);
      setModalState(null);
      await loadProject();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Could not update project instance.";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeleteInstance(categoryId: number, instanceId: number) {
    const confirmed = window.confirm("Delete this project instance and its project-scoped records?");
    if (!confirmed) {
      return;
    }
    setError(null);
    try {
      await api.deleteProjectInstance(projectId, instanceId);
      await loadProject();
      if (window.location.hash === `#category-${categoryId}`) {
        window.location.hash = `category-${categoryId}`;
      }
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Could not delete project instance.";
      setError(message);
    }
  }

  if (loading) {
    return <div className="liquid-glass rounded-2xl p-8 text-sm text-zinc-600 dark:text-zinc-400">Loading project...</div>;
  }

  if (!data) {
    return <div className="liquid-glass rounded-2xl p-8 text-sm text-zinc-600 dark:text-zinc-400">Project not found.</div>;
  }

  const categoryTree = buildCategoryTree(data.categories);

  return (
    <div className="max-w-[1600px] mx-auto">
      {error ? (
        <div className="mb-4 rounded-xl border border-red-200 dark:border-red-500/20 bg-red-100 dark:bg-red-500/10 px-4 py-3 text-sm text-red-800 dark:text-red-200">{error}</div>
      ) : null}

      <div className="liquid-glass rounded-2xl p-8 flex justify-between items-end relative overflow-hidden mb-6">
        
        <div className="relative z-10">
          <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-2 flex items-center gap-2">
            <i className="ph-bold ph-kanban text-accent-600 dark:text-accent-500" /> Project Viewer
          </p>
          <h1 className="text-4xl font-bold text-zinc-900 dark:text-white tracking-tighter mb-2">{data.project.name}</h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400 max-w-2xl">{data.project.description || "No description provided."}</p>
        </div>
        <div className="relative z-10 flex items-center gap-4">
          <div className="flex flex-col items-end">
            <span className="text-[10px] font-mono text-zinc-500 uppercase">Status</span>
            <span className="px-2 py-1 bg-white dark:bg-white/10 shadow-sm text-zinc-900 dark:text-white rounded text-xs font-semibold">{data.project.status_label}</span>
          </div>
          <div className="flex flex-col items-end">
            <span className="text-[10px] font-mono text-zinc-500 uppercase">Instances</span>
            <span className="font-mono text-xl font-bold text-accent-700 dark:text-accent-400">{data.project.instance_count}</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        <div className="xl:col-span-3 space-y-6">
          <div className="liquid-glass rounded-2xl p-4 flex flex-col h-[60vh] sticky top-24">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xs font-bold text-zinc-500 uppercase tracking-widest flex items-center gap-2">
                <i className="ph-bold ph-list-magnifying-glass" /> Categories
              </h2>
            </div>
            <input
              value={categorySearch}
              onChange={(event) => setCategorySearch(event.target.value)}
              type="text"
              placeholder="Filter categories..."
              className="w-full bg-white dark:bg-black/40 border border-black/10 dark:border-white/10 rounded-lg py-1.5 px-3 mb-4 text-sm text-zinc-800 dark:text-zinc-300 placeholder:text-zinc-600 focus:outline-none focus:border-accent-500/50 transition-all font-mono"
            />
            <div className="flex-1 overflow-y-auto pr-2 space-y-1">
              <ProjectCategoryTree nodes={categoryTree} filterTerm={categorySearch} />
            </div>
          </div>

          <div className="liquid-glass rounded-2xl p-5">
            <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-3 flex items-center gap-2">
              <i className="ph-bold ph-git-branch text-zinc-600 dark:text-zinc-400" /> Subtype Tree
            </h3>
            <ul className="space-y-1">
              {data.subtypes.length ? data.subtypes.map((subtype) => renderSubtypeTree(subtype)) : <li className="text-xs font-mono text-zinc-500">No subtype breakdown defined.</li>}
            </ul>
          </div>
        </div>

        <div className="xl:col-span-9 flex flex-col gap-6">
          {data.categories.map((category) => (
            <div key={category.id} id={`category-${category.id}`} className="flex flex-col gap-4 mb-10 scroll-mt-24">
              <div className="flex items-end justify-between border-b border-black/10 dark:border-white/10 pb-4">
                <div>
                  <h2 className="text-2xl font-bold text-zinc-900 dark:text-white tracking-tight flex items-center gap-3">
                    {category.name}
                    <span className="px-2 py-0.5 border border-black/10 dark:border-white/10 bg-zinc-50 dark:bg-white/5 rounded text-[10px] font-mono text-zinc-600 dark:text-zinc-400 align-middle uppercase">
                      {category.scope}
                    </span>
                  </h2>
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    <span className="text-xs text-zinc-500 font-mono">Links:</span>
                    {category.linked_categories.length ? (
                      category.linked_categories.map((name) => (
                        <span key={`${category.id}-${name}`} className="px-2 py-1 bg-white dark:bg-black/40 border border-black/5 dark:border-white/5 rounded text-[10px] font-mono text-zinc-600 dark:text-zinc-400">
                          {name}
                        </span>
                      ))
                    ) : (
                      <span className="text-[10px] font-mono text-zinc-600">None</span>
                    )}
                  </div>
                </div>
                {category.available_components.length ? (
                  <button
                    type="button"
                    className="px-3 py-1.5 bg-white dark:bg-white/10 shadow-sm hover:bg-zinc-50 dark:hover:bg-white/20 text-zinc-900 dark:text-white rounded border border-black/10 dark:border-white/10 text-xs font-semibold transition-colors flex items-center gap-2"
                    onClick={() => setModalState({ kind: "create", categoryId: category.id })}
                  >
                    <i className="ph-bold ph-plus" /> Add Instance
                  </button>
                ) : (
                  <p className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest">No reusable components exist</p>
                )}
              </div>
              <div className="w-full border border-black/10 dark:border-white/10 rounded-xl overflow-hidden bg-white dark:bg-zinc-900/50 backdrop-blur-sm">
                {category.instances.length ? (
                  category.instances.map((instance) => (
                    <InstanceCard
                      key={instance.id}
                      projectId={projectId}
                      categoryId={category.id}
                      instance={instance}
                      onEdit={() => setModalState({ kind: "edit", categoryId: category.id, instanceId: instance.id })}
                      onDelete={() => void handleDeleteInstance(category.id, instance.id)}
                    />
                  ))
                ) : (
                  <div className="text-center p-6 border border-black/5 dark:border-white/5 bg-zinc-50 dark:bg-white/5 rounded-xl text-xs font-mono text-zinc-500">
                    No instances in this category.
                  </div>
                )}
              </div>
            </div>
          ))}

          <div className="mt-8 pt-8 border-t border-black/10 dark:border-white/10">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-bold text-zinc-900 dark:text-white flex items-center gap-2">
                <i className="ph-bold ph-tags text-zinc-600 dark:text-zinc-400" /> Auxiliary Elements
              </h3>
            </div>
            <div className="w-full border border-black/10 dark:border-white/10 rounded-xl overflow-hidden bg-white dark:bg-black/40">
              <table className="w-full text-left border-collapse text-sm">
                <thead className="bg-white dark:bg-black/60 border-b border-black/10 dark:border-white/10">
                  <tr>
                    <th className="px-3 py-2 text-zinc-500 font-medium">Code</th>
                    <th className="px-3 py-2 text-zinc-500 font-medium">Name</th>
                    <th className="px-3 py-2 text-zinc-500 font-medium">Category</th>
                    <th className="px-3 py-2 text-zinc-500 font-medium">Subtype</th>
                    <th className="px-3 py-2 text-zinc-500 font-medium text-right">Base Price</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {data.auxiliary_materials.length ? (
                    data.auxiliary_materials.map((row) => (
                      <tr key={`${row.code}-${row.subtype}`} className="group hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors">
                        <td className="px-3 py-3 text-zinc-500 font-mono text-xs">{row.code}</td>
                        <td className="px-3 py-3 text-zinc-900 dark:text-zinc-200 font-medium text-sm">{row.name}</td>
                        <td className="px-3 py-3 text-zinc-600 dark:text-zinc-400 text-sm">{row.category || "Uncategorized"}</td>
                        <td className="px-3 py-3 text-zinc-600 dark:text-zinc-400 text-sm">{row.subtype}</td>
                        <td className="px-3 py-3 text-right font-mono text-sm text-accent-700 dark:text-accent-400">{row.price.toLocaleString()}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={5} className="py-4 text-center text-zinc-500 font-mono text-xs">
                        No auxiliary materials selected.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {activeCategory ? (
        <InstanceFormModal
          open={modalState !== null}
          mode={modalState?.kind === "edit" ? "edit" : "create"}
          categoryName={activeCategory.name}
          availableComponents={activeCategory.available_components}
          initialInstance={activeInstance}
          submitting={submitting}
          onClose={() => setModalState(null)}
          onSubmit={modalState?.kind === "edit" ? handleUpdateInstance : handleCreateInstance}
        />
      ) : null}
    </div>
  );
}
