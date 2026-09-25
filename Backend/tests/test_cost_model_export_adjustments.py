from __future__ import annotations

from io import BytesIO
import unittest

from openpyxl import load_workbook

from app.services.export_workbooks import _build_cost_model_rows, build_cost_model_workbook


class CostModelExportAdjustmentTests(unittest.TestCase):
    def setUp(self) -> None:
        self.project_data = {
            "project": {"name": "Proyecto de prueba"},
            "subtypes": [{"id": 9, "name": "Premium", "children": []}],
            "categories": [
                {
                    "number": "1",
                    "name": "Estructura",
                    "instances": [
                        {
                            "id": 10,
                            "name": "Muro",
                            "short_name": "M-01",
                            "materials": [
                                {
                                    "material_id": 21,
                                    "material_name": "Tablero",
                                    "sku": "MAT-021",
                                    "unit": "un",
                                    "bom_entries": [
                                        {
                                            "subtype": "General",
                                            "subtype_id": None,
                                            "quantity": 2,
                                            "quantity_state": "value",
                                        },
                                        {
                                            "subtype": "Premium",
                                            "subtype_id": 9,
                                            "quantity": 3,
                                            "quantity_state": "value",
                                        },
                                    ],
                                }
                            ],
                        }
                    ],
                }
            ],
            "auxiliary_materials": [],
        }
        self.adjustments = [
            {"material_id": 21, "subtype_id": None, "adjusted_quantity": 5},
            {"material_id": 21, "subtype_id": 9, "adjusted_quantity": 1},
        ]

    def test_adjustments_are_exported_as_explicit_deltas(self) -> None:
        rows = _build_cost_model_rows(
            self.project_data,
            prices_by_sku={"MAT-021": 1000},
            adjustments=self.adjustments,
        )

        adjustment_rows = [row for row in rows if row["is_adjustment"]]
        self.assertEqual(len(adjustment_rows), 2)
        deltas = {row["subtype_id"]: row["quantity"] for row in adjustment_rows}
        self.assertEqual(deltas, {None: 3, 9: -2})
        self.assertTrue(all(row["instance_name"] == "Ajustes del modelo" for row in adjustment_rows))

    def test_scenario_override_replaces_general_plus_subtype(self) -> None:
        rows = _build_cost_model_rows(self.project_data, prices_by_sku={"MAT-021": 1000}, adjustments=[
            {"material_id": 21, "subtype_id": None, "adjusted_quantity": 5},
            {"material_id": 21, "subtype_id": 9, "adjusted_quantity": 6, "quantity_scope": "scenario"},
        ])
        self.assertEqual(sum(row["quantity"] for row in rows), 6)
        self.assertEqual(next(row["quantity"] for row in rows if row["is_adjustment"] and row["subtype_id"] == 9), -2)

    def test_scenario_can_override_general_only_material(self) -> None:
        self.project_data["categories"][0]["instances"][0]["materials"][0]["bom_entries"].pop()
        rows = _build_cost_model_rows(self.project_data, prices_by_sku={"MAT-021": 1000}, adjustments=[
            {"material_id": 21, "subtype_id": 9, "adjusted_quantity": 0, "quantity_scope": "scenario"},
        ])
        self.assertEqual(sum(row["quantity"] for row in rows), 0)
        self.assertEqual(rows[-1]["subtype_name"], "Premium")
        self.assertEqual(rows[-1]["subtype_id"], 9)

    def test_return_to_estimate_uses_current_bom_and_ignores_legacy_general_adjustment(self) -> None:
        rows = _build_cost_model_rows(self.project_data, prices_by_sku={"MAT-021": 1000}, adjustments=[
            {"material_id": 21, "subtype_id": None, "adjusted_quantity": 5},
            {"material_id": 21, "subtype_id": 9, "adjusted_quantity": 999, "quantity_scope": "scenario", "source_kind": "estimated"},
        ])
        self.assertEqual(sum(row["quantity"] for row in rows), 5)

    def test_workbook_contains_adjustment_rows_and_preserves_zero_totals(self) -> None:
        zero_adjustment = [{"material_id": 21, "subtype_id": None, "adjusted_quantity": 0}]
        output = BytesIO()
        build_cost_model_workbook(
            self.project_data,
            output,
            prices_by_sku={"MAT-021": 1000},
            adjustments=zero_adjustment,
        )
        output.seek(0)

        workbook = load_workbook(output, data_only=False)
        by_instance = workbook["Por Instancia"]
        adjustment_row = next(
            row
            for row in by_instance.iter_rows(min_row=2, values_only=True)
            if row[0] == "Ajustes del modelo" and row[2] == "General"
        )
        self.assertEqual(adjustment_row[6], -2)

        totals = workbook["Total Materiales"]
        general_row = next(
            row_index
            for row_index in range(2, totals.max_row + 1)
            if totals.cell(row=row_index, column=1).value == "MAT-021"
            and totals.cell(row=row_index, column=3).value == "General"
        )
        quantity_formula = totals.cell(row=general_row, column=5).value
        self.assertTrue(quantity_formula.startswith("=IF(COUNTIFS"))
        self.assertIn("SUMIFS('Por Instancia'!$G:$G", quantity_formula)


if __name__ == "__main__":
    unittest.main()


class CostModelExtrasExportTests(unittest.TestCase):
    setUp = CostModelExportAdjustmentTests.setUp

    def test_included_materials_outside_the_bom_get_their_own_sheet(self) -> None:
        output = BytesIO()
        build_cost_model_workbook(self.project_data, output, prices_by_sku={}, extras=[
            {"sku": "PLAC0075", "name": "MDP 18MM", "unit": "UN", "quantity_per_house": 11.4, "unit_cost": 24000,
             "value_per_house": 273600, "replaces_sku": "PLAC0003", "origin": "Reemplazo desde 2025-11-17"},
        ])
        output.seek(0)
        rows = list(load_workbook(output)["Fuera de presupuesto"].iter_rows(min_row=2, values_only=True))
        self.assertEqual(rows, [("MDP 18MM", "PLAC0075", 11.4, "UN", 24000, 273600, "PLAC0003", "Reemplazo desde 2025-11-17")])

    def test_no_sheet_without_extras(self) -> None:
        output = BytesIO()
        build_cost_model_workbook(self.project_data, output, prices_by_sku={})
        output.seek(0)
        self.assertNotIn("Fuera de presupuesto", load_workbook(output).sheetnames)
