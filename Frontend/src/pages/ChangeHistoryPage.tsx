import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { 
  ArrowRight, 
  MagnifyingGlass, 
  Funnel, 
  ArrowClockwise, 
  WarningCircle, 
  CaretDown, 
  Stack,
  ClockCounterClockwise
} from "@phosphor-icons/react";

import { ApiError, api } from "../lib/api";
import type { ActivityChange, ActivityEntry, ActivityGroup } from "../lib/types";
import { renderQuantityText } from "../components/QuantityLabels";

function formatTimestamp(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  const includeYear = parsed.getFullYear() !== new Date().getFullYear();
  const date = parsed.toLocaleDateString("es-CL", {
    day: "2-digit",
    month: "2-digit",
    ...(includeYear ? { year: "numeric" as const } : {}),
  });
  const time = parsed.toLocaleTimeString("es-CL", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return `${date} ${time}`;
}

function renderValue(value: string | null) {
  return value && value.trim() ? value : "—";
}

type DiffPart = {
  text: string;
  type: "equal" | "added" | "deleted";
};

function tokenizeDiffText(value: string) {
  return value.match(/\s+|[^\s]+/g) || [];
}

function compactDiffParts(parts: DiffPart[]) {
  return parts.reduce<DiffPart[]>((result, part) => {
    const previous = result[result.length - 1];
    if (previous && previous.type === part.type) {
      previous.text += part.text;
    } else {
      result.push({ ...part });
    }
    return result;
  }, []);
}

function buildTextDiff(before: string, after: string) {
  if (before === after) {
    return {
      before: [{ text: before, type: "equal" as const }],
      after: [{ text: after, type: "equal" as const }],
    };
  }

  const beforeTokens = tokenizeDiffText(before);
  const afterTokens = tokenizeDiffText(after);
  const lengths = Array.from({ length: beforeTokens.length + 1 }, () =>
    Array<number>(afterTokens.length + 1).fill(0),
  );

  for (let beforeIndex = beforeTokens.length - 1; beforeIndex >= 0; beforeIndex -= 1) {
    for (let afterIndex = afterTokens.length - 1; afterIndex >= 0; afterIndex -= 1) {
      lengths[beforeIndex][afterIndex] =
        beforeTokens[beforeIndex] === afterTokens[afterIndex]
          ? lengths[beforeIndex + 1][afterIndex + 1] + 1
          : Math.max(lengths[beforeIndex + 1][afterIndex], lengths[beforeIndex][afterIndex + 1]);
    }
  }

  const beforeParts: DiffPart[] = [];
  const afterParts: DiffPart[] = [];
  let beforeIndex = 0;
  let afterIndex = 0;

  while (beforeIndex < beforeTokens.length && afterIndex < afterTokens.length) {
    if (beforeTokens[beforeIndex] === afterTokens[afterIndex]) {
      const text = beforeTokens[beforeIndex];
      beforeParts.push({ text, type: "equal" });
      afterParts.push({ text, type: "equal" });
      beforeIndex += 1;
      afterIndex += 1;
    } else if (lengths[beforeIndex + 1][afterIndex] >= lengths[beforeIndex][afterIndex + 1]) {
      beforeParts.push({ text: beforeTokens[beforeIndex], type: "deleted" });
      beforeIndex += 1;
    } else {
      afterParts.push({ text: afterTokens[afterIndex], type: "added" });
      afterIndex += 1;
    }
  }

  while (beforeIndex < beforeTokens.length) {
    beforeParts.push({ text: beforeTokens[beforeIndex], type: "deleted" });
    beforeIndex += 1;
  }
  while (afterIndex < afterTokens.length) {
    afterParts.push({ text: afterTokens[afterIndex], type: "added" });
    afterIndex += 1;
  }

  return {
    before: compactDiffParts(beforeParts),
    after: compactDiffParts(afterParts),
  };
}

function renderDiffParts(parts: DiffPart[], mode: "before" | "after") {
  return parts.map((part, index) => {
    const className =
      part.type === "deleted"
        ? "rounded-sm bg-red-50 px-0.5 text-red-700 line-through decoration-red-400 dark:bg-red-500/10 dark:text-red-300 dark:decoration-red-500"
        : part.type === "added"
          ? "rounded-sm bg-emerald-50 px-0.5 font-medium text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
          : mode === "before"
            ? "text-zinc-500 dark:text-zinc-500"
            : "text-zinc-900 dark:text-zinc-100";
    return (
      <span key={`${part.type}-${index}`} className={className}>
        {renderQuantityText(part.text)}
      </span>
    );
  });
}

type ChangeTypeFilter = "material_quantities" | "material_membership" | "instance_changes";

const CHANGE_TYPE_OPTIONS: Array<{ id: ChangeTypeFilter; label: string }> = [
  { id: "material_quantities", label: "Cantidades de materiales" },
  { id: "material_membership", label: "Material agregado/eliminado" },
  { id: "instance_changes", label: "Cambios en EETT" },
];

const DEFAULT_CHANGE_TYPE_FILTERS = CHANGE_TYPE_OPTIONS.map((option) => option.id);

const ACTIVITY_TEXT_TRANSLATIONS: Record<string, string> = {
  "Project activity": "Actividad del proyecto",
  "Project created": "Proyecto creado",
  "Project status updated": "Estado del proyecto actualizado",
  "Subtype created": "Subtipo creado",
  "Subtype renamed": "Subtipo renombrado",
  "Subtype deleted": "Subtipo eliminado",
  "Component added": "Componente agregado",
  "Component details changed": "Detalles del componente modificados",
  "Component deleted": "Componente eliminado",
  "Usage added": "Uso agregado",
  "Usage changed": "Uso modificado",
  "Usage removed": "Uso eliminado",
  "Material mode updated": "Modo de materiales actualizado",
  "Project material mode changed": "Modo de materiales del proyecto modificado",
  "Material quantities changed": "Q_fábrica de materiales modificada",
  "Material added": "Material agregado",
  "Material removed": "Material eliminado",
  "Catalog values reapplied": "Valores del catálogo reaplicados",
  "Catalog field applied": "Campo del catálogo aplicado",
  "Instance field applied to catalog": "Campo de la instancia aplicado al catálogo",
  "Base attribute schema reconciled": "Esquema de atributos base conciliado",
  "Comment added": "Comentario agregado",
  "Approval requested": "Aprobación solicitada",
  "Approval approved": "Aprobación aprobada",
  "Approval rejected": "Aprobación rechazada",
  "Review completed": "Revisión completada",
  "Top-level subtype": "Subtipo de nivel superior",
  "Snapshot created from catalog template.": "Snapshot creado desde la plantilla del catálogo.",
  "Project instance customized after snapshot creation.": "Instancia de proyecto personalizada después de crear el snapshot.",
  "Catalog trim instructions changed after this accessory was attached.": "Las instrucciones de terminación del catálogo cambiaron después de asociar este accesorio.",
};

const NORMALIZED_ACTIVITY_TEXT_TRANSLATIONS: Record<string, string> = {
  "project activity": "Actividad del proyecto",
  "project created": "Proyecto creado",
  "project status updated": "Estado del proyecto actualizado",
  "subtype created": "Subtipo creado",
  "subtype renamed": "Subtipo renombrado",
  "subtype deleted": "Subtipo eliminado",
  "component added": "Componente agregado",
  "components added": "Componentes agregados",
  "component details changed": "Detalles del componente modificados",
  "component deleted": "Componente eliminado",
  "components deleted": "Componentes eliminados",
  "usage added": "Uso agregado",
  "usage changed": "Uso modificado",
  "usage removed": "Uso eliminado",
  "material mode updated": "Modo de materiales actualizado",
  "project material mode changed": "Modo de materiales del proyecto modificado",
  "material quantities changed": "Q_fábrica de materiales modificada",
  "materials changed": "Materiales modificados",
  "material added": "Material agregado",
  "materials added": "Materiales agregados",
  "material removed": "Material eliminado",
  "materials removed": "Materiales eliminados",
  "catalog values reapplied": "Valores del catálogo reaplicados",
  "catalog field applied": "Campo del catálogo aplicado",
  "instance field applied to catalog": "Campo de la instancia aplicado al catálogo",
  "base attribute schema reconciled": "Esquema de atributos base conciliado",
  "comment added": "Comentario agregado",
  "approval requested": "Aprobación solicitada",
  "approval approved": "Aprobación aprobada",
  "approval rejected": "Aprobación rechazada",
  "approved project changes": "Cambios del proyecto aprobados",
  "rejected project changes": "Cambios del proyecto rechazados",
  "review completed": "Revisión completada",
  "top level subtype": "Subtipo de nivel superior",
  "snapshot created from catalog template": "Snapshot creado desde la plantilla del catálogo",
  "project instance customized after snapshot creation": "Instancia de proyecto personalizada después de crear el snapshot",
  "catalog trim instructions changed after this accessory was attached": "Las instrucciones de terminación del catálogo cambiaron después de asociar este accesorio",
};

function normalizeActivityTextKey(value: string) {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/[.。]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

const ACTIVITY_LABEL_TRANSLATIONS: Record<string, string> = {
  Status: "Estado",
  "Subtype name": "Nombre del subtipo",
  "Material mode": "Modo de materiales",
  "Standard quantity": "Q_fábrica estándar",
  Name: "Nombre",
  "Short Name": "Nombre corto",
  Description: "Descripción",
  "Short Description": "Descripción corta",
  Installation: "Instalación",
  "Unit amount": "Q_fábrica unitaria",
  Relationship: "Relación",
  "Usage label": "Etiqueta de uso",
  Targets: "Destinos",
  "Base Attributes": "Atributos base",
  "Added attribute": "Atributo agregado",
  "Removed attribute": "Atributo eliminado",
};

const NORMALIZED_ACTIVITY_LABEL_TRANSLATIONS: Record<string, string> = {
  status: "Estado",
  "subtype name": "Nombre del subtipo",
  "material mode": "Modo de materiales",
  "standard quantity": "Q_fábrica estándar",
  name: "Nombre",
  "short name": "Nombre corto",
  description: "Descripción",
  "short description": "Descripción corta",
  installation: "Instalación",
  "unit amount": "Q_fábrica unitaria",
  relationship: "Relación",
  "usage label": "Etiqueta de uso",
  targets: "Destinos",
  "base attributes": "Atributos base",
  "added attribute": "Atributo agregado",
  "removed attribute": "Atributo eliminado",
};

function normalizeActivityLabelKey(value: string) {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

const ACTIVITY_VALUE_TRANSLATIONS: Record<string, string> = {
  template: "Plantilla",
  execution: "Ejecución",
  finished: "Terminado",
  Template: "Plantilla",
  Execution: "Ejecución",
  Finished: "Terminado",
  "Project Template": "Plantilla de Proyecto",
  "Execution Projects": "Proyectos en Ejecución",
  "Finished Projects": "Proyectos Terminados",
  General: "General",
  "Per subtype": "Por subtipo",
  manual: "manual",
};

function translateActivityValue(value: string | null) {
  if (!value || !value.trim()) {
    return value;
  }
  return ACTIVITY_VALUE_TRANSLATIONS[value] || value;
}

function translateActivityLabel(value: string) {
  const exact = ACTIVITY_LABEL_TRANSLATIONS[value];
  if (exact) {
    return exact;
  }
  const normalized = NORMALIZED_ACTIVITY_LABEL_TRANSLATIONS[normalizeActivityLabelKey(value)];
  if (normalized) {
    return normalized;
  }
  const assemblyKitQuantityMatch = value.match(/^(.+) assembly kit quantity$/);
  if (assemblyKitQuantityMatch) {
    return `Q_obra de ${translateActivityValue(assemblyKitQuantityMatch[1]) || assemblyKitQuantityMatch[1]}`;
  }
  const assemblyQuantityMatch = value.match(/^(.+) assembly quantity$/);
  if (assemblyQuantityMatch) {
    return `Q_obra de ${translateActivityValue(assemblyQuantityMatch[1]) || assemblyQuantityMatch[1]}`;
  }
  const quantityMatch = value.match(/^(.+) quantity$/);
  if (quantityMatch) {
    return `Q_fábrica de ${translateActivityValue(quantityMatch[1]) || quantityMatch[1]}`;
  }
  return value;
}

function translateActivityText(value: string | null | undefined) {
  if (!value) {
    return value;
  }
  const exact = ACTIVITY_TEXT_TRANSLATIONS[value];
  if (exact) {
    return exact;
  }
  const normalized = NORMALIZED_ACTIVITY_TEXT_TRANSLATIONS[normalizeActivityTextKey(value)];
  if (normalized) {
    return normalized;
  }

  const statusMatch = value.match(/^Status: (.+)$/);
  if (statusMatch) {
    return `Estado: ${translateActivityValue(statusMatch[1]) || statusMatch[1]}`;
  }
  const sourceMatch = value.match(/^Source: (.+)$/);
  if (sourceMatch) {
    return `Origen: ${translateActivityValue(sourceMatch[1]) || sourceMatch[1]}`;
  }
  const synchronizedMatch = value.match(/^Synchronized (.+) for (.+)$/);
  if (synchronizedMatch) {
    return `${translateActivityLabel(synchronizedMatch[1])} sincronizado para ${synchronizedMatch[2]}`;
  }
  const appliedMatch = value.match(/^Applied (.+) from (.+) to catalog$/);
  if (appliedMatch) {
    return `${translateActivityLabel(appliedMatch[1])} aplicado desde ${appliedMatch[2]} al catálogo`;
  }

  const prefixedTranslations: Array<[RegExp, string]> = [
    [/^Parent subtype: (.+)$/, "Subtipo padre: $1"],
    [/^Category: (.+)$/, "Categoría: $1"],
    [/^Template: (.+)$/, "Plantilla: $1"],
    [/^Component: (.+)$/, "Componente: $1"],
    [/^Linked to: (.+)$/, "Vinculado a: $1"],
    [/^Removed link to: (.+)$/, "Vínculo eliminado con: $1"],
    [/^Updated materials for (.+)$/, "Materiales actualizados para $1"],
    [/^Updated status for (.+)$/, "Estado actualizado para $1"],
    [/^Created subtype (.+)$/, "Subtipo creado: $1"],
    [/^Updated subtype (.+)$/, "Subtipo actualizado: $1"],
    [/^Deleted subtype (.+)$/, "Subtipo eliminado: $1"],
    [/^Added (.+)$/, "Agregado: $1"],
    [/^Refreshed (.+)$/, "Actualizado desde catálogo: $1"],
    [/^Updated usage for (.+)$/, "Uso actualizado para $1"],
    [/^Updated (.+)$/, "Actualizado: $1"],
    [/^Deleted (.+)$/, "Eliminado: $1"],
    [/^Approval (.+)$/, "Aprobación $1"],
    [/^Comment on (.+)$/, "Comentario en $1"],
  ];

  for (const [pattern, replacement] of prefixedTranslations) {
    if (pattern.test(value)) {
      return value.replace(pattern, replacement);
    }
  }
  return value;
}

function normalizeLabel(value: string) {
  return value
    .toLowerCase()
    .replace(/ies\b/g, "y")
    .replace(/es\b/g, "")
    .replace(/s\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isRedundantEntryHeadline(groupTitle: string, headline: string) {
  const normalizedGroupTitle = normalizeLabel(groupTitle);
  const normalizedHeadline = normalizeLabel(headline);
  return Boolean(normalizedGroupTitle && normalizedHeadline && normalizedGroupTitle === normalizedHeadline);
}

function buildHaystack(group: ActivityGroup) {
  return [
    group.title,
    translateActivityText(group.title) || "",
    group.project.name,
    group.project.status_label,
    translateActivityValue(group.project.status_label) || "",
    group.actor || "",
    ...group.entries.flatMap((entry) => [
      entry.headline,
      translateActivityText(entry.headline) || "",
      entry.subject_name || "",
      entry.actor || "",
      ...entry.notes,
      ...entry.notes.map((note) => translateActivityText(note) || ""),
      ...entry.changes.flatMap((change) => [
        change.label,
        translateActivityLabel(change.label),
        change.before || "",
        translateActivityValue(change.before) || "",
        change.after || "",
        translateActivityValue(change.after) || "",
      ]),
    ]),
  ]
    .join(" ")
    .toLowerCase();
}

function hasAnySelectedChangeType(group: ActivityGroup, selectedTypes: Set<ChangeTypeFilter>) {
  if (selectedTypes.size === 0) {
    return false;
  }
  const groupTypes = getActivityGroupChangeTypes(group);
  return [...groupTypes].some((type) => selectedTypes.has(type));
}

function getActivityGroupChangeTypes(group: ActivityGroup) {
  const types = new Set<ChangeTypeFilter>();
  for (const entry of group.entries) {
    for (const type of getActivityEntryChangeTypes(group, entry)) {
      types.add(type);
    }
  }
  return types;
}

function getActivityEntryChangeTypes(group: ActivityGroup, entry: ActivityEntry) {
  const types = new Set<ChangeTypeFilter>();
  const kind = normalizeActivityLabelKey(entry.kind || "");
  const headline = normalizeActivityTextKey(entry.headline || "");
  const title = normalizeActivityTextKey(group.title || "");
  const notes = entry.notes.map((note) => normalizeActivityTextKey(note)).join(" ");
  const labels = entry.changes.map((change) => normalizeActivityLabelKey(change.label)).join(" ");
  const text = `${title} ${headline} ${notes} ${labels}`;

  const isMaterialEntry = kind === "material" || text.includes("material");
  const isMaterialMembership =
    isMaterialEntry &&
    (
      headline.includes("material added") ||
      headline.includes("materials added") ||
      headline.includes("material agregado") ||
      headline.includes("materiales agregados") ||
      headline.includes("material removed") ||
      headline.includes("materials removed") ||
      headline.includes("material eliminado") ||
      headline.includes("materiales eliminados") ||
      title.includes("material added") ||
      title.includes("materials added") ||
      title.includes("material agregado") ||
      title.includes("materiales agregados") ||
      title.includes("material removed") ||
      title.includes("materials removed") ||
      title.includes("material eliminado") ||
      title.includes("materiales eliminados")
    );

  if (isMaterialMembership) {
    types.add("material_membership");
  } else if (
    isMaterialEntry &&
    (
      text.includes("quantity") ||
      text.includes("quantities") ||
      text.includes("q_fabrica") ||
      text.includes("q_fábrica") ||
      text.includes("q fabrica") ||
      text.includes("q fábrica") ||
      text.includes("q_obra") ||
      text.includes("q obra") ||
      text.includes("materiales modificada") ||
      text.includes("materials changed")
    )
  ) {
    types.add("material_quantities");
  }

  if (types.size === 0) {
    types.add("instance_changes");
  }
  return types;
}

function ChangeRow({ change }: { change: ActivityChange }) {
  const beforeValue = renderValue(translateActivityValue(change.before));
  const afterValue = renderValue(translateActivityValue(change.after));
  const diff = useMemo(() => buildTextDiff(beforeValue, afterValue), [afterValue, beforeValue]);

  return (
    <div className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-3 py-1.5 text-xs hover:bg-zinc-50 dark:hover:bg-white/[0.02] transition-colors -mx-2 px-2 rounded">
       <div className="sm:w-[140px] flex-shrink-0 font-mono text-[10px] text-zinc-500 uppercase tracking-widest sm:pt-[3px] break-words">
         {renderQuantityText(translateActivityLabel(change.label))}
       </div>
       <div className="flex-1 font-mono min-w-0 break-words leading-relaxed">
         <span>
           {renderDiffParts(diff.before, "before")}
         </span>
         <span className="mx-2.5 inline-flex align-middle">
           <ArrowRight className="w-3 h-3 text-zinc-400" />
         </span>
         <span className="font-medium">
           {renderDiffParts(diff.after, "after")}
         </span>
       </div>
    </div>
  );
}

function EntryCard({ entry, groupTitle }: { entry: ActivityEntry; groupTitle: string }) {
  const promotedNote = entry.subject_name ? null : entry.notes[0] || null;
  const entryLabel = entry.subject_name || translateActivityText(promotedNote);
  const showHeadline = !isRedundantEntryHeadline(groupTitle, entry.headline);
  const visibleNotes = promotedNote ? entry.notes.slice(1) : entry.notes;

  return (
    <div className="py-2 first:pt-0 last:pb-0">
      {entryLabel && (
        <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          {renderQuantityText(entryLabel)}
        </div>
      )}

      {showHeadline && (
        <div className="text-xs text-zinc-500 font-mono mt-0.5">
          {renderQuantityText(translateActivityText(entry.headline) || "")}
        </div>
      )}

      {visibleNotes.length > 0 && (
         <div className="mt-1 flex flex-wrap gap-1">
           {visibleNotes.map((note, i) => (
             <span key={i} className="text-[11px] px-1.5 py-0.5 bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 rounded-sm">
               {renderQuantityText(translateActivityText(note) || "")}
             </span>
           ))}
         </div>
      )}

      {entry.changes.length > 0 && (
        <div className="mt-2 space-y-0.5">
           {entry.changes.map((change, idx) => (
             <ChangeRow key={`${entry.id}-change-${idx}`} change={change} />
           ))}
        </div>
      )}
    </div>
  );
}

function ActivityGroupRow({ group, showProject }: { group: ActivityGroup; showProject: boolean }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-[220px_minmax(0,1fr)] border-b border-zinc-200 dark:border-white/[0.05] group">
      {/* Meta Sidebar (Dense) */}
      <div className="p-3 md:p-4 md:border-r border-zinc-200 dark:border-white/[0.05] bg-zinc-50/50 dark:bg-black/10">
        <div className="flex flex-col gap-1">
          <div className="font-mono text-[11px] text-zinc-500 tracking-tight">
            {formatTimestamp(group.created_at)}
          </div>
          <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">
            {group.actor || "Sistema"}
          </div>
          {showProject && (
            <div className="inline-flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400 mt-2 truncate">
              <Stack className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="truncate">{group.project.name}</span>
            </div>
          )}
        </div>
      </div>

      {/* Main Content (Dense) */}
      <div className="p-3 md:p-4 bg-white dark:bg-transparent min-w-0">
        <h2 className="text-sm font-bold text-zinc-900 dark:text-zinc-50 mb-3 border-b border-zinc-100 dark:border-white/[0.02] pb-2">
          {renderQuantityText(translateActivityText(group.title) || "")}
        </h2>
        
        <div className="space-y-3 divide-y divide-zinc-100 dark:divide-white/[0.02]">
          {group.entries.map((entry) => (
            <EntryCard key={entry.id} entry={entry} groupTitle={group.title} />
          ))}
        </div>
      </div>
    </div>
  );
}

export function ChangeHistoryPage() {
  const [groups, setGroups] = useState<ActivityGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [projectFilter, setProjectFilter] = useState("");
  const [changeTypeFilters, setChangeTypeFilters] = useState<Set<ChangeTypeFilter>>(
    () => new Set(DEFAULT_CHANGE_TYPE_FILTERS),
  );
  const deferredSearch = useDeferredValue(search);

  async function loadHistory() {
    setLoading(true);
    setError(null);
    try {
      setGroups(await api.getActivityHistory());
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "No se pudo cargar el historial de cambios.";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadHistory();
  }, []);

  const projectOptions = useMemo(() => {
    const seen = new Map<number, { id: number; name: string }>();
    for (const group of groups) {
      if (!seen.has(group.project.id)) {
        seen.set(group.project.id, { id: group.project.id, name: group.project.name });
      }
    }
    return [...seen.values()].sort((left, right) => left.name.localeCompare(right.name));
  }, [groups]);

  const filteredGroups = useMemo(() => {
    if (!projectFilter) {
      return [];
    }
    const query = deferredSearch.trim().toLowerCase();
    return groups.filter((group) => {
      if (!hasAnySelectedChangeType(group, changeTypeFilters)) {
        return false;
      }
      if (statusFilter !== "all" && group.project.status !== statusFilter) {
        return false;
      }
      if (projectFilter !== "all" && String(group.project.id) !== projectFilter) {
        return false;
      }
      if (!query) {
        return true;
      }
      return buildHaystack(group).includes(query);
    });
  }, [changeTypeFilters, deferredSearch, groups, projectFilter, statusFilter]);

  function toggleChangeTypeFilter(type: ChangeTypeFilter) {
    setChangeTypeFilters((current) => {
      const next = new Set(current);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  }

  return (
    <div className="w-full text-zinc-900 dark:text-zinc-100 font-sans">
      <div className="max-w-5xl mx-auto bg-white dark:bg-[#09090b] sm:border border-zinc-200 dark:border-white/10 sm:rounded-lg sm:shadow-sm overflow-hidden flex flex-col">
        
        {/* Extremely Dense Header / Filter Bar */}
        <div className="sticky top-0 z-40 bg-zinc-50 dark:bg-[#09090b] border-b border-zinc-200 dark:border-white/10 px-4 py-2 flex flex-col gap-3">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="flex items-center gap-4">
              <h1 className="text-base font-bold tracking-tight uppercase flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                Registro de Auditoría
              </h1>
              <div className="hidden md:block w-px h-4 bg-zinc-300 dark:bg-zinc-800" />
              <div className="text-xs font-mono text-zinc-500">
                {filteredGroups.length} {filteredGroups.length === 1 ? "REGISTRO" : "REGISTROS"}
              </div>
            </div>

            <div className="flex flex-col sm:flex-row items-center gap-2 flex-1 md:justify-end">
              <div className="relative w-full sm:w-auto flex-1 max-w-sm">
                <MagnifyingGlass className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar registros..."
                  className="w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-white/10 rounded px-8 py-1.5 text-xs focus:outline-none focus:border-zinc-400 dark:focus:border-zinc-500 focus:ring-1 focus:ring-zinc-400 dark:focus:ring-zinc-500 font-mono transition-colors placeholder:font-sans"
                />
              </div>

              <div className="flex items-center gap-2 w-full sm:w-auto">
                <div className="relative w-full sm:w-36">
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    className="appearance-none w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-white/10 rounded pl-7 pr-6 py-1.5 text-xs focus:outline-none focus:border-zinc-400 dark:focus:border-zinc-500 cursor-pointer font-mono"
                  >
                    <option value="all">TODOS LOS ESTADOS</option>
                    <option value="template">PLANTILLA</option>
                    <option value="execution">EJECUCIÓN</option>
                    <option value="finished">TERMINADO</option>
                  </select>
                  <Funnel className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400 w-3.5 h-3.5 pointer-events-none" />
                  <CaretDown className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 w-3.5 h-3.5 pointer-events-none" />
                </div>

                <div className="relative w-full sm:w-48">
                  <select
                    value={projectFilter}
                    onChange={(e) => setProjectFilter(e.target.value)}
                    className="appearance-none w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-white/10 rounded pl-7 pr-6 py-1.5 text-xs focus:outline-none focus:border-zinc-400 dark:focus:border-zinc-500 cursor-pointer font-mono"
                  >
                    <option value="">SELECCIONAR PROYECTO</option>
                    <option value="all">TODOS LOS PROYECTOS</option>
                    {projectOptions.map(p => (
                      <option key={p.id} value={p.id}>{p.name.toUpperCase()}</option>
                    ))}
                  </select>
                  <Stack className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400 w-3.5 h-3.5 pointer-events-none" />
                  <CaretDown className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 w-3.5 h-3.5 pointer-events-none" />
                </div>

                <button 
                  onClick={() => void loadHistory()}
                  disabled={loading}
                  className="flex-shrink-0 flex items-center justify-center w-8 h-8 rounded bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-white text-white dark:text-zinc-900 disabled:opacity-50 transition-colors"
                  title="Actualizar"
                >
                  <ArrowClockwise weight="bold" className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
                </button>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t border-zinc-200 pt-2 dark:border-white/[0.06]">
            {CHANGE_TYPE_OPTIONS.map((option) => (
              <label
                key={option.id}
                className="inline-flex min-h-7 items-center gap-2 rounded border border-zinc-200 bg-white px-2.5 py-1 text-[11px] font-medium text-zinc-600 transition-colors hover:border-zinc-300 dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:border-white/20"
              >
                <input
                  type="checkbox"
                  checked={changeTypeFilters.has(option.id)}
                  onChange={() => toggleChangeTypeFilter(option.id)}
                  className="h-3.5 w-3.5 accent-zinc-900 dark:accent-zinc-100"
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
        </div>

      {error && (
        <div className="flex items-center gap-2 bg-red-500 text-white px-4 py-2 text-xs font-mono">
          <WarningCircle weight="fill" className="w-4 h-4" />
          {error}
        </div>
      )}

      {/* Feed List (Cockpit Mode Grid) */}
      <div className="relative">
        {loading ? (
          <div className="px-4 py-8 text-xs font-mono text-zinc-500 flex items-center gap-2">
             <ArrowClockwise className="w-4 h-4 animate-spin" />
             CARGANDO REGISTROS DE AUDITORÍA...
          </div>
        ) : filteredGroups.length > 0 ? (
          <div className="flex flex-col border-t border-zinc-200 dark:border-white/[0.05]">
            {filteredGroups.map(group => (
              <ActivityGroupRow key={group.id} group={group} showProject={projectFilter === "all"} />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-24 text-center">
             <ClockCounterClockwise className="w-8 h-8 text-zinc-300 dark:text-zinc-700 mb-4" />
             <div className="text-xs font-mono text-zinc-500">
               {projectFilter ? "NO SE ENCONTRARON REGISTROS" : "SELECCIONA UN PROYECTO PARA VER REGISTROS"}
             </div>
          </div>
        )}
      </div>

      </div>
    </div>
  );
}
