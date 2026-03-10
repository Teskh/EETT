from __future__ import annotations

import asyncio
import os
import tempfile
import unittest

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import sessionmaker

from app.config import Settings
from app.database import Base, create_engine_for_url
from app.main import create_app
from app.models import CatalogCategory, CatalogComponent, Project
from app.seed import seed_demo_data_if_empty
from app.services.catalog import (
    create_attribute_definition,
    create_category,
    create_component,
    delete_attribute_definition,
    get_catalog_page_data,
    replace_component_attributes,
    update_attribute_definition,
)
from app.services.projects import (
    create_project_instance,
    get_instance_sync_preview,
    get_project_view_data,
    get_projects_page_data,
    refresh_instance_snapshot,
)
from app.ui import render_catalog_page, render_project_detail_page, render_projects_page


class ServiceLayerTests(unittest.TestCase):
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
        )
        self.engine = create_engine_for_url(self.settings.database_url)
        self.session_factory = sessionmaker(bind=self.engine, autoflush=False, expire_on_commit=False)
        Base.metadata.drop_all(self.engine)
        Base.metadata.create_all(self.engine)
        seed_demo_data_if_empty(self.session_factory)
        self.app = create_app(Settings(database_url=self.test_database_url, seed_demo_data=False, require_schema=True))
        self.client = TestClient(self.app)

    def tearDown(self) -> None:
        self.client.close()
        self.engine.dispose()
        self.temp_dir.cleanup()

    def test_catalog_page_data_contains_expected_demo_structure(self) -> None:
        with self.session_factory() as session:
            data = get_catalog_page_data(session)

        self.assertEqual(data["summary"]["categories"], 6)
        self.assertEqual(data["selected"]["name"], "Openings")
        child_names = {child["name"] for child in data["selected"]["child_categories"]}
        self.assertIn("Doors", child_names)
        self.assertIn("Windows", child_names)

    def test_catalog_create_helpers_persist_new_records(self) -> None:
        with self.session_factory() as session:
            category = create_category(
                session,
                name="Bathrooms",
                description="Wet-area catalog lines",
                scope="item",
                parent_id=None,
            )
            component = create_component(
                session,
                category_id=category.id,
                component_type="item",
                name="Mirror Cabinet",
                short_name="MC-01",
                description="Wall-mounted cabinet",
                short_description="Client-facing mirror cabinet",
                installation="Anchor to masonry wall.",
                unit_type="unit",
            )
            refreshed = get_catalog_page_data(session, selected_category_id=category.id)

        self.assertEqual(component.name, "Mirror Cabinet")
        self.assertEqual(component.short_description, "Client-facing mirror cabinet")
        self.assertEqual(refreshed["selected"]["name"], "Bathrooms")
        self.assertEqual(len(refreshed["selected"]["components"]), 1)
        self.assertEqual(refreshed["selected"]["components"][0]["short_description"], "Client-facing mirror cabinet")

    def test_catalog_attribute_helpers_support_create_update_delete_and_bump_sync_timestamp(self) -> None:
        with self.session_factory() as session:
            component = session.scalar(select(CatalogComponent).where(CatalogComponent.name == "Base Cabinet 900"))
            project = session.scalar(select(Project).where(Project.name == "Casa Robles - Block A"))

            self.assertIsNotNone(component)
            self.assertIsNotNone(project)
            assert component is not None
            assert project is not None

            instance = create_project_instance(
                session,
                project=project,
                category_id=component.category_id,
                component_id=component.id,
                name="Kitchen Cabinet Clone",
                short_name="KCC-01",
                description="Snapshot for sync test",
                short_description="Short sync test copy",
                installation="Install per kitchen plan.",
                unit_amount=1,
            )
            baseline_sync = get_instance_sync_preview(session, instance.id)
            self.assertIsNotNone(baseline_sync)
            self.assertFalse(baseline_sync["is_outdated"])

            definition = create_attribute_definition(
                session,
                component_id=component.id,
                name="Toe Kick Finish",
                value_type="select",
                options_text="Oak, Walnut\nGraphite",
            )
            self.assertIsNotNone(definition)
            assert definition is not None
            self.assertEqual([option.value for option in definition.options], ["Oak", "Walnut", "Graphite"])

            refreshed_sync = get_instance_sync_preview(session, instance.id)
            self.assertIsNotNone(refreshed_sync)
            self.assertTrue(refreshed_sync["is_outdated"])

            updated = update_attribute_definition(
                session,
                attribute_definition_id=definition.id,
                name="Toe Kick Material",
                value_type="text",
                options_text="Ignored",
            )
            self.assertIsNotNone(updated)
            assert updated is not None
            self.assertEqual(updated.name, "Toe Kick Material")
            self.assertEqual(updated.value_type.value, "text")
            self.assertEqual(updated.options, [])

            deleted_category_id = delete_attribute_definition(session, attribute_definition_id=definition.id)
            self.assertEqual(deleted_category_id, component.category_id)

            refreshed = get_catalog_page_data(session, selected_category_id=component.category_id)
            component_payload = next(item for item in refreshed["selected"]["components"] if item["id"] == component.id)
            self.assertNotIn("Toe Kick Material", [attribute["name"] for attribute in component_payload["attributes"]])

    def test_replace_component_attributes_preserves_nested_option_rows_and_marks_instances_outdated(self) -> None:
        with self.session_factory() as session:
            component = session.scalar(select(CatalogComponent).where(CatalogComponent.name == "Base Cabinet 900"))
            project = session.scalar(select(Project).where(Project.name == "Casa Robles - Block A"))

            self.assertIsNotNone(component)
            self.assertIsNotNone(project)
            assert component is not None
            assert project is not None

            instance = create_project_instance(
                session,
                project=project,
                category_id=component.category_id,
                component_id=component.id,
                name="Kitchen Cabinet UX",
                short_name="KCU-01",
                description="Snapshot for bulk attribute editor test",
                short_description="Bulk editor snapshot",
                installation="Install per kitchen plan.",
                unit_amount=1,
            )
            self.assertFalse(get_instance_sync_preview(session, instance.id)["is_outdated"])

            updated_component = replace_component_attributes(
                session,
                component_id=component.id,
                attributes=[
                    {
                        "name": "Countertop",
                        "value_type": "select",
                        "options": ["Laminate", "Quartz", "Porcelain"],
                    },
                    {
                        "name": "Depth",
                        "value_type": "number",
                        "options": ["ignored"],
                    },
                ],
            )

            self.assertIsNotNone(updated_component)
            refreshed = get_catalog_page_data(session, selected_category_id=component.category_id)
            component_payload = next(item for item in refreshed["selected"]["components"] if item["id"] == component.id)
            self.assertEqual(
                component_payload["attributes"],
                [
                    {
                        "id": component_payload["attributes"][0]["id"],
                        "name": "Countertop",
                        "value_type": "select",
                        "options": ["Laminate", "Quartz", "Porcelain"],
                    },
                    {
                        "id": component_payload["attributes"][1]["id"],
                        "name": "Depth",
                        "value_type": "number",
                        "options": [],
                    },
                ],
            )
            self.assertTrue(get_instance_sync_preview(session, instance.id)["is_outdated"])

    def test_catalog_and_project_crud_routes_work(self) -> None:
        create_catalog_component_response = self.client.post(
            "/catalog/components",
            headers={"X-Spec-Sheets-User": "editor"},
            data={
                "category_id": "6",
                "component_type": "item",
                "name": "Island Module",
                "short_name": "ISL-01",
                "description": "Kitchen island module",
                "installation": "Set and level on finished floor.",
                "unit_type": "unit",
            },
            follow_redirects=False,
        )
        self.assertEqual(create_catalog_component_response.status_code, 303)

        with self.session_factory() as session:
            kitchens = get_catalog_page_data(session, selected_category_id=6)
            component = next(item for item in kitchens["selected"]["components"] if item["name"] == "Island Module")
            component_id = component["id"]

        update_catalog_component_response = self.client.post(
            f"/catalog/components/{component_id}/update",
            headers={"X-Spec-Sheets-User": "editor"},
            data={
                "name": "Island Module Revised",
                "short_name": "ISL-02",
                "description": "Updated module",
                "installation": "Install after plumbing rough-in.",
                "unit_type": "set",
                "component_type": "item",
            },
            follow_redirects=False,
        )
        self.assertEqual(update_catalog_component_response.status_code, 303)

        create_instance_response = self.client.post(
            "/projects/2/instances",
            headers={"X-Spec-Sheets-User": "editor"},
            data={
                "category_id": "6",
                "component_id": str(component_id),
                "name": "Kitchen Island A",
                "short_name": "KIA-01",
                "description": "Execution instance",
                "installation": "Install on site.",
                "unit_amount": "2",
                "attribute_values_json": '[{"name":"Countertop","value":"Quartz"}]',
            },
            follow_redirects=False,
        )
        self.assertEqual(create_instance_response.status_code, 303)

        project_detail = self.client.get("/api/v1/projects/2", headers={"X-Spec-Sheets-User": "editor"}).json()
        kitchen_section = next(section for section in project_detail["categories"] if section["name"] == "Kitchens")
        created_instance = next(item for item in kitchen_section["instances"] if item["name"] == "Kitchen Island A")

        update_instance_response = self.client.post(
            f"/projects/2/instances/{created_instance['id']}/update",
            headers={"X-Spec-Sheets-User": "editor"},
            data={
                "category_id": "6",
                "name": "Kitchen Island B",
                "short_name": "KIB-01",
                "description": "Updated execution instance",
                "installation": "Updated install notes.",
                "unit_amount": "3",
                "attribute_values_json": '[{"name":"Countertop","value":"Laminate"}]',
            },
            follow_redirects=False,
        )
        self.assertEqual(update_instance_response.status_code, 303)

        project_detail_after_update = self.client.get("/api/v1/projects/2", headers={"X-Spec-Sheets-User": "editor"}).json()
        kitchen_section_after_update = next(section for section in project_detail_after_update["categories"] if section["name"] == "Kitchens")
        updated_instance = next(item for item in kitchen_section_after_update["instances"] if item["name"] == "Kitchen Island B")
        self.assertEqual(updated_instance["attributes"][0]["values"][0]["value"], "Laminate")

        delete_instance_response = self.client.post(
            f"/projects/2/instances/{created_instance['id']}/delete",
            headers={"X-Spec-Sheets-User": "editor"},
            data={"category_id": "6"},
            follow_redirects=False,
        )
        self.assertEqual(delete_instance_response.status_code, 303)

    def test_catalog_attribute_routes_work(self) -> None:
        with self.session_factory() as session:
            component = session.scalar(select(CatalogComponent).where(CatalogComponent.name == "Base Cabinet 900"))
            self.assertIsNotNone(component)
            assert component is not None
            component_id = component.id
            category_id = component.category_id

        create_response = self.client.post(
            f"/catalog/components/{component_id}/attributes",
            headers={"X-Spec-Sheets-User": "editor"},
            data={
                "name": "Drawer Front",
                "value_type": "select",
                "options_text": "Slab, Shaker",
            },
            follow_redirects=False,
        )
        self.assertEqual(create_response.status_code, 303)

        with self.session_factory() as session:
            refreshed = get_catalog_page_data(session, selected_category_id=category_id)
            component_payload = next(item for item in refreshed["selected"]["components"] if item["id"] == component_id)
            attribute = next(item for item in component_payload["attributes"] if item["name"] == "Drawer Front")

        update_response = self.client.post(
            f"/catalog/attributes/{attribute['id']}/update",
            headers={"X-Spec-Sheets-User": "editor"},
            data={
                "name": "Drawer Style",
                "value_type": "text",
                "options_text": "Should be cleared",
            },
            follow_redirects=False,
        )
        self.assertEqual(update_response.status_code, 303)

        delete_response = self.client.post(
            f"/catalog/attributes/{attribute['id']}/delete",
            headers={"X-Spec-Sheets-User": "editor"},
            data={"category_id": str(category_id)},
            follow_redirects=False,
        )
        self.assertEqual(delete_response.status_code, 303)

        with self.session_factory() as session:
            refreshed = get_catalog_page_data(session, selected_category_id=category_id)
            component_payload = next(item for item in refreshed["selected"]["components"] if item["id"] == component_id)
            self.assertNotIn("Drawer Style", [item["name"] for item in component_payload["attributes"]])

    def test_catalog_bulk_attribute_route_matches_legacy_repeatable_editor_flow(self) -> None:
        with self.session_factory() as session:
            component = session.scalar(select(CatalogComponent).where(CatalogComponent.name == "Base Cabinet 900"))
            self.assertIsNotNone(component)
            assert component is not None
            component_id = component.id
            category_id = component.category_id

        response = self.client.post(
            f"/catalog/components/{component_id}/attributes/update",
            headers={"X-Spec-Sheets-User": "editor"},
            data={
                "attributes_json": '[{"name":"Drawer Style","value_type":"select","options":["Slab","Shaker"]},{"name":"Cabinet Width","value_type":"number","options":["should clear"]}]',
            },
            follow_redirects=False,
        )
        self.assertEqual(response.status_code, 303)

        with self.session_factory() as session:
            refreshed = get_catalog_page_data(session, selected_category_id=category_id)
            component_payload = next(item for item in refreshed["selected"]["components"] if item["id"] == component_id)
            self.assertEqual(
                [(item["name"], item["value_type"], item["options"]) for item in component_payload["attributes"]],
                [
                    ("Drawer Style", "select", ["Slab", "Shaker"]),
                    ("Cabinet Width", "number", []),
                ],
            )

    def test_catalog_bulk_attribute_route_supports_fetch_without_redirect(self) -> None:
        with self.session_factory() as session:
            component = session.scalar(select(CatalogComponent).where(CatalogComponent.name == "Base Cabinet 900"))
            self.assertIsNotNone(component)
            assert component is not None

        response = self.client.post(
            f"/catalog/components/{component.id}/attributes/update",
            headers={
                "X-Spec-Sheets-User": "editor",
                "x-requested-with": "fetch",
            },
            data={
                "attributes_json": '[{"name":"Drawer Style","value_type":"select","options":["Slab","Shaker"]}]',
            },
            follow_redirects=False,
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["ok"], True)

    def test_project_view_marks_instance_outdated_after_catalog_attribute_change_and_refresh_adds_missing_rows(self) -> None:
        with self.session_factory() as session:
            component = session.scalar(select(CatalogComponent).where(CatalogComponent.name == "Base Cabinet 900"))
            project = session.scalar(select(Project).where(Project.name == "Casa Robles - Block A"))

            self.assertIsNotNone(component)
            self.assertIsNotNone(project)
            assert component is not None
            assert project is not None

            instance = create_project_instance(
                session,
                project=project,
                category_id=component.category_id,
                component_id=component.id,
                name="Kitchen Cabinet Snapshot",
                short_name="KCS-01",
                description="Snapshot to test attribute refresh",
                short_description="Refresh snapshot",
                installation="Install per kitchen plan.",
                unit_amount=1,
            )
            baseline = get_project_view_data(session, project.id)
            kitchens = next(section for section in baseline["categories"] if section["name"] == "Kitchens")
            baseline_instance = next(item for item in kitchens["instances"] if item["id"] == instance.id)
            self.assertFalse(baseline_instance["sync_state"]["is_outdated"])
            self.assertEqual(baseline_instance["short_description"], "Refresh snapshot")
            self.assertEqual(
                [row["name"] for row in baseline_instance["attributes"][0]["values"]],
                ["Countertop"],
            )

            replace_component_attributes(
                session,
                component_id=component.id,
                attributes=[
                    {
                        "name": "Countertop",
                        "value_type": "select",
                        "options": ["Laminate", "Quartz"],
                    },
                    {
                        "name": "Depth",
                        "value_type": "number",
                        "options": [],
                    },
                ],
            )

            changed = get_project_view_data(session, project.id)
            kitchens = next(section for section in changed["categories"] if section["name"] == "Kitchens")
            changed_instance = next(item for item in kitchens["instances"] if item["id"] == instance.id)
            self.assertTrue(changed_instance["sync_state"]["is_outdated"])
            self.assertEqual(changed_instance["sync_state"]["status"], "out_of_sync")
            self.assertEqual(
                [row["name"] for row in changed_instance["attributes"][0]["values"]],
                ["Countertop"],
            )

            refreshed_preview = refresh_instance_snapshot(session, instance_id=instance.id, actor_user=None)
            self.assertIsNotNone(refreshed_preview)
            self.assertFalse(refreshed_preview["is_outdated"])

            refreshed = get_project_view_data(session, project.id)
            kitchens = next(section for section in refreshed["categories"] if section["name"] == "Kitchens")
            refreshed_instance = next(item for item in kitchens["instances"] if item["id"] == instance.id)
            self.assertFalse(refreshed_instance["sync_state"]["is_outdated"])
            self.assertEqual(
                [row["name"] for row in refreshed_instance["attributes"][0]["values"]],
                ["Countertop", "Depth"],
            )

    def test_projects_page_and_detail_preserve_material_semantics(self) -> None:
        with self.session_factory() as session:
            board = get_projects_page_data(session)
            execution_project = board["grouped_projects"]["execution"][0]
            detail = get_project_view_data(session, execution_project["id"])

        self.assertEqual(execution_project["name"], "Casa Robles - Block A")
        self.assertEqual(execution_project["material_mode"], "per_subtype")
        self.assertEqual(detail["project"]["status"], "execution")

        window_section = next(section for section in detail["categories"] if section["name"] == "Windows")
        window_instance = window_section["instances"][0]
        silicone_material = next(material for material in window_instance["materials"] if material["sku"] == "MAT-006")
        self.assertEqual(silicone_material["bom_entries"][0]["quantity_state"], "blank")

        trim_section = next(section for section in detail["categories"] if section["name"] == "Trim")
        trim_instance = trim_section["instances"][0]
        trim_material = trim_instance["materials"][0]
        self.assertEqual(trim_material["bom_entries"][0]["quantity_state"], "zero")
        self.assertEqual(trim_instance["sync_state"]["status"], "out_of_sync")

    def test_html_renderers_include_core_screen_content(self) -> None:
        with self.session_factory() as session:
            catalog = get_catalog_page_data(session)
            projects = get_projects_page_data(session)
            project = get_project_view_data(session, 2)

        catalog_html = render_catalog_page(catalog, catalog["selected"]["id"])
        projects_html = render_projects_page(projects)
        project_html = render_project_detail_page(project)

        self.assertIn("Database Editor", catalog_html)
        self.assertIn("Project board", projects_html)
        self.assertIn("Applicable materials", project_html)

    def test_session_and_project_permissions_are_typed_and_filtered(self) -> None:
        session_response = self.client.get("/api/v1/session", headers={"X-Spec-Sheets-User": "viewer"})
        self.assertEqual(session_response.status_code, 200)
        session_payload = session_response.json()
        self.assertEqual(session_payload["username"], "viewer")
        self.assertIn("viewer", session_payload["roles"])
        self.assertFalse(session_payload["permissions"]["catalog_edit"])

        projects_response = self.client.get("/api/v1/projects", headers={"X-Spec-Sheets-User": "viewer"})
        self.assertEqual(projects_response.status_code, 200)
        payload = projects_response.json()
        self.assertEqual(payload["grouped_projects"]["template"], [])
        execution_names = [project["name"] for project in payload["grouped_projects"]["execution"]]
        self.assertIn("Casa Robles - Block A", execution_names)

    def test_sync_preview_and_material_mode_endpoints(self) -> None:
        mode_response = self.client.get("/api/v1/projects/2/material-mode", headers={"X-Spec-Sheets-User": "editor"})
        self.assertEqual(mode_response.status_code, 200)
        self.assertEqual(mode_response.json()["mode"], "per_subtype")

        preview_response = self.client.get(
            "/api/v1/projects/2/instances/4/sync-preview",
            headers={"X-Spec-Sheets-User": "editor"},
        )
        self.assertEqual(preview_response.status_code, 200)
        self.assertTrue(preview_response.json()["is_outdated"])

        refresh_response = self.client.post(
            "/api/v1/projects/2/instances/4/refresh",
            headers={"X-Spec-Sheets-User": "editor"},
        )
        self.assertEqual(refresh_response.status_code, 200)
        self.assertEqual(refresh_response.json()["sync_status"], "up_to_date")
        self.assertFalse(refresh_response.json()["is_outdated"])

        update_mode = self.client.put(
            "/api/v1/projects/2/material-mode",
            headers={"X-Spec-Sheets-User": "editor"},
            json={"mode": "general"},
        )
        self.assertEqual(update_mode.status_code, 200)
        self.assertEqual(update_mode.json()["mode"], "general")

    def test_comments_notifications_exports_and_approvals(self) -> None:
        comments_response = self.client.get("/api/v1/projects/2/comments", headers={"X-Spec-Sheets-User": "viewer"})
        self.assertEqual(comments_response.status_code, 200)
        self.assertGreaterEqual(len(comments_response.json()), 1)

        create_comment = self.client.post(
            "/api/v1/projects/2/comments",
            headers={"X-Spec-Sheets-User": "editor"},
            json={"instance_id": 2, "body": "Need wording update for @viewer before export."},
        )
        self.assertEqual(create_comment.status_code, 200)
        self.assertIn("viewer", create_comment.json()["mentions"])

        notifications = self.client.get("/api/v1/notifications", headers={"X-Spec-Sheets-User": "viewer"})
        self.assertEqual(notifications.status_code, 200)
        self.assertTrue(any(item["type"] == "comment_mention" for item in notifications.json()))

        create_export = self.client.post(
            "/api/v1/projects/2/exports",
            headers={"X-Spec-Sheets-User": "editor"},
            json={"kind": "commercial_pdf", "payload": {"include_accessories": True}},
        )
        self.assertEqual(create_export.status_code, 200)
        self.assertEqual(create_export.json()["kind"], "commercial_pdf")

        request_approval = self.client.post(
            "/api/v1/projects/2/approvals",
            headers={"X-Spec-Sheets-User": "editor"},
            json={"summary": "Approve commercial package wording."},
        )
        self.assertEqual(request_approval.status_code, 200)
        self.assertEqual(request_approval.json()["status"], "pending")

        approval_id = request_approval.json()["id"]
        decision = self.client.post(
            f"/api/v1/approvals/{approval_id}/decision",
            headers={"X-Spec-Sheets-User": "admin"},
            json={"status": "approved"},
        )
        self.assertEqual(decision.status_code, 200)
        self.assertEqual(decision.json()["status"], "approved")

    def test_v1_catalog_and_project_instance_requests_preserve_short_description(self) -> None:
        create_component_response = self.client.post(
            "/api/v1/catalog/components",
            headers={"X-Spec-Sheets-User": "editor"},
            json={
                "category_id": 6,
                "component_type": "item",
                "name": "Vanity Module",
                "short_name": "VAN-01",
                "description": "Bathroom vanity module",
                "short_description": "Commercial vanity",
                "installation": "Install against finished wall.",
                "unit_type": "unit",
            },
        )
        self.assertEqual(create_component_response.status_code, 200)
        component_id = create_component_response.json()["component_id"]

        catalog = self.client.get("/api/v1/catalog?category_id=6", headers={"X-Spec-Sheets-User": "editor"})
        self.assertEqual(catalog.status_code, 200)
        created_component = next(item for item in catalog.json()["selected"]["components"] if item["id"] == component_id)
        self.assertEqual(created_component["short_description"], "Commercial vanity")

        create_instance_response = self.client.post(
            "/api/v1/projects/2/instances",
            headers={"X-Spec-Sheets-User": "editor"},
            json={
                "category_id": 6,
                "component_id": component_id,
                "name": "Vanity Instance A",
                "short_name": "VIA-01",
                "description": "Bathroom vanity instance",
                "short_description": "Client package vanity",
                "installation": "Install in bath 01.",
                "unit_amount": 1,
                "attribute_values": [],
            },
        )
        self.assertEqual(create_instance_response.status_code, 200)
        instance_id = create_instance_response.json()["instance_id"]

        project_detail = self.client.get("/api/v1/projects/2", headers={"X-Spec-Sheets-User": "editor"})
        self.assertEqual(project_detail.status_code, 200)
        kitchens = next(section for section in project_detail.json()["categories"] if section["name"] == "Kitchens")
        created_instance = next(item for item in kitchens["instances"] if item["id"] == instance_id)
        self.assertEqual(created_instance["short_description"], "Client package vanity")

    def test_dashboard_and_public_api_surfaces(self) -> None:
        dashboard = self.client.get(
            "/api/v1/dashboard/projects/2/materials",
            headers={"X-Spec-Sheets-User": "admin"},
        )
        self.assertEqual(dashboard.status_code, 200)
        row = next(item for item in dashboard.json()["rows"] if item["sku"] == "MAT-003")
        self.assertEqual(row["material_name"], "Laminated Glass Panel")
        self.assertGreaterEqual(row["shortage"], 0)

        public_projects = self.client.get("/api/v1/public/projects")
        self.assertEqual(public_projects.status_code, 200)
        public_names = [project["name"] for project in public_projects.json()["projects"]]
        self.assertIn("Casa Robles - Block A", public_names)
        self.assertIn("Casa Alerce - Delivered", public_names)

        public_skus = self.client.get("/api/v1/public/projects/2/skus")
        self.assertEqual(public_skus.status_code, 200)
        self.assertIn("MAT-006", public_skus.json()["skus"])

    def test_app_lifespan_requires_existing_schema(self) -> None:
        Base.metadata.drop_all(self.engine)
        settings = Settings(database_url=self.test_database_url, seed_demo_data=False, require_schema=True)
        app = create_app(settings)

        async def run_lifespan() -> None:
            async with app.router.lifespan_context(app):
                pass

        with self.assertRaises(RuntimeError):
            asyncio.run(run_lifespan())

    def test_app_lifespan_seeds_after_schema_exists(self) -> None:
        Base.metadata.drop_all(self.engine)
        Base.metadata.create_all(self.engine)

        settings = Settings(database_url=self.test_database_url, seed_demo_data=True, require_schema=True)
        app = create_app(settings)

        async def run_lifespan() -> None:
            async with app.router.lifespan_context(app):
                pass

        asyncio.run(run_lifespan())

        with self.session_factory() as session:
            self.assertIsNotNone(session.query(CatalogCategory).first())


if __name__ == "__main__":
    unittest.main()
