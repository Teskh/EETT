from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timezone
from math import isfinite

from sqlalchemy.orm import Session

from app.config import Settings
from app.services.dashboard import get_recent_material_dashboard, get_production_house_starts_with_links_and_maps
from app.services.house_type_links import expected_quantities_for_link

# Unlinked houses consume material without adding to the allocation basis, so
# their consumption is spread over the linked houses. A small share only
# overstates the reference slightly; beyond it the reference is withheld.
MAX_UNMAPPED_SHARE = 0.05


def build_cost_model_history(*, project_id: int, subtype_id: int | None, production: dict,
                             expected_maps: dict, materials: list[dict]) -> dict:
    """Allocate shared SKU consumption by the original BOM of all started houses.

    This is a reference, not measured consumption per subtype. Budget overrides
    never enter the allocation, so adopting a reference cannot change it.
    """
    houses = production["houses"]
    sample = [h for h in houses if h.get("mapped") and h.get("mapped_project_id") == project_id
              and h.get("mapped_project_subtype_id") == subtype_id]
    unmapped = sum(not h.get("mapped") for h in houses)
    incomplete = sum(bool(h.get("missing_quantity_count")) for h in houses if h.get("mapped"))
    expected_totals: dict[str, float] = defaultdict(float)
    incomplete_skus: set[str] = set()
    unknown_completeness = False
    for house in houses:
        if not house.get("mapped"):
            continue
        expected_map = expected_maps.get(house["mapped_project_id"], {})
        if house.get("missing_quantity_count"):
            missing = expected_map.get("missing_skus_by_subtype", {}).get(house.get("mapped_project_subtype_id"))
            if missing is None:
                unknown_completeness = True
            else:
                incomplete_skus.update(missing)
        quantities = expected_quantities_for_link({
            "project_id": house["mapped_project_id"],
            "project_subtype_id": house.get("mapped_project_subtype_id"),
        }, expected_maps)
        for sku, quantity in quantities.items():
            expected_totals[sku] += quantity

    target = expected_quantities_for_link({
        "project_id": project_id, "project_subtype_id": subtype_id,
    }, expected_maps)
    movements = {str(row["sku"]).strip().upper(): row for row in materials}
    blocked = ("no_sample" if not sample else "unmapped_houses" if unmapped > MAX_UNMAPPED_SHARE * len(houses)
               else "incomplete_budgets" if unknown_completeness else None)
    references = []
    for sku, estimate in target.items():
        movement = movements.get(sku)
        actual = float(movement["movement_quantity_60d"]) if movement is not None else None
        expected = expected_totals.get(sku, 0)
        reason = blocked
        if reason is None and sku in incomplete_skus:
            reason = "incomplete_material"
        if reason is None:
            if actual is None or not isfinite(actual) or actual < 0:
                reason = "no_movements"
            elif expected <= 0 or estimate <= 0:
                reason = "no_allocation_basis"
        quantity = round(estimate * actual / expected, 6) if reason is None else None
        references.append({
            "sku": sku, "quantity_per_house": quantity, "reason": reason,
            "estimated_quantity_per_house": estimate,
            "factory_consumption": actual, "factory_expected_consumption": expected,
            "allocated_consumption": round(quantity * len(sample), 6) if quantity is not None else None,
        })
    return {
        "project_id": project_id, "subtype_id": subtype_id,
        "range_start": production["range_start"], "range_end": production["range_end"],
        "method": "bom_weighted_allocation", "sample_houses": len(sample),
        "total_houses": len(houses), "unmapped_houses": unmapped,
        "incomplete_houses": incomplete, "blocked_reason": blocked,
        "references": references, "generated_at": datetime.now(timezone.utc).isoformat(),
    }


def get_cost_model_history(settings: Settings, *, session: Session, project_id: int,
                           subtype_id: int | None, start_date: date, end_date: date) -> dict:
    if start_date > end_date:
        raise ValueError("La fecha inicial debe ser anterior a la fecha final.")
    if (end_date - start_date).days > 730:
        raise ValueError("Selecciona un período de hasta dos años.")
    production, expected_maps = get_production_house_starts_with_links_and_maps(
        settings, session=session, start_date=start_date, end_date=end_date, extra_project_ids={project_id},
    )
    if subtype_id is not None and subtype_id not in expected_maps[project_id]["subtype_paths"]:
        raise ValueError("La subtipología no pertenece al proyecto.")
    dashboard = get_recent_material_dashboard(
        settings, session=session, start_date=start_date, end_date=end_date,
        movement_days=(end_date - start_date).days + 1,
    )
    return build_cost_model_history(project_id=project_id, subtype_id=subtype_id,
                                   production=production, expected_maps=expected_maps,
                                   materials=dashboard.get("materials", []))
