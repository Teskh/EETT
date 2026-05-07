from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND_DIR = REPO_ROOT / "Backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from sqlalchemy import select
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm.attributes import flag_modified

from app.config import Settings
from app.database import create_engine_for_url, create_session_factory, schema_is_ready
from app.models import ProjectActivityGroup, ProjectActivityLog

from import_legacy_sqlite import translate_legacy_activity_field, translate_legacy_activity_text


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Rewrite imported legacy activity titles/headlines/change labels from English to Spanish."
    )
    parser.add_argument(
        "--database-url",
        default=None,
        help="Target database URL. Defaults to SPEC_SHEETS_DATABASE_URL / backend settings.",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Commit changes. Without this flag, the script reports what would change and rolls back.",
    )
    return parser.parse_args()


def rewrite_details(details: Any) -> tuple[Any, bool]:
    if not isinstance(details, dict):
        return details, False

    changed = False
    rewritten = dict(details)

    headline = rewritten.get("headline")
    if isinstance(headline, str):
        translated = translate_legacy_activity_text(headline)
        if translated != headline:
            rewritten["headline"] = translated
            changed = True

    changes = rewritten.get("changes")
    if isinstance(changes, list):
        rewritten_changes = []
        for change in changes:
            if not isinstance(change, dict):
                rewritten_changes.append(change)
                continue
            rewritten_change = dict(change)
            label = rewritten_change.get("label")
            if isinstance(label, str):
                translated = translate_legacy_activity_field(label)
                if translated != label:
                    rewritten_change["label"] = translated
                    changed = True
            rewritten_changes.append(rewritten_change)
        if changed:
            rewritten["changes"] = rewritten_changes

    return rewritten, changed


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
        print(f"Could not connect to the target database: {exc}", file=sys.stderr)
        return 1

    session_factory = create_session_factory(
        database_url,
        connect_timeout_seconds=settings.database_connect_timeout_seconds,
        statement_timeout_ms=settings.database_statement_timeout_ms,
    )

    group_updates = 0
    log_updates = 0
    with session_factory() as session:
        for group in session.scalars(select(ProjectActivityGroup)).all():
            translated = translate_legacy_activity_text(group.title or "")
            if group.title and translated != group.title:
                group.title = translated
                group_updates += 1

        for log in session.scalars(select(ProjectActivityLog)).all():
            details, changed = rewrite_details(log.details)
            if changed:
                log.details = details
                flag_modified(log, "details")
                log_updates += 1

        if args.apply:
            session.commit()
        else:
            session.rollback()

    print("Legacy activity rewrite summary")
    print(f"- groups updated: {group_updates}")
    print(f"- logs updated: {log_updates}")
    if not args.apply:
        print("- dry run only; no changes were committed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
