from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timedelta
from math import isfinite

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.config import Settings
from app.models import MaterialStudyGroup, MaterialStudyGroupMember
from app.services.erp import (
    get_material_movement_details,
    get_material_movement_history,
    get_material_procurement_details,
    get_recent_movement_materials,
)
from app.services.production_dashboard import get_material_dashboard_house_start_comparison


def build_material_study_group_subject_key(group_id: int) -> str:
    return f"GROUP:{int(group_id)}"


def list_material_study_groups(session: Session) -> list[dict]:
    groups = session.scalars(
        select(MaterialStudyGroup)
        .options(selectinload(MaterialStudyGroup.members))
        .order_by(MaterialStudyGroup.name, MaterialStudyGroup.id)
    ).all()
    return [_serialize_group(group) for group in groups]


def create_material_study_group(
    session: Session,
    *,
    name: str,
    study_unit: str,
    description: str | None,
    members: list[dict],
) -> dict:
    normalized_name = _normalize_required_text(name, field_name="name", max_length=160)
    normalized_study_unit = _normalize_required_text(study_unit, field_name="study_unit", max_length=50)
    normalized_members = _normalize_group_members(members)

    group = MaterialStudyGroup(
        name=normalized_name,
        study_unit=normalized_study_unit,
        description=_normalize_optional_text(description),
    )
    group.members = [_build_group_member(member, index=index) for index, member in enumerate(normalized_members)]
    session.add(group)
    _flush_group_mutation(session)
    return _serialize_group(group)


def update_material_study_group(
    session: Session,
    group_id: int,
    *,
    name: str,
    study_unit: str,
    description: str | None,
    members: list[dict],
) -> dict | None:
    group = _load_group(session, group_id)
    if group is None:
        return None

    group.name = _normalize_required_text(name, field_name="name", max_length=160)
    group.study_unit = _normalize_required_text(study_unit, field_name="study_unit", max_length=50)
    group.description = _normalize_optional_text(description)
    normalized_members = _normalize_group_members(members)
    group.members = [_build_group_member(member, index=index) for index, member in enumerate(normalized_members)]
    _flush_group_mutation(session)
    return _serialize_group(group)


def delete_material_study_group(session: Session, group_id: int) -> bool:
    group = session.get(MaterialStudyGroup, group_id)
    if group is None:
        return False
    session.delete(group)
    session.flush()
    return True


def get_material_dashboard_groups(
    settings: Settings,
    *,
    session: Session,
    movement_days: int = 60,
    start_date: date | None = None,
    end_date: date | None = None,
    cost_centers: list[str] | None = None,
    excluded_cost_centers: list[str] | None = None,
) -> dict:
    groups = session.scalars(
        select(MaterialStudyGroup)
        .options(selectinload(MaterialStudyGroup.members))
        .order_by(MaterialStudyGroup.name, MaterialStudyGroup.id)
    ).all()
    requested_end_day = end_date or datetime.utcnow().date()
    requested_start_day = start_date
    if requested_start_day is None:
        requested_start_day = requested_end_day - timedelta(days=max(int(movement_days), 1) - 1)
    elif requested_start_day > requested_end_day:
        raise ValueError("start_date must be on or before end_date")
    movement_window_days = max((requested_end_day - requested_start_day).days + 1, 1)
    recent_materials = get_recent_movement_materials(
        settings,
        days=movement_window_days,
        start_day=requested_start_day,
        end_day=requested_end_day,
        cost_centers=_normalize_dashboard_cost_centers(cost_centers),
        excluded_cost_centers=_normalize_dashboard_cost_centers(excluded_cost_centers),
    )
    recent_by_sku = {str(row.get("sku") or "").strip().upper(): row for row in recent_materials}
    rows = [_serialize_group_with_metrics(group, recent_by_sku) for group in groups]
    return {
        "groups": rows,
        "movement_window_days": movement_window_days,
        "ceco_filters": list(_normalize_dashboard_cost_centers(cost_centers)),
        "generated_at": datetime.utcnow().isoformat(),
    }


def get_material_dashboard_group_detail(
    settings: Settings,
    group_id: int,
    *,
    session: Session,
    cost_centers: list[str] | None = None,
    excluded_cost_centers: list[str] | None = None,
) -> dict | None:
    group = _load_group(session, group_id)
    if group is None:
        return None

    normalized_cost_centers = _normalize_dashboard_cost_centers(cost_centers)
    normalized_excluded_cost_centers = _normalize_dashboard_cost_centers(excluded_cost_centers)
    today = datetime.utcnow().date()
    movement_window_start = today - timedelta(days=30)
    business_days_in_window = _count_business_days(movement_window_start, today)

    movement_quantity_30d = 0.0
    stock_on_hand_total = 0.0
    pending_purchase_total = 0.0
    has_stock_value = False
    has_pending_value = False
    members: list[dict] = []

    for member in group.members:
        factor = float(member.factor_to_study_unit)
        detail = get_material_procurement_details(
            settings,
            member.sku,
            cost_centers=normalized_cost_centers,
            excluded_cost_centers=normalized_excluded_cost_centers,
        )
        movement_quantity = float((detail or {}).get("movement_quantity_30d") or 0.0)
        movement_quantity_30d += movement_quantity * factor

        stock_on_hand = _coerce_float((detail or {}).get("stock_on_hand"))
        if stock_on_hand is not None:
            has_stock_value = True
            stock_on_hand_total += stock_on_hand * factor

        pending_purchase = _coerce_float((detail or {}).get("pending_purchase_quantity"))
        if pending_purchase is not None:
            has_pending_value = True
            pending_purchase_total += pending_purchase * factor

        members.append(
            {
                "sku": member.sku,
                "material_name": str((detail or {}).get("material_name") or member.material_name or member.sku),
                "unit": (detail or {}).get("unit") or member.unit,
                "factor_to_study_unit": round(factor, 4),
                "display_order": member.display_order,
            }
        )

    movement_quantity_30d = round(movement_quantity_30d, 2)
    stock_on_hand = round(stock_on_hand_total, 2) if has_stock_value else None
    pending_purchase_quantity = round(pending_purchase_total, 2) if has_pending_value else None
    average_daily_outgoing_30d = round(movement_quantity_30d / business_days_in_window, 2) if movement_quantity_30d > 0 and business_days_in_window > 0 else 0.0
    days_of_stock_30d = round(stock_on_hand / average_daily_outgoing_30d, 1) if stock_on_hand is not None and average_daily_outgoing_30d > 0 else None

    return {
        "group_id": group.id,
        "name": group.name,
        "description": group.description,
        "study_unit": group.study_unit,
        "member_count": len(members),
        "members": members,
        "sku": build_material_study_group_subject_key(group.id),
        "material_name": group.name,
        "unit": group.study_unit,
        "movement_quantity_30d": movement_quantity_30d,
        "stock_on_hand": stock_on_hand,
        "pending_purchase_quantity": pending_purchase_quantity,
        "average_price": None,
        "average_lead_time_days": None,
        "median_lead_time_days": None,
        "max_lead_time_days": None,
        "lead_time_sample_count": 0,
        "average_daily_outgoing_30d": average_daily_outgoing_30d,
        "days_of_stock_30d": days_of_stock_30d,
        "reorder_date_recent_rate": None,
        "last_purchase_order": {
            "date": None,
            "number": None,
            "estimated_delivery": None,
        },
        "generated_at": datetime.utcnow().isoformat(),
    }


def get_material_dashboard_group_history(
    settings: Settings,
    group_id: int,
    *,
    session: Session,
    history_days: int = 90,
    start_date: date | None = None,
    end_date: date | None = None,
    cost_centers: list[str] | None = None,
    excluded_cost_centers: list[str] | None = None,
) -> dict | None:
    group = _load_group(session, group_id)
    if group is None:
        return None

    normalized_cost_centers = _normalize_dashboard_cost_centers(cost_centers)
    normalized_excluded_cost_centers = _normalize_dashboard_cost_centers(excluded_cost_centers)
    requested_end_day = end_date or datetime.utcnow().date()
    if start_date is None:
        window_days = max(int(history_days), 1)
        requested_start_day = requested_end_day - timedelta(days=window_days - 1)
    else:
        requested_start_day = start_date
        if requested_start_day > requested_end_day:
            raise ValueError("start_date must be on or before end_date")
        window_days = max((requested_end_day - requested_start_day).days + 1, 1)

    quantity_by_day: dict[str, float] = defaultdict(float)
    movement_details: list[dict] = []

    for member in group.members:
        factor = float(member.factor_to_study_unit)
        history = get_material_movement_history(
            settings,
            member.sku,
            days=window_days,
            start_day=requested_start_day,
            end_day=requested_end_day,
            cost_centers=normalized_cost_centers,
            excluded_cost_centers=normalized_excluded_cost_centers,
        )
        for point in history:
            day_key = str(point.get("date"))
            quantity_by_day[day_key] += (float(point.get("quantity") or 0.0) * factor)

        for detail in get_material_movement_details(
            settings,
            member.sku,
            days=window_days,
            start_day=requested_start_day,
            end_day=requested_end_day,
            cost_centers=normalized_cost_centers,
            excluded_cost_centers=normalized_excluded_cost_centers,
        ):
            original_quantity = float(detail.get("quantity") or 0.0)
            movement_details.append(
                {
                    "date": detail.get("date"),
                    "quantity": round(original_quantity * factor, 4),
                    "ceco": detail.get("ceco"),
                    "ceco_name": detail.get("ceco_name"),
                    "desc_sub": detail.get("desc_sub"),
                    "movement_internal_number": detail.get("movement_internal_number"),
                    "line_count": int(detail.get("line_count") or 0),
                    "sku": member.sku,
                    "material_name": member.material_name,
                    "source_unit": member.unit,
                    "factor_to_study_unit": round(factor, 4),
                    "source_quantity": round(original_quantity, 4),
                }
            )

    series = [
        {
            "date": (requested_start_day + timedelta(days=index)).isoformat(),
            "quantity": round(quantity_by_day.get((requested_start_day + timedelta(days=index)).isoformat(), 0.0), 4),
        }
        for index in range(window_days)
    ]
    movement_details.sort(
        key=lambda item: (
            str(item.get("date") or ""),
            str(item.get("movement_internal_number") or ""),
            str(item.get("sku") or ""),
        ),
        reverse=True,
    )

    return {
        "group_id": group.id,
        "group_name": group.name,
        "description": group.description,
        "study_unit": group.study_unit,
        "member_count": len(group.members),
        "members": [_serialize_group_member(member) for member in group.members],
        "sku": build_material_study_group_subject_key(group.id),
        "material_name": group.name,
        "unit": group.study_unit,
        "movement_days": len(series),
        "ceco_filters": list(normalized_cost_centers),
        "range_start": series[0]["date"] if series else None,
        "range_end": series[-1]["date"] if series else None,
        "movements": series,
        "movement_details": movement_details,
        "generated_at": datetime.utcnow().isoformat(),
    }


def get_material_dashboard_group_house_comparison(
    settings: Settings,
    group_id: int,
    *,
    session: Session,
    house_type_id: int,
    history_days: int = 90,
    start_date: date | None = None,
    end_date: date | None = None,
    cost_centers: list[str] | None = None,
    excluded_cost_centers: list[str] | None = None,
) -> dict | None:
    group = _load_group(session, group_id)
    if group is None:
        return None

    history = get_material_dashboard_group_history(
        settings,
        group_id,
        session=session,
        history_days=history_days,
        start_date=start_date,
        end_date=end_date,
        cost_centers=cost_centers,
        excluded_cost_centers=excluded_cost_centers,
    )
    if history is None:
        return None

    comparison = get_material_dashboard_house_start_comparison(
        settings,
        sku=build_material_study_group_subject_key(group.id),
        movements=history["movements"],
        house_type_id=house_type_id,
        cost_centers=_normalize_dashboard_cost_centers(cost_centers),
        history_days=history_days,
        start_date=start_date.isoformat() if start_date else None,
        end_date=end_date.isoformat() if end_date else None,
    )
    comparison.update(
        {
            "group_id": group.id,
            "group_name": group.name,
            "description": group.description,
            "study_unit": group.study_unit,
            "member_count": len(group.members),
            "members": [_serialize_group_member(member) for member in group.members],
            "material_name": group.name,
            "unit": group.study_unit,
        }
    )
    return comparison


def _load_group(session: Session, group_id: int) -> MaterialStudyGroup | None:
    return session.scalar(
        select(MaterialStudyGroup)
        .where(MaterialStudyGroup.id == int(group_id))
        .options(selectinload(MaterialStudyGroup.members))
    )


def _serialize_group(group: MaterialStudyGroup) -> dict:
    return {
        "group_id": group.id,
        "name": group.name,
        "description": group.description,
        "study_unit": group.study_unit,
        "member_count": len(group.members),
        "members": [_serialize_group_member(member) for member in group.members],
        "sku": build_material_study_group_subject_key(group.id),
        "material_name": group.name,
        "unit": group.study_unit,
        "last_movement_date": None,
        "movement_quantity_60d": 0.0,
        "movement_count_60d": 0,
    }


def _serialize_group_with_metrics(group: MaterialStudyGroup, recent_by_sku: dict[str, dict]) -> dict:
    row = _serialize_group(group)
    movement_quantity = 0.0
    movement_count = 0
    last_movement_date: str | None = None
    for member in group.members:
        recent = recent_by_sku.get(member.sku)
        if not recent:
            continue
        movement_quantity += float(recent.get("movement_quantity_60d") or 0.0) * float(member.factor_to_study_unit)
        movement_count += int(recent.get("movement_count_60d") or 0)
        recent_last_movement_date = recent.get("last_movement_date")
        if recent_last_movement_date and (last_movement_date is None or str(recent_last_movement_date) > last_movement_date):
            last_movement_date = str(recent_last_movement_date)
    row["last_movement_date"] = last_movement_date
    row["movement_quantity_60d"] = round(movement_quantity, 2)
    row["movement_count_60d"] = movement_count
    return row


def _serialize_group_member(member: MaterialStudyGroupMember) -> dict:
    return {
        "sku": member.sku,
        "material_name": member.material_name,
        "unit": member.unit,
        "factor_to_study_unit": round(float(member.factor_to_study_unit), 4),
        "display_order": member.display_order,
    }


def _build_group_member(member: dict, *, index: int) -> MaterialStudyGroupMember:
    return MaterialStudyGroupMember(
        sku=member["sku"],
        material_name=member["material_name"],
        unit=member["unit"],
        factor_to_study_unit=member["factor_to_study_unit"],
        display_order=index,
    )


def _normalize_group_members(members: list[dict]) -> list[dict]:
    normalized_members: list[dict] = []
    seen_skus: set[str] = set()
    for raw_member in members:
        sku = _normalize_required_text(raw_member.get("sku"), field_name="members[].sku", max_length=80).upper()
        if sku in seen_skus:
            raise ValueError(f"Duplicate SKU in group members: {sku}")
        seen_skus.add(sku)
        material_name = _normalize_required_text(
            raw_member.get("material_name") or sku,
            field_name=f"material_name for {sku}",
            max_length=160,
        )
        unit = _normalize_optional_text(raw_member.get("unit"), max_length=50)
        factor = raw_member.get("factor_to_study_unit")
        try:
            normalized_factor = float(factor)
        except (TypeError, ValueError) as exc:
            raise ValueError(f"Invalid factor_to_study_unit for {sku}") from exc
        if not isfinite(normalized_factor) or normalized_factor <= 0:
            raise ValueError(f"factor_to_study_unit for {sku} must be greater than 0")
        normalized_members.append(
            {
                "sku": sku,
                "material_name": material_name,
                "unit": unit,
                "factor_to_study_unit": round(normalized_factor, 4),
            }
        )
    if not normalized_members:
        raise ValueError("At least one member is required")
    return normalized_members


def _normalize_required_text(value: object, *, field_name: str, max_length: int) -> str:
    normalized = str(value or "").strip()
    if not normalized:
        raise ValueError(f"{field_name} is required")
    if len(normalized) > max_length:
        raise ValueError(f"{field_name} must be at most {max_length} characters")
    return normalized


def _normalize_optional_text(value: object, *, max_length: int | None = None) -> str | None:
    normalized = str(value or "").strip()
    if not normalized:
        return None
    if max_length is not None and len(normalized) > max_length:
        raise ValueError(f"Value must be at most {max_length} characters")
    return normalized


def _normalize_dashboard_cost_centers(cost_centers: list[str] | None) -> list[str]:
    return sorted({str(value).strip() for value in cost_centers or [] if value is not None and str(value).strip()})


def _count_business_days(start_day: date, end_day: date) -> int:
    if end_day < start_day:
        start_day, end_day = end_day, start_day
    count = 0
    current_day = start_day
    while current_day <= end_day:
        if current_day.weekday() < 5:
            count += 1
        current_day += timedelta(days=1)
    return count


def _coerce_float(value: object) -> float | None:
    if value is None:
        return None
    try:
        return round(float(value), 2)
    except (TypeError, ValueError):
        return None


def _flush_group_mutation(session: Session) -> None:
    try:
        session.flush()
    except IntegrityError as exc:
        message = str(exc).lower()
        if "material_study_groups" in message and "name" in message:
            raise ValueError("A material group with this name already exists") from exc
        raise
