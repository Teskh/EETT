from __future__ import annotations

import importlib.util
from pathlib import Path
import sqlite3
from types import SimpleNamespace
import unittest


BACKEND_DIR = Path(__file__).resolve().parents[1]
SCRIPT_PATH = BACKEND_DIR / "scripts" / "import_legacy_sqlite.py"
SPEC = importlib.util.spec_from_file_location("import_legacy_sqlite", SCRIPT_PATH)
assert SPEC is not None and SPEC.loader is not None
legacy_import = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(legacy_import)


class LegacyImportDecisionTests(unittest.TestCase):
    def test_source_database_integrity_check_passes_for_valid_sqlite(self) -> None:
        connection = sqlite3.connect(":memory:")
        try:
            connection.execute("CREATE TABLE sample (id INTEGER PRIMARY KEY, value TEXT)")
            connection.execute("INSERT INTO sample (value) VALUES ('ok')")
            self.assertEqual(legacy_import.sqlite_integrity_check(connection), (True, "ok"))
        finally:
            connection.close()

    def test_text_report_records_validation_cleanup_and_redacts_password(self) -> None:
        report = legacy_import.MigrationReport(
            main_db=BACKEND_DIR / "scripts" / "main.db",
            projects_db=BACKEND_DIR / "scripts" / "projects.db",
            target_url="postgresql://migration_user:secret@example.test/spec_sheets",
            dry_run=True,
        )
        report.status = "dry run passed; database rolled back"
        report.validate("BOM rows after cleanup", True, "expected 2394, imported 2394")
        report.add("Duplicate BOM cleanup", "Kept bom_id 882 and ignored bom_id 883.")

        rendered = report.render(stats={"bom_entries": 2394}, warnings=["One uncertain link."])

        self.assertIn("Status: dry run passed; database rolled back", rendered)
        self.assertIn("PASS: BOM rows after cleanup", rendered)
        self.assertIn("Kept bom_id 882 and ignored bom_id 883", rendered)
        self.assertIn("One uncertain link", rendered)
        self.assertIn("postgresql://migration_user:***@example.test/spec_sheets", rendered)
        self.assertNotIn(":secret@", rendered)

    def test_numeric_choice_lists_remain_selects(self) -> None:
        self.assertEqual(
            legacy_import.guess_attribute_value_type(["1", "2"]).value,
            "select",
        )
        self.assertEqual(legacy_import.guess_attribute_value_type(["2.5"]).value, "number")

    def test_image_values_are_normalized_to_uris_without_file_copying(self) -> None:
        self.assertEqual(legacy_import.normalize_legacy_image_uri("door.png"), "/static/images/door.png")
        self.assertEqual(
            legacy_import.normalize_legacy_image_uri("database_editor\\static\\images\\door.png"),
            "/static/images/door.png",
        )
        self.assertEqual(
            legacy_import.normalize_legacy_image_uri("https://example.test/door.png"),
            "https://example.test/door.png",
        )

    def test_explicit_material_mode_selects_active_rows_without_losing_dormant_rows(self) -> None:
        general = SimpleNamespace(subtype_id=None)
        subtype_a = SimpleNamespace(subtype_id=1)
        subtype_b = SimpleNamespace(subtype_id=2)
        rows = [general, subtype_a, subtype_b]

        self.assertEqual(
            legacy_import.MaterialMode.GENERAL.value,
            "general",
        )
        from app.services.projects import _active_entries_for_mode, _material_mode_for_entries

        self.assertEqual(_material_mode_for_entries(rows, "general"), "general")
        self.assertEqual(_active_entries_for_mode(rows, "general"), [general])
        self.assertEqual(_active_entries_for_mode(rows, "per_subtype"), [subtype_a, subtype_b])

    def test_checked_in_duplicate_bom_rows_keep_the_values_used_by_legacy_editor(self) -> None:
        database_path = BACKEND_DIR / "scripts" / "projects.db"
        connection = sqlite3.connect(database_path)
        connection.row_factory = sqlite3.Row
        try:
            rows = list(
                connection.execute(
                    """
                    SELECT bom_id, project_id, subtype_id, material_id, quantity, assembly_kit,
                           item_instance_id, accessory_instance_id
                    FROM Bill_Of_Materials
                    ORDER BY bom_id
                    """
                ).fetchall()
            )
        finally:
            connection.close()

        kept, duplicates = legacy_import.deduplicate_bom_rows(rows)
        kept_by_key = {legacy_import.bom_identity(row): row for row in kept}

        self.assertEqual(len(duplicates), 2)
        self.assertEqual(kept_by_key[(32, None, 1297, 272, None)]["quantity"], 0)
        self.assertEqual(kept_by_key[(36, None, 110, 358, None)]["quantity"], 26)


if __name__ == "__main__":
    unittest.main()
