import { type FormEvent, type KeyboardEvent, startTransition, useEffect, useRef, useState } from "react";

import { MaterialCalculationSheetModal } from "../components/MaterialCalculationSheetModal";
import { MediaPicker } from "../components/MediaPicker";
import { Modal } from "../components/Modal";
import { FactoryQuantityLabel, WorkQuantityLabel } from "../components/QuantityLabels";
import { SearchField } from "../components/SearchField";
import { ApiError, api } from "../lib/api";
import { toAppPath } from "../lib/basePath";
import { matchesSearchText, normalizeSearchText, searchTreeBranchMatches } from "../lib/search";
import {
  allExpandableSubtypeIds,
  analyzeSubtypeBranches,
  defaultExpandedSubtypeIds,
  flattenSubtypeTree,
  isSubtypeRowVisible,
  resolveSubtypeQuantities,
  type FlatSubtype,
} from "../lib/subtypeRows";
import type {
  AttributeValueInput,
  AvailableComponent,
  BomEntry,
  CatalogMaterialSearchResult,
  CatalogMaterialRule,
  EditableAttribute,
  InstanceSyncPreview,
  SyncAttributeDifference,
  SyncAttributeReconcileRequest,
  InstanceMaterial,
  MediaAsset,
  ProjectCategorySection,
  ProjectComment,
  ProjectDetailData,
  ProjectInstance,
  UpdateProjectOccurrenceRequest,
  UpdateProjectInstanceRequest,
  UsageOccurrence,
  ManagedUser,
} from "../lib/types";

type ProjectDetailPageProps = {
  projectId: number;
  onNavigate: (to: string) => void;
  onTitleChange?: (title: string) => void;
  readOnly?: boolean;
};

type ModalState =
  | { kind: "create"; categoryId: number }
  | { kind: "edit"; categoryId: number; instanceId: number }
  | null;

type LinkedAccessoryState = {
  targetInstanceId: number;
  targetInstanceName: string;
  categoryIds: number[];
  selectedCategoryId: number | null;
} | null;

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
  onSubmit: (payload: InstanceFormPayload) => Promise<void>;
};

type InstanceFormPayload = {
  component_id?: number;
  name: string;
  short_name: string | null;
  description: string | null;
  short_description: string | null;
  installation: string | null;
  unit_amount: number | null;
  attribute_values: AttributeValueInput[];
  selected_material_rule_ids?: number[];
  media_asset_id?: number | null;
  clear_media?: boolean;
};

type CategoryNode = ProjectCategorySection & { children: CategoryNode[] };
type MaterialRowDraft = {
  subtype_id: number | null;
  quantity: string;
  assembly_quantity: string;
  inheritance_mode: "override" | "add";
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

function getLinkedAccessoryCategories(data: ProjectDetailData, itemCategory: ProjectCategorySection): ProjectCategorySection[] {
  const linkedCategoryIds = new Set(itemCategory.linked_category_ids);
  const candidates = linkedCategoryIds.size
    ? data.categories.filter((category) => linkedCategoryIds.has(category.id))
    : data.categories;

  return candidates
    .filter((category) => category.available_components.some((component) => component.type === "accessory"))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function ProjectCategoryTree({
  nodes,
  filterTerm,
  onSelectInstance,
  depth = 0,
}: {
  nodes: CategoryNode[];
  filterTerm: string;
  onSelectInstance: (instanceId: number) => void;
  depth?: number;
}) {
  return (
    <ul className={depth === 0 ? "space-y-1" : "ml-5 border-l border-black/10 dark:border-white/10 mt-1 pl-3 space-y-1"}>
      {nodes
        .filter((node) => projectTreeMatches(node, filterTerm))
        .map((node) => {
          const matchingInstances = normalizeSearchText(filterTerm)
            ? node.instances.filter((instance) => matchesSearchText(filterTerm, instance.name, instance.short_name))
            : [];
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
              {matchingInstances.length ? (
                <ul className="ml-5 mt-1 space-y-1 border-l border-black/10 pl-3 dark:border-white/10">
                  {matchingInstances.map((instance) => {
                    const isAccessory = instance.type === "accessory";
                    return (
                      <li key={instance.id}>
                        <button
                          type="button"
                          onClick={() => onSelectInstance(instance.id)}
                          className="relative flex w-full items-center gap-2 px-2 py-1 text-left text-sm text-zinc-600 transition-colors before:absolute before:-left-3 before:top-1/2 before:h-px before:w-2 before:bg-black/10 hover:text-zinc-900 dark:text-zinc-400 dark:before:bg-white/10 dark:hover:text-zinc-200"
                        >
                          <i className={`ph-fill ${isAccessory ? "ph-flask" : "ph-wall"} text-zinc-400 dark:text-zinc-500`} />
                          <span className="min-w-0 flex-1 truncate">{instance.name}</span>
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
                <ProjectCategoryTree
                  nodes={node.children}
                  filterTerm={filterTerm}
                  onSelectInstance={onSelectInstance}
                  depth={depth + 1}
                />
              ) : null}
            </li>
          );
        })}
    </ul>
  );
}

export function projectTreeMatches(node: CategoryNode, term: string): boolean {
  return searchTreeBranchMatches(node, term, (current) => [
    current.name,
    ...current.instances.flatMap((instance) => [instance.name, instance.short_name]),
  ]);
}

function serializeBomRows(rows: MaterialRowDraft[]) {
  return JSON.stringify(
    rows.map((row) => ({
      subtype_id: row.subtype_id,
      quantity: row.quantity,
      assembly_quantity: row.assembly_quantity,
      inheritance_mode: row.inheritance_mode,
    })),
  );
}

function buildDraftRows(rows: BomEntry[]): MaterialRowDraft[] {
  return rows.map((row) => ({
    subtype_id: row.subtype_id,
    quantity: row.quantity === null ? "" : String(row.quantity),
    assembly_quantity: row.assembly_quantity === null ? "" : String(row.assembly_quantity),
    inheritance_mode: row.inheritance_mode || "override",
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
  payloadEntries: Array<{ subtype_id: number | null; quantity: number | null; assembly_quantity: number | null; inheritance_mode?: "override" | "add" }>,
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
        inheritance_mode: "override" as const,
      };
      return {
        subtype_id: subtype.id,
        subtype: subtype.name,
        subtype_depth: subtype.depth,
        inheritance_mode: entry.inheritance_mode || "override",
        quantity: entry.quantity,
        quantity_state: quantityStateForValue(entry.quantity),
        effective_quantity: entry.quantity,
        effective_quantity_state: quantityStateForValue(entry.quantity),
        assembly_quantity: entry.assembly_quantity,
        assembly_quantity_state: quantityStateForValue(entry.assembly_quantity),
        effective_assembly_quantity: entry.assembly_quantity,
        effective_assembly_quantity_state: quantityStateForValue(entry.assembly_quantity),
        inherited_from_subtype_id: null,
        inherited_from_subtype: null,
        unit: material.unit,
        calculation_mode: "manual",
        calculation_formula: null,
        calculation_explanation: "Q_fábrica sobrescrita manualmente",
        is_persisted: true,
      };
    });
  }

  const generalEntry = payloadEntries[0] ?? {
    subtype_id: null,
    quantity: null,
    assembly_quantity: null,
    inheritance_mode: "override" as const,
  };
  return [
    {
      subtype_id: null,
      subtype: "General",
      subtype_depth: 0,
      inheritance_mode: "override",
      quantity: generalEntry.quantity,
      quantity_state: quantityStateForValue(generalEntry.quantity),
      effective_quantity: generalEntry.quantity,
      effective_quantity_state: quantityStateForValue(generalEntry.quantity),
      assembly_quantity: generalEntry.assembly_quantity,
      assembly_quantity_state: quantityStateForValue(generalEntry.assembly_quantity),
      effective_assembly_quantity: generalEntry.assembly_quantity,
      effective_assembly_quantity_state: quantityStateForValue(generalEntry.assembly_quantity),
      inherited_from_subtype_id: null,
      inherited_from_subtype: null,
      unit: material.unit,
      calculation_mode: "manual",
      calculation_formula: null,
      calculation_explanation: "Q_fábrica sobrescrita manualmente",
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
    const parsedEntries = subtypeOptions.map((subtype) => {
      const draftRow = draftRows.find((row) => row.subtype_id === subtype.id);
      return {
        subtype_id: subtype.id,
        quantity: parseDisplayNumber(draftRow?.quantity ?? ""),
        assembly_quantity: parseDisplayNumber(draftRow?.assembly_quantity ?? ""),
        inheritance_mode: draftRow?.inheritance_mode || ("override" as const),
      };
    });
    const effectiveBySubtypeId = resolveSubtypeQuantities(parsedEntries, subtypeOptions);
    const subtypeNamesById = new Map(subtypeOptions.map((subtype) => [subtype.id, subtype.name]));
    return subtypeOptions.map((subtype) => {
      const draftRow = draftRows.find((row) => row.subtype_id === subtype.id) || {
        subtype_id: subtype.id,
        quantity: "",
        assembly_quantity: "",
        inheritance_mode: "override" as const,
      };
      const persisted = bySubtypeId.get(subtype.id);
      const quantity = parseDisplayNumber(draftRow.quantity);
      const assemblyQuantity = parseDisplayNumber(draftRow.assembly_quantity);
      const effective = effectiveBySubtypeId.get(subtype.id);
      const inheritedSourceId = effective?.quantitySourceId ?? effective?.assemblyQuantitySourceId ?? null;
      return {
        subtype_id: subtype.id,
        subtype: subtype.name,
        subtype_depth: subtype.depth,
        inheritance_mode: draftRow.inheritance_mode,
        quantity,
        quantity_state: quantityStateForValue(quantity),
        effective_quantity: effective?.quantity ?? null,
        effective_quantity_state: quantityStateForValue(effective?.quantity ?? null),
        assembly_quantity: assemblyQuantity,
        assembly_quantity_state: quantityStateForValue(assemblyQuantity),
        effective_assembly_quantity: effective?.assemblyQuantity ?? null,
        effective_assembly_quantity_state: quantityStateForValue(effective?.assemblyQuantity ?? null),
        inherited_from_subtype_id: inheritedSourceId === subtype.id ? null : inheritedSourceId,
        inherited_from_subtype:
          inheritedSourceId === null || inheritedSourceId === subtype.id
            ? null
            : subtypeNamesById.get(inheritedSourceId) || null,
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
    inheritance_mode: "override" as const,
  };
  const persisted = bySubtypeId.get(null) || null;
  const quantity = parseDisplayNumber(generalDraft.quantity);
  const assemblyQuantity = parseDisplayNumber(generalDraft.assembly_quantity);
  return [
    {
      subtype_id: null,
      subtype: "General",
      subtype_depth: 0,
      inheritance_mode: "override",
      quantity,
      quantity_state: quantityStateForValue(quantity),
      effective_quantity: persisted?.effective_quantity ?? quantity,
      effective_quantity_state: persisted?.effective_quantity_state ?? quantityStateForValue(quantity),
      assembly_quantity: assemblyQuantity,
      assembly_quantity_state: quantityStateForValue(assemblyQuantity),
      effective_assembly_quantity: persisted?.effective_assembly_quantity ?? assemblyQuantity,
      effective_assembly_quantity_state:
        persisted?.effective_assembly_quantity_state ?? quantityStateForValue(assemblyQuantity),
      inherited_from_subtype_id: persisted?.inherited_from_subtype_id ?? null,
      inherited_from_subtype: persisted?.inherited_from_subtype ?? null,
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
    return "En blanco";
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

function updateInstanceCommentSummary(
  data: ProjectDetailData,
  instanceId: number,
  updater: (summary: ProjectInstance["comment_summary"]) => ProjectInstance["comment_summary"],
): ProjectDetailData {
  return {
    ...data,
    categories: data.categories.map((category) => ({
      ...category,
      instances: category.instances.map((instance) =>
        instance.id === instanceId
          ? {
              ...instance,
              comment_summary: updater(instance.comment_summary || { total_count: 0, unread_count: 0 }),
            }
          : instance,
      ),
    })),
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

function editableAttributesToMap(attributes: EditableAttribute[]) {
  return new Map(attributes.map((attribute) => [attribute.name, attribute.value || ""]));
}

function numericValue(value: string | null | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function materialRuleApplies(rule: CatalogMaterialRule, attributes: EditableAttribute[]) {
  if (!rule.conditions.length) {
    return true;
  }
  const values = editableAttributesToMap(attributes);
  return rule.conditions.some((group) =>
    group.clauses.every((clause) => {
      const rawValue = values.get(clause.attribute_name) || "";
      const operator = clause.operator.toUpperCase();
      if (operator === "IS NOT NULL") {
        return rawValue.trim() !== "";
      }
      if (!rawValue.trim()) {
        return false;
      }
      if (operator === "=") {
        return rawValue === (clause.comparison_value || "");
      }
      if (operator === ">") {
        return numericValue(rawValue) > numericValue(clause.comparison_value);
      }
      if (operator === "<") {
        return numericValue(rawValue) < numericValue(clause.comparison_value);
      }
      if (operator === "IN") {
        return (clause.comparison_value || "")
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
          .includes(rawValue);
      }
      if (operator === "BETWEEN") {
        const candidate = numericValue(rawValue);
        return numericValue(clause.comparison_value) <= candidate && candidate <= numericValue(clause.comparison_value_secondary);
      }
      return false;
    }),
  );
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
  const [selectedMaterialRuleIds, setSelectedMaterialRuleIds] = useState<number[]>([]);
  const [selectedMedia, setSelectedMedia] = useState<MediaAsset | null>(null);
  const selectedComponent = availableComponents.find((component) => component.id === componentId) || availableComponents[0];
  const applicableMaterialRules =
    mode === "create" && selectedComponent
      ? selectedComponent.material_rules.filter((rule) => rule.id !== undefined && materialRuleApplies(rule, attributes))
      : [];
  const applicableMaterialRuleIdKey = applicableMaterialRules.map((rule) => rule.id).join(",");

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
      setSelectedMedia(initialInstance.media[0] || null);
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
    setSelectedMedia(defaultComponent?.media[0] || null);
    setSelectedMaterialRuleIds((defaultComponent?.material_rules || []).map((rule) => rule.id).filter((id): id is number => id !== undefined));
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
    setSelectedMedia(selectedComponent.media[0] || null);
    setSelectedMaterialRuleIds(selectedComponent.material_rules.map((rule) => rule.id).filter((id): id is number => id !== undefined));
  }, [availableComponents, componentId, mode, open]);

  useEffect(() => {
    if (!open || mode !== "create") {
      return;
    }
    const applicableIds = applicableMaterialRuleIdKey
      .split(",")
      .filter(Boolean)
      .map((id) => Number(id));
    setSelectedMaterialRuleIds((current) => {
      const applicableSet = new Set(applicableIds);
      const nextIds = current.filter((id) => applicableSet.has(id));
      return nextIds.length === current.length && nextIds.every((id, index) => id === current[index]) ? current : nextIds;
    });
  }, [applicableMaterialRuleIdKey, mode, open]);

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
      selected_material_rule_ids: mode === "create" ? selectedMaterialRuleIds : undefined,
      media_asset_id: selectedMedia?.id ?? null,
      clear_media: selectedMedia === null,
    });
  }

  return (
    <Modal
      open={open}
      title={categoryName}
      kicker={mode === "create" ? "Crear instancia de proyecto" : "Editar instancia de proyecto"}
      onClose={onClose}
    >
      <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
        {mode === "create" ? (
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold text-zinc-600 dark:text-zinc-400 uppercase tracking-widest">Componente Plantilla</label>
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
            <label className="text-xs font-bold text-zinc-600 dark:text-zinc-400 uppercase tracking-widest">Nombre de Instancia</label>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              className="w-full bg-white dark:bg-black/40 border border-black/10 dark:border-white/10 rounded-lg p-2.5 text-sm text-zinc-900 dark:text-zinc-200 focus:outline-none focus:border-accent-500/50 transition-all font-mono"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold text-zinc-600 dark:text-zinc-400 uppercase tracking-widest">Nombre Comercial</label>
            <input
              value={shortName}
              onChange={(event) => setShortName(event.target.value)}
              className="w-full bg-white dark:bg-black/40 border border-black/10 dark:border-white/10 rounded-lg p-2.5 text-sm text-zinc-900 dark:text-zinc-200 focus:outline-none focus:border-accent-500/50 transition-all font-mono"
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-bold text-zinc-600 dark:text-zinc-400 uppercase tracking-widest"><FactoryQuantityLabel /> Unitaria</label>
          <input
            value={unitAmount}
            onChange={(event) => setUnitAmount(event.target.value)}
            placeholder="Base opcional"
            className="w-full bg-white dark:bg-black/40 border border-black/10 dark:border-white/10 rounded-lg p-2.5 text-sm text-zinc-900 dark:text-zinc-200 focus:outline-none focus:border-accent-500/50 transition-all font-mono"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-bold text-zinc-600 dark:text-zinc-400 uppercase tracking-widest">Imagen</label>
          <MediaPicker value={selectedMedia} onChange={setSelectedMedia} />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-bold text-zinc-600 dark:text-zinc-400 uppercase tracking-widest">Descripción</label>
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={3}
            className="description-textarea w-full bg-white dark:bg-black/40 border border-black/10 dark:border-white/10 rounded-lg p-2.5 text-sm text-zinc-900 dark:text-zinc-200 focus:outline-none focus:border-accent-500/50 transition-all font-mono"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-bold text-zinc-600 dark:text-zinc-400 uppercase tracking-widest">Descripción Corta</label>
          <textarea
            value={shortDescription}
            onChange={(event) => setShortDescription(event.target.value)}
            rows={3}
            className="description-textarea w-full bg-white dark:bg-black/40 border border-black/10 dark:border-white/10 rounded-lg p-2.5 text-sm text-zinc-900 dark:text-zinc-200 focus:outline-none focus:border-accent-500/50 transition-all font-mono"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-bold text-zinc-600 dark:text-zinc-400 uppercase tracking-widest">Instalación</label>
          <textarea
            value={installation}
            onChange={(event) => setInstallation(event.target.value)}
            rows={3}
            className="description-textarea w-full bg-white dark:bg-black/40 border border-black/10 dark:border-white/10 rounded-lg p-2.5 text-sm text-zinc-900 dark:text-zinc-200 focus:outline-none focus:border-accent-500/50 transition-all font-mono"
          />
        </div>

        {attributes.length ? (
          <div className="rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-black/20 shadow-sm p-4 flex flex-col gap-3">
            <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Atributos Base</div>
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
                    <option value="">Seleccionar valor</option>
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

        {mode === "create" ? (
          <div className="rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-black/20 shadow-sm p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Materiales Iniciales</div>
              {applicableMaterialRules.length ? (
                <button
                  type="button"
                  onClick={() => {
                    const ids = applicableMaterialRules.map((rule) => rule.id).filter((id): id is number => id !== undefined);
                    setSelectedMaterialRuleIds(selectedMaterialRuleIds.length === ids.length ? [] : ids);
                  }}
                  className="px-2 py-1 rounded border border-black/10 dark:border-white/10 bg-zinc-50 dark:bg-white/5 text-[10px] font-semibold"
                >
                  {selectedMaterialRuleIds.length === applicableMaterialRules.length ? "Limpiar" : "Seleccionar todo"}
                </button>
              ) : null}
            </div>
            {applicableMaterialRules.length ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {applicableMaterialRules.map((rule) => {
                  const ruleId = rule.id || 0;
                  return (
                    <label
                      key={ruleId}
                      className="flex items-start gap-3 rounded-lg border border-black/10 dark:border-white/10 bg-zinc-50 dark:bg-white/5 p-3 text-sm cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={selectedMaterialRuleIds.includes(ruleId)}
                        onChange={() =>
                          setSelectedMaterialRuleIds((current) =>
                            current.includes(ruleId) ? current.filter((id) => id !== ruleId) : [...current, ruleId],
                          )
                        }
                        className="mt-1"
                      />
                      <span className="min-w-0">
                        <span className="block font-semibold text-zinc-900 dark:text-zinc-100 truncate">{rule.material_name}</span>
                        <span className="block text-[11px] font-mono text-zinc-500">{rule.sku}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            ) : (
              <div className="text-xs text-zinc-500 dark:text-zinc-400">No hay materiales predefinidos aplicables a los valores de atributos actuales.</div>
            )}
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
            Cancelar
          </button>
          <button 
            type="submit" 
            disabled={submitting}
            className="px-4 py-2 bg-accent-500 hover:bg-accent-400 text-zinc-950 rounded-lg text-sm font-bold transition-colors disabled:opacity-50"
          >
            {submitting ? "Guardando..." : mode === "create" ? "Crear instancia" : "Guardar instancia"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function LinkedAccessoryCategoryModal({
  open,
  itemName,
  categories,
  onClose,
  onSelect,
}: {
  open: boolean;
  itemName: string;
  categories: ProjectCategorySection[];
  onClose: () => void;
  onSelect: (categoryId: number) => void;
}) {
  return (
    <Modal open={open} title="Crear accesorio vinculado" kicker="Seleccionar categoría de accesorio" onClose={onClose} panelClassName="max-w-lg">
      <div className="space-y-4">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Selecciona la categoría del accesorio que se aplicará a <strong className="text-zinc-900 dark:text-zinc-100">{itemName}</strong>.
        </p>
        <div className="grid gap-2">
          {categories.map((category) => {
            const accessoryCount = category.available_components.filter((component) => component.type === "accessory").length;
            return (
              <button
                key={category.id}
                type="button"
                onClick={() => onSelect(category.id)}
                className="flex items-center justify-between gap-3 rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-white/5 px-4 py-3 text-left transition-colors hover:border-accent-500/50 hover:bg-accent-500/5"
              >
                <span className="min-w-0">
                  <span className="block font-semibold text-zinc-900 dark:text-zinc-100">{category.name}</span>
                  <span className="block text-[11px] font-mono text-zinc-500">{accessoryCount} componente{accessoryCount === 1 ? "" : "s"} disponible{accessoryCount === 1 ? "" : "s"}</span>
                </span>
                <i className="ph-bold ph-arrow-right text-zinc-500" />
              </button>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}

function getOccurrencePrimaryLabel(occurrence: UsageOccurrence) {
  return occurrence.context_label || occurrence.targets[0]?.instance_name || "Ocurrencia de uso";
}

function getIncomingOccurrencePrimaryLabel(
  instance: ProjectInstance,
  occurrence: UsageOccurrence,
  index: number,
  occurrences: UsageOccurrence[],
) {
  const matchesOccurrence = (link: { relationship_type: string; application_label: string | null }, candidate: UsageOccurrence) =>
    link.relationship_type === candidate.relationship_type &&
    (link.application_label || null) === (candidate.context_label || null);
  const matchingLinks = instance.linked_accessories.filter((link) => matchesOccurrence(link, occurrence));
  const occurrenceOrdinal = occurrences
    .slice(0, index + 1)
    .filter((candidate) =>
      candidate.relationship_type === occurrence.relationship_type &&
      (candidate.context_label || null) === (occurrence.context_label || null),
    ).length - 1;
  const matchingLink = matchingLinks[occurrenceOrdinal] || (matchingLinks.length === 1 ? matchingLinks[0] : null);
  const ordinalFallbackIndex = matchingLinks.length ? occurrenceOrdinal : index;
  const fallbackLink = matchingLinks[ordinalFallbackIndex] || instance.linked_accessories[index];

  return matchingLink?.name || fallbackLink?.name || occurrence.context_label || "Ocurrencia de uso";
}

function renderOccurrenceSummary(
  occurrence: UsageOccurrence,
  index: number,
  options?: {
    primaryLabel?: string;
    showRelationshipType?: boolean;
    onClick?: () => void;
  },
) {
  const primaryLabel = options?.primaryLabel || getOccurrencePrimaryLabel(occurrence);

  return (
    <li
      key={`${occurrence.relationship_type}-${primaryLabel}-${index}`}
      className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 py-1.5 text-xs"
    >
      {options?.onClick ? (
        <button
          type="button"
          onClick={options.onClick}
          className="inline-flex items-center gap-1 font-semibold text-accent-700 underline decoration-accent-500/30 underline-offset-2 transition-colors hover:text-accent-600 dark:text-accent-400 dark:hover:text-accent-300"
          aria-label={`Ir a ${primaryLabel}`}
          title={`Ir a ${primaryLabel}`}
        >
          {primaryLabel}
          <i className="ph-bold ph-arrow-up-right text-[10px]" aria-hidden="true" />
        </button>
      ) : (
        <span className="font-semibold text-zinc-900 dark:text-zinc-100">{primaryLabel}</span>
      )}
      {options?.showRelationshipType !== false ? (
        <span className="text-[10px] uppercase tracking-widest font-mono text-zinc-400 dark:text-zinc-500">
          {translateRelationshipType(occurrence.relationship_type)}
        </span>
      ) : null}
      {occurrence.attributes.length ? (
        <span className="font-mono text-[10px] text-zinc-500 dark:text-zinc-400">
          {occurrence.attributes.map((attribute) => `${attribute.name}: ${attribute.value || "-"}`).join(" · ")}
        </span>
      ) : null}
    </li>
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
        label: "Personalizado",
        icon: "ph-pencil-simple",
        className: "text-sky-500 dark:text-sky-400 hover:text-sky-600 dark:hover:text-sky-300",
      };
    case "stale":
      return {
        label: "Desactualizado",
        icon: "ph-clock-counter-clockwise",
        className: "text-amber-500 dark:text-amber-400 hover:text-amber-600 dark:hover:text-amber-300",
      };
    case "conflict":
      return {
        label: "Conflicto",
        icon: "ph-warning",
        className: "text-red-500 dark:text-red-400 hover:text-red-600 dark:hover:text-red-300",
      };
    case "out_of_sync":
      return {
        label: "Esquema",
        icon: "ph-warning-circle",
        className: "text-amber-500 dark:text-amber-400 hover:text-amber-600 dark:hover:text-amber-300",
      };
    default:
      return null;
  }
}

function translateRelationshipType(type: string) {
  const translations: Record<string, string> = {
    applied_to: "Aplicado a",
    uses: "Usa",
  };
  return translations[(type || "").trim().toLowerCase()] || type;
}

function translateProjectDetailLabel(label: string | null | undefined) {
  const normalized = (label || "").trim().toLowerCase();
  const translations: Record<string, string> = {
    attributes: "Atributos",
    "base attributes": "Atributos base",
    "imported attributes": "Atributos importados",
    name: "Nombre",
    "short name": "Nombre comercial",
    description: "Descripción",
    "short description": "Descripción corta",
    installation: "Instalación",
    text: "Texto",
    number: "Número",
    select: "Selección",
  };

  return translations[normalized] || label || "";
}

function translateCalculationMode(mode: string) {
  const translations: Record<string, string> = {
    manual: "manual",
    formula: "fórmula",
    catalog: "catálogo",
  };

  return translations[mode] || mode;
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
      title={`${title} (${meta.label})`}
      onClick={onClick}
      className={`inline-flex items-center justify-center p-0.5 rounded-full transition-colors ${meta.className}`}
    >
      <i className={`ph-fill ${meta.icon} text-sm`} />
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
      <div className="text-sm text-zinc-900 dark:text-zinc-100 whitespace-pre-wrap break-words">{value || "Vacío"}</div>
    </div>
  );
}

function MissingAttributeReconcilePanel({
  attributes,
  syncing,
  onAdd,
}: {
  attributes: SyncAttributeDifference[];
  syncing: boolean;
  onAdd: (values: AttributeValueInput[]) => Promise<void>;
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const attributeSignature = JSON.stringify(
    attributes.map((attribute) => [
      attribute.name,
      attribute.catalog_definition?.value_type,
      attribute.catalog_definition?.options,
    ]),
  );

  useEffect(() => {
    setDrafts(Object.fromEntries(attributes.map((attribute) => [attribute.name, ""])));
  }, [attributeSignature]);

  const requiresValue = (attribute: SyncAttributeDifference) =>
    attribute.catalog_definition?.value_type === "select" && Boolean(attribute.catalog_definition.options.length);
  const missingRequiredValue = attributes.some((attribute) => requiresValue(attribute) && !drafts[attribute.name]?.trim());
  const valuesFor = (selected: SyncAttributeDifference[]) =>
    selected.map((attribute) => ({ name: attribute.name, value: drafts[attribute.name]?.trim() || null }));

  return (
    <div className="rounded-lg border border-black/10 p-4 space-y-3 dark:border-white/10">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Faltante en Instancia</div>
        <button
          type="button"
          disabled={syncing || missingRequiredValue}
          onClick={() => void onAdd(valuesFor(attributes))}
          className="rounded border border-black/10 bg-white px-3 py-1.5 text-xs font-semibold disabled:opacity-50 dark:border-white/10 dark:bg-white/5"
        >
          Agregar todos
        </button>
      </div>
      <div className="space-y-2">
        {attributes.map((attribute) => {
          const definition = attribute.catalog_definition;
          const options = definition?.options || [];
          const selectValueRequired = requiresValue(attribute);
          return (
            <div key={`missing-${attribute.name}`} className="grid gap-3 rounded-lg bg-zinc-50 p-3 dark:bg-white/5 md:grid-cols-[minmax(0,1fr)_minmax(12rem,1fr)_auto] md:items-center">
              <div className="min-w-0">
                <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{attribute.name}</div>
                <div className="text-xs text-zinc-500 dark:text-zinc-400">
                  {translateProjectDetailLabel(definition?.value_type || "text")}
                </div>
              </div>
              {definition?.value_type === "select" && options.length ? (
                <select
                  value={drafts[attribute.name] || ""}
                  onChange={(event) => setDrafts((current) => ({ ...current, [attribute.name]: event.target.value }))}
                  className="w-full rounded-lg border border-black/10 bg-white p-2 text-sm text-zinc-900 focus:border-accent-500/50 focus:outline-none dark:border-white/10 dark:bg-black/40 dark:text-zinc-200"
                >
                  <option value="">Seleccionar valor</option>
                  {options.map((option) => (
                    <option key={`${attribute.name}-${option}`} value={option}>{option}</option>
                  ))}
                </select>
              ) : (
                <input
                  type={definition?.value_type === "number" ? "number" : "text"}
                  value={drafts[attribute.name] || ""}
                  onChange={(event) => setDrafts((current) => ({ ...current, [attribute.name]: event.target.value }))}
                  placeholder="Valor inicial (opcional)"
                  className="w-full rounded-lg border border-black/10 bg-white p-2 text-sm text-zinc-900 focus:border-accent-500/50 focus:outline-none dark:border-white/10 dark:bg-black/40 dark:text-zinc-200"
                />
              )}
              <button
                type="button"
                disabled={syncing || (selectValueRequired && !drafts[attribute.name]?.trim())}
                onClick={() => void onAdd(valuesFor([attribute]))}
                className="rounded bg-accent-500 px-3 py-1.5 text-xs font-semibold text-zinc-950 hover:bg-accent-400 disabled:opacity-50"
              >
                Agregar
              </button>
            </div>
          );
        })}
      </div>
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
  onAddAttributes: (values: AttributeValueInput[]) => Promise<void>;
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
      title={`Sincronización de ${instance.name}`}
      kicker="Estado del Campo"
      onClose={onClose}
      panelClassName="max-w-3xl"
    >
      {loading || !preview ? (
        <div className="text-sm text-zinc-600 dark:text-zinc-400">Cargando detalles de sincronización...</div>
      ) : targetField === "attributes" && attributeSchema ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-bold uppercase tracking-widest text-zinc-500">{translateProjectDetailLabel(attributeSchema.label)}</div>
              <div className="text-sm text-zinc-600 dark:text-zinc-400">
                {attributeSchema.differences.length
                  ? "Las filas de atributos del catálogo y de la instancia difieren."
                  : "Los atributos base de la instancia coinciden con el esquema del catálogo."}
              </div>
            </div>
            {statusMeta ? <span className={`rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-widest ${statusMeta.className}`}>{statusMeta.label}</span> : null}
          </div>

          {missingAttributes.length ? (
            <MissingAttributeReconcilePanel attributes={missingAttributes} syncing={syncing} onAdd={onAddAttributes} />
          ) : null}

          {extraAttributes.length ? (
            <div className="rounded-lg border border-black/10 dark:border-white/10 p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Extra en Instancia</div>
                <button
                  type="button"
                  disabled={syncing}
                  onClick={() => void onRemoveAttributes(extraAttributes.map((item) => item.name))}
                  className="px-3 py-1.5 rounded border border-red-200 dark:border-red-500/20 bg-red-100 dark:bg-red-500/10 text-xs font-semibold text-red-700 dark:text-red-300 disabled:opacity-50"
                >
                  Quitar todos
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
                      Quitar
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {!attributeSchema.differences.length ? (
            <div className="rounded-lg border border-dashed border-black/10 dark:border-white/10 p-4 text-sm text-zinc-500 dark:text-zinc-400">
              No se detectaron diferencias de esquema.
            </div>
          ) : null}
        </div>
      ) : scalarField ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-bold uppercase tracking-widest text-zinc-500">{translateProjectDetailLabel(scalarField.label)}</div>
              <div className="text-sm text-zinc-600 dark:text-zinc-400">
                Compara el valor del catálogo con el valor actual de la instancia.
              </div>
            </div>
            {statusMeta ? <span className={`rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-widest ${statusMeta.className}`}>{statusMeta.label}</span> : null}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <SyncValuePanel label="Catálogo" value={scalarField.catalog_value} />
            <SyncValuePanel label="Instancia" value={scalarField.instance_value} />
          </div>

          {scalarField.can_apply_catalog ? (
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                disabled={syncing}
                onClick={() => void onApplyInstanceField(targetField as Exclude<SyncFieldKey, "attributes">)}
                className="px-4 py-2 rounded border border-black/10 dark:border-white/10 bg-white dark:bg-white/5 text-sm font-semibold disabled:opacity-50"
              >
                Aplicar valor de instancia al catálogo
              </button>
              <button
                type="button"
                disabled={syncing}
                onClick={() => void onApplyCatalogField(targetField as Exclude<SyncFieldKey, "attributes">)}
                className="px-4 py-2 rounded bg-accent-500 hover:bg-accent-400 text-sm font-semibold text-zinc-950 disabled:opacity-50"
              >
                Aplicar valor del catálogo
              </button>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="text-sm text-zinc-600 dark:text-zinc-400">No se encontraron detalles de sincronización para este campo.</div>
      )}

      <div className="flex justify-end pt-5 mt-5 border-t border-black/10 dark:border-white/10">
        <button
          type="button"
          disabled={syncing}
          onClick={() => void onRefreshAll()}
          className="px-4 py-2 rounded border border-black/10 dark:border-white/10 bg-white dark:bg-white/5 text-sm font-semibold disabled:opacity-50"
        >
          Actualizar todos los campos rastreados
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
      setError("Selecciona un ítem vinculado o ingresa una ubicación libre.");
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
      setError(err instanceof Error ? err.message : "No se pudo guardar el uso.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!onDelete || !window.confirm("¿Eliminar este uso?")) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onDelete();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo eliminar el uso.");
      setSaving(false);
    }
  }

  return (
    <div className="rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-black/20 p-3 space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Ítem Vinculado</label>
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
            <option value="">Sin ítem vinculado</option>
            {targetOptions.map((target) => (
              <option key={target.instance_id} value={target.instance_id}>
                {target.instance_name} ({target.category_name})
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Ubicación Libre</label>
          <input
            value={contextLabel}
            disabled={Boolean(targetInstanceId)}
            onChange={(event) => setContextLabel(event.target.value)}
            placeholder="Ej. unión entre muro de cocina y cielo"
            className="w-full rounded border border-black/10 dark:border-white/10 bg-white disabled:bg-zinc-100 dark:bg-black/30 dark:disabled:bg-white/5 px-2 py-1.5 text-sm disabled:text-zinc-500"
          />
          <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
            {targetInstanceId ? "Limpia el ítem vinculado para escribir una ubicación libre." : "Usa esto cuando el uso no apunta a un ítem del proyecto."}
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
                  <option value="">Seleccionar valor</option>
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
              Eliminar
            </button>
          ) : null}
          <button
            type="button"
            disabled={saving}
            onClick={() => void handleSave()}
            className="px-3 py-1.5 rounded bg-accent-500 hover:bg-accent-400 text-xs font-semibold text-zinc-950 disabled:opacity-50"
          >
            {saving ? "Guardando..." : saveLabel}
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
          <i className="ph-bold ph-flow-arrow text-zinc-600" /> Usos
        </h6>
        <button
          type="button"
          onClick={() => setCreating((current) => !current)}
          className="px-3 py-1.5 rounded border border-black/10 dark:border-white/10 bg-white dark:bg-white/5 text-xs font-semibold"
        >
          {creating ? "Cancelar" : "Agregar uso"}
        </button>
      </div>

      <div className="space-y-3">
        {instance.outgoing_occurrences.map((occurrence) => (
          <OccurrenceEditorCard
            key={occurrence.id}
            instance={instance}
            occurrence={occurrence}
            targetOptions={targetOptions}
            saveLabel="Guardar uso"
            onSave={(payload) => onUpdateOccurrence(occurrence.id, payload)}
            onDelete={() => onDeleteOccurrence(occurrence.id)}
          />
        ))}

        {creating ? (
          <OccurrenceEditorCard
            instance={instance}
            targetOptions={targetOptions}
            saveLabel="Crear uso"
            onSave={async (payload) => {
              await onCreateOccurrence(payload);
              setCreating(false);
            }}
          />
        ) : null}

        {!instance.outgoing_occurrences.length && !creating ? (
          <div className="text-center py-4 text-xs text-zinc-500 font-mono border border-dashed border-black/10 dark:border-white/10 rounded">
            Aún no hay usos definidos.
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
  onDeleteMaterial,
}: {
  material: InstanceMaterial;
  subtypeOptions: FlatSubtype[];
  onOpenCalculationSheet: () => void;
  onUpdateMaterial: (materialKey: string, payload: { mode: string; entries: Array<{ subtype_id: number | null; quantity: number | null; assembly_quantity: number | null; inheritance_mode: "override" | "add" }> }) => Promise<void>;
  onDeleteMaterial: (materialKey: string) => Promise<void>;
}) {
  const [draftRows, setDraftRows] = useState<MaterialRowDraft[]>(() => buildDraftRows(material.bom_entries));
  const [draftMode, setDraftMode] = useState(material.mode);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedSubtypeIds, setExpandedSubtypeIds] = useState<Set<number>>(() =>
    material.mode === "per_subtype" ? defaultExpandedSubtypeIds(material.bom_entries, subtypeOptions) : new Set(),
  );
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
  const isPerSubtype = draftMode === "per_subtype";
  const subtypeBranches = analyzeSubtypeBranches(displayRows, subtypeOptions);
  const requiredExpandedKey = [...subtypeBranches]
    .filter(([, branch]) => !branch.uniform)
    .map(([subtypeId]) => subtypeId)
    .sort((left, right) => left - right)
    .join(",");
  const visibleRows = displayRows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => isSubtypeRowVisible(row.subtype_id, subtypeOptions, expandedSubtypeIds));

  // Unidad / Fuente / Fórmula are almost always identical across rows of a
  // material. When uniform, surface them once in a slim meta strip instead of
  // repeating three columns on every row.
  const firstRow = displayRows[0] || null;
  const metaUniform =
    firstRow !== null &&
    displayRows.every(
      (row) =>
        (row.unit || "-") === (firstRow.unit || "-") &&
        row.calculation_mode === firstRow.calculation_mode &&
        (row.calculation_formula || "-") === (firstRow.calculation_formula || "-"),
    );

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

  useEffect(() => {
    if (!isPerSubtype || !requiredExpandedKey) {
      return;
    }
    const requiredIds = requiredExpandedKey.split(",").map(Number);
    setExpandedSubtypeIds((current) => {
      if (requiredIds.every((subtypeId) => current.has(subtypeId))) {
        return current;
      }
      const next = new Set(current);
      for (const subtypeId of requiredIds) {
        next.add(subtypeId);
      }
      return next;
    });
  }, [isPerSubtype, requiredExpandedKey]);

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
        await onUpdateMaterial(material.material_key, {
          mode: nextPayload.mode,
          entries: nextPayload.rows.map((row) => ({
            subtype_id: row.subtype_id,
            quantity: parseNullableNumber(row.quantity),
            assembly_quantity: parseNullableNumber(row.assembly_quantity),
            inheritance_mode: row.subtype_id === null ? "override" : row.inheritance_mode,
          })),
        });
        serverSignatureRef.current = buildMaterialDraftSignature(nextPayload.mode, nextPayload.rows);
      } catch (err) {
        const message = err instanceof Error ? err.message : "No se pudieron actualizar las filas de materiales.";
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
      setError("Agrega subtipos de proyecto antes de habilitar cantidades específicas por subtipo.");
      return;
    }
    const nextMode = nextChecked ? "per_subtype" : "general";
    const nextRows = nextChecked
      ? subtypeOptions.map((subtype) => ({
          subtype_id: subtype.id,
          quantity: "",
          assembly_quantity: "",
          inheritance_mode: "override" as const,
        }))
      : [{ subtype_id: null, quantity: "", assembly_quantity: "", inheritance_mode: "override" as const }];
    setDraftMode(nextMode);
    setDraftRows(nextRows);
    setExpandedSubtypeIds(nextChecked ? allExpandableSubtypeIds(subtypeOptions) : new Set());
    persistIfChanged(nextRows, nextMode);
  }

  const rowTint =
    material.source_status === "missing"
      ? "bg-red-50/30 dark:bg-red-950/10"
      : material.source_status === "manual"
        ? "bg-sky-50/30 dark:bg-sky-950/10"
        : "";

  const statusBadge =
    material.source_status === "manual" ? (
      <span
        title={material.source_label || "Material agregado manualmente"}
        className="flex items-center gap-1 px-1.5 py-px rounded-full border border-sky-200 dark:border-sky-500/20 bg-sky-50 dark:bg-sky-500/10 text-[9px] font-semibold tracking-wide text-sky-700 dark:text-sky-300"
      >
        <i className="ph-bold ph-hand-pointing" /> Manual
      </span>
    ) : material.source_status === "missing" ? (
      <span
        title={material.source_label || "Material faltante en el catálogo"}
        className="flex items-center gap-1 px-1.5 py-px rounded-full border border-red-200 dark:border-red-500/20 bg-red-50 dark:bg-red-500/10 text-[9px] font-semibold tracking-wide text-red-700 dark:text-red-300"
      >
        <i className="ph-bold ph-warning" /> Faltante
      </span>
    ) : material.source_status !== "catalog" ? (
      <span
        title={material.source_label || undefined}
        className="flex items-center gap-1 px-1.5 py-px rounded-full border border-amber-200 dark:border-amber-500/20 bg-amber-50 dark:bg-amber-500/10 text-[9px] font-semibold tracking-wide text-amber-700 dark:text-amber-300"
      >
        {material.source_status}
      </span>
    ) : null;

  function metaLine(row: BomEntry) {
    return `${row.unit || "-"} · ${translateCalculationMode(row.calculation_mode)} · ${row.calculation_formula || "Sin fórmula"}`;
  }

  function renderQuantityCells(row: BomEntry, index: number) {
    return (
      <>
        <td className="px-2 py-1 text-right font-mono">
          <input
            value={draftRows[index]?.quantity ?? ""}
            type="number"
            step="any"
            placeholder={row.quantity === null && row.effective_quantity !== null ? String(row.effective_quantity) : undefined}
            title={row.inherited_from_subtype ? `Valor efectivo heredado: ${row.effective_quantity ?? "en blanco"}` : undefined}
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
            className="w-20 rounded border border-black/10 dark:border-white/10 bg-white dark:bg-black/30 px-1.5 py-0.5 text-right text-xs"
          />
        </td>
        <td className="px-2 py-1 text-right font-mono text-zinc-500">
          <input
            value={draftRows[index]?.assembly_quantity ?? ""}
            type="number"
            step="any"
            placeholder={
              row.assembly_quantity === null && row.effective_assembly_quantity !== null
                ? String(row.effective_assembly_quantity)
                : undefined
            }
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
            className="w-20 rounded border border-black/10 dark:border-white/10 bg-white dark:bg-black/30 px-1.5 py-0.5 text-right text-xs"
          />
        </td>
        <td className="px-2 py-1">
          {row.subtype_id === null ? (
            <span className="text-[11px] text-zinc-500">Base</span>
          ) : (
            <select
              value={draftRows[index]?.inheritance_mode ?? "override"}
              aria-label={`Comportamiento de ${row.subtype}`}
              title="Reemplazar fija el total de este subtipo; Sumar agrega la cifra al valor heredado. Deja las cantidades en blanco para heredar sin cambios."
              onChange={(event) => {
                const inheritanceMode = event.target.value as "override" | "add";
                const nextRows = draftRows.map((item, itemIndex) =>
                  itemIndex === index ? { ...item, inheritance_mode: inheritanceMode } : item,
                );
                setDraftRows(nextRows);
                persistIfChanged(nextRows, draftMode);
              }}
              className="rounded border border-black/10 dark:border-white/10 bg-white dark:bg-black/30 px-1.5 py-0.5 text-[11px]"
            >
              <option value="override">Reemplazar</option>
              <option value="add">Sumar</option>
            </select>
          )}
        </td>
      </>
    );
  }

  return (
    <tbody className="border-t border-black/10 dark:border-white/10 divide-y divide-black/5 dark:divide-white/5">
      <tr className={`${rowTint} ${!isPerSubtype && firstRow ? quantityClass(firstRow.quantity) : ""} hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors`}>
        <td className="px-2 py-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-semibold text-zinc-900 dark:text-zinc-100">{material.material_name}</span>
            <span className="px-1 py-px bg-white dark:bg-black/40 border border-black/5 dark:border-white/5 rounded text-[9px] font-mono text-zinc-600 dark:text-zinc-400">
              {material.sku}
            </span>
            {statusBadge}
            <span
              aria-live="polite"
              className={`text-[9px] font-mono text-zinc-500 transition-opacity ${saving ? "opacity-100" : "opacity-0"}`}
            >
              Guardando...
            </span>
          </div>
          {metaUniform && firstRow ? (
            <div
              className="text-[9px] font-mono uppercase tracking-wide text-zinc-500 truncate"
              title={`Unidad · Fuente · Fórmula — ${metaLine(firstRow)}`}
            >
              {metaLine(firstRow)}
            </div>
          ) : null}
        </td>
        <td
          className="px-2 py-1 whitespace-nowrap font-mono text-accent-700 dark:text-accent-400"
          title="Cantidad por unidad definida por la regla del catálogo"
        >
          {material.unit_qty_per_unit ?? "-"} {material.unit || "-"}
        </td>
        {!isPerSubtype && firstRow ? renderQuantityCells(firstRow, 0) : <td colSpan={3} />}
        <td className="px-2 py-1">
          <div className="flex items-center justify-end gap-1">
            <button
              type="button"
              role="switch"
              aria-checked={isPerSubtype}
              aria-label="Cantidades por subtipo"
              title="Cantidades por subtipo"
              disabled={subtypeOptions.length === 0 && !isPerSubtype}
              onClick={() => void handleToggle(!isPerSubtype)}
              className={`relative h-4 w-7 rounded-full transition-all duration-200 ease-out ${
                isPerSubtype
                  ? "bg-accent-500 shadow-[inset_0_0_0_1px_rgba(249,115,22,0.85)]"
                  : "bg-zinc-300 dark:bg-zinc-600 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.08)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]"
              } disabled:opacity-50`}
            >
              <span
                className="absolute top-0.5 left-0.5 h-3 w-3 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.25)] transition-transform duration-200 ease-out"
                style={{
                  transform: isPerSubtype ? "translateX(12px)" : "translateX(0px)",
                }}
              />
            </button>
            <button
              type="button"
              onClick={onOpenCalculationSheet}
              disabled={material.rule_id === null}
              aria-label={`Abrir planilla de cálculo para ${material.material_name}`}
              title={material.rule_id === null ? "Las planillas de cálculo están disponibles para reglas de materiales del catálogo." : "Abrir planilla de cálculo"}
              className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-black/10 dark:border-white/10 bg-zinc-50 dark:bg-white/5 text-xs text-zinc-800 dark:text-zinc-200 disabled:opacity-40"
            >
              <i className="ph-bold ph-table" />
            </button>
            {material.source_status !== "missing" ? (
              <button
                type="button"
                onClick={() => void onDeleteMaterial(material.material_key)}
                aria-label={`Quitar ${material.material_name}`}
                title="Quitar material de esta instancia"
                className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-red-200 dark:border-red-500/20 bg-red-100 dark:bg-red-500/10 text-xs text-red-700 dark:text-red-300"
              >
                <i className="ph-bold ph-trash" />
              </button>
            ) : null}
          </div>
        </td>
      </tr>
      {isPerSubtype
        ? visibleRows.map(({ row, index }) => (
            <tr
              key={`${material.material_key}-${row.subtype_id ?? "general"}-${index}`}
              className={`${quantityClass(row.quantity)} hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors`}
            >
              <td className="px-2 py-1">
                <div
                  style={{ paddingLeft: `${14 + row.subtype_depth * 14}px` }}
                  className="flex items-center gap-1 font-medium text-zinc-800 dark:text-zinc-300"
                >
                  {row.subtype_id !== null && subtypeBranches.has(row.subtype_id) ? (
                    <button
                      type="button"
                      aria-expanded={expandedSubtypeIds.has(row.subtype_id)}
                      aria-label={`${expandedSubtypeIds.has(row.subtype_id) ? "Colapsar" : "Expandir"} subtipos de ${row.subtype}`}
                      title={expandedSubtypeIds.has(row.subtype_id) ? "Colapsar subtipos" : "Expandir subtipos"}
                      onClick={() => {
                        setExpandedSubtypeIds((current) => {
                          const next = new Set(current);
                          if (next.has(row.subtype_id as number)) {
                            next.delete(row.subtype_id as number);
                          } else {
                            next.add(row.subtype_id as number);
                          }
                          return next;
                        });
                      }}
                      className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-zinc-500 hover:bg-black/5 hover:text-zinc-900 dark:hover:bg-white/10 dark:hover:text-white"
                    >
                      <i
                        className={`ph-bold ${expandedSubtypeIds.has(row.subtype_id) ? "ph-caret-down" : "ph-caret-right"} text-[10px]`}
                        aria-hidden="true"
                      />
                    </button>
                  ) : (
                    <span className="inline-block h-4 w-4 shrink-0" />
                  )}
                  <span>{row.subtype}</span>
                  {row.subtype_id !== null &&
                  subtypeBranches.has(row.subtype_id) &&
                  !expandedSubtypeIds.has(row.subtype_id) ? (
                    <span className="rounded-full bg-zinc-100 px-1.5 py-px text-[9px] font-normal text-zinc-500 dark:bg-white/10 dark:text-zinc-400">
                      {subtypeBranches.get(row.subtype_id)?.descendantCount} subtipos{" "}
                      {subtypeBranches.get(row.subtype_id)?.uniform ? "iguales" : "ocultos"}
                    </span>
                  ) : null}
                </div>
                {row.inherited_from_subtype ? (
                  <div style={{ paddingLeft: `${14 + row.subtype_depth * 14}px` }} className="text-[9px] text-zinc-500">
                    Hereda de {row.inherited_from_subtype}
                  </div>
                ) : null}
                {!metaUniform ? (
                  <div
                    className="text-[9px] font-mono uppercase tracking-wide text-zinc-500 truncate"
                    title={`Unidad · Fuente · Fórmula — ${metaLine(row)}`}
                  >
                    {metaLine(row)}
                  </div>
                ) : null}
              </td>
              <td />
              {renderQuantityCells(row, index)}
              <td />
            </tr>
          ))
        : null}
      {error ? (
        <tr>
          <td colSpan={6} className="px-2 py-1 text-[11px] text-red-700 dark:text-red-300">{error}</td>
        </tr>
      ) : null}
    </tbody>
  );
}

function InstanceMaterialsTable({
  materials,
  subtypeOptions,
  onOpenCalculationSheet,
  onUpdateMaterial,
  onDeleteMaterial,
}: {
  materials: InstanceMaterial[];
  subtypeOptions: FlatSubtype[];
  onOpenCalculationSheet: (material: InstanceMaterial) => void;
  onUpdateMaterial: (materialKey: string, payload: { mode: string; entries: Array<{ subtype_id: number | null; quantity: number | null; assembly_quantity: number | null; inheritance_mode: "override" | "add" }> }) => Promise<void>;
  onDeleteMaterial: (materialKey: string) => Promise<void>;
}) {
  return (
    <div className="overflow-x-auto rounded-md border border-black/5 dark:border-white/5 bg-white dark:bg-black/20 shadow-sm">
      <table className="w-full text-left border-collapse text-xs">
        <thead className="bg-zinc-50 dark:bg-black/40 border-b border-black/10 dark:border-white/10">
          <tr>
            <th className="px-2 py-1 text-[9px] text-zinc-500 font-bold uppercase tracking-widest">Material / Subtipo</th>
            <th className="px-2 py-1 text-[9px] text-zinc-500 font-bold uppercase tracking-widest w-28"><FactoryQuantityLabel /> regla</th>
            <th className="px-2 py-1 text-[9px] text-zinc-500 font-bold uppercase tracking-widest text-right w-24"><FactoryQuantityLabel /></th>
            <th className="px-2 py-1 text-[9px] text-zinc-500 font-bold uppercase tracking-widest text-right w-24"><WorkQuantityLabel /></th>
            <th className="px-2 py-1 text-[9px] text-zinc-500 font-bold uppercase tracking-widest w-32">Comportamiento</th>
            <th className="px-2 py-1 text-[9px] text-zinc-500 font-bold uppercase tracking-widest text-right w-28">Acciones</th>
          </tr>
        </thead>
        {materials.map((material) => (
          <MaterialOccurrenceEditor
            key={material.material_key}
            material={material}
            subtypeOptions={subtypeOptions}
            onOpenCalculationSheet={() => onOpenCalculationSheet(material)}
            onUpdateMaterial={onUpdateMaterial}
            onDeleteMaterial={onDeleteMaterial}
          />
        ))}
      </table>
    </div>
  );
}

function ManualMaterialPicker({
  existingMaterialIds,
  onAddMaterial,
}: {
  existingMaterialIds: number[];
  onAddMaterial: (materialId: number) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CatalogMaterialSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [addingId, setAddingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const timeoutId = window.setTimeout(() => {
      api
        .searchCatalogMaterials(trimmed, 8)
        .then((response) => {
          if (!cancelled) {
            setResults(response.results);
            setError(null);
          }
        })
        .catch((err) => {
          if (!cancelled) {
            setError(err instanceof Error ? err.message : "No se pudieron buscar materiales.");
          }
        })
        .finally(() => {
          if (!cancelled) {
            setLoading(false);
          }
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [query]);

  async function handleAdd(result: CatalogMaterialSearchResult) {
    if (!result.material_id || existingMaterialIds.includes(result.material_id)) {
      return;
    }
    setAddingId(result.material_id);
    setError(null);
    try {
      await onAddMaterial(result.material_id);
      setQuery("");
      setResults([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo agregar el material.");
    } finally {
      setAddingId(null);
    }
  }

  return (
    <div className="rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-black/20 p-2 space-y-2">
      <div className="flex items-center gap-2">
        <i className="ph-bold ph-plus-circle text-zinc-500" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Agregar material por SKU o nombre"
          className="flex-1 rounded border border-black/10 dark:border-white/10 bg-zinc-50 dark:bg-black/30 px-2 py-1 text-xs"
        />
      </div>
      {loading ? <div className="text-[11px] text-zinc-500">Buscando...</div> : null}
      {results.length ? (
        <div className="divide-y divide-black/5 dark:divide-white/5 rounded border border-black/5 dark:border-white/5 overflow-hidden">
          {results.map((result) => {
            const alreadyAdded = result.material_id !== null && existingMaterialIds.includes(result.material_id);
            return (
              <button
                key={`${result.source}-${result.sku}-${result.material_id ?? "none"}`}
                type="button"
                disabled={!result.material_id || alreadyAdded || addingId === result.material_id}
                onClick={() => void handleAdd(result)}
                className="w-full flex items-center justify-between gap-3 px-2.5 py-1.5 text-left text-xs bg-zinc-50 dark:bg-white/5 hover:bg-zinc-100 dark:hover:bg-white/10 disabled:opacity-50"
              >
                <span className="min-w-0">
                  <span className="block font-semibold text-zinc-900 dark:text-zinc-100 truncate">{result.name}</span>
                  <span className="block text-[10px] font-mono text-zinc-500">{result.sku}</span>
                </span>
                <span className="text-[10px] font-semibold text-zinc-600 dark:text-zinc-300">
                  {alreadyAdded ? "Agregado" : addingId === result.material_id ? "Agregando..." : "Agregar"}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
      {error ? <div className="text-[11px] text-red-700 dark:text-red-300">{error}</div> : null}
    </div>
  );
}

type CommentOverlayState = {
  instanceId: number;
  instanceName: string;
  highlightCommentId?: number | null;
  source?: "badge" | "notification";
  notificationId?: number | null;
} | null;

const PENDING_COMMENT_NOTIFICATION_KEY = "spec-sheets.pendingCommentNotification";

function commentInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] || ""}${parts[parts.length - 1][0] || ""}`.toUpperCase();
}

function formatCommentDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function renderCommentBody(body: string, mentions: string[]) {
  const mentionSet = new Set(mentions.map((mention) => `@${mention.toLowerCase()}`));
  return body.split(/(\s+)/).map((part, index) => {
    const normalized = part.replace(/[.,!?;:)]+$/, "").toLowerCase();
    if (mentionSet.has(normalized)) {
      return (
        <span key={`${part}-${index}`} className="rounded bg-accent-500/10 px-1 font-semibold text-accent-700 dark:text-accent-400">
          {part}
        </span>
      );
    }
    return part;
  });
}

function getMentionContext(text: string, caretPosition: number) {
  const searchStart = Math.max(0, caretPosition - 1);
  const start = text.lastIndexOf("@", searchStart);
  if (start === -1) {
    return null;
  }
  const previous = start > 0 ? text[start - 1] : "";
  if (previous && !/\s|[([{]/.test(previous)) {
    return null;
  }
  const query = text.slice(start + 1, caretPosition);
  if (query.includes("@") || query.includes("\n") || /\s/.test(query)) {
    return null;
  }
  return { start, end: caretPosition, query };
}

function CommentComposer({
  mentionableUsers,
  onSubmit,
  onCancel,
  autoFocus = false,
  placeholder = "Escribe un comentario. Usa @usuario para mencionar.",
}: {
  mentionableUsers: ManagedUser[];
  onSubmit: (body: string) => Promise<void>;
  onCancel?: () => void;
  autoFocus?: boolean;
  placeholder?: string;
}) {
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const mentionContext = getMentionContext(body, textareaRef.current?.selectionStart ?? body.length);
  const mentionSuggestions = mentionContext
    ? mentionableUsers
        .filter((user) => {
          const term = mentionContext.query.toLowerCase();
          return user.username.toLowerCase().startsWith(term) || user.display_name.toLowerCase().includes(term);
        })
        .slice(0, 8)
    : [];

  function applyMention(user: ManagedUser) {
    if (!mentionContext) {
      return;
    }
    const insertion = `@${user.username} `;
    const nextBody = `${body.slice(0, mentionContext.start)}${insertion}${body.slice(mentionContext.end)}`;
    const nextCaret = mentionContext.start + insertion.length;
    setBody(nextBody);
    window.setTimeout(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(nextCaret, nextCaret);
    }, 0);
    setActiveSuggestionIndex(0);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (!mentionSuggestions.length) {
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveSuggestionIndex((current) => (current + 1) % mentionSuggestions.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveSuggestionIndex((current) => (current - 1 + mentionSuggestions.length) % mentionSuggestions.length);
    } else if (event.key === "Tab" || event.key === "Enter") {
      event.preventDefault();
      applyMention(mentionSuggestions[activeSuggestionIndex] || mentionSuggestions[0]);
    } else if (event.key === "Escape") {
      setActiveSuggestionIndex(0);
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = body.trim();
    if (!trimmed) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSubmit(trimmed);
      setBody("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar el comentario.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="space-y-2" onSubmit={handleSubmit}>
      <div className="relative">
        {mentionSuggestions.length ? (
          <div className="absolute bottom-full left-0 right-0 z-50 mb-1 max-h-56 overflow-y-auto rounded-lg border border-black/10 bg-white shadow-lg dark:border-white/10 dark:bg-zinc-900">
            {mentionSuggestions.map((user, index) => (
              <button
                key={user.id}
                type="button"
                onMouseDown={(event) => {
                  event.preventDefault();
                  applyMention(user);
                }}
                className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs ${
                  index === activeSuggestionIndex ? "bg-accent-500/10 text-zinc-900 dark:text-zinc-100" : "text-zinc-600 dark:text-zinc-300"
                }`}
              >
                <span className="truncate font-semibold">{user.display_name || user.username}</span>
                <span className="shrink-0 font-mono text-zinc-500">@{user.username}</span>
              </button>
            ))}
          </div>
        ) : null}
        <textarea
          ref={textareaRef}
          value={body}
          autoFocus={autoFocus}
          rows={3}
          onChange={(event) => {
            setBody(event.target.value);
            setActiveSuggestionIndex(0);
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="w-full resize-none rounded-lg border border-black/10 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-accent-500/50 focus:outline-none dark:border-white/10 dark:bg-black/30 dark:text-zinc-100"
        />
      </div>
      {error ? <div className="text-xs text-red-700 dark:text-red-300">{error}</div> : null}
      <div className="flex justify-end gap-2">
        {onCancel ? (
          <button type="button" onClick={onCancel} className="px-3 py-1.5 text-xs font-semibold text-zinc-600 dark:text-zinc-300">
            Cancelar
          </button>
        ) : null}
        <button
          type="submit"
          disabled={saving || !body.trim()}
          className="rounded bg-accent-500 px-3 py-1.5 text-xs font-bold text-zinc-950 disabled:opacity-50"
        >
          {saving ? "Publicando..." : "Publicar"}
        </button>
      </div>
    </form>
  );
}

function CommentItem({
  comment,
  mentionableUsers,
  highlightCommentId,
  onReply,
  onDelete,
  level = 0,
}: {
  comment: ProjectComment;
  mentionableUsers: ManagedUser[];
  highlightCommentId?: number | null;
  onReply: (parentCommentId: number, body: string) => Promise<void>;
  onDelete: (commentId: number) => Promise<void>;
  level?: number;
}) {
  const [replying, setReplying] = useState(false);
  const displayName = comment.author_display_name || comment.author;
  const highlighted = highlightCommentId === comment.id;

  return (
    <div id={`comment-${comment.id}`} className={level ? "ml-5 border-l border-black/10 pl-3 dark:border-white/10" : ""}>
      <div
        className={`rounded-lg border p-3 transition-colors ${
          highlighted
            ? "border-accent-500/60 bg-accent-500/10"
            : "border-black/10 bg-white dark:border-white/10 dark:bg-black/20"
        }`}
      >
        <div className="mb-2 flex items-center gap-2">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-zinc-200 text-[10px] font-bold text-zinc-700 dark:bg-white/10 dark:text-zinc-200">
            {commentInitials(displayName)}
          </span>
          <div className="min-w-0">
            <div className="truncate text-xs font-semibold text-zinc-900 dark:text-zinc-100">{displayName}</div>
            <div className="text-[10px] font-mono text-zinc-500">{formatCommentDate(comment.created_at)}</div>
          </div>
        </div>
        <div className="whitespace-pre-wrap break-words text-sm text-zinc-700 dark:text-zinc-300">
          {comment.is_deleted ? <em className="text-zinc-500">[eliminado]</em> : renderCommentBody(comment.body, comment.mentions)}
        </div>
        <div className="mt-2 flex gap-2">
          <button type="button" onClick={() => setReplying((current) => !current)} className="text-xs font-semibold text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
            Responder
          </button>
          {comment.is_author && !comment.is_deleted ? (
            <button type="button" onClick={() => void onDelete(comment.id)} className="text-xs font-semibold text-red-600 hover:text-red-700">
              Eliminar
            </button>
          ) : null}
        </div>
        {replying ? (
          <div className="mt-3">
            <CommentComposer
              autoFocus
              mentionableUsers={mentionableUsers}
              placeholder="Escribe una respuesta."
              onCancel={() => setReplying(false)}
              onSubmit={async (body) => {
                await onReply(comment.id, body);
                setReplying(false);
              }}
            />
          </div>
        ) : null}
      </div>
      {comment.replies.length ? (
        <div className="mt-3 space-y-3">
          {comment.replies.map((reply) => (
            <CommentItem
              key={reply.id}
              comment={reply}
              mentionableUsers={mentionableUsers}
              highlightCommentId={highlightCommentId}
              onReply={onReply}
              onDelete={onDelete}
              level={level + 1}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function CommentsOverlay({
  open,
  instanceName,
  comments,
  loading,
  mentionableUsers,
  highlightCommentId,
  onClose,
  onCreate,
  onReply,
  onDelete,
}: {
  open: boolean;
  instanceName: string;
  comments: ProjectComment[];
  loading: boolean;
  mentionableUsers: ManagedUser[];
  highlightCommentId?: number | null;
  onClose: () => void;
  onCreate: (body: string) => Promise<void>;
  onReply: (parentCommentId: number, body: string) => Promise<void>;
  onDelete: (commentId: number) => Promise<void>;
}) {
  useEffect(() => {
    if (!open || !highlightCommentId) {
      return;
    }
    const timeoutId = window.setTimeout(() => {
      document.getElementById(`comment-${highlightCommentId}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 100);
    return () => window.clearTimeout(timeoutId);
  }, [open, highlightCommentId, comments]);

  if (!open) {
    return null;
  }

  return (
    <>
      <div className="fixed inset-0 z-30 bg-transparent" onClick={onClose} aria-hidden="true" />
      <aside className="fixed left-16 top-16 bottom-0 z-40 w-[min(440px,calc(100vw-4rem))] border-r border-black/10 bg-zinc-50 shadow-2xl dark:border-white/10 dark:bg-zinc-950">
        <div className="flex h-full flex-col">
          <div className="flex items-start justify-between gap-3 border-b border-black/10 px-4 py-4 dark:border-white/10">
            <div className="min-w-0">
              <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Comentarios</div>
              <h3 className="truncate text-sm font-bold text-zinc-900 dark:text-zinc-100">{instanceName}</h3>
            </div>
            <button type="button" onClick={onClose} className="inline-flex h-8 w-8 items-center justify-center rounded-lg hover:bg-black/5 dark:hover:bg-white/10">
              <i className="ph-bold ph-x" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-4">
            {loading ? (
              <div className="text-sm text-zinc-500">Cargando comentarios...</div>
            ) : comments.length ? (
              <div className="space-y-3">
                {comments.map((comment) => (
                  <CommentItem
                    key={comment.id}
                    comment={comment}
                    mentionableUsers={mentionableUsers}
                    highlightCommentId={highlightCommentId}
                    onReply={onReply}
                    onDelete={onDelete}
                  />
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-black/10 p-4 text-sm text-zinc-500 dark:border-white/10">
                Sin comentarios todavía.
              </div>
            )}
          </div>
          <div className="border-t border-black/10 bg-white p-4 dark:border-white/10 dark:bg-black/30">
            <CommentComposer mentionableUsers={mentionableUsers} onSubmit={onCreate} />
          </div>
        </div>
      </aside>
    </>
  );
}

function InstanceCard({
  expandAll,
  instance,
  focused,
  incomingOccurrenceSourceIds,
  onSelectInstance,
  readOnly,
  subtypeOptions,
  targetOptions,
  syncPreview,
  syncPreviewLoading,
  onEnsureSyncPreview,
  onOpenSyncModal,
  onEdit,
  onDelete,
  onOpenComments,
  onCreateLinkedAccessory,
  linkedAccessoryCategories,
  onOpenCalculationSheet,
  onCreateOccurrence,
  onUpdateOccurrence,
  onDeleteOccurrence,
  onUpdateMaterial,
  onAddManualMaterial,
  onDeleteMaterial,
}: {
  instance: ProjectInstance;
  expandAll: boolean | null;
  focused: boolean;
  incomingOccurrenceSourceIds: ReadonlyMap<number, number>;
  onSelectInstance: (instanceId: number) => void;
  readOnly: boolean;
  subtypeOptions: FlatSubtype[];
  targetOptions: TargetOption[];
  syncPreview: InstanceSyncPreview | null;
  syncPreviewLoading: boolean;
  onEnsureSyncPreview: () => Promise<void>;
  onOpenSyncModal: (field: SyncFieldKey) => void;
  onEdit: () => void;
  onDelete: () => void;
  onOpenComments: () => void;
  onCreateLinkedAccessory: () => void;
  linkedAccessoryCategories: ProjectCategorySection[];
  onOpenCalculationSheet: (material: InstanceMaterial) => void;
  onCreateOccurrence: (payload: UpdateProjectOccurrenceRequest) => Promise<void>;
  onUpdateOccurrence: (occurrenceId: number, payload: UpdateProjectOccurrenceRequest) => Promise<void>;
  onDeleteOccurrence: (occurrenceId: number) => Promise<void>;
  onUpdateMaterial: (materialKey: string, payload: { mode: string; entries: Array<{ subtype_id: number | null; quantity: number | null; assembly_quantity: number | null }> }) => Promise<void>;
  onAddManualMaterial: (materialId: number) => Promise<void>;
  onDeleteMaterial: (materialKey: string) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(focused);
  const [materialsExpanded, setMaterialsExpanded] = useState(true);
  const nameSync = getScalarSyncField(syncPreview, "name");
  const shortNameSync = getScalarSyncField(syncPreview, "short_name");
  const descriptionSync = getScalarSyncField(syncPreview, "description");
  const shortDescriptionSync = getScalarSyncField(syncPreview, "short_description");
  const installationSync = getScalarSyncField(syncPreview, "installation");
  const attributeSchemaSync = syncPreview?.attribute_schema ?? null;
  const primaryMedia = instance.media[0] || null;

  useEffect(() => {
    if (!readOnly && expanded && !syncPreview && !syncPreviewLoading) {
      void onEnsureSyncPreview();
    }
  }, [expanded, onEnsureSyncPreview, readOnly, syncPreview, syncPreviewLoading]);

  useEffect(() => {
    if (focused) {
      setExpanded(true);
    }
  }, [focused]);

  useEffect(() => {
    if (expandAll !== null) {
      setExpanded(expandAll);
    }
  }, [expandAll]);

  return (
    <div id={`instance-${instance.id}`} className="scroll-mt-24 border-b border-black/10 dark:border-white/10 last:border-0">
      <div 
        className="flex items-center justify-between p-4 bg-white dark:bg-black/20 shadow-sm group hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors cursor-pointer"
        onClick={() => setExpanded((current) => !current)}
      >
        <div className="min-w-0 flex items-center gap-3">
          {primaryMedia ? (
            <img
              src={toAppPath(primaryMedia.uri)}
              alt={primaryMedia.original_filename || instance.name}
              className="w-14 h-10 object-contain rounded border border-black/10 dark:border-white/10 bg-zinc-50 dark:bg-white/5 shrink-0"
            />
          ) : null}
          <div className="min-w-0">
          <div className="font-bold text-zinc-900 dark:text-white text-[15px] flex items-center gap-2 min-w-0">
            <span className="truncate">{instance.name}</span>
            {!readOnly ? <SyncIndicatorButton
              status={nameSync?.status}
              title="Ver detalles de sincronización del nombre"
              onClick={() => onOpenSyncModal("name")}
            /> : null}
            {!readOnly ? <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onOpenComments();
              }}
              className={`inline-flex h-7 items-center gap-1 rounded-md border px-1.5 text-[11px] font-semibold transition-colors ${
                instance.comment_summary?.unread_count
                  ? "border-accent-500/40 bg-accent-500/10 text-accent-700 dark:text-accent-400"
                  : "border-black/10 bg-zinc-50 text-zinc-500 hover:text-zinc-900 dark:border-white/10 dark:bg-white/5 dark:hover:text-zinc-100"
              }`}
              aria-label={`Abrir comentarios de ${instance.name}`}
              title="Comentarios"
            >
              <i className="ph-bold ph-chat-circle-text" />
              <span>{instance.comment_summary?.total_count || 0}</span>
              {instance.comment_summary?.unread_count ? <span className="h-1.5 w-1.5 rounded-full bg-accent-500" /> : null}
            </button> : null}
            {!readOnly && instance.type === "item" && linkedAccessoryCategories.length ? <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onCreateLinkedAccessory();
              }}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-accent-500/30 bg-accent-500/10 text-accent-700 dark:text-accent-400 transition-colors hover:bg-accent-500/20"
              aria-label={`Crear accesorio vinculado a ${instance.name}`}
              title="Crear accesorio vinculado"
            >
              <i className="ph-bold ph-link" />
            </button> : null}
          </div>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {!readOnly ? <div className="flex items-center gap-2 opacity-0 pointer-events-none transition-opacity group-hover:opacity-100 group-hover:pointer-events-auto focus-within:opacity-100 focus-within:pointer-events-auto">
            <button
              type="button"
              aria-label={`Editar ${instance.name}`}
              title="Editar instancia"
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
              aria-label={`Eliminar ${instance.name}`}
              title="Eliminar instancia"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-red-200 dark:border-red-500/20 bg-red-100 dark:bg-red-500/10 text-red-700 dark:text-red-400 transition-colors hover:bg-red-200 dark:hover:bg-red-500/20"
              onClick={(event) => {
                event.stopPropagation();
                onDelete();
              }}
            >
              <i className="ph-bold ph-trash" />
            </button>
          </div> : null}
          <i className={`ph-bold ${expanded ? "ph-caret-up" : "ph-caret-down"} text-zinc-600 dark:text-zinc-300`} />
        </div>
      </div>

      {expanded ? (
        <div className="border-t border-black/5 dark:border-white/5 bg-white dark:bg-black/40 p-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            <div className="space-y-6">
              <div>
                <h6 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-2 flex items-center gap-2">
                  <i className="ph-bold ph-info text-zinc-600" /> Información
                </h6>
                {instance.short_name && instance.short_name.trim() !== "" && instance.short_name !== instance.name ? (
                  <div className="mb-3">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Nombre Comercial</span>
                      {!readOnly ? <SyncIndicatorButton
                        status={shortNameSync?.status}
                        title="Ver detalles de sincronización del nombre comercial"
                        onClick={() => onOpenSyncModal("short_name")}
                      /> : null}
                    </div>
                    <p className="text-sm font-mono text-zinc-800 dark:text-zinc-300">{instance.short_name}</p>
                  </div>
                ) : null}
                <div className="mb-3">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Descripción</span>
                    {!readOnly ? <SyncIndicatorButton
                      status={descriptionSync?.status}
                      title="Ver detalles de sincronización de la descripción"
                      onClick={() => onOpenSyncModal("description")}
                    /> : null}
                  </div>
                  <p className={`text-sm ${descriptionSync?.status === "customized" ? "text-sky-800 dark:text-sky-200 relative pl-3 before:absolute before:left-0 before:top-2 before:w-1.5 before:h-1.5 before:rounded-full before:bg-sky-400" : "text-zinc-800 dark:text-zinc-300"}`}>
                    {instance.description || "Sin descripción."}
                  </p>
                </div>
                <div className="mb-3">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Descripción Corta</span>
                    {!readOnly ? <SyncIndicatorButton
                      status={shortDescriptionSync?.status}
                      title="Ver detalles de sincronización de la descripción corta"
                      onClick={() => onOpenSyncModal("short_description")}
                    /> : null}
                  </div>
                  <p className={`text-xs ${shortDescriptionSync?.status === "customized" ? "text-sky-800 dark:text-sky-200 relative pl-3 before:absolute before:left-0 before:top-1 before:w-1.5 before:h-1.5 before:rounded-full before:bg-sky-400" : "text-zinc-600 dark:text-zinc-400"}`}>
                    {instance.short_description || "Sin descripción corta."}
                  </p>
                </div>
                <div className="flex items-center gap-4 text-xs font-mono">
                  <span className="text-zinc-600 dark:text-zinc-400">
                    <FactoryQuantityLabel /> Unitaria: <strong className="text-zinc-900 dark:text-zinc-200">{instance.unit_amount ?? "-"}</strong>
                  </span>
                </div>
              </div>

              {instance.type === "accessory" && !readOnly ? (
                <UsageManager
                  instance={instance}
                  targetOptions={targetOptions}
                  onCreateOccurrence={onCreateOccurrence}
                  onUpdateOccurrence={onUpdateOccurrence}
                  onDeleteOccurrence={onDeleteOccurrence}
                />
              ) : instance.outgoing_occurrences.length ? (
                <div>
                  <h6 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-2 flex items-center gap-2">
                    <i className="ph-bold ph-flow-arrow text-zinc-600" /> Resumen de usos
                  </h6>
                  <ul className="max-h-44 overflow-y-auto divide-y divide-black/5 dark:divide-white/5">
                    {instance.outgoing_occurrences.map((occurrence, index) => renderOccurrenceSummary(occurrence, index))}
                  </ul>
                </div>
              ) : null}

              {instance.incoming_occurrences.length ? (
                <div>
                  <h6 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-2 flex items-center gap-2">
                    <i className="ph-bold ph-arrow-bend-up-left text-zinc-600" /> Referenciado aquí
                  </h6>
                  <ul className="max-h-44 overflow-y-auto divide-y divide-black/5 dark:divide-white/5">
                    {instance.incoming_occurrences.map((occurrence, index) => {
                      const sourceInstanceId = incomingOccurrenceSourceIds.get(occurrence.id);
                      return renderOccurrenceSummary(occurrence, index, {
                        primaryLabel: getIncomingOccurrencePrimaryLabel(instance, occurrence, index, instance.incoming_occurrences),
                        showRelationshipType: false,
                        onClick: sourceInstanceId === undefined ? undefined : () => onSelectInstance(sourceInstanceId),
                      });
                    })}
                  </ul>
                </div>
              ) : null}

              <div>
                <h6 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-2 flex items-center gap-2">
                  <i className="ph-bold ph-wrench text-zinc-600" /> Instalación
                  {!readOnly ? <SyncIndicatorButton
                    status={installationSync?.status}
                    title="Ver detalles de sincronización de instalación"
                    onClick={() => onOpenSyncModal("installation")}
                  /> : null}
                </h6>
                <p className="text-sm text-zinc-600 dark:text-zinc-400">{instance.installation || "Sin notas de instalación."}</p>
              </div>
            </div>

            <div className="bg-white dark:bg-black/40 border border-black/5 dark:border-white/5 rounded-lg p-4">
              <div className="flex items-center justify-between gap-3 mb-4">
                <h5 className="text-xs font-bold text-zinc-500 uppercase tracking-widest flex items-center gap-2">
                  <i className="ph-bold ph-list-dashes text-zinc-600" /> Atributos
                </h5>
                {!readOnly ? <SyncIndicatorButton
                  status={attributeSchemaSync?.status}
                  title="Ver detalles de sincronización de atributos"
                  onClick={() => onOpenSyncModal("attributes")}
                /> : null}
              </div>
              
              {(() => {
                const missingAttributes = attributeSchemaSync?.differences.filter((item) => item.status === "missing_in_instance") || [];
                const extraAttributes = new Set(attributeSchemaSync?.differences.filter((item) => item.status === "extra_in_instance").map(d => d.name) || []);

                return (
                  <>
                    {instance.attributes.length ? (
                      instance.attributes.map((group) => (
                        <div key={`${instance.id}-${group.name}`} className="mb-4 last:mb-0">
                          <h5 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-2 flex items-center gap-2">
                            <i className="ph-bold ph-list-dashes text-zinc-600" /> {translateProjectDetailLabel(group.name)}
                          </h5>
                          <table className="w-full text-left border-collapse text-sm">
                            <tbody className="divide-y divide-black/5 dark:divide-white/10">
                              {group.values.map((row) => {
                                const isExtra = extraAttributes.has(row.name);
                                return (
                                  <tr key={`${group.name}-${row.name}`} className={isExtra ? "bg-sky-50/30 dark:bg-sky-950/20" : ""}>
                                    <td className={`py-1.5 w-1/2 ${isExtra ? "text-sky-700 dark:text-sky-300 font-medium" : "text-zinc-500"}`}>
                                      {row.name}
                                      {isExtra && (
                                        <span title="Atributo personalizado no presente en el catálogo" className="inline-block ml-1.5 align-middle w-1.5 h-1.5 rounded-full bg-sky-400"></span>
                                      )}
                                    </td>
                                    <td className={`py-1.5 font-mono w-1/2 ${isExtra ? "text-sky-800 dark:text-sky-200" : "text-zinc-900 dark:text-zinc-200"}`}>{row.value || "-"}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      ))
                    ) : (
                      <p className="text-xs text-zinc-500 font-mono italic">No hay atributos cargados.</p>
                    )}

                    {missingAttributes.length > 0 && (
                      <div className="mt-4 pt-4 border-t border-dashed border-black/10 dark:border-white/10">
                        <h5 className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-2 flex items-center gap-2">
                          <i className="ph-bold ph-ghost text-zinc-400" /> Atributos faltantes del catálogo
                        </h5>
                        <table className="w-full text-left border-collapse text-sm opacity-50">
                          <tbody className="divide-y divide-black/5 dark:divide-white/10">
                            {missingAttributes.map((diff) => (
                              <tr key={`missing-${diff.name}`}>
                                <td className="py-1.5 text-zinc-500 w-1/2">{diff.name}</td>
                                <td className="py-1.5 text-zinc-500 font-mono w-1/2 italic">Sin definir</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          </div>

          {!readOnly ? <div className="border-t border-black/10 dark:border-white/10 pt-4">
            <button
              type="button"
              onClick={() => setMaterialsExpanded((current) => !current)}
              className="w-full flex items-center justify-between text-left mb-3"
            >
              <h6 className="text-xs font-bold text-zinc-500 uppercase tracking-widest flex items-center gap-2">
                <i className="ph-bold ph-boxes text-zinc-600" /> Materiales aplicables
              </h6>
              <i className={`ph-bold ${materialsExpanded ? "ph-caret-up" : "ph-caret-down"} text-zinc-600 dark:text-zinc-300`} />
            </button>
            {materialsExpanded ? (
              <div className="space-y-2">
                <ManualMaterialPicker
                  existingMaterialIds={instance.materials.map((material) => material.material_id)}
                  onAddMaterial={onAddManualMaterial}
                />
                {instance.materials.filter(m => m.source_status === "catalog").length ? (
                  <InstanceMaterialsTable
                    materials={instance.materials.filter(m => m.source_status === "catalog")}
                    subtypeOptions={subtypeOptions}
                    onOpenCalculationSheet={onOpenCalculationSheet}
                    onUpdateMaterial={onUpdateMaterial}
                    onDeleteMaterial={onDeleteMaterial}
                  />
                ) : null}

                {instance.materials.filter(m => m.source_status !== "catalog").length ? (
                  <div className="mt-4 pt-3 border-t border-dashed border-black/10 dark:border-white/10">
                    <h6 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2 flex items-center gap-2">
                      <i className="ph-bold ph-warning-circle text-zinc-400" /> Excepciones (Manual / Faltante)
                    </h6>
                    <InstanceMaterialsTable
                      materials={instance.materials.filter(m => m.source_status !== "catalog")}
                      subtypeOptions={subtypeOptions}
                      onOpenCalculationSheet={onOpenCalculationSheet}
                      onUpdateMaterial={onUpdateMaterial}
                      onDeleteMaterial={onDeleteMaterial}
                    />
                  </div>
                ) : null}

                {!instance.materials.length ? (
                  <div className="text-center py-6 text-xs text-zinc-500 font-mono border border-dashed border-black/10 dark:border-white/10 rounded">
                    No hay materiales aplicables para este item
                  </div>
                ) : null}
              </div>
            ) : null}
          </div> : null}
        </div>
      ) : null}
    </div>
  );
}

export function ProjectDetailPage({ projectId, onTitleChange, readOnly = false }: ProjectDetailPageProps) {
  const [data, setData] = useState<ProjectDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [categorySearch, setCategorySearch] = useState("");
  const [allItemsExpanded, setAllItemsExpanded] = useState<boolean | null>(null);
  const [focusedInstanceId, setFocusedInstanceId] = useState<number | null>(() => {
    const match = window.location.hash.match(/^#instance-(\d+)$/);
    return match ? Number(match[1]) : null;
  });
  const [instanceScrollRequest, setInstanceScrollRequest] = useState(0);
  const pendingInstanceScrollRef = useRef<number | null>(focusedInstanceId);
  const [modalState, setModalState] = useState<ModalState>(null);
  const [linkedAccessoryState, setLinkedAccessoryState] = useState<LinkedAccessoryState>(null);
  const [calculationSheetState, setCalculationSheetState] = useState<CalculationSheetState>(null);
  const [syncModalState, setSyncModalState] = useState<SyncModalState>(null);
  const [syncPreviews, setSyncPreviews] = useState<Record<number, InstanceSyncPreview>>({});
  const [syncPreviewLoading, setSyncPreviewLoading] = useState<Record<number, boolean>>({});
  const [syncingInstanceId, setSyncingInstanceId] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [commentOverlay, setCommentOverlay] = useState<CommentOverlayState>(null);
  const [comments, setComments] = useState<ProjectComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [mentionableUsers, setMentionableUsers] = useState<ManagedUser[]>([]);
  const [commentNavigationTick, setCommentNavigationTick] = useState(0);
  const handledCommentHashRef = useRef<number | null>(null);

  async function loadProject(showSpinner = true) {
    if (showSpinner) {
      setLoading(true);
    }
    setError(null);
    try {
      setData(await api.getProject(projectId));
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "No se pudo cargar el proyecto.";
      setError(message);
    } finally {
      if (showSpinner) {
        setLoading(false);
      }
    }
  }

  async function loadInstanceComments(instanceId: number) {
    setCommentsLoading(true);
    try {
      setComments(await api.getProjectComments(projectId, instanceId));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudieron cargar los comentarios.");
      throw err;
    } finally {
      setCommentsLoading(false);
    }
  }

  async function openCommentsForInstance(nextState: NonNullable<CommentOverlayState>) {
    setCommentOverlay(nextState);
    if (!mentionableUsers.length) {
      try {
        const directory = await api.getMentionableUsers(projectId);
        setMentionableUsers(directory.users);
      } catch {
        setMentionableUsers([]);
      }
    }
    await loadInstanceComments(nextState.instanceId);
    if (nextState.source === "notification" && nextState.notificationId) {
      await api.markNotificationRead(nextState.notificationId);
      setData((current) =>
        current
          ? updateInstanceCommentSummary(current, nextState.instanceId, (summary) => ({
              ...summary,
              unread_count: Math.max(0, summary.unread_count - 1),
            }))
          : current,
      );
    } else if (nextState.source === "badge") {
      await api.markInstanceNotificationsRead(projectId, nextState.instanceId);
      setData((current) =>
        current
          ? updateInstanceCommentSummary(current, nextState.instanceId, (summary) => ({ ...summary, unread_count: 0 }))
          : current,
      );
    }
  }

  async function createComment(body: string, parentCommentId?: number | null) {
    if (!commentOverlay) {
      return;
    }
    await api.createProjectComment(projectId, {
      body,
      instance_id: commentOverlay.instanceId,
      parent_comment_id: parentCommentId ?? null,
    });
    await loadInstanceComments(commentOverlay.instanceId);
    setData((current) =>
      current
        ? updateInstanceCommentSummary(current, commentOverlay.instanceId, (summary) => ({
            ...summary,
            total_count: summary.total_count + 1,
          }))
        : current,
    );
  }

  async function deleteComment(commentId: number) {
    if (!commentOverlay || !window.confirm("¿Eliminar este comentario?")) {
      return;
    }
    const result = await api.deleteProjectComment(projectId, commentId);
    await loadInstanceComments(commentOverlay.instanceId);
    if (!result.soft_deleted) {
      setData((current) =>
        current
          ? updateInstanceCommentSummary(current, commentOverlay.instanceId, (summary) => ({
              ...summary,
              total_count: Math.max(0, summary.total_count - 1),
            }))
          : current,
      );
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
      const message = err instanceof ApiError ? err.message : "No se pudieron cargar los detalles de sincronización.";
      setError(message);
      throw err;
    } finally {
      setSyncPreviewLoading((current) => ({ ...current, [instanceId]: false }));
    }
  }

  useEffect(() => {
    onTitleChange?.("Proyecto");
    setSyncPreviews({});
    setSyncPreviewLoading({});
    setSyncModalState(null);
    setLinkedAccessoryState(null);
    setCommentOverlay(null);
    setComments([]);
    void loadProject();
  }, [onTitleChange, projectId]);

  useEffect(() => {
    if (!focusedInstanceId || !data || pendingInstanceScrollRef.current !== focusedInstanceId) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      pendingInstanceScrollRef.current = null;
      document.getElementById(`instance-${focusedInstanceId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [data, focusedInstanceId, instanceScrollRequest]);

  useEffect(() => {
    const handleCommentNavigation = () => setCommentNavigationTick((current) => current + 1);
    window.addEventListener("spec-sheets:comment-navigation", handleCommentNavigation);
    window.addEventListener("hashchange", handleCommentNavigation);
    return () => {
      window.removeEventListener("spec-sheets:comment-navigation", handleCommentNavigation);
      window.removeEventListener("hashchange", handleCommentNavigation);
    };
  }, []);

  useEffect(() => {
    if (!data) {
      return;
    }
    const hashMatch = window.location.hash.match(/^#comment-(\d+)$/);
    const pendingRaw = window.sessionStorage.getItem(PENDING_COMMENT_NOTIFICATION_KEY);
    if (!hashMatch && !pendingRaw) {
      return;
    }

    let pending: { notificationId?: number; projectId?: number; instanceId?: number | null; commentId?: number } | null = null;
    if (pendingRaw) {
      try {
        pending = JSON.parse(pendingRaw);
      } catch {
        pending = null;
      }
    }
    const commentId = pending?.commentId || (hashMatch ? Number(hashMatch[1]) : null);
    if (!commentId) {
      return;
    }
    const targetCommentId = commentId;
    if (!pending && handledCommentHashRef.current === commentId) {
      return;
    }

    const allInstances = data.categories.flatMap((category) => category.instances);
    const directInstance = pending?.instanceId ? allInstances.find((instance) => instance.id === pending?.instanceId) : null;

    async function openPendingComment() {
      let instance = directInstance || null;
      if (!instance) {
        const context = await api.getCommentContext(targetCommentId);
        if (context.project_id !== projectId || !context.instance_id) {
          return;
        }
        instance = allInstances.find((item) => item.id === context.instance_id) || null;
      }
      if (!instance) {
        return;
      }
      window.sessionStorage.removeItem(PENDING_COMMENT_NOTIFICATION_KEY);
      handledCommentHashRef.current = targetCommentId;
      await openCommentsForInstance({
        instanceId: instance.id,
        instanceName: instance.name,
        highlightCommentId: targetCommentId,
        source: pending?.notificationId ? "notification" : undefined,
        notificationId: pending?.notificationId || null,
      });
    }

    void openPendingComment().catch((err) => {
      setError(err instanceof ApiError ? err.message : "No se pudo abrir el comentario.");
    });
  }, [commentNavigationTick, data, projectId]);

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

  const linkedAccessoryCategoryOptions = linkedAccessoryState && data
    ? linkedAccessoryState.categoryIds
        .map((categoryId) => data.categories.find((category) => category.id === categoryId))
        .filter((category): category is ProjectCategorySection => Boolean(category))
    : [];
  const activeLinkedAccessoryCategory = linkedAccessoryState?.selectedCategoryId
    ? linkedAccessoryCategoryOptions.find((category) => category.id === linkedAccessoryState.selectedCategoryId) || null
    : null;

  const activeSyncInstance = syncModalState && data
    ? data.categories.flatMap((category) => category.instances).find((instance) => instance.id === syncModalState.instanceId) || null
    : null;

  async function handleCreateInstance(payload: InstanceFormPayload) {
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
        selected_material_rule_ids: payload.selected_material_rule_ids ?? [],
        media_asset_id: payload.media_asset_id ?? null,
      });
      if (result.instance) {
        setData((current) => (current ? upsertCategoryInstance(current, activeCategory.id, result.instance as ProjectInstance) : current));
      }
      setModalState(null);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "No se pudo crear la instancia de proyecto.";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCreateLinkedAccessory(payload: InstanceFormPayload) {
    const currentLinkedAccessoryState = linkedAccessoryState;
    const category = activeLinkedAccessoryCategory;
    if (!currentLinkedAccessoryState || !category || !payload.component_id) {
      return;
    }

    setSubmitting(true);
    setError(null);
    let createdInstance: ProjectInstance | null = null;
    try {
      const result = await api.createProjectInstance(projectId, {
        category_id: category.id,
        component_id: payload.component_id,
        name: payload.name,
        short_name: payload.short_name,
        description: payload.description,
        short_description: payload.short_description,
        installation: payload.installation,
        unit_amount: payload.unit_amount,
        attribute_values: payload.attribute_values,
        selected_material_rule_ids: payload.selected_material_rule_ids ?? [],
        media_asset_id: payload.media_asset_id ?? null,
      });
      if (!result.instance) {
        throw new Error("No se pudo crear la instancia del accesorio.");
      }

      createdInstance = result.instance as ProjectInstance;
      setData((current) => (current ? upsertCategoryInstance(current, category.id, createdInstance as ProjectInstance) : current));

      const occurrenceResult = await api.createProjectOccurrence(projectId, createdInstance.id, {
        relationship_type: "uses",
        context_label: null,
        target_instance_id: currentLinkedAccessoryState.targetInstanceId,
        attribute_values: [],
      });
      if (!occurrenceResult.occurrence) {
        throw new Error("El accesorio fue creado, pero no se pudo vincular al ítem.");
      }

      setData((current) =>
        current ? applyOccurrenceToProject(current, createdInstance?.id || 0, occurrenceResult.occurrence as UsageOccurrence) : current,
      );
      setLinkedAccessoryState(null);
    } catch (err) {
      if (createdInstance) {
        setLinkedAccessoryState(null);
      }
      const message = err instanceof ApiError ? err.message : err instanceof Error ? err.message : "No se pudo crear el accesorio vinculado.";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  function openLinkedAccessoryCreator(item: ProjectInstance, itemCategory: ProjectCategorySection) {
    const categories = getLinkedAccessoryCategories(data as ProjectDetailData, itemCategory);
    if (!categories.length) {
      setError("No hay categorías de accesorios vinculables para este ítem.");
      return;
    }
    const categoryIds = categories.map((category) => category.id);
    setLinkedAccessoryState({
      targetInstanceId: item.id,
      targetInstanceName: item.name,
      categoryIds,
      selectedCategoryId: categoryIds.length === 1 ? categoryIds[0] : null,
    });
  }

  async function handleUpdateInstance(payload: InstanceFormPayload) {
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
        media_asset_id: payload.media_asset_id ?? null,
        clear_media: payload.clear_media ?? false,
      };
      const result = await api.updateProjectInstance(projectId, activeInstance.id, request);
      if (result.instance) {
        setData((current) => (current ? upsertCategoryInstance(current, modalState.categoryId, result.instance as ProjectInstance) : current));
      }
      setModalState(null);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "No se pudo actualizar la instancia de proyecto.";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeleteInstance(categoryId: number, instanceId: number) {
    const confirmed = window.confirm("¿Eliminar esta instancia de proyecto y sus registros asociados al proyecto?");
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
      const message = err instanceof ApiError ? err.message : "No se pudo eliminar la instancia de proyecto.";
      setError(message);
    }
  }

  async function handleUpdateMaterialOccurrence(
    instanceId: number,
    materialKey: string,
    payload: { mode: string; entries: Array<{ subtype_id: number | null; quantity: number | null; assembly_quantity: number | null }> },
  ) {
    setError(null);
    try {
      await api.updateMaterialOccurrence(projectId, instanceId, materialKey, payload);
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
              if (material.material_key !== materialKey) {
                return material;
              }
              return {
                ...material,
                source_status: material.source_status === "missing" ? "catalog" : material.source_status,
                source_label: material.source_status === "missing" ? null : material.source_label,
                mode: payload.mode,
                bom_entries: buildLocalBomEntries(payload.mode, payload.entries, material, subtypeOptions),
              };
            }),
          }));
        });
      });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "No se pudieron actualizar las filas de materiales.";
      setError(message);
      throw err;
    }
  }

  async function handleAddManualMaterial(instanceId: number, materialId: number) {
    setError(null);
    try {
      await api.addManualMaterial(projectId, instanceId, materialId);
      await loadProject(false);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "No se pudo agregar el material.";
      setError(message);
      throw err;
    }
  }

  async function handleDeleteMaterialOccurrence(instanceId: number, materialKey: string) {
    const confirmed = window.confirm("¿Quitar este material de la instancia?");
    if (!confirmed) {
      return;
    }
    setError(null);
    try {
      await api.deleteMaterialOccurrence(projectId, instanceId, materialKey);
      await loadProject(false);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "No se pudo quitar el material.";
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
      const message = err instanceof ApiError ? err.message : "No se pudo crear el uso.";
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
      const message = err instanceof ApiError ? err.message : "No se pudo actualizar el uso.";
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
      const message = err instanceof ApiError ? err.message : "No se pudo eliminar el uso.";
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
      const message = err instanceof ApiError ? err.message : "No se pudieron actualizar los campos rastreados.";
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
      const message = err instanceof ApiError ? err.message : "No se pudo aplicar el valor del catálogo.";
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
      const message = err instanceof ApiError ? err.message : "No se pudo aplicar el valor de la instancia al catálogo.";
      setError(message);
    } finally {
      setSyncingInstanceId(null);
    }
  }

  async function handleReconcileAttributes(instanceId: number, payload: SyncAttributeReconcileRequest) {
    setSyncingInstanceId(instanceId);
    setError(null);
    try {
      const preview = await api.reconcileProjectInstanceAttributes(projectId, instanceId, payload);
      await refreshProjectAndSyncPreview(instanceId, preview);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "No se pudo conciliar el esquema de atributos.";
      setError(message);
    } finally {
      setSyncingInstanceId(null);
    }
  }

  if (loading) {
    return <div className="liquid-glass rounded-2xl p-8 text-sm text-zinc-600 dark:text-zinc-400">Cargando proyecto...</div>;
  }

  if (!data) {
    return <div className="liquid-glass rounded-2xl p-8 text-sm text-zinc-600 dark:text-zinc-400">Proyecto no encontrado.</div>;
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
  const incomingOccurrenceSourceIds = new Map<number, number>();
  for (const category of data.categories) {
    for (const sourceInstance of category.instances) {
      for (const occurrence of sourceInstance.outgoing_occurrences) {
        incomingOccurrenceSourceIds.set(occurrence.id, sourceInstance.id);
      }
    }
  }
  function selectInstance(instanceId: number) {
    pendingInstanceScrollRef.current = instanceId;
    setFocusedInstanceId(instanceId);
    setInstanceScrollRequest((current) => current + 1);
    setCategorySearch("");
    window.history.replaceState({}, "", `#instance-${instanceId}`);
  }
  function toggleAllItems() {
    setAllItemsExpanded((current) => current !== true);
  }


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
                <i className="ph-bold ph-list-magnifying-glass" /> Categorías
              </h2>
            </div>
            <SearchField value={categorySearch} onChange={setCategorySearch} />
            <div className="flex-1 overflow-y-auto pr-2 space-y-1">
              {categoryTree.some((node) => projectTreeMatches(node, categorySearch)) ? (
                <ProjectCategoryTree nodes={categoryTree} filterTerm={categorySearch} onSelectInstance={selectInstance} />
              ) : (
                <p className="px-2 py-3 text-xs text-zinc-500">No hay categorías, ítems ni accesorios que coincidan.</p>
              )}
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
                {!readOnly && category.available_components.length ? (
                  <button
                    type="button"
                    className="px-3 py-1.5 bg-white dark:bg-white/10 shadow-sm hover:bg-zinc-50 dark:hover:bg-white/20 text-zinc-900 dark:text-white rounded border border-black/10 dark:border-white/10 text-xs font-semibold transition-colors flex items-center gap-2"
                    onClick={() => setModalState({ kind: "create", categoryId: category.id })}
                  >
                    <i className="ph-bold ph-plus" />
                  </button>
                ) : !readOnly ? (
                  <p className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest">No existen componentes reutilizables</p>
                ) : null}
              </div>
              <div className="w-full border border-black/10 dark:border-white/10 rounded-xl overflow-hidden bg-white dark:bg-zinc-900/50 backdrop-blur-sm">
                {category.instances.length ? (
                  category.instances.map((instance) => {
                    const linkedAccessoryCategories = getLinkedAccessoryCategories(data, category);
                    return (
                      <InstanceCard
                        key={instance.id}
                        instance={instance}
                        focused={focusedInstanceId === instance.id}
                        expandAll={allItemsExpanded}
                        incomingOccurrenceSourceIds={incomingOccurrenceSourceIds}
                        onSelectInstance={selectInstance}
                        readOnly={readOnly}
                        subtypeOptions={flatSubtypeOptions}
                        targetOptions={targetOptions.filter(
                          (target) =>
                            target.instance_id !== instance.id &&
                            (category.linked_category_ids.length === 0 || category.linked_category_ids.includes(target.category_id)),
                        )}
                        linkedAccessoryCategories={linkedAccessoryCategories}
                        syncPreview={syncPreviews[instance.id] || null}
                        syncPreviewLoading={Boolean(syncPreviewLoading[instance.id])}
                        onEnsureSyncPreview={async () => {
                          await ensureSyncPreview(instance.id);
                        }}
                        onOpenSyncModal={(field) => void openSyncModal(instance.id, field)}
                        onEdit={() => setModalState({ kind: "edit", categoryId: category.id, instanceId: instance.id })}
                        onDelete={() => void handleDeleteInstance(category.id, instance.id)}
                        onOpenComments={() =>
                          void openCommentsForInstance({
                            instanceId: instance.id,
                            instanceName: instance.name,
                            source: "badge",
                          })
                        }
                        onCreateLinkedAccessory={() => openLinkedAccessoryCreator(instance, category)}
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
                        onUpdateMaterial={(materialKey, payload) => handleUpdateMaterialOccurrence(instance.id, materialKey, payload)}
                        onAddManualMaterial={(materialId) => handleAddManualMaterial(instance.id, materialId)}
                        onDeleteMaterial={(materialKey) => handleDeleteMaterialOccurrence(instance.id, materialKey)}
                      />
                    );
                  })
                ) : (
                  <div className="text-center p-6 border border-black/5 dark:border-white/5 bg-zinc-50 dark:bg-white/5 rounded-xl text-xs font-mono text-zinc-500">
                    No instances in this category.
                  </div>
                )}
              </div>
            </div>
          ))}

          {!readOnly ? <div className="mt-8 pt-8 border-t border-black/10 dark:border-white/10">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-bold text-zinc-900 dark:text-white flex items-center gap-2">
                <i className="ph-bold ph-tags text-zinc-600 dark:text-zinc-400" /> Elementos Auxiliares
              </h3>
            </div>
            <div className="w-full border border-black/10 dark:border-white/10 rounded-xl overflow-hidden bg-white dark:bg-black/40">
              <table className="w-full text-left border-collapse text-sm">
                <thead className="bg-white dark:bg-black/60 border-b border-black/10 dark:border-white/10">
                  <tr>
                    <th className="px-3 py-2 text-zinc-500 font-medium">Código</th>
                    <th className="px-3 py-2 text-zinc-500 font-medium">Nombre</th>
                    <th className="px-3 py-2 text-zinc-500 font-medium">Categoría</th>
                    <th className="px-3 py-2 text-zinc-500 font-medium">Subtipo</th>
                    <th className="px-3 py-2 text-zinc-500 font-medium text-right">Precio Base</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {data.auxiliary_materials.length ? (
                    data.auxiliary_materials.map((row) => (
                      <tr key={`${row.code}-${row.subtype}`} className="group hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors">
                        <td className="px-3 py-3 text-zinc-500 font-mono text-xs">{row.code}</td>
                        <td className="px-3 py-3 text-zinc-900 dark:text-zinc-200 font-medium text-sm">{row.name}</td>
                        <td className="px-3 py-3 text-zinc-600 dark:text-zinc-400 text-sm">{row.category || "Sin categoría"}</td>
                        <td className="px-3 py-3 text-zinc-600 dark:text-zinc-400 text-sm">{row.subtype}</td>
                        <td className="px-3 py-3 text-right font-mono text-sm text-accent-700 dark:text-accent-400">{row.price.toLocaleString()}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={5} className="py-4 text-center text-zinc-500 font-mono text-xs">
                        No hay materiales auxiliares seleccionados.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div> : null}
        </div>
      </div>

      {data.categories.some((category) => category.instances.length > 0) ? (
        <div className="pointer-events-none fixed bottom-5 right-5 z-30 sm:bottom-6 sm:right-6">
          <button
            type="button"
            onClick={toggleAllItems}
            className="pointer-events-auto inline-flex items-center gap-2 rounded-full border border-black/10 bg-white/90 px-4 py-2.5 text-xs font-semibold text-zinc-700 shadow-lg shadow-black/10 backdrop-blur-md transition-colors hover:border-accent-500/40 hover:bg-white hover:text-zinc-950 dark:border-white/10 dark:bg-zinc-900/90 dark:text-zinc-200 dark:shadow-black/30 dark:hover:bg-zinc-800 dark:hover:text-white"
            aria-label={allItemsExpanded ? "Colapsar todos los ítems" : "Expandir todos los ítems"}
            aria-pressed={allItemsExpanded === true}
            title={allItemsExpanded ? "Colapsar todos los ítems" : "Expandir todos los ítems"}
          >
            <i className={`ph-bold ${allItemsExpanded ? "ph-arrows-in" : "ph-arrows-out"} text-sm`} aria-hidden="true" />
            <span>{allItemsExpanded ? "Colapsar todo" : "Expandir todo"}</span>
          </button>
        </div>
      ) : null}
      {!readOnly ? <CommentsOverlay
        open={commentOverlay !== null}
        instanceName={commentOverlay?.instanceName || ""}
        comments={comments}
        loading={commentsLoading}
        mentionableUsers={mentionableUsers}
        highlightCommentId={commentOverlay?.highlightCommentId}
        onClose={() => setCommentOverlay(null)}
        onCreate={(body) => createComment(body)}
        onReply={(parentCommentId, body) => createComment(body, parentCommentId)}
        onDelete={deleteComment}
      /> : null}

      {!readOnly && activeCategory ? (
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

      {!readOnly && linkedAccessoryState && !linkedAccessoryState.selectedCategoryId ? (
        <LinkedAccessoryCategoryModal
          open
          itemName={linkedAccessoryState.targetInstanceName}
          categories={linkedAccessoryCategoryOptions}
          onClose={() => setLinkedAccessoryState(null)}
          onSelect={(categoryId) => setLinkedAccessoryState((current) => current ? { ...current, selectedCategoryId: categoryId } : current)}
        />
      ) : null}

      {!readOnly && linkedAccessoryState && activeLinkedAccessoryCategory ? (
        <InstanceFormModal
          open
          mode="create"
          categoryName={`Accesorio vinculado · ${activeLinkedAccessoryCategory.name}`}
          availableComponents={activeLinkedAccessoryCategory.available_components.filter((component) => component.type === "accessory")}
          submitting={submitting}
          onClose={() => setLinkedAccessoryState(null)}
          onSubmit={handleCreateLinkedAccessory}
        />
      ) : null}

      {!readOnly && calculationSheetState ? (
        <MaterialCalculationSheetModal
          open={calculationSheetState !== null}
          projectId={projectId}
          instanceId={calculationSheetState.instanceId}
          instanceName={calculationSheetState.instanceName}
          material={calculationSheetState.material}
          subtypes={flatSubtypeOptions}
          onClose={() => setCalculationSheetState(null)}
        />
      ) : null}

      {!readOnly ? <InstanceSyncModal
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
        onAddAttributes={async (values) => {
          if (!syncModalState) {
            return;
          }
          await handleReconcileAttributes(syncModalState.instanceId, {
            add_attribute_names: values.map((value) => value.name),
            attribute_values: values,
          });
        }}
        onRemoveAttributes={async (names) => {
          if (!syncModalState) {
            return;
          }
          await handleReconcileAttributes(syncModalState.instanceId, { remove_attribute_names: names });
        }}
      /> : null}
    </div>
  );
}
