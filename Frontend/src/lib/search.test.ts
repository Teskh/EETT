import { describe, expect, it } from "vitest";

import { matchesSearchText, normalizeSearchText, searchTreeBranchMatches } from "./search";

type Node = { name: string; items: string[]; children: Node[] };

describe("shared search helpers", () => {
  it("normalizes case and diacritics", () => {
    expect(normalizeSearchText("  CARTÓN  ")).toBe("carton");
    expect(matchesSearchText("carton", "Cartón corrugado")).toBe(true);
  });

  it("keeps all ancestors of a nested item match", () => {
    const tree: Node = {
      name: "Root",
      items: [],
      children: [{ name: "Child", items: [], children: [{ name: "Leaf", items: ["Accesorio"], children: [] }] }],
    };

    expect(searchTreeBranchMatches(tree, "accesorio", (node) => [node.name, ...node.items])).toBe(true);
  });
});
