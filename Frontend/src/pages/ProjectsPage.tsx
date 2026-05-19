import { DragEvent, FormEvent, useEffect, useState } from "react";

import { Modal } from "../components/Modal";
import { FactoryQuantityLabel, WorkQuantityLabel } from "../components/QuantityLabels";
import { ApiError, api } from "../lib/api";
import type { CreateProjectRequest, ExportJob, ProjectDetailData, ProjectsBoardData, ProjectSubtype, SessionUser } from "../lib/types";

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
  status: "template",
};

type SubtypeModalState = {
  projectId: number;
  projectName: string;
} | null;

type ExportModalState = {
  projectId: number;
  projectName: string;
} | null;

type DetailedMaterialQuantityBasis = "factory" | "work" | "total";

const INLINE_EXPORT_KINDS = new Set([
  "commercial_pdf",
  "full_technical_pdf",
  "total_materials_pdf",
  "context_materials_pdf",
  "detailed_material_pdf",
  "assembly_kit_pdf",
]);

function FileTypeIcon({ kind }: { kind: "pdf" | "xls" }) {
  const isPdf = kind === "pdf";
  return (
    <span
      className={[
        "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-base font-bold",
        isPdf
          ? "bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400"
          : "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400",
      ].join(" ")}
      aria-hidden
    >
      <i className={`ph-fill ${isPdf ? "ph-file-pdf" : "ph-file-xls"} text-xl`} />
    </span>
  );
}

function ExportRow({
  kind,
  title,
  subtitle,
  loading,
  disabled,
  onClick,
}: {
  kind: "pdf" | "xls";
  title: string;
  subtitle: string;
  loading: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="group flex w-full items-center gap-3 border-b border-black/5 px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-black/[0.03] disabled:opacity-50 dark:border-white/5 dark:hover:bg-white/[0.04]"
    >
      <FileTypeIcon kind={kind} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-zinc-900 dark:text-white">{title}</span>
        <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">
          {loading ? "Generando..." : subtitle}
        </span>
      </span>
      <i
        className={`ph-bold ${
          loading ? "ph-circle-notch animate-spin text-accent-500" : "ph-download-simple text-zinc-300 group-hover:text-accent-500 dark:text-zinc-600"
        } text-base transition-colors`}
      />
    </button>
  );
}

function TotalQuantityLabel() {
  return (
    <span className="whitespace-nowrap">
      Q<sub className="normal-case tracking-normal">total</sub>
    </span>
  );
}

function DetailedMaterialQuantityLabel({ basis }: { basis: DetailedMaterialQuantityBasis }) {
  if (basis === "factory") {
    return <FactoryQuantityLabel />;
  }
  if (basis === "work") {
    return <WorkQuantityLabel />;
  }
  return <TotalQuantityLabel />;
}

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
            Hijo
          </button>
          <button
            type="button"
            disabled={pendingSubtypeId === subtype.id}
            onClick={() => void onDelete(subtype.id)}
            className="px-2 py-1 rounded border border-red-200 dark:border-red-500/20 bg-red-100 dark:bg-red-500/10 text-[10px] font-semibold uppercase tracking-widest text-red-700 dark:text-red-300 disabled:opacity-50"
          >
            Eliminar
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
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [subtypeModal, setSubtypeModal] = useState<SubtypeModalState>(null);
  const [exportModal, setExportModal] = useState<ExportModalState>(null);
  const [detailedMaterialQuantityBasis, setDetailedMaterialQuantityBasis] = useState<DetailedMaterialQuantityBasis>("factory");
  const [subtypeProject, setSubtypeProject] = useState<ProjectDetailData | null>(null);
  const [subtypeLoading, setSubtypeLoading] = useState(false);
  const [pendingSubtypeId, setPendingSubtypeId] = useState<number | "root" | null>(null);
  const [exportingJob, setExportingJob] = useState<{ projectId: number; kind: string } | null>(null);
  const [draggingProject, setDraggingProject] = useState<{ projectId: number; fromStatus: string } | null>(null);
  const [dropTargetStatus, setDropTargetStatus] = useState<string | null>(null);
  const [updatingProjectId, setUpdatingProjectId] = useState<number | null>(null);
  const [pendingProjectAction, setPendingProjectAction] = useState<{ projectId: number; action: "copy" | "delete" } | null>(null);
  const canChangeProjectStatus = currentUser.permissions.project_change_status;
  const isGuest = Boolean(currentUser.is_guest);

  function resolveDownloadFilename(job: ExportJob, contentDisposition: string | null) {
    const utf8Match = contentDisposition?.match(/filename\*=UTF-8''([^;]+)/i);
    if (utf8Match?.[1]) {
      return decodeURIComponent(utf8Match[1]);
    }
    const plainMatch = contentDisposition?.match(/filename="?([^"]+)"?/i);
    if (plainMatch?.[1]) {
      return plainMatch[1];
    }
    const pathParts = (job.artifact_uri || "").split("/");
    return pathParts[pathParts.length - 1] || "export.bin";
  }

  async function downloadExportArtifact(job: ExportJob) {
    if (!job.artifact_uri) {
      throw new Error("La exportación terminó sin archivo.");
    }

    const response = await fetch(job.artifact_uri, { credentials: "same-origin" });
    if (!response.ok) {
      throw new Error("No se pudo descargar el archivo exportado.");
    }

    const blob = await response.blob();
    const objectUrl = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = resolveDownloadFilename(job, response.headers.get("content-disposition"));
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(() => window.URL.revokeObjectURL(objectUrl), 1000);
  }

  async function openExportArtifact(job: ExportJob) {
    if (!job.artifact_uri) {
      throw new Error("La exportación terminó sin archivo.");
    }
    if (INLINE_EXPORT_KINDS.has(job.kind)) {
      window.open(job.artifact_uri, "_blank", "noopener,noreferrer");
      return;
    }
    await downloadExportArtifact(job);
  }

  function isExporting(projectId: number, kind: string) {
    return exportingJob?.projectId === projectId && exportingJob.kind === kind;
  }

  function moveProjectToStatus(boardData: ProjectsBoardData, projectId: number, targetStatus: string): ProjectsBoardData {
    let movedProject: ProjectsBoardData["grouped_projects"][string][number] | null = null;
    const groupedProjects = Object.fromEntries(
      Object.entries(boardData.grouped_projects).map(([status, projects]) => [
        status,
        projects.filter((project) => {
          if (project.id !== projectId) {
            return true;
          }
          movedProject = {
            ...project,
            status: targetStatus,
            status_label: boardData.status_labels[targetStatus] || project.status_label,
          };
          return false;
        }),
      ]),
    );
    if (!movedProject) {
      return boardData;
    }
    return {
      ...boardData,
      grouped_projects: {
        ...groupedProjects,
        [targetStatus]: [...(groupedProjects[targetStatus] || []), movedProject].sort((left, right) =>
          left.name.localeCompare(right.name),
        ),
      },
    };
  }

  async function loadProjects() {
    setLoading(true);
    setError(null);
    try {
      setData(await api.getProjects());
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "No se pudieron cargar los proyectos.";
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
        const message = err instanceof ApiError ? err.message : "No se pudieron cargar los subtipos del proyecto.";
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
      setCreateModalOpen(false);
      if (result.project_id) {
        onNavigate(`/projects/${result.project_id}`);
      } else {
        await loadProjects();
      }
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "No se pudo crear el proyecto.";
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
    const promptLabel = parentId === null ? "Nombre del nuevo subtipo raíz" : "Nombre del nuevo subtipo hijo";
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
      const message = err instanceof ApiError ? err.message : "No se pudo crear el subtipo.";
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
      const message = err instanceof ApiError ? err.message : "No se pudo renombrar el subtipo.";
      setError(message);
    } finally {
      setPendingSubtypeId(null);
    }
  }

  async function handleDeleteSubtype(subtypeId: number) {
    if (!subtypeModal) {
      return;
    }
    const confirmed = window.confirm("¿Eliminar este subtipo y todas sus filas anidadas?");
    if (!confirmed) {
      return;
    }
    setPendingSubtypeId(subtypeId);
    setError(null);
    try {
      await api.deleteProjectSubtype(subtypeModal.projectId, subtypeId);
      await refreshSubtypeProject(subtypeModal.projectId);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "No se pudo eliminar el subtipo.";
      setError(message);
    } finally {
      setPendingSubtypeId(null);
    }
  }

  async function handleRequestExport(projectId: number, kind: string, payload: Record<string, unknown> = {}) {
    setExportingJob({ projectId, kind });
    setError(null);
    try {
      const job = await api.requestProjectExport(projectId, { kind, payload });
      if (job.status !== "completed") {
        const payloadError = typeof job.payload.error === "string" ? job.payload.error : null;
        throw new Error(payloadError || "La exportación no se completó correctamente.");
      }
      await openExportArtifact(job);
      return true;
    } catch (err) {
      const message = err instanceof ApiError || err instanceof Error ? err.message : "No se pudo exportar el archivo.";
      setError(message);
      return false;
    } finally {
      setExportingJob(null);
    }
  }

  async function handleModalExport(kind: string, payload: Record<string, unknown> = {}) {
    if (!exportModal) {
      return;
    }
    const completed = await handleRequestExport(exportModal.projectId, kind, payload);
    if (completed) {
      setExportModal(null);
    }
  }

  function handleProjectDragStart(event: DragEvent<HTMLDivElement>, projectId: number, fromStatus: string) {
    if (!canChangeProjectStatus) {
      return;
    }
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(projectId));
    setDraggingProject({ projectId, fromStatus });
  }

  async function handleProjectDrop(targetStatus: string) {
    if (!canChangeProjectStatus || !draggingProject || !data) {
      return;
    }
    if (draggingProject.fromStatus === targetStatus) {
      setDraggingProject(null);
      setDropTargetStatus(null);
      return;
    }

    const previousData = data;
    setUpdatingProjectId(draggingProject.projectId);
    setError(null);
    setData(moveProjectToStatus(previousData, draggingProject.projectId, targetStatus));
    setDraggingProject(null);
    setDropTargetStatus(null);

    try {
      await api.updateProjectStatus(draggingProject.projectId, { status: targetStatus });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "No se pudo actualizar el estado del proyecto.";
      setData(previousData);
      setError(message);
    } finally {
      setUpdatingProjectId(null);
    }
  }

  async function handleCopyProject(project: ProjectsBoardData["grouped_projects"][string][number]) {
    const suggestedName = `${project.name} - copy`;
    const nextName = window.prompt("Nombre para la copia del proyecto", suggestedName);
    if (nextName === null) {
      return;
    }
    const cleanName = nextName.trim();
    if (!cleanName) {
      setError("El nombre de la copia es obligatorio.");
      return;
    }

    setPendingProjectAction({ projectId: project.id, action: "copy" });
    setError(null);
    try {
      const result = await api.copyProject(project.id, { name: cleanName });
      if (result.project_id) {
        onNavigate(`/projects/${result.project_id}`);
        return;
      }
      await loadProjects();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "No se pudo copiar el proyecto.";
      setError(message);
    } finally {
      setPendingProjectAction(null);
    }
  }

  async function handleDeleteProject(project: ProjectsBoardData["grouped_projects"][string][number]) {
    const confirmation = window.prompt(`Escribe "${project.name}" para eliminar este proyecto definitivamente.`);
    if (confirmation === null) {
      return;
    }
    if (confirmation !== project.name) {
      setError("El nombre no coincide. El proyecto no fue eliminado.");
      return;
    }

    setPendingProjectAction({ projectId: project.id, action: "delete" });
    setError(null);
    try {
      await api.deleteProject(project.id);
      await loadProjects();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "No se pudo eliminar el proyecto.";
      setError(message);
    } finally {
      setPendingProjectAction(null);
    }
  }

  return (
    <div className="max-w-[1600px] mx-auto flex flex-col gap-6">
      <div className="flex items-center justify-end">
        {currentUser.permissions.project_create ? (
          <button
            type="button"
            onClick={() => setCreateModalOpen(true)}
            className="h-10 w-10 rounded-full border border-black/10 dark:border-white/10 bg-white/60 dark:bg-white/5 text-zinc-700 dark:text-zinc-200 hover:bg-white dark:hover:bg-white/10 hover:border-accent-500/40 transition-colors flex items-center justify-center"
            aria-label="Crear proyecto"
            title="Crear proyecto"
          >
            <i className="ph-bold ph-plus text-sm" />
          </button>
        ) : null}
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 dark:border-red-500/20 bg-red-100 dark:bg-red-500/10 px-4 py-3 text-sm text-red-800 dark:text-red-200">{error}</div>
      ) : null}

      {loading ? (
        <div className="liquid-glass rounded-2xl p-8 text-sm text-zinc-500">Cargando tablero de proyectos...</div>
      ) : data ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {orderedStatuses.map((status) => {
            const projects = data.grouped_projects[status] || [];
            return (
              <div
                key={status}
                className={[
                  "liquid-glass rounded-2xl p-5 flex flex-col h-[700px] transition-colors",
                  canChangeProjectStatus && dropTargetStatus === status ? "ring-2 ring-accent-500/60 bg-accent-500/5" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onDragOver={(event) => {
                  if (!canChangeProjectStatus || !draggingProject) {
                    return;
                  }
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                  setDropTargetStatus(status);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  void handleProjectDrop(status);
                }}
                onDragLeave={() => {
                  if (dropTargetStatus === status) {
                    setDropTargetStatus(null);
                  }
                }}
              >
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
                        draggable={canChangeProjectStatus}
                        onDragStart={(event) => handleProjectDragStart(event, project.id, status)}
                        onDragEnd={() => {
                          setDraggingProject(null);
                          setDropTargetStatus(null);
                        }}
                        className={[
                          "bg-black/5 dark:bg-black/40 border border-black/10 dark:border-white/10 rounded-xl p-4 group hover:border-accent-500/50 transition-colors flex flex-col gap-3",
                          canChangeProjectStatus ? "cursor-grab active:cursor-grabbing" : "",
                          draggingProject?.projectId === project.id || updatingProjectId === project.id ? "opacity-60" : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                      >
                        <div>
                          <h3 className="mb-1">
                            {isGuest ? (
                              <span className="text-left text-sm font-bold text-zinc-900 dark:text-white">{project.name}</span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => onNavigate(`/projects/${project.id}`)}
                                className="text-left text-sm font-bold text-zinc-900 dark:text-white group-hover:text-accent-600 dark:text-accent-500 dark:group-hover:text-accent-700 dark:text-accent-400 transition-colors"
                              >
                                {project.name}
                              </button>
                            )}
                          </h3>
                        </div>
                        <div className="flex items-center justify-between border-t border-black/5 dark:border-white/5 pt-3 mt-auto">
                          <div className="flex items-center gap-2 font-mono text-[10px] text-zinc-500">
                            <i className="ph-bold ph-stack" /> {project.instance_count} instancias
                          </div>
                          <div className="flex items-center gap-2">
                            {currentUser.permissions.project_create && !isGuest ? (
                              <button
                                type="button"
                                disabled={pendingProjectAction?.projectId === project.id}
                                className="h-7 w-7 bg-zinc-50 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 text-zinc-900 dark:text-white rounded text-[10px] font-semibold transition-colors border border-black/10 dark:border-white/10 disabled:opacity-50 inline-flex items-center justify-center"
                                onClick={() => void handleCopyProject(project)}
                                aria-label={`Copiar ${project.name}`}
                                title="Copiar proyecto"
                              >
                                <i
                                  className={`ph-bold ${
                                    pendingProjectAction?.projectId === project.id && pendingProjectAction.action === "copy"
                                      ? "ph-circle-notch animate-spin"
                                      : "ph-copy"
                                  }`}
                                />
                              </button>
                            ) : null}
                            <button
                              type="button"
                              disabled={!currentUser.permissions.project_edit}
                              className="px-3 py-1.5 bg-zinc-50 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-zinc-100 dark:hover:bg-white/10 text-zinc-900 dark:text-white rounded text-[10px] font-semibold transition-colors border border-black/10 dark:border-white/10 disabled:opacity-50 disabled:hover:bg-zinc-50 dark:disabled:hover:bg-white/5"
                              onClick={() => setSubtypeModal({ projectId: project.id, projectName: project.name })}
                              title={currentUser.permissions.project_edit ? "Administrar subtipos del proyecto" : "Este rol no puede editar subtipos del proyecto"}
                            >
                              Subtipos
                            </button>
                            <button
                              type="button"
                              className="px-3 py-1.5 bg-zinc-50 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 text-zinc-900 dark:text-white rounded text-[10px] font-semibold transition-colors border border-black/10 dark:border-white/10 flex items-center gap-1.5"
                              onClick={() => {
                                setDetailedMaterialQuantityBasis("factory");
                                setExportModal({ projectId: project.id, projectName: project.name });
                              }}
                              aria-label={`Exportar ${project.name}`}
                            >
                              <i className="ph-bold ph-file-arrow-down" />
                              Exportar
                            </button>
                            {currentUser.permissions.project_delete && !isGuest ? (
                              <button
                                type="button"
                                disabled={pendingProjectAction?.projectId === project.id}
                                className="h-7 w-7 bg-red-50 dark:bg-red-500/10 hover:bg-red-100 dark:hover:bg-red-500/20 text-red-700 dark:text-red-300 rounded text-[10px] font-semibold transition-colors border border-red-200 dark:border-red-500/20 disabled:opacity-50 inline-flex items-center justify-center"
                                onClick={() => void handleDeleteProject(project)}
                                aria-label={`Eliminar ${project.name}`}
                                title="Eliminar proyecto"
                              >
                                <i
                                  className={`ph-bold ${
                                    pendingProjectAction?.projectId === project.id && pendingProjectAction.action === "delete"
                                      ? "ph-circle-notch animate-spin"
                                      : "ph-trash"
                                  }`}
                                />
                              </button>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="text-center p-6 border border-dashed border-black/10 dark:border-white/10 rounded-xl text-xs font-mono text-zinc-500">
                      Sin proyectos
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      <Modal
        open={exportModal !== null}
        title={exportModal?.projectName || "Exportar proyecto"}
        kicker="Exportación"
        onClose={() => {
          if (exportingJob) {
            return;
          }
          setExportModal(null);
        }}
        panelClassName="max-w-2xl"
      >
        <div className="space-y-4">
          <div>
            <div className="mb-2 px-1 text-[10px] font-bold uppercase tracking-widest text-zinc-500">Documentos PDF</div>
            <div className="overflow-hidden rounded-xl border border-black/10 bg-white dark:border-white/10 dark:bg-white/[0.02]">
              <ExportRow
                kind="pdf"
                title="PDF Comercial"
                subtitle="Resumen para cliente."
                disabled={!exportModal || isExporting(exportModal!.projectId, "commercial_pdf")}
                loading={!!exportModal && isExporting(exportModal.projectId, "commercial_pdf")}
                onClick={() => void handleModalExport("commercial_pdf")}
              />
              <ExportRow
                kind="pdf"
                title="PDF Técnico Completo"
                subtitle="Ficha técnica completa."
                disabled={!exportModal || isExporting(exportModal!.projectId, "full_technical_pdf")}
                loading={!!exportModal && isExporting(exportModal.projectId, "full_technical_pdf")}
                onClick={() => void handleModalExport("full_technical_pdf")}
              />
              <div className="border-t border-black/5 dark:border-white/5">
                <div className="flex items-center gap-3 px-4 py-3">
                  <FileTypeIcon kind="pdf" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-zinc-900 dark:text-white">PDF Detallado de Materiales</div>
                    <div className="text-xs text-zinc-500 dark:text-zinc-400">
                      {exportModal && isExporting(exportModal.projectId, "detailed_material_pdf") ? "Generando..." : "Materiales, stock y OC."}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={!exportModal || isExporting(exportModal.projectId, "detailed_material_pdf")}
                    className="group inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-zinc-300 transition-colors hover:text-accent-500 disabled:opacity-50 dark:text-zinc-600"
                    onClick={() => void handleModalExport("detailed_material_pdf", { quantity_basis: detailedMaterialQuantityBasis })}
                    aria-label="Descargar PDF detallado de materiales"
                    title="Descargar PDF detallado de materiales"
                  >
                    <i
                      className={`ph-bold ${
                        exportModal && isExporting(exportModal.projectId, "detailed_material_pdf") ? "ph-circle-notch animate-spin text-accent-500" : "ph-download-simple"
                      } text-base`}
                    />
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-2 px-4 pb-3 pl-[68px] pr-14">
                  <div className="inline-flex rounded-lg border border-black/10 bg-zinc-100 p-0.5 dark:border-white/10 dark:bg-white/5" role="radiogroup" aria-label="Cantidad para PDF detallado de materiales">
                    {(["factory", "work", "total"] as const).map((basis) => (
                      <label
                        key={basis}
                        className={[
                          "cursor-pointer rounded-md px-3 py-1 text-xs font-semibold transition-colors",
                          detailedMaterialQuantityBasis === basis
                            ? "bg-white text-zinc-900 shadow-sm dark:bg-white/10 dark:text-white"
                            : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200",
                        ].join(" ")}
                      >
                        <input
                          type="radio"
                          name="detailed-material-quantity"
                          value={basis}
                          checked={detailedMaterialQuantityBasis === basis}
                          onChange={() => setDetailedMaterialQuantityBasis(basis)}
                          className="sr-only"
                        />
                        <DetailedMaterialQuantityLabel basis={basis} />
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div>
            <div className="mb-2 px-1 text-[10px] font-bold uppercase tracking-widest text-zinc-500">Hojas de Cálculo</div>
            <div className="overflow-hidden rounded-xl border border-black/10 bg-white dark:border-white/10 dark:bg-white/[0.02]">
              <ExportRow
                kind="xls"
                title="Libro de Materiales"
                subtitle="Totales y contexto."
                disabled={!exportModal || isExporting(exportModal!.projectId, "materials_workbook")}
                loading={!!exportModal && isExporting(exportModal.projectId, "materials_workbook")}
                onClick={() => void handleModalExport("materials_workbook", { group_by: "context" })}
              />
              {currentUser.permissions.cost_model_export ? (
                <ExportRow
                  kind="xls"
                  title="Libro de Modelo de Costos"
                  subtitle="Costos y fórmulas."
                  disabled={!exportModal || isExporting(exportModal!.projectId, "cost_model_workbook")}
                  loading={!!exportModal && isExporting(exportModal.projectId, "cost_model_workbook")}
                  onClick={() => void handleModalExport("cost_model_workbook")}
                />
              ) : null}
            </div>
          </div>
        </div>
      </Modal>

      <Modal
        open={createModalOpen}
        title="Crear Proyecto"
        kicker="Proyecto"
        onClose={() => {
          if (saving) {
            return;
          }
          setCreateModalOpen(false);
          setForm(initialProjectForm);
        }}
        panelClassName="max-w-lg"
      >
        <form className="flex flex-col gap-4" onSubmit={handleCreateProject}>
          <div className="space-y-3">
            <input
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              required
              placeholder="Nombre del proyecto"
              className="w-full bg-black/5 dark:bg-black/40 border border-black/10 dark:border-white/10 rounded-lg p-2.5 text-sm text-zinc-900 dark:text-zinc-200 focus:outline-none focus:border-accent-500/50 transition-all font-mono placeholder-zinc-500"
            />
            <select
              value={form.status}
              onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}
              className="w-full bg-black/5 dark:bg-zinc-900 border border-black/10 dark:border-white/10 rounded-lg p-2.5 text-sm text-zinc-900 dark:text-zinc-200 focus:outline-none focus:border-accent-500/50 transition-all font-mono"
            >
              <option value="template">Plantilla de Proyecto</option>
              <option value="execution">Proyecto en Ejecución</option>
              <option value="finished">Proyecto Terminado</option>
            </select>
          </div>
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2.5 bg-accent-500 hover:bg-accent-400 disabled:opacity-60 text-zinc-950 border border-transparent rounded-lg text-sm font-bold transition-all flex justify-center items-center gap-2"
            >
              <i className="ph-bold ph-plus" /> {saving ? "Creando..." : "Crear proyecto"}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={subtypeModal !== null}
        title={subtypeModal?.projectName || "Subtipos del Proyecto"}
        kicker="Administrador de Subtipos"
        onClose={() => setSubtypeModal(null)}
        panelClassName="max-w-3xl"
      >
        <div className="flex items-center justify-between gap-3 mb-4">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Administra la jerarquía de subtipos del proyecto desde el tablero en vez de hacerlo dentro del espacio del proyecto.
          </p>
          <button
            type="button"
            disabled={pendingSubtypeId === "root"}
            onClick={() => void handleCreateSubtype(null)}
            className="px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-zinc-50 dark:bg-white/5 text-xs font-semibold disabled:opacity-50"
          >
            Agregar subtipo raíz
          </button>
        </div>

        {subtypeLoading ? (
          <div className="rounded-xl border border-dashed border-black/10 dark:border-white/10 p-6 text-sm text-zinc-500">
            Cargando subtipos...
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
                No hay desglose de subtipos definido.
              </li>
            )}
          </ul>
        ) : (
          <div className="rounded-xl border border-dashed border-black/10 dark:border-white/10 p-6 text-sm text-zinc-500">
            No se pudieron cargar los subtipos.
          </div>
        )}
      </Modal>
    </div>
  );
}
