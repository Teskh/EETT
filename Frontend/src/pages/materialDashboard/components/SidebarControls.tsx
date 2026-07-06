import { memo } from "react";

import type { CecoFilterMode } from "../preferences";

export type SidebarTab = "materials" | "groups" | "cecos";

export const SidebarSearchInput = memo(function SidebarSearchInput({
  value,
  pending,
  placeholder,
  onChange,
}: {
  value: string;
  pending: boolean;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="relative">
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-black/20 pl-10 pr-10 py-2.5 text-sm text-zinc-900 dark:text-white outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500 transition-colors"
        placeholder={placeholder}
      />
      <svg className="absolute left-3 top-3 w-4 h-4 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
      {pending ? <span className="pointer-events-none absolute right-4 top-1/2 h-2.5 w-2.5 -translate-y-1/2 animate-pulse rounded-full bg-accent-500/90" /> : null}
    </div>
  );
});

export function ReloadIconButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-xl bg-accent-500 text-zinc-950 shadow-sm transition-colors hover:bg-accent-400"
      title="Recargar"
      aria-label="Recargar"
    >
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M4 4v6h6M20 20v-6h-6M5.5 15A7 7 0 0 0 17 18.5M18.5 9A7 7 0 0 0 7 5.5" />
      </svg>
    </button>
  );
}

export function ErrorBanners({ errors }: { errors: Array<string | null> }) {
  return (
    <>
      {errors
        .filter((error): error is string => Boolean(error))
        .map((error, index) => (
          <div key={`${error}-${index}`} className="mt-1 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </div>
        ))}
    </>
  );
}

const TABS: Array<{ id: SidebarTab; label: string }> = [
  { id: "materials", label: "Materiales" },
  { id: "groups", label: "Grupos" },
  { id: "cecos", label: "Centros de Costo" },
];

export function SidebarTabBar({
  activeTab,
  onTabChange,
  selectedCecoCount,
}: {
  activeTab: SidebarTab;
  onTabChange: (tab: SidebarTab) => void;
  selectedCecoCount: number;
}) {
  return (
    <div className="flex gap-4 border-b border-black/10 dark:border-white/10 px-2">
      {TABS.map((tab) => {
        const active = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onTabChange(tab.id)}
            className={`pb-3 text-sm font-semibold transition-colors relative flex items-center gap-2 ${
              active ? "text-accent-600 dark:text-accent-400" : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
            }`}
          >
            {tab.label}
            {tab.id === "cecos" && selectedCecoCount > 0 ? (
              <span className="bg-accent-100 dark:bg-accent-500/20 text-accent-700 dark:text-accent-400 text-[10px] px-1.5 py-0.5 rounded-full">
                {selectedCecoCount}
              </span>
            ) : null}
            {active ? <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent-500 rounded-t-full" /> : null}
          </button>
        );
      })}
    </div>
  );
}

export function CecoFilterModeToggle({ mode, onChange }: { mode: CecoFilterMode; onChange: (mode: CecoFilterMode) => void }) {
  const options: Array<{ id: CecoFilterMode; label: string }> = [
    { id: "exclude", label: "Todos excepto seleccionados" },
    { id: "include", label: "Solo seleccionados" },
  ];
  return (
    <div className="rounded-2xl border border-black/10 dark:border-white/10 bg-zinc-50 dark:bg-white/5 p-1">
      <div className="grid grid-cols-2 gap-1">
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => onChange(option.id)}
            className={`rounded-xl px-3 py-2 text-xs font-semibold transition-colors ${
              mode === option.id
                ? "bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white shadow-sm"
                : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function SelectedCecoChips({
  allCodes,
  visibleCodes,
  mode,
  cecoNameByCode,
  collapsible,
  showAll,
  onToggleShowAll,
  onToggleCeco,
}: {
  allCodes: string[];
  visibleCodes: string[];
  mode: CecoFilterMode;
  cecoNameByCode: ReadonlyMap<string, string>;
  collapsible: boolean;
  showAll: boolean;
  onToggleShowAll: (show: boolean) => void;
  onToggleCeco: (code: string) => void;
}) {
  if (!allCodes.length) {
    return null;
  }
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
          {mode === "exclude" ? "Ocultos" : "Incluidos"}
        </div>
        {collapsible ? (
          <button
            type="button"
            onClick={() => onToggleShowAll(!showAll)}
            className="text-[11px] font-semibold text-accent-600 hover:text-accent-500 dark:text-accent-400 dark:hover:text-accent-300 transition-colors"
          >
            {showAll ? "Collapse" : `Show all ${allCodes.length}`}
          </button>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {visibleCodes.map((code) => (
          <button
            key={code}
            type="button"
            onClick={() => onToggleCeco(code)}
            className={`rounded-lg px-2 py-1 text-xs font-semibold transition-colors flex items-center gap-1 ${
              mode === "exclude"
                ? "border border-rose-500/30 bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-500/20"
                : "border border-accent-500/30 bg-accent-50 dark:bg-accent-500/10 text-accent-700 dark:text-accent-300 hover:bg-accent-100 dark:hover:bg-accent-500/20"
            }`}
          >
            {cecoNameByCode.get(code) || code}
            <svg className="w-3 h-3 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        ))}
        {!showAll && collapsible ? (
          <button
            type="button"
            onClick={() => onToggleShowAll(true)}
            className="rounded-lg border border-dashed border-black/10 dark:border-white/10 bg-white/70 dark:bg-white/[0.03] px-2.5 py-1 text-xs font-semibold text-zinc-500 hover:text-zinc-700 hover:border-black/20 dark:text-zinc-400 dark:hover:text-zinc-200 dark:hover:border-white/20 transition-colors"
          >
            +{allCodes.length - visibleCodes.length} more
          </button>
        ) : null}
      </div>
    </div>
  );
}
