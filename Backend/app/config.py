from __future__ import annotations

import os
from pathlib import Path

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


DEFAULT_DATABASE_URL = "postgresql+psycopg://spec_sheets:spec_sheets@127.0.0.1:5432/spec_sheets"
BACKEND_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND_DIR.parent
PRODUCTION_II_BACKEND_ENV = REPO_ROOT.parent / "Production II" / "backend" / ".env"


def _read_env_value(env_path: Path, key: str) -> str | None:
    try:
        contents = env_path.read_text(encoding="utf-8")
    except OSError:
        return None
    prefix = f"{key}="
    for raw_line in contents.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or not line.startswith(prefix):
            continue
        return line[len(prefix):].strip()
    return None


class Settings(BaseSettings):
    app_name: str = "Spec Sheets"
    environment: str = "development"
    database_url: str = DEFAULT_DATABASE_URL
    production_database_url: str | None = None
    seed_demo_data: bool = True
    require_schema: bool = True
    session_secret: str = "spec-sheets-internal-session-secret"
    session_cookie_name: str = "spec_sheets_session"
    allow_trusted_user_header: bool = False
    softland_driver: str = "ODBC Driver 18 for SQL Server"
    softland_server: str | None = "216.155.78.65"
    softland_database: str | None = "PATAGUALHOME2024"
    softland_username: str | None = "phconsulta"
    softland_password: str | None = Field(default_factory=lambda: os.getenv("SOFTLAND_PASSWORD"))

    @model_validator(mode="after")
    def apply_softland_password_fallback(self) -> "Settings":
        if not self.softland_password:
            self.softland_password = os.getenv("SOFTLAND_PASSWORD")
        if not self.production_database_url:
            self.production_database_url = (
                os.getenv("SPEC_SHEETS_PRODUCTION_DATABASE_URL")
                or _read_env_value(PRODUCTION_II_BACKEND_ENV, "DATABASE_URL")
            )
        return self

    model_config = SettingsConfigDict(
        env_prefix="SPEC_SHEETS_",
        env_file=(REPO_ROOT / ".env", BACKEND_DIR / ".env"),
        extra="ignore",
    )
