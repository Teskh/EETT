import { describe, expect, it } from "vitest";

import type { AvailableComponent, ProjectInstance } from "../lib/types";
import {
  buildAttributeValueInputs,
  buildLinkedApplicationOccurrenceRequest,
  buildOccurrenceAttributeDrafts,
  buildUsageAttributesFromComponent,
  projectTreeMatches,
  resolveOccurrenceAttributeDefinitions,
} from "./ProjectDetailPage";

const projectTreeWithMaterialSku = {
  id: 1,
  name: "Terminaciones",
  scope: "item",
  depth: 0,
  linked_category_ids: [],
  linked_categories: [],
  available_components: [],
  instances: [
    {
      id: 10,
      name: "Puerta principal",
      short_name: "P-01",
      materials: [{ sku: "MAT-MANILLA-01" }],
    },
  ],
  children: [],
} as unknown as Parameters<typeof projectTreeMatches>[0];

describe("project tree search", () => {
  it("matches an item instance by material SKU", () => {
    expect(projectTreeMatches(projectTreeWithMaterialSku, "mat-manilla-01")).toBe(true);
  });
});

const accessoryWithLegacyApplicationFields = {
  id: 20,
  type: "accessory",
  editable_attributes: [
    {
      name: "Legacy finish",
      value_type: "select",
      options: ["Clear", "Gray"],
      value: "Clear",
    },
  ],
  usage_attribute_definitions: [
    {
      name: "Declared field",
      value_type: "number",
      options: [],
      value: null,
    },
  ],
  outgoing_occurrences: [
    {
      id: 101,
      relationship_type: "uses",
      context_label: null,
      targets: [{ instance_id: 1, instance_name: "First target" }],
      attributes: [
        { name: "Legacy finish", value: "Gray" },
        { name: "Imported note", value: "Exterior" },
      ],
    },
    {
      id: 102,
      relationship_type: "uses",
      context_label: null,
      targets: [{ instance_id: 2, instance_name: "Second target" }],
      attributes: [],
    },
  ],
} as unknown as ProjectInstance;

describe("application attribute fields", () => {
  it("uses declared fields and fields observed on sibling applications", () => {
    const definitions = resolveOccurrenceAttributeDefinitions(accessoryWithLegacyApplicationFields);

    expect(definitions.map((attribute) => attribute.name)).toEqual([
      "Declared field",
      "Legacy finish",
      "Imported note",
    ]);
    expect(definitions[0]).toMatchObject({ value_type: "number", options: [] });
    expect(definitions[1]).toMatchObject({ value_type: "select", options: ["Clear", "Gray"] });
    expect(definitions[2]).toMatchObject({ value_type: "text", options: [] });
  });

  it("gives a new application the same editable fields with blank values", () => {
    const drafts = buildOccurrenceAttributeDrafts(accessoryWithLegacyApplicationFields);

    expect(drafts.map((attribute) => [attribute.name, attribute.value])).toEqual([
      ["Declared field", ""],
      ["Legacy finish", ""],
      ["Imported note", ""],
    ]);
  });

  it("keeps values from the application being edited", () => {
    const drafts = buildOccurrenceAttributeDrafts(
      accessoryWithLegacyApplicationFields,
      accessoryWithLegacyApplicationFields.outgoing_occurrences[0],
    );

    expect(drafts.map((attribute) => [attribute.name, attribute.value])).toEqual([
      ["Declared field", ""],
      ["Legacy finish", "Gray"],
      ["Imported note", "Exterior"],
    ]);
  });
});

describe("linked accessory creation", () => {
  it("builds initial application fields from the selected component usage schema", () => {
    const component = {
      usage_attributes: [
        { name: "Application field A", value_type: "text", options: [] },
        { name: "Application field B", value_type: "select", options: ["One", "Two"] },
      ],
    } as unknown as AvailableComponent;

    expect(buildUsageAttributesFromComponent(component)).toEqual([
      { name: "Application field A", value_type: "text", options: [], value: "" },
      { name: "Application field B", value_type: "select", options: ["One", "Two"], value: "" },
    ]);
  });

  it("sends entered application values instead of replacing them with an empty list", () => {
    const attributeValues = buildAttributeValueInputs([
      { name: "Application field A", value_type: "text", options: [], value: "  entered value  " },
      { name: "Application field B", value_type: "select", options: ["One", "Two"], value: "Two" },
    ]);

    expect(buildLinkedApplicationOccurrenceRequest(44, attributeValues)).toEqual({
      relationship_type: "uses",
      context_label: null,
      target_instance_id: 44,
      attribute_values: [
        { name: "Application field A", value: "entered value" },
        { name: "Application field B", value: "Two" },
      ],
    });
  });
});
