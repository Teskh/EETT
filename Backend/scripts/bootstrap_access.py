from __future__ import annotations

import argparse
import sys
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.exc import OperationalError

REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND_DIR = REPO_ROOT / "Backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.config import Settings
from app.database import create_engine_for_url, create_session_factory, schema_is_ready
from app.models import Role, User, UserRole
from app.services.auth import ROLE_DEFINITIONS, hash_password


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Create or update a loginable bootstrap user after clearing/importing the database."
    )
    parser.add_argument("--username", default="sysadmin", help="Username for the bootstrap account.")
    parser.add_argument("--password", required=True, help="Password to set for the bootstrap account.")
    parser.add_argument("--display-name", default="System Administrator", help="Display name for the bootstrap account.")
    parser.add_argument("--email", default="sysadmin@specsheets.local", help="Email for the bootstrap account.")
    parser.add_argument(
        "--database-url",
        default=None,
        help="Target database URL. Defaults to SPEC_SHEETS_DATABASE_URL / backend settings.",
    )
    parser.add_argument(
        "--sysadmin",
        action="store_true",
        help="Grant both sysadmin and admin roles. If omitted, grants admin only.",
    )
    return parser.parse_args()


def ensure_role(session, *, code: str, name: str, description: str) -> Role:
    role = session.scalar(select(Role).where(Role.code == code))
    if role is None:
        role = Role(code=code, name=name, description=description)
        session.add(role)
        session.flush()
    return role


def ensure_user_role(session, *, user: User, role: Role) -> None:
    existing = session.scalar(select(UserRole.id).where(UserRole.user_id == user.id, UserRole.role_id == role.id))
    if existing is None:
        session.add(UserRole(user=user, role=role))


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

    session_factory = create_session_factory(
        database_url,
        connect_timeout_seconds=settings.database_connect_timeout_seconds,
        statement_timeout_ms=settings.database_statement_timeout_ms,
    )

    username = args.username.strip().lower()
    email = args.email.strip().lower()
    display_name = args.display_name.strip()
    if not username or not display_name or not email:
        print("Username, display name, and email are required.", file=sys.stderr)
        return 1

    requested_codes = ["admin"]
    if args.sysadmin or username == "sysadmin":
        requested_codes = ["sysadmin", "admin"]

    with session_factory() as session:
        roles_by_code: dict[str, Role] = {}
        for definition in ROLE_DEFINITIONS:
            roles_by_code[definition.code] = ensure_role(
                session,
                code=definition.code,
                name=definition.name,
                description=definition.description,
            )

        user = session.scalar(select(User).where(User.username == username))
        if user is None:
            user = session.scalar(select(User).where(User.email == email))

        if user is None:
            user = User(
                username=username,
                display_name=display_name,
                email=email,
                password_hash=hash_password(args.password),
                is_active=True,
            )
            session.add(user)
            session.flush()
            action = "created"
        else:
            user.username = username
            user.display_name = display_name
            user.email = email
            user.password_hash = hash_password(args.password)
            user.is_active = True
            action = "updated"

        for code in requested_codes:
            ensure_user_role(session, user=user, role=roles_by_code[code])

        session.commit()

    print(f"Bootstrap user {action}: {username}")
    print(f"Roles granted: {', '.join(requested_codes)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
