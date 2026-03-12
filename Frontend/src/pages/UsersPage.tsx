import { FormEvent, useEffect, useState } from "react";

import { ApiError, api } from "../lib/api";
import type { CreateUserRequest, ManagedUser, RoleOption, UpdateUserRequest, UserDirectory } from "../lib/types";

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

export function UsersPage({ currentUsername }: UsersPageProps) {
  const [data, setData] = useState<UserDirectory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createForm, setCreateForm] = useState<CreateUserRequest>(initialCreateForm);
  const [createSaving, setCreateSaving] = useState(false);
  const [editingUserId, setEditingUserId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<EditFormState | null>(null);
  const [editSaving, setEditSaving] = useState(false);

  async function loadUsers() {
    setLoading(true);
    setError(null);
    try {
      setData(await api.getUsers());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load users.");
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
      setError(err instanceof ApiError ? err.message : "Could not create user.");
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
      setError(err instanceof ApiError ? err.message : "Could not update user.");
    } finally {
      setEditSaving(false);
    }
  }

  async function handleDeleteUser(userId: number) {
    const confirmed = window.confirm("Delete this user?");
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
      setError(err instanceof ApiError ? err.message : "Could not delete user.");
    }
  }

  return (
    <div className="max-w-[1600px] mx-auto flex flex-col gap-6">
      <div className="grid grid-cols-1 xl:grid-cols-[420px_minmax(0,1fr)] gap-6">
        <form className="liquid-glass rounded-2xl p-6 flex flex-col gap-4" onSubmit={handleCreateUser}>
          <div>
            <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2">Sysadmin Only</p>
            <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">User editor</h2>
            <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-2">
              Add internal accounts, assign legacy-aligned roles, and keep the reserved <span className="font-mono">sysadmin</span> account as the only user-admin entry point.
            </p>
          </div>

          <div className="space-y-3">
            <input
              value={createForm.username}
              onChange={(event) => setCreateForm((current) => ({ ...current, username: event.target.value }))}
              placeholder="Username"
              className="w-full bg-black/5 dark:bg-black/40 border border-black/10 dark:border-white/10 rounded-xl p-3 text-sm focus:outline-none focus:border-accent-500/50"
            />
            <input
              value={createForm.display_name}
              onChange={(event) => setCreateForm((current) => ({ ...current, display_name: event.target.value }))}
              placeholder="Display name"
              className="w-full bg-black/5 dark:bg-black/40 border border-black/10 dark:border-white/10 rounded-xl p-3 text-sm focus:outline-none focus:border-accent-500/50"
            />
            <input
              value={createForm.email}
              onChange={(event) => setCreateForm((current) => ({ ...current, email: event.target.value }))}
              placeholder="Email"
              className="w-full bg-black/5 dark:bg-black/40 border border-black/10 dark:border-white/10 rounded-xl p-3 text-sm focus:outline-none focus:border-accent-500/50"
            />
            <input
              type="password"
              value={createForm.password}
              onChange={(event) => setCreateForm((current) => ({ ...current, password: event.target.value }))}
              placeholder="Password"
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
            Active user
          </label>

          <button
            type="submit"
            disabled={createSaving}
            className="px-4 py-3 bg-accent-500 hover:bg-accent-400 disabled:opacity-60 text-zinc-950 border border-transparent rounded-xl text-sm font-bold transition-all"
          >
            {createSaving ? "Creating..." : "Create User"}
          </button>
        </form>

        <section className="liquid-glass rounded-2xl p-6 flex flex-col gap-4 min-h-[600px]">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1">Directory</p>
              <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">Internal users</h2>
            </div>
            <button
              type="button"
              onClick={() => void loadUsers()}
              className="px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-zinc-50 dark:bg-white/5 text-xs font-semibold"
            >
              Refresh
            </button>
          </div>

          {error ? (
            <div className="rounded-xl border border-red-200 dark:border-red-500/20 bg-red-100 dark:bg-red-500/10 px-4 py-3 text-sm text-red-800 dark:text-red-200">{error}</div>
          ) : null}

          {loading ? (
            <div className="rounded-2xl border border-dashed border-black/10 dark:border-white/10 p-6 text-sm text-zinc-500">Loading users...</div>
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
                              Inactive
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
                          Edit
                        </button>
                        {user.username !== "sysadmin" ? (
                          <button
                            type="button"
                            onClick={() => void handleDeleteUser(user.id)}
                            className="px-3 py-2 rounded-lg border border-red-200 dark:border-red-500/20 bg-red-100 dark:bg-red-500/10 text-xs font-semibold text-red-800 dark:text-red-200"
                          >
                            Delete
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
                      <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1">Edit User</p>
                      <h3 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
                        {data.users.find((user) => user.id === editingUserId)?.username}
                        {editingUserId !== null && data.users.find((user) => user.id === editingUserId)?.username === currentUsername ? " (current session)" : ""}
                      </h3>
                    </div>

                    <input
                      value={editForm.display_name}
                      onChange={(event) => setEditForm((current) => (current ? { ...current, display_name: event.target.value } : current))}
                      placeholder="Display name"
                      className="w-full bg-black/5 dark:bg-black/40 border border-black/10 dark:border-white/10 rounded-xl p-3 text-sm focus:outline-none focus:border-accent-500/50"
                    />
                    <input
                      value={editForm.email}
                      onChange={(event) => setEditForm((current) => (current ? { ...current, email: event.target.value } : current))}
                      placeholder="Email"
                      className="w-full bg-black/5 dark:bg-black/40 border border-black/10 dark:border-white/10 rounded-xl p-3 text-sm focus:outline-none focus:border-accent-500/50"
                    />
                    <input
                      type="password"
                      value={editForm.password}
                      onChange={(event) => setEditForm((current) => (current ? { ...current, password: event.target.value } : current))}
                      placeholder="New password (leave blank to keep)"
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
                      Active user
                    </label>

                    <div className="flex gap-3">
                      <button
                        type="submit"
                        disabled={editSaving}
                        className="px-4 py-3 bg-accent-500 hover:bg-accent-400 disabled:opacity-60 text-zinc-950 border border-transparent rounded-xl text-sm font-bold transition-all"
                      >
                        {editSaving ? "Saving..." : "Save Changes"}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingUserId(null);
                          setEditForm(null);
                        }}
                        className="px-4 py-3 rounded-xl border border-black/10 dark:border-white/10 bg-zinc-50 dark:bg-white/5 text-sm font-semibold"
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="h-full flex items-center justify-center text-center text-sm text-zinc-500 dark:text-zinc-400">
                    Select a user to edit role assignments, activity state, or password.
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
