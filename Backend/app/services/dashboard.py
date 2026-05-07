from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
import hashlib
import json

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError, OperationalError, ProgrammingError
from sqlalchemy.orm import Session, selectinload

from app.config import Settings
from app.models import (
    ErpMaterialCache,
    MaterialDashboardCacheEntry,
    Project,
    ProjectBomEntry,
    ProjectInstance,
    ProjectMaterialCalculationSheet,
)
from app.services.erp import (
    get_cost_centers,
    get_average_prices_for_products,
    get_material_movement_details,
    get_material_movement_history,
    get_material_procurement_details,
    get_recent_movement_materials,
)
from app.services.production_dashboard import get_material_dashboard_house_start_summary


MATERIAL_DASHBOARD_CACHE_VERSION = 5
MATERIAL_DASHBOARD_CACHE_KIND_CECOS = "cecos"
MATERIAL_DASHBOARD_CACHE_KIND_LIST = "list"
MATERIAL_DASHBOARD_CACHE_KIND_DETAIL = "detail"
MATERIAL_DASHBOARD_CACHE_KIND_HISTORY = "history"
MATERIAL_DASHBOARD_CACHE_KIND_ECONOMICS = "economics"
MATERIAL_DASHBOARD_CACHE_TTL_CECOS = timedelta(hours=24)
MATERIAL_DASHBOARD_CACHE_TTL_LIST = timedelta(minutes=30)
MATERIAL_DASHBOARD_CACHE_TTL_DETAIL = timedelta(minutes=15)
MATERIAL_DASHBOARD_CACHE_TTL_HISTORY = timedelta(hours=6)
MATERIAL_DASHBOARD_CACHE_TTL_ECONOMICS = timedelta(minutes=30)
MATERIAL_DASHBOARD_CACHE_KEY_MAX_LENGTH = 255


def get_project_material_dashboard(session: Session, project_id: int) -> dict | None:
    project = session.scalar(
        select(Project)
        .where(Project.id == project_id)
        .options(
            selectinload(Project.bom_entries).selectinload(ProjectBomEntry.material),
            selectinload(Project.instances).selectinload(ProjectInstance.category),
        )
    )
    if project is None:
        return None

    cache_by_sku = {
        cache.sku: cache
        for cache in session.scalars(select(ErpMaterialCache).order_by(ErpMaterialCache.sku)).all()
    }
    instance_by_id = {instance.id: instance for instance in project.instances}

    rows_by_sku: dict[str, dict] = defaultdict(
        lambda: {
            "sku": None,
            "material_name": None,
            "unit": None,
            "project_quantity": 0.0,
            "blank_quantity_count": 0,
            "instance_contexts": [],
        }
    )

    for entry in project.bom_entries:
        row = rows_by_sku[entry.material.sku]
        row["sku"] = entry.material.sku
        row["material_name"] = entry.material.name
        row["unit"] = entry.unit or entry.material.unit
        if entry.quantity is None:
            row["blank_quantity_count"] += 1
        else:
            row["project_quantity"] += entry.quantity
        instance = instance_by_id.get(entry.instance_id)
        row["instance_contexts"].append(
            {
                "instance_name": instance.name if instance else None,
                "category": instance.category.name if instance and instance.category else None,
                "subtype": entry.subtype.name if entry.subtype else "General",
                "quantity": entry.quantity,
            }
        )

    rows = []
    for sku, row in sorted(rows_by_sku.items()):
        cache = cache_by_sku.get(sku)
        stock_on_hand = cache.stock_on_hand if cache and cache.stock_on_hand is not None else 0.0
        pending_po = cache.pending_purchase_quantity if cache and cache.pending_purchase_quantity is not None else 0.0
        shortage = max(row["project_quantity"] - (stock_on_hand + pending_po), 0.0)
        rows.append(
            {
                **row,
                "stock_on_hand": cache.stock_on_hand if cache else None,
                "pending_purchase_quantity": cache.pending_purchase_quantity if cache else None,
                "average_price": cache.average_price if cache else None,
                "average_lead_time_days": cache.average_lead_time_days if cache else None,
                "recent_monthly_consumption": cache.recent_monthly_consumption if cache else None,
                "shortage": shortage,
            }
        )

    return {
        "project": {"id": project.id, "name": project.name},
        "rows": rows,
    }


def get_material_dashboard_project_quantity_map(
    session: Session,
    *,
    project_id: int,
) -> tuple[Project | None, dict[str, float]]:
    project = session.scalar(
        select(Project)
        .where(Project.id == project_id)
        .options(selectinload(Project.bom_entries).selectinload(ProjectBomEntry.material))
    )
    if project is None:
        return None, {}

    quantity_by_sku: dict[str, float] = defaultdict(float)
    for entry in project.bom_entries:
        if entry.quantity is None or entry.material is None:
            continue
        sku = entry.material.sku.strip().upper()
        if not sku:
            continue
        quantity_by_sku[sku] += float(entry.quantity)
    return project, {sku: round(quantity, 4) for sku, quantity in quantity_by_sku.items()}


def get_material_dashboard_project_comparison(
    session: Session,
    *,
    project_id: int,
    sku_factors: dict[str, float],
    total_house_starts: int,
) -> dict | None:
    normalized_factors = {
        str(sku).strip().upper(): float(factor)
        for sku, factor in sku_factors.items()
        if str(sku).strip() and float(factor or 0.0) != 0.0
    }
    project, project_quantity_by_sku = get_material_dashboard_project_quantity_map(session, project_id=project_id)
    if project is None:
        return None

    predicted_quantity_per_house = 0.0
    for sku, quantity in project_quantity_by_sku.items():
        factor = normalized_factors.get(sku)
        if factor is None:
            continue
        predicted_quantity_per_house += quantity * factor

    return {
        "project": project,
        "comparison": {
            "project_id": project.id,
            "project_name": project.name,
            "predicted_quantity_per_house": round(predicted_quantity_per_house, 4),
            "projected_total_material_quantity": round(predicted_quantity_per_house * max(int(total_house_starts), 0), 4),
        },
    }


def get_material_dashboard_project_usage(
    session: Session,
    *,
    project_id: int,
    sku: str,
) -> dict | None:
    normalized_sku = sku.strip().upper()
    if not normalized_sku:
        return None

    project = session.scalar(
        select(Project)
        .where(Project.id == project_id)
        .options(
            selectinload(Project.bom_entries).selectinload(ProjectBomEntry.material),
            selectinload(Project.bom_entries).selectinload(ProjectBomEntry.material_rule),
            selectinload(Project.bom_entries).selectinload(ProjectBomEntry.subtype),
            selectinload(Project.bom_entries).selectinload(ProjectBomEntry.instance).selectinload(ProjectInstance.category),
            selectinload(Project.bom_entries).selectinload(ProjectBomEntry.instance).selectinload(ProjectInstance.component),
            selectinload(Project.calculation_sheets).selectinload(ProjectMaterialCalculationSheet.cells),
        )
    )
    if project is None:
        return None

    calculation_sheet_by_key = {
        (sheet.instance_id, sheet.material_id): sheet
        for sheet in project.calculation_sheets
    }
    items_by_key: dict[tuple[int, int], dict] = {}
    material_name: str | None = None
    material_unit: str | None = None

    for entry in project.bom_entries:
        if entry.material is None or entry.material.sku.strip().upper() != normalized_sku:
            continue
        if entry.instance is None:
            continue

        if material_name is None:
            material_name = entry.material.name
        if material_unit is None:
            material_unit = entry.unit or (entry.material_rule.unit if entry.material_rule else None) or entry.material.unit

        item_key = (entry.instance_id, entry.material_rule_id or -entry.material_id)
        sheet = calculation_sheet_by_key.get((entry.instance_id, entry.material_id))
        item = items_by_key.get(item_key)
        if item is None:
            rule = entry.material_rule
            item = {
                "instance_id": entry.instance_id,
                "instance_name": entry.instance.name,
                "category_name": entry.instance.category.name if entry.instance.category else None,
                "component_name": entry.instance.component.name if entry.instance.component else None,
                "rule_id": entry.material_rule_id,
                "material_id": entry.material_id,
                "unit_qty_per_unit": round(float(rule.unit_qty_per_unit), 4)
                if rule is not None and rule.unit_qty_per_unit is not None
                else None,
                "total_quantity": 0.0,
                "blank_quantity_count": 0,
                "zero_quantity_count": 0,
                "unit": entry.unit or (rule.unit if rule else None) or entry.material.unit,
                "has_calculation_sheet": sheet is not None,
                "calculation_sheet_cell_count": len(sheet.cells) if sheet is not None else 0,
                "calculation_sheet_updated_at": sheet.updated_at.isoformat() if sheet is not None else None,
                "breakdown": [],
            }
            items_by_key[item_key] = item

        quantity = round(float(entry.quantity), 4) if entry.quantity is not None else None
        assembly_quantity = round(float(entry.assembly_quantity), 4) if entry.assembly_quantity is not None else None
        quantity_state = _dashboard_bom_value_state(entry.quantity)
        assembly_quantity_state = _dashboard_bom_value_state(entry.assembly_quantity)

        if quantity is None:
            item["blank_quantity_count"] += 1
        else:
            item["total_quantity"] = round(float(item["total_quantity"]) + quantity, 4)
            if quantity == 0:
                item["zero_quantity_count"] += 1

        item["breakdown"].append(
            {
                "subtype_id": entry.subtype_id,
                "subtype_name": entry.subtype.name if entry.subtype else "General",
                "quantity": quantity,
                "quantity_state": quantity_state,
                "assembly_quantity": assembly_quantity,
                "assembly_quantity_state": assembly_quantity_state,
                "unit": entry.unit or (entry.material_rule.unit if entry.material_rule else None) or entry.material.unit,
                "calculation_mode": entry.calculation_mode.value,
                "calculation_formula": entry.calculation_formula,
                "calculation_explanation": _dashboard_bom_calculation_explanation(entry),
            }
        )

    items = list(items_by_key.values())
    for item in items:
        item["breakdown"].sort(
            key=lambda row: (
                row["subtype_id"] is not None,
                row["subtype_name"].lower(),
            )
        )

    items.sort(
        key=lambda item: (
            (item["category_name"] or "").lower(),
            item["instance_name"].lower(),
            item["rule_id"] or 0,
        )
    )

    return {
        "project": {
            "id": project.id,
            "name": project.name,
        },
        "sku": normalized_sku,
        "material_name": material_name,
        "unit": material_unit,
        "total_quantity": round(sum(float(item["total_quantity"]) for item in items), 4),
        "item_count": len(items),
        "items": items,
        "generated_at": datetime.utcnow().isoformat(),
    }


def get_recent_material_dashboard(
    settings: Settings,
    *,
    session: Session | None = None,
    movement_days: int = 60,
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
    cache_key = _dashboard_cache_key(
        {
            "cecos": normalized_cost_centers,
            "excluded_cecos": normalized_excluded_cost_centers,
            "movement_days": movement_window_days,
            "start_date": requested_start_day.isoformat(),
            "end_date": requested_end_day.isoformat(),
        }
    )

    def loader() -> dict:
        return _build_recent_material_dashboard(
            settings,
            movement_days=movement_window_days,
            start_date=requested_start_day,
            end_date=requested_end_day,
            cost_centers=normalized_cost_centers,
            excluded_cost_centers=normalized_excluded_cost_centers,
        )

    return _load_material_dashboard_cache(
        session,
        cache_kind=MATERIAL_DASHBOARD_CACHE_KIND_LIST,
        cache_key=cache_key,
        ttl=MATERIAL_DASHBOARD_CACHE_TTL_LIST,
        loader=loader,
        force_refresh=force_refresh,
    )


def _build_recent_material_dashboard(
    settings: Settings,
    *,
    movement_days: int,
    start_date: date,
    end_date: date,
    cost_centers: list[str],
    excluded_cost_centers: list[str],
) -> dict:
    rows = get_recent_movement_materials(
        settings,
        days=movement_days,
        start_day=start_date,
        end_day=end_date,
        cost_centers=cost_centers,
        excluded_cost_centers=excluded_cost_centers,
    )
    serialized_rows = []
    for row in rows:
        serialized_rows.append(
            {
                "sku": row["sku"],
                "material_name": row["material_name"],
                "unit": row.get("unit"),
                "last_movement_date": row.get("last_movement_date"),
                "movement_quantity_60d": round(float(row.get("movement_quantity_60d") or 0.0), 2),
                "movement_count_60d": int(row.get("movement_count_60d") or 0),
            }
        )
    return {
        "materials": serialized_rows,
        "movement_window_days": max(int(movement_days), 1),
        "ceco_filters": list(cost_centers),
        "generated_at": datetime.utcnow().isoformat(),
    }


def get_material_dashboard_economic_metrics(
    settings: Settings,
    *,
    house_type_id: int,
    project_id: int | None = None,
    project_quantity_by_sku: dict[str, float] | None = None,
    session: Session | None = None,
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
    normalized_project_quantities = {
        str(sku).strip().upper(): round(float(quantity), 4)
        for sku, quantity in (project_quantity_by_sku or {}).items()
        if str(sku).strip()
    }
    cache_key = _dashboard_cache_key(
        {
            "cecos": normalized_cost_centers,
            "excluded_cecos": normalized_excluded_cost_centers,
            "house_type_id": int(house_type_id),
            "project_id": project_id,
            "movement_days": movement_window_days,
            "start_date": requested_start_day.isoformat(),
            "end_date": requested_end_day.isoformat(),
        }
    )

    def loader() -> dict:
        dashboard = get_recent_material_dashboard(
            settings,
            session=session,
            movement_days=movement_window_days,
            start_date=requested_start_day,
            end_date=requested_end_day,
            cost_centers=normalized_cost_centers,
            excluded_cost_centers=normalized_excluded_cost_centers,
            force_refresh=force_refresh,
        )
        house_start_summary = get_material_dashboard_house_start_summary(
            settings,
            house_type_id=int(house_type_id),
            cost_centers=normalized_cost_centers,
            history_days=movement_window_days,
            start_date=requested_start_day.isoformat(),
            end_date=requested_end_day.isoformat(),
        )
        sku_codes = [str(row.get("sku") or "").strip().upper() for row in dashboard.get("materials", [])]
        try:
            prices_by_sku = get_average_prices_for_products(settings, sku_codes)
        except RuntimeError:
            prices_by_sku = {sku: None for sku in sku_codes}
        total_house_starts = int(house_start_summary.get("total_house_starts") or 0)
        metrics: list[dict] = []

        for row in dashboard.get("materials", []):
            sku = str(row.get("sku") or "").strip().upper()
            movement_quantity = float(row.get("movement_quantity_60d") or 0.0)
            material_per_house = round(movement_quantity / total_house_starts, 4) if total_house_starts > 0 else None
            predicted_quantity_per_house = normalized_project_quantities.get(sku)
            average_price = prices_by_sku.get(sku)
            consumption_delta_percent = (
                round(((material_per_house - predicted_quantity_per_house) / predicted_quantity_per_house) * 100, 4)
                if material_per_house is not None and predicted_quantity_per_house not in (None, 0)
                else None
            )
            consumption_cost_delta_per_house = (
                round((material_per_house - predicted_quantity_per_house) * average_price, 4)
                if material_per_house is not None and predicted_quantity_per_house is not None and average_price is not None
                else None
            )
            metrics.append(
                {
                    "sku": sku,
                    "material_per_house": material_per_house,
                    "predicted_quantity_per_house": predicted_quantity_per_house,
                    "consumption_delta_percent": consumption_delta_percent,
                    "consumption_cost_delta_per_house": consumption_cost_delta_per_house,
                    "average_price": average_price,
                }
            )

        return {
            "house_type_id": int(house_type_id),
            "project_id": int(project_id) if project_id is not None else None,
            "ceco_filters": list(normalized_cost_centers),
            "range_start": house_start_summary.get("range_start"),
            "range_end": house_start_summary.get("range_end"),
            "total_house_starts": total_house_starts,
            "metrics": metrics,
            "generated_at": datetime.utcnow().isoformat(),
        }

    return _load_material_dashboard_cache(
        session,
        cache_kind=MATERIAL_DASHBOARD_CACHE_KIND_ECONOMICS,
        cache_key=cache_key,
        ttl=MATERIAL_DASHBOARD_CACHE_TTL_ECONOMICS,
        loader=loader,
        force_refresh=force_refresh,
    )


def get_material_dashboard_detail(
    settings: Settings,
    sku: str,
    *,
    session: Session | None = None,
    cost_centers: list[str] | None = None,
    excluded_cost_centers: list[str] | None = None,
    force_refresh: bool = False,
) -> dict | None:
    normalized_sku = sku.strip().upper()
    if not normalized_sku:
        return None

    normalized_cost_centers = _normalize_dashboard_cost_centers(cost_centers)
    normalized_excluded_cost_centers = _normalize_dashboard_cost_centers(excluded_cost_centers)
    cache_key = _dashboard_cache_key(
        {"cecos": normalized_cost_centers, "excluded_cecos": normalized_excluded_cost_centers, "sku": normalized_sku}
    )

    def loader() -> dict | None:
        return _build_material_dashboard_detail(
            settings,
            normalized_sku,
            cost_centers=normalized_cost_centers,
            excluded_cost_centers=normalized_excluded_cost_centers,
        )

    return _load_material_dashboard_cache(
        session,
        cache_kind=MATERIAL_DASHBOARD_CACHE_KIND_DETAIL,
        cache_key=cache_key,
        ttl=MATERIAL_DASHBOARD_CACHE_TTL_DETAIL,
        loader=loader,
        force_refresh=force_refresh,
    )


def _build_material_dashboard_detail(
    settings: Settings,
    sku: str,
    *,
    cost_centers: list[str],
    excluded_cost_centers: list[str] | None = None,
) -> dict | None:
    normalized_sku = sku.strip().upper()
    if not normalized_sku:
        return None

    material = get_material_procurement_details(
        settings,
        normalized_sku,
        cost_centers=cost_centers,
        excluded_cost_centers=excluded_cost_centers,
    )
    if material is None:
        return None

    today = datetime.utcnow().date()
    movement_window_start = today - timedelta(days=30)
    business_days_in_window = _count_business_days(movement_window_start, today)
    movement_quantity_30d = float(material.get("movement_quantity_30d") or 0.0)
    stock_on_hand = _coerce_float(material.get("stock_on_hand"))
    lead_time_reference = _coerce_float(material.get("max_lead_time_days")) or _coerce_float(material.get("average_lead_time_days"))
    average_daily_outgoing_30d = round(movement_quantity_30d / business_days_in_window, 2) if movement_quantity_30d > 0 and business_days_in_window > 0 else 0.0
    days_of_stock_30d = None
    reorder_date_recent_rate = None
    if stock_on_hand is not None and average_daily_outgoing_30d > 0:
        days_of_stock_30d = round(stock_on_hand / average_daily_outgoing_30d, 1)
        if lead_time_reference and lead_time_reference > 0:
            reorder_in_days = max(int(round(days_of_stock_30d - lead_time_reference)), 0)
            reorder_date_recent_rate = _add_business_days(today, reorder_in_days).isoformat()

    return {
        "sku": normalized_sku,
        "material_name": material["material_name"],
        "unit": material.get("unit"),
        "movement_quantity_30d": movement_quantity_30d,
        "stock_on_hand": stock_on_hand,
        "pending_purchase_quantity": _coerce_float(material.get("pending_purchase_quantity")),
        "average_price": _coerce_float(material.get("average_price")),
        "average_lead_time_days": _coerce_float(material.get("average_lead_time_days")),
        "median_lead_time_days": _coerce_float(material.get("median_lead_time_days")),
        "max_lead_time_days": _coerce_float(material.get("max_lead_time_days")),
        "lead_time_sample_count": int(material.get("lead_time_sample_count") or 0),
        "average_daily_outgoing_30d": average_daily_outgoing_30d,
        "days_of_stock_30d": days_of_stock_30d,
        "reorder_date_recent_rate": reorder_date_recent_rate,
        "last_purchase_order": {
            "date": material.get("last_purchase_order_date"),
            "number": material.get("last_purchase_order_number"),
            "estimated_delivery": material.get("last_purchase_order_estimated_delivery"),
        },
        "purchase_orders": material.get("purchase_orders") or [],
        "generated_at": datetime.utcnow().isoformat(),
    }


def get_material_dashboard_cost_centers(
    settings: Settings,
    *,
    session: Session | None = None,
    force_refresh: bool = False,
) -> dict:
    return _load_material_dashboard_cache(
        session,
        cache_kind=MATERIAL_DASHBOARD_CACHE_KIND_CECOS,
        cache_key=_dashboard_cache_key({"scope": "all"}),
        ttl=MATERIAL_DASHBOARD_CACHE_TTL_CECOS,
        loader=lambda: {"cecos": get_cost_centers(settings)},
        force_refresh=force_refresh,
    )


def get_material_dashboard_history(
    settings: Settings,
    sku: str,
    *,
    session: Session | None = None,
    history_days: int = 90,
    start_date: date | None = None,
    end_date: date | None = None,
    cost_centers: list[str] | None = None,
    excluded_cost_centers: list[str] | None = None,
    force_refresh: bool = False,
) -> dict:
    normalized_sku = sku.strip().upper()
    normalized_cost_centers = _normalize_dashboard_cost_centers(cost_centers)
    normalized_excluded_cost_centers = _normalize_dashboard_cost_centers(excluded_cost_centers)
    cache_key = _dashboard_cache_key(
        {
            "cecos": normalized_cost_centers,
            "excluded_cecos": normalized_excluded_cost_centers,
            "history_days": max(int(history_days), 1),
            "sku": normalized_sku,
            "start_date": start_date.isoformat() if start_date else None,
            "end_date": end_date.isoformat() if end_date else None,
        }
    )

    def loader() -> dict:
        return _build_material_dashboard_history(
            settings,
            normalized_sku,
            history_days=max(int(history_days), 1),
            start_date=start_date,
            end_date=end_date,
            cost_centers=normalized_cost_centers,
            excluded_cost_centers=normalized_excluded_cost_centers,
        )

    return _load_material_dashboard_cache(
        session,
        cache_kind=MATERIAL_DASHBOARD_CACHE_KIND_HISTORY,
        cache_key=cache_key,
        ttl=MATERIAL_DASHBOARD_CACHE_TTL_HISTORY,
        loader=loader,
        force_refresh=force_refresh,
    )


def _build_material_dashboard_history(
    settings: Settings,
    sku: str,
    *,
    history_days: int,
    start_date: date | None,
    end_date: date | None,
    cost_centers: list[str],
    excluded_cost_centers: list[str],
) -> dict:
    normalized_sku = sku.strip().upper()
    series = get_material_movement_history(
        settings,
        normalized_sku,
        days=history_days,
        start_day=start_date,
        end_day=end_date,
        cost_centers=cost_centers,
        excluded_cost_centers=excluded_cost_centers,
    )
    movement_details = get_material_movement_details(
        settings,
        normalized_sku,
        days=history_days,
        start_day=start_date,
        end_day=end_date,
        cost_centers=cost_centers,
        excluded_cost_centers=excluded_cost_centers,
    )
    if not series:
        fallback_end_day = end_date or datetime.utcnow().date()
        fallback_start_day = start_date or (fallback_end_day - timedelta(days=max(int(history_days), 1) - 1))
        window_days = max((fallback_end_day - fallback_start_day).days + 1, 1)
        series = [
            {
                "date": (fallback_start_day + timedelta(days=index)).isoformat(),
                "quantity": 0.0,
            }
            for index in range(window_days)
        ]
    return {
        "sku": normalized_sku,
        "movement_days": len(series),
        "ceco_filters": list(cost_centers),
        "range_start": series[0]["date"] if series else None,
        "range_end": series[-1]["date"] if series else None,
        "movements": series,
        "movement_details": movement_details,
        "generated_at": datetime.utcnow().isoformat(),
    }


def _load_material_dashboard_cache(
    session: Session | None,
    *,
    cache_kind: str,
    cache_key: str,
    ttl: timedelta,
    loader,
    force_refresh: bool,
):
    if session is None:
        return loader()

    now = _utcnow()
    try:
        entry = session.scalar(
            select(MaterialDashboardCacheEntry)
            .where(MaterialDashboardCacheEntry.cache_kind == cache_kind, MaterialDashboardCacheEntry.cache_key == cache_key)
        )
    except (ProgrammingError, OperationalError) as exc:
        if _is_missing_material_dashboard_cache_table(exc):
            session.rollback()
            return loader()
        if _is_material_dashboard_cache_timeout(exc):
            session.rollback()
            return loader()
        raise
    if entry is not None and not force_refresh and _cache_entry_is_fresh(entry, now):
        return _clone_cached_payload(entry.payload)

    try:
        payload = loader()
    except RuntimeError:
        if entry is not None:
            return _clone_cached_payload(entry.payload)
        raise

    if payload is None:
        return None

    if entry is None:
        entry = MaterialDashboardCacheEntry(
            cache_kind=cache_kind,
            cache_key=cache_key,
            payload={},
            expires_at=now + ttl,
        )
        session.add(entry)

    entry.payload = payload
    entry.refreshed_at = now
    entry.expires_at = now + ttl
    try:
        session.flush()
    except IntegrityError as exc:
        if _is_duplicate_material_dashboard_cache_key(exc):
            session.rollback()
            existing_entry = session.scalar(
                select(MaterialDashboardCacheEntry).where(
                    MaterialDashboardCacheEntry.cache_kind == cache_kind,
                    MaterialDashboardCacheEntry.cache_key == cache_key,
                )
            )
            if existing_entry is not None:
                return _clone_cached_payload(existing_entry.payload)
            return _clone_cached_payload(payload)
        raise
    except (ProgrammingError, OperationalError) as exc:
        if _is_missing_material_dashboard_cache_table(exc):
            session.rollback()
            return _clone_cached_payload(payload)
        if _is_material_dashboard_cache_timeout(exc):
            session.rollback()
            return _clone_cached_payload(payload)
        raise
    return _clone_cached_payload(payload)


def _cache_entry_is_fresh(entry: MaterialDashboardCacheEntry, now: datetime) -> bool:
    expires_at = entry.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    return expires_at > now


def _clone_cached_payload(payload: dict) -> dict:
    return json.loads(json.dumps(payload))


def _is_duplicate_material_dashboard_cache_key(exc: IntegrityError) -> bool:
    message = str(exc).lower()
    return (
        "duplicate key value violates unique constraint" in message
        and "material_dashboard_cache_entries_cache_kind_cache_key_key" in message
    )


def _dashboard_cache_key(parts: dict[str, object]) -> str:
    serialized = json.dumps(
        {
            "parts": parts,
            "version": MATERIAL_DASHBOARD_CACHE_VERSION,
        },
        sort_keys=True,
        separators=(",", ":"),
    )
    if len(serialized) <= MATERIAL_DASHBOARD_CACHE_KEY_MAX_LENGTH:
        return serialized

    return json.dumps(
        {
            "key_hash": hashlib.sha256(serialized.encode("utf-8")).hexdigest(),
            "version": MATERIAL_DASHBOARD_CACHE_VERSION,
        },
        sort_keys=True,
        separators=(",", ":"),
    )


def _normalize_dashboard_cost_centers(cost_centers: list[str] | None) -> list[str]:
    return sorted({str(value).strip() for value in cost_centers or [] if value is not None and str(value).strip()})


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _is_missing_material_dashboard_cache_table(exc: Exception) -> bool:
    message = str(getattr(exc, "orig", exc)).lower()
    return "material_dashboard_cache_entries" in message and (
        "does not exist" in message
        or "undefinedtable" in message
        or "no such table" in message
    )


def _is_material_dashboard_cache_timeout(exc: Exception) -> bool:
    message = str(getattr(exc, "orig", exc)).lower()
    return "material_dashboard_cache_entries" in message and (
        "statement timeout" in message
        or "querycanceled" in message
        or "canceling statement due to statement timeout" in message
        or "lock timeout" in message
    )


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


def _add_business_days(start_day: date, offset: int) -> date:
    current_day = start_day
    while current_day.weekday() >= 5:
        current_day += timedelta(days=1)

    remaining = max(int(offset), 0)
    while remaining > 0:
        current_day += timedelta(days=1)
        if current_day.weekday() < 5:
            remaining -= 1
    return current_day


def _coerce_float(value: object) -> float | None:
    if value is None:
        return None
    try:
        return round(float(value), 2)
    except (TypeError, ValueError):
        return None


def _dashboard_bom_value_state(value: float | None) -> str:
    if value is None:
        return "blank"
    if value == 0:
        return "zero"
    return "value"


def _dashboard_bom_calculation_explanation(entry: ProjectBomEntry) -> str | None:
    if entry.calculation_mode.value == "auto" and entry.calculation_formula:
        return f"Q_fábrica calculada automáticamente con la fórmula {entry.calculation_formula}"
    if entry.calculation_mode.value == "manual":
        return "Q_fábrica sobrescrita manualmente"
    return None
