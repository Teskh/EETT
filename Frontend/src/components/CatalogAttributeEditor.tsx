import { useEffect, useState } from "react";

import type { CatalogAttribute } from "../lib/types";

type EditableAttribute = CatalogAttribute & { local_id: string };

type CatalogAttributeEditorProps = {
  initialAttributes: CatalogAttribute[];
  saving: boolean;
  onSave: (attributes: CatalogAttribute[]) => Promise<void>;
};

function makeLocalId() {
  return Math.random().toString(36).slice(2, 10);
}

function normalizeAttributes(attributes: CatalogAttribute[]): EditableAttribute[] {
  return attributes.map((attribute) => ({
    ...attribute,
    local_id: makeLocalId(),
  }));
}

export function CatalogAttributeEditor({ initialAttributes, saving, onSave }: CatalogAttributeEditorProps) {
  const [attributes, setAttributes] = useState<EditableAttribute[]>(() => normalizeAttributes(initialAttributes));

  useEffect(() => {
    setAttributes(normalizeAttributes(initialAttributes));
  }, [initialAttributes]);

  function updateAttribute(localId: string, next: Partial<EditableAttribute>) {
    setAttributes((current) =>
      current.map((attribute) => (attribute.local_id === localId ? { ...attribute, ...next } : attribute)),
    );
  }

  function moveAttribute(localId: string, direction: -1 | 1) {
    setAttributes((current) => {
      const index = current.findIndex((attribute) => attribute.local_id === localId);
      if (index < 0) {
        return current;
      }
      const targetIndex = index + direction;
      if (targetIndex < 0 || targetIndex >= current.length) {
        return current;
      }
      const copy = [...current];
      const [moved] = copy.splice(index, 1);
      copy.splice(targetIndex, 0, moved);
      return copy;
    });
  }

  function removeAttribute(localId: string) {
    setAttributes((current) => current.filter((attribute) => attribute.local_id !== localId));
  }

  function addAttribute() {
    setAttributes((current) => [
      ...current,
      {
        local_id: makeLocalId(),
        name: "",
        value_type: "text",
        options: [""],
      },
    ]);
  }

  function updateOption(attributeId: string, optionIndex: number, value: string) {
    setAttributes((current) =>
      current.map((attribute) => {
        if (attribute.local_id !== attributeId) {
          return attribute;
        }
        const options = [...attribute.options];
        options[optionIndex] = value;
        return { ...attribute, options };
      }),
    );
  }

  function addOption(attributeId: string) {
    setAttributes((current) =>
      current.map((attribute) =>
        attribute.local_id === attributeId ? { ...attribute, options: [...attribute.options, ""] } : attribute,
      ),
    );
  }

  function removeOption(attributeId: string, optionIndex: number) {
    setAttributes((current) =>
      current.map((attribute) => {
        if (attribute.local_id !== attributeId) {
          return attribute;
        }
        const options = attribute.options.filter((_, index) => index !== optionIndex);
        return { ...attribute, options: options.length ? options : [""] };
      }),
    );
  }

  async function handleSave() {
    await onSave(
      attributes
        .map((attribute) => ({
          name: attribute.name.trim(),
          value_type: attribute.value_type,
          options:
            attribute.value_type === "select"
              ? attribute.options.map((option) => option.trim()).filter((option) => option !== "")
              : [],
        }))
        .filter((attribute) => attribute.name !== "" || attribute.options.length > 0),
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-3">
        {attributes.length ? (
          attributes.map((attribute) => {
            const showOptions = attribute.value_type === "select";
            return (
              <article key={attribute.local_id} className="bg-white/40 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-lg p-3 flex flex-col gap-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Attribute</div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => moveAttribute(attribute.local_id, -1)}
                      className="px-2 py-1 rounded border border-black/10 dark:border-white/10 bg-white/80 dark:bg-white/5 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:text-zinc-200 hover:bg-white/40 dark:hover:bg-white/5 transition-colors"
                      title="Move up"
                    >
                      <i className="ph-bold ph-caret-up" />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveAttribute(attribute.local_id, 1)}
                      className="px-2 py-1 rounded border border-black/10 dark:border-white/10 bg-white/80 dark:bg-white/5 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:text-zinc-200 hover:bg-white/40 dark:hover:bg-white/5 transition-colors"
                      title="Move down"
                    >
                      <i className="ph-bold ph-caret-down" />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeAttribute(attribute.local_id)}
                      className="px-2 py-1 rounded border border-red-200 dark:border-red-500/20 bg-red-100 dark:bg-red-500/10 text-red-700 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-500/20 transition-colors text-xs font-semibold"
                    >
                      Remove
                    </button>
                  </div>
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={attribute.name}
                    onChange={(event) => updateAttribute(attribute.local_id, { name: event.target.value })}
                    placeholder="Attribute name"
                    className="w-1/2 bg-white dark:bg-black/40 border border-black/10 dark:border-white/10 rounded p-1.5 text-xs text-zinc-900 dark:text-zinc-200 focus:outline-none focus:border-accent-500/50 transition-colors font-mono"
                  />
                  <select
                    value={attribute.value_type}
                    onChange={(event) => updateAttribute(attribute.local_id, { value_type: event.target.value })}
                    className="w-1/2 bg-white dark:bg-black/40 border border-black/10 dark:border-white/10 rounded p-1.5 text-xs text-zinc-900 dark:text-zinc-200 focus:outline-none focus:border-accent-500/50 transition-colors font-mono"
                  >
                    <option value="text">Text</option>
                    <option value="number">Number</option>
                    <option value="select">Select</option>
                  </select>
                </div>
                {showOptions ? (
                  <div className="border-l-2 border-black/10 dark:border-white/10 pl-3 ml-2 flex flex-col gap-2">
                    <div className="text-[10px] font-mono text-zinc-500">Options</div>
                    <div className="flex flex-col gap-2">
                      {attribute.options.map((option, optionIndex) => (
                        <div
                          key={`${attribute.local_id}-${optionIndex}`}
                          className="flex items-center gap-2 bg-white/60 dark:bg-black/20 border border-black/10 dark:border-white/10 rounded-lg p-2"
                        >
                          <input
                            type="text"
                            value={option}
                            onChange={(event) => updateOption(attribute.local_id, optionIndex, event.target.value)}
                            placeholder="Option value"
                            className="flex-1 bg-white dark:bg-black/40 border border-black/10 dark:border-white/10 rounded p-1.5 text-xs text-zinc-900 dark:text-zinc-200 focus:outline-none focus:border-accent-500/50 transition-colors font-mono"
                          />
                          <button
                            type="button"
                            onClick={() => removeOption(attribute.local_id, optionIndex)}
                            className="px-2 py-1 rounded border border-red-200 dark:border-red-500/20 bg-red-100 dark:bg-red-500/10 text-red-700 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-500/20 transition-colors"
                          >
                            <i className="ph-bold ph-x" />
                          </button>
                        </div>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={() => addOption(attribute.local_id)}
                      className="px-3 py-1.5 border border-black/10 dark:border-white/10 bg-white/80 dark:bg-white/5 hover:bg-white/40 dark:hover:bg-white/5 rounded text-xs font-semibold text-zinc-800 dark:text-zinc-300 transition-colors flex items-center gap-2 self-start"
                    >
                      <i className="ph-bold ph-plus" /> Add value
                    </button>
                  </div>
                ) : (
                  <p className="text-[10px] text-zinc-500 font-mono">Free-form value entered later on project instances.</p>
                )}
              </article>
            );
          })
        ) : (
          <div className="text-zinc-500 font-mono text-xs text-center border border-dashed border-black/10 dark:border-white/10 rounded-lg p-4">
            No attributes defined.
          </div>
        )}
      </div>
      <div className="flex items-center justify-between gap-3 pt-1">
        <button
          type="button"
          className="px-3 py-1.5 border border-black/10 dark:border-white/10 bg-white/40 dark:bg-white/5 hover:bg-white/60 dark:hover:bg-white/10 rounded text-xs font-semibold text-zinc-900 dark:text-zinc-200 transition-colors flex items-center gap-2"
          onClick={addAttribute}
        >
          <i className="ph-bold ph-plus" /> Add attribute
        </button>
        <button
          type="button"
          disabled={saving}
          className="px-3 py-1.5 bg-accent-500/20 hover:bg-accent-500/30 disabled:opacity-60 text-accent-700 dark:text-accent-400 rounded text-xs font-semibold transition-colors"
          onClick={() => void handleSave()}
        >
          {saving ? "Saving..." : "Save attribute set"}
        </button>
      </div>
      <p className="text-[10px] text-zinc-500 font-mono">
        Build attributes as rows and add individual option values inside each select attribute.
      </p>
    </div>
  );
}
