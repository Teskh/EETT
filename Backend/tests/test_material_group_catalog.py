from __future__ import annotations

import unittest

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.services.material_groups import create_material_study_group, list_material_study_groups


class MaterialStudyGroupCatalogTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite+pysqlite:///:memory:")
        Base.metadata.create_all(self.engine)
        self.session_factory = sessionmaker(bind=self.engine, autoflush=False, expire_on_commit=False)

    def tearDown(self) -> None:
        self.engine.dispose()

    def test_catalog_returns_group_members_without_erp_queries(self) -> None:
        with self.session_factory() as session:
            created = create_material_study_group(
                session,
                name="Aislacion exterior",
                description="Consumo normalizado",
                study_unit="m2",
                members=[
                    {
                        "sku": "MAT-01",
                        "material_name": "Aislante",
                        "unit": "rollo",
                        "factor_to_study_unit": 2.5,
                    }
                ],
            )
            session.commit()

        with self.session_factory() as session:
            catalog = list_material_study_groups(session)

        self.assertEqual(len(catalog), 1)
        self.assertEqual(catalog[0]["group_id"], created["group_id"])
        self.assertEqual(catalog[0]["members"][0]["sku"], "MAT-01")
        self.assertEqual(catalog[0]["members"][0]["factor_to_study_unit"], 2.5)


if __name__ == "__main__":
    unittest.main()
