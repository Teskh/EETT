import { useEffect, useState, type KeyboardEvent } from "react";

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

  const input = "h-7 w-full border border-black/10 bg-white px-2 text-xs text-zinc-900 outline-none hover:border-black/25 focus:border-red-600 focus:ring-1 focus:ring-red-600 dark:border-white/10 dark:bg-zinc-900 dark:text-white dark:hover:border-white/25";
  const icon = "flex h-7 w-6 shrink-0 items-center justify-center text-zinc-400 hover:text-zinc-950 disabled:invisible dark:hover:text-white";
  const strip = (items: CatalogAttribute[]) => JSON.stringify(items.map(({ name, value_type, options }) => ({ name, value_type, options })));
  // Names and values are single-line, but wrap so long ones show in full.
  const blockNewline = (event: KeyboardEvent<HTMLTextAreaElement>) => { if (event.key === "Enter") event.preventDefault(); };
  const dirty = strip(attributes) !== strip(initialAttributes);
  const columns = "grid grid-cols-[minmax(0,9rem)_6.5rem_minmax(0,1fr)_4.5rem] gap-2";

  // A table: attribute, type, and for a selection its values as chips.
  return (
    <div className="flex flex-col gap-2">
      {attributes.length ? (
        <div className="border border-black/10 bg-white dark:border-white/10 dark:bg-zinc-950">
          <div className={`${columns} border-b border-black/10 bg-zinc-100 px-2 py-1.5 text-[10px] font-semibold text-zinc-500 dark:border-white/10 dark:bg-zinc-900`}>
            <span>Atributo</span><span>Tipo</span><span>Valores</span><span />
          </div>
          <ul>
            {attributes.map((attribute, index) => (
              <li key={attribute.local_id} className={`group/attribute ${columns} items-start border-b border-black/5 px-2 py-1.5 last:border-0 dark:border-white/5`}>
                <textarea
                  rows={1}
                  value={attribute.name}
                  onKeyDown={blockNewline}
                  onChange={(event) => updateAttribute(attribute.local_id, { name: event.target.value })}
                  placeholder="Nombre"
                  aria-label="Nombre del atributo"
                  autoFocus={!attribute.name && index === attributes.length - 1}
                  className={`${input} h-auto min-h-7 resize-none py-1.5 font-medium leading-4 [field-sizing:content]`}
                />
                <select
                  value={attribute.value_type}
                  onChange={(event) => updateAttribute(attribute.local_id, { value_type: event.target.value })}
                  aria-label="Tipo de valor"
                  className={input}
                >
                  <option value="text">Texto</option>
                  <option value="number">Número</option>
                  <option value="select">Selección</option>
                </select>
                <div className="flex min-w-0 flex-wrap items-center gap-1">
                  {attribute.value_type === "select" ? (
                    <>
                      {attribute.options.map((option, optionIndex) => (
                        <span key={`${attribute.local_id}-${optionIndex}`} className="group/option inline-flex min-h-7 max-w-full items-start bg-zinc-100 pl-2 focus-within:ring-1 focus-within:ring-red-600 dark:bg-white/10">
                          <textarea
                            rows={1}
                            value={option}
                            onKeyDown={blockNewline}
                            onChange={(event) => updateOption(attribute.local_id, optionIndex, event.target.value)}
                            placeholder="Valor"
                            aria-label="Valor de opción"
                            autoFocus={!option && optionIndex === attribute.options.length - 1 && optionIndex > 0}
                            className="min-w-[3ch] max-w-full resize-none break-words bg-transparent py-1.5 text-xs leading-4 text-zinc-900 outline-none [field-sizing:content] dark:text-zinc-100"
                          />
                          <button type="button" onClick={() => removeOption(attribute.local_id, optionIndex)} title="Quitar valor" aria-label={`Quitar ${option || "valor"}`}
                            className="flex h-7 w-6 shrink-0 items-center justify-center text-zinc-400 opacity-0 hover:text-red-600 focus:opacity-100 group-hover/option:opacity-100">
                            <i className="ph-bold ph-x text-[10px]" />
                          </button>
                        </span>
                      ))}
                      <button type="button" onClick={() => addOption(attribute.local_id)} title="Agregar valor"
                        className="h-7 border border-dashed border-black/15 px-2 text-xs text-zinc-500 hover:border-black/40 hover:text-zinc-950 dark:border-white/15 dark:hover:border-white/40 dark:hover:text-white">
                        + Valor
                      </button>
                    </>
                  ) : (
                    <span className="flex h-7 items-center text-xs text-zinc-400" title="El valor se ingresa en cada instancia del proyecto.">
                      {attribute.value_type === "number" ? "Número libre en cada proyecto" : "Texto libre en cada proyecto"}
                    </span>
                  )}
                </div>
                <div className="flex justify-end opacity-0 focus-within:opacity-100 group-hover/attribute:opacity-100">
                  <button type="button" onClick={() => moveAttribute(attribute.local_id, -1)} disabled={index === 0} className={icon} title="Mover arriba" aria-label="Mover arriba">
                    <i className="ph-bold ph-caret-up" />
                  </button>
                  <button type="button" onClick={() => moveAttribute(attribute.local_id, 1)} disabled={index === attributes.length - 1} className={icon} title="Mover abajo" aria-label="Mover abajo">
                    <i className="ph-bold ph-caret-down" />
                  </button>
                  <button type="button" onClick={() => removeAttribute(attribute.local_id)} className={`${icon} hover:text-red-600 dark:hover:text-red-400`} title="Eliminar atributo" aria-label="Eliminar atributo">
                    <i className="ph-bold ph-trash" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="border border-dashed border-black/10 px-3 py-2 text-xs text-zinc-500 dark:border-white/10">No hay atributos definidos.</p>
      )}
      <div className="flex items-center gap-3">
        <button type="button" onClick={addAttribute} className="text-xs text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-white">
          <i className="ph-bold ph-plus mr-1" />Agregar atributo
        </button>
        {dirty ? (
          <>
            <span className="ml-auto text-[10px] text-amber-700 dark:text-amber-400">Cambios sin guardar</span>
            <button type="button" disabled={saving} className="text-[10px] text-zinc-500 underline" onClick={() => setAttributes(normalizeAttributes(initialAttributes))}>
              Descartar
            </button>
            <button
              type="button"
              disabled={saving}
              className="border border-zinc-950 bg-zinc-950 px-3 py-1 text-xs font-semibold text-white disabled:opacity-50 dark:border-white dark:bg-white dark:text-zinc-950"
              onClick={() => void handleSave()}
            >
              {saving ? "Guardando…" : "Guardar atributos"}
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}
