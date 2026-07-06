from __future__ import annotations

import os
import tempfile
import unittest
from unittest.mock import patch

from sqlalchemy import select
from sqlalchemy.orm import sessionmaker

from app.config import Settings
from app.database import Base, create_engine_for_url
from app.models import Material, MaterialUnitChange, MaterialUnitChangeStatus, User
from app.services import material_units
from app.services.material_units import (
    get_material_unit_alerts,
    maybe_sweep_material_units,
    resolve_material_unit_alert,
)


class MaterialUnitChangeTests(unittest.TestCase):
    def setUp(self) -> None:
        fd, self.db_path = tempfile.mkstemp(suffix=".sqlite")
        os.close(fd)
        self.settings = Settings(database_url=f"sqlite:///{self.db_path}", seed_demo_data=False)
        self.engine = create_engine_for_url(self.settings.database_url)
        Base.metadata.create_all(self.engine)
        self.session_factory = sessionmaker(bind=self.engine, expire_on_commit=False)
        self.session = self.session_factory()

        self.material = Material(sku="ERP-001", name="Cemento", unit="UN")
        self.blank_material = Material(sku="ERP-002", name="Arena", unit=None)
        self.user = User(username="ana", display_name="Ana", email="ana@example.com")
        self.session.add_all([self.material, self.blank_material, self.user])
        self.session.commit()

    def tearDown(self) -> None:
        self.session.close()
        self.engine.dispose()
        os.unlink(self.db_path)

    def _sweep(self, observed_units: dict[str, str | None]):
        with (
            patch.object(material_units, "erp_search_available", return_value=True),
            patch.object(material_units, "get_units_for_products", return_value=observed_units),
        ):
            return maybe_sweep_material_units(self.session, self.settings, force=True)

    def _pending(self) -> list[MaterialUnitChange]:
        return list(
            self.session.scalars(
                select(MaterialUnitChange).where(MaterialUnitChange.status == MaterialUnitChangeStatus.PENDING)
            )
        )

    def test_sweep_detects_unit_change_and_keeps_reference_unit(self) -> None:
        self._sweep({"ERP-001": "ML", "ERP-002": "M3"})
        pending = self._pending()
        self.assertEqual(len(pending), 1)
        self.assertEqual(pending[0].sku, "ERP-001")
        self.assertEqual(pending[0].old_unit, "UN")
        self.assertEqual(pending[0].new_unit, "ML")
        # The reference unit must not move until the change is resolved.
        self.assertEqual(self.material.unit, "UN")
        # Materials without a known unit adopt the ERP unit silently.
        self.assertEqual(self.blank_material.unit, "M3")

        # A repeat sweep updates the open alert instead of duplicating it.
        self._sweep({"ERP-001": "KG", "ERP-002": "M3"})
        pending = self._pending()
        self.assertEqual(len(pending), 1)
        self.assertEqual(pending[0].new_unit, "KG")

    def test_sweep_auto_resolves_when_erp_reverts(self) -> None:
        self._sweep({"ERP-001": "ML"})
        self._sweep({"ERP-001": "UN"})
        self.assertEqual(self._pending(), [])
        change = self.session.scalars(select(MaterialUnitChange)).one()
        self.assertEqual(change.status, MaterialUnitChangeStatus.RESOLVED)
        self.assertIsNone(change.resolved_by_user_id)

    def test_resolution_updates_reference_unit_and_keeps_history(self) -> None:
        self._sweep({"ERP-001": "ML"})
        change = self._pending()[0]
        resolved = resolve_material_unit_alert(self.session, change_id=change.id, user=self.user)
        self.assertIsNotNone(resolved)
        self.assertEqual(resolved["status"], "resolved")
        self.assertEqual(resolved["resolved_by"], "Ana")
        self.assertEqual(self.material.unit, "ML")

        # Once resolved, the same ERP unit no longer raises an alert.
        self._sweep({"ERP-001": "ML"})
        self.assertEqual(self._pending(), [])

        # Resolving twice is rejected.
        self.assertIsNone(resolve_material_unit_alert(self.session, change_id=change.id, user=self.user))

    def test_alert_listing_includes_usage_and_history(self) -> None:
        self._sweep({"ERP-001": "ML"})
        with (
            patch.object(material_units, "erp_search_available", return_value=True),
            patch.object(material_units, "get_units_for_products", return_value={"ERP-001": "ML"}),
        ):
            alerts = get_material_unit_alerts(self.session, self.settings, sweep=False)
        self.assertEqual(len(alerts["pending"]), 1)
        alert = alerts["pending"][0]
        self.assertEqual(alert["usage"]["catalog_rules_count"], 0)
        self.assertEqual(alert["usage"]["bom_entries"], [])

        resolve_material_unit_alert(self.session, change_id=alert["id"], user=self.user)
        alerts = get_material_unit_alerts(self.session, self.settings, sweep=False)
        self.assertEqual(alerts["pending"], [])
        self.assertEqual(len(alerts["history"]), 1)


if __name__ == "__main__":
    unittest.main()
