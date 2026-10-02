import { type ReactNode, useEffect, useState } from "react";

import { Modal } from "../../components/Modal";

export type NoticeTone = "success" | "error" | "info";

export type NoticeState = { tone: NoticeTone; text: string } | null;

const NOTICE_STYLES: Record<NoticeTone, { box: string; icon: string }> = {
  success: {
    box: "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-200",
    icon: "ph-check-circle",
  },
  error: {
    box: "border-red-200 bg-red-50 text-red-900 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-200",
    icon: "ph-warning-circle",
  },
  info: {
    box: "border-black/10 bg-white/70 text-zinc-700 dark:border-white/10 dark:bg-white/5 dark:text-zinc-300",
    icon: "ph-info",
  },
};

export function Notice({ notice, onDismiss }: { notice: NoticeState; onDismiss: () => void }) {
  if (!notice) {
    return null;
  }
  const style = NOTICE_STYLES[notice.tone];
  return (
    <div role={notice.tone === "error" ? "alert" : "status"} className={`flex items-start gap-3 rounded-xl border px-4 py-3 text-sm ${style.box}`}>
      <i className={`ph-bold ${style.icon} mt-0.5 shrink-0 text-base`} />
      <span className="min-w-0 flex-1 break-words">{notice.text}</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Cerrar aviso"
        className="-m-1 shrink-0 rounded-md p-1 opacity-60 transition-opacity hover:opacity-100"
      >
        <i className="ph-bold ph-x" />
      </button>
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  disabled,
  label,
  description,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label: string;
  description?: string;
}) {
  return (
    <label className={`flex items-center justify-between gap-4 ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}>
      <span>
        <span className="block text-sm font-medium text-zinc-900 dark:text-zinc-100">{label}</span>
        {description ? <span className="mt-0.5 block text-xs text-zinc-500">{description}</span> : null}
      </span>
      <span className="relative inline-flex shrink-0">
        <input
          type="checkbox"
          role="switch"
          className="peer sr-only"
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span className="h-6 w-10 rounded-full bg-zinc-300 transition-colors peer-checked:bg-accent-500 peer-focus-visible:ring-2 peer-focus-visible:ring-accent-500 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-white dark:bg-zinc-700 dark:peer-focus-visible:ring-offset-zinc-900" />
        <span className="pointer-events-none absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-4" />
      </span>
    </label>
  );
}

export const inputClassName =
  "w-full rounded-xl border border-black/10 bg-white px-3 py-2.5 text-sm text-zinc-900 outline-none transition-colors placeholder:text-zinc-400 focus:border-accent-500/60 focus:ring-2 focus:ring-accent-500/20 disabled:opacity-60 dark:border-white/10 dark:bg-black/30 dark:text-zinc-100";

export const primaryButtonClassName =
  "inline-flex items-center justify-center gap-2 rounded-xl bg-accent-500 px-4 py-2.5 text-sm font-semibold text-zinc-950 transition-colors hover:bg-accent-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:focus-visible:ring-offset-zinc-900";

export const secondaryButtonClassName =
  "inline-flex items-center justify-center gap-2 rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-sm font-semibold text-zinc-800 transition-colors hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:bg-white/5 dark:text-zinc-100 dark:hover:bg-white/10";

export const dangerButtonClassName =
  "inline-flex items-center justify-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-red-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:focus-visible:ring-offset-zinc-900";

export function FieldLabel({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-zinc-600 dark:text-zinc-400">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-zinc-500">{hint}</span> : null}
    </label>
  );
}

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  kicker: string;
  body: ReactNode;
  confirmLabel: string;
  tone?: "danger" | "primary";
  /** When set, the confirm button stays disabled until this exact word is typed. */
  requireText?: string;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialog({ open, title, kicker, body, confirmLabel, tone = "danger", requireText, onConfirm, onCancel }: ConfirmDialogProps) {
  const [typed, setTyped] = useState("");

  useEffect(() => {
    if (open) {
      setTyped("");
    }
  }, [open]);

  const blocked = Boolean(requireText) && typed !== requireText;

  return (
    <Modal
      open={open}
      title={title}
      kicker={kicker}
      kickerIcon={<i className={`ph-bold ${tone === "danger" ? "ph-warning" : "ph-question"}`} />}
      onClose={onCancel}
      panelClassName="max-w-md"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!blocked) {
            onConfirm();
          }
        }}
        className="flex flex-col gap-5"
      >
        <div className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">{body}</div>
        {requireText ? (
          <FieldLabel label={`Escribe ${requireText} para confirmar`}>
            <input autoFocus value={typed} onChange={(event) => setTyped(event.target.value)} className={`${inputClassName} font-mono`} />
          </FieldLabel>
        ) : null}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} className={secondaryButtonClassName}>
            Cancelar
          </button>
          <button type="submit" autoFocus={!requireText} disabled={blocked} className={tone === "danger" ? dangerButtonClassName : primaryButtonClassName}>
            {confirmLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function formatRelativeTime(value: string | null, now = Date.now()) {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const diffSeconds = Math.round((date.getTime() - now) / 1000);
  const abs = Math.abs(diffSeconds);
  const rtf = new Intl.RelativeTimeFormat("es", { numeric: "auto" });
  if (abs < 60) {
    return rtf.format(diffSeconds, "second");
  }
  if (abs < 3600) {
    return rtf.format(Math.round(diffSeconds / 60), "minute");
  }
  if (abs < 86400) {
    return rtf.format(Math.round(diffSeconds / 3600), "hour");
  }
  return rtf.format(Math.round(diffSeconds / 86400), "day");
}
