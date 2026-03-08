from __future__ import annotations

from collections import defaultdict

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models import ErpMaterialCache, Project, ProjectBomEntry, ProjectInstance


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
