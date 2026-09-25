from datetime import date, timedelta
import unittest

from app.services import consumption_study as cs

MONDAY = date(2026, 1, 5)


def week(index: int, day: int = 0) -> date:
    return MONDAY + timedelta(days=7 * index + day)


def houses(project_id, subtype_id, quantities, weeks, per_week=5):
    return [cs.House(day=week(w), project_id=project_id, subtype_id=subtype_id, quantities=quantities)
            for w in weeks for _ in range(per_week)]


def daily(sku, weekly_quantity, weeks, center="04-16-16", value_per_unit=10.0):
    """Spread each week's withdrawals over its five business days."""
    rows = []
    for w in weeks:
        quantity = weekly_quantity(w) if callable(weekly_quantity) else weekly_quantity
        for day in range(5):
            rows.append(cs.Withdrawal(sku, week(w, day), center, quantity / 5, quantity / 5 * value_per_unit))
    return rows


def study(project_id, start, end, all_houses, withdrawals, target, **kwargs):
    return cs.study_project(
        project_id=project_id, start=start, end=end, houses=all_houses, withdrawals=withdrawals,
        target_quantities=target, site_share=kwargs.pop("site_share", {}), data_start=kwargs.pop("data_start", week(-30)),
        **kwargs,
    )


def material(result, sku):
    return next(item for item in result["materials"] if item["sku"] == sku)


class CostCenterRulesTests(unittest.TestCase):
    def test_area_site_and_exact_rules(self):
        self.assertTrue(cs.is_excluded("06-01-01", ["06"]))
        self.assertFalse(cs.is_excluded("04-06-06", ["06"]))
        self.assertTrue(cs.is_excluded("04-34-34", ["*-34"]))
        self.assertTrue(cs.is_excluded("04-16-16", ["04-16-16"]))
        self.assertFalse(cs.is_excluded("04-16-16", ["04-16-17", "*-41"]))


class SteadyProductionTests(unittest.TestCase):
    def setUp(self):
        # 5 houses a week for 20 weeks, 10 units each: 50 units a week expected.
        self.houses = houses(1, 11, {"MAT": 10}, range(20))
        self.target = {11: {"MAT": 10}, 12: {"MAT": 4}}

    def test_ratio_applies_to_each_subtype_and_is_trusted(self):
        result = study(1, week(4), week(15, 4), self.houses, daily("MAT", 60, range(20)), self.target)
        item = material(result, "MAT")
        self.assertAlmostEqual(item["ratio"], 1.2, places=3)
        self.assertEqual(item["quantity_per_house"], {"11": 12.0, "12": 4.8})
        self.assertEqual(item["grade"], "high", item["reasons"])
        self.assertEqual(item["suggestion"], "historic")
        self.assertEqual(result["houses"]["target"], 60)

    def test_close_to_the_estimate_keeps_the_estimate(self):
        result = study(1, week(4), week(15, 4), self.houses, daily("MAT", 52, range(20)), self.target)
        self.assertEqual(material(result, "MAT")["suggestion"], "estimated")

    def test_houses_started_before_the_period_still_consume_inside_it(self):
        # Production stops at week 10; the period starts there. Houses of week
        # 9 still withdraw their second and third weeks, and those of week 8
        # their third.
        tail = houses(1, 11, {"MAT": 10}, range(10))
        result = study(1, week(10), week(13, 4), tail, [], self.target)
        expected = material(result, "MAT")["expected"]
        self.assertAlmostEqual(expected, 50 * (cs.FACTORY_PROFILE[1] + 2 * cs.FACTORY_PROFILE[2]), places=3)

    def test_lumpy_monthly_withdrawals_are_not_trusted(self):
        monthly = [cs.Withdrawal("MAT", week(w), "04-16-16", 60 * 4) for w in range(0, 20, 4)]
        item = material(study(1, week(4), week(15, 4), self.houses, monthly, self.target), "MAT")
        self.assertIn("lumpy", item["reasons"])
        self.assertNotEqual(item["grade"], "high")

    def test_excluded_cost_centers_do_not_count(self):
        withdrawals = daily("MAT", 50, range(20)) + daily("MAT", 50, range(20), center="07-01-01")
        item = material(study(1, week(4), week(15, 4), self.houses, withdrawals, self.target, excluded_cost_centers=["07"]), "MAT")
        self.assertAlmostEqual(item["ratio"], 1.0, places=3)

    def test_materials_withdrawn_mostly_in_excluded_centers_get_no_reference(self):
        withdrawals = daily("MAT", 10, range(20)) + daily("MAT", 50, range(20), center="11-16-16")
        item = material(study(1, week(4), week(15, 4), self.houses, withdrawals, self.target,
                              excluded_cost_centers=["11"], excluded_share={"MAT": 50 / 60}), "MAT")
        self.assertEqual((item["grade"], item["reasons"], item["quantity_per_house"]), ("none", ["excluded_centers"], {}))

    def test_incomplete_bom_gives_no_reference(self):
        incomplete = [cs.House(day=h.day, project_id=1, subtype_id=11, quantities=h.quantities, incomplete_skus=frozenset({"MAT"})) for h in self.houses]
        item = material(study(1, week(4), week(15, 4), incomplete, daily("MAT", 60, range(20)), self.target), "MAT")
        self.assertEqual(item["grade"], "none")
        self.assertEqual(item["quantity_per_house"], {})


class SharedProductionTests(unittest.TestCase):
    def test_separates_the_project_when_the_mix_varies(self):
        # Project 1 ramps down while project 2 ramps up; project 1 consumes 1.5x
        # its BOM and project 2 exactly its BOM.
        mix = houses(1, 11, {"MAT": 10}, range(0, 10), per_week=6) + houses(1, 11, {"MAT": 10}, range(10, 20), per_week=2)
        mix += houses(2, 21, {"MAT": 10}, range(0, 10), per_week=2) + houses(2, 21, {"MAT": 10}, range(10, 20), per_week=6)

        def consumption(w):
            target = 6 if w < 10 else 2
            return (target * 1.5 + (8 - target)) * 10

        result = study(1, week(2), week(19, 4), mix, daily("MAT", consumption, range(22)), {11: {"MAT": 10}})
        item = material(result, "MAT")
        self.assertEqual(item["method"], "separated")
        self.assertAlmostEqual(item["ratio"], 1.5, delta=0.1)
        self.assertLess(item["pooled_ratio"], 1.4)

    def test_simultaneous_projects_fall_back_to_the_pooled_ratio(self):
        mix = houses(1, 11, {"MAT": 10}, range(20), per_week=3) + houses(2, 21, {"MAT": 10}, range(20), per_week=3)
        item = material(study(1, week(2), week(17, 4), mix, daily("MAT", 72, range(20)), {11: {"MAT": 10}}), "MAT")
        self.assertEqual(item["method"], "pooled")
        self.assertIn("shared_production", item["reasons"])


class SubstitutionTests(unittest.TestCase):
    def test_a_replaced_material_breaks_and_its_substitute_is_unbudgeted(self):
        production = houses(1, 11, {"PUER0140": 1}, range(20))
        withdrawals = daily("PUER0140", lambda w: 5 if w < 10 else 0, range(20), value_per_unit=70000)
        withdrawals += daily("PUER0145", lambda w: 0 if w < 10 else 5, range(20), value_per_unit=70000)
        names = {"PUER0140": "PUERTA TERMINADA 750X2000 MARCO PINO", "PUER0145": "PUERTA TERMINADA 750X2000 MARCO FINGER"}
        result = study(1, week(2), week(17, 4), production, withdrawals, {11: {"PUER0140": 1}}, names=names)
        item = material(result, "PUER0140")
        self.assertIn("change_point", item["reasons"])
        self.assertEqual(item["grade"], "low")
        self.assertEqual(item["signals"]["stability"]["change_week"], week(10).isoformat())
        unbudgeted = next(entry for entry in result["unbudgeted"] if entry["sku"] == "PUER0145")
        self.assertEqual([candidate["sku"] for candidate in unbudgeted["replaces"]], ["PUER0140"])
        self.assertGreater(unbudgeted["value_per_house"], 0)

    def test_a_mid_project_switch_is_paired_by_timing_even_without_shared_names(self):
        # Jardines de San Pedro switched its OSB floor for MDP halfway. One house
        # of another project that budgets MDP does not explain the MDP withdrawn.
        production = houses(1, 11, {"PLAC0003": 24}, range(20)) + [cs.House(day=week(12), project_id=2, subtype_id=21, quantities={"PLAC0075": 7})]
        withdrawals = daily("PLAC0003", lambda w: 120 if w < 10 else 5, range(20), value_per_unit=22000)
        withdrawals += daily("PLAC0075", lambda w: 0 if w < 10 else 110, range(20), value_per_unit=24000)
        names = {"PLAC0003": "LP OSB PISO TOP NOTCH 18MM", "PLAC0075": "MDP 18MM P5"}
        result = study(1, week(2), week(17, 4), production, withdrawals, {11: {"PLAC0003": 24}}, names=names, units={"PLAC0003": "UN", "PLAC0075": "UN"})
        item = material(result, "PLAC0003")
        self.assertIn("change_point", item["reasons"])
        mdp = next(entry for entry in result["unbudgeted"] if entry["sku"] == "PLAC0075")
        self.assertGreater(mdp["explained_elsewhere"], 0)
        [replacement] = mdp["replaces"]
        self.assertEqual((replacement["sku"], replacement["evidence"], replacement["since_week"]), ("PLAC0003", "switch", week(10).isoformat()))
        self.assertAlmostEqual(replacement["quantity_per_house_since"], 22, delta=1.5)

    def test_a_switch_needs_the_same_unit(self):
        production = houses(1, 11, {"PLAC0003": 24}, range(20))
        withdrawals = daily("PLAC0003", lambda w: 120 if w < 10 else 5, range(20), value_per_unit=22000)
        withdrawals += daily("PLAC0099", lambda w: 0 if w < 10 else 110, range(20), value_per_unit=24000)
        result = study(1, week(2), week(17, 4), production, withdrawals, {11: {"PLAC0003": 24}}, units={"PLAC0003": "UN", "PLAC0099": "M2"})
        self.assertEqual(next(entry for entry in result["unbudgeted"] if entry["sku"] == "PLAC0099")["replaces"], [])

    def test_unrelated_names_are_not_paired(self):
        production = houses(1, 11, {"PUER0140": 1}, range(20))
        withdrawals = daily("PUER0140", 2, range(20), value_per_unit=70000) + daily("PUER0199", 3, range(20), value_per_unit=70000)
        names = {"PUER0140": "PUERTA FIBRA", "PUER0199": "CERRADURA SOBREPONER"}
        result = study(1, week(2), week(17, 4), production, withdrawals, {11: {"PUER0140": 1}}, names=names)
        self.assertEqual(next(entry for entry in result["unbudgeted"] if entry["sku"] == "PUER0199")["replaces"], [])


class SiteStreamTests(unittest.TestCase):
    def test_site_materials_are_expected_months_after_the_start(self):
        production = houses(1, 11, {"GRIF": 1}, range(4))
        result = study(1, week(0), week(3, 4), production, [], {11: {"GRIF": 1}}, site_share={"GRIF": 1.0})
        self.assertEqual(material(result, "GRIF")["expected"], 0)
        later = study(1, week(5), week(30, 4), production, [], {11: {"GRIF": 1}}, site_share={"GRIF": 1.0})
        self.assertAlmostEqual(material(later, "GRIF")["expected"], 20, places=3)


class PeriodSuggestionTests(unittest.TestCase):
    def test_picks_the_stretch_the_project_dominates(self):
        production = houses(1, 11, {}, range(0, 12)) + houses(2, 21, {}, range(10, 25))
        start, end = cs.suggest_period(production, 1, data_start=week(-20))
        self.assertEqual(start, week(0))
        self.assertIn(end, {week(10, 4), week(11, 4)})

    def test_skips_weeks_right_after_production_data_begins(self):
        production = houses(1, 11, {}, range(0, 12))
        start, _end = cs.suggest_period(production, 1, data_start=week(0))
        self.assertEqual(start, week(3))


if __name__ == "__main__":
    unittest.main()


class MaterialSeriesTests(unittest.TestCase):
    def test_series_totals_match_the_study(self):
        # Two subtypes, another project, a partial window and weekend and excluded withdrawals.
        all_houses = houses(1, 10, {"A": 4.0}, range(0, 8)) + houses(1, 11, {"A": 6.0}, range(2, 8), per_week=3) + houses(2, None, {"A": 5.0}, range(0, 8), per_week=2)
        withdrawals = daily("A", 60.0, range(0, 10)) + daily("A", 9.0, range(0, 10), center="11-16-16") + daily("A", 7.0, range(0, 10), center="05-01-01") + daily("B", 3.0, range(0, 10))
        withdrawals.append(cs.Withdrawal("A", week(4, 5), "04-16-16", 12.0))
        start, end = week(1, 2), week(8, 3)
        site = cs.site_shares(row for row in withdrawals if not cs.is_excluded(row.cost_center, ["05"]))
        result = study(1, start, end, all_houses, withdrawals, {10: {"A": 4.0}, 11: {"A": 6.0}}, site_share=site, excluded_cost_centers=["05"])
        points = cs.material_series(project_id=1, sku="A", start=start, end=end, houses=all_houses, withdrawals=withdrawals,
                                    site_share=site["A"], excluded_cost_centers=["05"])
        reference = material(result, "A")
        total = lambda name: sum(point[name] for point in points)
        self.assertAlmostEqual(total("actual"), reference["actual"], places=4)
        self.assertAlmostEqual(total("expected_target"), reference["expected_target"], places=3)
        self.assertAlmostEqual(total("expected_target") + total("expected_other"), reference["expected"], places=3)
        self.assertEqual(total("target_starts"), result["houses"]["target"])
        self.assertTrue(all(date.fromisoformat(point["date"]).weekday() < 5 for point in points))
        # Weekend withdrawals land on the Friday before.
        friday = next(point for point in points if point["date"] == week(4, 4).isoformat())
        self.assertGreater(friday["actual"], 60.0 / 5 + 9.0 / 5)

    def test_equivalent_houses_give_the_bom_per_house(self):
        all_houses = houses(1, None, {"A": 4.0}, range(0, 12))
        points = cs.material_series(project_id=1, sku="A", start=week(3), end=week(8, 4), houses=all_houses,
                                    withdrawals=[], site_share=0.0)
        expected = sum(point["expected_target"] for point in points)
        self.assertAlmostEqual(expected / sum(point["equivalent_houses"] for point in points), 4.0)
