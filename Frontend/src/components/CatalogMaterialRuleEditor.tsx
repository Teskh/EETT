import { useEffect, useMemo, useState } from "react";

import { Modal } from "./Modal";
import type {
  CatalogAttribute,
  CatalogComponent,
  CatalogMaterialRule,
  CatalogMaterialSearchResponse,
  CatalogMaterialSearchResult,
} from "../lib/types";

type CatalogMaterialRuleEditorProps = {
  component: CatalogComponent;
  open: boolean;
  saving: boolean;
  onClose: () => void;
  onSave: (rules: CatalogMaterialRule[]) => Promise<void>;
  onSearch: (query: string) => Promise<CatalogMaterialSearchResponse>;
};

type EditableClause = {
  local_id: string;
  attribute_name: string;
  operator: string;
  comparison_value: string;
  comparison_value_secondary: string;
};

type EditableGroup = {
  local_id: string;
  group: string;
  clauses: EditableClause[];
};

type EditableRule = {
  local_id: string;
  id?: number;
  material_id: number | null;
  material_name: string;
  sku: string;
  unit: string;
  unit_qty_per_unit: string;
  notes: string;
  conditions: EditableGroup[];
};

type SearchState = {
  ruleLocalId: string;
  field: "material_name" | "sku";
};

const OPERATORS = [
  { value: "=", label: "Equals" },
  { value: "IN", label: "In list" },
  { value: "BETWEEN", label: "Between" },
  { value: ">", label: "Greater than" },
  { value: "<", label: "Less than" },
  { value: "IS NOT NULL", label: "Is not empty" },
];

function makeLocalId() {
  return Math.random().toString(36).slice(2, 10);
}

function normalizeRules(rules: CatalogMaterialRule[]): EditableRule[] {
  return rules.map((rule, ruleIndex) => ({
    local_id: makeLocalId(),
    id: rule.id,
    material_id: rule.material_id ?? null,
    material_name: rule.material_name || "",
    sku: rule.sku || "",
    unit: rule.unit || "",
    unit_qty_per_unit: rule.unit_qty_per_unit === null || rule.unit_qty_per_unit === undefined ? "" : String(rule.unit_qty_per_unit),
    notes: rule.notes || "",
    conditions: rule.conditions.map((group, groupIndex) => ({
      local_id: makeLocalId(),
      group: group.group || `group-${groupIndex + 1}`,
      clauses: group.clauses.map((clause) => ({
        local_id: makeLocalId(),
        attribute_name: clause.attribute_name || "",
        operator: clause.operator || "=",
        comparison_value: clause.comparison_value || "",
        comparison_value_secondary: clause.comparison_value_secondary || "",
      })),
    })),
  }));
}

function makeEmptyRule(index: number): EditableRule {
  return {
    local_id: makeLocalId(),
    material_id: null,
    material_name: "",
    sku: "",
    unit: "",
    unit_qty_per_unit: "",
    notes: "",
    conditions: [
      {
        local_id: makeLocalId(),
        group: `group-${index}`,
        clauses: [makeEmptyClause()],
      },
    ],
  };
}

function makeEmptyClause(): EditableClause {
  return {
    local_id: makeLocalId(),
    attribute_name: "",
    operator: "=",
    comparison_value: "",
    comparison_value_secondary: "",
  };
}

function operatorLabel(operator: string) {
  switch (operator) {
    case "=":
      return "equals";
    case "IN":
      return "is in";
    case "BETWEEN":
      return "is between";
    case ">":
      return "is greater than";
    case "<":
      return "is less than";
    case "IS NOT NULL":
      return "is not empty";
    default:
      return operator.toLowerCase();
  }
}

function summarizeRule(rule: EditableRule) {
  if (!rule.conditions.length || rule.conditions.every((group) => group.clauses.length === 0)) {
    return `Include ${rule.sku || "this material"} on every instance.`;
  }

  const groups = rule.conditions
    .map((group) => {
      const clauses = group.clauses
        .filter((clause) => clause.attribute_name)
        .map((clause) => {
          if (clause.operator === "IS NOT NULL") {
            return `${clause.attribute_name} ${operatorLabel(clause.operator)}`;
          }
          if (clause.operator === "BETWEEN") {
            return `${clause.attribute_name} ${operatorLabel(clause.operator)} ${clause.comparison_value || "?"} and ${clause.comparison_value_secondary || "?"}`;
          }
          return `${clause.attribute_name} ${operatorLabel(clause.operator)} ${clause.comparison_value || "?"}`;
        });
      return clauses.length ? clauses.join(" and ") : null;
    })
    .filter(Boolean);

  if (!groups.length) {
    return `Include ${rule.sku || "this material"} on every instance.`;
  }

  return `Include ${rule.sku || "this material"} when ${groups.join(" or when ")}.`;
}

function getAttributeMeta(attributeName: string, attributes: CatalogAttribute[]) {
  return attributes.find((attribute) => attribute.name === attributeName) || null;
}

function buildAttributeChoices(component: CatalogComponent, rules: EditableRule[]) {
  const byName = new Map(
    [...component.base_attributes, ...component.usage_attributes].map((attribute) => [attribute.name, attribute]),
  );
  for (const rule of rules) {
    for (const group of rule.conditions) {
      for (const clause of group.clauses) {
        if (clause.attribute_name && !byName.has(clause.attribute_name)) {
          byName.set(clause.attribute_name, {
            name: clause.attribute_name,
            value_type: "text",
            options: [],
          });
        }
      }
    }
  }
  return Array.from(byName.values());
}

export function CatalogMaterialRuleEditor({
  component,
  open,
  saving,
  onClose,
  onSave,
  onSearch,
}: CatalogMaterialRuleEditorProps) {
  const [rules, setRules] = useState<EditableRule[]>(() => normalizeRules(component.material_rules));
  const [error, setError] = useState<string | null>(null);
  const [searchState, setSearchState] = useState<SearchState | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchResults, setSearchResults] = useState<CatalogMaterialSearchResult[]>([]);
  const [liveErpAvailable, setLiveErpAvailable] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }
    setRules(normalizeRules(component.material_rules));
    setError(null);
    setSearchState(null);
    setSearchTerm("");
    setSearchResults([]);
  }, [component, open]);

  useEffect(() => {
    if (!searchState || searchTerm.trim().length < 2) {
      setSearchLoading(false);
      setSearchResults([]);
      return;
    }

    let cancelled = false;
    const timeoutId = window.setTimeout(async () => {
      setSearchLoading(true);
      try {
        const response = await onSearch(searchTerm.trim());
        if (cancelled) {
          return;
        }
        setSearchResults(response.results);
        setLiveErpAvailable(response.live_erp_available);
      } catch (err) {
        if (cancelled) {
          return;
        }
        setSearchResults([]);
        setError(err instanceof Error ? err.message : "Could not search materials.");
      } finally {
        if (!cancelled) {
          setSearchLoading(false);
        }
      }
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [onSearch, searchState, searchTerm]);

  const attributeChoices = useMemo(() => buildAttributeChoices(component, rules), [component, rules]);

  function updateRule(ruleLocalId: string, next: Partial<EditableRule>) {
    setRules((current) =>
      current.map((rule) => (rule.local_id === ruleLocalId ? { ...rule, ...next } : rule)),
    );
  }

  function moveRule(ruleLocalId: string, direction: -1 | 1) {
    setRules((current) => {
      const index = current.findIndex((rule) => rule.local_id === ruleLocalId);
      if (index < 0) {
        return current;
      }
      const targetIndex = index + direction;
      if (targetIndex < 0 || targetIndex >= current.length) {
        return current;
      }
      const copy = [...current];
      const [rule] = copy.splice(index, 1);
      copy.splice(targetIndex, 0, rule);
      return copy;
    });
  }

  function removeRule(ruleLocalId: string) {
    setRules((current) => current.filter((rule) => rule.local_id !== ruleLocalId));
    if (searchState?.ruleLocalId === ruleLocalId) {
      setSearchState(null);
      setSearchTerm("");
      setSearchResults([]);
    }
  }

  function addRule() {
    setRules((current) => [...current, makeEmptyRule(current.length + 1)]);
  }

  function updateGroup(ruleLocalId: string, groupLocalId: string, next: Partial<EditableGroup>) {
    setRules((current) =>
      current.map((rule) => {
        if (rule.local_id !== ruleLocalId) {
          return rule;
        }
        return {
          ...rule,
          conditions: rule.conditions.map((group) =>
            group.local_id === groupLocalId ? { ...group, ...next } : group,
          ),
        };
      }),
    );
  }

  function addGroup(ruleLocalId: string) {
    setRules((current) =>
      current.map((rule) =>
        rule.local_id === ruleLocalId
          ? {
              ...rule,
              conditions: [
                ...rule.conditions,
                {
                  local_id: makeLocalId(),
                  group: `group-${rule.conditions.length + 1}`,
                  clauses: [makeEmptyClause()],
                },
              ],
            }
          : rule,
      ),
    );
  }

  function removeGroup(ruleLocalId: string, groupLocalId: string) {
    setRules((current) =>
      current.map((rule) =>
        rule.local_id === ruleLocalId
          ? {
              ...rule,
              conditions: rule.conditions.filter((group) => group.local_id !== groupLocalId),
            }
          : rule,
      ),
    );
  }

  function updateClause(ruleLocalId: string, groupLocalId: string, clauseLocalId: string, next: Partial<EditableClause>) {
    setRules((current) =>
      current.map((rule) => {
        if (rule.local_id !== ruleLocalId) {
          return rule;
        }
        return {
          ...rule,
          conditions: rule.conditions.map((group) => {
            if (group.local_id !== groupLocalId) {
              return group;
            }
            return {
              ...group,
              clauses: group.clauses.map((clause) =>
                clause.local_id === clauseLocalId ? { ...clause, ...next } : clause,
              ),
            };
          }),
        };
      }),
    );
  }

  function addClause(ruleLocalId: string, groupLocalId: string) {
    setRules((current) =>
      current.map((rule) => {
        if (rule.local_id !== ruleLocalId) {
          return rule;
        }
        return {
          ...rule,
          conditions: rule.conditions.map((group) =>
            group.local_id === groupLocalId
              ? { ...group, clauses: [...group.clauses, makeEmptyClause()] }
              : group,
          ),
        };
      }),
    );
  }

  function removeClause(ruleLocalId: string, groupLocalId: string, clauseLocalId: string) {
    setRules((current) =>
      current.map((rule) => {
        if (rule.local_id !== ruleLocalId) {
          return rule;
        }
        return {
          ...rule,
          conditions: rule.conditions.map((group) =>
            group.local_id === groupLocalId
              ? { ...group, clauses: group.clauses.filter((clause) => clause.local_id !== clauseLocalId) }
              : group,
          ),
        };
      }),
    );
  }

  function handleSearchInput(ruleLocalId: string, field: "material_name" | "sku", value: string) {
    if (field === "material_name") {
      updateRule(ruleLocalId, { material_name: value, material_id: null });
    } else {
      updateRule(ruleLocalId, { sku: value.toUpperCase(), material_id: null });
    }
    setSearchState({ ruleLocalId, field });
    setSearchTerm(value);
    setError(null);
  }

  function applySearchResult(ruleLocalId: string, result: CatalogMaterialSearchResult) {
    updateRule(ruleLocalId, {
      material_id: result.material_id,
      material_name: result.name,
      sku: result.sku,
      unit: result.unit || "",
    });
    setSearchState(null);
    setSearchTerm("");
    setSearchResults([]);
  }

  async function handleSave() {
    setError(null);
    try {
      await onSave(
        rules
          .map((rule) => ({
            id: rule.id,
            material_id: rule.material_id,
            material_name: rule.material_name.trim(),
            sku: rule.sku.trim().toUpperCase(),
            unit: rule.unit.trim() || null,
            unit_qty_per_unit: rule.unit_qty_per_unit.trim() === "" ? null : Number(rule.unit_qty_per_unit),
            notes: rule.notes.trim() || null,
            conditions: rule.conditions
              .map((group, groupIndex) => ({
                group: group.group.trim() || `group-${groupIndex + 1}`,
                clauses: group.clauses
                  .map((clause) => ({
                    attribute_name: clause.attribute_name.trim(),
                    operator: clause.operator,
                    comparison_value: clause.comparison_value.trim() || null,
                    comparison_value_secondary: clause.comparison_value_secondary.trim() || null,
                  }))
                  .filter((clause) => {
                    if (!clause.attribute_name || !clause.operator) {
                      return false;
                    }
                    if (clause.operator === "IS NOT NULL") {
                      return true;
                    }
                    if (clause.operator === "BETWEEN") {
                      return Boolean(clause.comparison_value && clause.comparison_value_secondary);
                    }
                    return Boolean(clause.comparison_value);
                  }),
              }))
              .filter((group) => group.clauses.length > 0),
          }))
          .filter((rule) => rule.material_name && rule.sku),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save material rules.");
    }
  }

  function renderSearchDropdown(ruleLocalId: string) {
    return (
      <div className="absolute z-20 mt-2 w-full rounded-xl border border-black/10 bg-white p-2 shadow-xl dark:border-white/10 dark:bg-zinc-900">
        {searchLoading ? (
          <div className="px-2 py-3 text-xs font-mono text-zinc-500">Searching materials...</div>
        ) : searchResults.length ? (
          <div className="flex max-h-56 flex-col overflow-y-auto">
            {searchResults.map((result) => (
              <button
                key={`${result.source}-${result.sku}`}
                type="button"
                onMouseDown={(event) => {
                  event.preventDefault();
                  applySearchResult(ruleLocalId, result);
                }}
                className="flex items-start justify-between rounded-lg px-2 py-2 text-left transition-colors hover:bg-zinc-50 dark:hover:bg-white/5"
              >
                <div>
                  <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{result.name}</div>
                  <div className="text-[11px] font-mono text-zinc-500">
                    {result.sku} {result.unit ? `(${result.unit})` : ""}
                  </div>
                </div>
                <span className="rounded border border-black/10 bg-zinc-50 px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wide text-zinc-500 dark:border-white/10 dark:bg-white/5">
                  {result.source}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div className="px-2 py-3 text-xs font-mono text-zinc-500">
            No matches for "{searchTerm}".
          </div>
        )}
      </div>
    );
  }

  return (
    <Modal
      open={open}
      title={component.name}
      kicker="Material rules"
      onClose={onClose}
      panelClassName="max-w-6xl"
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-4 rounded-xl border border-black/10 dark:border-white/10 bg-zinc-50 dark:bg-white/5 p-4">
          <div className="space-y-1">
            <p className="text-sm text-zinc-700 dark:text-zinc-300">
              Match materials to this catalog component with grouped rules. Clauses inside a group are ANDed together; groups are ORed together.
            </p>
            <p className="text-[11px] font-mono text-zinc-500">
              Search uses saved catalog materials first and can also surface ERP matches when the connection is configured.
            </p>
          </div>
          <button
            type="button"
            onClick={addRule}
            className="shrink-0 rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-black/30 px-3 py-2 text-xs font-semibold text-zinc-900 dark:text-zinc-200 transition-colors hover:bg-zinc-50 dark:hover:bg-white/5"
          >
            <i className="ph-bold ph-plus mr-1" />
            Add material
          </button>
        </div>

        {error ? (
          <div className="rounded-xl border border-red-200 bg-red-100 px-4 py-3 text-sm text-red-800 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-200">
            {error}
          </div>
        ) : null}

        <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto pr-1">
          {rules.length ? (
            rules.map((rule, ruleIndex) => {
              const searchOpen = searchState?.ruleLocalId === rule.local_id;
              return (
                <article
                  key={rule.local_id}
                  className="rounded-2xl border border-black/10 dark:border-white/10 bg-white dark:bg-black/20 p-4 shadow-sm"
                >
                  <div className="mb-4 flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                        Material {ruleIndex + 1}
                      </p>
                      <h4 className="text-base font-bold text-zinc-900 dark:text-white">
                        {rule.material_name || "New material rule"}
                      </h4>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => moveRule(rule.local_id, -1)}
                        className="rounded-lg border border-black/10 dark:border-white/10 bg-zinc-50 px-2 py-1 text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:bg-white/5 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-zinc-200"
                        title="Move up"
                      >
                        <i className="ph-bold ph-caret-up" />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveRule(rule.local_id, 1)}
                        className="rounded-lg border border-black/10 dark:border-white/10 bg-zinc-50 px-2 py-1 text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:bg-white/5 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-zinc-200"
                        title="Move down"
                      >
                        <i className="ph-bold ph-caret-down" />
                      </button>
                      <button
                        type="button"
                        onClick={() => removeRule(rule.local_id)}
                        className="rounded-lg border border-red-200 bg-red-100 px-2.5 py-1 text-xs font-semibold text-red-700 transition-colors hover:bg-red-200 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300 dark:hover:bg-red-500/20"
                      >
                        Remove
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
                    <div className="relative md:col-span-4">
                      <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                        Material Name
                      </label>
                      <input
                        value={rule.material_name}
                        onChange={(event) => handleSearchInput(rule.local_id, "material_name", event.target.value)}
                        onFocus={(event) => handleSearchInput(rule.local_id, "material_name", event.target.value)}
                        placeholder="Search ERP or existing materials"
                        className="w-full rounded-lg border border-black/10 bg-zinc-50 p-2 text-sm text-zinc-900 focus:border-accent-500/50 focus:outline-none dark:border-white/10 dark:bg-black/30 dark:text-zinc-100"
                      />
                      {searchOpen && searchState?.field === "material_name" ? renderSearchDropdown(rule.local_id) : null}
                    </div>

                    <div className="relative md:col-span-3">
                      <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                        SKU
                      </label>
                      <input
                        value={rule.sku}
                        onChange={(event) => handleSearchInput(rule.local_id, "sku", event.target.value)}
                        onFocus={(event) => handleSearchInput(rule.local_id, "sku", event.target.value)}
                        placeholder="ERP code"
                        className="w-full rounded-lg border border-black/10 bg-zinc-50 p-2 text-sm font-mono text-zinc-900 focus:border-accent-500/50 focus:outline-none dark:border-white/10 dark:bg-black/30 dark:text-zinc-100"
                      />
                      {searchOpen && searchState?.field === "sku" ? renderSearchDropdown(rule.local_id) : null}
                    </div>

                    <div className="md:col-span-2">
                      <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                        Unit
                      </label>
                      <input
                        value={rule.unit}
                        onChange={(event) => updateRule(rule.local_id, { unit: event.target.value })}
                        placeholder="EA, M2, KG"
                        className="w-full rounded-lg border border-black/10 bg-zinc-50 p-2 text-sm font-mono text-zinc-900 focus:border-accent-500/50 focus:outline-none dark:border-white/10 dark:bg-black/30 dark:text-zinc-100"
                      />
                    </div>

                    <div className="md:col-span-3">
                      <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                        Qty Per Unit
                      </label>
                      <input
                        value={rule.unit_qty_per_unit}
                        onChange={(event) => updateRule(rule.local_id, { unit_qty_per_unit: event.target.value })}
                        placeholder="Optional"
                        className="w-full rounded-lg border border-black/10 bg-zinc-50 p-2 text-sm font-mono text-zinc-900 focus:border-accent-500/50 focus:outline-none dark:border-white/10 dark:bg-black/30 dark:text-zinc-100"
                      />
                    </div>
                  </div>

                  <div className="mt-3">
                    <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                      Notes
                    </label>
                    <textarea
                      value={rule.notes}
                      onChange={(event) => updateRule(rule.local_id, { notes: event.target.value })}
                      rows={2}
                      placeholder="Optional procurement or installation note"
                      className="w-full rounded-lg border border-black/10 bg-zinc-50 p-2 text-sm text-zinc-900 focus:border-accent-500/50 focus:outline-none dark:border-white/10 dark:bg-black/30 dark:text-zinc-100"
                    />
                  </div>

                  <div className="mt-3 rounded-xl border border-dashed border-black/10 bg-zinc-50 px-3 py-2 text-xs text-zinc-600 dark:border-white/10 dark:bg-white/5 dark:text-zinc-300">
                    {summarizeRule(rule)}
                  </div>

                  <div className="mt-4 flex flex-col gap-3">
                    {rule.conditions.map((group, groupIndex) => (
                      <section
                        key={group.local_id}
                        className="rounded-xl border border-black/10 bg-zinc-50 p-3 dark:border-white/10 dark:bg-white/5"
                      >
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <div>
                            <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                              OR group {groupIndex + 1}
                            </p>
                            <input
                              value={group.group}
                              onChange={(event) => updateGroup(rule.local_id, group.local_id, { group: event.target.value })}
                              className="mt-1 w-40 rounded-md border border-black/10 bg-white px-2 py-1 text-xs font-mono text-zinc-700 focus:border-accent-500/50 focus:outline-none dark:border-white/10 dark:bg-black/20 dark:text-zinc-200"
                            />
                          </div>
                          <button
                            type="button"
                            onClick={() => removeGroup(rule.local_id, group.local_id)}
                            className="rounded-lg border border-red-200 bg-red-100 px-2.5 py-1 text-xs font-semibold text-red-700 transition-colors hover:bg-red-200 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300 dark:hover:bg-red-500/20"
                          >
                            Remove group
                          </button>
                        </div>

                        <div className="flex flex-col gap-2">
                          {group.clauses.map((clause, clauseIndex) => {
                            const attributeMeta = getAttributeMeta(clause.attribute_name, attributeChoices);
                            const operatorIsBetween = clause.operator === "BETWEEN";
                            const operatorNeedsNoValue = clause.operator === "IS NOT NULL";
                            const useSelectValue =
                              clause.operator === "=" &&
                              attributeMeta?.value_type === "select" &&
                              Boolean(attributeMeta.options.length);

                            return (
                              <div
                                key={clause.local_id}
                                className="rounded-lg border border-black/10 bg-white p-3 dark:border-white/10 dark:bg-black/20"
                              >
                                <div className="mb-2 flex items-center justify-between gap-3">
                                  <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                                    {clauseIndex === 0 ? "If" : "And"}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => removeClause(rule.local_id, group.local_id, clause.local_id)}
                                    className="rounded border border-black/10 px-2 py-0.5 text-[10px] font-semibold text-zinc-500 transition-colors hover:bg-zinc-50 hover:text-zinc-900 dark:border-white/10 dark:text-zinc-400 dark:hover:bg-white/5 dark:hover:text-zinc-200"
                                  >
                                    Remove
                                  </button>
                                </div>

                                <div className="grid grid-cols-1 gap-2 md:grid-cols-12">
                                  <select
                                    value={clause.attribute_name}
                                    onChange={(event) =>
                                      updateClause(rule.local_id, group.local_id, clause.local_id, {
                                        attribute_name: event.target.value,
                                        comparison_value: "",
                                        comparison_value_secondary: "",
                                      })
                                    }
                                    className="rounded-lg border border-black/10 bg-zinc-50 p-2 text-sm text-zinc-900 focus:border-accent-500/50 focus:outline-none md:col-span-4 dark:border-white/10 dark:bg-black/30 dark:text-zinc-100"
                                  >
                                    <option value="">Attribute</option>
                                    {attributeChoices.map((attribute) => (
                                      <option key={attribute.name} value={attribute.name}>
                                        {attribute.name}
                                      </option>
                                    ))}
                                  </select>

                                  <select
                                    value={clause.operator}
                                    onChange={(event) =>
                                      updateClause(rule.local_id, group.local_id, clause.local_id, {
                                        operator: event.target.value,
                                        comparison_value: "",
                                        comparison_value_secondary: "",
                                      })
                                    }
                                    className="rounded-lg border border-black/10 bg-zinc-50 p-2 text-sm text-zinc-900 focus:border-accent-500/50 focus:outline-none md:col-span-3 dark:border-white/10 dark:bg-black/30 dark:text-zinc-100"
                                  >
                                    {OPERATORS.map((operator) => (
                                      <option key={operator.value} value={operator.value}>
                                        {operator.label}
                                      </option>
                                    ))}
                                  </select>

                                  {operatorNeedsNoValue ? (
                                    <div className="flex items-center rounded-lg border border-dashed border-black/10 bg-zinc-50 px-3 text-xs text-zinc-500 md:col-span-5 dark:border-white/10 dark:bg-black/10">
                                      No comparison value required.
                                    </div>
                                  ) : useSelectValue ? (
                                    <select
                                      value={clause.comparison_value}
                                      onChange={(event) =>
                                        updateClause(rule.local_id, group.local_id, clause.local_id, {
                                          comparison_value: event.target.value,
                                        })
                                      }
                                      className="rounded-lg border border-black/10 bg-zinc-50 p-2 text-sm text-zinc-900 focus:border-accent-500/50 focus:outline-none md:col-span-5 dark:border-white/10 dark:bg-black/30 dark:text-zinc-100"
                                    >
                                      <option value="">Value</option>
                                      {attributeMeta?.options.map((option) => (
                                        <option key={option} value={option}>
                                          {option}
                                        </option>
                                      ))}
                                    </select>
                                  ) : operatorIsBetween ? (
                                    <>
                                      <input
                                        value={clause.comparison_value}
                                        onChange={(event) =>
                                          updateClause(rule.local_id, group.local_id, clause.local_id, {
                                            comparison_value: event.target.value,
                                          })
                                        }
                                        placeholder="From"
                                        className="rounded-lg border border-black/10 bg-zinc-50 p-2 text-sm text-zinc-900 focus:border-accent-500/50 focus:outline-none md:col-span-2 dark:border-white/10 dark:bg-black/30 dark:text-zinc-100"
                                      />
                                      <input
                                        value={clause.comparison_value_secondary}
                                        onChange={(event) =>
                                          updateClause(rule.local_id, group.local_id, clause.local_id, {
                                            comparison_value_secondary: event.target.value,
                                          })
                                        }
                                        placeholder="To"
                                        className="rounded-lg border border-black/10 bg-zinc-50 p-2 text-sm text-zinc-900 focus:border-accent-500/50 focus:outline-none md:col-span-3 dark:border-white/10 dark:bg-black/30 dark:text-zinc-100"
                                      />
                                    </>
                                  ) : (
                                    <input
                                      value={clause.comparison_value}
                                      onChange={(event) =>
                                        updateClause(rule.local_id, group.local_id, clause.local_id, {
                                          comparison_value: event.target.value,
                                        })
                                      }
                                      placeholder={clause.operator === "IN" ? "Comma-separated values" : "Value"}
                                      className="rounded-lg border border-black/10 bg-zinc-50 p-2 text-sm text-zinc-900 focus:border-accent-500/50 focus:outline-none md:col-span-5 dark:border-white/10 dark:bg-black/30 dark:text-zinc-100"
                                    />
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        <div className="mt-3">
                          <button
                            type="button"
                            onClick={() => addClause(rule.local_id, group.local_id)}
                            className="rounded-lg border border-black/10 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-800 transition-colors hover:bg-zinc-50 dark:border-white/10 dark:bg-black/20 dark:text-zinc-200 dark:hover:bg-white/5"
                          >
                            <i className="ph-bold ph-plus mr-1" />
                            Add AND clause
                          </button>
                        </div>
                      </section>
                    ))}

                    <button
                      type="button"
                      onClick={() => addGroup(rule.local_id)}
                      className="self-start rounded-lg border border-black/10 bg-zinc-50 px-3 py-1.5 text-xs font-semibold text-zinc-900 transition-colors hover:bg-zinc-100 dark:border-white/10 dark:bg-white/5 dark:text-zinc-200 dark:hover:bg-white/10"
                    >
                      <i className="ph-bold ph-plus mr-1" />
                      Add OR group
                    </button>
                  </div>
                </article>
              );
            })
          ) : (
            <div className="rounded-2xl border border-dashed border-black/10 p-8 text-center text-sm text-zinc-500 dark:border-white/10">
              No material rules defined for this component.
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-black/10 pt-4 dark:border-white/10">
          <p className="text-[11px] font-mono text-zinc-500">
            {liveErpAvailable
              ? "ERP lookup is available for SKU autofill."
              : "ERP lookup is not configured, so search is limited to saved catalog materials."}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-black/10 bg-zinc-50 px-3 py-2 text-sm font-semibold text-zinc-800 transition-colors hover:bg-zinc-100 dark:border-white/10 dark:bg-white/5 dark:text-zinc-200 dark:hover:bg-white/10"
            >
              Close
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => void handleSave()}
              className="rounded-lg bg-accent-500 px-3 py-2 text-sm font-semibold text-zinc-950 transition-colors hover:bg-accent-400 disabled:opacity-60"
            >
              {saving ? "Saving..." : "Save material rules"}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
