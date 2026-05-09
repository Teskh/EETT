from __future__ import annotations

from io import BytesIO
from copy import deepcopy
from datetime import datetime, timedelta
from pathlib import Path
import re
from typing import NamedTuple

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.config import BACKEND_DIR, Settings
from app.models import ErpMaterialCache, ExportKind, ExportStatus, Project, ProjectExportJob, User
from app.models.entities import utcnow
from app.services.auth import role_codes
from app.services.export_projection import (
    build_commercial_export_sections,
    build_detailed_material_export_sections,
    build_full_technical_export_sections,
)
from app.services.projects import get_project_view_data
from app.services.projects import get_project_with_details


class ExportArtifact(NamedTuple):
    content: bytes
    filename: str
    media_type: str
    inline: bool


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
    normalized_payload = _normalize_export_payload(export_kind, payload or {})
    job = ProjectExportJob(
        project=project,
        requested_by=requested_by,
        export_kind=ExportKind(export_kind),
        status=ExportStatus.PENDING,
        payload=normalized_payload,
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
                    job_id=job.id,
                    static_dir=BACKEND_DIR / "app" / "static",
                    media_gallery_dir=settings.media_gallery_dir,
                )
            case ExportKind.MATERIALS_WORKBOOK:
                artifact_uri = _build_materials_workbook_export(
                    session,
                    project_id=job.project_id,
                    job_id=job.id,
                )
            case ExportKind.COST_MODEL_WORKBOOK:
                artifact_uri = _build_cost_model_workbook_export(
                    session,
                    project_id=job.project_id,
                    job_id=job.id,
                )
            case ExportKind.FULL_TECHNICAL_PDF:
                artifact_uri = _build_full_technical_pdf_export(
                    session,
                    project_id=job.project_id,
                    job_id=job.id,
                    static_dir=BACKEND_DIR / "app" / "static",
                    media_gallery_dir=settings.media_gallery_dir,
                )
            case ExportKind.DETAILED_MATERIAL_PDF:
                artifact_uri = _build_detailed_material_pdf_export(
                    session,
                    project_id=job.project_id,
                    job_id=job.id,
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


def _build_materials_workbook_export(
    session: Session,
    *,
    project_id: int,
    job_id: int,
) -> str:
    project_data = get_project_view_data(session, project_id)
    if project_data is None:
        raise ValueError("Project not found")

    artifact_name = _artifact_name(job_id, project_data["project"]["name"], "materials", "xlsx")
    return f"/exports/{artifact_name}"


def _build_cost_model_workbook_export(
    session: Session,
    *,
    project_id: int,
    job_id: int,
) -> str:
    project_data = get_project_view_data(session, project_id)
    if project_data is None:
        raise ValueError("Project not found")

    artifact_name = _artifact_name(job_id, project_data["project"]["name"], "cost-model", "xlsx")
    return f"/exports/{artifact_name}"


def _build_commercial_pdf_export(
    session: Session,
    *,
    project_id: int,
    job_id: int,
    static_dir: Path,
    media_gallery_dir: Path,
) -> str:
    project = get_project_with_details(session, project_id)
    project_data = get_project_view_data(session, project_id)
    if project is None or project_data is None:
        raise ValueError("Project not found")

    build_commercial_export_sections(project, project_data, static_dir=static_dir, media_gallery_dir=media_gallery_dir)
    artifact_name = _artifact_name(job_id, project_data["project"]["name"], "commercial", "pdf")
    return f"/exports/{artifact_name}"


def _build_full_technical_pdf_export(
    session: Session,
    *,
    project_id: int,
    job_id: int,
    static_dir: Path,
    media_gallery_dir: Path,
) -> str:
    project = get_project_with_details(session, project_id)
    project_data = get_project_view_data(session, project_id)
    if project is None or project_data is None:
        raise ValueError("Project not found")

    build_full_technical_export_sections(project, project_data, static_dir=static_dir, media_gallery_dir=media_gallery_dir)
    artifact_name = _artifact_name(job_id, project_data["project"]["name"], "full-technical", "pdf")
    return f"/exports/{artifact_name}"


def _build_detailed_material_pdf_export(
    session: Session,
    *,
    project_id: int,
    job_id: int,
) -> str:
    project_data = get_project_view_data(session, project_id)
    if project_data is None:
        raise ValueError("Project not found")

    artifact_name = _artifact_name(job_id, project_data["project"]["name"], "detailed-materials", "pdf")
    return f"/exports/{artifact_name}"


def build_project_export_artifact(
    session: Session,
    *,
    job: ProjectExportJob,
    settings: Settings,
) -> ExportArtifact:
    match job.export_kind:
        case ExportKind.COMMERCIAL_PDF:
            return _render_commercial_pdf_export(session, project_id=job.project_id, job_id=job.id, settings=settings)
        case ExportKind.MATERIALS_WORKBOOK:
            return _render_materials_workbook_export(session, project_id=job.project_id, job_id=job.id)
        case ExportKind.COST_MODEL_WORKBOOK:
            return _render_cost_model_workbook_export(session, project_id=job.project_id, job_id=job.id, settings=settings)
        case ExportKind.FULL_TECHNICAL_PDF:
            return _render_full_technical_pdf_export(session, project_id=job.project_id, job_id=job.id, settings=settings)
        case ExportKind.DETAILED_MATERIAL_PDF:
            return _render_detailed_material_pdf_export(
                session,
                project_id=job.project_id,
                job_id=job.id,
                settings=settings,
                show_prices=_should_show_prices(job.requested_by),
                quantity_basis=_detailed_material_quantity_basis(job.payload),
            )
        case _:
            raise NotImplementedError(f"Export kind '{job.export_kind.value}' is not implemented yet")


def _render_materials_workbook_export(session: Session, *, project_id: int, job_id: int) -> ExportArtifact:
    from app.services.export_workbooks import build_materials_workbook

    project_data = get_project_view_data(session, project_id)
    if project_data is None:
        raise ValueError("Project not found")

    output = BytesIO()
    build_materials_workbook(project_data, output)
    filename = _artifact_name(job_id, project_data["project"]["name"], "materials", "xlsx")
    return ExportArtifact(
        output.getvalue(),
        filename,
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        False,
    )


def _render_cost_model_workbook_export(
    session: Session,
    *,
    project_id: int,
    job_id: int,
    settings: Settings,
) -> ExportArtifact:
    from app.services.export_workbooks import build_cost_model_workbook

    project_data = get_project_view_data(session, project_id)
    if project_data is None:
        raise ValueError("Project not found")

    output = BytesIO()
    build_cost_model_workbook(
        project_data,
        output,
        prices_by_sku=_load_cost_model_price_map(session, settings=settings, project_data=project_data),
    )
    filename = _artifact_name(job_id, project_data["project"]["name"], "cost-model", "xlsx")
    return ExportArtifact(
        output.getvalue(),
        filename,
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        False,
    )


def _render_commercial_pdf_export(
    session: Session,
    *,
    project_id: int,
    job_id: int,
    settings: Settings,
) -> ExportArtifact:
    from app.services.export_pdfs import build_commercial_pdf

    project = get_project_with_details(session, project_id)
    project_data = get_project_view_data(session, project_id)
    if project is None or project_data is None:
        raise ValueError("Project not found")

    sections = build_commercial_export_sections(
        project,
        project_data,
        static_dir=BACKEND_DIR / "app" / "static",
        media_gallery_dir=settings.media_gallery_dir,
    )
    output = BytesIO()
    build_commercial_pdf({"project": project_data["project"], "sections": sections}, output)
    filename = _artifact_name(job_id, project_data["project"]["name"], "commercial", "pdf")
    return ExportArtifact(output.getvalue(), filename, "application/pdf", True)


def _render_full_technical_pdf_export(
    session: Session,
    *,
    project_id: int,
    job_id: int,
    settings: Settings,
) -> ExportArtifact:
    from app.services.export_pdfs import build_full_technical_pdf

    project = get_project_with_details(session, project_id)
    project_data = get_project_view_data(session, project_id)
    if project is None or project_data is None:
        raise ValueError("Project not found")

    sections = build_full_technical_export_sections(
        project,
        project_data,
        static_dir=BACKEND_DIR / "app" / "static",
        media_gallery_dir=settings.media_gallery_dir,
    )
    output = BytesIO()
    build_full_technical_pdf({"project": project_data["project"], "sections": sections}, output)
    filename = _artifact_name(job_id, project_data["project"]["name"], "full-technical", "pdf")
    return ExportArtifact(output.getvalue(), filename, "application/pdf", True)


def _render_detailed_material_pdf_export(
    session: Session,
    *,
    project_id: int,
    job_id: int,
    settings: Settings,
    show_prices: bool,
    quantity_basis: str,
) -> ExportArtifact:
    from app.services.export_pdfs import build_detailed_material_pdf

    project_data = get_project_view_data(session, project_id)
    if project_data is None:
        raise ValueError("Project not found")

    sections = build_detailed_material_export_sections(project_data, quantity_basis=quantity_basis)
    enriched_sections = _enrich_detailed_material_sections(
        session,
        sections=sections,
        settings=settings,
        show_prices=show_prices,
    )
    output = BytesIO()
    build_detailed_material_pdf(
        {"project": project_data["project"], "sections": enriched_sections},
        output,
        show_prices=show_prices,
        quantity_label="Q obra" if quantity_basis == "work" else "Q fabrica",
    )
    filename_suffix = "detailed-materials-q-obra" if quantity_basis == "work" else "detailed-materials-q-fabrica"
    filename = _artifact_name(job_id, project_data["project"]["name"], filename_suffix, "pdf")
    return ExportArtifact(output.getvalue(), filename, "application/pdf", True)


def _normalize_export_payload(export_kind: str, payload: dict) -> dict:
    normalized = dict(payload)
    if export_kind == ExportKind.DETAILED_MATERIAL_PDF.value:
        normalized["quantity_basis"] = _detailed_material_quantity_basis(normalized)
    return normalized


def _detailed_material_quantity_basis(payload: dict | None) -> str:
    raw_value = (payload or {}).get("quantity_basis")
    if raw_value in {"factory", "q_fabrica", "Q_fabrica"}:
        return "factory"
    if raw_value in {"work", "q_obra", "Q_obra"}:
        return "work"
    return "factory"


def _enrich_detailed_material_sections(
    session: Session,
    *,
    sections: list[dict[str, object]],
    settings: Settings,
    show_prices: bool,
) -> list[dict[str, object]]:
    from app.services.erp import erp_search_available

    cache_by_sku = {
        cache.sku.strip().upper(): cache
        for cache in session.scalars(select(ErpMaterialCache).order_by(ErpMaterialCache.sku)).all()
    }
    erp_enabled = erp_search_available(settings)
    unique_skus: list[str] = []
    seen_skus: set[str] = set()

    for section in sections:
        for material in section.get("materials", []):
            sku = str(material.get("sku") or "").strip().upper()
            if not sku or sku in seen_skus:
                continue
            seen_skus.add(sku)
            unique_skus.append(sku)

    detail_by_sku = _load_detailed_material_erp_details(
        settings,
        skus=unique_skus,
        show_prices=show_prices,
    ) if erp_enabled and unique_skus else {}

    enriched_sections: list[dict[str, object]] = []
    for section in sections:
        enriched_materials = []
        for material in section.get("materials", []):
            sku = str(material.get("sku") or "").strip().upper()
            cache = cache_by_sku.get(sku)
            detail = detail_by_sku.get(sku) or {
                "stock_on_hand": cache.stock_on_hand if cache else None,
                "pending_purchase_quantity": cache.pending_purchase_quantity if cache else None,
                "average_price": cache.average_price if cache and show_prices else None,
                "movement_quantity_30d": cache.recent_monthly_consumption if cache else None,
                "last_purchase_order_date": None,
                "last_purchase_order_number": None,
                "last_purchase_order_status_code": None,
                "last_purchase_order_is_approved": None,
            }
            enriched_materials.append(
                {
                    **material,
                    "stock_on_hand": detail.get("stock_on_hand"),
                    "pending_purchase_quantity": detail.get("pending_purchase_quantity"),
                    "average_price": detail.get("average_price") if show_prices else None,
                    "movement_quantity_30d": detail.get("movement_quantity_30d"),
                    "last_purchase_order_date": detail.get("last_purchase_order_date"),
                    "last_purchase_order_number": detail.get("last_purchase_order_number"),
                    "last_purchase_order_status_code": detail.get("last_purchase_order_status_code"),
                    "last_purchase_order_is_approved": detail.get("last_purchase_order_is_approved"),
                }
            )
        enriched_sections.append({**section, "materials": enriched_materials})

    return enriched_sections


def _load_detailed_material_erp_details(
    settings: Settings,
    *,
    skus: list[str],
    show_prices: bool,
) -> dict[str, dict[str, object]]:
    from app.services.erp import (
        _get_average_prices_for_products_batch,
        _get_last_purchase_orders_for_products_batch,
        _get_outgoing_quantities_for_products_batch,
        _get_stock_for_products_batch,
        _open_connection,
    )

    if not skus:
        return {}

    details: dict[str, dict[str, object]] = {sku: {} for sku in skus}
    try:
        with _open_connection(settings) as connection:
            stock_cursor = connection.cursor()
            po_cursor = connection.cursor()
            movement_cursor = connection.cursor()
            pricing_cursor = connection.cursor() if show_prices else None

            today = datetime.utcnow()
            stock_map = _get_stock_for_products_batch(stock_cursor, skus, today.strftime("%Y%m%d"))
            po_map = _get_last_purchase_orders_for_products_batch(po_cursor, skus)
            movement_map = _get_outgoing_quantities_for_products_batch(
                movement_cursor,
                skus,
                start_day=today.date() - timedelta(days=30),
                cost_centers=[],
                excluded_cost_centers=[],
            )
            price_map = (
                _get_average_prices_for_products_batch(pricing_cursor, skus, today.strftime("%d/%m/%Y"))
                if pricing_cursor is not None
                else {}
            )

            for sku in skus:
                po_date, po_number, pending_qty, _estimated_delivery, po_status_code = po_map.get(
                    sku,
                    (None, None, None, None, None),
                )
                details[sku] = {
                    "stock_on_hand": stock_map.get(sku),
                    "pending_purchase_quantity": pending_qty,
                    "average_price": price_map.get(sku) if show_prices else None,
                    "movement_quantity_30d": movement_map.get(sku),
                    "last_purchase_order_date": po_date.isoformat() if hasattr(po_date, "isoformat") and po_date is not None else None,
                    "last_purchase_order_number": po_number,
                    "last_purchase_order_status_code": po_status_code,
                    "last_purchase_order_is_approved": po_status_code == "AP" if po_status_code else None,
                }
    except Exception:
        return {}

    return details


def _load_cost_model_price_map(
    session: Session,
    *,
    settings: Settings,
    project_data: dict[str, object],
) -> dict[str, float | None]:
    from app.services.erp import (
        _get_average_prices_for_products_batch,
        _get_purchase_order_lines_for_products_batch,
        _open_connection,
        erp_search_available,
    )

    unique_skus: list[str] = []
    seen_skus: set[str] = set()
    for section in project_data.get("categories", []):
        for instance in section.get("instances", []):
            for material in instance.get("materials", []):
                sku = str(material.get("sku") or "").strip().upper()
                if not sku or sku in seen_skus:
                    continue
                seen_skus.add(sku)
                unique_skus.append(sku)
    for auxiliary in project_data.get("auxiliary_materials", []):
        sku = str(auxiliary.get("code") or "").strip().upper()
        if not sku or sku in seen_skus:
            continue
        seen_skus.add(sku)
        unique_skus.append(sku)

    if not unique_skus:
        return {}

    prices = {
        cache.sku.strip().upper(): _select_cost_model_price(
            cache.average_price,
            cache.last_purchase_price,
        )
        for cache in session.scalars(select(ErpMaterialCache).order_by(ErpMaterialCache.sku)).all()
        if cache.sku
    }
    price_map = {sku: prices.get(sku) for sku in unique_skus}

    if not erp_search_available(settings):
        return price_map

    try:
        with _open_connection(settings) as connection:
            live_prices = _get_average_prices_for_products_batch(
                connection.cursor(),
                unique_skus,
                datetime.utcnow().strftime("%d/%m/%Y"),
            )
            for sku, value in live_prices.items():
                if _is_positive_price(value):
                    price_map[sku] = value

            missing_price_skus = [sku for sku in unique_skus if not _is_positive_price(price_map.get(sku))]
            if missing_price_skus:
                purchase_order_lines = _get_purchase_order_lines_for_products_batch(
                    connection.cursor(),
                    missing_price_skus,
                )
                for sku, lines in purchase_order_lines.items():
                    purchase_order_price = _select_purchase_order_price(lines)
                    if purchase_order_price is not None:
                        price_map[sku] = purchase_order_price
    except Exception:
        return price_map

    return price_map


def _select_cost_model_price(average_price: float | None, last_purchase_price: float | None) -> float | None:
    if _is_positive_price(average_price):
        return average_price
    if _is_positive_price(last_purchase_price):
        return last_purchase_price
    return average_price if average_price is not None else last_purchase_price


def _is_positive_price(value: float | None) -> bool:
    return value is not None and value > 0


def _select_purchase_order_price(lines: list[dict[str, Any]]) -> float | None:
    for line in lines:
        unit_price = line.get("unit_price")
        if _is_positive_price(unit_price):
            return unit_price
    return None


def _should_show_prices(user: User | None) -> bool:
    if user is None:
        return True
    return "viewer" not in role_codes(user)


def _artifact_name(job_id: int, project_name: str, suffix: str, extension: str) -> str:
    return f"{job_id}-{_slugify(project_name)}-{suffix}.{extension}"


def _slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug or "project"
