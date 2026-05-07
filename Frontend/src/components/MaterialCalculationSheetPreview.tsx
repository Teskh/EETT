import { useEffect, useState } from "react";

import { ApiError, api } from "../lib/api";
import { FactoryQuantityLabel } from "./QuantityLabels";
import {
  DEFAULT_CALCULATION_SHEET_COLUMNS,
  DEFAULT_CALCULATION_SHEET_ROWS,
  buildCalculationCellMap,
  calculationCellKey,
  calculationCellLabel,
  calculationColumnLabel,
  calculationSheetDimensions,
  evaluateCalculationSheet,
} from "../lib/materialCalculationSheet";
import type { MaterialCalculationSheet } from "../lib/types";

type MaterialCalculationSheetPreviewMaterial = {
  rule_id: number;
  material_name: string;
  sku: string;
};

type SelectedCell = {
  rowIndex: number;
  columnIndex: number;
};

type MaterialCalculationSheetPreviewProps = {
  projectId: number;
  instanceId: number;
  instanceName: string;
  material: MaterialCalculationSheetPreviewMaterial;
};

function firstSelectedCell(sheet: MaterialCalculationSheet): SelectedCell {
  const firstCell = sheet.cells[0];
  if (!firstCell) {
    return { rowIndex: 0, columnIndex: 0 };
  }
  return {
    rowIndex: firstCell.row_index,
    columnIndex: firstCell.column_index,
  };
}

export function MaterialCalculationSheetPreview({
  projectId,
  instanceId,
  instanceName,
  material,
}: MaterialCalculationSheetPreviewProps) {
  const [sheet, setSheet] = useState<MaterialCalculationSheet | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cellMap, setCellMap] = useState<Record<string, string>>({});
  const [rowCount, setRowCount] = useState(DEFAULT_CALCULATION_SHEET_ROWS);
  const [columnCount, setColumnCount] = useState(DEFAULT_CALCULATION_SHEET_COLUMNS);
  const [selectedCell, setSelectedCell] = useState<SelectedCell>({ rowIndex: 0, columnIndex: 0 });

  useEffect(() => {
    let cancelled = false;

    async function loadSheet() {
      setLoading(true);
      setError(null);
      try {
        const response = await api.getMaterialCalculationSheet(projectId, instanceId, material.rule_id);
        if (cancelled) {
          return;
        }
        const nextCellMap = buildCalculationCellMap(response.cells);
        const dimensions = calculationSheetDimensions(response.cells);
        setSheet(response);
        setCellMap(nextCellMap);
        setRowCount(dimensions.rowCount);
        setColumnCount(dimensions.columnCount);
        setSelectedCell(firstSelectedCell(response));
      } catch (err) {
        if (cancelled) {
          return;
        }
        setError(err instanceof ApiError ? err.message : "No se pudo cargar la planilla de cálculo.");
        setSheet(null);
        setCellMap({});
        setRowCount(DEFAULT_CALCULATION_SHEET_ROWS);
        setColumnCount(DEFAULT_CALCULATION_SHEET_COLUMNS);
        setSelectedCell({ rowIndex: 0, columnIndex: 0 });
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadSheet();
    return () => {
      cancelled = true;
    };
  }, [instanceId, material.rule_id, projectId]);

  const evaluation = evaluateCalculationSheet(cellMap);
  const selectedKey = calculationCellKey(selectedCell.rowIndex, selectedCell.columnIndex);
  const selectedRawInput = cellMap[selectedKey] ?? "";
  const selectedDisplayValue =
    evaluation.displayValues[selectedKey] ?? (selectedRawInput.trim() ? selectedRawInput.trim() : "");
  const selectedError = evaluation.errorValues[selectedKey] ?? null;
  const updatedAtLabel = sheet?.updated_at ? new Date(sheet.updated_at).toLocaleString() : "Aún no guardada";

  return (
    <div className="flex h-full flex-col rounded-2xl border border-black/10 bg-zinc-50/80 dark:border-white/10 dark:bg-black/20">
      <div className="border-b border-black/10 px-5 py-4 dark:border-white/10">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-zinc-900 dark:text-white">
              {instanceName} | {material.sku}
            </p>
            <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
              Vista previa de solo lectura de la planilla de razonamiento de <FactoryQuantityLabel /> guardada para este par ítem/material.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-black/10 px-3 py-1 text-[11px] font-mono text-zinc-600 dark:border-white/10 dark:text-zinc-300">
              {sheet?.cell_count ?? 0} celdas guardadas
            </span>
            <span className="rounded-full border border-black/10 px-3 py-1 text-[11px] font-mono text-zinc-600 dark:border-white/10 dark:text-zinc-300">
              Actualizada {updatedAtLabel}
            </span>
          </div>
        </div>
      </div>

      {error ? (
        <div className="m-4 rounded-xl border border-red-200 bg-red-100 px-4 py-3 text-sm text-red-800 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-200">
          {error}
        </div>
      ) : null}

      <div className="grid gap-4 p-4">
        <div className="rounded-2xl border border-black/10 bg-white/80 p-4 dark:border-white/10 dark:bg-white/[0.03]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="rounded-lg border border-black/10 bg-white px-3 py-2 text-sm font-mono text-zinc-900 dark:border-white/10 dark:bg-black/30 dark:text-zinc-100">
                {calculationCellLabel(selectedCell.rowIndex, selectedCell.columnIndex)}
              </span>
              <span className="text-xs text-zinc-600 dark:text-zinc-400">
                Valor:{" "}
                <strong className={selectedError ? "text-red-700 dark:text-red-300" : "text-zinc-900 dark:text-zinc-100"}>
                  {selectedDisplayValue || "En blanco"}
                </strong>
              </span>
            </div>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              Tamaño de grilla: {rowCount} x {columnCount}
            </span>
          </div>
          <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_180px]">
            <div>
              <div className="mb-2 text-[11px] font-bold uppercase tracking-widest text-zinc-500">Entrada original</div>
              <div className="min-h-[68px] rounded-xl border border-black/10 bg-zinc-50 px-4 py-3 text-sm text-zinc-900 dark:border-white/10 dark:bg-black/30 dark:text-zinc-100">
                {selectedRawInput || <span className="text-zinc-400 dark:text-zinc-500">En blanco</span>}
              </div>
            </div>
            <div>
              <div className="mb-2 text-[11px] font-bold uppercase tracking-widest text-zinc-500">Estado</div>
              <div className="min-h-[68px] rounded-xl border border-black/10 bg-zinc-50 px-4 py-3 text-sm text-zinc-900 dark:border-white/10 dark:bg-black/30 dark:text-zinc-100">
                {selectedError ? (
                  <span className="text-red-700 dark:text-red-300">{selectedError}</span>
                ) : selectedRawInput ? (
                  "Fórmula o valor cargado"
                ) : (
                  <span className="text-zinc-400 dark:text-zinc-500">Sin entrada guardada</span>
                )}
              </div>
            </div>
          </div>
          {sheet && sheet.cell_count === 0 ? (
            <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
              Este ítem aún no tiene una planilla de cálculo guardada.
            </p>
          ) : null}
        </div>

        <div className="overflow-auto rounded-2xl border border-black/10 bg-white dark:border-white/10 dark:bg-black/20 max-h-[52vh]">
          {loading ? (
            <div className="p-8 text-sm text-zinc-600 dark:text-zinc-400">Cargando planilla de cálculo...</div>
          ) : (
            <table className="w-full border-collapse text-sm font-mono">
              <thead className="sticky top-0 z-10 bg-zinc-100/95 dark:bg-zinc-900/95 backdrop-blur">
                <tr>
                  <th className="sticky left-0 z-20 w-14 border-b border-r border-black/10 bg-zinc-100/95 px-2 py-2 text-center text-[11px] text-zinc-500 dark:border-white/10 dark:bg-zinc-900/95">
                    #
                  </th>
                  {Array.from({ length: columnCount }, (_, columnIndex) => (
                    <th
                      key={`column-${columnIndex}`}
                      className="min-w-24 border-b border-black/10 px-3 py-2 text-center text-[11px] text-zinc-500 dark:border-white/10"
                    >
                      {calculationColumnLabel(columnIndex)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: rowCount }, (_, rowIndex) => (
                  <tr key={`row-${rowIndex}`} className="even:bg-zinc-50/60 dark:even:bg-white/[0.02]">
                    <th className="sticky left-0 z-10 border-r border-black/10 bg-zinc-100/95 px-2 py-2 text-center text-[11px] text-zinc-500 dark:border-white/10 dark:bg-zinc-900/95">
                      {rowIndex + 1}
                    </th>
                    {Array.from({ length: columnCount }, (_, columnIndex) => {
                      const key = calculationCellKey(rowIndex, columnIndex);
                      const rawInput = cellMap[key] ?? "";
                      const displayValue = evaluation.displayValues[key] ?? "";
                      const cellError = evaluation.errorValues[key] ?? null;
                      const isSelected = selectedCell.rowIndex === rowIndex && selectedCell.columnIndex === columnIndex;

                      return (
                        <td key={key} className="border border-black/5 p-0 dark:border-white/5">
                          <button
                            type="button"
                            onClick={() => setSelectedCell({ rowIndex, columnIndex })}
                            className={`flex h-12 w-full items-center justify-start px-3 text-left text-sm transition-colors ${
                              isSelected
                                ? "bg-accent-50 text-accent-900 ring-1 ring-inset ring-accent-500/60 dark:bg-accent-500/10 dark:text-accent-100"
                                : cellError
                                  ? "bg-red-50 text-red-800 dark:bg-red-500/10 dark:text-red-200"
                                  : rawInput.trim()
                                    ? "text-zinc-900 hover:bg-zinc-50 dark:text-zinc-100 dark:hover:bg-white/5"
                                    : "text-zinc-400 hover:bg-zinc-50 dark:text-zinc-600 dark:hover:bg-white/5"
                            }`}
                            title={rawInput || calculationCellLabel(rowIndex, columnIndex)}
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
    </div>
  );
}
