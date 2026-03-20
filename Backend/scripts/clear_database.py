from __future__ import annotations

import argparse
import sys
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.exc import OperationalError

REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND_DIR = REPO_ROOT / "Backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.config import Settings
from app.database import create_engine_for_url, schema_is_ready


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Clear all application data from the target database while keeping the schema in place."
    )
    parser.add_argument(
        "--database-url",
        default=None,
        help="Target database URL. Defaults to SPEC_SHEETS_DATABASE_URL / backend settings.",
    )
    parser.add_argument(
        "--include-alembic-version",
        action="store_true",
        help="Also clear the alembic_version table. Normally this is left alone.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print which tables would be cleared, but do not execute the wipe.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    settings = Settings()
    database_url = args.database_url or settings.database_url
    engine = create_engine_for_url(
        database_url,
        connect_timeout_seconds=settings.database_connect_timeout_seconds,
        statement_timeout_ms=settings.database_statement_timeout_ms,
    )

    try:
        if not schema_is_ready(engine):
            print("Target database schema is missing. Run `alembic upgrade head` first.", file=sys.stderr)
            return 1
    except OperationalError as exc:
        print(
            "Could not connect to the target database.\n"
            f"Database URL: {database_url}\n"
            "Check that PostgreSQL is running, the URL is correct, and the database is reachable.",
            file=sys.stderr,
        )
        print(f"Driver error: {exc}", file=sys.stderr)
        return 1

    excluded = {"alembic_version"} if not args.include_alembic_version else set()

    with engine.begin() as connection:
        table_rows = connection.execute(
            text(
                """
                SELECT tablename
                FROM pg_catalog.pg_tables
                WHERE schemaname = 'public'
                ORDER BY tablename
                """
            )
        ).all()
        table_names = [row[0] for row in table_rows if row[0] not in excluded]

        if not table_names:
            print("No tables matched the clear operation.")
            return 0

        print("Tables to clear:")
        for name in table_names:
            print(f"- {name}")

        if args.dry_run:
            print("\nDry run only; no changes were made.")
            return 0

        quoted = ", ".join(f'"public"."{name}"' for name in table_names)
        connection.execute(text(f"TRUNCATE TABLE {quoted} RESTART IDENTITY CASCADE"))

    print("\nDatabase contents cleared.")
    if not args.include_alembic_version:
        print("`alembic_version` was preserved.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
