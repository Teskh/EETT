import { useDeferredValue, useEffect, useMemo, useState } from "react";

import { ApiError, api } from "../lib/api";
import type { ActivityChange, ActivityEntry, ActivityGroup } from "../lib/types";

function formatTimestamp(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString();
}

function summarizeCount(count: number) {
  return `${count} ${count === 1 ? "entry" : "entries"}`;
}

function renderValue(value: string | null) {
  return value && value.trim() ? value : "Blank";
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
    <div className="grid gap-1 rounded-xl bg-black/[0.03] px-3 py-2 dark:bg-white/[0.04] md:grid-cols-[180px_minmax(0,1fr)] md:items-center">
      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">{change.label}</div>
      <div className="text-sm text-zinc-700 dark:text-zinc-200">
        <span className="text-zinc-500 dark:text-zinc-400">{renderValue(change.before)}</span>
        <span className="px-2 text-zinc-400">→</span>
        <span>{renderValue(change.after)}</span>
      </div>
    </div>
  );
}

function EntryCard({ entry }: { entry: ActivityEntry }) {
  return (
    <section className="rounded-2xl border border-black/5 bg-white/70 px-4 py-4 dark:border-white/10 dark:bg-black/20">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{entry.headline}</h3>
          {entry.subject_name ? <p className="text-sm text-zinc-600 dark:text-zinc-400">{entry.subject_name}</p> : null}
        </div>
        <div className="text-right text-xs text-zinc-500 dark:text-zinc-400">
          <div>{entry.actor || "System"}</div>
          <div>{formatTimestamp(entry.created_at)}</div>
        </div>
      </div>

      {entry.notes.length ? (
        <div className="mt-3 space-y-2">
          {entry.notes.map((note) => (
            <div key={note} className="text-sm leading-6 text-zinc-700 dark:text-zinc-300">
              {note}
            </div>
          ))}
        </div>
      ) : null}

      {entry.changes.length ? (
        <div className="mt-3 space-y-2">
          {entry.changes.map((change) => (
            <ChangeRow key={`${entry.id}-${change.label}-${change.before}-${change.after}`} change={change} />
          ))}
        </div>
      ) : null}
    </section>
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
    <div className="mx-auto flex max-w-[1200px] flex-col gap-6">
      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-100 px-4 py-3 text-sm text-red-800 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-200">
          {error}
        </div>
      ) : null}

      <section className="liquid-glass rounded-[28px] border border-black/10 p-8 dark:border-white/10">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-zinc-500">Change History</p>
            <h1 className="max-w-3xl text-4xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
              A readable record of what changed, who changed it, and the exact values that moved.
            </h1>
            <p className="max-w-3xl text-sm leading-6 text-zinc-600 dark:text-zinc-400">
              Every entry stays specific, but the page no longer exposes table names, internal IDs, or raw data dumps.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadHistory()}
            className="rounded-xl border border-black/10 bg-white px-4 py-2.5 text-sm font-semibold text-zinc-800 dark:border-white/10 dark:bg-white/5 dark:text-zinc-100"
          >
            Refresh
          </button>
        </div>
      </section>

      <section className="liquid-glass rounded-[24px] border border-black/10 p-5 dark:border-white/10">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.8fr)_220px_220px_auto]">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-bold uppercase tracking-[0.22em] text-zinc-500">Search</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Project, person, subject, field..."
              className="w-full rounded-xl border border-black/10 bg-white px-3 py-2.5 text-sm dark:border-white/10 dark:bg-black/30"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-bold uppercase tracking-[0.22em] text-zinc-500">Status</span>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className="w-full rounded-xl border border-black/10 bg-white px-3 py-2.5 text-sm dark:border-white/10 dark:bg-black/30"
            >
              <option value="all">All statuses</option>
              <option value="template">Template</option>
              <option value="execution">Execution</option>
              <option value="finished">Finished</option>
            </select>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-bold uppercase tracking-[0.22em] text-zinc-500">Project</span>
            <select
              value={projectFilter}
              onChange={(event) => setProjectFilter(event.target.value)}
              className="w-full rounded-xl border border-black/10 bg-white px-3 py-2.5 text-sm dark:border-white/10 dark:bg-black/30"
            >
              <option value="all">All projects</option>
              {projectOptions.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>

          <div className="flex items-end">
            <div className="w-full rounded-xl bg-black/[0.04] px-4 py-2.5 text-sm text-zinc-600 dark:bg-white/[0.05] dark:text-zinc-300">
              {summarizeCount(filteredGroups.length)}
            </div>
          </div>
        </div>
      </section>

      <div className="space-y-4">
        {loading ? (
          <div className="liquid-glass rounded-2xl p-8 text-sm text-zinc-600 dark:text-zinc-400">Loading change history...</div>
        ) : filteredGroups.length ? (
          filteredGroups.map((group) => (
            <article key={group.id} className="liquid-glass rounded-[28px] border border-black/10 p-5 dark:border-white/10">
              <header className="flex flex-wrap items-start justify-between gap-4">
                <div className="space-y-2">
                  <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">{group.title}</h2>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-zinc-500 dark:text-zinc-400">
                    <span>{group.project.name}</span>
                    <span>{group.actor || "System"}</span>
                    <span>{formatTimestamp(group.created_at)}</span>
                    <span>{summarizeCount(group.entry_count)}</span>
                  </div>
                </div>
              </header>

              <div className="mt-4 space-y-3">
                {group.entries.map((entry) => (
                  <EntryCard key={entry.id} entry={entry} />
                ))}
              </div>
            </article>
          ))
        ) : (
          <div className="liquid-glass rounded-2xl p-8 text-sm text-zinc-600 dark:text-zinc-400">
            No history entries match the current filters.
          </div>
        )}
      </div>
    </div>
  );
}
