import { useEffect, useMemo, useState } from "react";

import { ApiError, api } from "../lib/api";
import type { BackupRecord, BackupSettings } from "../lib/types";
import { UsersPage } from "./UsersPage";

type SettingsPageProps = {
  currentUsername: string;
  canManageUsers: boolean;
};

type SettingsTab = "backups" | "users";

function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ["KB", "MB", "GB", "TB"];
  let size = bytes;
  let unitIndex = -1;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size < 10 ? 1 : 0)} ${units[unitIndex]}`;
}

function formatDate(value: string | null) {
  if (!value) {
    return "--";
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function BackupPanel() {
  const [settings, setSettings] = useState<BackupSettings | null>(null);
  const [draft, setDraft] = useState<BackupSettings | null>(null);
  const [backups, setBackups] = useState<BackupRecord[]>([]);
  const [label, setLabel] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);

  async function refresh(showSpinner = true) {
    if (showSpinner) {
      setRefreshing(true);
    }
    setMessage(null);
    try {
      const [nextSettings, nextBackups] = await Promise.all([api.getBackupSettings(), api.getBackups()]);
      setSettings(nextSettings);
      setDraft(nextSettings);
      setBackups(nextBackups);
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : "No se pudieron cargar las copias.");
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh(false);
  }, []);

  const nextRun = useMemo(() => {
    if (!settings) {
      return "--";
    }
    if (!settings.enabled) {
      return "Programador en pausa";
    }
    if (!settings.last_backup_at) {
      return "Se ejecuta al iniciar el programador";
    }
    const last = new Date(settings.last_backup_at);
    if (Number.isNaN(last.getTime())) {
      return "--";
    }
    return new Date(last.getTime() + settings.interval_minutes * 60 * 1000).toLocaleString();
  }, [settings]);

  async function createBackup() {
    setCreating(true);
    setMessage(null);
    try {
      const response = await api.createBackup(label.trim() || null);
      setSettings(response.settings);
      setDraft(response.settings);
      setBackups((current) => [response.backup, ...current.filter((item) => item.filename !== response.backup.filename)]);
      setLabel("");
      setMessage(response.pruned.length ? `Copia creada. Se depuraron ${response.pruned.length} copias antiguas.` : "Copia creada correctamente.");
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : "No se pudo crear la copia.");
    } finally {
      setCreating(false);
    }
  }

  async function saveSettings() {
    if (!draft) {
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const nextSettings = await api.updateBackupSettings({
        enabled: draft.enabled,
        interval_minutes: draft.interval_minutes,
        retention_count: draft.retention_count,
      });
      setSettings(nextSettings);
      setDraft(nextSettings);
      setMessage("Programacion de copias actualizada.");
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : "No se pudo actualizar la programacion.");
    } finally {
      setSaving(false);
    }
  }

  async function restoreBackup(backup: BackupRecord) {
    const confirmed = window.confirm(`Restaurar "${backup.label || backup.filename}"? Se creara una copia de control y se cambiara la base primaria.`);
    if (!confirmed) {
      return;
    }
    setRestoring(backup.filename);
    setMessage(null);
    try {
      const response = await api.restoreBackup(backup.filename);
      await refresh(false);
      setMessage(`Restauracion completa. La primaria anterior ahora es "${response.archived_db}".`);
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : "No se pudo restaurar la copia.");
    } finally {
      setRestoring(null);
    }
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="space-y-6">
        <section className="liquid-glass rounded-2xl p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-zinc-500">Resiliencia</p>
              <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">Copias de seguridad</h2>
              <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">Crea instantaneas manuales y configura el programador automatico.</p>
            </div>
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={refreshing}
              className="inline-flex items-center gap-2 rounded-lg border border-black/10 bg-zinc-50 px-3 py-2 text-xs font-semibold text-zinc-900 dark:border-white/10 dark:bg-white/5 dark:text-zinc-100"
            >
              <i className={`ph-bold ph-arrows-clockwise ${refreshing ? "animate-spin" : ""}`} />
              Actualizar
            </button>
          </div>

          {message ? (
            <div className="mt-5 rounded-xl border border-black/10 bg-white/70 px-4 py-3 text-sm text-zinc-700 dark:border-white/10 dark:bg-white/5 dark:text-zinc-300">{message}</div>
          ) : null}

          <div className="mt-5 grid gap-4 md:grid-cols-3">
            <div className="rounded-xl border border-black/10 bg-black/5 p-4 dark:border-white/10 dark:bg-black/30">
              <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Copias</div>
              <div className="mt-2 text-2xl font-bold text-zinc-900 dark:text-zinc-100">{backups.length}</div>
            </div>
            <div className="rounded-xl border border-black/10 bg-black/5 p-4 dark:border-white/10 dark:bg-black/30">
              <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Retencion</div>
              <div className="mt-2 text-2xl font-bold text-zinc-900 dark:text-zinc-100">{settings?.retention_count ?? "--"}</div>
            </div>
            <div className="rounded-xl border border-black/10 bg-black/5 p-4 dark:border-white/10 dark:bg-black/30">
              <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Proxima ejecucion</div>
              <div className="mt-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">{nextRun}</div>
            </div>
          </div>
        </section>

        <section className="liquid-glass rounded-2xl p-6">
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
            <input
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="Etiqueta opcional, ej. pre-mantenimiento"
              className="w-full rounded-xl border border-black/10 bg-black/5 p-3 text-sm outline-none focus:border-accent-500/50 dark:border-white/10 dark:bg-black/40"
            />
            <button
              type="button"
              onClick={() => void createBackup()}
              disabled={creating}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-accent-500 px-4 py-3 text-sm font-bold text-zinc-950 disabled:opacity-60"
            >
              <i className="ph-bold ph-cloud-arrow-up" />
              {creating ? "Creando..." : "Crear copia"}
            </button>
          </div>
        </section>

        <section className="liquid-glass rounded-2xl p-6">
          <div className="mb-4 flex items-center justify-between gap-4">
            <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">Historial</h2>
            <span className="text-xs text-zinc-500">Ultima copia: {formatDate(settings?.last_backup_at ?? null)}</span>
          </div>
          <div className="overflow-hidden rounded-xl border border-black/10 dark:border-white/10">
            <div className="grid grid-cols-[minmax(0,1.5fr)_0.8fr_0.5fr_0.5fr] bg-black/5 px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-zinc-500 dark:bg-white/5">
              <span>Instantanea</span>
              <span>Creado</span>
              <span>Tamano</span>
              <span className="text-right">Accion</span>
            </div>
            <div className="divide-y divide-black/10 dark:divide-white/10">
              {loading ? <div className="px-4 py-4 text-sm text-zinc-500">Cargando copias...</div> : null}
              {!loading && backups.length === 0 ? <div className="px-4 py-4 text-sm text-zinc-500">Aun no hay copias.</div> : null}
              {backups.map((backup) => {
                const restorable = backup.filename.endsWith(".dump");
                return (
                  <div key={backup.filename} className="grid grid-cols-[minmax(0,1.5fr)_0.8fr_0.5fr_0.5fr] items-center gap-3 px-4 py-3 text-sm">
                    <div className="min-w-0">
                      <div className="truncate font-semibold text-zinc-900 dark:text-zinc-100">{backup.label || "Instantanea sin titulo"}</div>
                      <div className="truncate font-mono text-xs text-zinc-500">{backup.filename}</div>
                    </div>
                    <span className="text-xs text-zinc-500">{formatDate(backup.created_at)}</span>
                    <span className="text-xs text-zinc-700 dark:text-zinc-300">{formatBytes(backup.size_bytes)}</span>
                    <button
                      type="button"
                      onClick={() => void restoreBackup(backup)}
                      disabled={!restorable || restoring === backup.filename}
                      className="justify-self-end text-xs font-bold text-accent-700 disabled:text-zinc-400 dark:text-accent-400"
                    >
                      {restoring === backup.filename ? "Restaurando..." : restorable ? "Restaurar" : "No compatible"}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      </div>

      <aside className="liquid-glass rounded-2xl p-6 self-start">
        <div className="mb-5">
          <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-zinc-500">Programador</p>
          <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">Copias automaticas</h2>
        </div>
        <div className="space-y-4">
          <label className="flex items-center gap-3 rounded-xl border border-black/10 bg-black/5 p-3 text-sm dark:border-white/10 dark:bg-black/30">
            <input
              type="checkbox"
              checked={draft?.enabled ?? false}
              onChange={(event) => setDraft((current) => (current ? { ...current, enabled: event.target.checked } : current))}
            />
            Habilitar programacion
          </label>
          <label className="block text-sm text-zinc-600 dark:text-zinc-400">
            Intervalo en minutos
            <input
              type="number"
              min={1}
              value={draft?.interval_minutes ?? 1}
              onChange={(event) => setDraft((current) => (current ? { ...current, interval_minutes: Math.max(1, Number(event.target.value) || 1) } : current))}
              className="mt-2 w-full rounded-xl border border-black/10 bg-black/5 p-3 text-sm text-zinc-900 outline-none focus:border-accent-500/50 dark:border-white/10 dark:bg-black/40 dark:text-zinc-100"
            />
          </label>
          <label className="block text-sm text-zinc-600 dark:text-zinc-400">
            Conservar ultimas copias
            <input
              type="number"
              min={1}
              value={draft?.retention_count ?? 1}
              onChange={(event) => setDraft((current) => (current ? { ...current, retention_count: Math.max(1, Number(event.target.value) || 1) } : current))}
              className="mt-2 w-full rounded-xl border border-black/10 bg-black/5 p-3 text-sm text-zinc-900 outline-none focus:border-accent-500/50 dark:border-white/10 dark:bg-black/40 dark:text-zinc-100"
            />
          </label>
          <button
            type="button"
            onClick={() => void saveSettings()}
            disabled={saving}
            className="w-full rounded-xl bg-accent-500 px-4 py-3 text-sm font-bold text-zinc-950 disabled:opacity-60"
          >
            {saving ? "Guardando..." : "Guardar programacion"}
          </button>
        </div>
      </aside>
    </div>
  );
}

export function SettingsPage({ currentUsername, canManageUsers }: SettingsPageProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>("backups");
  const tabs: Array<{ key: SettingsTab; label: string; icon: string }> = [
    { key: "backups", label: "Copias", icon: "ph-database" },
    { key: "users", label: "Usuarios", icon: "ph-users-three" },
  ];

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-zinc-500">Administracion</p>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">Configuracion</h1>
        </div>
        <div className="flex rounded-xl border border-black/10 bg-black/5 p-1 dark:border-white/10 dark:bg-black/30">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={
                activeTab === tab.key
                  ? "inline-flex items-center gap-2 rounded-lg bg-zinc-900 px-3 py-2 text-xs font-bold text-white dark:bg-white dark:text-zinc-950"
                  : "inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold text-zinc-600 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-white"
              }
            >
              <i className={`ph-bold ${tab.icon}`} />
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {activeTab === "backups" ? <BackupPanel /> : null}
      {activeTab === "users" ? (
        canManageUsers ? (
          <UsersPage currentUsername={currentUsername} />
        ) : (
          <div className="liquid-glass rounded-2xl p-8 text-sm text-zinc-600 dark:text-zinc-400">Solo la cuenta sysadmin reservada puede acceder al editor de usuarios.</div>
        )
      ) : null}
    </div>
  );
}
