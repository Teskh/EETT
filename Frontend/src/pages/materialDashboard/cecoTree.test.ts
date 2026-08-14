import { describe, expect, it } from "vitest";

import type { MaterialDashboardCeco } from "../../lib/types";
import {
  buildCecoTree,
  compressCecoSelections,
  expandCecoSelections,
  filterCecoTree,
  getCecoSelectionState,
} from "./cecoTree";

const rows: MaterialDashboardCeco[] = [
  { code: "01-00-00", name: "Materiales", level: 1, parent_code: null, active: true },
  { code: "01-01-00", name: "Fábrica", level: 2, parent_code: "01-00-00", active: true },
  { code: "01-01-01", name: "Acero", level: 3, parent_code: "01-01-00", active: true },
  { code: "01-01-02", name: "Madera", level: 3, parent_code: "01-01-00", active: true },
  { code: "01-02-00", name: "Despacho", level: 2, parent_code: "01-00-00", active: true },
  { code: "01-02-01", name: "Embalaje", level: 3, parent_code: "01-02-00", active: true },
  { code: "02-00-00", name: "Servicios", level: 1, parent_code: null, active: true },
  { code: "02-01-00", name: "Mantención", level: 2, parent_code: "02-00-00", active: true },
  { code: "02-01-01", name: "Repuestos", level: 3, parent_code: "02-01-00", active: true },
];

describe("CECO hierarchy selection", () => {
  const tree = buildCecoTree(rows);

  it("builds nested parents and expands a parent to operational leaves", () => {
    expect(tree.map((node) => node.code)).toEqual(["01-00-00", "02-00-00"]);
    expect(tree[0].children.map((node) => node.code)).toEqual(["01-01-00", "01-02-00"]);
    expect(expandCecoSelections(tree, ["01-00-00"])).toEqual(["01-01-01", "01-01-02", "01-02-01"]);
  });

  it("reports mixed state when only part of a parent is selected", () => {
    const selectedLeaves = new Set(["01-01-01"]);

    expect(getCecoSelectionState(tree[0], selectedLeaves)).toBe("mixed");
    expect(getCecoSelectionState(tree[0].children[0], selectedLeaves)).toBe("mixed");
    expect(getCecoSelectionState(tree[0].children[1], selectedLeaves)).toBe("unchecked");
  });

  it("compresses a fully selected sub-CECO back to its parent scope", () => {
    const selectedLeaves = expandCecoSelections(tree, ["01-01-00"]);

    expect(compressCecoSelections(tree, selectedLeaves)).toEqual(["01-01-00"]);
  });

  it("keeps ancestor context when searching for a descendant", () => {
    const filtered = filterCecoTree(tree, "embalaje");

    expect(filtered.map((node) => node.code)).toEqual(["01-00-00"]);
    expect(filtered[0].children.map((node) => node.code)).toEqual(["01-02-00"]);
    expect(filtered[0].children[0].children.map((node) => node.code)).toEqual(["01-02-01"]);
  });
});
