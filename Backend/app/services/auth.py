from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
from dataclasses import dataclass

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models import Project, ProjectMembership, ProjectStatus, Role, User, UserRole
from app.models.entities import MembershipRole


@dataclass(frozen=True)
class RoleDefinition:
    code: str
    name: str
    description: str
    assignable: bool = True


ROLE_DEFINITIONS: tuple[RoleDefinition, ...] = (
    # Sysadmin: reserved bootstrap operator. This role can sign in, manage users,
    # and keeps full access while the broader authorization surface is still being completed.
    RoleDefinition(
        code="sysadmin",
        name="Sysadmin",
        description="Reserved bootstrap user with full access and exclusive access to the user editor.",
        assignable=False,
    ),
    # Admin: full application access. This includes catalog/project editing, ERP/admin tooling,
    # project status changes, approval actions, project deletion, and cost-model export access.
    RoleDefinition(
        code="admin",
        name="Admin",
        description="Full application access, including ERP/admin tooling and cost-model export.",
    ),
    # Editor: can edit the catalog and projects, but should not use admin-only ERP tooling
    # or the cost-model export once those screens are fully implemented.
    RoleDefinition(
        code="editor",
        name="Editor",
        description="Can edit the catalog and projects, but not admin-only ERP tools or cost-model export.",
    ),
    # OT: same editing scope as Editor, plus access to the cost-model export workflow.
    RoleDefinition(
        code="ot",
        name="OT",
        description="Same editing scope as Editor, plus access to the cost-model export.",
    ),
    # Viewer: read-only access. This role can browse projects and outputs, but should not edit content;
    # some price-sensitive outputs may remain hidden as those features are implemented.
    RoleDefinition(
        code="viewer",
        name="Viewer",
        description="Read-only project and output access, with future price-sensitive views kept restricted.",
    ),
)

ROLE_DEFINITION_MAP = {role.code: role for role in ROLE_DEFINITIONS}
ASSIGNABLE_ROLE_CODES = {role.code for role in ROLE_DEFINITIONS if role.assignable}
PASSWORD_HASH_ITERATIONS = 120_000

PAGE_DEFINITIONS: tuple[dict[str, str], ...] = (
    {"key": "catalog", "label": "Editor de Base de Datos"},
    {"key": "material_dashboard", "label": "Panel de Materiales"},
    {"key": "cost_model", "label": "Modelo de Costos"},
    {"key": "history", "label": "Historial de Cambios"},
    {"key": "projects", "label": "Proyectos"},
    {"key": "settings", "label": "Configuracion"},
)
PAGE_KEYS = {page["key"] for page in PAGE_DEFINITIONS}


def get_user_by_username(session: Session, username: str) -> User | None:
    return session.scalar(
        select(User)
        .where(User.username == username)
        .options(
            selectinload(User.roles).selectinload(UserRole.role),
            selectinload(User.roles).selectinload(UserRole.role).selectinload(Role.page_access),
            selectinload(User.project_memberships),
        )
    )


def hash_password(password: str) -> str:
    raw_password = password.strip()
    if not raw_password:
        raise ValueError("Password cannot be blank")
    salt = secrets.token_bytes(16)
    derived = hashlib.pbkdf2_hmac("sha256", raw_password.encode("utf-8"), salt, PASSWORD_HASH_ITERATIONS)
    return "$".join(
        [
            "pbkdf2_sha256",
            str(PASSWORD_HASH_ITERATIONS),
            base64.b64encode(salt).decode("ascii"),
            base64.b64encode(derived).decode("ascii"),
        ]
    )


def verify_password(password: str, password_hash: str | None) -> bool:
    if not password_hash:
        return False

    try:
        algorithm, iterations_raw, salt_raw, expected_raw = password_hash.split("$", 3)
    except ValueError:
        return False

    if algorithm != "pbkdf2_sha256":
        return False

    try:
        iterations = int(iterations_raw)
        salt = base64.b64decode(salt_raw.encode("ascii"))
        expected = base64.b64decode(expected_raw.encode("ascii"))
    except (ValueError, TypeError):
        return False

    candidate = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return hmac.compare_digest(candidate, expected)


def authenticate_user(session: Session, username: str, password: str) -> User | None:
    user = get_user_by_username(session, username.strip())
    if user is None or not user.is_active:
        return None
    if not verify_password(password, user.password_hash):
        return None
    return user


def resolve_current_user(
    session: Session,
    *,
    session_username: str | None,
    trusted_username: str | None = None,
    allow_trusted_username: bool = False,
) -> User | None:
    if allow_trusted_username and trusted_username:
        return get_user_by_username(session, trusted_username)
    if session_username:
        return get_user_by_username(session, session_username)
    return None


def get_current_user(
    session: Session,
    *,
    session_username: str | None,
    trusted_username: str | None = None,
    allow_trusted_username: bool = False,
) -> User:
    user = resolve_current_user(
        session,
        session_username=session_username,
        trusted_username=trusted_username,
        allow_trusted_username=allow_trusted_username,
    )
    if user is None:
        raise HTTPException(status_code=401, detail="Authentication required")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="User account is inactive")
    return user


def serialize_session_user(user: User, *, is_guest: bool = False) -> dict:
    permissions = build_permission_payload(user)
    page_access = build_page_access_payload(user)
    if is_guest:
        permissions = {
            **permissions,
            "project_edit": False,
            "project_change_status": False,
            "project_delete": False,
            "cost_model_export": False,
        }
        page_access = {
            **page_access,
            "cost_model": {"can_read": False, "can_edit": False},
        }
    return {
        "username": user.username,
        "display_name": user.display_name,
        "roles": sorted(role_codes(user)),
        "permissions": permissions,
        "page_access": page_access,
        "is_guest": is_guest,
    }


def role_codes(user: User) -> set[str]:
    return {assignment.role.code for assignment in user.roles}


def get_role_catalog(*, include_reserved: bool = False) -> list[RoleDefinition]:
    return [role for role in ROLE_DEFINITIONS if include_reserved or role.assignable]


def is_sysadmin(user: User) -> bool:
    return "sysadmin" in role_codes(user)


def get_project_membership(user: User, project_id: int) -> ProjectMembership | None:
    return next((membership for membership in user.project_memberships if membership.project_id == project_id), None)


def can_edit_catalog(user: User) -> bool:
    codes = role_codes(user)
    return any(code in codes for code in {"sysadmin", "admin", "editor", "ot"})


def can_create_project(user: User) -> bool:
    return can_edit_catalog(user)


def can_access_material_dashboard(user: User) -> bool:
    return any(code in role_codes(user) for code in {"sysadmin", "admin", "editor", "ot"})


def can_use_erp_admin(user: User) -> bool:
    return any(code in role_codes(user) for code in {"sysadmin", "admin"})


def can_use_cost_model_export(user: User) -> bool:
    return any(code in role_codes(user) for code in {"sysadmin", "admin", "ot"})


def can_manage_users(user: User) -> bool:
    return is_sysadmin(user)


def default_role_page_access(role_code: str, page_key: str) -> tuple[bool, bool]:
    if role_code == "sysadmin":
        return True, True
    if role_code == "admin":
        if page_key == "settings":
            return False, False
        return True, True
    if role_code in {"editor", "ot"}:
        if page_key in {"catalog", "projects", "cost_model"}:
            return True, True
        if page_key in {"material_dashboard", "history"}:
            return True, False
        return False, False
    if role_code == "viewer":
        if page_key in {"projects", "cost_model", "history"}:
            return True, False
        return False, False
    return False, False


def get_role_page_access(role: Role, page_key: str) -> tuple[bool, bool]:
    if page_key not in PAGE_KEYS:
        return False, False
    row = next((access for access in role.page_access if access.page_key == page_key), None)
    if row is not None:
        return row.can_read or row.can_edit, row.can_edit
    return default_role_page_access(role.code, page_key)


def build_role_page_access_payload(role: Role) -> dict:
    return {
        page["key"]: {
            "can_read": get_role_page_access(role, page["key"])[0],
            "can_edit": get_role_page_access(role, page["key"])[1],
        }
        for page in PAGE_DEFINITIONS
    }


def default_page_access(user: User, page_key: str) -> tuple[bool, bool]:
    if page_key == "catalog":
        access = can_edit_catalog(user)
        return access, access
    if page_key == "material_dashboard":
        return can_access_material_dashboard(user), can_use_erp_admin(user)
    if page_key == "cost_model":
        return can_edit_catalog(user) or "viewer" in role_codes(user), can_edit_catalog(user)
    if page_key == "history":
        return can_edit_catalog(user) or "viewer" in role_codes(user), False
    if page_key == "projects":
        return can_edit_catalog(user) or "viewer" in role_codes(user), can_create_project(user)
    if page_key == "settings":
        access = can_manage_users(user)
        return access, access
    return False, False


def get_page_access(user: User, page_key: str) -> tuple[bool, bool]:
    if page_key not in PAGE_KEYS:
        return False, False
    can_read = False
    can_edit = False
    for assignment in user.roles:
        role_can_read, role_can_edit = get_role_page_access(assignment.role, page_key)
        can_read = can_read or role_can_read
        can_edit = can_edit or role_can_edit
    return can_read, can_edit


def can_read_page(user: User, page_key: str) -> bool:
    can_read, _ = get_page_access(user, page_key)
    return can_read


def can_edit_page(user: User, page_key: str) -> bool:
    _, can_edit = get_page_access(user, page_key)
    return can_edit


def build_page_access_payload(user: User) -> dict:
    return {
        page["key"]: {
            "can_read": get_page_access(user, page["key"])[0],
            "can_edit": get_page_access(user, page["key"])[1],
        }
        for page in PAGE_DEFINITIONS
    }


def serialize_page_catalog() -> list[dict]:
    return list(PAGE_DEFINITIONS)


def can_view_project(user: User, project: Project) -> bool:
    codes = role_codes(user)
    if any(code in codes for code in {"sysadmin", "admin", "editor", "ot"}):
        return True

    membership = get_project_membership(user, project.id)
    if membership is not None:
        return True

    return project.status == ProjectStatus.EXECUTION


def can_edit_project(user: User, project: Project) -> bool:
    codes = role_codes(user)
    if any(code in codes for code in {"sysadmin", "admin", "editor", "ot"}):
        return True

    membership = get_project_membership(user, project.id)
    return membership is not None and membership.role in {MembershipRole.ADMIN, MembershipRole.EDITOR}


def can_change_project_status(user: User, project: Project) -> bool:
    del project
    return any(code in role_codes(user) for code in {"sysadmin", "admin"})


def can_delete_project(user: User, project: Project) -> bool:
    del project
    return any(code in role_codes(user) for code in {"sysadmin", "admin"})


def require_catalog_edit(user: User) -> None:
    if not can_edit_catalog(user):
        raise HTTPException(status_code=403, detail="Catalog edit permission required")


def require_project_create(user: User) -> None:
    if not can_create_project(user):
        raise HTTPException(status_code=403, detail="Project create permission required")


def require_material_dashboard_access(user: User) -> None:
    require_page_read(user, "material_dashboard")


def require_erp_admin(user: User) -> None:
    if not can_use_erp_admin(user):
        raise HTTPException(status_code=403, detail="ERP/admin permission required")


def require_cost_model_export(user: User) -> None:
    if not can_use_cost_model_export(user):
        raise HTTPException(status_code=403, detail="Cost model export permission required")


def require_user_admin(user: User) -> None:
    if not can_manage_users(user):
        raise HTTPException(status_code=403, detail="User administration permission required")


def require_page_read(user: User, page_key: str) -> None:
    if not can_read_page(user, page_key):
        raise HTTPException(status_code=403, detail="Page read permission required")


def require_page_edit(user: User, page_key: str) -> None:
    if not can_edit_page(user, page_key):
        raise HTTPException(status_code=403, detail="Page edit permission required")


def require_project_view(user: User, project: Project) -> None:
    if not can_view_project(user, project):
        raise HTTPException(status_code=403, detail="Project view permission required")


def require_project_edit(user: User, project: Project) -> None:
    if not can_edit_project(user, project):
        raise HTTPException(status_code=403, detail="Project edit permission required")


def require_project_status_change(user: User, project: Project) -> None:
    if not can_change_project_status(user, project):
        raise HTTPException(status_code=403, detail="Project status change permission required")


def require_project_delete(user: User, project: Project) -> None:
    if not can_delete_project(user, project):
        raise HTTPException(status_code=403, detail="Project delete permission required")


def build_permission_payload(user: User, project: Project | None = None) -> dict:
    payload = {
        "catalog_edit": can_edit_catalog(user),
        "material_dashboard": can_access_material_dashboard(user),
        "erp_admin": can_use_erp_admin(user),
        "project_create": can_create_project(user),
        "project_edit": can_edit_catalog(user),
        "project_view": can_edit_catalog(user) or "viewer" in role_codes(user),
        "project_change_status": any(code in role_codes(user) for code in {"sysadmin", "admin"}),
        "project_delete": any(code in role_codes(user) for code in {"sysadmin", "admin"}),
        "cost_model_export": can_use_cost_model_export(user),
        "user_admin": can_manage_users(user),
    }
    if project is not None:
        payload.update(
            {
                "project_edit": can_edit_project(user, project),
                "project_view": can_view_project(user, project),
                "project_change_status": can_change_project_status(user, project),
                "project_delete": can_delete_project(user, project),
            }
        )
    return payload
