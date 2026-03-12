from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models import Role, User, UserRole
from app.services.auth import ASSIGNABLE_ROLE_CODES, get_role_catalog, get_user_by_username, hash_password, role_codes


def list_users(session: Session) -> list[User]:
    return session.scalars(
        select(User)
        .options(selectinload(User.roles).selectinload(UserRole.role))
        .order_by(User.username)
    ).all()


def serialize_role_catalog() -> list[dict]:
    return [
        {
            "code": role.code,
            "name": role.name,
            "description": role.description,
            "assignable": role.assignable,
        }
        for role in get_role_catalog()
    ]


def serialize_user(user: User) -> dict:
    return {
        "id": user.id,
        "username": user.username,
        "display_name": user.display_name,
        "email": user.email,
        "is_active": user.is_active,
        "roles": sorted(role_codes(user)),
        "created_at": user.created_at.isoformat(),
    }


def validate_assignable_role_codes(requested_role_codes: list[str]) -> list[str]:
    normalized = sorted({code.strip() for code in requested_role_codes if code and code.strip()})
    if not normalized:
        raise ValueError("At least one role must be selected")
    invalid = [code for code in normalized if code not in ASSIGNABLE_ROLE_CODES]
    if invalid:
        raise ValueError(f"Unsupported role selection: {', '.join(invalid)}")
    return normalized


def create_user(
    session: Session,
    *,
    username: str,
    display_name: str,
    email: str,
    password: str,
    role_codes_to_assign: list[str],
    is_active: bool = True,
) -> User:
    normalized_username = username.strip().lower()
    normalized_display_name = display_name.strip()
    normalized_email = email.strip().lower()
    if not normalized_username:
        raise ValueError("Username is required")
    if not normalized_display_name:
        raise ValueError("Display name is required")
    if not normalized_email:
        raise ValueError("Email is required")
    if get_user_by_username(session, normalized_username) is not None:
        raise ValueError("Username already exists")
    if session.scalar(select(User.id).where(User.email == normalized_email)) is not None:
        raise ValueError("Email already exists")

    validated_role_codes = validate_assignable_role_codes(role_codes_to_assign)
    role_rows = session.scalars(select(Role).where(Role.code.in_(validated_role_codes))).all()
    roles_by_code = {role.code: role for role in role_rows}
    missing = [code for code in validated_role_codes if code not in roles_by_code]
    if missing:
        raise ValueError(f"Roles are missing in the database: {', '.join(missing)}")

    user = User(
        username=normalized_username,
        display_name=normalized_display_name,
        email=normalized_email,
        password_hash=hash_password(password),
        is_active=is_active,
    )
    session.add(user)
    session.flush()

    for code in validated_role_codes:
        session.add(UserRole(user=user, role=roles_by_code[code]))

    session.commit()
    session.refresh(user)
    session.refresh(user, attribute_names=["roles"])
    return get_user_by_username(session, normalized_username) or user


def update_user(
    session: Session,
    *,
    user_id: int,
    display_name: str,
    email: str,
    password: str | None,
    role_codes_to_assign: list[str],
    is_active: bool,
) -> User | None:
    user = session.scalar(
        select(User)
        .where(User.id == user_id)
        .options(selectinload(User.roles).selectinload(UserRole.role))
    )
    if user is None:
        return None
    if user.username == "sysadmin" and not is_active:
        raise ValueError("The reserved sysadmin user cannot be deactivated")

    normalized_display_name = display_name.strip()
    normalized_email = email.strip().lower()
    if not normalized_display_name:
        raise ValueError("Display name is required")
    if not normalized_email:
        raise ValueError("Email is required")

    existing_email_user_id = session.scalar(select(User.id).where(User.email == normalized_email, User.id != user_id))
    if existing_email_user_id is not None:
        raise ValueError("Email already exists")

    validated_role_codes = validate_assignable_role_codes(role_codes_to_assign)
    role_rows = session.scalars(select(Role).where(Role.code.in_(validated_role_codes))).all()
    roles_by_code = {role.code: role for role in role_rows}
    missing = [code for code in validated_role_codes if code not in roles_by_code]
    if missing:
        raise ValueError(f"Roles are missing in the database: {', '.join(missing)}")

    user.display_name = normalized_display_name
    user.email = normalized_email
    user.is_active = is_active
    if password is not None and password.strip():
        user.password_hash = hash_password(password)

    for assignment in list(user.roles):
        if assignment.role.code != "sysadmin":
            user.roles.remove(assignment)
    session.flush()

    current_codes = {assignment.role.code for assignment in user.roles}
    for code in validated_role_codes:
        if code not in current_codes:
            session.add(UserRole(user=user, role=roles_by_code[code]))

    session.commit()
    return get_user_by_username(session, user.username)


def delete_user(session: Session, *, user_id: int) -> bool:
    user = session.scalar(select(User).where(User.id == user_id))
    if user is None:
        return False
    if user.username == "sysadmin":
        raise ValueError("The reserved sysadmin user cannot be deleted")
    session.delete(user)
    session.commit()
    return True
