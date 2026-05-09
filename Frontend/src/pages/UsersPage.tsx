import { FormEvent, useEffect, useState } from "react";

import { ApiError, api } from "../lib/api";
import { normalizePageAccess } from "../lib/pageAccess";
import type { CreateUserRequest, ManagedUser, PageAccessMap, PageOption, RoleOption, UpdateUserRequest, UserDirectory } from "../lib/types";

type UsersPageProps = {
  currentUsername: string;
};

const initialCreateForm: CreateUserRequest = {
  username: "",
  display_name: "",
  email: "",
  password: "",
  role_codes: ["viewer"],
  is_active: true,
};

type EditFormState = {
  display_name: string;
  email: string;
  password: string;
  role_codes: string[];
  is_active: boolean;
};

function toEditForm(user: ManagedUser): EditFormState {
  return {
    display_name: user.display_name,
    email: user.email,
    password: "",
    role_codes: user.roles.filter((role) => role !== "sysadmin"),
    is_active: user.is_active,
  };
}

function toggleRoleSelection(roleCodes: string[], roleCode: string) {
  return roleCodes.includes(roleCode) ? roleCodes.filter((code) => code !== roleCode) : [...roleCodes, roleCode];
}

function RoleChecklist({
  roles,
  selectedRoleCodes,
  onToggle,
}: {
  roles: RoleOption[];
  selectedRoleCodes: string[];
  onToggle: (roleCode: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {roles.map((role) => (
        <label
          key={role.code}
          className="rounded-xl border border-black/10 dark:border-white/10 bg-black/5 dark:bg-black/30 p-3 text-sm flex gap-3 cursor-pointer"
        >
          <input
            type="checkbox"
            checked={selectedRoleCodes.includes(role.code)}
            onChange={() => onToggle(role.code)}
            className="mt-1"
          />
          <span>
            <span className="block font-semibold text-zinc-900 dark:text-zinc-100">{role.name}</span>
            <span className="block text-xs text-zinc-600 dark:text-zinc-400">{role.description}</span>
          </span>
        </label>
      ))}
    </div>
  );
}

function setPageAccess(access: PageAccessMap, pageKey: string, field: "can_read" | "can_edit", checked: boolean) {
  const current = access[pageKey] ?? { can_read: false, can_edit: false };
  const next = {
    ...access,
    [pageKey]: {
      ...current,
      [field]: checked,
    },
  };
  if (field === "can_edit" && checked) {
    next[pageKey].can_read = true;
  }
  if (field === "can_read" && !checked) {
    next[pageKey].can_edit = false;
  }
  return normalizePageAccess(next);
}

function buildRoleAccessDraft(roles: RoleOption[]) {
  return Object.fromEntries(roles.map((role) => [role.code, normalizePageAccess(role.page_access)]));
}

function PageAccessMatrix({
  pages,
  access,
  onChange,
}: {
  pages: PageOption[];
  access: PageAccessMap;
  onChange: (nextAccess: PageAccessMap) => void;
}) {
  const normalizedAccess = normalizePageAccess(access);

  return (
    <div className="overflow-hidden rounded-xl border border-black/10 dark:border-white/10">
      <div className="grid grid-cols-[minmax(0,1fr)_72px_72px] bg-black/5 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-zinc-500 dark:bg-white/5">
        <span>Pagina</span>
        <span className="text-center">Leer</span>
        <span className="text-center">Editar</span>
      </div>
      <div className="divide-y divide-black/10 dark:divide-white/10">
        {pages.map((page) => {
          const row = normalizedAccess[page.key] ?? { can_read: false, can_edit: false };
          return (
            <div key={page.key} className="grid grid-cols-[minmax(0,1fr)_72px_72px] items-center px-3 py-2 text-sm">
              <span className="truncate font-medium text-zinc-800 dark:text-zinc-200">{page.label}</span>
              <label className="flex justify-center">
                <input
                  type="checkbox"
                  checked={row.can_read}
                  onChange={(event) => onChange(setPageAccess(normalizedAccess, page.key, "can_read", event.target.checked))}
                />
              </label>
              <label className="flex justify-center">
                <input
                  type="checkbox"
                  checked={row.can_edit}
                  onChange={(event) => onChange(setPageAccess(normalizedAccess, page.key, "can_edit", event.target.checked))}
                />
              </label>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function UsersPage({ currentUsername }: UsersPageProps) {
  const [data, setData] = useState<UserDirectory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createForm, setCreateForm] = useState<CreateUserRequest>(initialCreateForm);
  const [createSaving, setCreateSaving] = useState(false);
  const [editingUserId, setEditingUserId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<EditFormState | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [roleAccessDraft, setRoleAccessDraft] = useState<Record<string, PageAccessMap>>({});
  const [roleAccessSaving, setRoleAccessSaving] = useState(false);

  async function loadUsers() {
    setLoading(true);
    setError(null);
    try {
      const nextData = await api.getUsers();
      setData(nextData);
      setRoleAccessDraft(buildRoleAccessDraft(nextData.roles));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudieron cargar los usuarios.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadUsers();
  }, []);

  async function handleCreateUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreateSaving(true);
    setError(null);
    try {
      await api.createUser(createForm);
      setCreateForm(initialCreateForm);
      await loadUsers();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo crear el usuario.");
    } finally {
      setCreateSaving(false);
    }
  }

  async function handleUpdateUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (editingUserId === null || editForm === null) {
      return;
    }
    setEditSaving(true);
    setError(null);
    try {
      const payload: UpdateUserRequest = {
        display_name: editForm.display_name,
        email: editForm.email,
        password: editForm.password || undefined,
        role_codes: editForm.role_codes,
        is_active: editForm.is_active,
      };
      await api.updateUser(editingUserId, payload);
      setEditingUserId(null);
      setEditForm(null);
      await loadUsers();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo actualizar el usuario.");
    } finally {
      setEditSaving(false);
    }
  }

  async function handleDeleteUser(userId: number) {
    const confirmed = window.confirm("¿Eliminar este usuario?");
    if (!confirmed) {
      return;
    }
    setError(null);
    try {
      await api.deleteUser(userId);
      if (editingUserId === userId) {
        setEditingUserId(null);
        setEditForm(null);
      }
      await loadUsers();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo eliminar el usuario.");
    }
  }

  async function handleSaveRoleAccess() {
    setRoleAccessSaving(true);
    setError(null);
    try {
      const nextData = await api.updateRolePageAccess({ role_access: roleAccessDraft });
      setData(nextData);
      setRoleAccessDraft(buildRoleAccessDraft(nextData.roles));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo actualizar el acceso por rol.");
    } finally {
      setRoleAccessSaving(false);
    }
  }

  return (
    <div className="max-w-[1600px] mx-auto flex flex-col gap-6">
      <div className="grid grid-cols-1 xl:grid-cols-[420px_minmax(0,1fr)] gap-6">
        <form className="liquid-glass rounded-2xl p-6 flex flex-col gap-4" onSubmit={handleCreateUser}>
          <div>
            <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2">Solo Sysadmin</p>
            <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">Editor de usuarios</h2>
            <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-2">
              Agrega cuentas internas, asigna roles alineados con el sistema anterior y mantén la cuenta reservada <span className="font-mono">sysadmin</span> como único punto de entrada para administración de usuarios.
            </p>
          </div>

          <div className="space-y-3">
            <input
              value={createForm.username}
              onChange={(event) => setCreateForm((current) => ({ ...current, username: event.target.value }))}
              placeholder="Usuario"
              className="w-full bg-black/5 dark:bg-black/40 border border-black/10 dark:border-white/10 rounded-xl p-3 text-sm focus:outline-none focus:border-accent-500/50"
            />
            <input
              value={createForm.display_name}
              onChange={(event) => setCreateForm((current) => ({ ...current, display_name: event.target.value }))}
              placeholder="Nombre visible"
              className="w-full bg-black/5 dark:bg-black/40 border border-black/10 dark:border-white/10 rounded-xl p-3 text-sm focus:outline-none focus:border-accent-500/50"
            />
            <input
              value={createForm.email}
              onChange={(event) => setCreateForm((current) => ({ ...current, email: event.target.value }))}
              placeholder="Correo"
              className="w-full bg-black/5 dark:bg-black/40 border border-black/10 dark:border-white/10 rounded-xl p-3 text-sm focus:outline-none focus:border-accent-500/50"
            />
            <input
              type="password"
              value={createForm.password}
              onChange={(event) => setCreateForm((current) => ({ ...current, password: event.target.value }))}
              placeholder="Contraseña"
              className="w-full bg-black/5 dark:bg-black/40 border border-black/10 dark:border-white/10 rounded-xl p-3 text-sm focus:outline-none focus:border-accent-500/50"
            />
          </div>

          {data ? (
            <RoleChecklist
              roles={data.roles}
              selectedRoleCodes={createForm.role_codes}
              onToggle={(roleCode) =>
                setCreateForm((current) => ({ ...current, role_codes: toggleRoleSelection(current.role_codes, roleCode) }))
              }
            />
          ) : null}

          <label className="inline-flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
            <input
              type="checkbox"
              checked={createForm.is_active}
              onChange={(event) => setCreateForm((current) => ({ ...current, is_active: event.target.checked }))}
            />
            Usuario activo
          </label>

          <button
            type="submit"
            disabled={createSaving}
            className="px-4 py-3 bg-accent-500 hover:bg-accent-400 disabled:opacity-60 text-zinc-950 border border-transparent rounded-xl text-sm font-bold transition-all"
          >
            {createSaving ? "Creando..." : "Crear usuario"}
          </button>
        </form>

        <section className="liquid-glass rounded-2xl p-6 flex flex-col gap-4 min-h-[600px]">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1">Directorio</p>
              <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">Usuarios internos</h2>
            </div>
            <button
              type="button"
              onClick={() => void loadUsers()}
              className="px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-zinc-50 dark:bg-white/5 text-xs font-semibold"
            >
              Actualizar
            </button>
          </div>

          {error ? (
            <div className="rounded-xl border border-red-200 dark:border-red-500/20 bg-red-100 dark:bg-red-500/10 px-4 py-3 text-sm text-red-800 dark:text-red-200">{error}</div>
          ) : null}

          {loading ? (
            <div className="rounded-2xl border border-dashed border-black/10 dark:border-white/10 p-6 text-sm text-zinc-500">Cargando usuarios...</div>
          ) : data ? (
            <div className="grid grid-cols-1 2xl:grid-cols-[minmax(0,1fr)_420px] gap-6">
              <div className="space-y-3">
                {data.users.map((user) => {
                  const isEditing = editingUserId === user.id;
                  return (
                    <div key={user.id} className="rounded-2xl border border-black/10 dark:border-white/10 bg-black/5 dark:bg-black/30 p-4 flex items-start justify-between gap-4">
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{user.display_name}</h3>
                          <span className="rounded-full border border-black/10 dark:border-white/10 px-2 py-0.5 text-[10px] font-mono uppercase tracking-widest text-zinc-500">
                            {user.username}
                          </span>
                          {!user.is_active ? (
                            <span className="rounded-full border border-amber-300/60 bg-amber-200/50 dark:bg-amber-500/10 px-2 py-0.5 text-[10px] font-mono uppercase tracking-widest text-amber-800 dark:text-amber-300">
                              Inactivo
                            </span>
                          ) : null}
                        </div>
                        <p className="text-sm text-zinc-600 dark:text-zinc-400">{user.email}</p>
                        <div className="flex flex-wrap gap-2">
                          {user.roles.map((role) => (
                            <span key={`${user.id}-${role}`} className="rounded-full border border-black/10 dark:border-white/10 bg-white/60 dark:bg-white/5 px-2 py-0.5 text-[10px] font-mono uppercase tracking-widest text-zinc-600 dark:text-zinc-300">
                              {role}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="flex gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingUserId(user.id);
                            setEditForm(toEditForm(user));
                          }}
                          className="px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-zinc-50 dark:bg-white/5 text-xs font-semibold"
                        >
                          Editar
                        </button>
                        {user.username !== "sysadmin" ? (
                          <button
                            type="button"
                            onClick={() => void handleDeleteUser(user.id)}
                            className="px-3 py-2 rounded-lg border border-red-200 dark:border-red-500/20 bg-red-100 dark:bg-red-500/10 text-xs font-semibold text-red-800 dark:text-red-200"
                          >
                            Eliminar
                          </button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="rounded-2xl border border-black/10 dark:border-white/10 bg-white/50 dark:bg-white/5 p-5">
                {editingUserId !== null && editForm ? (
                  <form className="flex flex-col gap-4" onSubmit={handleUpdateUser}>
                    <div>
                      <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1">Editar Usuario</p>
                      <h3 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
                        {data.users.find((user) => user.id === editingUserId)?.username}
                        {editingUserId !== null && data.users.find((user) => user.id === editingUserId)?.username === currentUsername ? " (sesión actual)" : ""}
                      </h3>
                    </div>

                    <input
                      value={editForm.display_name}
                      onChange={(event) => setEditForm((current) => (current ? { ...current, display_name: event.target.value } : current))}
                      placeholder="Nombre visible"
                      className="w-full bg-black/5 dark:bg-black/40 border border-black/10 dark:border-white/10 rounded-xl p-3 text-sm focus:outline-none focus:border-accent-500/50"
                    />
                    <input
                      value={editForm.email}
                      onChange={(event) => setEditForm((current) => (current ? { ...current, email: event.target.value } : current))}
                      placeholder="Correo"
                      className="w-full bg-black/5 dark:bg-black/40 border border-black/10 dark:border-white/10 rounded-xl p-3 text-sm focus:outline-none focus:border-accent-500/50"
                    />
                    <input
                      type="password"
                      value={editForm.password}
                      onChange={(event) => setEditForm((current) => (current ? { ...current, password: event.target.value } : current))}
                      placeholder="Nueva contraseña (dejar en blanco para conservar)"
                      className="w-full bg-black/5 dark:bg-black/40 border border-black/10 dark:border-white/10 rounded-xl p-3 text-sm focus:outline-none focus:border-accent-500/50"
                    />

                    <RoleChecklist
                      roles={data.roles}
                      selectedRoleCodes={editForm.role_codes}
                      onToggle={(roleCode) =>
                        setEditForm((current) =>
                          current ? { ...current, role_codes: toggleRoleSelection(current.role_codes, roleCode) } : current,
                        )
                      }
                    />

                    <label className="inline-flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                      <input
                        type="checkbox"
                        checked={editForm.is_active}
                        onChange={(event) => setEditForm((current) => (current ? { ...current, is_active: event.target.checked } : current))}
                      />
                      Usuario activo
                    </label>

                    <div className="flex gap-3">
                      <button
                        type="submit"
                        disabled={editSaving}
                        className="px-4 py-3 bg-accent-500 hover:bg-accent-400 disabled:opacity-60 text-zinc-950 border border-transparent rounded-xl text-sm font-bold transition-all"
                      >
                        {editSaving ? "Guardando..." : "Guardar cambios"}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingUserId(null);
                          setEditForm(null);
                        }}
                        className="px-4 py-3 rounded-xl border border-black/10 dark:border-white/10 bg-zinc-50 dark:bg-white/5 text-sm font-semibold"
                      >
                        Cancelar
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="h-full flex items-center justify-center text-center text-sm text-zinc-500 dark:text-zinc-400">
                    Selecciona un usuario para editar roles, estado de actividad o contraseña.
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </section>
      </div>

      {data ? (
        <section className="liquid-glass rounded-2xl p-6">
          <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-zinc-500">Acceso por rol</p>
              <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">Permisos de páginas</h2>
            </div>
            <button
              type="button"
              onClick={() => void handleSaveRoleAccess()}
              disabled={roleAccessSaving}
              className="rounded-xl bg-accent-500 px-4 py-3 text-sm font-bold text-zinc-950 disabled:opacity-60"
            >
              {roleAccessSaving ? "Guardando..." : "Guardar accesos"}
            </button>
          </div>
          <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
            {data.roles.map((role) => (
              <div key={role.code} className="rounded-xl border border-black/10 bg-black/5 p-4 dark:border-white/10 dark:bg-black/30">
                <div className="mb-3">
                  <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">{role.name}</h3>
                  <p className="mt-1 text-xs text-zinc-500">{role.description}</p>
                </div>
                <PageAccessMatrix
                  pages={data.pages}
                  access={roleAccessDraft[role.code] ?? normalizePageAccess(role.page_access)}
                  onChange={(pageAccess) =>
                    setRoleAccessDraft((current) => ({
                      ...current,
                      [role.code]: pageAccess,
                    }))
                  }
                />
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
