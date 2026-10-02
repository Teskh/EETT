import { FormEvent, useEffect, useMemo, useState } from "react";

import { Modal } from "../components/Modal";
import { ApiError, api } from "../lib/api";
import { normalizePageAccess } from "../lib/pageAccess";
import type { CreateUserRequest, ManagedUser, PageAccessMap, PageOption, RoleOption, UpdateUserRequest, UserDirectory } from "../lib/types";
import {
  ConfirmDialog,
  FieldLabel,
  Notice,
  type NoticeState,
  Switch,
  inputClassName,
  primaryButtonClassName,
  secondaryButtonClassName,
} from "./settings/ui";

type UsersPageProps = {
  currentUsername: string;
};

const initialCreateForm: CreateUserRequest = {
  username: "",
  display_name: "",
  email: "",
  password: "",
  role_codes: ["guest"],
  is_active: true,
};

type EditFormState = {
  display_name: string;
  email: string;
  password: string;
  role_codes: string[];
  is_active: boolean;
};

type AccessLevel = "none" | "read" | "edit";

const ACCESS_LEVELS: Array<{ key: AccessLevel; label: string }> = [
  { key: "none", label: "Sin acceso" },
  { key: "read", label: "Leer" },
  { key: "edit", label: "Editar" },
];

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
  if (roleCodes.includes(roleCode)) {
    return roleCodes.filter((code) => code !== roleCode);
  }
  if (roleCode === "guest") {
    return ["guest"];
  }
  return [...roleCodes.filter((code) => code !== "guest"), roleCode];
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "?";
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
    <fieldset>
      <legend className="mb-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-400">Roles</legend>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {roles.map((role) => {
          const checked = selectedRoleCodes.includes(role.code);
          return (
            <label
              key={role.code}
              className={`flex cursor-pointer gap-3 rounded-xl border p-3 text-sm transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent-500 ${
                checked
                  ? "border-accent-500/60 bg-accent-500/[0.08]"
                  : "border-black/10 hover:bg-black/[0.03] dark:border-white/10 dark:hover:bg-white/[0.03]"
              }`}
            >
              <input type="checkbox" checked={checked} onChange={() => onToggle(role.code)} className="sr-only" />
              <span
                aria-hidden="true"
                className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                  checked ? "border-accent-500 bg-accent-500 text-zinc-950" : "border-zinc-300 dark:border-zinc-600"
                }`}
              >
                {checked ? <i className="ph-bold ph-check text-[10px]" /> : null}
              </span>
              <span>
                <span className="block font-semibold text-zinc-900 dark:text-zinc-100">{role.name}</span>
                <span className="block text-xs text-zinc-500 dark:text-zinc-400">{role.description}</span>
              </span>
            </label>
          );
        })}
      </div>
      {selectedRoleCodes.includes("guest") ? (
        <p className="mt-2 text-xs text-zinc-500">El rol Invitado no se puede combinar con otros roles.</p>
      ) : null}
    </fieldset>
  );
}

function accessLevelOf(row: { can_read: boolean; can_edit: boolean } | undefined): AccessLevel {
  if (row?.can_edit) {
    return "edit";
  }
  return row?.can_read ? "read" : "none";
}

function setPageAccessLevel(access: PageAccessMap, pageKey: string, level: AccessLevel) {
  return normalizePageAccess({
    ...access,
    [pageKey]: { can_read: level !== "none", can_edit: level === "edit" },
  });
}

function buildRoleAccessDraft(roles: RoleOption[]) {
  return Object.fromEntries(roles.map((role) => [role.code, normalizePageAccess(role.page_access)]));
}

function AccessLevelPicker({
  value,
  onChange,
  readOnly,
  label,
}: {
  value: AccessLevel;
  onChange: (level: AccessLevel) => void;
  readOnly: boolean;
  label: string;
}) {
  if (readOnly) {
    return (
      <span className={`text-xs font-medium ${value === "none" ? "text-zinc-400" : "text-zinc-700 dark:text-zinc-300"}`}>
        {ACCESS_LEVELS.find((level) => level.key === value)?.label}
      </span>
    );
  }
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg border border-black/10 bg-zinc-100 p-0.5 dark:border-white/10 dark:bg-black/30">
      {ACCESS_LEVELS.map((level) => {
        const selected = value === level.key;
        return (
          <button
            key={level.key}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(level.key)}
            className={`rounded-md px-2 py-1 text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 ${
              selected
                ? level.key === "none"
                  ? "bg-white text-zinc-600 shadow-sm dark:bg-zinc-700 dark:text-zinc-200"
                  : level.key === "read"
                    ? "bg-zinc-800 text-white shadow-sm dark:bg-zinc-200 dark:text-zinc-900"
                    : "bg-accent-500 text-zinc-950 shadow-sm"
                : "text-zinc-400 hover:text-zinc-800 dark:text-zinc-500 dark:hover:text-zinc-200"
            }`}
          >
            {level.label}
          </button>
        );
      })}
    </div>
  );
}

function PageAccessMatrix({
  pages,
  roles,
  draft,
  onChange,
}: {
  pages: PageOption[];
  roles: RoleOption[];
  draft: Record<string, PageAccessMap>;
  onChange: (roleCode: string, nextAccess: PageAccessMap) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-black/10 dark:border-white/10">
      <table className="w-full min-w-[720px] border-collapse text-sm">
        <thead>
          <tr className="bg-black/[0.03] dark:bg-white/[0.03]">
            <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-zinc-500">
              Página
            </th>
            {roles.map((role) => (
              <th key={role.code} scope="col" className="px-3 py-3 text-left align-bottom">
                <span className="flex items-center gap-1.5 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  {role.name}
                  {!role.page_access_editable ? <i className="ph-bold ph-lock-simple text-xs text-zinc-400" title="Accesos fijos para este rol" /> : null}
                </span>
                <span className="block text-xs font-normal text-zinc-500">{role.description}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-black/[0.07] dark:divide-white/[0.07]">
          {pages.map((page) => (
            <tr key={page.key}>
              <th scope="row" className="px-4 py-2.5 text-left font-medium text-zinc-800 dark:text-zinc-200">
                {page.label}
              </th>
              {roles.map((role) => {
                const access = draft[role.code] ?? normalizePageAccess(role.page_access);
                return (
                  <td key={role.code} className="px-3 py-2.5">
                    <AccessLevelPicker
                      label={`${role.name}: ${page.label}`}
                      value={accessLevelOf(access[page.key])}
                      readOnly={!role.page_access_editable}
                      onChange={(level) => onChange(role.code, setPageAccessLevel(access, page.key, level))}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function UsersPage({ currentUsername }: UsersPageProps) {
  const [data, setData] = useState<UserDirectory | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<NoticeState>(null);
  const [query, setQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<CreateUserRequest>(initialCreateForm);
  const [createSaving, setCreateSaving] = useState(false);
  const [editingUserId, setEditingUserId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<EditFormState | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ManagedUser | null>(null);
  const [roleAccessDraft, setRoleAccessDraft] = useState<Record<string, PageAccessMap>>({});
  const [roleAccessSaving, setRoleAccessSaving] = useState(false);

  async function loadUsers() {
    setLoading(true);
    try {
      const nextData = await api.getUsers();
      setData(nextData);
      setRoleAccessDraft(buildRoleAccessDraft(nextData.roles));
    } catch (err) {
      setNotice({ tone: "error", text: err instanceof ApiError ? err.message : "No se pudieron cargar los usuarios." });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadUsers();
  }, []);

  const roleNames = useMemo(() => new Map((data?.roles ?? []).map((role) => [role.code, role.name])), [data]);
  const editingUser = data?.users.find((user) => user.id === editingUserId) ?? null;
  const roleAccessDirty = useMemo(
    () => (data ? JSON.stringify(roleAccessDraft) !== JSON.stringify(buildRoleAccessDraft(data.roles)) : false),
    [data, roleAccessDraft],
  );

  const filteredUsers = useMemo(() => {
    const users = data?.users ?? [];
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return users;
    }
    return users.filter((user) =>
      [user.display_name, user.username, user.email].some((value) => value?.toLowerCase().includes(needle)),
    );
  }, [data, query]);

  function openCreate() {
    setCreateForm(initialCreateForm);
    setFormError(null);
    setCreateOpen(true);
  }

  function openEdit(user: ManagedUser) {
    setEditingUserId(user.id);
    setEditForm(toEditForm(user));
    setFormError(null);
  }

  function closeEdit() {
    setEditingUserId(null);
    setEditForm(null);
  }

  async function handleCreateUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreateSaving(true);
    setFormError(null);
    try {
      // Password is optional: Microsoft-only accounts are created without one.
      const created = await api.createUser({ ...createForm, password: createForm.password || undefined });
      setCreateForm(initialCreateForm);
      setCreateOpen(false);
      setNotice({ tone: "success", text: `Usuario ${created?.username ?? createForm.username} creado.` });
      await loadUsers();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "No se pudo crear el usuario.");
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
    setFormError(null);
    try {
      const payload: UpdateUserRequest = {
        display_name: editForm.display_name,
        email: editForm.email,
        password: editForm.password || undefined,
        role_codes: editForm.role_codes,
        is_active: editForm.is_active,
      };
      await api.updateUser(editingUserId, payload);
      closeEdit();
      setNotice({ tone: "success", text: "Cambios guardados." });
      await loadUsers();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "No se pudo actualizar el usuario.");
    } finally {
      setEditSaving(false);
    }
  }

  async function handleDeleteUser(user: ManagedUser) {
    setDeleteTarget(null);
    setNotice(null);
    try {
      await api.deleteUser(user.id);
      if (editingUserId === user.id) {
        closeEdit();
      }
      setNotice({ tone: "success", text: `Usuario ${user.username} eliminado.` });
      await loadUsers();
    } catch (err) {
      setNotice({ tone: "error", text: err instanceof ApiError ? err.message : "No se pudo eliminar el usuario." });
    }
  }

  async function handleSaveRoleAccess() {
    setRoleAccessSaving(true);
    setNotice(null);
    try {
      const editableRoleCodes = new Set(data?.roles.filter((role) => role.page_access_editable).map((role) => role.code) ?? []);
      const editableRoleAccess = Object.fromEntries(
        Object.entries(roleAccessDraft).filter(([roleCode]) => editableRoleCodes.has(roleCode)),
      );
      const nextData = await api.updateRolePageAccess({ role_access: editableRoleAccess });
      setData(nextData);
      setRoleAccessDraft(buildRoleAccessDraft(nextData.roles));
      setNotice({ tone: "success", text: "Permisos de páginas guardados." });
    } catch (err) {
      setNotice({ tone: "error", text: err instanceof ApiError ? err.message : "No se pudo actualizar el acceso por rol." });
    } finally {
      setRoleAccessSaving(false);
    }
  }

  const formErrorBox = formError ? (
    <Notice notice={{ tone: "error", text: formError }} onDismiss={() => setFormError(null)} />
  ) : null;

  return (
    <div className="flex w-full flex-col gap-6">
      <Notice notice={notice} onDismiss={() => setNotice(null)} />

      <section className="liquid-glass rounded-2xl p-5 sm:p-6">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              Usuarios
              {data ? <span className="ml-2 text-sm font-normal text-zinc-500">{data.users.length}</span> : null}
            </h2>
            <p className="mt-1 text-sm text-zinc-500">
              Cuentas internas y sus roles. La administración de usuarios queda reservada a la cuenta <span className="font-mono">sysadmin</span>.
            </p>
          </div>
          <div className="flex w-full flex-wrap gap-2 sm:w-auto">
            <div className="relative min-w-0 flex-1 sm:w-64 sm:flex-none">
              <i className="ph-bold ph-magnifying-glass pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar usuarios"
                aria-label="Buscar usuarios"
                className={`${inputClassName} pl-9`}
              />
            </div>
            <button type="button" onClick={() => void loadUsers()} disabled={loading} className={secondaryButtonClassName} aria-label="Actualizar lista" title="Actualizar lista">
              <i className={`ph-bold ph-arrows-clockwise ${loading && data ? "animate-spin" : ""}`} />
            </button>
            <button type="button" onClick={openCreate} disabled={!data} className={primaryButtonClassName}>
              <i className="ph-bold ph-user-plus" />
              Nuevo usuario
            </button>
          </div>
        </div>

        {loading && !data ? (
          <div className="rounded-xl border border-dashed border-black/10 p-6 text-sm text-zinc-500 dark:border-white/10">Cargando usuarios...</div>
        ) : data ? (
          <ul className="divide-y divide-black/[0.07] overflow-hidden rounded-xl border border-black/10 dark:divide-white/[0.07] dark:border-white/10">
            {filteredUsers.length === 0 ? (
              <li className="px-4 py-8 text-center text-sm text-zinc-500">Ningún usuario coincide con “{query}”.</li>
            ) : null}
            {filteredUsers.map((user) => (
              <li
                key={user.id}
                className={`flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3 transition-colors hover:bg-black/[0.02] dark:hover:bg-white/[0.02] ${
                  user.is_active ? "" : "opacity-70"
                }`}
              >
                <span
                  aria-hidden="true"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-xs font-semibold text-zinc-700 dark:bg-white/10 dark:text-zinc-200"
                >
                  {initials(user.display_name || user.username)}
                </span>
                <div className="min-w-0 flex-1 basis-56">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">{user.display_name}</span>
                    <span className="font-mono text-xs text-zinc-500">@{user.username}</span>
                    {user.username === currentUsername ? (
                      <span className="rounded-full bg-accent-500/15 px-2 py-0.5 text-[10px] font-semibold text-accent-900 dark:text-accent-400">Tú</span>
                    ) : null}
                    {!user.is_active ? (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
                        Inactivo
                      </span>
                    ) : null}
                    {user.is_auto_provisioned ? (
                      <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold text-sky-800 dark:bg-sky-500/10 dark:text-sky-300">
                        Microsoft · Auto
                      </span>
                    ) : null}
                  </div>
                  <div className="truncate text-xs text-zinc-500">{user.email}</div>
                </div>
                <div className="flex min-w-0 basis-48 flex-wrap gap-1.5">
                  {user.roles.map((role) => (
                    <span
                      key={`${user.id}-${role}`}
                      className="rounded-md border border-black/10 bg-white/60 px-2 py-0.5 text-xs text-zinc-700 dark:border-white/10 dark:bg-white/5 dark:text-zinc-300"
                    >
                      {roleNames.get(role) ?? role}
                    </span>
                  ))}
                </div>
                <div className="ml-auto flex shrink-0 gap-1">
                  <button type="button" onClick={() => openEdit(user)} className={`${secondaryButtonClassName} px-3 py-1.5 text-xs`}>
                    <i className="ph-bold ph-pencil-simple" />
                    Editar
                  </button>
                  {user.username !== "sysadmin" ? (
                    <button
                      type="button"
                      onClick={() => setDeleteTarget(user)}
                      aria-label={`Eliminar ${user.username}`}
                      title="Eliminar usuario"
                      className="inline-flex items-center justify-center rounded-xl px-2.5 py-1.5 text-sm text-zinc-400 transition-colors hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 dark:hover:bg-red-500/10 dark:hover:text-red-400"
                    >
                      <i className="ph-bold ph-trash" />
                    </button>
                  ) : (
                    <span className="w-[34px]" />
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {data ? (
        <section className="liquid-glass rounded-2xl p-5 sm:p-6">
          <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Permisos por rol</h2>
              <p className="mt-1 text-sm text-zinc-500">Qué puede ver y editar cada rol. Un usuario con varios roles suma sus permisos.</p>
            </div>
            <div className="flex gap-2">
              {roleAccessDirty ? (
                <button type="button" onClick={() => setRoleAccessDraft(buildRoleAccessDraft(data.roles))} disabled={roleAccessSaving} className={secondaryButtonClassName}>
                  Descartar
                </button>
              ) : null}
              <button type="button" onClick={() => void handleSaveRoleAccess()} disabled={roleAccessSaving || !roleAccessDirty} className={primaryButtonClassName}>
                {roleAccessSaving ? "Guardando..." : roleAccessDirty ? "Guardar permisos" : "Sin cambios"}
              </button>
            </div>
          </div>
          <PageAccessMatrix
            pages={data.pages}
            roles={data.roles}
            draft={roleAccessDraft}
            onChange={(roleCode, pageAccess) =>
              setRoleAccessDraft((current) => ({
                ...current,
                [roleCode]: pageAccess,
              }))
            }
          />
        </section>
      ) : null}

      <Modal open={createOpen} kicker="Usuarios" kickerIcon={<i className="ph-bold ph-user-plus" />} title="Nuevo usuario" onClose={() => setCreateOpen(false)}>
        <form className="flex flex-col gap-4" onSubmit={handleCreateUser}>
          {formErrorBox}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FieldLabel label="Usuario">
              <input
                autoFocus
                value={createForm.username}
                onChange={(event) => setCreateForm((current) => ({ ...current, username: event.target.value }))}
                className={inputClassName}
              />
            </FieldLabel>
            <FieldLabel label="Nombre visible">
              <input
                value={createForm.display_name}
                onChange={(event) => setCreateForm((current) => ({ ...current, display_name: event.target.value }))}
                className={inputClassName}
              />
            </FieldLabel>
            <FieldLabel label="Correo">
              <input
                value={createForm.email}
                onChange={(event) => setCreateForm((current) => ({ ...current, email: event.target.value }))}
                className={inputClassName}
              />
            </FieldLabel>
            <FieldLabel label="Contraseña" hint="Opcional. Las cuentas Microsoft no la usan.">
              <input
                type="password"
                autoComplete="new-password"
                value={createForm.password}
                onChange={(event) => setCreateForm((current) => ({ ...current, password: event.target.value }))}
                className={inputClassName}
              />
            </FieldLabel>
          </div>
          {data ? (
            <RoleChecklist
              roles={data.roles}
              selectedRoleCodes={createForm.role_codes}
              onToggle={(roleCode) => setCreateForm((current) => ({ ...current, role_codes: toggleRoleSelection(current.role_codes, roleCode) }))}
            />
          ) : null}
          <Switch
            label="Usuario activo"
            description="Los usuarios inactivos no pueden iniciar sesión."
            checked={createForm.is_active}
            onChange={(checked) => setCreateForm((current) => ({ ...current, is_active: checked }))}
          />
          <div className="flex justify-end gap-2 border-t border-black/10 pt-4 dark:border-white/10">
            <button type="button" onClick={() => setCreateOpen(false)} className={secondaryButtonClassName}>
              Cancelar
            </button>
            <button type="submit" disabled={createSaving} className={primaryButtonClassName}>
              {createSaving ? "Creando..." : "Crear usuario"}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={editingUserId !== null && editForm !== null}
        kicker="Editar usuario"
        title={
          <span className="flex items-center gap-2">
            {editingUser?.display_name || editingUser?.username}
            <span className="font-mono text-sm font-normal text-zinc-500">@{editingUser?.username}</span>
            {editingUser?.username === currentUsername ? <span className="text-sm font-normal text-zinc-500">(sesión actual)</span> : null}
          </span>
        }
        onClose={closeEdit}
      >
        {editForm && data ? (
          <form className="flex flex-col gap-4" onSubmit={handleUpdateUser}>
            {formErrorBox}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FieldLabel label="Nombre visible">
                <input
                  value={editForm.display_name}
                  onChange={(event) => setEditForm((current) => (current ? { ...current, display_name: event.target.value } : current))}
                  className={inputClassName}
                />
              </FieldLabel>
              <FieldLabel label="Correo">
                <input
                  value={editForm.email}
                  onChange={(event) => setEditForm((current) => (current ? { ...current, email: event.target.value } : current))}
                  className={inputClassName}
                />
              </FieldLabel>
              <div className="sm:col-span-2">
                <FieldLabel label="Nueva contraseña" hint="Déjala en blanco para conservar la actual.">
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={editForm.password}
                    onChange={(event) => setEditForm((current) => (current ? { ...current, password: event.target.value } : current))}
                    className={inputClassName}
                  />
                </FieldLabel>
              </div>
            </div>
            <RoleChecklist
              roles={data.roles}
              selectedRoleCodes={editForm.role_codes}
              onToggle={(roleCode) =>
                setEditForm((current) => (current ? { ...current, role_codes: toggleRoleSelection(current.role_codes, roleCode) } : current))
              }
            />
            <Switch
              label="Usuario activo"
              description="Los usuarios inactivos no pueden iniciar sesión."
              checked={editForm.is_active}
              onChange={(checked) => setEditForm((current) => (current ? { ...current, is_active: checked } : current))}
            />
            <div className="flex justify-end gap-2 border-t border-black/10 pt-4 dark:border-white/10">
              <button type="button" onClick={closeEdit} className={secondaryButtonClassName}>
                Cancelar
              </button>
              <button type="submit" disabled={editSaving} className={primaryButtonClassName}>
                {editSaving ? "Guardando..." : "Guardar cambios"}
              </button>
            </div>
          </form>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={deleteTarget !== null}
        kicker="Eliminar usuario"
        title={deleteTarget ? `¿Eliminar a ${deleteTarget.display_name || deleteTarget.username}?` : ""}
        body={
          <>
            La cuenta <span className="font-mono">{deleteTarget?.username}</span> dejará de existir y no podrá iniciar sesión. Si solo quieres bloquear el acceso
            temporalmente, edítala y desactívala.
          </>
        }
        confirmLabel="Eliminar usuario"
        onConfirm={() => deleteTarget && void handleDeleteUser(deleteTarget)}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
