from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models import Project, ProjectMembership, ProjectStatus, User, UserRole
from app.models.entities import MembershipRole


def get_user_by_username(session: Session, username: str) -> User | None:
    return session.scalar(
        select(User)
        .where(User.username == username)
        .options(selectinload(User.roles).selectinload(UserRole.role), selectinload(User.project_memberships))
    )


def get_current_user(session: Session, username: str | None) -> User:
    if username:
        user = get_user_by_username(session, username)
        if user is None:
            raise HTTPException(status_code=401, detail=f"Unknown user '{username}'")
        return user

    fallback = get_user_by_username(session, "admin")
    if fallback is not None:
        return fallback

    first_user = session.scalar(select(User).order_by(User.id))
    if first_user is None:
        raise HTTPException(status_code=500, detail="No users are available in the database")
    return first_user


def role_codes(user: User) -> set[str]:
    return {assignment.role.code for assignment in user.roles}


def get_project_membership(user: User, project_id: int) -> ProjectMembership | None:
    return next((membership for membership in user.project_memberships if membership.project_id == project_id), None)


def can_edit_catalog(user: User) -> bool:
    codes = role_codes(user)
    return "admin" in codes or "editor" in codes


def can_use_erp_admin(user: User) -> bool:
    return "admin" in role_codes(user)


def can_view_project(user: User, project: Project) -> bool:
    codes = role_codes(user)
    if "admin" in codes or "editor" in codes:
        return True

    membership = get_project_membership(user, project.id)
    if membership is not None:
        return True

    return project.status == ProjectStatus.EXECUTION


def can_edit_project(user: User, project: Project) -> bool:
    codes = role_codes(user)
    if "admin" in codes:
        return True
    if "editor" in codes:
        return True

    membership = get_project_membership(user, project.id)
    return membership is not None and membership.role in {MembershipRole.ADMIN, MembershipRole.EDITOR}


def can_change_project_status(user: User, project: Project) -> bool:
    return can_edit_project(user, project)


def can_delete_project(user: User, project: Project) -> bool:
    codes = role_codes(user)
    if "admin" in codes:
        return True
    membership = get_project_membership(user, project.id)
    return membership is not None and membership.role == MembershipRole.ADMIN


def require_catalog_edit(user: User) -> None:
    if not can_edit_catalog(user):
        raise HTTPException(status_code=403, detail="Catalog edit permission required")


def require_erp_admin(user: User) -> None:
    if not can_use_erp_admin(user):
        raise HTTPException(status_code=403, detail="ERP/admin permission required")


def require_project_view(user: User, project: Project) -> None:
    if not can_view_project(user, project):
        raise HTTPException(status_code=403, detail="Project view permission required")


def require_project_edit(user: User, project: Project) -> None:
    if not can_edit_project(user, project):
        raise HTTPException(status_code=403, detail="Project edit permission required")


def build_permission_payload(user: User, project: Project | None = None) -> dict:
    payload = {
        "catalog_edit": can_edit_catalog(user),
        "erp_admin": can_use_erp_admin(user),
        "project_edit": False,
        "project_view": False,
        "project_change_status": False,
        "project_delete": False,
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
