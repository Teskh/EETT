from __future__ import annotations

import os
import unittest
from datetime import date

from app.services.house_type_links import (
    _fingerprint_part_sort_key,
    build_mapped_house_comparison,
    expected_quantities_for_link,
    resolve_house_type_link,
    study_quantity_for_link,
)
from app.services.production_dashboard import build_house_start_grid


GENERAL_LINK = {
    "production_house_type_id": 1,
    "production_sub_type_id": None,
    "project_id": 10,
    "project_subtype_id": None,
}
SUBTYPE_LINK = {
    "production_house_type_id": 1,
    "production_sub_type_id": 5,
    "project_id": 10,
    "project_subtype_id": 77,
}

EXPECTED_MAPS = {
    10: {
        "project_id": 10,
        "project_name": "Casa 54",
        "general": {"SKU-A": 2.0, "SKU-B": 1.5},
        "by_subtype": {77: {"SKU-A": 0.5, "SKU-C": 3.0}},
    },
}


class ResolveLinkTests(unittest.TestCase):
    def test_sub_type_link_wins_over_general(self) -> None:
        links = {(1, None): GENERAL_LINK, (1, 5): SUBTYPE_LINK}
        self.assertIs(resolve_house_type_link(links, 1, 5), SUBTYPE_LINK)

    def test_falls_back_to_general_when_sub_type_not_linked(self) -> None:
        links = {(1, None): GENERAL_LINK}
        self.assertIs(resolve_house_type_link(links, 1, 5), GENERAL_LINK)
        self.assertIs(resolve_house_type_link(links, 1, None), GENERAL_LINK)

    def test_unlinked_house_type_resolves_to_none(self) -> None:
        links = {(1, None): GENERAL_LINK}
        self.assertIsNone(resolve_house_type_link(links, 2, None))


class ExpectedQuantityTests(unittest.TestCase):
    def test_general_link_uses_only_common_quantities(self) -> None:
        self.assertEqual(
            expected_quantities_for_link(GENERAL_LINK, EXPECTED_MAPS),
            {"SKU-A": 2.0, "SKU-B": 1.5},
        )

    def test_subtype_link_adds_subtype_quantities_to_general(self) -> None:
        # "General" means common across subtypes: a subtype house consumes
        # the general quantities plus its subtype-specific ones.
        self.assertEqual(
            expected_quantities_for_link(SUBTYPE_LINK, EXPECTED_MAPS),
            {"SKU-A": 2.5, "SKU-B": 1.5, "SKU-C": 3.0},
        )

    def test_study_quantity_applies_sku_factors(self) -> None:
        self.assertEqual(study_quantity_for_link(SUBTYPE_LINK, EXPECTED_MAPS, {"SKU-A": 1.0}), 2.5)
        self.assertEqual(
            study_quantity_for_link(SUBTYPE_LINK, EXPECTED_MAPS, {"SKU-A": 2.0, "SKU-C": 1.0}),
            8.0,
        )
        self.assertEqual(study_quantity_for_link(SUBTYPE_LINK, EXPECTED_MAPS, {"OTHER": 1.0}), 0.0)


class FingerprintTests(unittest.TestCase):
    def test_sort_key_handles_general_and_subtype_links(self) -> None:
        parts = [
            (1, 5, 10, 77),
            (1, None, 10, None),
            (2, None, 11, None),
        ]
        self.assertEqual(
            sorted(parts, key=_fingerprint_part_sort_key),
            [
                (1, None, 10, None),
                (1, 5, 10, 77),
                (2, None, 11, None),
            ],
        )


class HouseStartGridTests(unittest.TestCase):
    def test_grid_collapses_houses_by_day_type_and_sub_type(self) -> None:
        houses = [
            {"start_date": "2026-06-01", "house_type_id": 1, "house_type_name": "T54", "sub_type_id": None, "sub_type_name": None},
            {"start_date": "2026-06-01", "house_type_id": 1, "house_type_name": "T54", "sub_type_id": None, "sub_type_name": None},
            {"start_date": "2026-06-01", "house_type_id": 1, "house_type_name": "T54", "sub_type_id": 5, "sub_type_name": "A"},
            {"start_date": "2026-06-02", "house_type_id": 2, "house_type_name": "T60", "sub_type_id": None, "sub_type_name": None},
        ]
        grid = build_house_start_grid(houses)
        self.assertEqual(
            [(row["date"], row["house_type_id"], row["sub_type_id"], row["house_starts"]) for row in grid],
            [("2026-06-01", 1, None, 2), ("2026-06-01", 1, 5, 1), ("2026-06-02", 2, None, 1)],
        )


class IndividualHouseStartGridTests(unittest.TestCase):
    def test_grid_preserves_work_order_identity_and_excludes_planned_houses(self) -> None:
        from app.services.production_dashboard import build_individual_house_start_grid

        grid = build_individual_house_start_grid(
            [
                {
                    "work_order_id": 41,
                    "start_date": "2026-08-01",
                    "house_type_id": 1,
                    "house_type_name": "T54",
                    "sub_type_id": 5,
                    "sub_type_name": "A",
                },
                {
                    "work_order_id": 42,
                    "start_date": None,
                    "planned_start_date": "2026-08-10",
                    "house_type_id": 1,
                    "house_type_name": "T54",
                    "sub_type_id": None,
                    "sub_type_name": None,
                },
            ]
        )
        self.assertEqual(len(grid), 1)
        self.assertEqual(grid[0]["work_order_id"], 41)
        self.assertEqual(grid[0]["house_starts"], 1)


class MappedComparisonTests(unittest.TestCase):
    def build(self, **overrides):
        params = {
            "movements": [
                {"date": "2026-06-01", "quantity": 10.0},
                {"date": "2026-06-02", "quantity": 4.0},
            ],
            "start_grid": [
                {
                    "date": "2026-06-01",
                    "house_type_id": 1,
                    "house_type_name": "T54",
                    "sub_type_id": 5,
                    "sub_type_name": "A",
                    "house_starts": 2,
                },
                {
                    "date": "2026-06-02",
                    "house_type_id": 1,
                    "house_type_name": "T54",
                    "sub_type_id": None,
                    "sub_type_name": None,
                    "house_starts": 1,
                },
                {
                    "date": "2026-06-02",
                    "house_type_id": 9,
                    "house_type_name": "T99",
                    "sub_type_id": None,
                    "sub_type_name": None,
                    "house_starts": 3,
                },
            ],
            "links_by_key": {(1, None): GENERAL_LINK, (1, 5): SUBTYPE_LINK},
            "expected_maps": EXPECTED_MAPS,
            "sku_factors": {"SKU-A": 1.0},
            "start_day": date(2026, 6, 1),
            "end_day": date(2026, 6, 3),
        }
        params.update(overrides)
        return build_mapped_house_comparison(**params)

    def test_totals_split_mapped_and_unmapped_starts(self) -> None:
        result = self.build()
        self.assertEqual(result["total_house_starts"], 6)
        self.assertEqual(result["total_mapped_house_starts"], 3)
        self.assertEqual(result["total_unmapped_house_starts"], 3)
        # Two subtype-A houses (2.5 each of SKU-A) + one general house (2.0).
        self.assertEqual(result["total_expected_material_quantity"], 7.0)
        self.assertEqual(result["total_material_quantity"], 14.0)
        self.assertEqual(result["material_per_house"], round(14.0 / 6, 4))
        self.assertEqual(result["expected_material_per_mapped_house"], round(7.0 / 3, 4))
        self.assertEqual(
            [
                (
                    row["house_type_name"],
                    row["sub_type_name"],
                    row["house_starts"],
                    row["expected_quantity_per_house"],
                    row["total_expected_material_quantity"],
                )
                for row in result["expected_breakdown"]
            ],
            [
                ("T54", "A", 2, 2.5, 5.0),
                ("T54", None, 1, 2.0, 2.0),
            ],
        )

    def test_unmapped_summary_reports_house_types_without_link(self) -> None:
        result = self.build()
        self.assertEqual(
            result["unmapped_summary"],
            [
                {
                    "house_type_id": 9,
                    "house_type_name": "T99",
                    "sub_type_id": None,
                    "sub_type_name": None,
                    "house_starts": 3,
                    "reason": "unmapped",
                    "missing_quantity_count": 0,
                }
            ],
        )
        self.assertEqual(result["mapped_projects"], [{"project_id": 10, "project_name": "Casa 54"}])

    def test_incomplete_bom_link_still_contributes_the_quantities_defined_so_far(self) -> None:
        expected_maps = {
            **EXPECTED_MAPS,
            10: {**EXPECTED_MAPS[10], "missing_by_subtype": {None: 0, 77: 2}},
        }
        result = self.build(expected_maps=expected_maps)
        # The two subtype-A houses keep contributing 2.5 each even though the
        # subtype BOM still has two undefined quantities.
        self.assertEqual(result["total_mapped_house_starts"], 3)
        self.assertEqual(result["total_partial_house_starts"], 2)
        self.assertEqual(result["total_expected_material_quantity"], 7.0)
        self.assertEqual([row["house_type_id"] for row in result["unmapped_summary"]], [9])
        partial = next(row for row in result["partial_summary"] if row["house_type_id"] == 1)
        self.assertEqual(partial["reason"], "incomplete_bom")
        self.assertEqual(partial["missing_quantity_count"], 2)
        self.assertEqual(partial["house_starts"], 2)
        subtype_breakdown = next(row for row in result["expected_breakdown"] if row["sub_type_id"] == 5)
        self.assertEqual(subtype_breakdown["missing_quantity_count"], 2)

    def test_complete_links_report_no_partial_starts(self) -> None:
        result = self.build()
        self.assertEqual(result["total_partial_house_starts"], 0)
        self.assertEqual(result["partial_summary"], [])
        self.assertTrue(all(point["partial_house_starts"] == 0 for point in result["points"]))

    def test_points_cover_full_window_with_cumulatives(self) -> None:
        result = self.build()
        self.assertEqual(len(result["points"]), 3)
        first, second, third = result["points"]
        self.assertEqual(first["expected_material_quantity"], 5.0)
        self.assertEqual(first["mapped_house_starts"], 2)
        self.assertEqual(first["expected_breakdown"][0]["house_starts"], 2)
        self.assertEqual(first["expected_breakdown"][0]["expected_quantity_per_house"], 2.5)
        self.assertEqual(second["expected_material_quantity"], 2.0)
        self.assertEqual(second["house_starts"], 4)
        self.assertEqual(second["mapped_house_starts"], 1)
        self.assertEqual(second["expected_breakdown"][0]["house_starts"], 1)
        self.assertEqual(second["expected_breakdown"][0]["expected_quantity_per_house"], 2.0)
        self.assertEqual(second["cumulative_expected_material_quantity"], 7.0)
        self.assertEqual(second["cumulative_house_starts"], 6)
        # Day without any activity still yields a point with carried totals.
        self.assertEqual(third["material_quantity"], 0.0)
        self.assertEqual(third["expected_breakdown"], [])
        self.assertEqual(third["cumulative_material_quantity"], 14.0)
        self.assertEqual(result["latest_house_start_date"], "2026-06-02")

    def test_without_links_everything_is_unmapped_and_expected_is_zero(self) -> None:
        result = self.build(links_by_key={})
        self.assertEqual(result["total_mapped_house_starts"], 0)
        self.assertEqual(result["total_expected_material_quantity"], 0.0)
        self.assertIsNone(result["expected_material_per_mapped_house"])
        self.assertEqual(sum(row["house_starts"] for row in result["unmapped_summary"]), 6)


class HouseTypeLinkCrudTests(unittest.TestCase):
    """DB-backed round trip for the mapping table (needs the test Postgres)."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.test_database_url = os.getenv("SPEC_SHEETS_TEST_DATABASE_URL")
        if not cls.test_database_url:
            raise unittest.SkipTest("SPEC_SHEETS_TEST_DATABASE_URL is not set")

    def setUp(self) -> None:
        from sqlalchemy.orm import sessionmaker

        from app.database import Base, create_engine_for_url
        from app.seed import seed_demo_data_if_empty

        self.engine = create_engine_for_url(self.test_database_url)
        self.session_factory = sessionmaker(bind=self.engine, autoflush=False, expire_on_commit=False)
        Base.metadata.drop_all(self.engine)
        Base.metadata.create_all(self.engine)
        seed_demo_data_if_empty(self.session_factory)

    def tearDown(self) -> None:
        self.engine.dispose()

    def test_replace_round_trip_and_fingerprint(self) -> None:
        from sqlalchemy import select

        from app.models import Project
        from app.services.house_type_links import (
            house_type_links_fingerprint,
            list_house_type_links,
            replace_house_type_links,
        )

        with self.session_factory() as session:
            project = session.scalars(select(Project)).first()
            self.assertIsNotNone(project)
            before = house_type_links_fingerprint(session)
            saved = replace_house_type_links(
                session,
                [
                    {
                        "production_house_type_id": 1,
                        "production_sub_type_id": None,
                        "production_house_type_name": "T54",
                        "project_id": project.id,
                        "project_subtype_id": None,
                    }
                ],
            )
            session.commit()
            self.assertEqual(len(saved), 1)
            self.assertEqual(saved[0]["project_name"], project.name)
            self.assertNotEqual(house_type_links_fingerprint(session), before)
            self.assertEqual(len(list_house_type_links(session)), 1)

    def test_replace_validates_duplicates_and_unknown_project(self) -> None:
        from app.services.house_type_links import replace_house_type_links

        with self.session_factory() as session:
            with self.assertRaises(ValueError):
                replace_house_type_links(
                    session,
                    [
                        {"production_house_type_id": 1, "project_id": 999999},
                    ],
                )
            with self.assertRaises(ValueError):
                replace_house_type_links(
                    session,
                    [
                        {"production_house_type_id": 1, "project_id": 1},
                        {"production_house_type_id": 1, "project_id": 1},
                    ],
                )


if __name__ == "__main__":
    unittest.main()
