import { FormEvent, useEffect, useState } from "react";

import { Modal } from "../components/Modal";
import { ApiError, api } from "../lib/api";
import type { CreateProjectRequest, ProjectDetailData, ProjectsBoardData, ProjectSubtype, SessionUser } from "../lib/types";

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

type SubtypeModalState = {
  projectId: number;
  projectName: string;
} | null;

function SubtypeNodeEditor({
  subtype,
  pendingSubtypeId,
  onCreateChild,
  onRename,
  onDelete,
}: {
  subtype: ProjectSubtype;
  pendingSubtypeId: number | "root" | null;
  onCreateChild: (parentId: number) => Promise<void>;
  onRename: (subtypeId: number, name: string) => Promise<void>;
  onDelete: (subtypeId: number) => Promise<void>;
}) {
  const [draftName, setDraftName] = useState(subtype.name);

  useEffect(() => {
    setDraftName(subtype.name);
  }, [subtype.name]);

  async function handleBlur() {
    const nextName = draftName.trim();
    if (!nextName || nextName === subtype.name) {
      setDraftName(subtype.name);
      return;
    }
    await onRename(subtype.id, nextName);
  }

  return (
    <li>
      <div className="rounded-lg border border-black/10 dark:border-white/10 bg-black/5 dark:bg-black/30 p-2.5">
        <div className="flex items-center gap-2">
          <i className="ph-fill ph-git-branch text-zinc-500" />
          <input
            value={draftName}
            onChange={(event) => setDraftName(event.target.value)}
            onBlur={() => void handleBlur()}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                event.currentTarget.blur();
              }
            }}
            className="min-w-0 flex-1 bg-white dark:bg-black/30 border border-black/10 dark:border-white/10 rounded px-2 py-1 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-accent-500/50"
          />
          <button
            type="button"
            disabled={pendingSubtypeId === subtype.id}
            onClick={() => void onCreateChild(subtype.id)}
            className="px-2 py-1 rounded border border-black/10 dark:border-white/10 bg-white dark:bg-black/30 text-[10px] font-semibold uppercase tracking-widest text-zinc-600 dark:text-zinc-300 disabled:opacity-50"
          >
            Child
          </button>
          <button
            type="button"
            disabled={pendingSubtypeId === subtype.id}
            onClick={() => void onDelete(subtype.id)}
            className="px-2 py-1 rounded border border-red-200 dark:border-red-500/20 bg-red-100 dark:bg-red-500/10 text-[10px] font-semibold uppercase tracking-widest text-red-700 dark:text-red-300 disabled:opacity-50"
          >
            Delete
          </button>
        </div>
      </div>
      {subtype.children.length ? (
        <ul className="ml-5 mt-1 space-y-1 border-l border-black/10 dark:border-white/10 pl-3">
          {subtype.children.map((child) => (
            <SubtypeNodeEditor
              key={child.id}
              subtype={child}
              pendingSubtypeId={pendingSubtypeId}
              onCreateChild={onCreateChild}
              onRename={onRename}
              onDelete={onDelete}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function ProjectsPage({ onNavigate, currentUser }: ProjectsPageProps) {
  const [data, setData] = useState<ProjectsBoardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<CreateProjectRequest>(initialProjectForm);
  const [saving, setSaving] = useState(false);
  const [subtypeModal, setSubtypeModal] = useState<SubtypeModalState>(null);
  const [subtypeProject, setSubtypeProject] = useState<ProjectDetailData | null>(null);
  const [subtypeLoading, setSubtypeLoading] = useState(false);
  const [pendingSubtypeId, setPendingSubtypeId] = useState<number | "root" | null>(null);

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

  useEffect(() => {
    if (!subtypeModal) {
      setSubtypeProject(null);
      return;
    }

    const projectId = subtypeModal.projectId;
    let active = true;
    async function loadSubtypeProject() {
      setSubtypeLoading(true);
      setError(null);
      try {
        const detail = await api.getProject(projectId);
        if (active) {
          setSubtypeProject(detail);
        }
      } catch (err) {
        const message = err instanceof ApiError ? err.message : "Could not load project subtypes.";
        if (active) {
          setError(message);
          setSubtypeProject(null);
        }
      } finally {
        if (active) {
          setSubtypeLoading(false);
        }
      }
    }

    void loadSubtypeProject();
    return () => {
      active = false;
    };
  }, [subtypeModal]);

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

  async function refreshSubtypeProject(projectId: number) {
    const detail = await api.getProject(projectId);
    setSubtypeProject(detail);
  }

  async function handleCreateSubtype(parentId: number | null) {
    if (!subtypeModal) {
      return;
    }
    const promptLabel = parentId === null ? "New root subtype name" : "New child subtype name";
    const name = window.prompt(promptLabel);
    if (!name || !name.trim()) {
      return;
    }
    setPendingSubtypeId(parentId ?? "root");
    setError(null);
    try {
      await api.createProjectSubtype(subtypeModal.projectId, { name: name.trim(), parent_id: parentId });
      await refreshSubtypeProject(subtypeModal.projectId);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Could not create subtype.";
      setError(message);
    } finally {
      setPendingSubtypeId(null);
    }
  }

  async function handleRenameSubtype(subtypeId: number, name: string) {
    if (!subtypeModal) {
      return;
    }
    setPendingSubtypeId(subtypeId);
    setError(null);
    try {
      await api.updateProjectSubtype(subtypeModal.projectId, subtypeId, { name });
      await refreshSubtypeProject(subtypeModal.projectId);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Could not rename subtype.";
      setError(message);
    } finally {
      setPendingSubtypeId(null);
    }
  }

  async function handleDeleteSubtype(subtypeId: number) {
    if (!subtypeModal) {
      return;
    }
    const confirmed = window.confirm("Delete this subtype and all nested subtype rows?");
    if (!confirmed) {
      return;
    }
    setPendingSubtypeId(subtypeId);
    setError(null);
    try {
      await api.deleteProjectSubtype(subtypeModal.projectId, subtypeId);
      await refreshSubtypeProject(subtypeModal.projectId);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Could not delete subtype.";
      setError(message);
    } finally {
      setPendingSubtypeId(null);
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
                className="w-full bg-black/5 dark:bg-zinc-900 border border-black/10 dark:border-white/10 rounded-lg p-2.5 text-sm text-zinc-900 dark:text-zinc-200 focus:outline-none focus:border-accent-500/50 transition-all font-mono"
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
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              disabled={!currentUser.permissions.project_edit}
                              className="px-3 py-1.5 bg-zinc-50 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-zinc-100 dark:hover:bg-white/10 text-zinc-900 dark:text-white rounded text-[10px] font-semibold transition-colors border border-black/10 dark:border-white/10 disabled:opacity-50 disabled:hover:bg-zinc-50 dark:disabled:hover:bg-white/5"
                              onClick={() => setSubtypeModal({ projectId: project.id, projectName: project.name })}
                              title={currentUser.permissions.project_edit ? "Manage project subtypes" : "This role cannot edit project subtypes"}
                            >
                              Subtypes
                            </button>
                            <button 
                              className="px-3 py-1.5 bg-zinc-50 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-zinc-100 dark:hover:bg-white/10 text-zinc-900 dark:text-white rounded text-[10px] font-semibold transition-colors border border-black/10 dark:border-white/10" 
                              onClick={() => onNavigate(`/projects/${project.id}`)}
                            >
                              Open Project
                            </button>
                          </div>
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

      <Modal
        open={subtypeModal !== null}
        title={subtypeModal?.projectName || "Project Subtypes"}
        kicker="Subtype Manager"
        onClose={() => setSubtypeModal(null)}
        panelClassName="max-w-3xl"
      >
        <div className="flex items-center justify-between gap-3 mb-4">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Manage the project subtype hierarchy from the board instead of inside the project workspace.
          </p>
          <button
            type="button"
            disabled={pendingSubtypeId === "root"}
            onClick={() => void handleCreateSubtype(null)}
            className="px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-zinc-50 dark:bg-white/5 text-xs font-semibold disabled:opacity-50"
          >
            Add Root Subtype
          </button>
        </div>

        {subtypeLoading ? (
          <div className="rounded-xl border border-dashed border-black/10 dark:border-white/10 p-6 text-sm text-zinc-500">
            Loading subtypes...
          </div>
        ) : subtypeProject ? (
          <ul className="space-y-2">
            {subtypeProject.subtypes.length ? (
              subtypeProject.subtypes.map((subtype) => (
                <SubtypeNodeEditor
                  key={subtype.id}
                  subtype={subtype}
                  pendingSubtypeId={pendingSubtypeId}
                  onCreateChild={handleCreateSubtype}
                  onRename={handleRenameSubtype}
                  onDelete={handleDeleteSubtype}
                />
              ))
            ) : (
              <li className="rounded-xl border border-dashed border-black/10 dark:border-white/10 p-6 text-sm text-zinc-500">
                No subtype breakdown defined.
              </li>
            )}
          </ul>
        ) : (
          <div className="rounded-xl border border-dashed border-black/10 dark:border-white/10 p-6 text-sm text-zinc-500">
            Could not load subtypes.
          </div>
        )}
      </Modal>
    </div>
  );
}
