import { useEffect, useRef } from "react";

export function SearchField({
  value,
  onChange,
  placeholder = "Buscar categorías, ítems, accesorios o SKU de material...",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function focusSearch(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    }

    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, []);

  return (
    <div className="relative mb-4">
      <input
        ref={inputRef}
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder.replace(/\.{3}$/, "")}
        aria-keyshortcuts="Control+K Meta+K"
        className="w-full rounded-lg border border-black/10 bg-white py-1.5 pl-3 pr-16 font-mono text-sm text-zinc-800 placeholder:text-zinc-500 focus:border-accent-500/50 focus:outline-none dark:border-white/10 dark:bg-black/40 dark:text-zinc-300 dark:placeholder:text-zinc-600"
      />
      <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-black/10 bg-zinc-50 px-1.5 py-0.5 font-mono text-[9px] text-zinc-500 dark:border-white/10 dark:bg-white/5">
        Ctrl K
      </kbd>
    </div>
  );
}
