from __future__ import annotations

import hashlib
import json
from collections import defaultdict
from datetime import date, timedelta
from typing import Any, Iterable, Mapping, Sequence

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models import (
    ProductionHouseTypeLink,
    Project,
    ProjectBomEntry,
    ProjectStatus,
    ProjectSubtype,
    User,
)
from app.services.effective_bom import (
    build_project_expected_quantity_map,
    project_bom_fingerprint,
    selectable_subtypes,
    subtype_path,
)

# Key used to resolve a produced house against the mapping: sub-type rows win,
# rows with production_sub_type_id None act as the house type's general mapping.
LinkKey = tuple[int, int | None]


def serialize_house_type_link(
    link: ProductionHouseTypeLink,
    expected_maps: Mapping[int, Mapping[str, Any]] | None = None,
) -> dict[str, Any]:
    expected_map = (expected_maps or {}).get(link.project_id, {})
    missing_count = int(expected_map.get("missing_by_subtype", {}).get(link.project_subtype_id, 0))
    return {
        "id": link.id,
        "production_house_type_id": link.production_house_type_id,
        "production_sub_type_id": link.production_sub_type_id,
        "production_house_type_name": link.production_house_type_name,
        "production_sub_type_name": link.production_sub_type_name,
        "project_id": link.project_id,
        "project_name": link.project.name if link.project else None,
        "project_subtype_id": link.project_subtype_id,
        "project_subtype_name": link.project_subtype.name if link.project_subtype else None,
        "updated_at": link.updated_at.isoformat() if link.updated_at else None,
        "is_complete": missing_count == 0,
        "missing_quantity_count": missing_count,
    }


def load_house_type_links(session: Session) -> list[ProductionHouseTypeLink]:
    return list(
        session.scalars(
            select(ProductionHouseTypeLink)
            .options(
                selectinload(ProductionHouseTypeLink.project),
                selectinload(ProductionHouseTypeLink.project_subtype),
            )
            .order_by(
                ProductionHouseTypeLink.production_house_type_name,
                ProductionHouseTypeLink.production_house_type_id,
                ProductionHouseTypeLink.production_sub_type_id.nullsfirst(),
            )
        ).all()
    )


def list_house_type_links(session: Session) -> list[dict[str, Any]]:
    links = load_house_type_links(session)
    expected_maps = get_project_expected_quantity_maps(session, {link.project_id for link in links})
    return [serialize_house_type_link(link, expected_maps) for link in links]


def replace_house_type_links(
    session: Session,
    links_payload: Sequence[Mapping[str, Any]],
    *,
    user: User | None = None,
) -> list[dict[str, Any]]:
    """Replace the global mapping with the given rows (the table is small and
    edited as a whole from the dashboard modal)."""

    seen_keys: set[LinkKey] = set()
    normalized_rows: list[dict[str, Any]] = []
    for raw in links_payload:
        house_type_id = int(raw.get("production_house_type_id") or 0)
        if house_type_id <= 0:
            raise ValueError("production_house_type_id is required for every link")
        sub_type_raw = raw.get("production_sub_type_id")
        sub_type_id = int(sub_type_raw) if sub_type_raw is not None else None
        key: LinkKey = (house_type_id, sub_type_id)
        if key in seen_keys:
            raise ValueError("Duplicate link for the same house type and sub type")
        seen_keys.add(key)
        project_id = int(raw.get("project_id") or 0)
        if project_id <= 0:
            raise ValueError("project_id is required for every link")
        subtype_raw = raw.get("project_subtype_id")
        normalized_rows.append(
            {
                "production_house_type_id": house_type_id,
                "production_sub_type_id": sub_type_id,
                "production_house_type_name": str(raw.get("production_house_type_name") or "").strip(),
                "production_sub_type_name": (str(raw.get("production_sub_type_name") or "").strip() or None),
                "project_id": project_id,
                "project_subtype_id": int(subtype_raw) if subtype_raw is not None else None,
            }
        )

    project_ids = {row["project_id"] for row in normalized_rows}
    projects_by_id = {
        project.id: project
        for project in session.scalars(
            select(Project).where(Project.id.in_(project_ids)).options(selectinload(Project.subtypes))
        ).all()
    }
    for row in normalized_rows:
        project = projects_by_id.get(row["project_id"])
        if project is None:
            raise ValueError(f"Project {row['project_id']} not found")
        if row["project_subtype_id"] is not None:
            subtype_ids = {subtype.id for subtype in selectable_subtypes(project)}
            if row["project_subtype_id"] not in subtype_ids:
                raise ValueError(
                    f"Subtype {row['project_subtype_id']} does not belong to project {project.name} or is only a group"
                )

    for existing in session.scalars(select(ProductionHouseTypeLink)).all():
        session.delete(existing)
    session.flush()
    for row in normalized_rows:
        session.add(
            ProductionHouseTypeLink(
                **row,
                updated_by_user_id=user.id if user is not None else None,
            )
        )
    session.flush()
    return list_house_type_links(session)


def house_type_links_fingerprint(session: Session) -> str:
    """Stable digest of the mapping state, for cache keys that depend on it."""
    parts = [
        (
            link.production_house_type_id,
            link.production_sub_type_id,
            link.project_id,
            link.project_subtype_id,
        )
        for link in session.scalars(select(ProductionHouseTypeLink)).all()
    ]
    serialized = json.dumps(sorted(parts, key=_fingerprint_part_sort_key), separators=(",", ":"))
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()[:16]


def _fingerprint_part_sort_key(part: tuple[int, int | None, int, int | None]) -> tuple[int, int, int, int, int]:
    production_house_type_id, production_sub_type_id, project_id, project_subtype_id = part
    return (
        production_house_type_id,
        0 if production_sub_type_id is None else 1,
        production_sub_type_id or 0,
        project_id,
        project_subtype_id or 0,
    )


def resolve_house_type_link(
    links_by_key: Mapping[LinkKey, ProductionHouseTypeLink | Mapping[str, Any]],
    house_type_id: int,
    sub_type_id: int | None,
):
    """Sub-type specific link first, then the house type's general link."""
    if sub_type_id is not None:
        link = links_by_key.get((house_type_id, sub_type_id))
        if link is not None:
            return link
    return links_by_key.get((house_type_id, None))


def build_links_by_key(
    links: Iterable[ProductionHouseTypeLink],
) -> dict[LinkKey, ProductionHouseTypeLink]:
    return {(link.production_house_type_id, link.production_sub_type_id): link for link in links}


def get_project_expected_quantity_maps(
    session: Session,
    project_ids: Iterable[int],
) -> dict[int, dict[str, Any]]:
    """Per-project SKU quantity maps split into the general bucket (entries
    with no subtype, common to every house) and per-subtype buckets. The
    expected consumption of a house of subtype A is general + A."""

    unique_ids = {int(project_id) for project_id in project_ids}
    if not unique_ids:
        return {}

    projects = session.scalars(
        select(Project)
        .where(Project.id.in_(unique_ids))
        .options(
            selectinload(Project.bom_entries).selectinload(ProjectBomEntry.material),
            selectinload(Project.subtypes).selectinload(ProjectSubtype.parent),
            selectinload(Project.material_occurrence_modes),
        )
    ).all()
    return {project.id: build_project_expected_quantity_map(project) for project in projects}


def linked_projects_bom_fingerprint(session: Session) -> str:
    project_ids = set(session.scalars(select(ProductionHouseTypeLink.project_id)).all())
    if not project_ids:
        return "none"
    projects = session.scalars(
        select(Project)
        .where(Project.id.in_(project_ids))
        .options(
            selectinload(Project.bom_entries).selectinload(ProjectBomEntry.material),
            selectinload(Project.subtypes).selectinload(ProjectSubtype.parent),
            selectinload(Project.material_occurrence_modes),
        )
    ).all()
    return project_bom_fingerprint(projects)


def expected_quantities_for_link(
    link: ProductionHouseTypeLink | Mapping[str, Any],
    expected_maps: Mapping[int, Mapping[str, Any]],
) -> dict[str, float]:
    """SKU quantities one produced house is expected to consume under a link:
    the project's general quantities plus, when the link targets a project
    subtype, that subtype's quantities."""

    if isinstance(link, Mapping):
        project_id = int(link["project_id"])
        project_subtype_id = link.get("project_subtype_id")
    else:
        project_id = link.project_id
        project_subtype_id = link.project_subtype_id

    expected_map = expected_maps.get(project_id)
    if expected_map is None:
        return {}
    quantities: dict[str, float] = defaultdict(float)
    for sku, quantity in expected_map.get("general", {}).items():
        quantities[sku] += quantity
    if project_subtype_id is not None:
        for sku, quantity in expected_map.get("by_subtype", {}).get(int(project_subtype_id), {}).items():
            quantities[sku] += quantity
    return dict(quantities)


def link_missing_quantity_count(
    link: ProductionHouseTypeLink | Mapping[str, Any],
    expected_maps: Mapping[int, Mapping[str, Any]],
) -> int:
    project_id = int(link["project_id"] if isinstance(link, Mapping) else link.project_id)
    subtype_id = link.get("project_subtype_id") if isinstance(link, Mapping) else link.project_subtype_id
    expected_map = expected_maps.get(project_id, {})
    return int(expected_map.get("missing_by_subtype", {}).get(subtype_id, 0))


def study_quantity_for_link(
    link: ProductionHouseTypeLink | Mapping[str, Any],
    expected_maps: Mapping[int, Mapping[str, Any]],
    sku_factors: Mapping[str, float],
) -> float:
    """Expected per-house quantity expressed in the study unit: SKU quantities
    weighted by each SKU's factor (a plain SKU study uses {sku: 1.0})."""
    total = 0.0
    for sku, quantity in expected_quantities_for_link(link, expected_maps).items():
        factor = sku_factors.get(sku)
        if factor is None:
            continue
        total += quantity * float(factor)
    return total


def build_mapped_house_comparison(
    *,
    movements: Sequence[Mapping[str, Any]],
    start_grid: Sequence[Mapping[str, Any]],
    links_by_key: Mapping[LinkKey, Any],
    expected_maps: Mapping[int, Mapping[str, Any]],
    sku_factors: Mapping[str, float],
    start_day: date,
    end_day: date,
) -> dict[str, Any]:
    """Aggregate all produced houses in the window against actual movements.

    ``start_grid`` rows look like {"date": iso_str, "house_type_id": int,
    "sub_type_id": int | None, "house_type_name": str, "sub_type_name":
    str | None, "house_starts": int}. Expected consumption counts only houses
    that resolve to a link; unmapped houses are reported separately so the UI
    can warn about them."""

    normalized_factors = {
        str(sku).strip().upper(): float(factor)
        for sku, factor in sku_factors.items()
        if str(sku).strip() and float(factor or 0.0) != 0.0
    }

    per_house_quantity_cache: dict[LinkKey, float] = {}
    starts_by_day: dict[str, dict[str, float]] = defaultdict(
        lambda: {"house_starts": 0, "mapped_house_starts": 0, "expected_quantity": 0.0}
    )
    expected_breakdown_by_day: dict[str, dict[LinkKey, dict[str, Any]]] = defaultdict(dict)
    unmapped_by_key: dict[LinkKey, dict[str, Any]] = {}
    mapped_projects: dict[int, str] = {}

    for row in start_grid:
        day_key = str(row.get("date"))
        house_type_id = int(row.get("house_type_id") or 0)
        sub_type_raw = row.get("sub_type_id")
        sub_type_id = int(sub_type_raw) if sub_type_raw is not None else None
        count = int(row.get("house_starts") or 0)
        if count <= 0:
            continue
        bucket = starts_by_day[day_key]
        bucket["house_starts"] += count

        link = resolve_house_type_link(links_by_key, house_type_id, sub_type_id)
        missing_count = link_missing_quantity_count(link, expected_maps) if link is not None else 0
        if link is None or missing_count > 0:
            key: LinkKey = (house_type_id, sub_type_id)
            summary = unmapped_by_key.setdefault(
                key,
                {
                    "house_type_id": house_type_id,
                    "house_type_name": str(row.get("house_type_name") or ""),
                    "sub_type_id": sub_type_id,
                    "sub_type_name": row.get("sub_type_name"),
                    "house_starts": 0,
                    "reason": "incomplete_bom" if missing_count > 0 else "unmapped",
                    "missing_quantity_count": missing_count,
                },
            )
            summary["house_starts"] += count
            continue

        resolved_key: LinkKey = (
            link["production_house_type_id"] if isinstance(link, Mapping) else link.production_house_type_id,
            link["production_sub_type_id"] if isinstance(link, Mapping) else link.production_sub_type_id,
        )
        if resolved_key not in per_house_quantity_cache:
            per_house_quantity_cache[resolved_key] = study_quantity_for_link(
                link, expected_maps, normalized_factors
            )
        expected_per_house = per_house_quantity_cache[resolved_key]
        project_id = int(link["project_id"] if isinstance(link, Mapping) else link.project_id)
        expected_map = expected_maps.get(project_id)
        project_name = ""
        if expected_map is not None:
            project_name = str(expected_map.get("project_name") or "")
            mapped_projects[project_id] = project_name
        bucket["mapped_house_starts"] += count
        expected_quantity = expected_per_house * count
        bucket["expected_quantity"] += expected_quantity

        actual_key: LinkKey = (house_type_id, sub_type_id)
        breakdown = expected_breakdown_by_day[day_key].setdefault(
            actual_key,
            {
                "house_type_id": house_type_id,
                "house_type_name": str(row.get("house_type_name") or ""),
                "sub_type_id": sub_type_id,
                "sub_type_name": row.get("sub_type_name"),
                "house_starts": 0,
                "expected_quantity_per_house": round(expected_per_house, 4),
                "total_expected_material_quantity": 0.0,
                "mapped_project_id": project_id,
                "mapped_project_name": project_name,
                "mapped_project_subtype_id": (
                    link["project_subtype_id"] if isinstance(link, Mapping) else link.project_subtype_id
                ),
            },
        )
        breakdown["house_starts"] += count
        breakdown["total_expected_material_quantity"] += expected_quantity

    movement_by_day = {
        str(point.get("date")): round(float(point.get("quantity") or 0.0), 4) for point in movements
    }

    window_days = max((end_day - start_day).days + 1, 1)
    points: list[dict[str, Any]] = []
    cumulative_material = 0.0
    cumulative_house_starts = 0
    cumulative_mapped_house_starts = 0
    cumulative_expected = 0.0
    total_expected_breakdown: dict[LinkKey, dict[str, Any]] = {}
    latest_house_start_date: str | None = None
    for offset in range(window_days):
        current_day = start_day + timedelta(days=offset)
        day_key = current_day.isoformat()
        material_quantity = movement_by_day.get(day_key, 0.0)
        bucket = starts_by_day.get(day_key, {"house_starts": 0, "mapped_house_starts": 0, "expected_quantity": 0.0})
        day_breakdown = []
        for actual_key, row in expected_breakdown_by_day.get(day_key, {}).items():
            rounded_row = {
                **row,
                "total_expected_material_quantity": round(float(row["total_expected_material_quantity"]), 4),
            }
            day_breakdown.append(rounded_row)
            total_row = total_expected_breakdown.setdefault(
                actual_key,
                {
                    **rounded_row,
                    "house_starts": 0,
                    "total_expected_material_quantity": 0.0,
                },
            )
            total_row["house_starts"] += int(row["house_starts"])
            total_row["total_expected_material_quantity"] += float(row["total_expected_material_quantity"])
        day_breakdown.sort(
            key=lambda row: (-int(row["house_starts"]), row["house_type_name"], row["sub_type_name"] or "")
        )
        house_starts = int(bucket["house_starts"])
        if house_starts > 0:
            latest_house_start_date = day_key
        cumulative_material += material_quantity
        cumulative_house_starts += house_starts
        cumulative_mapped_house_starts += int(bucket["mapped_house_starts"])
        cumulative_expected += float(bucket["expected_quantity"])
        points.append(
            {
                "date": day_key,
                "material_quantity": round(material_quantity, 4),
                "house_starts": house_starts,
                "mapped_house_starts": int(bucket["mapped_house_starts"]),
                "expected_material_quantity": round(float(bucket["expected_quantity"]), 4),
                "cumulative_material_quantity": round(cumulative_material, 4),
                "cumulative_house_starts": cumulative_house_starts,
                "cumulative_mapped_house_starts": cumulative_mapped_house_starts,
                "cumulative_expected_material_quantity": round(cumulative_expected, 4),
                "material_per_house": round(cumulative_material / cumulative_house_starts, 4)
                if cumulative_house_starts > 0
                else None,
                "expected_breakdown": day_breakdown,
            }
        )

    total_material_quantity = round(cumulative_material, 4)
    total_house_starts = cumulative_house_starts
    total_mapped_house_starts = cumulative_mapped_house_starts
    total_expected = round(cumulative_expected, 4)
    unmapped_summary = sorted(
        unmapped_by_key.values(),
        key=lambda row: (-int(row["house_starts"]), row["house_type_name"], row["sub_type_name"] or ""),
    )
    expected_breakdown = sorted(
        (
            {
                **row,
                "expected_quantity_per_house": round(float(row["expected_quantity_per_house"]), 4),
                "total_expected_material_quantity": round(float(row["total_expected_material_quantity"]), 4),
            }
            for row in total_expected_breakdown.values()
        ),
        key=lambda row: (-int(row["house_starts"]), row["house_type_name"], row["sub_type_name"] or ""),
    )

    return {
        "movement_days": window_days,
        "range_start": start_day.isoformat(),
        "range_end": end_day.isoformat(),
        "total_material_quantity": total_material_quantity,
        "total_house_starts": total_house_starts,
        "total_mapped_house_starts": total_mapped_house_starts,
        "total_unmapped_house_starts": total_house_starts - total_mapped_house_starts,
        "total_expected_material_quantity": total_expected,
        "material_per_house": round(total_material_quantity / total_house_starts, 4)
        if total_house_starts > 0
        else None,
        "expected_material_per_mapped_house": round(total_expected / total_mapped_house_starts, 4)
        if total_mapped_house_starts > 0
        else None,
        "expected_breakdown": expected_breakdown,
        "latest_house_start_date": latest_house_start_date,
        "mapped_projects": [
            {"project_id": project_id, "project_name": name}
            for project_id, name in sorted(mapped_projects.items(), key=lambda item: item[1].lower())
        ],
        "unmapped_summary": unmapped_summary,
        "points": points,
    }


def list_link_target_projects(session: Session) -> list[dict[str, Any]]:
    """Projects (with their subtypes) offered as mapping targets in the modal."""
    projects = session.scalars(
        select(Project)
        .where(Project.status != ProjectStatus.TEMPLATE)
        .options(selectinload(Project.subtypes).selectinload(ProjectSubtype.children))
        .order_by(Project.name)
    ).all()
    expected_maps = get_project_expected_quantity_maps(session, {project.id for project in projects})
    payload = []
    for project in projects:
        expected_map = expected_maps.get(project.id, {})
        missing_by_subtype = expected_map.get("missing_by_subtype", {})
        general_missing = int(missing_by_subtype.get(None, 0))
        payload.append(
            {
                "id": project.id,
                "name": project.name,
                "status": project.status.value,
                "general_is_complete": general_missing == 0,
                "general_missing_quantity_count": general_missing,
                "subtypes": [
                    {
                        "id": subtype.id,
                        "name": subtype_path(subtype),
                        "is_complete": int(missing_by_subtype.get(subtype.id, 0)) == 0,
                        "missing_quantity_count": int(missing_by_subtype.get(subtype.id, 0)),
                    }
                    for subtype in selectable_subtypes(project)
                ],
            }
        )
    return payload
