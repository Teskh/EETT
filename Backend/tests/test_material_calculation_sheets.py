from __future__ import annotations

import os
import tempfile
import unittest

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import sessionmaker

from app.config import Settings
from app.database import Base, create_engine_for_url
from app.main import create_app
from app.models import ProjectInstance, ProjectMaterialCalculationCell, ProjectMaterialCalculationSheet
from app.seed import seed_demo_data_if_empty


class MaterialCalculationSheetTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.test_database_url = os.getenv("SPEC_SHEETS_TEST_DATABASE_URL")
        if not cls.test_database_url:
            raise unittest.SkipTest("SPEC_SHEETS_TEST_DATABASE_URL is not set")

    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.settings = Settings(
            database_url=self.test_database_url,
            seed_demo_data=True,
            environment="test",
            allow_trusted_user_header=True,
        )
        self.engine = create_engine_for_url(self.settings.database_url)
        self.session_factory = sessionmaker(bind=self.engine, autoflush=False, expire_on_commit=False)
        Base.metadata.drop_all(self.engine)
        Base.metadata.create_all(self.engine)
        seed_demo_data_if_empty(self.session_factory)
        self.app = create_app(
            Settings(
                database_url=self.test_database_url,
                seed_demo_data=False,
                require_schema=True,
                environment="test",
                allow_trusted_user_header=True,
            )
        )
        self.client = TestClient(self.app)

    def tearDown(self) -> None:
        self.client.close()
        self.engine.dispose()
        self.temp_dir.cleanup()

    def _get_demo_material_payload(self) -> dict[str, int | str]:
        response = self.client.get("/api/v1/projects/2", headers={"X-Spec-Sheets-User": "editor"})
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        door_section = next(section for section in payload["categories"] if section["name"] == "Doors")
        door_instance = next(instance for instance in door_section["instances"] if instance["name"] == "Door A")
        material = door_instance["materials"][0]
        return {
            "instance_id": door_instance["id"],
            "instance_name": door_instance["name"],
            "rule_id": material["rule_id"],
            "material_id": material["material_id"],
            "sku": material["sku"],
            "material_name": material["material_name"],
        }

    def _get_demo_material_target(self) -> tuple[int, int, int]:
        payload = self._get_demo_material_payload()
        return int(payload["instance_id"]), int(payload["rule_id"]), int(payload["material_id"])

    def test_material_calculation_sheet_round_trip_persists_only_non_empty_cells(self) -> None:
        instance_id, rule_id, material_id = self._get_demo_material_target()

        empty_response = self.client.get(
            f"/api/v1/projects/2/instances/{instance_id}/materials/{rule_id}/calculation-sheet",
            headers={"X-Spec-Sheets-User": "editor"},
        )
        self.assertEqual(empty_response.status_code, 200)
        self.assertEqual(empty_response.json()["cell_count"], 0)

        payload = {
            "cells": [
                {"row_index": 0, "column_index": 0, "raw_input": "5"},
                {"row_index": 0, "column_index": 1, "raw_input": "7"},
                {"row_index": 0, "column_index": 2, "raw_input": "=A1+B1"},
                {"row_index": 4, "column_index": 2, "raw_input": "Perimeter sum"},
                {"row_index": 9, "column_index": 9, "raw_input": "   "},
            ]
        }
        save_response = self.client.put(
            f"/api/v1/projects/2/instances/{instance_id}/materials/{rule_id}/calculation-sheet",
            headers={"X-Spec-Sheets-User": "editor"},
            json=payload,
        )
        self.assertEqual(save_response.status_code, 200)
        saved_sheet = save_response.json()
        self.assertEqual(saved_sheet["cell_count"], 4)
        self.assertEqual(
            [(cell["row_index"], cell["column_index"], cell["raw_input"]) for cell in saved_sheet["cells"]],
            [
                (0, 0, "5"),
                (0, 1, "7"),
                (0, 2, "=A1+B1"),
                (4, 2, "Perimeter sum"),
            ],
        )

        reload_response = self.client.get(
            f"/api/v1/projects/2/instances/{instance_id}/materials/{rule_id}/calculation-sheet",
            headers={"X-Spec-Sheets-User": "editor"},
        )
        self.assertEqual(reload_response.status_code, 200)
        self.assertEqual(reload_response.json()["cell_count"], 4)

        with self.session_factory() as session:
            sheet = session.scalar(
                select(ProjectMaterialCalculationSheet).where(
                    ProjectMaterialCalculationSheet.project_id == 2,
                    ProjectMaterialCalculationSheet.instance_id == instance_id,
                    ProjectMaterialCalculationSheet.material_id == material_id,
                )
            )
            self.assertIsNotNone(sheet)
            assert sheet is not None
            persisted_cells = session.scalars(
                select(ProjectMaterialCalculationCell)
                .where(ProjectMaterialCalculationCell.sheet_id == sheet.id)
                .order_by(ProjectMaterialCalculationCell.row_index, ProjectMaterialCalculationCell.column_index)
            ).all()
            self.assertEqual(len(persisted_cells), 4)

    def test_material_calculation_sheet_is_removed_when_saved_cells_are_cleared(self) -> None:
        instance_id, rule_id, material_id = self._get_demo_material_target()

        create_response = self.client.put(
            f"/api/v1/projects/2/instances/{instance_id}/materials/{rule_id}/calculation-sheet",
            headers={"X-Spec-Sheets-User": "editor"},
            json={"cells": [{"row_index": 2, "column_index": 1, "raw_input": "=1+1"}]},
        )
        self.assertEqual(create_response.status_code, 200)
        self.assertEqual(create_response.json()["cell_count"], 1)

        clear_response = self.client.put(
            f"/api/v1/projects/2/instances/{instance_id}/materials/{rule_id}/calculation-sheet",
            headers={"X-Spec-Sheets-User": "editor"},
            json={"cells": [{"row_index": 2, "column_index": 1, "raw_input": "   "}]},
        )
        self.assertEqual(clear_response.status_code, 200)
        self.assertEqual(clear_response.json()["cell_count"], 0)

        with self.session_factory() as session:
            sheet = session.scalar(
                select(ProjectMaterialCalculationSheet).where(
                    ProjectMaterialCalculationSheet.project_id == 2,
                    ProjectMaterialCalculationSheet.instance_id == instance_id,
                    ProjectMaterialCalculationSheet.material_id == material_id,
                )
            )
            self.assertIsNone(sheet)

    def test_material_calculation_sheet_cascades_when_instance_is_deleted(self) -> None:
        instance_id, rule_id, _material_id = self._get_demo_material_target()

        save_response = self.client.put(
            f"/api/v1/projects/2/instances/{instance_id}/materials/{rule_id}/calculation-sheet",
            headers={"X-Spec-Sheets-User": "editor"},
            json={"cells": [{"row_index": 0, "column_index": 0, "raw_input": "12"}]},
        )
        self.assertEqual(save_response.status_code, 200)

        delete_response = self.client.delete(
            f"/api/v1/projects/2/instances/{instance_id}",
            headers={"X-Spec-Sheets-User": "editor"},
        )
        self.assertEqual(delete_response.status_code, 200)

        with self.session_factory() as session:
            instance = session.scalar(select(ProjectInstance).where(ProjectInstance.id == instance_id))
            self.assertIsNone(instance)
            sheets = session.scalars(
                select(ProjectMaterialCalculationSheet).where(ProjectMaterialCalculationSheet.instance_id == instance_id)
            ).all()
            cells = session.scalars(
                select(ProjectMaterialCalculationCell).join(ProjectMaterialCalculationSheet).where(
                    ProjectMaterialCalculationSheet.instance_id == instance_id
                )
            ).all()
            self.assertEqual(sheets, [])
            self.assertEqual(cells, [])

    def test_material_dashboard_project_usage_surfaces_bom_breakdown_and_sheet_metadata(self) -> None:
        target = self._get_demo_material_payload()
        save_response = self.client.put(
            f"/api/v1/projects/2/instances/{target['instance_id']}/materials/{target['rule_id']}/calculation-sheet",
            headers={"X-Spec-Sheets-User": "editor"},
            json={"cells": [{"row_index": 0, "column_index": 0, "raw_input": "12"}]},
        )
        self.assertEqual(save_response.status_code, 200)

        usage_response = self.client.get(
            f"/api/v1/dashboard/materials/{target['sku']}/project-usage?project_id=2",
            headers={"X-Spec-Sheets-User": "editor"},
        )
        self.assertEqual(usage_response.status_code, 200)
        payload = usage_response.json()

        self.assertEqual(payload["project"]["id"], 2)
        self.assertEqual(payload["sku"], target["sku"])
        self.assertGreaterEqual(payload["item_count"], 1)

        matching_item = next(
            item
            for item in payload["items"]
            if item["instance_id"] == target["instance_id"] and item["rule_id"] == target["rule_id"]
        )
        self.assertEqual(matching_item["instance_name"], target["instance_name"])
        self.assertTrue(matching_item["has_calculation_sheet"])
        self.assertEqual(matching_item["calculation_sheet_cell_count"], 1)
        self.assertGreaterEqual(len(matching_item["breakdown"]), 1)
        self.assertIn(matching_item["breakdown"][0]["quantity_state"], {"blank", "zero", "value"})
