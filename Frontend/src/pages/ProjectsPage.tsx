import { FormEvent, useEffect, useState } from "react";

import { ApiError, api } from "../lib/api";
import type { CreateProjectRequest, ProjectsBoardData, SessionUser } from "../lib/types";

type ProjectsPageProps = {
  onNavigate: (to: string) => void;
  currentUser: SessionUser;
};

const orderedStatuses = ["template", "execution", "finished"];

const statusIcons: Record<string, string> = {
  template: "ph-blueprint",
  execution: "ph-hammer",
  finished: "ph-check-circle",
};

const initialProjectForm: CreateProjectRequest = {
  name: "",
  description: "",
  status: "template",
};

export function ProjectsPage({ onNavigate, currentUser }: ProjectsPageProps) {
  const [data, setData] = useState<ProjectsBoardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<CreateProjectRequest>(initialProjectForm);
  const [saving, setSaving] = useState(false);

  async function loadProjects() {
    setLoading(true);
    setError(null);
    try {
      setData(await api.getProjects());
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Could not load projects.";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadProjects();
  }, []);

  async function handleCreateProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const result = await api.createProject(form);
      setForm(initialProjectForm);
      if (result.project_id) {
        onNavigate(`/projects/${result.project_id}`);
      } else {
        await loadProjects();
      }
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Could not create project.";
      setError(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-[1600px] mx-auto flex flex-col gap-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {currentUser.permissions.project_create ? (
          <form className="liquid-glass rounded-2xl p-6 flex flex-col gap-4" onSubmit={handleCreateProject}>
            <h2 className="text-sm font-bold text-zinc-900 dark:text-zinc-200 uppercase tracking-widest flex items-center gap-2">
              <i className="ph-bold ph-folder-plus text-zinc-500 dark:text-zinc-400" /> Create Project
            </h2>
            <div className="space-y-3">
              <input
                value={form.name}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                required
                placeholder="Project Name"
                className="w-full bg-black/5 dark:bg-black/40 border border-black/10 dark:border-white/10 rounded-lg p-2.5 text-sm text-zinc-900 dark:text-zinc-200 focus:outline-none focus:border-accent-500/50 transition-all font-mono placeholder-zinc-500"
              />
              <select
                value={form.status}
                onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}
                className="w-full bg-black/5 dark:bg-black/40 border border-black/10 dark:border-white/10 rounded-lg p-2.5 text-sm text-zinc-900 dark:text-zinc-200 focus:outline-none focus:border-accent-500/50 transition-all font-mono"
              >
                <option value="template">Project Template</option>
                <option value="execution">Execution Project</option>
                <option value="finished">Finished Project</option>
              </select>
              <textarea
                value={form.description || ""}
                onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                rows={2}
                placeholder="Description"
                className="w-full bg-black/5 dark:bg-black/40 border border-black/10 dark:border-white/10 rounded-lg p-2.5 text-sm text-zinc-900 dark:text-zinc-200 focus:outline-none focus:border-accent-500/50 transition-all font-mono placeholder-zinc-500"
              />
            </div>
            <button
              type="submit"
              disabled={saving}
              className="mt-2 px-4 py-2.5 bg-accent-500 hover:bg-accent-400 disabled:opacity-60 text-zinc-950 border border-transparent rounded-lg text-sm font-bold transition-all flex justify-center items-center gap-2"
            >
              <i className="ph-bold ph-plus" /> {saving ? "Creating..." : "Create Project"}
            </button>
          </form>
        ) : (
          <div className="liquid-glass rounded-2xl p-6 flex flex-col gap-3 justify-center">
            <h2 className="text-sm font-bold text-zinc-900 dark:text-zinc-200 uppercase tracking-widest flex items-center gap-2">
              <i className="ph-bold ph-lock text-zinc-500 dark:text-zinc-400" /> Create Project
            </h2>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Your current role can browse projects, but project creation stays limited to editor-level users.
            </p>
          </div>
        )}

        <div className="md:col-span-2 liquid-glass rounded-2xl p-8 flex flex-col justify-center relative overflow-hidden group">
          
          <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2">
            <i className="ph-bold ph-info text-accent-600 dark:text-accent-500 mr-1" /> Project Board
          </p>
          <h2 className="text-2xl font-bold text-zinc-900 dark:text-white tracking-tight mb-2">Project lifecycle preserved</h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400 max-w-xl leading-relaxed">
            The legacy statuses remain explicit domain states. The viewer workspace keeps templates, execution
            projects, and finished work together in one model while still allowing status-based browsing.
          </p>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 dark:border-red-500/20 bg-red-100 dark:bg-red-500/10 px-4 py-3 text-sm text-red-800 dark:text-red-200">{error}</div>
      ) : null}

      {loading ? (
        <div className="liquid-glass rounded-2xl p-8 text-sm text-zinc-500">Loading project board...</div>
      ) : data ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {orderedStatuses.map((status) => {
            const projects = data.grouped_projects[status] || [];
            return (
              <div key={status} className="liquid-glass rounded-2xl p-5 flex flex-col h-[700px]">
                <div className="flex items-center justify-between mb-6 border-b border-black/10 dark:border-white/10 pb-4">
                  <h2 className="text-sm font-bold text-zinc-900 dark:text-white uppercase tracking-widest flex items-center gap-2">
                    <i className={`ph-bold ${statusIcons[status]} text-zinc-500 dark:text-zinc-400`} /> {data.status_labels[status]}
                  </h2>
                  <span className="px-2 py-0.5 bg-black/5 dark:bg-black/40 border border-black/10 dark:border-white/10 rounded text-[10px] font-mono text-zinc-500 dark:text-zinc-400">
                    {projects.length}
                  </span>
                </div>
                <div className="flex-1 overflow-y-auto pr-2 space-y-3">
                  {projects.length ? (
                    projects.map((project) => (
                      <div
                        key={project.id}
                        className="bg-black/5 dark:bg-black/40 border border-black/10 dark:border-white/10 rounded-xl p-4 group hover:border-accent-500/50 transition-colors flex flex-col gap-3"
                      >
                        <div>
                          <h3 className="text-sm font-bold text-zinc-900 dark:text-white mb-1 group-hover:text-accent-600 dark:text-accent-500 dark:group-hover:text-accent-700 dark:text-accent-400 transition-colors">
                            {project.name}
                          </h3>
                          <p className="text-xs text-zinc-600 dark:text-zinc-500 line-clamp-2">{project.description || "No description."}</p>
                        </div>
                        <div className="flex items-center justify-between border-t border-black/5 dark:border-white/5 pt-3 mt-auto">
                          <div className="flex items-center gap-2 font-mono text-[10px] text-zinc-500">
                            <i className="ph-bold ph-stack" /> {project.instance_count} instances
                          </div>
                          <button 
                            className="px-3 py-1.5 bg-zinc-50 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-zinc-100 dark:hover:bg-white/10 text-zinc-900 dark:text-white rounded text-[10px] font-semibold transition-colors border border-black/10 dark:border-white/10" 
                            onClick={() => onNavigate(`/projects/${project.id}`)}
                          >
                            Open Project
                          </button>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="text-center p-6 border border-dashed border-black/10 dark:border-white/10 rounded-xl text-xs font-mono text-zinc-500">
                      No projects
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
