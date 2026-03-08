from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


DEFAULT_DATABASE_URL = "postgresql+psycopg://spec_sheets:spec_sheets@127.0.0.1:5432/spec_sheets"


class Settings(BaseSettings):
    app_name: str = "Spec Sheets"
    environment: str = "development"
    database_url: str = DEFAULT_DATABASE_URL
    seed_demo_data: bool = True
    require_schema: bool = True

    model_config = SettingsConfigDict(
        env_prefix="SPEC_SHEETS_",
        env_file=".env",
        extra="ignore",
    )
