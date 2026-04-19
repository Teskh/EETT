from __future__ import annotations

from copy import deepcopy
from pathlib import Path
import re

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.config import BACKEND_DIR, Settings
from app.models import ExportKind, ExportStatus, Project, ProjectExportJob, User
from app.models.entities import utcnow
from app.services.export_projection import build_commercial_export_sections, build_full_technical_export_sections
from app.services.projects import get_project_view_data
from app.services.projects import get_project_with_details


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


def get_project_export_job_for_artifact(session: Session, artifact_uri: str) -> ProjectExportJob | None:
    return session.scalar(
        select(ProjectExportJob)
        .where(ProjectExportJob.artifact_uri == artifact_uri)
        .options(selectinload(ProjectExportJob.project))
    )


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


def execute_project_export(
    session: Session,
    *,
    job: ProjectExportJob,
    settings: Settings,
) -> ProjectExportJob:
    payload = deepcopy(job.payload or {})

    try:
        match job.export_kind:
            case ExportKind.COMMERCIAL_PDF:
                artifact_uri = _build_commercial_pdf_export(
                    session,
                    project_id=job.project_id,
                    output_dir=settings.export_output_dir,
                    job_id=job.id,
                    static_dir=BACKEND_DIR / "app" / "static",
                )
            case ExportKind.MATERIALS_WORKBOOK:
                artifact_uri = _build_materials_workbook_export(
                    session,
                    project_id=job.project_id,
                    output_dir=settings.export_output_dir,
                    job_id=job.id,
                )
            case ExportKind.FULL_TECHNICAL_PDF:
                artifact_uri = _build_full_technical_pdf_export(
                    session,
                    project_id=job.project_id,
                    output_dir=settings.export_output_dir,
                    job_id=job.id,
                    static_dir=BACKEND_DIR / "app" / "static",
                )
            case _:
                raise NotImplementedError(f"Export kind '{job.export_kind.value}' is not implemented yet")

        job.status = ExportStatus.COMPLETED
        job.artifact_uri = artifact_uri
        job.completed_at = utcnow()
        job.payload = payload
    except Exception as exc:
        payload["error"] = str(exc)
        job.status = ExportStatus.FAILED
        job.artifact_uri = None
        job.completed_at = None
        job.payload = payload

    session.add(job)
    session.commit()
    session.refresh(job)
    return job


def resolve_artifact_path(*, settings: Settings, artifact_uri: str) -> Path:
    prefix = "/exports/"
    if not artifact_uri.startswith(prefix):
        raise ValueError("Unsupported export artifact URI")

    artifact_name = artifact_uri[len(prefix) :]
    if not artifact_name:
        raise ValueError("Missing export artifact name")

    output_dir = settings.export_output_dir.resolve()
    artifact_path = (output_dir / artifact_name).resolve()
    if artifact_path.parent != output_dir:
        raise ValueError("Invalid export artifact path")
    return artifact_path


def _build_materials_workbook_export(
    session: Session,
    *,
    project_id: int,
    output_dir: Path,
    job_id: int,
) -> str:
    from app.services.export_workbooks import build_materials_workbook

    project_data = get_project_view_data(session, project_id)
    if project_data is None:
        raise ValueError("Project not found")

    project_name = project_data["project"]["name"]
    artifact_name = f"{job_id}-{_slugify(project_name)}-materials.xlsx"
    artifact_path = output_dir / artifact_name
    build_materials_workbook(project_data, artifact_path)
    return f"/exports/{artifact_name}"


def _build_commercial_pdf_export(
    session: Session,
    *,
    project_id: int,
    output_dir: Path,
    job_id: int,
    static_dir: Path,
) -> str:
    from app.services.export_pdfs import build_commercial_pdf

    project = get_project_with_details(session, project_id)
    project_data = get_project_view_data(session, project_id)
    if project is None or project_data is None:
        raise ValueError("Project not found")

    commercial_sections = build_commercial_export_sections(project, project_data, static_dir=static_dir)
    artifact_name = f"{job_id}-{_slugify(project_data['project']['name'])}-commercial.pdf"
    artifact_path = output_dir / artifact_name
    build_commercial_pdf({"project": project_data["project"], "sections": commercial_sections}, artifact_path)
    return f"/exports/{artifact_name}"


def _build_full_technical_pdf_export(
    session: Session,
    *,
    project_id: int,
    output_dir: Path,
    job_id: int,
    static_dir: Path,
) -> str:
    from app.services.export_pdfs import build_full_technical_pdf

    project = get_project_with_details(session, project_id)
    project_data = get_project_view_data(session, project_id)
    if project is None or project_data is None:
        raise ValueError("Project not found")

    sections = build_full_technical_export_sections(project, project_data, static_dir=static_dir)
    artifact_name = f"{job_id}-{_slugify(project_data['project']['name'])}-full-technical.pdf"
    artifact_path = output_dir / artifact_name
    build_full_technical_pdf({"project": project_data["project"], "sections": sections}, artifact_path)
    return f"/exports/{artifact_name}"


def _slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug or "project"
