from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.config import Settings
from app.models import (
    ErpMaterialCache,
    Material,
    Project,
    ProjectCostModelAdjustment,
    ProjectSubtype,
    User,
)
from app.models.entities import MaterialMode
from app.services.auth import can_view_project
from app.services.export_projection import iter_cost_model_rows
from app.services.projects import get_project_view_data, get_project_with_details


def _flatten_subtypes(nodes: list[dict[str, Any]], *, depth: int = 0) -> list[dict[str, Any]]:
    flat: list[dict[str, Any]] = []
    for node in nodes:
        flat.append(
            {
                "id": node["id"],
                "name": node["name"],
                "parent_id": node.get("parent_id"),
                "depth": depth,
            }
        )
        flat.extend(_flatten_subtypes(node.get("children", []), depth=depth + 1))
    return flat


def get_cost_model_view(
    session: Session,
    project_id: int,
    *,
    settings: Settings | None = None,
    user: User | None = None,
) -> dict[str, Any] | None:
    project = get_project_with_details(session, project_id)
    if project is None:
        return None
    if user is not None and not can_view_project(user, project):
        return None

    project_data = get_project_view_data(session, project_id, user=user)
    if project_data is None:
        return None

    adjustments = session.scalars(
        select(ProjectCostModelAdjustment)
        .where(ProjectCostModelAdjustment.project_id == project_id)
        .options(selectinload(ProjectCostModelAdjustment.created_by))
    ).all()
    adjustments_by_material: dict[int, list[ProjectCostModelAdjustment]] = defaultdict(list)
    for adjustment in adjustments:
        adjustments_by_material[adjustment.material_id].append(adjustment)

    prices_by_sku = _load_cost_model_prices(session, settings=settings, project_data=project_data)

    flat_subtypes = _flatten_subtypes(project_data.get("subtypes", []))

    rows_by_material: dict[int, dict[str, Any]] = {}
    materials_order: list[int] = []

    for row in iter_cost_model_rows(project_data):
        material_id = row.get("material_id")
        if material_id is None:
            continue
        state = row.get("quantity_state")
        if state == "zero":
            continue

        entry = rows_by_material.get(material_id)
        if entry is None:
            entry = {
                "material_id": material_id,
                "sku": row["sku"],
                "material_name": row["material_name"],
                "unit": row.get("unit") or "",
                "is_auxiliary": False,
                "price": prices_by_sku.get(str(row["sku"]).strip().upper()),
                "instances": [],
                "subtype_totals": {},  # key: subtype_id|None -> {"quantity_total":..., "has_value": bool, "has_blank": bool, "name":...}
            }
            rows_by_material[material_id] = entry
            materials_order.append(material_id)

        subtype_id = row.get("subtype_id")
        subtype_name = row.get("subtype") or "General"
        quantity_value = row.get("quantity") if state == "value" else None

        subtype_bucket = entry["subtype_totals"].setdefault(
            subtype_id,
            {
                "subtype_id": subtype_id,
                "subtype_name": subtype_name,
                "quantity_total": 0.0,
                "has_value": False,
                "has_blank": False,
            },
        )
        if state == "value" and quantity_value is not None:
            subtype_bucket["has_value"] = True
            subtype_bucket["quantity_total"] += float(quantity_value)
        elif state == "blank":
            subtype_bucket["has_blank"] = True

        entry["instances"].append(
            {
                "instance_id": row.get("instance_id"),
                "instance_name": row.get("instance_label") or row.get("instance_name"),
                "category_label": row.get("category_label"),
                "subtype_id": subtype_id,
                "subtype_name": subtype_name,
                "quantity": quantity_value,
                "quantity_state": state,
            }
        )

    serialized_rows: list[dict[str, Any]] = []
    for material_id in materials_order:
        entry = rows_by_material[material_id]
        subtypes_payload: list[dict[str, Any]] = []
        has_any_estimated = False
        estimated_sum = 0.0
        estimated_sum_is_numeric = False
        for bucket in entry["subtype_totals"].values():
            quantity: float | None
            if bucket["has_value"]:
                quantity = round(float(bucket["quantity_total"]), 6)
                estimated_sum += quantity
                estimated_sum_is_numeric = True
                has_any_estimated = True
            elif bucket["has_blank"]:
                quantity = None
                has_any_estimated = True
            else:
                continue
            subtypes_payload.append(
                {
                    "subtype_id": bucket["subtype_id"],
                    "subtype_name": bucket["subtype_name"],
                    "estimated_quantity": quantity,
                }
            )

        if not has_any_estimated and not adjustments_by_material.get(material_id):
            continue

        subtypes_payload.sort(
            key=lambda item: (
                0 if item["subtype_id"] is None else 1,
                (item["subtype_name"] or "").lower(),
            )
        )

        adjustment_rows = [
            _serialize_adjustment(adj) for adj in adjustments_by_material.get(material_id, [])
        ]

        serialized_rows.append(
            {
                "material_id": entry["material_id"],
                "sku": entry["sku"],
                "material_name": entry["material_name"],
                "unit": entry["unit"],
                "price": entry["price"],
                "estimated_total_quantity": round(estimated_sum, 6) if estimated_sum_is_numeric else None,
                "subtypes": subtypes_payload,
                "instances": entry["instances"],
                "adjustments": adjustment_rows,
                "is_auxiliary": False,
            }
        )

    for auxiliary in sorted(
        project_data.get("auxiliary_materials", []),
        key=lambda item: ((item.get("code") or ""), (item.get("name") or "")),
    ):
        code = str(auxiliary.get("code") or "").strip().upper()
        if not code:
            continue
        serialized_rows.append(
            {
                "material_id": None,
                "sku": code,
                "material_name": auxiliary.get("name") or code,
                "unit": "",
                "price": _coerce_optional_float(auxiliary.get("price")),
                "estimated_total_quantity": 1.0,
                "subtypes": [
                    {
                        "subtype_id": None,
                        "subtype_name": auxiliary.get("subtype") or "General",
                        "estimated_quantity": 1.0,
                    }
                ],
                "instances": [],
                "adjustments": [],
                "is_auxiliary": True,
            }
        )

    serialized_rows.sort(
        key=lambda item: ((item["material_name"] or "").lower(), (item["sku"] or "").lower())
    )

    return {
        "project": project_data["project"],
        "material_mode": project_data["project"].get("material_mode", MaterialMode.GENERAL.value),
        "subtypes": project_data.get("subtypes", []),
        "flat_subtypes": flat_subtypes,
        "rows": serialized_rows,
    }


def upsert_cost_model_adjustment(
    session: Session,
    *,
    project: Project,
    material_id: int,
    subtype_id: int | None,
    adjusted_quantity: float,
    source_kind: str = "manual",
    source_note: str | None = None,
    source_house_type_id: int | None = None,
    source_range_start: date | None = None,
    source_range_end: date | None = None,
    source_sample_houses: int | None = None,
    source_total_consumption: float | None = None,
    actor: User | None = None,
) -> ProjectCostModelAdjustment:
    material = session.get(Material, material_id)
    if material is None:
        raise ValueError("Material not found")

    if subtype_id is not None:
        subtype = session.get(ProjectSubtype, subtype_id)
        if subtype is None or subtype.project_id != project.id:
            raise ValueError("Subtype not found for this project")

    query = select(ProjectCostModelAdjustment).where(
        ProjectCostModelAdjustment.project_id == project.id,
        ProjectCostModelAdjustment.material_id == material_id,
    )
    if subtype_id is None:
        query = query.where(ProjectCostModelAdjustment.subtype_id.is_(None))
    else:
        query = query.where(ProjectCostModelAdjustment.subtype_id == subtype_id)

    adjustment = session.scalar(query)
    if adjustment is None:
        adjustment = ProjectCostModelAdjustment(
            project_id=project.id,
            material_id=material_id,
            subtype_id=subtype_id,
            adjusted_quantity=adjusted_quantity,
            source_kind=source_kind,
            source_note=source_note,
            source_house_type_id=source_house_type_id,
            source_range_start=source_range_start,
            source_range_end=source_range_end,
            source_sample_houses=source_sample_houses,
            source_total_consumption=source_total_consumption,
            created_by_user_id=actor.id if actor else None,
        )
        session.add(adjustment)
    else:
        adjustment.adjusted_quantity = adjusted_quantity
        adjustment.source_kind = source_kind
        adjustment.source_note = source_note
        adjustment.source_house_type_id = source_house_type_id
        adjustment.source_range_start = source_range_start
        adjustment.source_range_end = source_range_end
        adjustment.source_sample_houses = source_sample_houses
        adjustment.source_total_consumption = source_total_consumption
        if actor is not None:
            adjustment.created_by_user_id = actor.id

    session.commit()
    session.refresh(adjustment)
    return adjustment


def delete_cost_model_adjustment(
    session: Session,
    *,
    project: Project,
    material_id: int,
    subtype_id: int | None,
) -> bool:
    query = select(ProjectCostModelAdjustment).where(
        ProjectCostModelAdjustment.project_id == project.id,
        ProjectCostModelAdjustment.material_id == material_id,
    )
    if subtype_id is None:
        query = query.where(ProjectCostModelAdjustment.subtype_id.is_(None))
    else:
        query = query.where(ProjectCostModelAdjustment.subtype_id == subtype_id)

    adjustment = session.scalar(query)
    if adjustment is None:
        return False
    session.delete(adjustment)
    session.commit()
    return True


def _serialize_adjustment(adjustment: ProjectCostModelAdjustment) -> dict[str, Any]:
    return {
        "id": adjustment.id,
        "subtype_id": adjustment.subtype_id,
        "adjusted_quantity": adjustment.adjusted_quantity,
        "source_kind": adjustment.source_kind,
        "source_note": adjustment.source_note,
        "source_house_type_id": adjustment.source_house_type_id,
        "source_range_start": adjustment.source_range_start.isoformat() if adjustment.source_range_start else None,
        "source_range_end": adjustment.source_range_end.isoformat() if adjustment.source_range_end else None,
        "source_sample_houses": adjustment.source_sample_houses,
        "source_total_consumption": adjustment.source_total_consumption,
        "updated_at": adjustment.updated_at.isoformat() if adjustment.updated_at else None,
        "created_by": adjustment.created_by.display_name if adjustment.created_by else None,
    }


def _load_cost_model_prices(
    session: Session,
    *,
    settings: Settings | None,
    project_data: dict[str, Any],
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
        for cache in session.scalars(select(ErpMaterialCache)).all()
        if cache.sku
    }
    price_map = {sku: prices.get(sku) for sku in unique_skus}

    if settings is None or not erp_search_available(settings):
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


def _coerce_optional_float(value: Any) -> float | None:
    if value in (None, ""):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None
