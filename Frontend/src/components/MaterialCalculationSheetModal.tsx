import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from "react";

import { Modal } from "./Modal";
import { ApiError, api } from "../lib/api";
import {
  DEFAULT_CALCULATION_SHEET_COLUMNS,
  DEFAULT_CALCULATION_SHEET_ROWS,
  buildCalculationCellMap,
  calculationCellKey,
  calculationCellLabel,
  calculationColumnLabel,
  calculationSheetDimensions,
  evaluateCalculationSheet,
  extractCalculationCellReferences,
  parseCalculationCellReference,
  serializeCalculationCellMap,
} from "../lib/materialCalculationSheet";
import type { InstanceMaterial, MaterialCalculationSheet } from "../lib/types";

type MaterialCalculationSheetModalProps = {
  open: boolean;
  projectId: number;
  instanceId: number;
  instanceName: string;
  material: InstanceMaterial;
  onClose: () => void;
};

type SelectedCell = {
  rowIndex: number;
  columnIndex: number;
};

type FocusMode = "grid" | "editor" | "controls";

function buildSheetSignature(cellMap: Record<string, string>) {
  return JSON.stringify(serializeCalculationCellMap(cellMap));
}

function renderHighlightedEditorValue(
  rawInput: string,
  referenceMatches: Array<{ label: string; start: number; end: number }>,
  referenceColorMap: Record<string, string>,
): ReactNode {
  if (!rawInput) {
    return <span className="text-zinc-400 dark:text-zinc-500">Enter text, a number, or =A1+B1</span>;
  }

  if (!referenceMatches.length) {
    return rawInput;
  }

  const fragments: ReactNode[] = [];
  let cursor = 0;
  for (const match of referenceMatches) {
    if (cursor < match.start) {
      fragments.push(<span key={`text-${cursor}`}>{rawInput.slice(cursor, match.start)}</span>);
    }
    fragments.push(
      <span key={`ref-${match.start}-${match.end}`} style={{ color: referenceColorMap[match.label], fontWeight: 700 }}>
        {rawInput.slice(match.start, match.end)}
      </span>,
    );
    cursor = match.end;
  }
  if (cursor < rawInput.length) {
    fragments.push(<span key={`text-${cursor}`}>{rawInput.slice(cursor)}</span>);
  }
  return fragments;
}

const REFERENCE_COLORS = ["#2563eb", "#dc2626", "#16a34a", "#9333ea", "#ea580c", "#0891b2"];

export function MaterialCalculationSheetModal({
  open,
  projectId,
  instanceId,
  instanceName,
  material,
  onClose,
}: MaterialCalculationSheetModalProps) {
  const [sheet, setSheet] = useState<MaterialCalculationSheet | null>(null);
  const [cellMap, setCellMap] = useState<Record<string, string>>({});
  const [rowCount, setRowCount] = useState(DEFAULT_CALCULATION_SHEET_ROWS);
  const [columnCount, setColumnCount] = useState(DEFAULT_CALCULATION_SHEET_COLUMNS);
  const [selectedCell, setSelectedCell] = useState<SelectedCell>({ rowIndex: 0, columnIndex: 0 });
  const [savedSignature, setSavedSignature] = useState(buildSheetSignature({}));
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [focusMode, setFocusMode] = useState<FocusMode>("grid");
  const formulaInputRef = useRef<HTMLTextAreaElement | null>(null);
  const editorHighlightRef = useRef<HTMLDivElement | null>(null);
  const pendingCaretRangeRef = useRef<{ start: number; end: number } | null>(null);

  async function loadSheet() {
    if (material.rule_id === null) {
      setError("Calculation sheets are available for catalog material rules.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const loadedSheet = await api.getMaterialCalculationSheet(projectId, instanceId, material.rule_id);
      const nextCellMap = buildCalculationCellMap(loadedSheet.cells);
      const dimensions = calculationSheetDimensions(loadedSheet.cells);
      setSheet(loadedSheet);
      setCellMap(nextCellMap);
      setRowCount(dimensions.rowCount);
      setColumnCount(dimensions.columnCount);
      setSelectedCell({ rowIndex: 0, columnIndex: 0 });
      setFocusMode("grid");
      setSavedSignature(buildSheetSignature(nextCellMap));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load the calculation sheet.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!open) {
      return;
    }
    void loadSheet();
  }, [open, projectId, instanceId, material.rule_id]);

  const evaluation = evaluateCalculationSheet(cellMap);
  const selectedKey = calculationCellKey(selectedCell.rowIndex, selectedCell.columnIndex);
  const selectedRawInput = cellMap[selectedKey] ?? "";
  const selectedDisplayValue =
    evaluation.displayValues[selectedKey] ?? (selectedRawInput.trim() ? selectedRawInput.trim() : "");
  const selectedError = evaluation.errorValues[selectedKey] ?? null;
  const referenceMatches = extractCalculationCellReferences(selectedRawInput);
  const referenceColorMap: Record<string, string> = {};
  for (const match of referenceMatches) {
    if (!referenceColorMap[match.label]) {
      referenceColorMap[match.label] = REFERENCE_COLORS[Object.keys(referenceColorMap).length % REFERENCE_COLORS.length];
    }
  }
  const referencedCellColors: Record<string, string> = {};
  for (const [referenceLabel, color] of Object.entries(referenceColorMap)) {
    const reference = parseCalculationCellReference(referenceLabel);
    if (!reference) {
      continue;
    }
    referencedCellColors[calculationCellKey(reference.rowIndex, reference.columnIndex)] = color;
  }
  const isReferenceInsertionMode = focusMode === "editor" && selectedRawInput.trimStart().startsWith("=");
  const isDirty = buildSheetSignature(cellMap) !== savedSignature;
  const updatedAtLabel = sheet?.updated_at ? new Date(sheet.updated_at).toLocaleString() : "Not saved yet";

  useEffect(() => {
    if (!open || !pendingCaretRangeRef.current) {
      return;
    }

    const pendingCaretRange = pendingCaretRangeRef.current;
    pendingCaretRangeRef.current = null;
    window.requestAnimationFrame(() => {
      const editor = formulaInputRef.current;
      if (!editor) {
        return;
      }
      editor.focus();
      editor.setSelectionRange(pendingCaretRange.start, pendingCaretRange.end);
    });
  }, [open, selectedCell, selectedRawInput]);

  function handleClose() {
    if (isDirty && !window.confirm("Discard unsaved calculation sheet changes?")) {
      return;
    }
    onClose();
  }

  function updateSelectedCell(rawInput: string) {
    setCellMap((current) => ({
      ...current,
      [selectedKey]: rawInput,
    }));
  }

  function syncEditorScroll() {
    if (!formulaInputRef.current || !editorHighlightRef.current) {
      return;
    }
    editorHighlightRef.current.scrollTop = formulaInputRef.current.scrollTop;
    editorHighlightRef.current.scrollLeft = formulaInputRef.current.scrollLeft;
  }

  function moveSelection(rowOffset: number, columnOffset: number, nextFocusMode: FocusMode = focusMode) {
    const nextRowIndex = Math.max(0, selectedCell.rowIndex + rowOffset);
    const nextColumnIndex = Math.max(0, selectedCell.columnIndex + columnOffset);
    if (nextRowIndex >= rowCount) {
      setRowCount(nextRowIndex + 1);
    }
    if (nextColumnIndex >= columnCount) {
      setColumnCount(nextColumnIndex + 1);
    }
    if (nextFocusMode === "editor") {
      const nextValue = cellMap[calculationCellKey(nextRowIndex, nextColumnIndex)] ?? "";
      pendingCaretRangeRef.current = { start: nextValue.length, end: nextValue.length };
    }
    setFocusMode(nextFocusMode);
    setSelectedCell({ rowIndex: nextRowIndex, columnIndex: nextColumnIndex });
  }

  function insertReferenceIntoSelectedCell(rowIndex: number, columnIndex: number) {
    const editor = formulaInputRef.current;
    const referenceLabel = calculationCellLabel(rowIndex, columnIndex);
    const selectionStart = editor?.selectionStart ?? selectedRawInput.length;
    const selectionEnd = editor?.selectionEnd ?? selectedRawInput.length;
    const nextValue = `${selectedRawInput.slice(0, selectionStart)}${referenceLabel}${selectedRawInput.slice(selectionEnd)}`;
    pendingCaretRangeRef.current = {
      start: selectionStart + referenceLabel.length,
      end: selectionStart + referenceLabel.length,
    };
    setFocusMode("editor");
    updateSelectedCell(nextValue);
  }

  function selectCell(rowIndex: number, columnIndex: number) {
    setFocusMode("grid");
    setSelectedCell({ rowIndex, columnIndex });
  }

  function handleEditorKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" && event.key !== "Tab") {
      return;
    }
    if (event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }

    event.preventDefault();
    if (event.key === "Enter") {
      moveSelection(event.shiftKey ? -1 : 1, 0, "editor");
      return;
    }
    moveSelection(0, event.shiftKey ? -1 : 1, "editor");
  }

  function beginEditorInput(nextValue: string, caretPosition = nextValue.length) {
    pendingCaretRangeRef.current = { start: caretPosition, end: caretPosition };
    setFocusMode("editor");
    updateSelectedCell(nextValue);
  }

  useEffect(() => {
    if (!open || focusMode !== "grid") {
      return;
    }

    const handleWindowKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey) {
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        moveSelection(-1, 0, "grid");
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        moveSelection(1, 0, "grid");
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        moveSelection(0, -1, "grid");
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        moveSelection(0, 1, "grid");
        return;
      }
      if (event.key === "Backspace" || event.key === "Delete") {
        event.preventDefault();
        beginEditorInput("", 0);
        return;
      }
      if (event.key.length === 1) {
        event.preventDefault();
        beginEditorInput(event.key);
      }
    };

    window.addEventListener("keydown", handleWindowKeyDown);
    return () => window.removeEventListener("keydown", handleWindowKeyDown);
  }, [open, focusMode, selectedCell, rowCount, columnCount, cellMap, selectedKey]);

  function handleControlFocus() {
    setFocusMode("controls");
  }

  async function handleSave() {
    if (material.rule_id === null) {
      setError("Calculation sheets are available for catalog material rules.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const nextSheet = await api.updateMaterialCalculationSheet(projectId, instanceId, material.rule_id, {
        cells: serializeCalculationCellMap(cellMap),
      });
      setSheet(nextSheet);
      setSavedSignature(buildSheetSignature(cellMap));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save the calculation sheet.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      title={`${material.material_name} calculation sheet`}
      kicker="Quantity Reasoning"
      onClose={handleClose}
      panelClassName="!max-w-[96vw] xl:!max-w-6xl"
    >
      <div className="space-y-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-1">
            <p className="text-sm font-semibold text-zinc-900 dark:text-white">
              {instanceName} | {material.sku}
            </p>
            <p className="text-xs text-zinc-600 dark:text-zinc-400">
              This sheet is only for documenting quantity reasoning. It does not update the saved material quantities.
            </p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Only non-empty cells are stored. Formulas support basic arithmetic and cell references such as `=A1+B1`.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-black/10 dark:border-white/10 px-3 py-1 text-[11px] font-mono text-zinc-600 dark:text-zinc-300">
              {serializeCalculationCellMap(cellMap).length} saved cells
            </span>
            <span className="rounded-full border border-black/10 dark:border-white/10 px-3 py-1 text-[11px] font-mono text-zinc-600 dark:text-zinc-300">
              Updated {updatedAtLabel}
            </span>
            <button
              type="button"
              onClick={() => setRowCount((current) => current + 5)}
              onFocus={handleControlFocus}
              className="px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-zinc-50 dark:bg-white/5 text-xs font-semibold text-zinc-800 dark:text-zinc-200"
            >
              Add rows
            </button>
            <button
              type="button"
              onClick={() => setColumnCount((current) => current + 3)}
              onFocus={handleControlFocus}
              className="px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-zinc-50 dark:bg-white/5 text-xs font-semibold text-zinc-800 dark:text-zinc-200"
            >
              Add columns
            </button>
            <button
              type="button"
              disabled={loading || saving || !isDirty}
              onClick={() => void handleSave()}
              onFocus={handleControlFocus}
              className="px-4 py-2 rounded-lg border border-transparent bg-accent-500 text-zinc-950 text-xs font-bold disabled:opacity-60"
            >
              {saving ? "Saving..." : "Save sheet"}
            </button>
          </div>
        </div>

        {error ? (
          <div className="rounded-xl border border-red-200 dark:border-red-500/20 bg-red-100 dark:bg-red-500/10 px-4 py-3 text-sm text-red-800 dark:text-red-200">
            {error}
          </div>
        ) : null}

        <div className="rounded-2xl border border-black/10 dark:border-white/10 bg-zinc-50 dark:bg-black/20 p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-3">
              <span className="rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-black/30 px-3 py-2 text-sm font-mono text-zinc-900 dark:text-zinc-100">
                {calculationCellLabel(selectedCell.rowIndex, selectedCell.columnIndex)}
              </span>
              <span className="text-xs text-zinc-600 dark:text-zinc-400">
                Preview:{" "}
                <strong className={selectedError ? "text-red-700 dark:text-red-300" : "text-zinc-900 dark:text-zinc-100"}>
                  {selectedDisplayValue || "Blank"}
                </strong>
              </span>
            </div>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">Grid size: {rowCount} x {columnCount}</span>
          </div>
          <div className="mt-3">
            <label className="block text-[11px] font-bold uppercase tracking-widest text-zinc-500 mb-2">Input</label>
            <div className="relative min-h-[56px] rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-black/30">
              <div
                ref={editorHighlightRef}
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 overflow-hidden px-4 py-3 text-sm whitespace-pre-wrap break-words text-zinc-900 dark:text-white"
              >
                {renderHighlightedEditorValue(selectedRawInput, referenceMatches, referenceColorMap)}
              </div>
              <textarea
                ref={formulaInputRef}
                value={selectedRawInput}
                onChange={(event) => updateSelectedCell(event.target.value)}
                onFocus={() => setFocusMode("editor")}
                onKeyDown={handleEditorKeyDown}
                onScroll={syncEditorScroll}
                placeholder="Enter text, a number, or =A1+B1"
                disabled={loading}
                rows={2}
                className="relative z-10 block min-h-[56px] w-full resize-none overflow-auto rounded-xl bg-transparent px-4 py-3 text-sm text-transparent caret-zinc-900 dark:caret-white focus:outline-none"
              />
            </div>
            <p className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">
              `Enter` moves down, `Tab` moves right, and holding `Shift` reverses direction.
            </p>
          </div>
        </div>

        <div className="overflow-auto rounded-2xl border border-black/10 dark:border-white/10 bg-white dark:bg-black/20 max-h-[60vh]">
          {loading ? (
            <div className="p-8 text-sm text-zinc-600 dark:text-zinc-400">Loading calculation sheet...</div>
          ) : (
            <table className="w-full border-collapse text-sm font-mono">
              <thead className="sticky top-0 z-10 bg-zinc-100/95 dark:bg-zinc-900/95 backdrop-blur">
                <tr>
                  <th className="sticky left-0 z-20 w-14 border-b border-r border-black/10 dark:border-white/10 bg-zinc-100/95 dark:bg-zinc-900/95 px-2 py-2 text-center text-[11px] text-zinc-500">
                    #
                  </th>
                  {Array.from({ length: columnCount }, (_, columnIndex) => (
                    <th
                      key={`column-${columnIndex}`}
                      className="min-w-28 border-b border-black/10 dark:border-white/10 px-3 py-2 text-center text-[11px] text-zinc-500"
                    >
                      {calculationColumnLabel(columnIndex)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: rowCount }, (_, rowIndex) => (
                  <tr key={`row-${rowIndex}`} className="even:bg-zinc-50/60 dark:even:bg-white/[0.02]">
                    <th className="sticky left-0 z-10 border-r border-black/10 dark:border-white/10 bg-zinc-100/95 dark:bg-zinc-900/95 px-2 py-2 text-center text-[11px] text-zinc-500">
                      {rowIndex + 1}
                    </th>
                    {Array.from({ length: columnCount }, (_, columnIndex) => {
                      const key = calculationCellKey(rowIndex, columnIndex);
                      const rawInput = cellMap[key] ?? "";
                      const displayValue = evaluation.displayValues[key] ?? "";
                      const cellError = evaluation.errorValues[key] ?? null;
                      const isSelected = selectedCell.rowIndex === rowIndex && selectedCell.columnIndex === columnIndex;

                      return (
                        <td key={key} className="border border-black/5 dark:border-white/5 p-0">
                          <button
                            type="button"
                            onFocus={() => setFocusMode("grid")}
                            onMouseDown={(event) => {
                              if (!isReferenceInsertionMode) {
                                return;
                              }
                              event.preventDefault();
                              insertReferenceIntoSelectedCell(rowIndex, columnIndex);
                            }}
                            onClick={() => {
                              if (isReferenceInsertionMode) {
                                return;
                              }
                              selectCell(rowIndex, columnIndex);
                            }}
                            className={`flex h-12 w-full items-center justify-start px-3 text-left text-sm transition-colors ${
                              isSelected
                                ? "bg-accent-50 text-accent-900 ring-1 ring-inset ring-accent-500/60 dark:bg-accent-500/10 dark:text-accent-100"
                                : cellError
                                  ? "bg-red-50 text-red-800 dark:bg-red-500/10 dark:text-red-200"
                                  : rawInput.trim()
                                    ? "text-zinc-900 dark:text-zinc-100 hover:bg-zinc-50 dark:hover:bg-white/5"
                                    : "text-zinc-400 dark:text-zinc-600 hover:bg-zinc-50 dark:hover:bg-white/5"
                            }`}
                            title={rawInput || calculationCellLabel(rowIndex, columnIndex)}
                            style={
                              referencedCellColors[key]
                                ? {
                                    outline: `2px solid ${referencedCellColors[key]}`,
                                    outlineOffset: "-2px",
                                  }
                                : undefined
                            }
                          >
                            <span className="block max-w-full truncate">{displayValue || " "}</span>
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </Modal>
  );
}
