from __future__ import annotations

import asyncio
import os
import tempfile
import unittest
from pathlib import Path

from sqlalchemy.orm import sessionmaker

from app.config import Settings
from app.database import Base, create_engine_for_url
from app.main import create_app
from app.models import CatalogCategory
from app.seed import seed_demo_data_if_empty
from app.services.catalog import create_category, create_component, get_catalog_page_data
from app.services.projects import create_project, get_project_view_data, get_projects_page_data
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

    def tearDown(self) -> None:
        self.engine.dispose()
        self.temp_dir.cleanup()

    def test_catalog_page_data_contains_expected_demo_structure(self) -> None:
        with self.session_factory() as session:
            data = get_catalog_page_data(session)

        self.assertEqual(data["summary"]["categories"], 6)
        self.assertEqual(data["selected"]["name"], "Openings")
        selected_component_names = {component["name"] for component in data["selected"]["components"]}
        self.assertEqual(selected_component_names, set())

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
                unit_type="unit",
            )
            refreshed = get_catalog_page_data(session, selected_category_id=category.id)

        self.assertEqual(component.name, "Mirror Cabinet")
        self.assertEqual(refreshed["selected"]["name"], "Bathrooms")
        self.assertEqual(len(refreshed["selected"]["components"]), 1)

    def test_projects_page_and_detail_preserve_material_semantics(self) -> None:
        with self.session_factory() as session:
            board = get_projects_page_data(session)
            execution_project = board["grouped_projects"]["execution"][0]
            detail = get_project_view_data(session, execution_project["id"])

        self.assertEqual(execution_project["name"], "Casa Robles - Block A")
        self.assertEqual(detail["project"]["status"], "execution")

        window_section = next(section for section in detail["categories"] if section["name"] == "Windows")
        window_instance = window_section["instances"][0]
        silicone_material = next(material for material in window_instance["materials"] if material["sku"] == "MAT-006")
        self.assertIsNone(silicone_material["bom_entries"][0]["quantity"])

        trim_section = next(section for section in detail["categories"] if section["name"] == "Trim")
        trim_instance = trim_section["instances"][0]
        trim_material = trim_instance["materials"][0]
        self.assertEqual(trim_material["bom_entries"][0]["quantity"], 0)

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

    def test_project_creation_adds_new_template_project(self) -> None:
        with self.session_factory() as session:
            create_project(
                session,
                name="Casa Arrayan Template",
                description="New baseline template",
                status="template",
            )
            board = get_projects_page_data(session)

        template_names = [project["name"] for project in board["grouped_projects"]["template"]]
        self.assertIn("Casa Arrayan Template", template_names)

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
