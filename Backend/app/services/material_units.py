"""Detection and resolution of ERP unit changes for materials.

``materials.unit`` is treated as the unit our specified quantities are
expressed in. A throttled sweep compares it against the live ERP unit for
every known SKU and records divergences in ``material_unit_changes``. Pending
rows stay open (and visible in the app header) until someone reviews every
place the material is quantified and explicitly resolves the change, which is
when the reference unit is updated. Resolved rows are kept as the unit
history of each material.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.config import Settings
from app.models import (
    ComponentMaterialRule,
    Material,
    MaterialDashboardCacheEntry,
    MaterialStudyGroupMember,
    MaterialUnitChange,
    MaterialUnitChangeStatus,
    ProjectBomEntry,
    ProjectMaterialCalculationSheet,
    User,
)
from app.services.erp import erp_search_available, get_units_for_products

logger = logging.getLogger(__name__)

UNIT_SWEEP_CACHE_KIND = "unit_sweep"
UNIT_SWEEP_CACHE_KEY = "global"
UNIT_SWEEP_INTERVAL = timedelta(hours=6)
USAGE_LIST_LIMIT = 80
RESOLVED_HISTORY_LIMIT = 20

AUTO_RESOLUTION_NOTE = "La unidad del ERP volvió a coincidir con la unidad de referencia."


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _normalize_unit(value: str | None) -> str | None:
    normalized = (value or "").strip().upper()
    return normalized or None


def _sweep_state(session: Session) -> MaterialDashboardCacheEntry | None:
    return session.scalar(
        select(MaterialDashboardCacheEntry).where(
            MaterialDashboardCacheEntry.cache_kind == UNIT_SWEEP_CACHE_KIND,
            MaterialDashboardCacheEntry.cache_key == UNIT_SWEEP_CACHE_KEY,
        )
    )


def maybe_sweep_material_units(session: Session, settings: Settings, *, force: bool = False) -> datetime | None:
    """Run the ERP unit sweep if the previous one is stale. Returns the time
    of the most recent successful sweep (which may be the one just run)."""
    state = _sweep_state(session)
    now = _utcnow()
    if state is not None and not force:
        expires_at = state.expires_at
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if expires_at > now:
            return state.refreshed_at

    if not erp_search_available(settings):
        return state.refreshed_at if state is not None else None

    materials = session.scalars(select(Material)).all()
    if not materials:
        return state.refreshed_at if state is not None else None

    try:
        observed_units = get_units_for_products(settings, [material.sku for material in materials])
    except RuntimeError as exc:
        logger.warning("Material unit sweep skipped: %s", exc)
        return state.refreshed_at if state is not None else None

    pending_by_material: dict[int, MaterialUnitChange] = {
        change.material_id: change
        for change in session.scalars(
            select(MaterialUnitChange).where(MaterialUnitChange.status == MaterialUnitChangeStatus.PENDING)
        )
    }

    for material in materials:
        sku = material.sku.strip().upper()
        if sku not in observed_units:
            continue
        observed = observed_units[sku]
        pending = pending_by_material.get(material.id)

        if _normalize_unit(material.unit) is None and observed is not None and pending is None:
            # First time we learn a unit for this material: adopt it silently.
            material.unit = observed
            continue

        if _normalize_unit(observed) == _normalize_unit(material.unit):
            if pending is not None:
                pending.status = MaterialUnitChangeStatus.RESOLVED
                pending.resolved_at = now
                pending.resolution_note = AUTO_RESOLUTION_NOTE
            continue

        if pending is not None:
            pending.new_unit = observed
            pending.last_seen_at = now
        else:
            session.add(
                MaterialUnitChange(
                    material_id=material.id,
                    sku=material.sku,
                    material_name=material.name,
                    old_unit=material.unit,
                    new_unit=observed,
                    detected_at=now,
                    last_seen_at=now,
                )
            )

    if state is None:
        state = MaterialDashboardCacheEntry(
            cache_kind=UNIT_SWEEP_CACHE_KIND,
            cache_key=UNIT_SWEEP_CACHE_KEY,
            payload={},
        )
        session.add(state)
    state.payload = {"material_count": len(materials)}
    state.refreshed_at = now
    state.expires_at = now + UNIT_SWEEP_INTERVAL
    session.flush()
    return now


def _build_usage_map(session: Session, material_ids: list[int], skus: list[str]) -> dict[int, dict]:
    usage: dict[int, dict] = {
        material_id: {"catalog_rules": [], "bom_entries": [], "calculation_sheets": [], "study_groups": []}
        for material_id in material_ids
    }
    if not material_ids:
        return usage

    rules = session.scalars(
        select(ComponentMaterialRule)
        .where(ComponentMaterialRule.material_id.in_(material_ids))
        .options(selectinload(ComponentMaterialRule.component))
        .order_by(ComponentMaterialRule.component_id, ComponentMaterialRule.display_order)
    ).all()
    for rule in rules:
        usage[rule.material_id]["catalog_rules"].append(
            {
                "rule_id": rule.id,
                "component_id": rule.component_id,
                "component_name": rule.component.name if rule.component else f"Componente {rule.component_id}",
                "unit": rule.unit,
                "unit_qty_per_unit": rule.unit_qty_per_unit,
            }
        )

    bom_entries = session.scalars(
        select(ProjectBomEntry)
        .where(ProjectBomEntry.material_id.in_(material_ids))
        .options(
            selectinload(ProjectBomEntry.project),
            selectinload(ProjectBomEntry.instance),
            selectinload(ProjectBomEntry.subtype),
        )
        .order_by(ProjectBomEntry.project_id, ProjectBomEntry.instance_id)
    ).all()
    for entry in bom_entries:
        usage[entry.material_id]["bom_entries"].append(
            {
                "project_id": entry.project_id,
                "project_name": entry.project.name if entry.project else f"Proyecto {entry.project_id}",
                "instance_name": entry.instance.name if entry.instance else None,
                "subtype_name": entry.subtype.name if entry.subtype else None,
                "quantity": entry.quantity,
                "unit": entry.unit,
            }
        )

    sheets = session.scalars(
        select(ProjectMaterialCalculationSheet)
        .where(ProjectMaterialCalculationSheet.material_id.in_(material_ids))
        .options(
            selectinload(ProjectMaterialCalculationSheet.project),
            selectinload(ProjectMaterialCalculationSheet.instance),
        )
    ).all()
    for sheet in sheets:
        usage[sheet.material_id]["calculation_sheets"].append(
            {
                "project_id": sheet.project_id,
                "project_name": sheet.project.name if sheet.project else f"Proyecto {sheet.project_id}",
                "instance_name": sheet.instance.name if sheet.instance else None,
            }
        )

    if skus:
        normalized_sku_to_material = {}
        material_by_id = {material.id: material for material in session.scalars(select(Material).where(Material.id.in_(material_ids)))}
        for material in material_by_id.values():
            normalized_sku_to_material[material.sku.strip().upper()] = material.id
        members = session.scalars(
            select(MaterialStudyGroupMember)
            .where(MaterialStudyGroupMember.sku.in_(skus))
            .options(selectinload(MaterialStudyGroupMember.group))
        ).all()
        for member in members:
            material_id = normalized_sku_to_material.get(member.sku.strip().upper())
            if material_id is None:
                continue
            usage[material_id]["study_groups"].append(
                {
                    "group_id": member.group_id,
                    "group_name": member.group.name if member.group else f"Grupo {member.group_id}",
                    "factor_to_study_unit": member.factor_to_study_unit,
                    "study_unit": member.group.study_unit if member.group else None,
                }
            )

    for entry in usage.values():
        for key in ("catalog_rules", "bom_entries", "calculation_sheets", "study_groups"):
            entry[f"{key}_count"] = len(entry[key])
            entry[key] = entry[key][:USAGE_LIST_LIMIT]
    return usage


def _serialize_change(change: MaterialUnitChange, usage: dict | None = None) -> dict:
    return {
        "id": change.id,
        "material_id": change.material_id,
        "sku": change.sku,
        "material_name": change.material_name,
        "old_unit": change.old_unit,
        "new_unit": change.new_unit,
        "status": change.status.value,
        "detected_at": change.detected_at,
        "last_seen_at": change.last_seen_at,
        "resolved_at": change.resolved_at,
        "resolved_by": change.resolved_by.display_name if change.resolved_by else None,
        "resolution_note": change.resolution_note,
        "usage": usage,
    }


def get_material_unit_alerts(session: Session, settings: Settings, *, sweep: bool = True, force: bool = False) -> dict:
    last_sweep_at = maybe_sweep_material_units(session, settings, force=force) if sweep else None
    if not sweep:
        state = _sweep_state(session)
        last_sweep_at = state.refreshed_at if state is not None else None

    pending = session.scalars(
        select(MaterialUnitChange)
        .where(MaterialUnitChange.status == MaterialUnitChangeStatus.PENDING)
        .options(selectinload(MaterialUnitChange.resolved_by))
        .order_by(MaterialUnitChange.detected_at.desc())
    ).all()
    resolved = session.scalars(
        select(MaterialUnitChange)
        .where(MaterialUnitChange.status == MaterialUnitChangeStatus.RESOLVED)
        .options(selectinload(MaterialUnitChange.resolved_by))
        .order_by(MaterialUnitChange.resolved_at.desc())
        .limit(RESOLVED_HISTORY_LIMIT)
    ).all()

    usage_map = _build_usage_map(
        session,
        [change.material_id for change in pending],
        [change.sku for change in pending],
    )
    return {
        "pending": [_serialize_change(change, usage_map.get(change.material_id)) for change in pending],
        "history": [_serialize_change(change) for change in resolved],
        "last_sweep_at": last_sweep_at,
        "erp_available": erp_search_available(settings),
    }


def resolve_material_unit_alert(session: Session, *, change_id: int, user: User) -> dict | None:
    change = session.get(MaterialUnitChange, change_id)
    if change is None or change.status != MaterialUnitChangeStatus.PENDING:
        return None

    material = session.get(Material, change.material_id)
    if material is not None:
        material.unit = change.new_unit

    change.status = MaterialUnitChangeStatus.RESOLVED
    change.resolved_at = _utcnow()
    change.resolved_by_user_id = user.id
    change.resolution_note = "Cantidades revisadas y unidad de referencia actualizada."
    session.flush()
    session.refresh(change)
    return _serialize_change(change)
