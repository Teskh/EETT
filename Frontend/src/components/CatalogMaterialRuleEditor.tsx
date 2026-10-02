import { useEffect, useMemo, useState } from "react";

import { Modal } from "./Modal";
import { FactoryQuantityLabel } from "./QuantityLabels";
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
  conditions: EditableGroup[];
};

type SearchState = {
  ruleLocalId: string;
  field: "material_name" | "sku";
};

const OPERATORS = [
  { value: "=", label: "Igual a" },
  { value: "IN", label: "En lista" },
  { value: "BETWEEN", label: "Entre" },
  { value: ">", label: "Mayor que" },
  { value: "<", label: "Menor que" },
  { value: "IS NOT NULL", label: "No está vacío" },
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
      return "es igual a";
    case "IN":
      return "está en";
    case "BETWEEN":
      return "está entre";
    case ">":
      return "es mayor que";
    case "<":
      return "es menor que";
    case "IS NOT NULL":
      return "no está vacío";
    default:
      return operator.toLowerCase();
  }
}

function summarizeRule(rule: EditableRule) {
  if (!rule.conditions.length || rule.conditions.every((group) => group.clauses.length === 0)) {
    return `Incluir ${rule.sku || "este material"} en todas las instancias.`;
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
            return `${clause.attribute_name} ${operatorLabel(clause.operator)} ${clause.comparison_value || "?"} y ${clause.comparison_value_secondary || "?"}`;
          }
          return `${clause.attribute_name} ${operatorLabel(clause.operator)} ${clause.comparison_value || "?"}`;
        });
      return clauses.length ? clauses.join(" y ") : null;
    })
    .filter(Boolean);

  if (!groups.length) {
    return `Incluir ${rule.sku || "este material"} en todas las instancias.`;
  }

  return `Incluir ${rule.sku || "este material"} cuando ${groups.join(" o cuando ")}.`;
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
        setError(err instanceof Error ? err.message : "No se pudieron buscar materiales.");
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
      setError(err instanceof Error ? err.message : "No se pudieron guardar las reglas de materiales.");
    }
  }

  function renderSearchDropdown(ruleLocalId: string) {
    return (
      <div className="absolute left-0 z-20 mt-1 w-full min-w-[22rem] border border-black/15 bg-white p-1 shadow-lg dark:border-white/15 dark:bg-zinc-900">
        {searchLoading ? (
          <div className="px-2 py-2 text-xs text-zinc-500">Buscando materiales…</div>
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
                className="flex items-start justify-between gap-3 px-2 py-1.5 text-left hover:bg-zinc-100 dark:hover:bg-white/5"
              >
                <div>
                  <div className="text-xs font-medium text-zinc-900 dark:text-zinc-100">{result.name}</div>
                  <div className="font-mono text-[10px] text-zinc-500">
                    {result.sku} {result.unit ? `(${result.unit})` : ""}
                  </div>
                </div>
                <span className="shrink-0 border border-black/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-zinc-500 dark:border-white/10">
                  {result.source}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div className="px-2 py-2 text-xs text-zinc-500">
            No hay coincidencias para "{searchTerm}".
          </div>
        )}
      </div>
    );
  }

  const control = "h-8 w-full border border-black/15 bg-white px-2 text-xs text-zinc-900 outline-none focus:border-red-600 focus:ring-1 focus:ring-red-600 dark:border-white/15 dark:bg-zinc-900 dark:text-zinc-100";
  const iconButton = "flex h-7 w-7 shrink-0 items-center justify-center text-zinc-400 hover:bg-black/5 hover:text-zinc-950 disabled:invisible dark:hover:bg-white/10 dark:hover:text-white";
  const clauseColumns = "grid grid-cols-[2.25rem_minmax(0,11rem)_8.5rem_minmax(0,1fr)_1.75rem] items-center gap-1.5";

  return (
    <Modal
      open={open}
      title={component.name}
      kicker="Reglas de materiales"
      onClose={onClose}
      panelClassName="max-w-6xl"
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-4">
          <p className="text-xs text-zinc-500">
            Cada material se incluye siempre o cuando se cumple alguna de sus condiciones: dentro de un grupo se combinan con <b className="font-semibold text-zinc-700 dark:text-zinc-300">Y</b>, entre grupos con <b className="font-semibold text-zinc-700 dark:text-zinc-300">O</b>.
          </p>
          <button
            type="button"
            onClick={addRule}
            className="flex shrink-0 items-center gap-1.5 border border-black/15 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-900 hover:bg-zinc-50 dark:border-white/15 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-white/5"
          >
            <i className="ph-bold ph-plus" aria-hidden="true" /> Agregar material
          </button>
        </div>

        {error ? (
          <div role="alert" className="border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-500/20 dark:bg-red-950/20 dark:text-red-300">
            {error}
          </div>
        ) : null}

        <div className="max-h-[65vh] overflow-y-auto border border-black/10 dark:border-white/10">
          {rules.length ? (
            <>
              <div className="sticky top-0 z-10 grid grid-cols-[1.75rem_minmax(0,1fr)_9rem_5rem_6.5rem_5.5rem] gap-2 border-b border-black/10 bg-zinc-100 px-3 py-1.5 text-[10px] font-semibold text-zinc-500 dark:border-white/10 dark:bg-zinc-900">
                <span>#</span><span>Material</span><span>SKU</span><span>Unidad</span><span className="text-right"><FactoryQuantityLabel /> / un.</span><span />
              </div>
              {rules.map((rule, ruleIndex) => {
                const searchOpen = searchState?.ruleLocalId === rule.local_id;
                const conditional = rule.conditions.some((group) => group.clauses.length > 0);
                return (
                  <article key={rule.local_id} className="group/rule border-b border-black/10 px-3 py-2 last:border-0 dark:border-white/10">
                    <div className="grid grid-cols-[1.75rem_minmax(0,1fr)_9rem_5rem_6.5rem_5.5rem] items-center gap-2">
                      <span className="font-mono text-[10px] tabular-nums text-zinc-400">{ruleIndex + 1}</span>
                      <div className="relative">
                        <input
                          value={rule.material_name}
                          onChange={(event) => handleSearchInput(rule.local_id, "material_name", event.target.value)}
                          onFocus={(event) => handleSearchInput(rule.local_id, "material_name", event.target.value)}
                          placeholder="Buscar en ERP o materiales existentes"
                          aria-label="Nombre del material"
                          className={`${control} font-medium`}
                        />
                        {searchOpen && searchState?.field === "material_name" ? renderSearchDropdown(rule.local_id) : null}
                      </div>
                      <div className="relative">
                        <input
                          value={rule.sku}
                          onChange={(event) => handleSearchInput(rule.local_id, "sku", event.target.value)}
                          onFocus={(event) => handleSearchInput(rule.local_id, "sku", event.target.value)}
                          placeholder="Código ERP"
                          aria-label="SKU"
                          className={`${control} font-mono`}
                        />
                        {searchOpen && searchState?.field === "sku" ? renderSearchDropdown(rule.local_id) : null}
                      </div>
                      <input
                        value={rule.unit}
                        onChange={(event) => updateRule(rule.local_id, { unit: event.target.value })}
                        placeholder="EA, M2…"
                        aria-label="Unidad"
                        className={`${control} font-mono`}
                      />
                      <input
                        value={rule.unit_qty_per_unit}
                        onChange={(event) => updateRule(rule.local_id, { unit_qty_per_unit: event.target.value })}
                        placeholder="Opcional"
                        aria-label="Cantidad de fábrica por unidad"
                        inputMode="decimal"
                        className={`${control} text-right font-mono tabular-nums`}
                      />
                      <div className="flex justify-end opacity-40 focus-within:opacity-100 group-hover/rule:opacity-100">
                        <button type="button" onClick={() => moveRule(rule.local_id, -1)} disabled={ruleIndex === 0} className={iconButton} title="Mover arriba" aria-label="Mover arriba">
                          <i className="ph-bold ph-caret-up" />
                        </button>
                        <button type="button" onClick={() => moveRule(rule.local_id, 1)} disabled={ruleIndex === rules.length - 1} className={iconButton} title="Mover abajo" aria-label="Mover abajo">
                          <i className="ph-bold ph-caret-down" />
                        </button>
                        <button type="button" onClick={() => removeRule(rule.local_id)} className={`${iconButton} hover:text-red-600 dark:hover:text-red-400`} title="Eliminar material" aria-label="Eliminar material">
                          <i className="ph-bold ph-trash" />
                        </button>
                      </div>
                    </div>

                    <div className="ml-[2.25rem] mt-1.5 flex flex-col gap-1.5">
                      {rule.conditions.map((group, groupIndex) => group.clauses.length || rule.conditions.length > 1 ? (
                        <section key={group.local_id} className="group/group border-l-2 border-black/10 pl-2 dark:border-white/15">
                          {group.clauses.map((clause, clauseIndex) => {
                            const attributeMeta = getAttributeMeta(clause.attribute_name, attributeChoices);
                            const operatorIsBetween = clause.operator === "BETWEEN";
                            const operatorNeedsNoValue = clause.operator === "IS NOT NULL";
                            const useSelectValue =
                              clause.operator === "=" &&
                              attributeMeta?.value_type === "select" &&
                              Boolean(attributeMeta.options.length);
                            const update = (next: Partial<EditableClause>) => updateClause(rule.local_id, group.local_id, clause.local_id, next);

                            return (
                              <div key={clause.local_id} className={`${clauseColumns} py-0.5`}>
                                <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                                  {clauseIndex > 0 ? "y" : groupIndex > 0 ? "o si" : "si"}
                                </span>
                                <select
                                  value={clause.attribute_name}
                                  onChange={(event) => update({ attribute_name: event.target.value, comparison_value: "", comparison_value_secondary: "" })}
                                  aria-label="Atributo"
                                  className={control}
                                >
                                  <option value="">Atributo</option>
                                  {attributeChoices.map((attribute) => (
                                    <option key={attribute.name} value={attribute.name}>
                                      {attribute.name}
                                    </option>
                                  ))}
                                </select>
                                <select
                                  value={clause.operator}
                                  onChange={(event) => update({ operator: event.target.value, comparison_value: "", comparison_value_secondary: "" })}
                                  aria-label="Operador"
                                  className={control}
                                >
                                  {OPERATORS.map((operator) => (
                                    <option key={operator.value} value={operator.value}>
                                      {operator.label}
                                    </option>
                                  ))}
                                </select>
                                {operatorNeedsNoValue ? (
                                  <span className="text-[10px] text-zinc-400">Sin valor de comparación</span>
                                ) : useSelectValue ? (
                                  <select value={clause.comparison_value} onChange={(event) => update({ comparison_value: event.target.value })} aria-label="Valor" className={control}>
                                    <option value="">Valor</option>
                                    {attributeMeta?.options.map((option) => (
                                      <option key={option} value={option}>
                                        {option}
                                      </option>
                                    ))}
                                  </select>
                                ) : operatorIsBetween ? (
                                  <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1.5">
                                    <input value={clause.comparison_value} onChange={(event) => update({ comparison_value: event.target.value })} placeholder="Desde" aria-label="Desde" className={control} />
                                    <span className="text-[10px] text-zinc-500">y</span>
                                    <input value={clause.comparison_value_secondary} onChange={(event) => update({ comparison_value_secondary: event.target.value })} placeholder="Hasta" aria-label="Hasta" className={control} />
                                  </div>
                                ) : (
                                  <input
                                    value={clause.comparison_value}
                                    onChange={(event) => update({ comparison_value: event.target.value })}
                                    placeholder={clause.operator === "IN" ? "Valores separados por coma" : "Valor"}
                                    aria-label="Valor"
                                    className={control}
                                  />
                                )}
                                <button type="button" onClick={() => removeClause(rule.local_id, group.local_id, clause.local_id)} className={`${iconButton} hover:text-red-600 dark:hover:text-red-400`} title="Quitar condición" aria-label="Quitar condición">
                                  <i className="ph-bold ph-x text-xs" />
                                </button>
                              </div>
                            );
                          })}
                          <div className="flex items-center gap-3 pl-[2.625rem] text-[10px] text-zinc-500">
                            <button type="button" onClick={() => addClause(rule.local_id, group.local_id)} className="hover:text-zinc-950 dark:hover:text-white">+ y…</button>
                            <label className="flex items-center gap-1 opacity-0 focus-within:opacity-100 group-hover/group:opacity-100" title="Identificador interno del grupo">
                              Grupo
                              <input
                                value={group.group}
                                onChange={(event) => updateGroup(rule.local_id, group.local_id, { group: event.target.value })}
                                aria-label="Nombre del grupo"
                                className="w-24 border-b border-black/10 bg-transparent font-mono outline-none focus:border-red-600 dark:border-white/15"
                              />
                            </label>
                            <button type="button" onClick={() => removeGroup(rule.local_id, group.local_id)} className="opacity-0 hover:text-red-600 focus:opacity-100 group-hover/group:opacity-100 dark:hover:text-red-400">
                              Eliminar grupo
                            </button>
                          </div>
                        </section>
                      ) : null)}
                      <div className="flex items-center gap-3 text-[10px] text-zinc-500">
                        {!conditional ? <span className="text-zinc-400">Siempre aplica</span> : null}
                        <button
                          type="button"
                          onClick={() => {
                            const empty = rule.conditions.find((group) => !group.clauses.length);
                            if (!conditional && empty) addClause(rule.local_id, empty.local_id);
                            else addGroup(rule.local_id);
                          }}
                          className="hover:text-zinc-950 dark:hover:text-white"
                        >
                          {conditional ? "+ o si…" : "+ Condición"}
                        </button>
                        {conditional ? <span className="min-w-0 truncate text-zinc-400" title={summarizeRule(rule)}>{summarizeRule(rule)}</span> : null}
                      </div>
                    </div>
                  </article>
                );
              })}
            </>
          ) : (
            <div className="p-8 text-center text-sm text-zinc-500">
              No hay reglas de materiales definidas para este componente.
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3">
          <p className="text-[10px] text-zinc-500">
            {liveErpAvailable
              ? "La búsqueda incluye materiales del ERP."
              : "Búsqueda limitada a materiales guardados del catálogo: el ERP no está configurado."}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="border border-black/15 px-3 py-1.5 text-xs font-semibold text-zinc-800 hover:bg-zinc-50 dark:border-white/15 dark:text-zinc-200 dark:hover:bg-white/5"
            >
              Cerrar
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => void handleSave()}
              className="border border-zinc-950 bg-zinc-950 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50 dark:border-white dark:bg-white dark:text-zinc-950"
            >
              {saving ? "Guardando…" : "Guardar reglas"}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
