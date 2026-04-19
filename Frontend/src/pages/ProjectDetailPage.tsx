import { FormEvent, startTransition, useEffect, useRef, useState } from "react";

import { MaterialCalculationSheetModal } from "../components/MaterialCalculationSheetModal";
import { Modal } from "../components/Modal";
import { ApiError, api } from "../lib/api";
import type {
  AttributeValueInput,
  AvailableComponent,
  BomEntry,
  EditableAttribute,
  InstanceSyncPreview,
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
  onTitleChange?: (title: string) => void;
};

type ModalState =
  | { kind: "create"; categoryId: number }
  | { kind: "edit"; categoryId: number; instanceId: number }
  | null;

type CalculationSheetState = {
  instanceId: number;
  instanceName: string;
  material: InstanceMaterial;
} | null;

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
type SyncFieldKey = "name" | "short_name" | "description" | "short_description" | "installation" | "attributes";
type SyncModalState = {
  instanceId: number;
  field: SyncFieldKey;
} | null;

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

function buildMaterialDraftSignature(mode: string, rows: MaterialRowDraft[]) {
  return `${mode}:${serializeBomRows(rows)}`;
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

function parseDisplayNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isNaN(parsed) ? null : parsed;
}

function buildDraftDisplayRows(
  mode: string,
  draftRows: MaterialRowDraft[],
  material: InstanceMaterial,
  subtypeOptions: FlatSubtype[],
): BomEntry[] {
  const bySubtypeId = new Map(material.bom_entries.map((entry) => [entry.subtype_id, entry]));

  if (mode === "per_subtype") {
    return subtypeOptions.map((subtype) => {
      const draftRow = draftRows.find((row) => row.subtype_id === subtype.id) || {
        subtype_id: subtype.id,
        quantity: "",
        assembly_quantity: "",
      };
      const persisted = bySubtypeId.get(subtype.id);
      const quantity = parseDisplayNumber(draftRow.quantity);
      const assemblyQuantity = parseDisplayNumber(draftRow.assembly_quantity);
      return {
        subtype_id: subtype.id,
        subtype: subtype.name,
        subtype_depth: subtype.depth,
        quantity,
        quantity_state: quantityStateForValue(quantity),
        assembly_quantity: assemblyQuantity,
        assembly_quantity_state: quantityStateForValue(assemblyQuantity),
        unit: material.unit,
        calculation_mode: persisted?.calculation_mode || "manual",
        calculation_formula: persisted?.calculation_formula || null,
        calculation_explanation: persisted?.calculation_explanation || null,
        is_persisted: Boolean(persisted),
      };
    });
  }

  const generalDraft = draftRows[0] || {
    subtype_id: null,
    quantity: "",
    assembly_quantity: "",
  };
  const persisted = bySubtypeId.get(null) || null;
  const quantity = parseDisplayNumber(generalDraft.quantity);
  const assemblyQuantity = parseDisplayNumber(generalDraft.assembly_quantity);
  return [
    {
      subtype_id: null,
      subtype: "General",
      subtype_depth: 0,
      quantity,
      quantity_state: quantityStateForValue(quantity),
      assembly_quantity: assemblyQuantity,
      assembly_quantity_state: quantityStateForValue(assemblyQuantity),
      unit: material.unit,
      calculation_mode: persisted?.calculation_mode || "manual",
      calculation_formula: persisted?.calculation_formula || null,
      calculation_explanation: persisted?.calculation_explanation || null,
      is_persisted: Boolean(persisted),
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

function sortInstances(instances: ProjectInstance[]) {
  return [...instances].sort((left, right) => left.name.localeCompare(right.name));
}

function upsertCategoryInstance(
  data: ProjectDetailData,
  categoryId: number,
  nextInstance: ProjectInstance,
): ProjectDetailData {
  const nextData = {
    ...data,
    categories: data.categories.map((category) => {
      const exists = category.id === categoryId && category.instances.some((instance) => instance.id === nextInstance.id);
      const nextInstances = category.instances.map((instance) => {
        const baseInstance = category.id === categoryId && instance.id === nextInstance.id ? nextInstance : instance;
        return {
          ...baseInstance,
          outgoing_occurrences: baseInstance.outgoing_occurrences.map((occurrence) => ({
            ...occurrence,
            targets: occurrence.targets.map((target) =>
              target.instance_id === nextInstance.id ? { ...target, instance_name: nextInstance.name } : target,
            ),
          })),
        };
      });

      if (category.id !== categoryId) {
        return {
          ...category,
          instances: nextInstances,
        };
      }

      return {
        ...category,
        instances: sortInstances(exists ? nextInstances : [...nextInstances, nextInstance]),
      };
    }),
  };
  return withRecomputedIncomingOccurrences(nextData);
}

function upsertOccurrence(occurrences: UsageOccurrence[], nextOccurrence: UsageOccurrence) {
  const existingIndex = occurrences.findIndex((occurrence) => occurrence.id === nextOccurrence.id);
  if (existingIndex === -1) {
    return [...occurrences, nextOccurrence];
  }
  return occurrences.map((occurrence) => (occurrence.id === nextOccurrence.id ? nextOccurrence : occurrence));
}

function withRecomputedIncomingOccurrences(data: ProjectDetailData): ProjectDetailData {
  const incomingByInstanceId = new Map<number, UsageOccurrence[]>();

  for (const category of data.categories) {
    for (const instance of category.instances) {
      for (const occurrence of instance.outgoing_occurrences) {
        for (const target of occurrence.targets) {
          const current = incomingByInstanceId.get(target.instance_id) || [];
          current.push(occurrence);
          incomingByInstanceId.set(target.instance_id, current);
        }
      }
    }
  }

  return {
    ...data,
    categories: data.categories.map((category) => ({
      ...category,
      instances: category.instances.map((instance) => ({
        ...instance,
        incoming_occurrences: incomingByInstanceId.get(instance.id) || [],
      })),
    })),
  };
}

function applyOccurrenceToProject(
  data: ProjectDetailData,
  sourceInstanceId: number,
  occurrence: UsageOccurrence,
): ProjectDetailData {
  const nextData = {
    ...data,
    categories: data.categories.map((category) => ({
      ...category,
      instances: category.instances.map((instance) =>
        instance.id === sourceInstanceId
          ? { ...instance, outgoing_occurrences: upsertOccurrence(instance.outgoing_occurrences, occurrence) }
          : instance,
      ),
    })),
  };
  return withRecomputedIncomingOccurrences(nextData);
}

function removeOccurrenceFromProject(
  data: ProjectDetailData,
  sourceInstanceId: number,
  occurrenceId: number,
): ProjectDetailData {
  const nextData = {
    ...data,
    categories: data.categories.map((category) => ({
      ...category,
      instances: category.instances.map((instance) =>
        instance.id === sourceInstanceId
          ? {
              ...instance,
              outgoing_occurrences: instance.outgoing_occurrences.filter((occurrence) => occurrence.id !== occurrenceId),
            }
          : instance,
      ),
    })),
  };
  return withRecomputedIncomingOccurrences(nextData);
}

function removeInstanceFromProject(data: ProjectDetailData, instanceId: number): ProjectDetailData {
  const nextCategories = data.categories.map((category) => ({
    ...category,
    instances: category.instances
      .filter((instance) => instance.id !== instanceId)
      .map((instance) => ({
        ...instance,
        outgoing_occurrences: instance.outgoing_occurrences.map((occurrence) => ({
          ...occurrence,
          targets: occurrence.targets.filter((target) => target.instance_id !== instanceId),
        })),
      })),
  }));

  const nextData = {
    ...data,
    project: {
      ...data.project,
      instance_count: Math.max(0, data.project.instance_count - 1),
    },
    categories: nextCategories,
  };
  return withRecomputedIncomingOccurrences(nextData);
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

function getIncomingOccurrencePrimaryLabel(instance: ProjectInstance, occurrence: UsageOccurrence, index: number) {
  const matchingLink = instance.linked_accessories.find(
    (link) =>
      link.relationship_type === occurrence.relationship_type &&
      (link.application_label || null) === (occurrence.context_label || null),
  );

  return matchingLink?.name || instance.linked_accessories[index]?.name || getOccurrencePrimaryLabel(occurrence);
}

function renderOccurrenceSummary(
  occurrence: UsageOccurrence,
  index: number,
  options?: {
    primaryLabel?: string;
    secondaryLabel?: string | null;
  },
) {
  const primaryLabel = options?.primaryLabel || getOccurrencePrimaryLabel(occurrence);
  const secondaryLabel = options?.secondaryLabel?.trim() || null;

  return (
    <div key={`${occurrence.relationship_type}-${primaryLabel}-${index}`} className="rounded-lg border border-black/10 dark:border-white/10 bg-zinc-50 dark:bg-white/5 p-3">
      <div className="mb-2">
        <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{primaryLabel}</div>
        {secondaryLabel && secondaryLabel !== primaryLabel ? (
          <div className="text-xs text-zinc-500 dark:text-zinc-400">{secondaryLabel}</div>
        ) : null}
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

function getScalarSyncField(preview: InstanceSyncPreview | null | undefined, field: SyncFieldKey) {
  if (!preview || field === "attributes") {
    return null;
  }
  return preview.scalar_fields.find((item) => item.field === field) || null;
}

function getSyncStatusMeta(status: string) {
  switch (status) {
    case "customized":
      return {
        label: "Custom",
        className: "border-sky-200 text-sky-700 bg-sky-50 dark:border-sky-500/20 dark:bg-sky-500/10 dark:text-sky-300",
      };
    case "stale":
      return {
        label: "Stale",
        className: "border-amber-200 text-amber-700 bg-amber-50 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300",
      };
    case "conflict":
      return {
        label: "Conflict",
        className: "border-red-200 text-red-700 bg-red-50 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300",
      };
    case "out_of_sync":
      return {
        label: "Schema",
        className: "border-amber-200 text-amber-700 bg-amber-50 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300",
      };
    default:
      return null;
  }
}

function SyncIndicatorButton({
  status,
  onClick,
  title,
}: {
  status: string | null | undefined;
  onClick: () => void;
  title: string;
}) {
  const meta = status ? getSyncStatusMeta(status) : null;
  if (!meta) {
    return null;
  }

  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest transition-colors hover:opacity-80 ${meta.className}`}
    >
      {meta.label}
    </button>
  );
}

function SyncValuePanel({
  label,
  value,
}: {
  label: string;
  value: string | null;
}) {
  return (
    <div className="rounded-lg border border-black/10 dark:border-white/10 bg-zinc-50 dark:bg-white/5 p-3">
      <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-2">{label}</div>
      <div className="text-sm text-zinc-900 dark:text-zinc-100 whitespace-pre-wrap break-words">{value || "Empty"}</div>
    </div>
  );
}

function InstanceSyncModal({
  open,
  instance,
  preview,
  loading,
  targetField,
  syncing,
  onClose,
  onRefreshAll,
  onApplyCatalogField,
  onApplyInstanceField,
  onAddAttributes,
  onRemoveAttributes,
}: {
  open: boolean;
  instance: ProjectInstance | null;
  preview: InstanceSyncPreview | null;
  loading: boolean;
  targetField: SyncFieldKey | null;
  syncing: boolean;
  onClose: () => void;
  onRefreshAll: () => Promise<void>;
  onApplyCatalogField: (field: Exclude<SyncFieldKey, "attributes">) => Promise<void>;
  onApplyInstanceField: (field: Exclude<SyncFieldKey, "attributes">) => Promise<void>;
  onAddAttributes: (names: string[]) => Promise<void>;
  onRemoveAttributes: (names: string[]) => Promise<void>;
}) {
  if (!open || !instance || !targetField) {
    return null;
  }

  const scalarField = targetField === "attributes" ? null : getScalarSyncField(preview, targetField);
  const attributeSchema = targetField === "attributes" ? preview?.attribute_schema ?? null : null;
  const missingAttributes = attributeSchema?.differences.filter((item) => item.status === "missing_in_instance") || [];
  const extraAttributes = attributeSchema?.differences.filter((item) => item.status === "extra_in_instance") || [];
  const status = targetField === "attributes" ? attributeSchema?.status : scalarField?.status;
  const statusMeta = status ? getSyncStatusMeta(status) : null;

  return (
    <Modal
      open={open}
      title={`${instance.name} Sync`}
      kicker="Field Status"
      onClose={onClose}
      panelClassName="max-w-3xl"
    >
      {loading || !preview ? (
        <div className="text-sm text-zinc-600 dark:text-zinc-400">Loading sync details...</div>
      ) : targetField === "attributes" && attributeSchema ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-bold uppercase tracking-widest text-zinc-500">{attributeSchema.label}</div>
              <div className="text-sm text-zinc-600 dark:text-zinc-400">
                {attributeSchema.differences.length
                  ? "Catalog and instance attribute rows differ."
                  : "Instance base attributes match the catalog schema."}
              </div>
            </div>
            {statusMeta ? <span className={`rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-widest ${statusMeta.className}`}>{statusMeta.label}</span> : null}
          </div>

          {missingAttributes.length ? (
            <div className="rounded-lg border border-black/10 dark:border-white/10 p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Missing in Instance</div>
                <button
                  type="button"
                  disabled={syncing}
                  onClick={() => void onAddAttributes(missingAttributes.map((item) => item.name))}
                  className="px-3 py-1.5 rounded border border-black/10 dark:border-white/10 bg-white dark:bg-white/5 text-xs font-semibold disabled:opacity-50"
                >
                  Add All
                </button>
              </div>
              <div className="space-y-2">
                {missingAttributes.map((item) => (
                  <div key={`missing-${item.name}`} className="flex items-center justify-between gap-3 rounded-lg bg-zinc-50 dark:bg-white/5 p-3">
                    <div>
                      <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{item.name}</div>
                      <div className="text-xs text-zinc-500 dark:text-zinc-400">
                        {item.catalog_definition?.value_type || "text"}
                        {item.catalog_definition?.options.length ? ` • ${item.catalog_definition.options.join(", ")}` : ""}
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={syncing}
                      onClick={() => void onAddAttributes([item.name])}
                      className="px-3 py-1.5 rounded bg-accent-500 hover:bg-accent-400 text-xs font-semibold text-zinc-950 disabled:opacity-50"
                    >
                      Add
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {extraAttributes.length ? (
            <div className="rounded-lg border border-black/10 dark:border-white/10 p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Extra in Instance</div>
                <button
                  type="button"
                  disabled={syncing}
                  onClick={() => void onRemoveAttributes(extraAttributes.map((item) => item.name))}
                  className="px-3 py-1.5 rounded border border-red-200 dark:border-red-500/20 bg-red-100 dark:bg-red-500/10 text-xs font-semibold text-red-700 dark:text-red-300 disabled:opacity-50"
                >
                  Remove All
                </button>
              </div>
              <div className="space-y-2">
                {extraAttributes.map((item) => (
                  <div key={`extra-${item.name}`} className="flex items-center justify-between gap-3 rounded-lg bg-zinc-50 dark:bg-white/5 p-3">
                    <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{item.name}</div>
                    <button
                      type="button"
                      disabled={syncing}
                      onClick={() => void onRemoveAttributes([item.name])}
                      className="px-3 py-1.5 rounded border border-red-200 dark:border-red-500/20 bg-red-100 dark:bg-red-500/10 text-xs font-semibold text-red-700 dark:text-red-300 disabled:opacity-50"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {!attributeSchema.differences.length ? (
            <div className="rounded-lg border border-dashed border-black/10 dark:border-white/10 p-4 text-sm text-zinc-500 dark:text-zinc-400">
              No schema differences detected.
            </div>
          ) : null}
        </div>
      ) : scalarField ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-bold uppercase tracking-widest text-zinc-500">{scalarField.label}</div>
              <div className="text-sm text-zinc-600 dark:text-zinc-400">
                Compare the catalog value against the current instance value.
              </div>
            </div>
            {statusMeta ? <span className={`rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-widest ${statusMeta.className}`}>{statusMeta.label}</span> : null}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <SyncValuePanel label="Catalog" value={scalarField.catalog_value} />
            <SyncValuePanel label="Instance" value={scalarField.instance_value} />
          </div>

          {scalarField.can_apply_catalog ? (
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                disabled={syncing}
                onClick={() => void onApplyInstanceField(targetField)}
                className="px-4 py-2 rounded border border-black/10 dark:border-white/10 bg-white dark:bg-white/5 text-sm font-semibold disabled:opacity-50"
              >
                Apply Instance Value to Catalog
              </button>
              <button
                type="button"
                disabled={syncing}
                onClick={() => void onApplyCatalogField(targetField)}
                className="px-4 py-2 rounded bg-accent-500 hover:bg-accent-400 text-sm font-semibold text-zinc-950 disabled:opacity-50"
              >
                Apply Catalog Value
              </button>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="text-sm text-zinc-600 dark:text-zinc-400">No sync details found for this field.</div>
      )}

      <div className="flex justify-end pt-5 mt-5 border-t border-black/10 dark:border-white/10">
        <button
          type="button"
          disabled={syncing}
          onClick={() => void onRefreshAll()}
          className="px-4 py-2 rounded border border-black/10 dark:border-white/10 bg-white dark:bg-white/5 text-sm font-semibold disabled:opacity-50"
        >
          Refresh All Tracked Fields
        </button>
      </div>
    </Modal>
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
  onOpenCalculationSheet,
  onUpdateMaterial,
}: {
  material: InstanceMaterial;
  subtypeOptions: FlatSubtype[];
  onOpenCalculationSheet: () => void;
  onUpdateMaterial: (ruleId: number, payload: { mode: string; entries: Array<{ subtype_id: number | null; quantity: number | null; assembly_quantity: number | null }> }) => Promise<void>;
}) {
  const [draftRows, setDraftRows] = useState<MaterialRowDraft[]>(() => buildDraftRows(material.bom_entries));
  const [draftMode, setDraftMode] = useState(material.mode);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const serverSignatureRef = useRef(buildMaterialDraftSignature(material.mode, buildDraftRows(material.bom_entries)));
  const saveQueueRef = useRef<{
    inFlight: boolean;
    queued: { mode: string; rows: MaterialRowDraft[] } | null;
  }>({
    inFlight: false,
    queued: null,
  });
  const draftSignature = buildMaterialDraftSignature(draftMode, draftRows);
  const displayRows = buildDraftDisplayRows(draftMode, draftRows, material, subtypeOptions);

  useEffect(() => {
    const nextRows = buildDraftRows(material.bom_entries);
    const serverSignature = buildMaterialDraftSignature(material.mode, nextRows);
    serverSignatureRef.current = serverSignature;
    if (draftSignature === serverSignature) {
      setDraftMode(material.mode);
      setDraftRows(nextRows);
      setError(null);
    }
  }, [material]);

  async function pumpSaveQueue(mode: string, rows: MaterialRowDraft[]) {
    if (saveQueueRef.current.inFlight) {
      saveQueueRef.current.queued = { mode, rows };
      setSaving(true);
      return;
    }

    saveQueueRef.current.inFlight = true;
    setSaving(true);

    let nextPayload: { mode: string; rows: MaterialRowDraft[] } | null = { mode, rows };
    while (nextPayload) {
      setError(null);
      try {
        await onUpdateMaterial(material.rule_id, {
          mode: nextPayload.mode,
          entries: nextPayload.rows.map((row) => ({
            subtype_id: row.subtype_id,
            quantity: parseNullableNumber(row.quantity),
            assembly_quantity: parseNullableNumber(row.assembly_quantity),
          })),
        });
        serverSignatureRef.current = buildMaterialDraftSignature(nextPayload.mode, nextPayload.rows);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Could not update material rows.";
        setError(message);
      }

      nextPayload = saveQueueRef.current.queued;
      saveQueueRef.current.queued = null;
    }

    saveQueueRef.current.inFlight = false;
    setSaving(false);
  }

  function persistIfChanged(rows: MaterialRowDraft[], mode: string) {
    const nextSignature = buildMaterialDraftSignature(mode, rows);
    if (nextSignature === serverSignatureRef.current) {
      return;
    }
    void pumpSaveQueue(mode, rows);
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
    setDraftMode(nextMode);
    setDraftRows(nextRows);
    persistIfChanged(nextRows, nextMode);
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
              aria-checked={draftMode === "per_subtype"}
              disabled={subtypeOptions.length === 0 && draftMode !== "per_subtype"}
              onClick={() => void handleToggle(draftMode !== "per_subtype")}
              className={`relative h-6 w-11 rounded-full transition-all duration-200 ease-out ${
                draftMode === "per_subtype"
                  ? "bg-accent-500 shadow-[inset_0_0_0_1px_rgba(249,115,22,0.85)]"
                  : "bg-zinc-300 dark:bg-zinc-600 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.08)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]"
              } disabled:opacity-50`}
            >
              <span
                className="absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.25)] transition-transform duration-200 ease-out"
                style={{
                  transform: draftMode === "per_subtype" ? "translateX(20px)" : "translateX(0px)",
                }}
              />
            </button>
          </label>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={onOpenCalculationSheet}
            aria-label={`Open calculation sheet for ${material.material_name}`}
            title="Open calculation sheet"
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-black/10 dark:border-white/10 bg-zinc-50 dark:bg-white/5 text-zinc-800 dark:text-zinc-200"
          >
            <i className="ph-bold ph-table" />
          </button>
          <div className="text-right flex flex-col items-end">
            <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Rule Qty</span>
            <span className="text-xs font-mono text-accent-700 dark:text-accent-400">
              {material.unit_qty_per_unit ?? "-"} {material.unit || "-"}
            </span>
          </div>
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
            {displayRows.map((row, index) => (
              <tr key={`${material.rule_id}-${row.subtype_id ?? "general"}-${index}`} className={`group hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors ${quantityClass(row.quantity)}`}>
                <td className="px-3 py-2 text-zinc-800 dark:text-zinc-300 font-medium text-sm w-1/4">
                  <div style={{ paddingLeft: `${row.subtype_depth * 14}px` }}>{row.subtype}</div>
                </td>
                <td className="px-3 py-2 text-right font-mono text-sm w-1/6">
                  <input
                    value={draftRows[index]?.quantity ?? ""}
                    type="number"
                    step="any"
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
                      persistIfChanged(nextRows, draftMode);
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
                      persistIfChanged(nextRows, draftMode);
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
  syncPreview,
  syncPreviewLoading,
  onEnsureSyncPreview,
  onOpenSyncModal,
  onEdit,
  onDelete,
  onOpenCalculationSheet,
  onCreateOccurrence,
  onUpdateOccurrence,
  onDeleteOccurrence,
  onUpdateMaterial,
}: {
  instance: ProjectInstance;
  subtypeOptions: FlatSubtype[];
  targetOptions: TargetOption[];
  syncPreview: InstanceSyncPreview | null;
  syncPreviewLoading: boolean;
  onEnsureSyncPreview: () => Promise<void>;
  onOpenSyncModal: (field: SyncFieldKey) => void;
  onEdit: () => void;
  onDelete: () => void;
  onOpenCalculationSheet: (material: InstanceMaterial) => void;
  onCreateOccurrence: (payload: UpdateProjectOccurrenceRequest) => Promise<void>;
  onUpdateOccurrence: (occurrenceId: number, payload: UpdateProjectOccurrenceRequest) => Promise<void>;
  onDeleteOccurrence: (occurrenceId: number) => Promise<void>;
  onUpdateMaterial: (ruleId: number, payload: { mode: string; entries: Array<{ subtype_id: number | null; quantity: number | null; assembly_quantity: number | null }> }) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [materialsExpanded, setMaterialsExpanded] = useState(true);
  const nameSync = getScalarSyncField(syncPreview, "name");
  const shortNameSync = getScalarSyncField(syncPreview, "short_name");
  const descriptionSync = getScalarSyncField(syncPreview, "description");
  const shortDescriptionSync = getScalarSyncField(syncPreview, "short_description");
  const installationSync = getScalarSyncField(syncPreview, "installation");
  const attributeSchemaSync = syncPreview?.attribute_schema ?? null;

  useEffect(() => {
    if (expanded && !syncPreview && !syncPreviewLoading) {
      void onEnsureSyncPreview();
    }
  }, [expanded, onEnsureSyncPreview, syncPreview, syncPreviewLoading]);

  return (
    <div className="border-b border-black/10 dark:border-white/10 last:border-0">
      <div 
        className="flex items-center justify-between p-4 bg-white dark:bg-black/20 shadow-sm group hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors cursor-pointer"
        onClick={() => setExpanded((current) => !current)}
      >
        <div className="min-w-0">
          <div className="font-bold text-zinc-900 dark:text-white text-[15px] flex items-center gap-2 min-w-0">
            <span className="truncate">{instance.name}</span>
            <SyncIndicatorButton
              status={nameSync?.status}
              title="View name sync details"
              onClick={() => onOpenSyncModal("name")}
            />
            <span className="px-2 py-0.5 border border-black/10 dark:border-white/10 bg-white dark:bg-black/40 rounded text-[10px] font-mono text-zinc-500 align-middle">
              {instance.short_name || instance.name}
            </span>
            <SyncIndicatorButton
              status={shortNameSync?.status}
              title="View short name sync details"
              onClick={() => onOpenSyncModal("short_name")}
            />
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <div className="flex items-center gap-2 opacity-0 pointer-events-none transition-opacity group-hover:opacity-100 group-hover:pointer-events-auto focus-within:opacity-100 focus-within:pointer-events-auto">
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
          </div>
          <i className={`ph-bold ${expanded ? "ph-caret-up" : "ph-caret-down"} text-zinc-600 dark:text-zinc-300`} />
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
                <div className="mb-3">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Description</span>
                    <SyncIndicatorButton
                      status={descriptionSync?.status}
                      title="View description sync details"
                      onClick={() => onOpenSyncModal("description")}
                    />
                  </div>
                  <p className="text-sm text-zinc-800 dark:text-zinc-300">{instance.description || "No description provided."}</p>
                </div>
                <div className="mb-3">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Short Description</span>
                    <SyncIndicatorButton
                      status={shortDescriptionSync?.status}
                      title="View short description sync details"
                      onClick={() => onOpenSyncModal("short_description")}
                    />
                  </div>
                  <p className="text-xs text-zinc-600 dark:text-zinc-400">
                    {instance.short_description || "No short description."}
                  </p>
                </div>
                <div className="flex items-center gap-4 text-xs font-mono">
                  <span className="text-zinc-600 dark:text-zinc-400">
                    Unit Amount: <strong className="text-zinc-900 dark:text-zinc-200">{instance.unit_amount ?? "-"}</strong>
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
                    {instance.incoming_occurrences.map((occurrence, index) =>
                      renderOccurrenceSummary(occurrence, index, {
                        primaryLabel: getIncomingOccurrencePrimaryLabel(instance, occurrence, index),
                        secondaryLabel: occurrence.context_label,
                      }),
                    )}
                  </div>
                </div>
              ) : null}

              <div>
                <h6 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-2 flex items-center gap-2">
                  <i className="ph-bold ph-wrench text-zinc-600" /> Installation
                  <SyncIndicatorButton
                    status={installationSync?.status}
                    title="View installation sync details"
                    onClick={() => onOpenSyncModal("installation")}
                  />
                </h6>
                <p className="text-sm text-zinc-600 dark:text-zinc-400">{instance.installation || "No installation notes."}</p>
              </div>
            </div>

            <div className="bg-white dark:bg-black/40 border border-black/5 dark:border-white/5 rounded-lg p-4">
              <div className="flex items-center justify-between gap-3 mb-4">
                <h5 className="text-xs font-bold text-zinc-500 uppercase tracking-widest flex items-center gap-2">
                  <i className="ph-bold ph-list-dashes text-zinc-600" /> Attributes
                </h5>
                <SyncIndicatorButton
                  status={attributeSchemaSync?.status}
                  title="View attribute sync details"
                  onClick={() => onOpenSyncModal("attributes")}
                />
              </div>
              {instance.attributes.length ? (
                instance.attributes.map((group) => (
                  <div key={`${instance.id}-${group.name}`} className="mb-4 last:mb-0">
                    <h5 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-2 flex items-center gap-2">
                      <i className="ph-bold ph-list-dashes text-zinc-600" /> {group.name}
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
            <button
              type="button"
              onClick={() => setMaterialsExpanded((current) => !current)}
              className="w-full flex items-center justify-between text-left mb-4"
            >
              <h6 className="text-xs font-bold text-zinc-500 uppercase tracking-widest flex items-center gap-2">
                <i className="ph-bold ph-boxes text-zinc-600" /> Applicable Materials
              </h6>
              <i className={`ph-bold ${materialsExpanded ? "ph-caret-up" : "ph-caret-down"} text-zinc-600 dark:text-zinc-300`} />
            </button>
            {materialsExpanded ? (
              <div className="space-y-4">
                {instance.materials.length ? (
                  instance.materials.map((material) => (
                    <MaterialOccurrenceEditor
                      key={`${instance.id}-${material.rule_id}`}
                      material={material}
                      subtypeOptions={subtypeOptions}
                      onOpenCalculationSheet={() => onOpenCalculationSheet(material)}
                      onUpdateMaterial={onUpdateMaterial}
                    />
                  ))
                ) : (
                  <div className="text-center py-6 text-xs text-zinc-500 font-mono border border-dashed border-black/10 dark:border-white/10 rounded">
                    No applicable materials resolved for this instance.
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function ProjectDetailPage({ projectId, onTitleChange }: ProjectDetailPageProps) {
  const [data, setData] = useState<ProjectDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [categorySearch, setCategorySearch] = useState("");
  const [modalState, setModalState] = useState<ModalState>(null);
  const [calculationSheetState, setCalculationSheetState] = useState<CalculationSheetState>(null);
  const [syncModalState, setSyncModalState] = useState<SyncModalState>(null);
  const [syncPreviews, setSyncPreviews] = useState<Record<number, InstanceSyncPreview>>({});
  const [syncPreviewLoading, setSyncPreviewLoading] = useState<Record<number, boolean>>({});
  const [syncingInstanceId, setSyncingInstanceId] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function loadProject(showSpinner = true) {
    if (showSpinner) {
      setLoading(true);
    }
    setError(null);
    try {
      setData(await api.getProject(projectId));
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Could not load project.";
      setError(message);
    } finally {
      if (showSpinner) {
        setLoading(false);
      }
    }
  }

  async function ensureSyncPreview(instanceId: number, force = false) {
    if (!force && syncPreviews[instanceId]) {
      return syncPreviews[instanceId];
    }
    setSyncPreviewLoading((current) => ({ ...current, [instanceId]: true }));
    try {
      const preview = await api.getProjectInstanceSyncPreview(projectId, instanceId);
      setSyncPreviews((current) => ({ ...current, [instanceId]: preview }));
      return preview;
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Could not load sync details.";
      setError(message);
      throw err;
    } finally {
      setSyncPreviewLoading((current) => ({ ...current, [instanceId]: false }));
    }
  }

  useEffect(() => {
    onTitleChange?.("Project");
    setSyncPreviews({});
    setSyncPreviewLoading({});
    setSyncModalState(null);
    void loadProject();
  }, [onTitleChange, projectId]);

  useEffect(() => {
    if (data?.project.name) {
      onTitleChange?.(data.project.name);
    }
  }, [data?.project.name, onTitleChange]);

  const activeCategory =
    modalState && data
      ? data.categories.find((category) => category.id === modalState.categoryId) || null
      : null;

  const activeInstance =
    modalState?.kind === "edit" && activeCategory
      ? activeCategory.instances.find((instance) => instance.id === modalState.instanceId)
      : undefined;

  const activeSyncInstance = syncModalState && data
    ? data.categories.flatMap((category) => category.instances).find((instance) => instance.id === syncModalState.instanceId) || null
    : null;

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
      const result = await api.createProjectInstance(projectId, {
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
      if (result.instance) {
        setData((current) => (current ? upsertCategoryInstance(current, activeCategory.id, result.instance as ProjectInstance) : current));
      }
      setModalState(null);
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
      const result = await api.updateProjectInstance(projectId, activeInstance.id, request);
      if (result.instance) {
        setData((current) => (current ? upsertCategoryInstance(current, modalState.categoryId, result.instance as ProjectInstance) : current));
      }
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
      setData((current) => (current ? removeInstanceFromProject(current, instanceId) : current));
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
      startTransition(() => {
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
      const result = await api.createProjectOccurrence(projectId, instanceId, payload);
      if (result.occurrence) {
        setData((current) =>
          current ? applyOccurrenceToProject(current, instanceId, result.occurrence as UsageOccurrence) : current,
        );
      }
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
      const result = await api.updateProjectOccurrence(projectId, instanceId, occurrenceId, payload);
      if (result.occurrence) {
        setData((current) =>
          current ? applyOccurrenceToProject(current, instanceId, result.occurrence as UsageOccurrence) : current,
        );
      }
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
      setData((current) => (current ? removeOccurrenceFromProject(current, instanceId, occurrenceId) : current));
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Could not delete usage.";
      setError(message);
      throw err;
    }
  }

  async function openSyncModal(instanceId: number, field: SyncFieldKey) {
    setSyncModalState({ instanceId, field });
    try {
      await ensureSyncPreview(instanceId);
    } catch {
      // Error state is already surfaced through the page banner.
    }
  }

  async function refreshProjectAndSyncPreview(instanceId: number, nextPreview?: InstanceSyncPreview) {
    if (nextPreview) {
      setSyncPreviews((current) => ({ ...current, [instanceId]: nextPreview }));
    }
    await loadProject(false);
    await ensureSyncPreview(instanceId, true);
  }

  async function handleRefreshSync(instanceId: number) {
    setSyncingInstanceId(instanceId);
    setError(null);
    try {
      const preview = await api.refreshProjectInstanceSync(projectId, instanceId);
      await refreshProjectAndSyncPreview(instanceId, preview);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Could not refresh tracked fields.";
      setError(message);
    } finally {
      setSyncingInstanceId(null);
    }
  }

  async function handleApplyCatalogField(instanceId: number, field: Exclude<SyncFieldKey, "attributes">) {
    setSyncingInstanceId(instanceId);
    setError(null);
    try {
      const preview = await api.applyProjectInstanceCatalogField(projectId, instanceId, field);
      await refreshProjectAndSyncPreview(instanceId, preview);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Could not apply catalog value.";
      setError(message);
    } finally {
      setSyncingInstanceId(null);
    }
  }

  async function handleApplyInstanceField(instanceId: number, field: Exclude<SyncFieldKey, "attributes">) {
    setSyncingInstanceId(instanceId);
    setError(null);
    try {
      const preview = await api.applyProjectInstanceFieldToCatalog(projectId, instanceId, field);
      await refreshProjectAndSyncPreview(instanceId, preview);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Could not apply instance value to catalog.";
      setError(message);
    } finally {
      setSyncingInstanceId(null);
    }
  }

  async function handleReconcileAttributes(instanceId: number, payload: { add_attribute_names?: string[]; remove_attribute_names?: string[] }) {
    setSyncingInstanceId(instanceId);
    setError(null);
    try {
      const preview = await api.reconcileProjectInstanceAttributes(projectId, instanceId, payload);
      await refreshProjectAndSyncPreview(instanceId, preview);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Could not reconcile attribute schema.";
      setError(message);
    } finally {
      setSyncingInstanceId(null);
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
                </div>
                {category.available_components.length ? (
                  <button
                    type="button"
                    className="px-3 py-1.5 bg-white dark:bg-white/10 shadow-sm hover:bg-zinc-50 dark:hover:bg-white/20 text-zinc-900 dark:text-white rounded border border-black/10 dark:border-white/10 text-xs font-semibold transition-colors flex items-center gap-2"
                    onClick={() => setModalState({ kind: "create", categoryId: category.id })}
                  >
                    <i className="ph-bold ph-plus" />
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
                      syncPreview={syncPreviews[instance.id] || null}
                      syncPreviewLoading={Boolean(syncPreviewLoading[instance.id])}
                      onEnsureSyncPreview={() => ensureSyncPreview(instance.id)}
                      onOpenSyncModal={(field) => void openSyncModal(instance.id, field)}
                      onEdit={() => setModalState({ kind: "edit", categoryId: category.id, instanceId: instance.id })}
                      onDelete={() => void handleDeleteInstance(category.id, instance.id)}
                      onOpenCalculationSheet={(material) =>
                        setCalculationSheetState({
                          instanceId: instance.id,
                          instanceName: instance.name,
                          material,
                        })
                      }
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

      {calculationSheetState ? (
        <MaterialCalculationSheetModal
          open={calculationSheetState !== null}
          projectId={projectId}
          instanceId={calculationSheetState.instanceId}
          instanceName={calculationSheetState.instanceName}
          material={calculationSheetState.material}
          onClose={() => setCalculationSheetState(null)}
        />
      ) : null}

      <InstanceSyncModal
        open={syncModalState !== null}
        instance={activeSyncInstance}
        preview={syncModalState ? syncPreviews[syncModalState.instanceId] || null : null}
        loading={Boolean(syncModalState && syncPreviewLoading[syncModalState.instanceId])}
        targetField={syncModalState?.field || null}
        syncing={Boolean(syncModalState && syncingInstanceId === syncModalState.instanceId)}
        onClose={() => setSyncModalState(null)}
        onRefreshAll={async () => {
          if (!syncModalState) {
            return;
          }
          await handleRefreshSync(syncModalState.instanceId);
        }}
        onApplyCatalogField={async (field) => {
          if (!syncModalState) {
            return;
          }
          await handleApplyCatalogField(syncModalState.instanceId, field);
        }}
        onApplyInstanceField={async (field) => {
          if (!syncModalState) {
            return;
          }
          await handleApplyInstanceField(syncModalState.instanceId, field);
        }}
        onAddAttributes={async (names) => {
          if (!syncModalState) {
            return;
          }
          await handleReconcileAttributes(syncModalState.instanceId, { add_attribute_names: names });
        }}
        onRemoveAttributes={async (names) => {
          if (!syncModalState) {
            return;
          }
          await handleReconcileAttributes(syncModalState.instanceId, { remove_attribute_names: names });
        }}
      />
    </div>
  );
}
