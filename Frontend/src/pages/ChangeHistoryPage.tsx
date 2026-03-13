import { useDeferredValue, useEffect, useMemo, useState } from "react";

import { ApiError, api } from "../lib/api";
import type { ActivityEvent, ActivityGroup } from "../lib/types";

function formatTimestamp(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString();
}

function isNoisyGroup(group: ActivityGroup) {
  return group.events.some((event) => event.details.noise_hint === "material_quantity");
}

function isNoisyEvent(event: ActivityEvent) {
  return event.details.noise_hint === "material_quantity";
}

function summarizeEvent(event: ActivityEvent) {
  const changes = Array.isArray(event.details.changes) ? event.details.changes : null;
  if (changes && changes.length > 0) {
    return `${event.action.replaceAll("_", " ")}: ${changes
      .map((change) => String((change as { field?: string }).field || "field"))
      .join(", ")}`;
  }
  if (typeof event.details.material_name === "string") {
    return `${event.action.replaceAll("_", " ")}: ${event.details.material_name}`;
  }
  return event.action.replaceAll("_", " ");
}

function formatBomSnapshot(value: unknown) {
  if (!Array.isArray(value) || value.length === 0) {
    return "No quantity rows";
  }
  return value
    .map((row) => {
      const typedRow = row as {
        subtype_name?: string | null;
        subtype_id?: number | null;
        quantity?: number | null;
        assembly_quantity?: number | null;
      };
      const label = typedRow.subtype_name || (typedRow.subtype_id === null ? "General" : `Subtype ${typedRow.subtype_id ?? "-"}`);
      return `${label}: qty ${typedRow.quantity ?? "blank"}, asm ${typedRow.assembly_quantity ?? "blank"}`;
    })
    .join(" | ");
}

export function ChangeHistoryPage() {
  const [groups, setGroups] = useState<ActivityGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [projectFilter, setProjectFilter] = useState("all");
  const [hideNoisy, setHideNoisy] = useState(false);
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
    return groups
      .map((group) => {
        const visibleEvents = hideNoisy ? group.events.filter((event) => !isNoisyEvent(event)) : group.events;
        return {
          ...group,
          event_count: visibleEvents.length,
          events: visibleEvents,
        };
      })
      .filter((group) => {
        if (hideNoisy && group.events.length === 0 && group.approvals.length === 0) {
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
        const haystack = [
          group.title,
          group.project.name,
          group.project.status_label,
          group.actor || "",
          ...group.events.map((event) => `${event.entity_type} ${event.action} ${String(event.details.material_name || "")}`),
          ...group.approvals.map((approval) => approval.summary),
        ]
          .join(" ")
          .toLowerCase();
        return haystack.includes(query);
      });
  }, [deferredSearch, groups, hideNoisy, projectFilter, statusFilter]);

  return (
    <div className="max-w-[1600px] mx-auto flex flex-col gap-6">
      {error ? (
        <div className="rounded-xl border border-red-200 dark:border-red-500/20 bg-red-100 dark:bg-red-500/10 px-4 py-3 text-sm text-red-800 dark:text-red-200">
          {error}
        </div>
      ) : null}

      <section className="liquid-glass rounded-2xl p-8 border border-black/10 dark:border-white/10">
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6">
          <div>
            <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2">Governance</p>
            <h1 className="text-4xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">Change History</h1>
            <p className="mt-2 max-w-3xl text-sm text-zinc-600 dark:text-zinc-400">
              Review grouped project changes, filter by workflow status, and hide noisy material-quantity edits when you want a cleaner approval timeline.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadHistory()}
            className="px-4 py-2.5 rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-white/5 text-sm font-semibold text-zinc-800 dark:text-zinc-100"
          >
            Refresh History
          </button>
        </div>
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-[320px_minmax(0,1fr)] gap-6">
        <aside className="liquid-glass rounded-2xl p-5 border border-black/10 dark:border-white/10 h-fit xl:sticky xl:top-24">
          <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-4">Filters</div>
          <div className="space-y-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-bold uppercase tracking-widest text-zinc-500">Search</label>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Project, actor, action..."
                className="w-full rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-black/30 px-3 py-2 text-sm"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-bold uppercase tracking-widest text-zinc-500">Project Status</label>
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
                className="w-full rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-black/30 px-3 py-2 text-sm"
              >
                <option value="all">All statuses</option>
                <option value="template">Project Template</option>
                <option value="execution">Execution Projects</option>
                <option value="finished">Finished Projects</option>
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-bold uppercase tracking-widest text-zinc-500">Project</label>
              <select
                value={projectFilter}
                onChange={(event) => setProjectFilter(event.target.value)}
                className="w-full rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-black/30 px-3 py-2 text-sm"
              >
                <option value="all">All projects</option>
                {projectOptions.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </div>
            <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
              <input type="checkbox" checked={hideNoisy} onChange={(event) => setHideNoisy(event.target.checked)} />
              Hide noisy material quantity changes
            </label>
            <div className="text-xs text-zinc-500 dark:text-zinc-400">
              {groups.filter((group) => isNoisyGroup(group)).length} grouped entries include material quantity edits.
            </div>
          </div>
        </aside>

        <div className="space-y-4">
          {loading ? (
            <div className="liquid-glass rounded-2xl p-8 text-sm text-zinc-600 dark:text-zinc-400">Loading change history...</div>
          ) : filteredGroups.length ? (
            filteredGroups.map((group) => (
              <article key={group.id} className="liquid-glass rounded-2xl p-5 border border-black/10 dark:border-white/10">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">{group.title}</h2>
                      <span className="rounded border border-black/10 dark:border-white/10 bg-zinc-50 dark:bg-white/5 px-2 py-0.5 text-[10px] font-mono uppercase tracking-widest text-zinc-500">
                        {group.project.status_label}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-mono text-zinc-500 dark:text-zinc-400">
                      <span>{group.project.name}</span>
                      <span>{group.actor || "system"}</span>
                      <span>{formatTimestamp(group.created_at)}</span>
                      <span>{group.event_count} event{group.event_count === 1 ? "" : "s"}</span>
                    </div>
                  </div>
                  {group.mutation_batch_id ? (
                    <span className="rounded border border-black/10 dark:border-white/10 bg-zinc-50 dark:bg-white/5 px-2 py-1 text-[10px] font-mono text-zinc-500 dark:text-zinc-400">
                      {group.mutation_batch_id}
                    </span>
                  ) : null}
                </div>

                {group.events.length ? (
                  <div className="mt-4 space-y-2">
                    {group.events.map((event) => (
                      <div key={event.id} className="rounded-lg border border-black/5 dark:border-white/5 bg-white dark:bg-black/20 px-3 py-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{summarizeEvent(event)}</div>
                          {isNoisyEvent(event) ? (
                            <span className="rounded border border-amber-200 dark:border-amber-500/20 bg-amber-100 dark:bg-amber-500/10 px-2 py-0.5 text-[10px] font-mono uppercase tracking-widest text-amber-800 dark:text-amber-300">
                              Noisy
                            </span>
                          ) : null}
                        </div>
                        <div className="text-[11px] font-mono text-zinc-500 dark:text-zinc-400">
                          {event.entity_type}
                          {event.entity_id !== null ? ` #${event.entity_id}` : ""}
                        </div>
                        {isNoisyEvent(event) ? (
                          <div className="mt-1 text-[11px] text-zinc-600 dark:text-zinc-400">
                            <div>Before: {formatBomSnapshot(event.details.before)}</div>
                            <div>After: {formatBomSnapshot(event.details.after)}</div>
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : null}

                {group.approvals.length ? (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {group.approvals.map((approval) => (
                      <span
                        key={approval.id}
                        className="rounded border border-emerald-200 dark:border-emerald-500/20 bg-emerald-100 dark:bg-emerald-500/10 px-2 py-1 text-[11px] font-medium text-emerald-800 dark:text-emerald-300"
                      >
                        Approval {approval.status}: {approval.summary}
                      </span>
                    ))}
                  </div>
                ) : null}
              </article>
            ))
          ) : (
            <div className="liquid-glass rounded-2xl p-8 text-sm text-zinc-600 dark:text-zinc-400">
              No history groups match the current filters.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
