from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models import ExportKind, ExportStatus, Project, ProjectExportJob, User


def get_project_export_jobs(session: Session, project_id: int) -> list[dict]:
    jobs = session.scalars(
        select(ProjectExportJob)
        .where(ProjectExportJob.project_id == project_id)
        .options(selectinload(ProjectExportJob.requested_by))
        .order_by(ProjectExportJob.created_at.desc())
    ).all()
    return [
        {
            "id": job.id,
            "kind": job.export_kind.value,
            "status": job.status.value,
            "requested_by": job.requested_by.username if job.requested_by else None,
            "artifact_uri": job.artifact_uri,
            "payload": job.payload or {},
            "created_at": job.created_at.isoformat(),
            "completed_at": job.completed_at.isoformat() if job.completed_at else None,
        }
        for job in jobs
    ]


def request_project_export(
    session: Session,
    *,
    project: Project,
    requested_by: User,
    export_kind: str,
    payload: dict | None,
) -> ProjectExportJob:
    job = ProjectExportJob(
        project=project,
        requested_by=requested_by,
        export_kind=ExportKind(export_kind),
        status=ExportStatus.PENDING,
        payload=payload or {},
    )
    session.add(job)
    session.commit()
    session.refresh(job)
    return job
