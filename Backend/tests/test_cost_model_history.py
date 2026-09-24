from copy import deepcopy
import unittest

from app.services.cost_model_history import build_cost_model_history


class CostModelHistoryTests(unittest.TestCase):
    def setUp(self):
        self.production = {"range_start": "2026-07-01", "range_end": "2026-07-31", "houses": [
            {"mapped": True, "mapped_project_id": 1, "mapped_project_subtype_id": 8, "missing_quantity_count": 0},
            {"mapped": True, "mapped_project_id": 1, "mapped_project_subtype_id": 9, "missing_quantity_count": 0},
        ]}
        self.expected = {1: {"general": {"MAT": 2}, "by_subtype": {8: {"MAT": 3}, 9: {"MAT": 13}}}}
        self.materials = [{"sku": "MAT", "movement_quantity_60d": 24}]

    def result(self, subtype=8):
        return build_cost_model_history(project_id=1, subtype_id=subtype, production=self.production,
                                        expected_maps=self.expected, materials=self.materials)

    def test_allocates_across_the_whole_production_mix(self):
        a = self.result()["references"][0]
        b = self.result(9)["references"][0]
        self.assertEqual(a["quantity_per_house"], 6)
        self.assertEqual(b["quantity_per_house"], 18)
        self.assertEqual(a["allocated_consumption"] + b["allocated_consumption"], 24)
        self.assertEqual(a["factory_expected_consumption"], 20)

    def test_weights_by_house_count(self):
        self.production["houses"].append(deepcopy(self.production["houses"][0]))
        self.materials[0]["movement_quantity_60d"] = 30
        result = self.result()
        self.assertEqual(result["sample_houses"], 2)
        self.assertEqual(result["references"][0]["quantity_per_house"], 6)
        self.assertEqual(result["references"][0]["allocated_consumption"], 12)

    def test_missing_links_or_incomplete_budgets_do_not_produce_a_false_reference(self):
        self.production["houses"][1]["mapped"] = False
        self.assertEqual(self.result()["blocked_reason"], "unmapped_houses")
        self.assertIsNone(self.result()["references"][0]["quantity_per_house"])
        self.production["houses"][1]["mapped"] = True
        self.production["houses"][1]["missing_quantity_count"] = 1
        self.assertEqual(self.result()["blocked_reason"], "incomplete_budgets")

    def test_a_small_share_of_unmapped_houses_does_not_block_the_reference(self):
        linked = self.production["houses"][0]
        self.production["houses"] = [deepcopy(linked) for _ in range(20)] + [{"mapped": False}]
        result = self.result()
        self.assertIsNone(result["blocked_reason"])
        self.assertEqual(result["unmapped_houses"], 1)
        self.assertIsNotNone(result["references"][0]["quantity_per_house"])
        self.production["houses"].append({"mapped": False})
        self.assertEqual(self.result()["blocked_reason"], "unmapped_houses")

    def test_requires_a_sample_of_the_selected_subtype(self):
        self.assertEqual(self.result(10)["blocked_reason"], "no_sample")

    def test_incomplete_material_does_not_block_unrelated_materials(self):
        self.production["houses"][1]["missing_quantity_count"] = 1
        self.expected[1]["missing_skus_by_subtype"] = {9: ["OTHER"]}
        self.assertEqual(self.result()["references"][0]["quantity_per_house"], 6)
        self.expected[1]["missing_skus_by_subtype"][9] = ["MAT"]
        self.assertEqual(self.result()["references"][0]["reason"], "incomplete_material")
        self.assertIsNone(self.result()["references"][0]["quantity_per_house"])

    def test_missing_movements_are_not_zero_consumption(self):
        self.materials = []
        self.assertIsNone(self.result()["references"][0]["quantity_per_house"])
        self.materials = [{"sku": "MAT", "movement_quantity_60d": 0}]
        self.assertEqual(self.result()["references"][0]["quantity_per_house"], 0)

    def test_cannot_allocate_material_without_an_estimated_basis(self):
        self.expected[1]["general"] = {"MAT": 0}
        self.expected[1]["by_subtype"][8] = {"MAT": 0}
        self.assertEqual(self.result()["references"][0]["reason"], "no_allocation_basis")
