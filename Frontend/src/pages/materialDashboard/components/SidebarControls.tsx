import { Funnel } from "@phosphor-icons/react";
import { memo } from "react";

import type { CecoFilterMode } from "../preferences";
import type { SortKey, SortState } from "../selection";

export type SidebarTab = "materials" | "groups" | "cecos";

export const SIDEBAR_BUTTON_CLASSES =
  "inline-flex h-10 items-center justify-center border border-black/10 bg-white px-4 text-sm font-medium text-zinc-700 shadow-sm transition-colors hover:border-black/15 hover:bg-zinc-50 dark:border-white/10 dark:bg-white/5 dark:text-zinc-300 dark:hover:bg-white/10";

const SORT_SELECT_CLASSES =
  "h-10 border border-black/10 bg-white px-3 text-sm text-zinc-900 outline-none transition-colors focus:border-accent-500 focus:ring-1 focus:ring-accent-500 dark:border-white/10 dark:bg-black/20 dark:text-white";

export function SortControls({
  options,
  sort,
  onChange,
  filter,
}: {
  options: Array<{ key: SortKey; label: string }>;
  sort: SortState;
  onChange: (sort: SortState) => void;
  filter?: {
    active: boolean;
    label: string;
    description: string;
    disabled?: boolean;
    loading?: boolean;
    onToggle: () => void;
  };
}) {
  return (
    <div className={`grid gap-2 ${filter ? "grid-cols-[minmax(0,1fr)_auto_auto]" : "grid-cols-[minmax(0,1fr)_auto]"}`}>
      <select
        aria-label="Ordenar resultados por"
        value={sort.key}
        onChange={(event) => {
          const key = event.target.value as SortKey;
          if (key !== sort.key) {
            onChange({ key, direction: -1 });
          }
        }}
        className={SORT_SELECT_CLASSES}
      >
        {options.map((option) => (
          <option key={option.key} value={option.key}>
            {option.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => onChange({ ...sort, direction: sort.direction === 1 ? -1 : 1 })}
        className={SIDEBAR_BUTTON_CLASSES}
        title={sort.direction === -1 ? "Descendente" : "Ascendente"}
        aria-label={`Orden ${sort.direction === -1 ? "descendente" : "ascendente"}`}
      >
        {sort.direction === -1 ? "Desc" : "Asc"}
      </button>
      {filter ? (
        <details className="group relative">
          <summary
            className={`inline-flex h-10 w-10 list-none cursor-pointer items-center justify-center border shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 [&::-webkit-details-marker]:hidden ${
              filter.active
                ? "border-accent-500 bg-accent-500 text-zinc-950 hover:bg-accent-400"
                : "border-black/10 bg-white text-zinc-600 hover:border-black/15 hover:bg-zinc-50 dark:border-white/10 dark:bg-white/5 dark:text-zinc-300 dark:hover:bg-white/10"
            }`}
            title="Filtrar resultados"
            aria-label={filter.active ? "Filtrar resultados, un filtro activo" : "Filtrar resultados"}
          >
            <Funnel size={17} weight={filter.active ? "fill" : "regular"} aria-hidden="true" />
          </summary>
          <div className="absolute right-0 top-12 z-30 w-72 border border-black/10 bg-white p-3 shadow-xl dark:border-white/10 dark:bg-zinc-900">
            <label className={`flex items-start gap-3 ${filter.disabled ? "cursor-not-allowed opacity-55" : "cursor-pointer"}`}>
              <input
                type="checkbox"
                checked={filter.active}
                disabled={filter.disabled}
                onChange={filter.onToggle}
                className="mt-0.5 h-4 w-4 accent-accent-500"
              />
              <span className="min-w-0">
                <span className="block text-xs font-semibold text-zinc-900 dark:text-white">{filter.label}</span>
                <span className="mt-1 block text-[11px] leading-4 text-zinc-500">{filter.description}</span>
                {filter.loading ? <span className="mt-1 block text-[11px] text-accent-600 dark:text-accent-400">Calculando estimados...</span> : null}
              </span>
            </label>
          </div>
        </details>
      ) : null}
    </div>
  );
}

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
        aria-label={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full border border-black/10 bg-white pl-10 pr-10 text-sm text-zinc-900 outline-none transition-colors focus:border-accent-500 focus:ring-1 focus:ring-accent-500 dark:border-white/10 dark:bg-black/20 dark:text-white"
        placeholder={placeholder}
      />
      <svg className="absolute left-3 top-3 h-4 w-4 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
      className="inline-flex h-10 w-10 shrink-0 items-center justify-center bg-accent-500 text-zinc-950 shadow-sm transition-colors hover:bg-accent-400"
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
          <div role="alert" key={`${error}-${index}`} className="mt-1 border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
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
    <div role="tablist" aria-label="Secciones del panel" className="flex gap-4 border-b border-black/10 dark:border-white/10 px-2">
      {TABS.map((tab) => {
        const active = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onTabChange(tab.id)}
            role="tab"
            aria-selected={active}
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
            {active ? <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent-500" /> : null}
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
    <div className="border border-black/10 bg-zinc-50 p-1 dark:border-white/10 dark:bg-white/5">
      <div className="grid grid-cols-2 gap-1">
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => onChange(option.id)}
            className={`px-3 py-2 text-xs font-semibold transition-colors ${
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
            {showAll ? "Colapsar" : `Ver los ${allCodes.length}`}
          </button>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {visibleCodes.map((code) => (
          <button
            key={code}
            type="button"
            onClick={() => onToggleCeco(code)}
            className={`flex items-center gap-1 px-2 py-1 text-xs font-semibold transition-colors ${
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
            className="border border-dashed border-black/10 bg-white/70 px-2.5 py-1 text-xs font-semibold text-zinc-500 transition-colors hover:border-black/20 hover:text-zinc-700 dark:border-white/10 dark:bg-white/[0.03] dark:text-zinc-400 dark:hover:border-white/20 dark:hover:text-zinc-200"
          >
            +{allCodes.length - visibleCodes.length} más
          </button>
        ) : null}
      </div>
    </div>
  );
}
