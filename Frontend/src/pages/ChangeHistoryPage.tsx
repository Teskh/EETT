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

function formatTimestamp(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  // YYYY-MM-DD HH:MM:SS for dense monospace reading
  return parsed.toISOString().replace("T", " ").substring(0, 19);
}

function renderValue(value: string | null) {
  return value && value.trim() ? value : "—";
}

function buildHaystack(group: ActivityGroup) {
  return [
    group.title,
    group.project.name,
    group.project.status_label,
    group.actor || "",
    ...group.entries.flatMap((entry) => [
      entry.headline,
      entry.subject_name || "",
      entry.actor || "",
      ...entry.notes,
      ...entry.changes.flatMap((change) => [change.label, change.before || "", change.after || ""]),
    ]),
  ]
    .join(" ")
    .toLowerCase();
}

function ChangeRow({ change }: { change: ActivityChange }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-3 py-1.5 text-xs hover:bg-zinc-50 dark:hover:bg-white/[0.02] transition-colors -mx-2 px-2 rounded">
       <div className="sm:w-[140px] flex-shrink-0 font-mono text-[10px] text-zinc-500 uppercase tracking-widest sm:pt-[3px] break-words">
         {change.label}
       </div>
       <div className="flex-1 font-mono min-w-0 break-words leading-relaxed">
         <span className="text-zinc-500 dark:text-zinc-500 line-through decoration-zinc-300 dark:decoration-zinc-700">
           {renderValue(change.before)}
         </span>
         <span className="mx-2.5 inline-flex align-middle">
           <ArrowRight className="w-3 h-3 text-zinc-400" />
         </span>
         <span className="font-medium text-zinc-900 dark:text-zinc-100">
           {renderValue(change.after)}
         </span>
       </div>
    </div>
  );
}

function EntryCard({ entry }: { entry: ActivityEntry }) {
  return (
    <div className="py-2 first:pt-0 last:pb-0">
      <div className="flex items-baseline gap-2">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          {entry.headline}
        </h3>
        {entry.subject_name && (
          <span className="text-xs text-zinc-500 font-mono before:content-['/'] before:mr-2 before:text-zinc-300 dark:before:text-zinc-700">
            {entry.subject_name}
          </span>
        )}
      </div>

      {entry.notes.length > 0 && (
         <div className="mt-1 flex flex-wrap gap-1">
           {entry.notes.map((note, i) => (
             <span key={i} className="text-[11px] px-1.5 py-0.5 bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 rounded-sm">
               {note}
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

function ActivityGroupRow({ group }: { group: ActivityGroup }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-[220px_minmax(0,1fr)] border-b border-zinc-200 dark:border-white/[0.05] group">
      {/* Meta Sidebar (Dense) */}
      <div className="p-3 md:p-4 md:border-r border-zinc-200 dark:border-white/[0.05] bg-zinc-50/50 dark:bg-black/10">
        <div className="flex flex-col gap-1">
          <div className="font-mono text-[11px] text-zinc-500 tracking-tight">
            {formatTimestamp(group.created_at)}
          </div>
          <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">
            {group.actor || "System"}
          </div>
          <div className="inline-flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400 mt-2 truncate">
            <Stack className="w-3.5 h-3.5 flex-shrink-0" />
            <span className="truncate">{group.project.name}</span>
          </div>
        </div>
      </div>

      {/* Main Content (Dense) */}
      <div className="p-3 md:p-4 bg-white dark:bg-transparent min-w-0">
        <h2 className="text-sm font-bold text-zinc-900 dark:text-zinc-50 mb-3 border-b border-zinc-100 dark:border-white/[0.02] pb-2">
          {group.title}
        </h2>
        
        <div className="space-y-3 divide-y divide-zinc-100 dark:divide-white/[0.02]">
          {group.entries.map((entry) => (
            <EntryCard key={entry.id} entry={entry} />
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
  const [projectFilter, setProjectFilter] = useState("all");
  const deferredSearch = useDeferredValue(search);

  async function loadHistory() {
    setLoading(true);
    setError(null);
    try {
      setGroups(await api.getActivityHistory());
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Could not load change history.";
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
    const query = deferredSearch.trim().toLowerCase();
    return groups.filter((group) => {
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
  }, [deferredSearch, groups, projectFilter, statusFilter]);

  return (
    <div className="w-full text-zinc-900 dark:text-zinc-100 font-sans">
      <div className="max-w-5xl mx-auto bg-white dark:bg-[#09090b] sm:border border-zinc-200 dark:border-white/10 sm:rounded-lg sm:shadow-sm overflow-hidden flex flex-col">
        
        {/* Extremely Dense Header / Filter Bar */}
        <div className="sticky top-0 z-40 bg-zinc-50 dark:bg-[#09090b] border-b border-zinc-200 dark:border-white/10 px-4 py-2 flex flex-col md:flex-row md:items-center justify-between gap-3">
        
        <div className="flex items-center gap-4">
          <h1 className="text-base font-bold tracking-tight uppercase flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            Audit Log
          </h1>
          <div className="hidden md:block w-px h-4 bg-zinc-300 dark:bg-zinc-800" />
          <div className="text-xs font-mono text-zinc-500">
            {filteredGroups.length} {filteredGroups.length === 1 ? "RECORD" : "RECORDS"}
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-center gap-2 flex-1 md:justify-end">
          <div className="relative w-full sm:w-auto flex-1 max-w-sm">
            <MagnifyingGlass className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Query logs..."
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
                <option value="all">ALL STATUS</option>
                <option value="template">TEMPLATE</option>
                <option value="execution">EXECUTION</option>
                <option value="finished">FINISHED</option>
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
                <option value="all">ALL PROJECTS</option>
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
              title="Refresh"
            >
              <ArrowClockwise weight="bold" className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>
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
             FETCHING AUDIT LOGS...
          </div>
        ) : filteredGroups.length > 0 ? (
          <div className="flex flex-col border-t border-zinc-200 dark:border-white/[0.05]">
            {filteredGroups.map(group => (
              <ActivityGroupRow key={group.id} group={group} />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-24 text-center">
             <ClockCounterClockwise className="w-8 h-8 text-zinc-300 dark:text-zinc-700 mb-4" />
             <div className="text-xs font-mono text-zinc-500">NO RECORDS FOUND</div>
          </div>
        )}
      </div>

      </div>
    </div>
  );
}
