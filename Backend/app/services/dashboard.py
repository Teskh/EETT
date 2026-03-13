from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.config import Settings
from app.models import ErpMaterialCache, Project, ProjectBomEntry, ProjectInstance
from app.services.erp import (
    get_cost_centers,
    get_material_movement_history,
    get_material_procurement_details,
    get_recent_movement_materials,
)


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


def get_recent_material_dashboard(
    settings: Settings,
    *,
    movement_days: int = 60,
    cost_centers: list[str] | None = None,
) -> dict:
    rows = get_recent_movement_materials(
        settings,
        days=movement_days,
        cost_centers=cost_centers or [],
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
        "ceco_filters": list(cost_centers or []),
        "generated_at": datetime.utcnow().isoformat(),
    }


def get_material_dashboard_detail(
    settings: Settings,
    sku: str,
    *,
    cost_centers: list[str] | None = None,
) -> dict | None:
    normalized_sku = sku.strip().upper()
    if not normalized_sku:
        return None

    material = get_material_procurement_details(
        settings,
        normalized_sku,
        cost_centers=cost_centers or [],
    )
    if material is None:
        return None

    today = datetime.utcnow().date()
    movement_quantity_30d = float(material.get("movement_quantity_30d") or 0.0)
    stock_on_hand = _coerce_float(material.get("stock_on_hand"))
    lead_time_reference = _coerce_float(material.get("max_lead_time_days")) or _coerce_float(material.get("average_lead_time_days"))
    average_daily_outgoing_30d = round(movement_quantity_30d / 30, 2) if movement_quantity_30d > 0 else 0.0
    days_of_stock_30d = None
    reorder_date_recent_rate = None
    if stock_on_hand is not None and average_daily_outgoing_30d > 0:
        days_of_stock_30d = round(stock_on_hand / average_daily_outgoing_30d, 1)
        if lead_time_reference and lead_time_reference > 0:
            reorder_in_days = max(int(round(days_of_stock_30d - lead_time_reference)), 0)
            reorder_date_recent_rate = (today + timedelta(days=reorder_in_days)).isoformat()

    return {
        "sku": normalized_sku,
        "material_name": material["material_name"],
        "unit": material.get("unit"),
        "movement_quantity_30d": movement_quantity_30d,
        "stock_on_hand": stock_on_hand,
        "pending_purchase_quantity": _coerce_float(material.get("pending_purchase_quantity")),
        "average_price": _coerce_float(material.get("average_price")),
        "average_lead_time_days": _coerce_float(material.get("average_lead_time_days")),
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
        "generated_at": datetime.utcnow().isoformat(),
    }


def get_material_dashboard_cost_centers(settings: Settings) -> dict:
    return {"cecos": get_cost_centers(settings)}


def get_material_dashboard_history(
    settings: Settings,
    sku: str,
    *,
    history_days: int = 90,
    cost_centers: list[str] | None = None,
) -> dict:
    normalized_sku = sku.strip().upper()
    series = get_material_movement_history(
        settings,
        normalized_sku,
        days=history_days,
        cost_centers=cost_centers or [],
    )
    if not series:
        end_day = datetime.utcnow().date()
        start_day = end_day - timedelta(days=max(int(history_days), 1) - 1)
        series = [
            {
                "date": (start_day + timedelta(days=index)).isoformat(),
                "quantity": 0.0,
            }
            for index in range(max(int(history_days), 1))
        ]
    return {
        "sku": normalized_sku,
        "movement_days": max(int(history_days), 1),
        "ceco_filters": list(cost_centers or []),
        "range_start": series[0]["date"] if series else None,
        "range_end": series[-1]["date"] if series else None,
        "movements": series,
        "generated_at": datetime.utcnow().isoformat(),
    }


def _coerce_float(value: object) -> float | None:
    if value is None:
        return None
    try:
        return round(float(value), 2)
    except (TypeError, ValueError):
        return None
