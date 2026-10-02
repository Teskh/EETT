"""Budget lines for materials outside a project's BOM.

The study lists materials withdrawn in the period that no BOM explains. Each
project decides whether they count by default, and may include or exclude any
of them. An included line without a pinned quantity follows the study period;
adopting a replacement pins the quantity used since the switch. Decisions are
kept per quantity basis (factory, work, total), like the study they come from.
"""

from __future__ import annotations

from datetime import date
from math import isfinite

from sqlalchemy import select
from sqlalchemy.exc import OperationalError, ProgrammingError
from sqlalchemy.orm import Session

from app.models import ProjectCostModelExtra, ProjectCostModelSetting, User
from app.services.effective_bom import QUANTITY_BASES

EXTRAS_DEFAULTS = ("include", "exclude")


def _serialize(extra: ProjectCostModelExtra) -> dict:
    return {
        "sku": extra.sku, "name": extra.name, "unit": extra.unit, "included": extra.included,
        "quantity_per_house": extra.quantity_per_house, "unit_cost": extra.unit_cost, "replaces_sku": extra.replaces_sku,
        "source_range_start": extra.source_range_start.isoformat() if extra.source_range_start else None,
        "source_range_end": extra.source_range_end.isoformat() if extra.source_range_end else None,
        "note": extra.note, "updated_at": extra.updated_at.isoformat() if extra.updated_at else None,
    }


def _check_basis(basis: str) -> str:
    if basis not in QUANTITY_BASES:
        raise ValueError(f"Base de cantidad no válida: {basis}")
    return basis


def get_cost_model_extras(session: Session, project_id: int, basis: str = "factory") -> dict:
    _check_basis(basis)
    try:
        setting = session.get(ProjectCostModelSetting, project_id)
        extras = session.scalars(
            select(ProjectCostModelExtra)
            .where(ProjectCostModelExtra.project_id == project_id, ProjectCostModelExtra.quantity_basis == basis)
            .order_by(ProjectCostModelExtra.sku)
        ).all()
    except (ProgrammingError, OperationalError):
        # Tables not migrated yet: everything outside the BOM counts, nothing is stored.
        session.rollback()
        return {"stored": False, "basis": basis, "default": "include", "items": []}
    return {"stored": True, "basis": basis, "default": setting.extras_default if setting else "include", "items": [_serialize(extra) for extra in extras]}


def set_cost_model_extras_default(session: Session, project_id: int, mode: str, basis: str = "factory") -> dict:
    if mode not in EXTRAS_DEFAULTS:
        raise ValueError("El modo debe ser include o exclude.")
    setting = session.get(ProjectCostModelSetting, project_id)
    if setting is None:
        session.add(ProjectCostModelSetting(project_id=project_id, extras_default=mode))
    else:
        setting.extras_default = mode
    session.commit()
    return get_cost_model_extras(session, project_id, basis)


def upsert_cost_model_extra(session: Session, project_id: int, payload: dict, *, actor: User | None, basis: str = "factory") -> dict:
    _check_basis(basis)
    sku = str(payload.get("sku") or "").strip().upper()
    if not sku:
        raise ValueError("Falta el SKU.")
    for key in ("quantity_per_house", "unit_cost"):
        value = payload.get(key)
        if value is not None and (not isfinite(float(value)) or float(value) < 0):
            raise ValueError("Las cantidades y costos deben ser números positivos o cero.")
    extra = session.scalar(select(ProjectCostModelExtra).where(
        ProjectCostModelExtra.project_id == project_id, ProjectCostModelExtra.quantity_basis == basis, ProjectCostModelExtra.sku == sku,
    ))
    if extra is None:
        extra = ProjectCostModelExtra(project_id=project_id, quantity_basis=basis, sku=sku, included=bool(payload.get("included")), created_by_user_id=actor.id if actor else None)
        session.add(extra)
    extra.included = bool(payload.get("included"))
    extra.name = payload.get("name") or extra.name
    extra.unit = payload.get("unit") or extra.unit
    extra.quantity_per_house = payload.get("quantity_per_house")
    extra.unit_cost = payload.get("unit_cost")
    extra.replaces_sku = (str(payload["replaces_sku"]).strip().upper() or None) if payload.get("replaces_sku") else None
    extra.source_range_start = _date(payload.get("source_range_start"))
    extra.source_range_end = _date(payload.get("source_range_end"))
    extra.note = payload.get("note") or None
    session.commit()
    return get_cost_model_extras(session, project_id, basis)


def delete_cost_model_extra(session: Session, project_id: int, sku: str, basis: str = "factory") -> dict:
    _check_basis(basis)
    extra = session.scalar(select(ProjectCostModelExtra).where(
        ProjectCostModelExtra.project_id == project_id, ProjectCostModelExtra.quantity_basis == basis, ProjectCostModelExtra.sku == sku.strip().upper(),
    ))
    if extra is not None:
        session.delete(extra)
        session.commit()
    return get_cost_model_extras(session, project_id, basis)


def _date(value) -> date | None:
    if value is None or isinstance(value, date):
        return value
    return date.fromisoformat(str(value)[:10])
