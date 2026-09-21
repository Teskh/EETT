from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

from fastapi.testclient import TestClient

from app.config import Settings
from app.database import Base
from app.main import create_app
from app.models import Role, User, UserRole
from app.services.auth import hash_password
from app.services.microsoft_auth import MicrosoftAuthError, MicrosoftUserProfile


class LoginSessionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.app = create_app(Settings(
            _env_file=None,
            database_url=f"sqlite+pysqlite:///{Path(self.temp_dir.name) / 'auth.db'}",
            environment="test",
            seed_demo_data=False,
            require_schema=False,
            backup_scheduler_enabled=False,
            allow_trusted_user_header=False,
            password_login_enabled=True,
            session_secret="isolated-auth-regression-test",
            microsoft_tenant_id="test-tenant",
            microsoft_client_id="test-client",
            microsoft_client_secret="test-secret",
            microsoft_redirect_uri="http://testserver/api/auth/microsoft/callback",
        ))
        Base.metadata.create_all(self.app.state.engine)
        with self.app.state.session_factory() as session:
            password_hash = hash_password("test-password")
            for username, role_code in [("thomas", "admin"), ("gonzalo", "editor"), ("diego", "guest")]:
                role = Role(code=role_code, name=role_code)
                user = User(
                    username=username,
                    display_name=username.title(),
                    email=f"{username}@example.com",
                    password_hash=password_hash,
                    microsoft_tenant_id="test-tenant",
                    microsoft_object_id=f"{username}-object",
                )
                user.roles.append(UserRole(role=role))
                session.add(user)
            session.commit()
        self.client = TestClient(self.app)

    def tearDown(self) -> None:
        self.client.close()
        self.app.state.engine.dispose()
        self.temp_dir.cleanup()

    def login(self, client: TestClient, username: str = "thomas") -> None:
        response = client.post("/api/v1/login", json={"username": username, "password": "test-password"})
        self.assertEqual(response.status_code, 200, response.text)

    def start_microsoft(self, client: TestClient, prefix: str = "/api") -> str:
        response = client.get(f"{prefix}/auth/microsoft/login", follow_redirects=False)
        self.assertEqual(response.status_code, 303)
        self.assert_private(response)
        return parse_qs(urlsplit(response.headers["location"]).query)["state"][0]

    def assert_private(self, response) -> None:
        self.assertEqual(response.headers["cache-control"], "private, no-store")
        self.assertIn("Cookie", response.headers["vary"])

    def test_starting_microsoft_login_removes_previous_identity_on_both_routes(self) -> None:
        for prefix in ["/api", "/api/v1"]:
            with self.subTest(prefix=prefix):
                self.login(self.client)
                self.start_microsoft(self.client, prefix)
                self.assertEqual(self.client.get("/api/v1/session").status_code, 401)

    def test_failed_callback_cannot_restore_previous_identity(self) -> None:
        for failure in ["invalid-state", "denied", "missing-code", "token-error", "profile-error"]:
            with self.subTest(failure=failure):
                self.login(self.client)
                state = self.start_microsoft(self.client)
                params = {"state": state, "code": "code"}
                if failure == "invalid-state":
                    params["state"] = "incorrect"
                elif failure == "denied":
                    params["error"] = "access_denied"
                elif failure == "missing-code":
                    del params["code"]
                with (
                    patch("app.services.microsoft_auth.exchange_code_for_token", return_value="token",
                          side_effect=MicrosoftAuthError("token failed") if failure == "token-error" else None),
                    patch("app.services.microsoft_auth.fetch_user_profile", side_effect=MicrosoftAuthError("profile failed")),
                ):
                    response = self.client.get("/api/auth/microsoft/callback", params=params, follow_redirects=False)
                self.assertEqual(response.status_code, 303)
                self.assertIn("auth_error=", response.headers["location"])
                self.assert_private(response)
                self.assertEqual(self.client.get("/api/v1/session").status_code, 401)

    def test_unsolicited_callback_clears_existing_login(self) -> None:
        self.login(self.client)
        self.client.get("/api/v1/auth/microsoft/callback?state=old&code=code", follow_redirects=False)
        self.assertEqual(self.client.get("/api/v1/session").status_code, 401)

    def test_unavailable_microsoft_login_clears_existing_login(self) -> None:
        for setting, value in [("microsoft_login_enabled", False), ("microsoft_client_id", "")]:
            with self.subTest(setting=setting):
                self.login(self.client)
                original = getattr(self.app.state.settings, setting)
                setattr(self.app.state.settings, setting, value)
                try:
                    response = self.client.get("/api/auth/microsoft/login", follow_redirects=False)
                    self.assertIn("auth_error=", response.headers["location"])
                    self.assertEqual(self.client.get("/api/v1/session").status_code, 401)
                finally:
                    setattr(self.app.state.settings, setting, original)

    def test_successful_account_switch_and_separate_browsers_keep_their_own_identity(self) -> None:
        with TestClient(self.app) as other:
            self.login(other, "gonzalo")
            self.login(self.client, "thomas")
            state = self.start_microsoft(self.client)
            profile = MicrosoftUserProfile("diego-object", "diego@example.com", "Diego")
            with (
                patch("app.services.microsoft_auth.exchange_code_for_token", return_value="token"),
                patch("app.services.microsoft_auth.fetch_user_profile", return_value=profile),
            ):
                response = self.client.get("/api/auth/microsoft/callback", params={"state": state, "code": "code"}, follow_redirects=False)
            self.assertEqual(response.status_code, 303)
            self.assertNotIn("auth_error", response.headers["location"])
            self.assert_private(response)
            for client, username, roles in [(self.client, "diego", ["guest"]), (other, "gonzalo", ["editor"])]:
                session = client.get("/api/v1/session")
                self.assertEqual(session.json()["username"], username)
                self.assertEqual(session.json()["roles"], roles)
                self.assert_private(session)

    def test_session_login_logout_and_errors_are_not_cacheable(self) -> None:
        self.assert_private(self.client.get("/api/v1/session"))
        response = self.client.post("/api/v1/login", json={"username": "thomas", "password": "test-password"})
        self.assertEqual(response.status_code, 200)
        self.assert_private(response)
        self.assert_private(self.client.get("/api/v1/session"))
        self.assert_private(self.client.get("/api/v1/does-not-exist"))
        self.assert_private(self.client.post("/api/v1/logout"))
        self.assertEqual(self.client.get("/api/v1/session").status_code, 401)


if __name__ == "__main__":
    unittest.main()
