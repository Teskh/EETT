import { useEffect, useState } from "react";

import { Modal } from "./Modal";
import { ApiError, api } from "../lib/api";
import type { CatalogMaterialSearchResult, MaterialStudyGroupPayload, MaterialStudyGroupRow } from "../lib/types";

type EditableMember = {
  localId: string;
  sku: string;
  material_name: string;
  unit: string | null;
  factor_to_study_unit: string;
};

type EditorState = {
  name: string;
  description: string;
  study_unit: string;
  members: EditableMember[];
};

type MaterialStudyGroupEditorProps = {
  open: boolean;
  groups: MaterialStudyGroupRow[];
  onClose: () => void;
  onChanged: (groupId: number | null) => void;
};

function createMemberId() {
  return `member-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function buildEditorState(group: MaterialStudyGroupRow | null): EditorState {
  if (!group) {
    return {
      name: "",
      description: "",
      study_unit: "",
      members: [],
    };
  }
  return {
    name: group.name,
    description: group.description || "",
    study_unit: group.study_unit,
    members: group.members.map((member) => ({
      localId: createMemberId(),
      sku: member.sku,
      material_name: member.material_name,
      unit: member.unit,
      factor_to_study_unit: String(member.factor_to_study_unit),
    })),
  };
}

function toPayload(state: EditorState): MaterialStudyGroupPayload {
  return {
    name: state.name.trim(),
    description: state.description.trim() || null,
    study_unit: state.study_unit.trim(),
    members: state.members.map((member) => ({
      sku: member.sku.trim().toUpperCase(),
      material_name: member.material_name.trim() || member.sku.trim().toUpperCase(),
      unit: member.unit?.trim() || null,
      factor_to_study_unit: Number(member.factor_to_study_unit),
    })),
  };
}

export function MaterialStudyGroupEditor({ open, groups, onClose, onChanged }: MaterialStudyGroupEditorProps) {
  const [editingGroupId, setEditingGroupId] = useState<number | "new" | null>(null);
  const [editorState, setEditorState] = useState<EditorState>(() => buildEditorState(null));
  const [searchValue, setSearchValue] = useState("");
  const [searchResults, setSearchResults] = useState<CatalogMaterialSearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const defaultGroup = groups[0] || null;
    setEditingGroupId(defaultGroup ? defaultGroup.group_id : "new");
    setEditorState(buildEditorState(defaultGroup));
    setSearchValue("");
    setSearchResults([]);
    setError(null);
  }, [groups, open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const normalized = searchValue.trim();
    if (normalized.length < 2) {
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }
    let cancelled = false;
    setSearchLoading(true);
    const timeoutId = window.setTimeout(async () => {
      try {
        const response = await api.searchCatalogMaterials(normalized, 8);
        if (!cancelled) {
          setSearchResults(response.results);
        }
      } catch {
        if (!cancelled) {
          setSearchResults([]);
        }
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
  }, [open, searchValue]);

  const selectedGroup = editingGroupId && editingGroupId !== "new" ? groups.find((group) => group.group_id === editingGroupId) || null : null;
  const existingSkuSet = new Set(editorState.members.map((member) => member.sku.trim().toUpperCase()).filter(Boolean));
  const visibleSearchResults = searchResults.filter((result) => !existingSkuSet.has(result.sku.trim().toUpperCase()));

  function selectGroup(groupId: number | "new") {
    setEditingGroupId(groupId);
    setEditorState(buildEditorState(groupId === "new" ? null : groups.find((group) => group.group_id === groupId) || null));
    setSearchValue("");
    setSearchResults([]);
    setError(null);
  }

  function updateMember(localId: string, patch: Partial<EditableMember>) {
    setEditorState((current) => ({
      ...current,
      members: current.members.map((member) => (member.localId === localId ? { ...member, ...patch } : member)),
    }));
  }

  function addMember(result: CatalogMaterialSearchResult) {
    const normalizedSku = result.sku.trim().toUpperCase();
    setEditorState((current) => {
      if (current.members.some((member) => member.sku === normalizedSku)) {
        return current;
      }
      return {
        ...current,
        members: [
          ...current.members,
          {
            localId: createMemberId(),
            sku: normalizedSku,
            material_name: result.name,
            unit: result.unit,
            factor_to_study_unit: "1",
          },
        ],
      };
    });
    setSearchValue("");
    setSearchResults([]);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const payload = toPayload(editorState);
      const response =
        editingGroupId && editingGroupId !== "new"
          ? await api.updateMaterialStudyGroup(editingGroupId, payload)
          : await api.createMaterialStudyGroup(payload);
      onChanged(response.group_id);
      selectGroup(response.group_id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo guardar el grupo de materiales.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!selectedGroup || !window.confirm(`¿Eliminar el grupo "${selectedGroup.name}"?`)) {
      return;
    }
    setDeleting(true);
    setError(null);
    try {
      await api.deleteMaterialStudyGroup(selectedGroup.group_id);
      onChanged(null);
      selectGroup("new");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo eliminar el grupo de materiales.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Modal open={open} title="Grupos de Materiales" kicker="Editor de Grupos" onClose={onClose} panelClassName="max-w-6xl">
      <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="rounded-2xl border border-black/10 dark:border-white/10 bg-zinc-50/70 p-4 dark:bg-white/[0.03]">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h4 className="text-sm font-semibold text-zinc-900 dark:text-white">Grupos guardados</h4>
              <p className="mt-1 text-xs text-zinc-500">{groups.length} estudios compartidos</p>
            </div>
            <button
              type="button"
              onClick={() => selectGroup("new")}
              className="rounded-lg border border-black/10 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-900 transition-colors hover:bg-zinc-100 dark:border-white/10 dark:bg-white/5 dark:text-white dark:hover:bg-white/10"
            >
              Nuevo
            </button>
          </div>

          <div className="mt-4 space-y-2">
            {groups.length ? (
              groups.map((group) => {
                const active = editingGroupId === group.group_id;
                return (
                  <button
                    key={group.group_id}
                    type="button"
                    onClick={() => selectGroup(group.group_id)}
                    className={`w-full rounded-xl border px-3 py-3 text-left transition-colors ${
                      active
                        ? "border-accent-500/50 bg-accent-50 text-zinc-900 dark:border-accent-500/50 dark:bg-accent-500/10 dark:text-white"
                        : "border-black/10 bg-white text-zinc-700 hover:bg-zinc-100 dark:border-white/10 dark:bg-white/[0.03] dark:text-zinc-300 dark:hover:bg-white/[0.06]"
                    }`}
                  >
                    <div className="text-sm font-semibold">{group.name}</div>
                    <div className="mt-1 text-[11px] text-zinc-500">{group.member_count} miembros • {group.study_unit}</div>
                  </button>
                );
              })
            ) : (
              <div className="rounded-xl border border-dashed border-black/10 px-3 py-6 text-sm text-zinc-500 dark:border-white/10">
                Aún no hay grupos.
              </div>
            )}
          </div>
        </aside>

        <section className="space-y-5">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">Nombre</span>
              <input
                value={editorState.name}
                onChange={(event) => setEditorState((current) => ({ ...current, name: event.target.value }))}
                className="w-full rounded-xl border border-black/10 bg-white px-4 py-3 text-sm text-zinc-900 outline-none transition-colors focus:border-accent-500 dark:border-white/10 dark:bg-black/20 dark:text-white"
                placeholder="Insulation group"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">Unidad de Estudio</span>
              <input
                value={editorState.study_unit}
                onChange={(event) => setEditorState((current) => ({ ...current, study_unit: event.target.value }))}
                className="w-full rounded-xl border border-black/10 bg-white px-4 py-3 text-sm text-zinc-900 outline-none transition-colors focus:border-accent-500 dark:border-white/10 dark:bg-black/20 dark:text-white"
                placeholder="m2"
              />
            </label>
          </div>

          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">Descripción</span>
            <textarea
              value={editorState.description}
              onChange={(event) => setEditorState((current) => ({ ...current, description: event.target.value }))}
              rows={3}
              className="w-full rounded-xl border border-black/10 bg-white px-4 py-3 text-sm text-zinc-900 outline-none transition-colors focus:border-accent-500 dark:border-white/10 dark:bg-black/20 dark:text-white"
              placeholder="Explica cómo se debe interpretar la unidad normalizada."
            />
          </label>

          <div className="rounded-2xl border border-black/10 dark:border-white/10">
            <div className="border-b border-black/10 px-4 py-3 dark:border-white/10">
              <h4 className="text-sm font-semibold text-zinc-900 dark:text-white">Miembros</h4>
              <p className="mt-1 text-xs text-zinc-500">Cada factor significa que 1 unidad de origen equivale a X unidades de estudio.</p>
            </div>

            <div className="p-4">
              <div className="relative">
                <input
                  value={searchValue}
                  onChange={(event) => setSearchValue(event.target.value)}
                  className="w-full rounded-xl border border-black/10 bg-white px-4 py-3 text-sm text-zinc-900 outline-none transition-colors focus:border-accent-500 dark:border-white/10 dark:bg-black/20 dark:text-white"
                  placeholder="Buscar SKU o nombre de material para agregar"
                />
                {(searchLoading || visibleSearchResults.length > 0) && searchValue.trim().length >= 2 ? (
                  <div className="absolute z-10 mt-2 w-full overflow-hidden rounded-2xl border border-black/10 bg-white shadow-xl dark:border-white/10 dark:bg-zinc-900">
                    {searchLoading ? (
                      <div className="px-4 py-3 text-sm text-zinc-500">Buscando...</div>
                    ) : !visibleSearchResults.length ? (
                      <div className="px-4 py-3 text-sm text-zinc-500">Todos los SKU coincidentes ya están en este grupo.</div>
                    ) : (
                      visibleSearchResults.map((result) => (
                        <button
                          key={`${result.source}-${result.sku}`}
                          type="button"
                          onClick={() => addMember(result)}
                          className="flex w-full items-center justify-between gap-4 border-b border-black/5 px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-zinc-50 dark:border-white/5 dark:hover:bg-white/5"
                        >
                          <div>
                            <div className="text-sm font-semibold text-zinc-900 dark:text-white">{result.name}</div>
                            <div className="mt-1 text-[11px] text-zinc-500">
                              {result.sku}
                              {result.unit ? ` • ${result.unit}` : ""}
                            </div>
                          </div>
                          <span className="rounded-full border border-black/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500 dark:border-white/10">
                            Agregar
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                ) : null}
              </div>

              <div className="mt-4 space-y-3">
                {editorState.members.length ? (
                  editorState.members.map((member) => (
                    <div
                      key={member.localId}
                      className="grid gap-3 rounded-2xl border border-black/10 bg-zinc-50/70 px-4 py-4 dark:border-white/10 dark:bg-white/[0.03] md:grid-cols-[minmax(0,1fr)_120px_auto]"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-zinc-900 dark:text-white">{member.material_name}</span>
                          <span className="rounded-full border border-black/10 px-2 py-0.5 font-mono text-[10px] text-zinc-500 dark:border-white/10">
                            {member.sku}
                          </span>
                        </div>
                        <div className="mt-1 text-xs text-zinc-500">{member.unit || "Sin unidad"}</div>
                      </div>
                      <label className="block">
                        <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">Factor</span>
                        <input
                          type="number"
                          min="0.0001"
                          step="0.0001"
                          value={member.factor_to_study_unit}
                          onChange={(event) => updateMember(member.localId, { factor_to_study_unit: event.target.value })}
                          className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-right text-sm text-zinc-900 outline-none transition-colors focus:border-accent-500 dark:border-white/10 dark:bg-black/20 dark:text-white"
                        />
                      </label>
                      <div className="flex items-end justify-end">
                        <button
                          type="button"
                          onClick={() =>
                            setEditorState((current) => ({
                              ...current,
                              members: current.members.filter((currentMember) => currentMember.localId !== member.localId),
                            }))
                          }
                          className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 transition-colors hover:bg-red-100 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200 dark:hover:bg-red-500/20"
                        >
                          Eliminar
                        </button>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="rounded-2xl border border-dashed border-black/10 px-4 py-8 text-sm text-zinc-500 dark:border-white/10">
                    Agrega al menos un SKU para definir el grupo.
                  </div>
                )}
              </div>
            </div>
          </div>

          {error ? (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200">
              {error}
            </div>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs text-zinc-500">
              Las métricas del grupo se normalizan solo para análisis. Los campos de compras quedan intencionalmente en blanco.
            </div>
            <div className="flex gap-3">
              {selectedGroup ? (
                <button
                  type="button"
                  onClick={() => void handleDelete()}
                  disabled={deleting || saving}
                  className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700 transition-colors hover:bg-red-100 disabled:opacity-60 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200 dark:hover:bg-red-500/20"
                >
                  {deleting ? "Eliminando..." : "Eliminar"}
                </button>
              ) : null}
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl border border-black/10 bg-white px-4 py-3 text-sm font-semibold text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-white/10 dark:bg-white/5 dark:text-zinc-200 dark:hover:bg-white/10"
              >
                Cerrar
              </button>
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={saving || deleting}
                className="rounded-xl bg-accent-500 px-4 py-3 text-sm font-semibold text-zinc-950 transition-colors hover:bg-accent-400 disabled:opacity-60"
              >
                {saving ? "Guardando..." : selectedGroup ? "Guardar cambios" : "Crear grupo"}
              </button>
            </div>
          </div>
        </section>
      </div>
    </Modal>
  );
}
