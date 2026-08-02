from __future__ import annotations

from collections import defaultdict
from collections.abc import Mapping
from datetime import date, datetime, timedelta
import hashlib
import json
from math import isfinite

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.config import Settings
from app.models import MaterialStudyGroup, MaterialStudyGroupMember
from app.services.erp import (
    get_average_prices_for_products,
    get_material_movement_details,
    get_material_movement_history,
    get_material_procurement_details,
    get_purchase_order_price_stats_for_products,
    get_recent_movement_materials,
)
from app.services.house_type_links import (
    build_links_by_key,
    build_mapped_house_comparison,
    expected_quantities_for_link,
    get_project_expected_quantity_maps,
    house_type_links_fingerprint,
    linked_projects_bom_fingerprint,
    link_missing_quantity_count,
    load_house_type_links,
    resolve_house_type_link,
)
from app.services.production_dashboard import build_house_start_grid, get_production_house_starts


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
    _replace_group_members(group, normalized_members)
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
    movement_cost_total = 0.0
    normalized_price_total = 0.0
    has_stock_value = False
    has_pending_value = False
    priced_movement_quantity = 0.0
    normalized_price_count = 0
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
        normalized_movement_quantity = movement_quantity * factor
        movement_quantity_30d += normalized_movement_quantity

        average_price = _coerce_float((detail or {}).get("average_price"))
        if average_price is not None:
            normalized_price = average_price / factor
            normalized_price_total += normalized_price
            normalized_price_count += 1
            if normalized_movement_quantity > 0:
                movement_cost_total += movement_quantity * average_price
                priced_movement_quantity += normalized_movement_quantity

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
    group_average_price = (
        round(movement_cost_total / priced_movement_quantity, 4)
        if priced_movement_quantity > 0
        else round(normalized_price_total / normalized_price_count, 4)
        if normalized_price_count > 0
        else None
    )
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
        "average_price": group_average_price,
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

    from app.services.dashboard import get_material_dashboard_mapped_house_comparison

    comparison = get_material_dashboard_mapped_house_comparison(
        settings,
        session=session,
        sku=build_material_study_group_subject_key(group.id),
        movements=history["movements"],
        sku_factors={
            member.sku.strip().upper(): float(member.factor_to_study_unit)
            for member in group.members
        },
        cost_centers=_normalize_dashboard_cost_centers(cost_centers),
        history_days=history_days,
        start_date=start_date,
        end_date=end_date,
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


def get_material_dashboard_group_economic_metrics(
    settings: Settings,
    *,
    session: Session,
    movement_days: int = 90,
    start_date: date | None = None,
    end_date: date | None = None,
    cost_centers: list[str] | None = None,
    excluded_cost_centers: list[str] | None = None,
    force_refresh: bool = False,
) -> dict:
    requested_end_day = end_date or datetime.utcnow().date()
    requested_start_day = start_date
    if requested_start_day is None:
        requested_start_day = requested_end_day - timedelta(days=max(int(movement_days), 1) - 1)
    elif requested_start_day > requested_end_day:
        raise ValueError("start_date must be on or before end_date")
    movement_window_days = max((requested_end_day - requested_start_day).days + 1, 1)
    normalized_cost_centers = _normalize_dashboard_cost_centers(cost_centers)
    normalized_excluded_cost_centers = _normalize_dashboard_cost_centers(excluded_cost_centers)

    groups = session.scalars(
        select(MaterialStudyGroup)
        .options(selectinload(MaterialStudyGroup.members))
        .order_by(MaterialStudyGroup.name, MaterialStudyGroup.id)
    ).all()
    from app.services.dashboard import (
        MATERIAL_DASHBOARD_CACHE_TTL_ECONOMICS,
        _dashboard_cache_key,
        _load_material_dashboard_cache,
    )

    cache_key = _dashboard_cache_key(
        {
            "cecos": normalized_cost_centers,
            "excluded_cecos": normalized_excluded_cost_centers,
            "groups": _group_economic_fingerprint(groups),
            "schema": "cost-breakdown-v1",
            "links": house_type_links_fingerprint(session),
            "bom": linked_projects_bom_fingerprint(session),
            "movement_days": movement_window_days,
            "start_date": requested_start_day.isoformat(),
            "end_date": requested_end_day.isoformat(),
        }
    )

    def loader() -> dict:
        production = get_production_house_starts(
            settings,
            start_date=requested_start_day.isoformat(),
            end_date=requested_end_day.isoformat(),
            history_days=movement_window_days,
        )
        start_grid = build_house_start_grid(production["houses"])
        links = load_house_type_links(session)
        links_by_key = build_links_by_key(links)
        expected_maps = get_project_expected_quantity_maps(session, {link.project_id for link in links})

        all_skus = [
            member.sku.strip().upper()
            for group in groups
            for member in group.members
            if member.sku and member.sku.strip()
        ]
        try:
            prices_by_sku = get_average_prices_for_products(settings, all_skus)
        except RuntimeError:
            prices_by_sku = {sku: None for sku in all_skus}
        try:
            price_stats_by_sku = get_purchase_order_price_stats_for_products(settings, all_skus)
        except RuntimeError:
            price_stats_by_sku = {sku: {} for sku in all_skus}

        metrics: list[dict] = []
        for group in groups:
            group_result = _build_group_economic_metric(
                settings,
                group,
                movement_window_days=movement_window_days,
                requested_start_day=requested_start_day,
                requested_end_day=requested_end_day,
                normalized_cost_centers=normalized_cost_centers,
                normalized_excluded_cost_centers=normalized_excluded_cost_centers,
                start_grid=start_grid,
                links_by_key=links_by_key,
                expected_maps=expected_maps,
                prices_by_sku=prices_by_sku,
                price_stats_by_sku=price_stats_by_sku,
            )
            metrics.append(group_result)

        return {
            "ceco_filters": list(normalized_cost_centers),
            "range_start": production.get("range_start"),
            "range_end": production.get("range_end"),
            "total_house_starts": sum(int(row.get("house_starts") or 0) for row in start_grid),
            "total_mapped_house_starts": _count_mapped_house_starts(start_grid, links_by_key, expected_maps),
            "link_count": len(links_by_key),
            "metrics": metrics,
            "generated_at": datetime.utcnow().isoformat(),
        }

    return _load_material_dashboard_cache(
        session,
        cache_kind="group-economics",
        cache_key=cache_key,
        ttl=MATERIAL_DASHBOARD_CACHE_TTL_ECONOMICS,
        loader=loader,
        force_refresh=force_refresh,
    )


def _build_group_economic_metric(
    settings: Settings,
    group: MaterialStudyGroup,
    *,
    movement_window_days: int,
    requested_start_day: date,
    requested_end_day: date,
    normalized_cost_centers: list[str],
    normalized_excluded_cost_centers: list[str],
    start_grid: list[dict],
    links_by_key: dict,
    expected_maps: dict,
    prices_by_sku: dict[str, float | None],
    price_stats_by_sku: dict[str, dict[str, float | None]],
) -> dict:
    members = list(group.members)
    factors_by_sku = {member.sku.strip().upper(): float(member.factor_to_study_unit) for member in members}
    actual_source_quantity_by_sku: dict[str, float] = defaultdict(float)
    group_quantity_by_day: dict[str, float] = defaultdict(float)

    for member in members:
        sku = member.sku.strip().upper()
        factor = float(member.factor_to_study_unit)
        history = get_material_movement_history(
            settings,
            sku,
            days=movement_window_days,
            start_day=requested_start_day,
            end_day=requested_end_day,
            cost_centers=normalized_cost_centers,
            excluded_cost_centers=normalized_excluded_cost_centers,
        )
        for point in history:
            source_quantity = float(point.get("quantity") or 0.0)
            day_key = str(point.get("date"))
            actual_source_quantity_by_sku[sku] += source_quantity
            group_quantity_by_day[day_key] += source_quantity * factor

    movements = [
        {
            "date": (requested_start_day + timedelta(days=index)).isoformat(),
            "quantity": round(group_quantity_by_day.get((requested_start_day + timedelta(days=index)).isoformat(), 0.0), 4),
        }
        for index in range(movement_window_days)
    ]
    comparison = build_mapped_house_comparison(
        movements=movements,
        start_grid=start_grid,
        links_by_key=links_by_key,
        expected_maps=expected_maps,
        sku_factors=factors_by_sku,
        start_day=requested_start_day,
        end_day=requested_end_day,
    )
    expected_source_quantity_by_sku = _expected_source_quantities_for_members(
        start_grid,
        links_by_key,
        expected_maps,
        set(factors_by_sku),
    )

    actual_cost = _sum_source_cost(actual_source_quantity_by_sku, prices_by_sku)
    expected_cost = _sum_source_cost(expected_source_quantity_by_sku, prices_by_sku)
    total_group_quantity = float(comparison["total_material_quantity"] or 0.0)
    expected_group_quantity = float(comparison["total_expected_material_quantity"] or 0.0)
    total_house_starts = int(comparison["total_house_starts"] or 0)
    total_mapped_house_starts = int(comparison["total_mapped_house_starts"] or 0)
    average_price = (
        round(actual_cost / total_group_quantity, 4)
        if actual_cost is not None and total_group_quantity > 0
        else round(expected_cost / expected_group_quantity, 4)
        if expected_cost is not None and expected_group_quantity > 0
        else None
    )
    price_delta = _group_normalized_price_delta(members, price_stats_by_sku)
    cost_breakdown = _build_group_cost_breakdown(
        members,
        actual_source_quantity_by_sku=actual_source_quantity_by_sku,
        expected_source_quantity_by_sku=expected_source_quantity_by_sku,
        prices_by_sku=prices_by_sku,
        total_house_starts=total_house_starts,
    )

    return {
        "group_id": group.id,
        "name": group.name,
        "study_unit": group.study_unit,
        "sku": build_material_study_group_subject_key(group.id),
        "material_per_house": (
            round(total_group_quantity / total_house_starts, 4)
            if total_house_starts > 0
            else None
        ),
        "predicted_quantity_per_house": (
            round(expected_group_quantity / total_mapped_house_starts, 4)
            if total_mapped_house_starts > 0
            else None
        ),
        "consumption_delta_percent": (
            round(((total_group_quantity - expected_group_quantity) / expected_group_quantity) * 100, 4)
            if expected_group_quantity != 0
            else None
        ),
        "consumption_cost_delta_per_house": (
            round((actual_cost - expected_cost) / total_house_starts, 4)
            if actual_cost is not None and expected_cost is not None and total_house_starts > 0
            else None
        ),
        "average_price": average_price,
        "last_purchase_price": None,
        "min_purchase_price": price_delta["min_price"],
        "max_purchase_price": price_delta["max_price"],
        "purchase_price_delta": price_delta["delta"],
        "purchase_price_delta_percent": price_delta["delta_percent"],
        "historical_weighted_overprice": (
            round(price_delta["delta"] * (total_group_quantity / total_house_starts), 4)
            if price_delta["delta"] is not None and total_house_starts > 0
            else None
        ),
        "estimated_weighted_overprice": (
            round(price_delta["delta"] * (expected_group_quantity / total_mapped_house_starts), 4)
            if price_delta["delta"] is not None and total_mapped_house_starts > 0
            else None
        ),
        "cost_breakdown": cost_breakdown,
    }


def _build_group_cost_breakdown(
    members: list[MaterialStudyGroupMember],
    *,
    actual_source_quantity_by_sku: dict[str, float],
    expected_source_quantity_by_sku: dict[str, float],
    prices_by_sku: dict[str, float | None],
    total_house_starts: int,
) -> list[dict]:
    rows: list[dict] = []
    for member in members:
        sku = member.sku.strip().upper()
        factor = float(member.factor_to_study_unit)
        actual_source_quantity = round(float(actual_source_quantity_by_sku.get(sku) or 0.0), 4)
        expected_source_quantity = round(float(expected_source_quantity_by_sku.get(sku) or 0.0), 4)
        price = _coerce_float(prices_by_sku.get(sku))
        actual_cost = round(actual_source_quantity * price, 4) if price is not None else None
        expected_cost = round(expected_source_quantity * price, 4) if price is not None else None
        cost_delta = (
            round(actual_cost - expected_cost, 4)
            if actual_cost is not None and expected_cost is not None
            else None
        )
        rows.append(
            {
                "sku": sku,
                "material_name": str(getattr(member, "material_name", None) or sku),
                "unit": getattr(member, "unit", None),
                "factor_to_study_unit": round(factor, 4),
                "actual_source_quantity": actual_source_quantity,
                "expected_source_quantity": expected_source_quantity,
                "actual_study_quantity": round(actual_source_quantity * factor, 4),
                "expected_study_quantity": round(expected_source_quantity * factor, 4),
                "average_price": price,
                "actual_cost": actual_cost,
                "expected_cost": expected_cost,
                "cost_delta": cost_delta,
                "cost_delta_per_house": (
                    round(cost_delta / total_house_starts, 4)
                    if cost_delta is not None and total_house_starts > 0
                    else None
                ),
            }
        )
    return sorted(
        rows,
        key=lambda row: (
            -(abs(float(row["cost_delta"])) if row["cost_delta"] is not None else -1.0),
            row["material_name"].lower(),
            row["sku"],
        ),
    )


def _expected_source_quantities_for_members(
    start_grid: list[dict],
    links_by_key: dict,
    expected_maps: dict,
    member_skus: set[str],
) -> dict[str, float]:
    expected_source_quantity_by_sku: dict[str, float] = defaultdict(float)
    per_link_quantities: dict[tuple[int, int | None], dict[str, float]] = {}
    for row in start_grid:
        count = int(row.get("house_starts") or 0)
        if count <= 0:
            continue
        house_type_id = int(row.get("house_type_id") or 0)
        sub_type_raw = row.get("sub_type_id")
        sub_type_id = int(sub_type_raw) if sub_type_raw is not None else None
        link = resolve_house_type_link(links_by_key, house_type_id, sub_type_id)
        if link is None:
            continue
        link_key = (
            link["production_house_type_id"] if isinstance(link, Mapping) else link.production_house_type_id,
            link["production_sub_type_id"] if isinstance(link, Mapping) else link.production_sub_type_id,
        )
        if link_key not in per_link_quantities:
            per_link_quantities[link_key] = expected_quantities_for_link(link, expected_maps)
        for sku, source_quantity_per_house in per_link_quantities[link_key].items():
            normalized_sku = str(sku or "").strip().upper()
            if normalized_sku in member_skus:
                expected_source_quantity_by_sku[normalized_sku] += float(source_quantity_per_house or 0.0) * count
    return expected_source_quantity_by_sku


def _sum_source_cost(source_quantity_by_sku: dict[str, float], prices_by_sku: dict[str, float | None]) -> float | None:
    total = 0.0
    has_quantity = False
    for sku, quantity in source_quantity_by_sku.items():
        if float(quantity or 0.0) == 0.0:
            continue
        has_quantity = True
        price = _coerce_float(prices_by_sku.get(sku))
        if price is None:
            return None
        total += float(quantity or 0.0) * price
    return round(total, 4) if has_quantity else None


def _group_normalized_price_delta(
    members: list[MaterialStudyGroupMember],
    price_stats_by_sku: dict[str, dict[str, float | None]],
) -> dict[str, float | None]:
    normalized_prices: list[float] = []
    for member in members:
        factor = float(member.factor_to_study_unit)
        if factor <= 0:
            continue
        stats = price_stats_by_sku.get(member.sku.strip().upper()) or {}
        for field in ("min_purchase_price", "max_purchase_price"):
            price = _coerce_float(stats.get(field))
            if price is not None:
                normalized_prices.append(round(price / factor, 4))
    if not normalized_prices:
        return {"min_price": None, "max_price": None, "delta": None, "delta_percent": None}
    min_price = min(normalized_prices)
    max_price = max(normalized_prices)
    delta = round(max_price - min_price, 4)
    return {
        "min_price": min_price,
        "max_price": max_price,
        "delta": delta,
        "delta_percent": round((delta / min_price) * 100, 4) if min_price else None,
    }


def _count_mapped_house_starts(start_grid: list[dict], links_by_key: dict, expected_maps: dict) -> int:
    total = 0
    for row in start_grid:
        house_type_id = int(row.get("house_type_id") or 0)
        sub_type_raw = row.get("sub_type_id")
        sub_type_id = int(sub_type_raw) if sub_type_raw is not None else None
        link = resolve_house_type_link(links_by_key, house_type_id, sub_type_id)
        if link is not None and link_missing_quantity_count(link, expected_maps) == 0:
            total += int(row.get("house_starts") or 0)
    return total


def _group_economic_fingerprint(groups: list[MaterialStudyGroup]) -> str:
    payload = [
        {
            "id": group.id,
            "updated_at": group.updated_at.isoformat() if group.updated_at else None,
            "members": [
                {
                    "sku": member.sku.strip().upper(),
                    "factor": round(float(member.factor_to_study_unit), 6),
                    "display_order": member.display_order,
                }
                for member in group.members
            ],
        }
        for group in groups
    ]
    return hashlib.sha1(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()


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


def _replace_group_members(group: MaterialStudyGroup, members: list[dict]) -> None:
    existing_members_by_sku = {member.sku: member for member in group.members}
    next_members: list[MaterialStudyGroupMember] = []

    for index, member_data in enumerate(members):
        existing_member = existing_members_by_sku.get(member_data["sku"])
        if existing_member is None:
            next_members.append(_build_group_member(member_data, index=index))
            continue

        existing_member.material_name = member_data["material_name"]
        existing_member.unit = member_data["unit"]
        existing_member.factor_to_study_unit = member_data["factor_to_study_unit"]
        existing_member.display_order = index
        next_members.append(existing_member)

    group.members = next_members


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
