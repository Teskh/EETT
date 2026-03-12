import { FormEvent, useEffect, useState } from "react";

import { Modal } from "../components/Modal";
import { ApiError, api } from "../lib/api";
import type {
  AttributeValueInput,
  AvailableComponent,
  BomEntry,
  EditableAttribute,
  InstanceMaterial,
  ProjectCategorySection,
  ProjectDetailData,
  ProjectInstance,
  ProjectSubtype,
  UpdateProjectOccurrenceRequest,
  UpdateProjectInstanceRequest,
  UsageOccurrence,
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
type FlatSubtype = { id: number; name: string; depth: number };
type MaterialRowDraft = {
  subtype_id: number | null;
  quantity: string;
  assembly_quantity: string;
};
type TargetOption = {
  instance_id: number;
  instance_name: string;
  category_id: number;
  category_name: string;
  type: string;
};

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

function flattenSubtypeTree(subtypes: ProjectSubtype[], depth = 0): FlatSubtype[] {
  return subtypes.flatMap((subtype) => [
    { id: subtype.id, name: subtype.name, depth },
    ...flattenSubtypeTree(subtype.children, depth + 1),
  ]);
}

function serializeBomRows(rows: MaterialRowDraft[]) {
  return JSON.stringify(
    rows.map((row) => ({
      subtype_id: row.subtype_id,
      quantity: row.quantity,
      assembly_quantity: row.assembly_quantity,
    })),
  );
}

function buildDraftRows(rows: BomEntry[]): MaterialRowDraft[] {
  return rows.map((row) => ({
    subtype_id: row.subtype_id,
    quantity: row.quantity === null ? "" : String(row.quantity),
    assembly_quantity: row.assembly_quantity === null ? "" : String(row.assembly_quantity),
  }));
}

function parseNullableNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = Number(trimmed);
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid numeric value: ${value}`);
  }
  return parsed;
}

function quantityStateForValue(value: number | null) {
  if (value === null) {
    return "blank";
  }
  if (value === 0) {
    return "zero";
  }
  return "value";
}

function buildLocalBomEntries(
  mode: string,
  payloadEntries: Array<{ subtype_id: number | null; quantity: number | null; assembly_quantity: number | null }>,
  material: InstanceMaterial,
  subtypeOptions: FlatSubtype[],
): BomEntry[] {
  if (mode === "per_subtype") {
    const bySubtypeId = new Map(payloadEntries.map((entry) => [entry.subtype_id, entry]));
    return subtypeOptions.map((subtype) => {
      const entry = bySubtypeId.get(subtype.id) ?? {
        subtype_id: subtype.id,
        quantity: null,
        assembly_quantity: null,
      };
      return {
        subtype_id: subtype.id,
        subtype: subtype.name,
        subtype_depth: subtype.depth,
        quantity: entry.quantity,
        quantity_state: quantityStateForValue(entry.quantity),
        assembly_quantity: entry.assembly_quantity,
        assembly_quantity_state: quantityStateForValue(entry.assembly_quantity),
        unit: material.unit,
        calculation_mode: "manual",
        calculation_formula: null,
        calculation_explanation: "Manually overridden quantity",
        is_persisted: true,
      };
    });
  }

  const generalEntry = payloadEntries[0] ?? {
    subtype_id: null,
    quantity: null,
    assembly_quantity: null,
  };
  return [
    {
      subtype_id: null,
      subtype: "General",
      subtype_depth: 0,
      quantity: generalEntry.quantity,
      quantity_state: quantityStateForValue(generalEntry.quantity),
      assembly_quantity: generalEntry.assembly_quantity,
      assembly_quantity_state: quantityStateForValue(generalEntry.assembly_quantity),
      unit: material.unit,
      calculation_mode: "manual",
      calculation_formula: null,
      calculation_explanation: "Manually overridden quantity",
      is_persisted: true,
    },
  ];
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

function patchEditedInstance(
  instance: ProjectInstance,
  payload: {
    name: string;
    short_name: string | null;
    description: string | null;
    short_description: string | null;
    installation: string | null;
    unit_amount: number | null;
    attribute_values: AttributeValueInput[];
  },
): ProjectInstance {
  const nextValues = new Map(payload.attribute_values.map((attribute) => [attribute.name, attribute.value ?? null]));

  return {
    ...instance,
    name: payload.name,
    short_name: payload.short_name,
    description: payload.description,
    short_description: payload.short_description,
    installation: payload.installation,
    unit_amount: payload.unit_amount,
    editable_attributes: instance.editable_attributes.map((attribute) => ({
      ...attribute,
      value: nextValues.has(attribute.name) ? nextValues.get(attribute.name) ?? null : attribute.value,
    })),
    attributes: instance.attributes.map((group) =>
      group.application_label !== null
        ? group
        : {
            ...group,
            values: group.values.map((value) => ({
              ...value,
              value: nextValues.has(value.name) ? nextValues.get(value.name) ?? null : value.value,
            })),
          },
    ),
    sync_state: {
      ...instance.sync_state,
      status: "customized",
      is_outdated: false,
      last_synced_at: new Date().toISOString(),
      notes: "Project instance customized after snapshot creation.",
    },
  };
}

function updateCategoryInstance(
  data: ProjectDetailData,
  categoryId: number,
  instanceId: number,
  updater: (instance: ProjectInstance) => ProjectInstance,
): ProjectDetailData {
  return {
    ...data,
    categories: data.categories.map((category) =>
      category.id !== categoryId
        ? category
        : {
            ...category,
            instances: category.instances.map((instance) => (instance.id === instanceId ? updater(instance) : instance)),
          },
    ),
  };
}

function buildAttributesFromComponent(component: AvailableComponent | undefined): EditableAttribute[] {
  if (!component) {
    return [];
  }
  return component.base_attributes.map((attribute) => ({
    name: attribute.name,
    value_type: attribute.value_type,
    options: attribute.options,
    value: "",
  }));
}

function buildOccurrenceAttributeDrafts(instance: ProjectInstance, occurrence?: UsageOccurrence): EditableAttribute[] {
  const values = new Map((occurrence?.attributes || []).map((attribute) => [attribute.name, attribute.value ?? ""]));
  const drafts = instance.usage_attribute_definitions.map((attribute) => ({
    ...attribute,
    value: values.get(attribute.name) ?? "",
  }));
  const definedNames = new Set(instance.usage_attribute_definitions.map((attribute) => attribute.name));
  const extras = (occurrence?.attributes || [])
    .filter((attribute) => !definedNames.has(attribute.name))
    .map((attribute) => ({
      name: attribute.name,
      value_type: "text",
      options: [],
      value: attribute.value ?? "",
    }));
  return normalizeEditableAttributes([...drafts, ...extras]);
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

function getOccurrencePrimaryLabel(occurrence: UsageOccurrence) {
  return occurrence.context_label || occurrence.targets[0]?.instance_name || "Usage occurrence";
}

function renderOccurrenceSummary(occurrence: UsageOccurrence, index: number) {
  const primaryLabel = getOccurrencePrimaryLabel(occurrence);

  return (
    <div key={`${occurrence.relationship_type}-${primaryLabel}-${index}`} className="rounded-lg border border-black/10 dark:border-white/10 bg-zinc-50 dark:bg-white/5 p-3">
      <div className="mb-2">
        <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{primaryLabel}</div>
        <div className="text-[10px] uppercase tracking-widest font-mono text-zinc-500 dark:text-zinc-500">{occurrence.relationship_type}</div>
      </div>
      {occurrence.attributes.length ? (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {occurrence.attributes.map((attribute) => (
            <span
              key={`${primaryLabel}-${attribute.name}`}
              className="px-2 py-0.5 rounded border border-black/10 dark:border-white/10 bg-white dark:bg-black/30 text-[10px] font-mono text-zinc-700 dark:text-zinc-300"
            >
              {attribute.name}: {attribute.value || "-"}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function OccurrenceEditorCard({
  instance,
  occurrence,
  targetOptions,
  onSave,
  onDelete,
  saveLabel,
}: {
  instance: ProjectInstance;
  occurrence?: UsageOccurrence;
  targetOptions: TargetOption[];
  onSave: (payload: UpdateProjectOccurrenceRequest) => Promise<void>;
  onDelete?: () => Promise<void>;
  saveLabel: string;
}) {
  const [contextLabel, setContextLabel] = useState(occurrence?.context_label || "");
  const [targetInstanceId, setTargetInstanceId] = useState<string>(occurrence?.targets[0] ? String(occurrence.targets[0].instance_id) : "");
  const [attributes, setAttributes] = useState<EditableAttribute[]>(() => buildOccurrenceAttributeDrafts(instance, occurrence));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setContextLabel(occurrence?.context_label || "");
    setTargetInstanceId(occurrence?.targets[0] ? String(occurrence.targets[0].instance_id) : "");
    setAttributes(buildOccurrenceAttributeDrafts(instance, occurrence));
    setError(null);
  }, [instance, occurrence]);

  async function handleSave() {
    const trimmedContextLabel = contextLabel.trim();
    if (!targetInstanceId && !trimmedContextLabel) {
      setError("Select a linked item or enter a freeform location.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await onSave({
        relationship_type: occurrence?.relationship_type || "uses",
        context_label: targetInstanceId ? null : trimmedContextLabel || null,
        target_instance_id: targetInstanceId ? Number(targetInstanceId) : null,
        attribute_values: attributes.map((attribute) => ({
          name: attribute.name,
          value: (attribute.value || "").trim() || null,
        })),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save usage.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!onDelete || !window.confirm("Delete this usage?")) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onDelete();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete usage.");
      setSaving(false);
    }
  }

  return (
    <div className="rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-black/20 p-3 space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Linked Item</label>
          <select
            value={targetInstanceId}
            onChange={(event) => {
              setTargetInstanceId(event.target.value);
              if (event.target.value) {
                setContextLabel("");
              }
            }}
            className="w-full rounded border border-black/10 dark:border-white/10 bg-white dark:bg-black/30 px-2 py-1.5 text-sm"
          >
            <option value="">No linked item</option>
            {targetOptions.map((target) => (
              <option key={target.instance_id} value={target.instance_id}>
                {target.instance_name} ({target.category_name})
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Freeform Location</label>
          <input
            value={contextLabel}
            disabled={Boolean(targetInstanceId)}
            onChange={(event) => setContextLabel(event.target.value)}
            placeholder="e.g. Kitchen wall to ceiling juncture"
            className="w-full rounded border border-black/10 dark:border-white/10 bg-white disabled:bg-zinc-100 dark:bg-black/30 dark:disabled:bg-white/5 px-2 py-1.5 text-sm disabled:text-zinc-500"
          />
          <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
            {targetInstanceId ? "Clear the linked item to type a freeform location instead." : "Use this when the usage does not point to a project item."}
          </div>
        </div>
      </div>

      {attributes.length ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {attributes.map((attribute) => (
            <div key={`${occurrence?.id || "new"}-${attribute.name}`} className="flex flex-col gap-1">
              <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">{attribute.name}</label>
              {attribute.value_type === "select" ? (
                <select
                  value={attribute.value || ""}
                  onChange={(event) =>
                    setAttributes((current) =>
                      current.map((item) => (item.name === attribute.name ? { ...item, value: event.target.value } : item)),
                    )
                  }
                  className="w-full rounded border border-black/10 dark:border-white/10 bg-white dark:bg-black/30 px-2 py-1.5 text-sm"
                >
                  <option value="">Select value</option>
                  {attribute.options.map((option) => (
                    <option key={`${attribute.name}-${option}`} value={option}>
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
                      current.map((item) => (item.name === attribute.name ? { ...item, value: event.target.value } : item)),
                    )
                  }
                  className="w-full rounded border border-black/10 dark:border-white/10 bg-white dark:bg-black/30 px-2 py-1.5 text-sm"
                />
              )}
            </div>
          ))}
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-3">
        {error ? <div className="text-xs text-red-700 dark:text-red-300">{error}</div> : <div />}
        <div className="flex items-center gap-2">
          {onDelete ? (
            <button
              type="button"
              disabled={saving}
              onClick={() => void handleDelete()}
              className="px-3 py-1.5 rounded border border-red-200 dark:border-red-500/20 bg-red-100 dark:bg-red-500/10 text-xs font-semibold text-red-700 dark:text-red-300 disabled:opacity-50"
            >
              Delete
            </button>
          ) : null}
          <button
            type="button"
            disabled={saving}
            onClick={() => void handleSave()}
            className="px-3 py-1.5 rounded bg-accent-500 hover:bg-accent-400 text-xs font-semibold text-zinc-950 disabled:opacity-50"
          >
            {saving ? "Saving..." : saveLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function UsageManager({
  instance,
  targetOptions,
  onCreateOccurrence,
  onUpdateOccurrence,
  onDeleteOccurrence,
}: {
  instance: ProjectInstance;
  targetOptions: TargetOption[];
  onCreateOccurrence: (payload: UpdateProjectOccurrenceRequest) => Promise<void>;
  onUpdateOccurrence: (occurrenceId: number, payload: UpdateProjectOccurrenceRequest) => Promise<void>;
  onDeleteOccurrence: (occurrenceId: number) => Promise<void>;
}) {
  const [creating, setCreating] = useState(false);

  return (
    <div className="bg-zinc-50 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-lg p-4">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h6 className="text-xs font-bold text-zinc-500 uppercase tracking-widest flex items-center gap-2">
          <i className="ph-bold ph-flow-arrow text-zinc-600" /> Usages
        </h6>
        <button
          type="button"
          onClick={() => setCreating((current) => !current)}
          className="px-3 py-1.5 rounded border border-black/10 dark:border-white/10 bg-white dark:bg-white/5 text-xs font-semibold"
        >
          {creating ? "Cancel" : "Add usage"}
        </button>
      </div>

      <div className="space-y-3">
        {instance.outgoing_occurrences.map((occurrence) => (
          <OccurrenceEditorCard
            key={occurrence.id}
            instance={instance}
            occurrence={occurrence}
            targetOptions={targetOptions}
            saveLabel="Save usage"
            onSave={(payload) => onUpdateOccurrence(occurrence.id, payload)}
            onDelete={() => onDeleteOccurrence(occurrence.id)}
          />
        ))}

        {creating ? (
          <OccurrenceEditorCard
            instance={instance}
            targetOptions={targetOptions}
            saveLabel="Create usage"
            onSave={async (payload) => {
              await onCreateOccurrence(payload);
              setCreating(false);
            }}
          />
        ) : null}

        {!instance.outgoing_occurrences.length && !creating ? (
          <div className="text-center py-4 text-xs text-zinc-500 font-mono border border-dashed border-black/10 dark:border-white/10 rounded">
            No usages defined yet.
          </div>
        ) : null}
      </div>
    </div>
  );
}

function MaterialOccurrenceEditor({
  material,
  subtypeOptions,
  onUpdateMaterial,
}: {
  material: InstanceMaterial;
  subtypeOptions: FlatSubtype[];
  onUpdateMaterial: (ruleId: number, payload: { mode: string; entries: Array<{ subtype_id: number | null; quantity: number | null; assembly_quantity: number | null }> }) => Promise<void>;
}) {
  const [draftRows, setDraftRows] = useState<MaterialRowDraft[]>(() => buildDraftRows(material.bom_entries));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraftRows(buildDraftRows(material.bom_entries));
    setError(null);
  }, [material]);

  const baselineSignature = `${material.mode}:${serializeBomRows(buildDraftRows(material.bom_entries))}`;

  async function persistRows(rows: MaterialRowDraft[], mode: string) {
    setSaving(true);
    setError(null);
    try {
      await onUpdateMaterial(material.rule_id, {
        mode,
        entries: rows.map((row) => ({
          subtype_id: row.subtype_id,
          quantity: parseNullableNumber(row.quantity),
          assembly_quantity: parseNullableNumber(row.assembly_quantity),
        })),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not update material rows.";
      setError(message);
    } finally {
      setSaving(false);
    }
  }

  async function persistIfChanged(rows: MaterialRowDraft[]) {
    const nextSignature = `${material.mode}:${serializeBomRows(rows)}`;
    if (nextSignature === baselineSignature) {
      return;
    }
    await persistRows(rows, material.mode);
  }

  async function handleToggle(nextChecked: boolean) {
    if (nextChecked && subtypeOptions.length === 0) {
      setError("Add project subtypes before enabling subtype-specific quantities.");
      return;
    }
    const nextMode = nextChecked ? "per_subtype" : "general";
    const nextRows = nextChecked
      ? subtypeOptions.map((subtype) => ({
          subtype_id: subtype.id,
          quantity: "",
          assembly_quantity: "",
        }))
      : [{ subtype_id: null, quantity: "", assembly_quantity: "" }];
    setDraftRows(nextRows);
    await persistRows(nextRows, nextMode);
  }

  return (
    <div className="bg-white dark:bg-black/20 shadow-sm border border-black/5 dark:border-white/5 rounded-lg overflow-hidden">
      <div className="relative flex items-center justify-between gap-3 p-3 border-b border-black/5 dark:border-white/5 bg-white dark:bg-black/40">
        <div className="flex items-center gap-3 min-w-0">
          <h5 className="font-bold text-sm text-zinc-900 dark:text-white flex items-center gap-2 min-w-0">
            <span className="truncate">{material.material_name}</span>
            <span className="px-2 py-0.5 bg-white dark:bg-black/40 border border-black/5 dark:border-white/5 rounded text-[10px] font-mono text-zinc-600 dark:text-zinc-400">
              {material.sku}
            </span>
          </h5>
          <label className="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-zinc-500 shrink-0">
            <span>Subtypes</span>
            <button
              type="button"
              role="switch"
              aria-checked={material.mode === "per_subtype"}
              disabled={saving || (subtypeOptions.length === 0 && material.mode !== "per_subtype")}
              onClick={() => void handleToggle(material.mode !== "per_subtype")}
              className={`relative h-6 w-11 rounded-full transition-all duration-200 ease-out ${
                material.mode === "per_subtype"
                  ? "bg-accent-500 shadow-[inset_0_0_0_1px_rgba(249,115,22,0.85)]"
                  : "bg-zinc-300 dark:bg-zinc-600 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.08)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]"
              } disabled:opacity-50`}
            >
              <span
                className="absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.25)] transition-transform duration-200 ease-out"
                style={{
                  transform: material.mode === "per_subtype" ? "translateX(20px)" : "translateX(0px)",
                }}
              />
            </button>
          </label>
        </div>
        <div className="text-right flex flex-col items-end shrink-0">
          <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Rule Qty</span>
          <span className="text-xs font-mono text-accent-700 dark:text-accent-400">
            {material.unit_qty_per_unit ?? "-"} {material.unit || "-"}
          </span>
        </div>
        <div className="absolute right-3 bottom-1.5 min-w-14 text-right text-[10px] font-mono text-zinc-500 pointer-events-none">
          <span className={saving ? "opacity-100" : "opacity-0"}>Saving...</span>
        </div>
      </div>
      {material.notes ? (
        <div className="px-3 py-2 border-b border-black/5 dark:border-white/5 text-xs text-zinc-600 dark:text-zinc-400 bg-white dark:bg-black/20 shadow-sm">
          {material.notes}
        </div>
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse text-sm">
          <thead className="bg-white dark:bg-black/40 border-b border-black/5 dark:border-white/5">
            <tr>
              <th className="px-3 py-1.5 text-[10px] text-zinc-500 font-bold uppercase tracking-widest w-1/4">Subtype</th>
              <th className="px-3 py-1.5 text-[10px] text-zinc-500 font-bold uppercase tracking-widest text-right w-1/6">Quantity</th>
              <th className="px-3 py-1.5 text-[10px] text-zinc-500 font-bold uppercase tracking-widest text-right w-1/6">Assembly Kit</th>
              <th className="px-3 py-1.5 text-[10px] text-zinc-500 font-bold uppercase tracking-widest w-1/6">Unit</th>
              <th className="px-3 py-1.5 text-[10px] text-zinc-500 font-bold uppercase tracking-widest w-1/12">Source</th>
              <th className="px-3 py-1.5 text-[10px] text-zinc-500 font-bold uppercase tracking-widest">Formula</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {material.bom_entries.map((row, index) => (
              <tr key={`${material.rule_id}-${row.subtype_id ?? "general"}-${index}`} className={`group hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors ${quantityClass(row.quantity)}`}>
                <td className="px-3 py-2 text-zinc-800 dark:text-zinc-300 font-medium text-sm w-1/4">
                  <div style={{ paddingLeft: `${row.subtype_depth * 14}px` }}>{row.subtype}</div>
                </td>
                <td className="px-3 py-2 text-right font-mono text-sm w-1/6">
                  <input
                    value={draftRows[index]?.quantity ?? ""}
                    type="number"
                    step="any"
                    disabled={saving}
                    onChange={(event) =>
                      setDraftRows((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, quantity: event.target.value } : item,
                        ),
                      )
                    }
                    onBlur={(event) => {
                      const nextRows = draftRows.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, quantity: event.target.value } : item,
                      );
                      void persistIfChanged(nextRows);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        event.currentTarget.blur();
                      }
                    }}
                    className="w-24 rounded border border-black/10 dark:border-white/10 bg-white dark:bg-black/30 px-2 py-1 text-right"
                  />
                </td>
                <td className="px-3 py-2 text-right font-mono text-sm text-zinc-500 w-1/6">
                  <input
                    value={draftRows[index]?.assembly_quantity ?? ""}
                    type="number"
                    step="any"
                    disabled={saving}
                    onChange={(event) =>
                      setDraftRows((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, assembly_quantity: event.target.value } : item,
                        ),
                      )
                    }
                    onBlur={(event) => {
                      const nextRows = draftRows.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, assembly_quantity: event.target.value } : item,
                      );
                      void persistIfChanged(nextRows);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        event.currentTarget.blur();
                      }
                    }}
                    className="w-24 rounded border border-black/10 dark:border-white/10 bg-white dark:bg-black/30 px-2 py-1 text-right"
                  />
                </td>
                <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400 font-mono text-xs w-1/6">{row.unit || "-"}</td>
                <td className="px-3 py-2 text-zinc-500 font-mono text-[10px] uppercase w-1/12">{row.calculation_mode}</td>
                <td className="px-3 py-2 text-zinc-500 font-mono text-xs truncate max-w-[100px]" title={row.calculation_formula || "-"}>
                  {row.calculation_formula || "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {error ? <div className="px-3 pb-3 text-xs text-red-700 dark:text-red-300">{error}</div> : null}
    </div>
  );
}

function InstanceCard({
  instance,
  subtypeOptions,
  targetOptions,
  onEdit,
  onDelete,
  onCreateOccurrence,
  onUpdateOccurrence,
  onDeleteOccurrence,
  onUpdateMaterial,
}: {
  instance: ProjectInstance;
  subtypeOptions: FlatSubtype[];
  targetOptions: TargetOption[];
  onEdit: () => void;
  onDelete: () => void;
  onCreateOccurrence: (payload: UpdateProjectOccurrenceRequest) => Promise<void>;
  onUpdateOccurrence: (occurrenceId: number, payload: UpdateProjectOccurrenceRequest) => Promise<void>;
  onDeleteOccurrence: (occurrenceId: number) => Promise<void>;
  onUpdateMaterial: (ruleId: number, payload: { mode: string; entries: Array<{ subtype_id: number | null; quantity: number | null; assembly_quantity: number | null }> }) => Promise<void>;
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
              <span>{instance.name}</span>
              <button
                type="button"
                aria-label={`Edit ${instance.name}`}
                title="Edit instance"
                className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-black/10 dark:border-white/10 bg-white dark:bg-white/5 text-zinc-600 dark:text-zinc-300 transition-colors hover:bg-zinc-100 dark:hover:bg-white/10 hover:text-zinc-900 dark:hover:text-white"
                onClick={(event) => {
                  event.stopPropagation();
                  onEdit();
                }}
              >
                <i className="ph-bold ph-pencil-simple" />
              </button>
              <button
                type="button"
                aria-label={`Delete ${instance.name}`}
                title="Delete instance"
                className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-red-200 dark:border-red-500/20 bg-red-100 dark:bg-red-500/10 text-red-700 dark:text-red-400 transition-colors hover:bg-red-200 dark:hover:bg-red-500/20"
                onClick={(event) => {
                  event.stopPropagation();
                  onDelete();
                }}
              >
                <i className="ph-bold ph-trash" />
              </button>
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

              {instance.type === "accessory" ? (
                <UsageManager
                  instance={instance}
                  targetOptions={targetOptions}
                  onCreateOccurrence={onCreateOccurrence}
                  onUpdateOccurrence={onUpdateOccurrence}
                  onDeleteOccurrence={onDeleteOccurrence}
                />
              ) : instance.outgoing_occurrences.length ? (
                <div className="bg-zinc-50 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-lg p-4">
                  <h6 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-3 flex items-center gap-2">
                    <i className="ph-bold ph-flow-arrow text-zinc-600" /> Usage Summary
                  </h6>
                  <div className="space-y-3">
                    {instance.outgoing_occurrences.map(renderOccurrenceSummary)}
                  </div>
                </div>
              ) : null}

              {instance.incoming_occurrences.length ? (
                <div className="bg-zinc-50 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-lg p-4">
                  <h6 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-3 flex items-center gap-2">
                    <i className="ph-bold ph-arrow-bend-up-left text-zinc-600" /> Referenced Here
                  </h6>
                  <div className="space-y-3">
                    {instance.incoming_occurrences.map(renderOccurrenceSummary)}
                  </div>
                </div>
              ) : null}

              <div>
                <h6 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-2 flex items-center gap-2">
                  <i className="ph-bold ph-wrench text-zinc-600" /> Installation
                </h6>
                <p className="text-sm text-zinc-600 dark:text-zinc-400">{instance.installation || "No installation notes."}</p>
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
                  <MaterialOccurrenceEditor
                    key={`${instance.id}-${material.rule_id}`}
                    material={material}
                    subtypeOptions={subtypeOptions}
                    onUpdateMaterial={onUpdateMaterial}
                  />
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
      setData((current) => {
        if (!current) {
          return current;
        }
        return updateCategoryInstance(current, modalState.categoryId, activeInstance.id, (instance) =>
          patchEditedInstance(instance, payload),
        );
      });
      setModalState(null);
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

  async function handleUpdateMaterialOccurrence(
    instanceId: number,
    ruleId: number,
    payload: { mode: string; entries: Array<{ subtype_id: number | null; quantity: number | null; assembly_quantity: number | null }> },
  ) {
    setError(null);
    try {
      await api.updateMaterialOccurrence(projectId, instanceId, ruleId, payload);
      setData((current) => {
        if (!current) {
          return current;
        }
        const subtypeOptions = flattenSubtypeTree(current.subtypes);
        const category = current.categories.find((item) => item.instances.some((instance) => instance.id === instanceId));
        if (!category) {
          return current;
        }
        return updateCategoryInstance(current, category.id, instanceId, (instance) => ({
          ...instance,
          materials: instance.materials.map((material) => {
            if (material.rule_id !== ruleId) {
              return material;
            }
            return {
              ...material,
              mode: payload.mode,
              bom_entries: buildLocalBomEntries(payload.mode, payload.entries, material, subtypeOptions),
            };
          }),
        }));
      });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Could not update material rows.";
      setError(message);
      throw err;
    }
  }

  async function handleCreateOccurrence(
    instanceId: number,
    payload: UpdateProjectOccurrenceRequest,
  ) {
    setError(null);
    try {
      await api.createProjectOccurrence(projectId, instanceId, payload);
      await loadProject();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Could not create usage.";
      setError(message);
      throw err;
    }
  }

  async function handleUpdateOccurrence(
    instanceId: number,
    occurrenceId: number,
    payload: UpdateProjectOccurrenceRequest,
  ) {
    setError(null);
    try {
      await api.updateProjectOccurrence(projectId, instanceId, occurrenceId, payload);
      await loadProject();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Could not update usage.";
      setError(message);
      throw err;
    }
  }

  async function handleDeleteOccurrence(instanceId: number, occurrenceId: number) {
    setError(null);
    try {
      await api.deleteProjectOccurrence(projectId, instanceId, occurrenceId);
      await loadProject();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Could not delete usage.";
      setError(message);
      throw err;
    }
  }

  if (loading) {
    return <div className="liquid-glass rounded-2xl p-8 text-sm text-zinc-600 dark:text-zinc-400">Loading project...</div>;
  }

  if (!data) {
    return <div className="liquid-glass rounded-2xl p-8 text-sm text-zinc-600 dark:text-zinc-400">Project not found.</div>;
  }

  const categoryTree = buildCategoryTree(data.categories);
  const flatSubtypeOptions = flattenSubtypeTree(data.subtypes);
  const targetOptions: TargetOption[] = data.categories.flatMap((category) =>
    category.instances
      .filter((instance) => instance.type === "item")
      .map((instance) => ({
        instance_id: instance.id,
        instance_name: instance.name,
        category_id: category.id,
        category_name: category.name,
        type: instance.type,
      })),
  );

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
                      instance={instance}
                      subtypeOptions={flatSubtypeOptions}
                      targetOptions={targetOptions.filter(
                        (target) =>
                          target.instance_id !== instance.id &&
                          (category.linked_category_ids.length === 0 || category.linked_category_ids.includes(target.category_id)),
                      )}
                      onEdit={() => setModalState({ kind: "edit", categoryId: category.id, instanceId: instance.id })}
                      onDelete={() => void handleDeleteInstance(category.id, instance.id)}
                      onCreateOccurrence={(payload) => handleCreateOccurrence(instance.id, payload)}
                      onUpdateOccurrence={(occurrenceId, payload) => handleUpdateOccurrence(instance.id, occurrenceId, payload)}
                      onDeleteOccurrence={(occurrenceId) => handleDeleteOccurrence(instance.id, occurrenceId)}
                      onUpdateMaterial={(ruleId, payload) => handleUpdateMaterialOccurrence(instance.id, ruleId, payload)}
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
