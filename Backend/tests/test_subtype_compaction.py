from __future__ import annotations

import unittest

from app.services.export_projection import _technical_materials, build_detailed_material_export_sections
from app.services.subtype_compaction import compact_subtype_rows


SUBTYPES = [
    {
        "id": 1,
        "name": "Base",
        "path": "Base",
        "kind": "variant",
        "children": [
            {
                "id": 10,
                "name": "Organization",
                "path": "Base › Organization",
                "kind": "group",
                "children": [
                    {
                        "id": 2,
                        "name": "Child",
                        "path": "Base › Organization › Child",
                        "kind": "variant",
                        "children": [
                            {
                                "id": 3,
                                "name": "Grandchild",
                                "path": "Base › Organization › Child › Grandchild",
                                "kind": "variant",
                                "children": [],
                            }
                        ],
                    }
                ],
            }
        ],
    }
]


def bom_row(subtype_id: int, quantity: float | None, state: str | None = None) -> dict:
    quantity_state = state or ("blank" if quantity is None else "zero" if quantity == 0 else "value")
    names = {
        1: "Base",
        2: "Base › Organization › Child",
        3: "Base › Organization › Child › Grandchild",
    }
    return {
        "subtype_id": subtype_id,
        "subtype": names[subtype_id],
        "quantity": quantity,
        "quantity_state": quantity_state,
        "effective_quantity": quantity,
        "effective_quantity_state": quantity_state,
        "assembly_quantity": None,
        "assembly_quantity_state": "blank",
        "effective_assembly_quantity": None,
        "effective_assembly_quantity_state": "blank",
    }


def project_data(rows: list[dict]) -> dict:
    return {
        "project": {"name": "Nested"},
        "subtypes": SUBTYPES,
        "categories": [
            {
                "name": "Category",
                "depth": 0,
                "instances": [
                    {
                        "id": 20,
                        "name": "Instance",
                        "short_name": None,
                        "materials": [
                            {
                                "material_id": 30,
                                "material_name": "Material",
                                "sku": "MAT-1",
                                "unit": "UN",
                                "source_status": "catalog",
                                "bom_entries": rows,
                            }
                        ],
                    }
                ],
            }
        ],
    }


class SubtypeCompactionTests(unittest.TestCase):
    def test_helper_collapses_all_nested_variants_through_a_group(self) -> None:
        rows = [bom_row(1, 5), bom_row(2, 5), bom_row(3, 5)]

        compacted = compact_subtype_rows(rows, SUBTYPES, signature=lambda row: (row["quantity_state"], row["quantity"]))

        self.assertEqual([row["subtype_id"] for row in compacted], [1])

    def test_helper_compacts_rendered_paths_without_subtype_metadata(self) -> None:
        rows = [
            {**bom_row(1, 5), "subtype_id": None},
            {**bom_row(2, 5), "subtype_id": None},
            {**bom_row(3, 5), "subtype_id": None},
        ]

        compacted = compact_subtype_rows(rows, [], signature=lambda row: (row["quantity_state"], row["quantity"]))

        self.assertEqual([row["subtype"] for row in compacted], ["Base"])

    def test_helper_keeps_difference_and_recursively_collapses_its_uniform_children(self) -> None:
        rows = [bom_row(1, 5), bom_row(2, 7), bom_row(3, 7)]

        compacted = compact_subtype_rows(rows, SUBTYPES, signature=lambda row: (row["quantity_state"], row["quantity"]))

        self.assertEqual([row["subtype_id"] for row in compacted], [1, 2])

    def test_helper_keeps_blank_and_zero_distinct(self) -> None:
        rows = [bom_row(1, None), bom_row(2, 0), bom_row(3, 0)]

        compacted = compact_subtype_rows(rows, SUBTYPES, signature=lambda row: (row["quantity_state"], row["quantity"]))

        self.assertEqual([row["subtype_id"] for row in compacted], [1, 2])

    def test_detailed_material_pdf_projection_compacts_aggregated_rows(self) -> None:
        data = project_data([bom_row(1, 5), bom_row(2, 5), bom_row(3, 5)])

        sections = build_detailed_material_export_sections(data)

        self.assertEqual(sections[0]["materials"][0]["rows"], [{"subtype_id": 1, "subtype": "Base", "quantity": 5.0}])

    def test_pdf_projections_compact_rendered_paths_without_subtype_metadata(self) -> None:
        data = project_data(
            [
                {**bom_row(1, 5), "subtype_id": None},
                {**bom_row(2, 5), "subtype_id": None},
                {**bom_row(3, 5), "subtype_id": None},
            ]
        )
        data["subtypes"] = []

        detailed_sections = build_detailed_material_export_sections(data)
        self.assertEqual(
            detailed_sections[0]["materials"][0]["rows"],
            [{"subtype_id": None, "subtype": "Base", "quantity": 5.0}],
        )

        instance = data["categories"][0]["instances"][0]
        technical_materials = _technical_materials(instance, {"include_materials": True}, [])
        self.assertEqual(
            technical_materials[0]["rows"],
            [{"subtype": "Base", "quantity": 5}],
        )

    def test_technical_pdf_projection_keeps_parent_and_distinct_child(self) -> None:
        data = project_data([bom_row(1, 5), bom_row(2, 7), bom_row(3, 7)])
        instance = data["categories"][0]["instances"][0]

        materials = _technical_materials(instance, {"include_materials": True}, SUBTYPES)

        self.assertEqual(
            materials[0]["rows"],
            [
                {"subtype": "Base", "quantity": 5},
                {"subtype": "Base › Organization › Child", "quantity": 7},
            ],
        )


if __name__ == "__main__":
    unittest.main()
