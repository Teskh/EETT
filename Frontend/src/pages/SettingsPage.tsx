import { type FormEvent, useEffect, useMemo, useState } from "react";

import { ApiError, api } from "../lib/api";
import type { BackupRecord, BackupSettings, DatabaseSyncStatus } from "../lib/types";
import {
  ConfirmDialog,
  FieldLabel,
  Notice,
  type NoticeState,
  Switch,
  formatRelativeTime,
  inputClassName,
  primaryButtonClassName,
  secondaryButtonClassName,
} from "./settings/ui";
import { UsersPage } from "./UsersPage";

type SettingsPageProps = {
  currentUsername: string;
  canManageUsers: boolean;
};

type SettingsTab = "backups" | "users";

const TAB_HASHES: Record<SettingsTab, string> = { backups: "#copias", users: "#usuarios" };

const INTERVAL_UNITS = [
  { key: "minutes", label: "minutos", factor: 1 },
  { key: "hours", label: "horas", factor: 60 },
  { key: "days", label: "días", factor: 1440 },
] as const;

type IntervalUnit = (typeof INTERVAL_UNITS)[number]["key"];

function unitFactor(unit: IntervalUnit) {
  return INTERVAL_UNITS.find((item) => item.key === unit)?.factor ?? 1;
}

/** Shows the interval in the largest unit that divides it evenly, so 1440 reads as "1 día". */
function splitInterval(minutes: number): { value: number; unit: IntervalUnit } {
  if (minutes % 1440 === 0) {
    return { value: minutes / 1440, unit: "days" };
  }
  if (minutes % 60 === 0) {
    return { value: minutes / 60, unit: "hours" };
  }
  return { value: minutes, unit: "minutes" };
}

function formatInterval(minutes: number) {
  const { value, unit } = splitInterval(minutes);
  const labels: Record<IntervalUnit, [string, string]> = {
    minutes: ["minuto", "minutos"],
    hours: ["hora", "horas"],
    days: ["día", "días"],
  };
  return value === 1 ? `Cada ${labels[unit][0]}` : `Cada ${value} ${labels[unit][1]}`;
}

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

function isLoopbackHostname() {
  if (typeof window === "undefined") {
    return false;
  }
  return ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname.toLowerCase());
}

function StatusItem({ label, value, detail }: { label: string; value: string; detail?: string | null }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-zinc-500">{label}</dt>
      <dd className="mt-1 truncate text-base font-semibold text-zinc-900 dark:text-zinc-100" title={detail ?? undefined}>
        {value}
      </dd>
      {detail ? <dd className="mt-0.5 truncate text-xs text-zinc-500">{detail}</dd> : null}
    </div>
  );
}

function BackupPanel() {
  const [settings, setSettings] = useState<BackupSettings | null>(null);
  const [draft, setDraft] = useState<BackupSettings | null>(null);
  const [intervalValue, setIntervalValue] = useState(1);
  const [intervalUnit, setIntervalUnit] = useState<IntervalUnit>("minutes");
  const [backups, setBackups] = useState<BackupRecord[]>([]);
  const [label, setLabel] = useState("");
  const [notice, setNotice] = useState<NoticeState>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<BackupRecord | null>(null);
  const localSyncVisible = isLoopbackHostname();
  const [syncStatus, setSyncStatus] = useState<DatabaseSyncStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncConfirmOpen, setSyncConfirmOpen] = useState(false);

  function applySettings(nextSettings: BackupSettings) {
    setSettings(nextSettings);
    setDraft(nextSettings);
    const split = splitInterval(nextSettings.interval_minutes);
    setIntervalValue(split.value);
    setIntervalUnit(split.unit);
  }

  async function refresh(showSpinner = true) {
    if (showSpinner) {
      setRefreshing(true);
    }
    setNotice(null);
    try {
      const [nextSettings, nextBackups] = await Promise.all([api.getBackupSettings(), api.getBackups()]);
      applySettings(nextSettings);
      setBackups(nextBackups);
      if (localSyncVisible) {
        try {
          setSyncStatus(await api.getDatabaseSyncStatus());
        } catch (err) {
          setSyncStatus({
            available: false,
            source_url: "",
            reason: err instanceof ApiError ? err.message : "No se pudo comprobar la conexion con produccion.",
          });
        }
      }
    } catch (err) {
      setNotice({ tone: "error", text: err instanceof ApiError ? err.message : "No se pudieron cargar las copias." });
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh(false);
  }, []);

  const draftIntervalMinutes = Math.max(1, Math.round(intervalValue * unitFactor(intervalUnit)));
  const scheduleDirty = Boolean(
    settings &&
      draft &&
      (draft.enabled !== settings.enabled ||
        draftIntervalMinutes !== settings.interval_minutes ||
        draft.retention_count !== settings.retention_count),
  );

  const nextRun = useMemo(() => {
    if (!settings) {
      return { value: "--", detail: null as string | null };
    }
    if (!settings.enabled) {
      return { value: "En pausa", detail: "Activa la programación para reanudar" };
    }
    if (!settings.last_backup_at) {
      return { value: "Al iniciar", detail: "Se ejecuta al iniciar el programador" };
    }
    const last = new Date(settings.last_backup_at);
    if (Number.isNaN(last.getTime())) {
      return { value: "--", detail: null };
    }
    const next = new Date(last.getTime() + settings.interval_minutes * 60 * 1000);
    return { value: formatRelativeTime(next.toISOString()) ?? "--", detail: next.toLocaleString() };
  }, [settings]);

  async function createBackup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreating(true);
    setNotice(null);
    try {
      const response = await api.createBackup(label.trim() || null);
      applySettings(response.settings);
      setBackups((current) => [response.backup, ...current.filter((item) => item.filename !== response.backup.filename)]);
      setLabel("");
      setNotice({
        tone: "success",
        text: response.pruned.length ? `Copia creada. Se depuraron ${response.pruned.length} copias antiguas.` : "Copia creada correctamente.",
      });
    } catch (err) {
      setNotice({ tone: "error", text: err instanceof ApiError ? err.message : "No se pudo crear la copia." });
    } finally {
      setCreating(false);
    }
  }

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft) {
      return;
    }
    setSaving(true);
    setNotice(null);
    try {
      const nextSettings = await api.updateBackupSettings({
        enabled: draft.enabled,
        interval_minutes: draftIntervalMinutes,
        retention_count: draft.retention_count,
      });
      applySettings(nextSettings);
      setNotice({ tone: "success", text: "Programacion de copias actualizada." });
    } catch (err) {
      setNotice({ tone: "error", text: err instanceof ApiError ? err.message : "No se pudo actualizar la programacion." });
    } finally {
      setSaving(false);
    }
  }

  function resetSchedule() {
    if (settings) {
      applySettings(settings);
    }
  }

  async function restoreBackup(backup: BackupRecord) {
    setRestoreTarget(null);
    setRestoring(backup.filename);
    setNotice(null);
    try {
      const response = await api.restoreBackup(backup.filename);
      await refresh(false);
      setNotice({ tone: "success", text: `Restauracion completa. La primaria anterior ahora es "${response.archived_db}".` });
    } catch (err) {
      setNotice({ tone: "error", text: err instanceof ApiError ? err.message : "No se pudo restaurar la copia." });
    } finally {
      setRestoring(null);
    }
  }

  async function syncFromProduction() {
    setSyncConfirmOpen(false);
    setSyncing(true);
    setNotice(null);
    try {
      const response = await api.syncDatabaseFromProduction();
      window.alert(
        `Sincronizacion completa. La copia de control es "${response.checkpoint_backup.filename}". La aplicacion se recargara.`,
      );
      window.location.reload();
    } catch (err) {
      setNotice({ tone: "error", text: err instanceof ApiError ? err.message : "No se pudo sincronizar la base desde produccion." });
      setSyncing(false);
    }
  }

  const lastBackupRelative = formatRelativeTime(settings?.last_backup_at ?? null);
  const latestFilename = backups[0]?.filename;

  return (
    <div className="flex flex-col gap-6">
      <section className="liquid-glass rounded-2xl p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
                loading
                  ? "bg-zinc-100 text-zinc-500 dark:bg-white/5"
                  : settings?.enabled
                    ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300"
                    : "bg-zinc-200 text-zinc-700 dark:bg-white/10 dark:text-zinc-300"
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${settings?.enabled ? "bg-emerald-500" : "bg-zinc-400"}`} />
              {loading ? "Cargando" : settings?.enabled ? "Copias automáticas activas" : "Copias automáticas en pausa"}
            </span>
          </div>
          <button type="button" onClick={() => void refresh()} disabled={refreshing} className={`${secondaryButtonClassName} px-3 py-1.5 text-xs`}>
            <i className={`ph-bold ph-arrows-clockwise ${refreshing ? "animate-spin" : ""}`} />
            Actualizar
          </button>
        </div>
        <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-5 md:grid-cols-4">
          <StatusItem
            label="Última copia"
            value={loading ? "--" : lastBackupRelative ?? "Nunca"}
            detail={settings?.last_backup_at ? formatDate(settings.last_backup_at) : null}
          />
          <StatusItem label="Próxima copia" value={loading ? "--" : nextRun.value} detail={nextRun.detail} />
          <StatusItem label="Copias guardadas" value={loading ? "--" : String(backups.length)} detail={settings ? `Se conservan las últimas ${settings.retention_count}` : null} />
          <StatusItem
            label="Frecuencia"
            value={settings ? formatInterval(settings.interval_minutes) : "--"}
          />
        </dl>
      </section>

      <Notice notice={notice} onDismiss={() => setNotice(null)} />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="liquid-glass min-w-0 self-start rounded-2xl p-5 sm:p-6">
          <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Historial de copias</h2>
              <p className="mt-1 text-sm text-zinc-500">Crea una copia manual antes de cambios grandes o restaura una anterior.</p>
            </div>
          </div>

          <form onSubmit={(event) => void createBackup(event)} className="mb-5 flex flex-col gap-2 sm:flex-row">
            <input
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="Etiqueta opcional, ej. pre-mantenimiento"
              aria-label="Etiqueta de la copia"
              className={inputClassName}
            />
            <button type="submit" disabled={creating} className={`${primaryButtonClassName} shrink-0`}>
              <i className={`ph-bold ${creating ? "ph-spinner animate-spin" : "ph-plus"}`} />
              {creating ? "Creando..." : "Crear copia"}
            </button>
          </form>

          <div className="overflow-hidden rounded-xl border border-black/10 dark:border-white/10">
            {loading ? <div className="px-4 py-6 text-sm text-zinc-500">Cargando copias...</div> : null}
            {!loading && backups.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <i className="ph-bold ph-database text-2xl text-zinc-400" />
                <p className="mt-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">Aún no hay copias</p>
                <p className="mt-1 text-xs text-zinc-500">Crea la primera con el botón de arriba.</p>
              </div>
            ) : null}
            <ul className="divide-y divide-black/[0.07] dark:divide-white/[0.07]">
              {backups.map((backup) => {
                const restorable = backup.filename.endsWith(".dump");
                const isRestoring = restoring === backup.filename;
                return (
                  <li key={backup.filename} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 transition-colors hover:bg-black/[0.02] dark:hover:bg-white/[0.02]">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-500 dark:bg-white/5 dark:text-zinc-400">
                      <i className="ph-bold ph-database" />
                    </span>
                    <div className="min-w-0 flex-1 basis-48">
                      <div className="flex items-center gap-2">
                        <span className={`truncate text-sm font-semibold ${backup.label ? "text-zinc-900 dark:text-zinc-100" : "text-zinc-500"}`}>
                          {backup.label || "Sin etiqueta"}
                        </span>
                        {backup.filename === latestFilename ? (
                          <span className="shrink-0 rounded-full bg-accent-500/15 px-2 py-0.5 text-[10px] font-semibold text-accent-900 dark:text-accent-400">
                            Más reciente
                          </span>
                        ) : null}
                      </div>
                      <div className="truncate font-mono text-xs text-zinc-500">{backup.filename}</div>
                    </div>
                    <div className="shrink-0 pl-[52px] text-xs text-zinc-600 sm:w-40 sm:pl-0 dark:text-zinc-400" title={formatDate(backup.created_at)}>
                      <div>{formatRelativeTime(backup.created_at) ?? formatDate(backup.created_at)}</div>
                      <div className="text-zinc-500">{formatBytes(backup.size_bytes)}</div>
                    </div>
                    <div className="ml-auto flex shrink-0 justify-end sm:w-28">
                      {restorable ? (
                        <button
                          type="button"
                          onClick={() => setRestoreTarget(backup)}
                          disabled={restoring !== null}
                          className={`${secondaryButtonClassName} px-3 py-1.5 text-xs`}
                        >
                          <i className={`ph-bold ${isRestoring ? "ph-spinner animate-spin" : "ph-arrow-counter-clockwise"}`} />
                          {isRestoring ? "Restaurando..." : "Restaurar"}
                        </button>
                      ) : (
                        <span className="text-xs text-zinc-400" title="Solo se pueden restaurar copias .dump">
                          No restaurable
                        </span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>

        <form onSubmit={(event) => void saveSettings(event)} className="liquid-glass flex flex-col gap-5 self-start rounded-2xl p-5 sm:p-6">
          <div>
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Programación</h2>
            <p className="mt-1 text-sm text-zinc-500">Cada cuánto se crea una copia y cuántas se conservan.</p>
          </div>
          <Switch
            label="Copias automáticas"
            description={draft?.enabled ? "Se crean según la frecuencia indicada" : "No se crearán copias automáticamente"}
            checked={draft?.enabled ?? false}
            disabled={!draft}
            onChange={(checked) => setDraft((current) => (current ? { ...current, enabled: checked } : current))}
          />
          <FieldLabel label="Frecuencia">
            <div className="flex gap-2">
              <input
                type="number"
                min={1}
                value={intervalValue}
                disabled={!draft}
                onChange={(event) => setIntervalValue(Math.max(1, Number(event.target.value) || 1))}
                className={inputClassName}
              />
              <select
                value={intervalUnit}
                disabled={!draft}
                onChange={(event) => setIntervalUnit(event.target.value as IntervalUnit)}
                aria-label="Unidad de frecuencia"
                className={`${inputClassName} w-32 shrink-0`}
              >
                {INTERVAL_UNITS.map((unit) => (
                  <option key={unit.key} value={unit.key}>
                    {unit.label}
                  </option>
                ))}
              </select>
            </div>
          </FieldLabel>
          <FieldLabel label="Copias a conservar" hint="Las más antiguas se eliminan al superar este número.">
            <input
              type="number"
              min={1}
              value={draft?.retention_count ?? 1}
              disabled={!draft}
              onChange={(event) =>
                setDraft((current) => (current ? { ...current, retention_count: Math.max(1, Number(event.target.value) || 1) } : current))
              }
              className={inputClassName}
            />
          </FieldLabel>
          <div className="flex gap-2 border-t border-black/[0.07] pt-4 dark:border-white/[0.07]">
            <button type="submit" disabled={saving || !scheduleDirty} className={`${primaryButtonClassName} flex-1`}>
              {saving ? "Guardando..." : scheduleDirty ? "Guardar cambios" : "Sin cambios"}
            </button>
            {scheduleDirty ? (
              <button type="button" onClick={resetSchedule} disabled={saving} className={secondaryButtonClassName}>
                Descartar
              </button>
            ) : null}
          </div>
        </form>
      </div>

      {localSyncVisible ? (
        <section className="rounded-2xl border border-dashed border-accent-500/40 bg-accent-500/[0.04] p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div className="max-w-2xl">
              <p className="mb-2 inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-accent-900 dark:text-accent-400">
                <i className="ph-bold ph-laptop" />
                Solo en entorno local
              </p>
              <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Sincronizar desde producción</h2>
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                Descarga la base actual de produccion, crea una copia de control de tu base local y la reemplaza de forma atomica.
              </p>
              <p className="mt-2 text-xs font-medium text-amber-800 dark:text-amber-400">
                Solo sincroniza PostgreSQL; los archivos de la galeria multimedia no se copian.
              </p>
              {syncStatus?.source_url ? <p className="mt-3 break-all font-mono text-xs text-zinc-500">{syncStatus.source_url}</p> : null}
              {syncStatus?.reason ? <p className="mt-3 text-xs text-amber-800 dark:text-amber-400">{syncStatus.reason}</p> : null}
            </div>
            <button
              type="button"
              onClick={() => setSyncConfirmOpen(true)}
              disabled={syncing || !syncStatus?.available}
              className="inline-flex min-w-52 items-center justify-center gap-2 rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200"
            >
              <i className={`ph-bold ${syncing ? "ph-spinner animate-spin" : "ph-cloud-arrow-down"}`} />
              {syncing ? "Sincronizando..." : syncStatus ? "Sincronizar ahora" : "Comprobando..."}
            </button>
          </div>
        </section>
      ) : null}

      <ConfirmDialog
        open={restoreTarget !== null}
        kicker="Restaurar copia"
        title={restoreTarget ? `¿Restaurar "${restoreTarget.label || restoreTarget.filename}"?` : ""}
        body={
          <>
            La base de datos actual se reemplazará por esta copia. Antes de hacerlo se creará una copia de control, así que podrás volver atrás.
            <span className="mt-2 block text-xs text-zinc-500">Las operaciones en curso de otros usuarios se interrumpirán durante la restauración.</span>
          </>
        }
        confirmLabel="Restaurar"
        onConfirm={() => restoreTarget && void restoreBackup(restoreTarget)}
        onCancel={() => setRestoreTarget(null)}
      />

      <ConfirmDialog
        open={syncConfirmOpen}
        kicker="Entorno local"
        title="Reemplazar la base local"
        body="Esto reemplazara toda la base de datos local con produccion. Se creara una copia de control primero."
        confirmLabel="Sincronizar"
        requireText="SINCRONIZAR"
        onConfirm={() => void syncFromProduction()}
        onCancel={() => setSyncConfirmOpen(false)}
      />
    </div>
  );
}

function readTabFromHash(): SettingsTab {
  return window.location.hash === TAB_HASHES.users ? "users" : "backups";
}

export function SettingsPage({ currentUsername, canManageUsers }: SettingsPageProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>(readTabFromHash);
  const tabs: Array<{ key: SettingsTab; label: string; icon: string; description: string }> = [
    { key: "backups", label: "Copias de seguridad", icon: "ph-database", description: "Copias manuales, programación y restauración." },
    { key: "users", label: "Usuarios y permisos", icon: "ph-users-three", description: "Cuentas, roles y acceso a cada página." },
  ];
  const active = tabs.find((tab) => tab.key === activeTab) ?? tabs[0];

  function selectTab(tab: SettingsTab) {
    setActiveTab(tab);
    // Keep the tab in the URL so reloads and shared links land on the same section.
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}${TAB_HASHES[tab]}`);
  }

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-6">
      <div className="flex flex-col gap-5 border-b border-black/10 dark:border-white/10">
        <div>
          <h2 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Configuración</h2>
          <p className="mt-1 text-sm text-zinc-500">{active.description}</p>
        </div>
        <div role="tablist" aria-label="Secciones de configuración" className="-mb-px flex gap-6">
          {tabs.map((tab) => {
            const selected = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => selectTab(tab.key)}
                className={`inline-flex items-center gap-2 border-b-2 pb-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:text-zinc-900 dark:focus-visible:text-white ${
                  selected
                    ? "border-accent-500 text-zinc-900 dark:text-zinc-50"
                    : "border-transparent text-zinc-500 hover:border-zinc-300 hover:text-zinc-800 dark:hover:border-white/20 dark:hover:text-zinc-200"
                }`}
              >
                <i className={`ph-bold ${tab.icon}`} />
                {tab.label}
                {tab.key === "users" && !canManageUsers ? <i className="ph-bold ph-lock-simple text-xs text-zinc-400" /> : null}
              </button>
            );
          })}
        </div>
      </div>

      {activeTab === "backups" ? <BackupPanel /> : null}
      {activeTab === "users" ? (
        canManageUsers ? (
          <UsersPage currentUsername={currentUsername} />
        ) : (
          <div className="liquid-glass flex items-center gap-4 rounded-2xl p-6 text-sm text-zinc-600 dark:text-zinc-400">
            <i className="ph-bold ph-lock-simple text-xl text-zinc-400" />
            Solo la cuenta sysadmin reservada puede acceder al editor de usuarios.
          </div>
        )
      ) : null}
    </div>
  );
}
