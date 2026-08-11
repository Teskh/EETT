import { describe, expect, it } from "vitest";

import { normalizeSearchText } from "../lib/search";
import type { CatalogTreeNode } from "../lib/types";
import { treeMatches } from "./CatalogPage";

const deeplyNestedCatalog: CatalogTreeNode = {
  id: 1,
  name: "Terminaciones",
  scope: "mixed",
  component_count: 0,
  components: [],
  children: [
    {
      id: 2,
      name: "Interior",
      scope: "mixed",
      component_count: 0,
      components: [],
      children: [
        {
          id: 3,
          name: "Puertas",
          scope: "mixed",
          component_count: 1,
          components: [
            {
              id: 10,
              name: "Manilla Tubular Negra",
              short_name: "MTN-01",
              type: "accessory",
            },
            {
              id: 11,
              name: "Cartón Corrugado",
              short_name: null,
              type: "item",
            },
          ],
          children: [],
        },
      ],
    },
  ],
};

describe("catalog tree search", () => {
  it("keeps every ancestor needed to reach a deeply nested category", () => {
    expect(treeMatches(deeplyNestedCatalog, "puertas")).toBe(true);
  });

  it("matches items and accessories by full or short name", () => {
    expect(treeMatches(deeplyNestedCatalog, "manilla tubular")).toBe(true);
    expect(treeMatches(deeplyNestedCatalog, "mtn-01")).toBe(true);
  });

  it("excludes branches without a category or component match", () => {
    expect(treeMatches(deeplyNestedCatalog, "ventana")).toBe(false);
  });

  it("treats accented and unaccented text as equivalent", () => {
    expect(normalizeSearchText("Cartón")).toBe(normalizeSearchText("Carton"));
    expect(treeMatches(deeplyNestedCatalog, "carton")).toBe(true);
    expect(treeMatches(deeplyNestedCatalog, "CARTÓN")).toBe(true);
  });
});
