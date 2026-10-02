from datetime import date, datetime, timedelta, timezone
import unittest
from unittest.mock import patch

from sqlalchemy import select
from sqlalchemy.orm import sessionmaker

from app.config import Settings
from app.database import Base, create_engine_for_url
from app.models import ErpSyncState, ErpWithdrawal
from app.services import erp_history


class FakeErp:
    """Stands in for `erp.fetch_withdrawal_documents` and records each request."""

    def __init__(self, documents):
        self.documents = list(documents)
        self.requests: list[tuple[date, date]] = []
        self.failures = 0

    def __call__(self, settings, *, start_day, end_day):
        self.requests.append((start_day, end_day))
        if self.failures:
            self.failures -= 1
            raise RuntimeError("ERP busy")
        documents = [dict(document) for document in self.documents if start_day <= document["movement_date"] <= end_day]
        return {
            "documents": documents,
            "products": {document["sku"]: {"name": f"Material {document['sku']}", "unit": "UN"} for document in documents},
            "cost_center_names": {"01-02-03": "Paneles", "05-01-01": "Administración"},
        }


def withdrawal(number, sku, day, quantity, center="01-02-03", value=10.0):
    return {
        "document_number": number,
        "sku": sku,
        "movement_date": day,
        "cost_center": center,
        "request_note": f"Solicitud {number}",
        "quantity": quantity,
        "value": value,
        "line_count": 1,
    }


def local_at(hour):
    return datetime.now().astimezone().replace(hour=hour, minute=30, second=0, microsecond=0)


class ErpHistoryTests(unittest.TestCase):
    def setUp(self) -> None:
        self.settings = Settings(
            database_url="sqlite://",
            seed_demo_data=False,
            environment="test",
            softland_password="test",
            erp_sync_enabled=True,
            erp_sync_history_days=90,
            erp_sync_chunk_days=31,
            erp_sync_pause_seconds=7,
            erp_sync_retry_seconds=(60, 300),
            erp_sync_night_hour=1,
            erp_sync_night_window_hours=5,
        )
        self.engine = create_engine_for_url("sqlite://")
        Base.metadata.create_all(self.engine)
        self.session_factory = sessionmaker(bind=self.engine, autoflush=False, expire_on_commit=False)
        self.today = erp_history._today()
        self.sleeps: list[float] = []
        erp_history.allow_runs()

    def tearDown(self) -> None:
        self.engine.dispose()

    def run_sync(self, erp, *, hour=14):
        return erp_history.run_due_sync(self.settings, self.session_factory, now=local_at(hour), fetch=erp, sleep=self.sleeps.append)

    def stored(self):
        with self.session_factory() as session:
            return {(row.document_number, row.sku): row for row in session.scalars(select(ErpWithdrawal))}

    def state(self):
        with self.session_factory() as session:
            return session.get(ErpSyncState, erp_history.STATE_KEY)

    def test_first_run_loads_the_window_newest_month_first_with_pauses(self) -> None:
        erp = FakeErp([
            withdrawal("1", "PANEL", self.today - timedelta(days=80), 4),
            withdrawal("2", "PANEL", self.today - timedelta(days=2), 3),
        ])

        self.assertEqual(self.run_sync(erp), "initial")

        self.assertEqual(erp.requests[0][1], self.today)
        self.assertEqual([end for _, end in erp.requests], sorted((end for _, end in erp.requests), reverse=True))
        self.assertTrue(all((end - start).days < 31 for start, end in erp.requests))
        self.assertEqual(self.sleeps, [7.0] * (len(erp.requests) - 1))
        self.assertEqual(set(self.stored()), {("1", "PANEL"), ("2", "PANEL")})
        state = self.state()
        self.assertEqual((state.covered_from, state.covered_to), (self.today - timedelta(days=90), self.today))
        self.assertIsNotNone(state.last_full_sync_at)

        # Nothing else is due during the day right after the first load.
        self.assertIsNone(self.run_sync(erp))

    def test_nightly_recheck_refetches_only_recent_days_and_applies_corrections(self) -> None:
        old = withdrawal("1", "PANEL", self.today - timedelta(days=60), 4)
        cancelled = withdrawal("2", "PANEL", self.today - timedelta(days=10), 3)
        redated = withdrawal("3", "PANEL", self.today - timedelta(days=5), 2)
        erp = FakeErp([old, cancelled, redated])
        self.run_sync(erp)

        erp.documents = [old, dict(redated, movement_date=self.today - timedelta(days=20))]
        erp.requests.clear()
        self.assertEqual(self.run_sync(erp, hour=2), "nightly")

        self.assertTrue(all(start >= self.today - timedelta(days=31) for start, _ in erp.requests))
        stored = self.stored()
        self.assertNotIn(("2", "PANEL"), stored)
        self.assertEqual(stored[("3", "PANEL")].movement_date, self.today - timedelta(days=20))
        self.assertIn(("1", "PANEL"), stored)

        # Once a night.
        self.assertIsNone(self.run_sync(erp, hour=3))

    def test_monthly_full_recheck_runs_only_at_night(self) -> None:
        erp = FakeErp([withdrawal("1", "PANEL", self.today - timedelta(days=60), 4)])
        self.run_sync(erp)
        with self.session_factory() as session:
            state = session.get(ErpSyncState, erp_history.STATE_KEY)
            state.last_full_sync_at = datetime.now(timezone.utc) - timedelta(days=31)
            state.last_nightly_sync_at = datetime.now(timezone.utc)
            session.commit()

        self.assertIsNone(self.run_sync(erp, hour=14))
        erp.requests.clear()
        self.assertEqual(self.run_sync(erp, hour=2), "full")
        self.assertEqual(min(start for start, _ in erp.requests), self.today - timedelta(days=90))
        self.assertIsNone(self.state().full_sync_resume_from)

    def test_a_failing_chunk_is_retried_after_a_wait(self) -> None:
        erp = FakeErp([withdrawal("1", "PANEL", self.today, 1)])
        erp.failures = 1

        self.assertEqual(self.run_sync(erp), "initial")

        self.assertEqual(self.sleeps[0], 60)
        self.assertIn(("1", "PANEL"), self.stored())

    def test_repeated_failure_keeps_finished_chunks_and_backs_off(self) -> None:
        erp = FakeErp([withdrawal("1", "PANEL", self.today, 1)])
        calls = {"count": 0}

        def flaky(settings, *, start_day, end_day):
            calls["count"] += 1
            if calls["count"] > 1:
                raise RuntimeError("ERP refused the connection")
            return erp(settings, start_day=start_day, end_day=end_day)

        self.assertEqual(self.run_sync(flaky), "failed")
        state = self.state()
        self.assertEqual(state.covered_to, self.today)
        self.assertIn("refused", state.last_error)
        # No new attempt right after a failure.
        self.assertIsNone(self.run_sync(flaky))

    def test_readers_use_the_stored_copy_and_apply_cost_center_scopes(self) -> None:
        day = self.today - timedelta(days=3)
        self.run_sync(FakeErp([
            withdrawal("1", "PANEL", day, 4, center="01-02-03"),
            withdrawal("2", "PANEL", day, 3, center="05-01-01"),
            withdrawal("3", "PANEL", day - timedelta(days=1), 2, center="01-02-03"),
            withdrawal("4", "OTHER", day, 9, center="01-02-03"),
        ]))

        with self.session_factory() as session, patch("app.services.erp.get_material_movement_history") as erp_history_call:
            series = erp_history.movement_history(self.settings, "panel", session=session, start_day=day - timedelta(days=1), end_day=day)
            only_production = erp_history.movement_history(
                self.settings, "PANEL", session=session, start_day=day, end_day=day, cost_centers=["01-00-00"],
            )
            without_admin = erp_history.movement_history(
                self.settings, "PANEL", session=session, start_day=day, end_day=day, excluded_cost_centers=["05-00-00"],
            )
            details = erp_history.movement_details(self.settings, "PANEL", session=session, start_day=day - timedelta(days=1), end_day=day)
            withdrawals = erp_history.outgoing_withdrawals(self.settings, session=session, start_day=day, end_day=day)

        erp_history_call.assert_not_called()
        self.assertEqual(series, [
            {"date": (day - timedelta(days=1)).isoformat(), "quantity": 2.0},
            {"date": day.isoformat(), "quantity": 7.0},
        ])
        self.assertEqual(only_production, [{"date": day.isoformat(), "quantity": 4.0}])
        self.assertEqual(without_admin, [{"date": day.isoformat(), "quantity": 4.0}])
        self.assertEqual([detail["movement_internal_number"] for detail in details], ["1", "2", "3"])
        self.assertEqual(details[0]["ceco_name"], "Paneles")
        self.assertEqual(details[0]["desc_sub"], "Solicitud 1")
        self.assertEqual(sorted(row[0] for row in withdrawals["rows"]), ["OTHER", "PANEL", "PANEL"])
        self.assertEqual(withdrawals["products"]["PANEL"], {"name": "Material PANEL", "unit": "UN"})

    def test_readers_ask_the_erp_for_days_the_copy_does_not_cover(self) -> None:
        self.run_sync(FakeErp([]))
        too_old = self.today - timedelta(days=200)

        with self.session_factory() as session, patch("app.services.erp.get_material_movement_history", return_value=[]) as erp_call:
            erp_history.movement_history(self.settings, "PANEL", session=session, start_day=too_old, end_day=self.today)

        erp_call.assert_called_once()

    def test_a_stale_copy_is_not_used(self) -> None:
        self.run_sync(FakeErp([]))
        with self.session_factory() as session:
            state = session.get(ErpSyncState, erp_history.STATE_KEY)
            state.covered_to = self.today - timedelta(days=3)
            session.commit()
            self.assertFalse(erp_history.store_covers(session, self.today - timedelta(days=10), self.today))

    def test_without_tables_readers_fall_back_to_the_erp(self) -> None:
        engine = create_engine_for_url("sqlite://")
        session_factory = sessionmaker(bind=engine)
        with session_factory() as session, patch("app.services.erp.get_material_movement_history", return_value=[]) as erp_call:
            erp_history.movement_history(self.settings, "PANEL", session=session, days=30)
        erp_call.assert_called_once()
        self.assertIsNone(erp_history.run_due_sync(self.settings, session_factory, fetch=FakeErp([]), sleep=self.sleeps.append))
        engine.dispose()

    def test_disabled_outside_production_unless_turned_on(self) -> None:
        self.assertFalse(erp_history.sync_enabled(Settings(database_url="sqlite://", environment="development", softland_password="x")))
        self.assertTrue(erp_history.sync_enabled(Settings(database_url="sqlite://", environment="production", softland_password="x")))


if __name__ == "__main__":
    unittest.main()
