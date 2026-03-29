import type { MaterialCalculationCell } from "./types";

export const DEFAULT_CALCULATION_SHEET_ROWS = 10;
export const DEFAULT_CALCULATION_SHEET_COLUMNS = 10;

type EvaluatedCell =
  | { kind: "blank" }
  | { kind: "number"; value: number }
  | { kind: "text"; value: string }
  | { kind: "error"; value: string };

export type MaterialCalculationSheetEvaluation = {
  displayValues: Record<string, string>;
  errorValues: Record<string, string | null>;
};

export type CalculationCellReferenceMatch = {
  label: string;
  start: number;
  end: number;
};

class FormulaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FormulaError";
  }
}

class FormulaParser {
  private index = 0;

  constructor(
    private readonly source: string,
    private readonly resolveReference: (reference: string) => number,
  ) {}

  parse(): number {
    const value = this.parseExpression();
    this.skipWhitespace();
    if (this.index < this.source.length) {
      throw new FormulaError("#ERROR");
    }
    return value;
  }

  private parseExpression(): number {
    let value = this.parseTerm();
    while (true) {
      this.skipWhitespace();
      const operator = this.peek();
      if (operator !== "+" && operator !== "-") {
        return value;
      }
      this.index += 1;
      const nextValue = this.parseTerm();
      value = operator === "+" ? value + nextValue : value - nextValue;
    }
  }

  private parseTerm(): number {
    let value = this.parseFactor();
    while (true) {
      this.skipWhitespace();
      const operator = this.peek();
      if (operator !== "*" && operator !== "/") {
        return value;
      }
      this.index += 1;
      const nextValue = this.parseFactor();
      if (operator === "/") {
        if (nextValue === 0) {
          throw new FormulaError("#DIV/0!");
        }
        value /= nextValue;
      } else {
        value *= nextValue;
      }
    }
  }

  private parseFactor(): number {
    this.skipWhitespace();
    const current = this.peek();
    if (current === "+") {
      this.index += 1;
      return this.parseFactor();
    }
    if (current === "-") {
      this.index += 1;
      return -this.parseFactor();
    }
    if (current === "(") {
      this.index += 1;
      const value = this.parseExpression();
      this.skipWhitespace();
      if (this.peek() !== ")") {
        throw new FormulaError("#ERROR");
      }
      this.index += 1;
      return value;
    }

    const reference = this.readReference();
    if (reference) {
      return this.resolveReference(reference);
    }

    const numberValue = this.readNumber();
    if (numberValue !== null) {
      return numberValue;
    }

    throw new FormulaError("#ERROR");
  }

  private readReference(): string | null {
    const startIndex = this.index;
    let letters = "";
    while (this.index < this.source.length && /[A-Za-z]/.test(this.source[this.index])) {
      letters += this.source[this.index].toUpperCase();
      this.index += 1;
    }
    if (!letters) {
      this.index = startIndex;
      return null;
    }
    let digits = "";
    while (this.index < this.source.length && /[0-9]/.test(this.source[this.index])) {
      digits += this.source[this.index];
      this.index += 1;
    }
    if (!digits) {
      this.index = startIndex;
      return null;
    }
    return `${letters}${digits}`;
  }

  private readNumber(): number | null {
    const remainder = this.source.slice(this.index);
    const match = remainder.match(/^(?:\d+(?:\.\d+)?|\.\d+)/);
    if (!match) {
      return null;
    }
    this.index += match[0].length;
    const parsed = Number(match[0]);
    if (!Number.isFinite(parsed)) {
      throw new FormulaError("#ERROR");
    }
    return parsed;
  }

  private skipWhitespace() {
    while (this.index < this.source.length && /\s/.test(this.source[this.index])) {
      this.index += 1;
    }
  }

  private peek(): string | null {
    return this.index < this.source.length ? this.source[this.index] : null;
  }
}

export function calculationCellKey(rowIndex: number, columnIndex: number) {
  return `${rowIndex}:${columnIndex}`;
}

export function calculationColumnLabel(columnIndex: number): string {
  let current = columnIndex + 1;
  let label = "";
  while (current > 0) {
    const remainder = (current - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    current = Math.floor((current - 1) / 26);
  }
  return label;
}

export function calculationCellLabel(rowIndex: number, columnIndex: number) {
  return `${calculationColumnLabel(columnIndex)}${rowIndex + 1}`;
}

export function parseCalculationCellReference(reference: string): { rowIndex: number; columnIndex: number } | null {
  const normalized = reference.trim().toUpperCase();
  const match = normalized.match(/^([A-Z]+)(\d+)$/);
  if (!match) {
    return null;
  }
  const [, letters, digits] = match;
  let columnIndex = 0;
  for (const char of letters) {
    columnIndex = columnIndex * 26 + (char.charCodeAt(0) - 64);
  }
  const rowIndex = Number(digits) - 1;
  if (rowIndex < 0) {
    return null;
  }
  return { rowIndex, columnIndex: columnIndex - 1 };
}

export function extractCalculationCellReferences(rawInput: string): CalculationCellReferenceMatch[] {
  if (!rawInput.trimStart().startsWith("=")) {
    return [];
  }

  const matches = rawInput.matchAll(/\b([A-Za-z]+[1-9][0-9]*)\b/g);
  return Array.from(matches, (match) => ({
    label: match[1].toUpperCase(),
    start: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length,
  }));
}

export function buildCalculationCellMap(cells: MaterialCalculationCell[]) {
  const cellMap: Record<string, string> = {};
  for (const cell of cells) {
    cellMap[calculationCellKey(cell.row_index, cell.column_index)] = cell.raw_input;
  }
  return cellMap;
}

export function serializeCalculationCellMap(cellMap: Record<string, string>): MaterialCalculationCell[] {
  return Object.entries(cellMap)
    .map(([key, rawInput]) => {
      const [rowIndexText, columnIndexText] = key.split(":");
      return {
        row_index: Number(rowIndexText),
        column_index: Number(columnIndexText),
        raw_input: rawInput,
      };
    })
    .filter((cell) => Number.isInteger(cell.row_index) && Number.isInteger(cell.column_index) && cell.raw_input.trim())
    .sort((left, right) => left.row_index - right.row_index || left.column_index - right.column_index);
}

export function calculationSheetDimensions(cells: MaterialCalculationCell[]) {
  const maxRowIndex = cells.reduce((max, cell) => Math.max(max, cell.row_index), -1);
  const maxColumnIndex = cells.reduce((max, cell) => Math.max(max, cell.column_index), -1);
  return {
    rowCount: Math.max(DEFAULT_CALCULATION_SHEET_ROWS, maxRowIndex + 1),
    columnCount: Math.max(DEFAULT_CALCULATION_SHEET_COLUMNS, maxColumnIndex + 1),
  };
}

export function evaluateCalculationSheet(cellMap: Record<string, string>): MaterialCalculationSheetEvaluation {
  const cache: Record<string, EvaluatedCell> = {};
  const inProgress = new Set<string>();

  function evaluateCell(rowIndex: number, columnIndex: number): EvaluatedCell {
    const key = calculationCellKey(rowIndex, columnIndex);
    return evaluateCellByKey(key);
  }

  function evaluateCellByKey(key: string): EvaluatedCell {
    if (cache[key]) {
      return cache[key];
    }

    const rawInput = cellMap[key] ?? "";
    const trimmed = rawInput.trim();
    if (!trimmed) {
      cache[key] = { kind: "blank" };
      return cache[key];
    }

    if (inProgress.has(key)) {
      cache[key] = { kind: "error", value: "#CYCLE" };
      return cache[key];
    }

    inProgress.add(key);
    let result: EvaluatedCell;
    if (trimmed.startsWith("=")) {
      try {
        const parser = new FormulaParser(trimmed.slice(1), (reference) => {
          const target = parseCalculationCellReference(reference);
          if (!target) {
            throw new FormulaError("#REF!");
          }
          const value = evaluateCell(target.rowIndex, target.columnIndex);
          if (value.kind === "blank") {
            return 0;
          }
          if (value.kind === "number") {
            return value.value;
          }
          if (value.kind === "text") {
            throw new FormulaError("#VALUE");
          }
          throw new FormulaError(value.value);
        });
        result = { kind: "number", value: parser.parse() };
      } catch (error) {
        result = {
          kind: "error",
          value: error instanceof FormulaError ? error.message : "#ERROR",
        };
      }
    } else {
      const numericValue = Number(trimmed);
      result = Number.isFinite(numericValue)
        ? { kind: "number", value: numericValue }
        : { kind: "text", value: rawInput };
    }

    inProgress.delete(key);
    cache[key] = result;
    return result;
  }

  const displayValues: Record<string, string> = {};
  const errorValues: Record<string, string | null> = {};

  for (const key of Object.keys(cellMap)) {
    const value = evaluateCellByKey(key);
    if (value.kind === "blank") {
      displayValues[key] = "";
      errorValues[key] = null;
      continue;
    }
    if (value.kind === "number") {
      displayValues[key] = formatCalculationNumber(value.value);
      errorValues[key] = null;
      continue;
    }
    if (value.kind === "text") {
      displayValues[key] = value.value;
      errorValues[key] = null;
      continue;
    }
    displayValues[key] = value.value;
    errorValues[key] = value.value;
  }

  return { displayValues, errorValues };
}

function formatCalculationNumber(value: number) {
  if (Number.isInteger(value)) {
    return String(value);
  }
  const rounded = Number(value.toFixed(8));
  return String(rounded);
}
