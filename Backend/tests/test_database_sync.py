from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.services import database_sync


class DatabaseSyncServiceTests(unittest.TestCase):
    def make_settings(self, backup_dir: str, **overrides) -> Settings:
        values = {
            "backup_dir": backup_dir,
            "environment": "development",
            "database_sync_source_url": "https://example.test/eett/",
            "database_sync_token": "test-sync-token",
            "database_sync_max_dump_bytes": 1024,
        }
        values.update(overrides)
        return Settings(**values)

    def test_loopback_guard_requires_local_environment_and_both_hosts(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            settings = self.make_settings(temp_dir)
            self.assertTrue(
                database_sync.is_local_sync_request(
                    settings,
                    request_host="localhost",
                    client_host="127.0.0.1",
                )
            )
            self.assertTrue(database_sync.is_loopback_host("::1"))
            self.assertFalse(
                database_sync.is_local_sync_request(
                    settings,
                    request_host="example.test",
                    client_host="127.0.0.1",
                )
            )
            production = self.make_settings(temp_dir, environment="production")
            self.assertFalse(
                database_sync.is_local_sync_request(
                    production,
                    request_host="localhost",
                    client_host="127.0.0.1",
                )
            )

    def test_build_export_url_preserves_production_base_path(self) -> None:
        self.assertEqual(
            database_sync.build_export_url("https://example.test/eett/"),
            "https://example.test/eett/api/v1/database-sync/export",
        )
        with self.assertRaises(ValueError):
            database_sync.build_export_url("http://example.test/eett")

    def test_status_requires_shared_token(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            settings = self.make_settings(temp_dir, database_sync_token=None)
            status = database_sync.sync_status(
                settings,
                request_host="localhost",
                client_host="127.0.0.1",
            )
            self.assertFalse(status["available"])
            self.assertIn("SPEC_SHEETS_DATABASE_SYNC_TOKEN", str(status["reason"]))

    def test_download_accepts_postgres_custom_dump(self) -> None:
        dump_content = b"PGDMP" + b"database-content"

        def handler(request: httpx.Request) -> httpx.Response:
            self.assertEqual(request.method, "POST")
            self.assertEqual(request.url.path, "/eett/api/v1/database-sync/export")
            self.assertEqual(request.headers[database_sync.SYNC_TOKEN_HEADER], "test-sync-token")
            return httpx.Response(200, content=dump_content)

        with tempfile.TemporaryDirectory() as temp_dir:
            settings = self.make_settings(temp_dir)
            destination = Path(temp_dir) / "download.dump"
            client = httpx.Client(transport=httpx.MockTransport(handler))
            with patch("app.services.database_sync.httpx.Client", return_value=client):
                size = database_sync.download_production_dump(settings, destination)
            self.assertEqual(size, len(dump_content))
            self.assertEqual(destination.read_bytes(), dump_content)

    def test_download_rejects_invalid_dump_and_removes_partial_file(self) -> None:
        def handler(_request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, content=b"not-a-postgres-dump")

        with tempfile.TemporaryDirectory() as temp_dir:
            settings = self.make_settings(temp_dir)
            destination = Path(temp_dir) / "invalid.dump"
            client = httpx.Client(transport=httpx.MockTransport(handler))
            with patch("app.services.database_sync.httpx.Client", return_value=client):
                with self.assertRaisesRegex(RuntimeError, "invalid PostgreSQL"):
                    database_sync.download_production_dump(settings, destination)
            self.assertFalse(destination.exists())

    def test_sync_restores_download_then_removes_temporary_dump(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            settings = self.make_settings(temp_dir)

            def fake_download(_settings: Settings, output_path: Path) -> int:
                output_path.parent.mkdir(parents=True, exist_ok=True)
                output_path.write_bytes(b"PGDMPpayload")
                return 12

            restore_result = {
                "primary_db": "dev",
                "archived_db": "dev_restore_1",
                "restored_from": settings.database_sync_source_url,
                "checkpoint_backup": {"filename": "checkpoint.dump"},
                "pruned": [],
            }
            with (
                patch("app.services.database_sync.download_production_dump", side_effect=fake_download),
                patch("app.services.database_sync.backup_service.restore_dump_file", return_value=restore_result) as restore_mock,
            ):
                result = database_sync.sync_from_production(settings)

            self.assertEqual(result["downloaded_size_bytes"], 12)
            restore_path = restore_mock.call_args.args[1]
            self.assertFalse(restore_path.exists())
            self.assertEqual(restore_mock.call_args.kwargs["checkpoint_label"], "Pre-production sync checkpoint")


    def test_production_export_endpoint_requires_shared_token(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            settings = self.make_settings(
                temp_dir,
                environment="production",
                seed_demo_data=False,
                require_schema=False,
                backup_scheduler_enabled=False,
            )
            dump_path = Path(temp_dir) / "production.dump"
            dump_path.write_bytes(b"PGDMPendpoint-payload")
            app = create_app(settings)
            with (
                patch("app.services.database_sync.create_export_dump", return_value=dump_path),
                patch("app.services.database_sync.remove_export_dump"),
                TestClient(app) as client,
            ):
                rejected = client.post("/api/v1/database-sync/export")
                accepted = client.post(
                    "/api/v1/database-sync/export",
                    headers={database_sync.SYNC_TOKEN_HEADER: "test-sync-token"},
                )

            self.assertEqual(rejected.status_code, 401)
            self.assertEqual(accepted.status_code, 200)
            self.assertEqual(accepted.content, b"PGDMPendpoint-payload")


if __name__ == "__main__":
    unittest.main()

