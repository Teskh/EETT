from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models import Project, ProjectBomEntry, ProjectStatus


def list_public_projects(session: Session) -> list[dict]:
    projects = session.scalars(
        select(Project)
        .where(Project.status.in_([ProjectStatus.EXECUTION, ProjectStatus.FINISHED]))
        .order_by(Project.name)
    ).all()
    return [
        {
            "id": project.id,
            "name": project.name,
            "status": project.status.value,
            "description": project.description,
        }
        for project in projects
    ]


def list_project_public_skus(session: Session, project_id: int) -> dict | None:
    project = session.scalar(
        select(Project)
        .where(Project.id == project_id, Project.status.in_([ProjectStatus.EXECUTION, ProjectStatus.FINISHED]))
        .options(selectinload(Project.bom_entries).selectinload(ProjectBomEntry.material))
    )
    if project is None:
        return None

    skus = sorted({entry.material.sku for entry in project.bom_entries})
    return {
        "project": {
            "id": project.id,
            "name": project.name,
            "status": project.status.value,
        },
        "skus": skus,
    }
