from __future__ import annotations

import hashlib
import json
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from typing import Any, Iterable, Mapping, Sequence

from sqlalchemy import select, text
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session, selectinload

from app.models import (
    ProductionHouseLink,
    ProductionHouseTypeLink,
    Project,
    ProjectBomEntry,
    ProjectInstance,
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

# Synchronizing a Production II snapshot is shared work. Dashboard requests run
# concurrently, so only one of them should write the snapshot at a time.
_PRODUCTION_HOUSE_LINKS_SYNC_LOCK_ID = 7_341_889_247


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


def load_production_house_links(session: Session) -> list[ProductionHouseLink]:
    return list(
        session.scalars(
            select(ProductionHouseLink)
            .options(
                selectinload(ProductionHouseLink.project),
                selectinload(ProductionHouseLink.project_subtype),
            )
            .order_by(
                ProductionHouseLink.start_date.desc().nullslast(),
                ProductionHouseLink.planned_start_date.asc().nullslast(),
                ProductionHouseLink.planned_sequence.asc().nullslast(),
                ProductionHouseLink.production_work_order_id,
            )
        ).all()
    )


def load_production_house_links_by_work_order(
    session: Session,
    work_order_ids: Iterable[int] | None = None,
) -> dict[int, ProductionHouseLink]:
    statement = select(ProductionHouseLink).options(
        selectinload(ProductionHouseLink.project),
        selectinload(ProductionHouseLink.project_subtype),
    )
    if work_order_ids is not None:
        normalized_ids = {int(value) for value in work_order_ids}
        if not normalized_ids:
            return {}
        statement = statement.where(ProductionHouseLink.production_work_order_id.in_(normalized_ids))
    return {
        link.production_work_order_id: link
        for link in session.scalars(statement).all()
    }


def _coerce_production_date(value: Any) -> date | None:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    return date.fromisoformat(str(value)[:10])


def sync_production_house_links(
    session: Session,
    houses: Sequence[Mapping[str, Any]],
) -> list[ProductionHouseLink]:
    """Upsert Production II work-order snapshots and default only new houses.

    Existing type/subtype rules are imported as legacy mappings. A new house
    is automatically mapped only when every previously observed house of the
    same Production II type is mapped to the exact same local project/subtype
    and at least one of those mappings was verified manually.
    """

    observed_by_id = {
        int(house.get("work_order_id") or 0): house
        for house in houses
        if int(house.get("work_order_id") or 0) > 0
    }
    if not observed_by_id:
        return []

    existing_links = load_production_house_links(session)
    existing_by_id = {link.production_work_order_id: link for link in existing_links}
    prior_by_type: dict[int, list[ProductionHouseLink]] = defaultdict(list)
    for link in existing_links:
        prior_by_type[link.production_house_type_id].append(link)

    # The old type/subtype rules are a one-time bootstrap for the production
    # history that exists when this table is first populated. Once any house
    # snapshots exist, genuinely new work orders use only the consensus rule.
    legacy_by_key = (
        build_links_by_key(load_house_type_links(session))
        if not existing_links
        else {}
    )
    now = datetime.now(timezone.utc)
    new_links: list[ProductionHouseLink] = []

    for work_order_id, house in observed_by_id.items():
        link = existing_by_id.get(work_order_id)
        is_new = link is None
        if is_new:
            link = ProductionHouseLink(production_work_order_id=work_order_id)
            session.add(link)
            existing_by_id[work_order_id] = link
            new_links.append(link)

        snapshot_changed = is_new

        snapshot_values: dict[str, Any] = {
            "production_project_name": str(house.get("production_project_name") or ""),
            "house_identifier": str(house.get("house_identifier") or "").strip() or None,
            "production_house_type_id": int(house.get("house_type_id") or 0),
            "production_house_type_name": str(house.get("house_type_name") or ""),
        }
        subtype_raw = house.get("sub_type_id")
        snapshot_values["production_sub_type_id"] = int(subtype_raw) if subtype_raw is not None else None
        snapshot_values["production_sub_type_name"] = str(house.get("sub_type_name") or "").strip() or None
        planned_date = _coerce_production_date(house.get("planned_start_date"))
        if planned_date is not None or link.planned_start_date is None:
            snapshot_values["planned_start_date"] = planned_date
        sequence_raw = house.get("planned_sequence")
        if sequence_raw is not None or link.planned_sequence is None:
            snapshot_values["planned_sequence"] = int(sequence_raw) if sequence_raw is not None else None
        start_value = house.get("start_date")
        if start_value is not None:
            snapshot_values["start_date"] = _coerce_production_date(start_value)

        for attribute, value in snapshot_values.items():
            if getattr(link, attribute) != value:
                setattr(link, attribute, value)
                snapshot_changed = True
        # Avoid turning every dashboard read into an UPDATE of every house.
        # This timestamp now advances when the persisted snapshot actually
        # changes (and is initialized for every newly observed house).
        if snapshot_changed:
            link.last_seen_at = now

    for link in new_links:
        legacy = resolve_house_type_link(
            legacy_by_key,
            link.production_house_type_id,
            link.production_sub_type_id,
        )
        if legacy is not None:
            link.project_id = legacy.project_id
            link.project_subtype_id = legacy.project_subtype_id
            link.mapping_source = "legacy"
            continue

        prior = prior_by_type.get(link.production_house_type_id, [])
        if not prior or any(row.project_id is None for row in prior):
            continue
        targets = {(row.project_id, row.project_subtype_id) for row in prior}
        manually_verified = any(row.mapping_source == "manual" for row in prior)
        if len(targets) != 1 or not manually_verified:
            continue
        project_id, project_subtype_id = next(iter(targets))
        link.project_id = project_id
        link.project_subtype_id = project_subtype_id
        link.mapping_source = "automatic"

    session.flush()
    return [existing_by_id[work_order_id] for work_order_id in observed_by_id]


def ensure_production_house_links_initialized(
    session: Session,
    settings: Any,
) -> None:
    """Bootstrap the legacy history from a full Production II snapshot once."""

    if session.scalar(select(ProductionHouseLink.id).limit(1)) is not None:
        return
    # Local import avoids coupling this persistence module to the external
    # production query module during application import.
    from app.services.production_dashboard import get_production_houses

    production = get_production_houses(settings)
    sync_production_house_links(session, production["houses"])


def refresh_production_house_links(
    session: Session,
    settings: Any,
    houses: Sequence[Mapping[str, Any]],
    *,
    full_snapshot: bool = False,
) -> bool:
    """Persist a Production II snapshot in a short, serialized transaction.

    Dashboard calculations can safely call this helper concurrently. On
    PostgreSQL, one request performs the refresh while the others immediately
    continue with the last committed snapshot instead of waiting on row locks.
    The caller's longer calculation transaction never owns the sync locks.
    """

    bind = session.get_bind()
    if bind.dialect.name != "postgresql":
        if not full_snapshot:
            ensure_production_house_links_initialized(session, settings)
        sync_production_house_links(session, houses)
        session.commit()
        return True

    # End any read transaction opened earlier in the request. Reusing this
    # session avoids checking out a second pooled connection while every
    # concurrent dashboard request may already hold one.
    session.commit()
    try:
        acquired = bool(
            session.scalar(
                text("SELECT pg_try_advisory_xact_lock(:lock_id)"),
                {"lock_id": _PRODUCTION_HOUSE_LINKS_SYNC_LOCK_ID},
            )
        )
        if not acquired:
            session.commit()
            return False

        # A manual mapping can briefly touch one of the same rows. Bound that
        # wait so a refresh falls back to the committed snapshot instead of
        # consuming the application's broader statement timeout.
        session.execute(text("SET LOCAL lock_timeout = '1s'"))
        if not full_snapshot:
            ensure_production_house_links_initialized(session, settings)
        sync_production_house_links(session, houses)
        session.commit()
        session.expire_all()
        return True
    except OperationalError as exc:
        session.rollback()
        message = str(exc).lower()
        if "lock timeout" in message or "canceling statement due to" in message:
            return False
        raise


def serialize_production_house_link(
    link: ProductionHouseLink,
    expected_maps: Mapping[int, Mapping[str, Any]] | None = None,
) -> dict[str, Any]:
    missing_count = (
        link_missing_quantity_count(link, expected_maps or {})
        if link.project_id is not None
        else 0
    )
    return {
        "id": link.id,
        "work_order_id": link.production_work_order_id,
        "production_project_name": link.production_project_name,
        "house_identifier": link.house_identifier,
        "house_type_id": link.production_house_type_id,
        "house_type_name": link.production_house_type_name,
        "sub_type_id": link.production_sub_type_id,
        "sub_type_name": link.production_sub_type_name,
        "planned_start_date": link.planned_start_date.isoformat() if link.planned_start_date else None,
        "planned_sequence": link.planned_sequence,
        "start_date": link.start_date.isoformat() if link.start_date else None,
        "lifecycle_status": "started" if link.start_date is not None else "planned",
        "mapped": link.project_id is not None,
        "mapped_project_id": link.project_id,
        "mapped_project_name": link.project.name if link.project else None,
        "mapped_project_subtype_id": link.project_subtype_id,
        "mapped_project_subtype_name": link.project_subtype.name if link.project_subtype else None,
        "mapping_source": link.mapping_source if link.project_id is not None else None,
        "mapping_issue": "incomplete_bom" if link.project_id is not None and missing_count > 0 else None,
        "missing_quantity_count": missing_count,
        "updated_at": link.updated_at.isoformat() if link.updated_at else None,
    }


def bulk_assign_production_houses(
    session: Session,
    *,
    work_order_ids: Sequence[int],
    project_id: int | None,
    project_subtype_id: int | None,
    user: User | None = None,
) -> list[ProductionHouseLink]:
    normalized_ids = list(dict.fromkeys(int(value) for value in work_order_ids if int(value) > 0))
    if not normalized_ids:
        raise ValueError("Select at least one house")

    links_by_id = load_production_house_links_by_work_order(session, normalized_ids)
    if len(links_by_id) != len(normalized_ids):
        raise ValueError("One or more selected houses are no longer available")

    if project_id is None:
        if project_subtype_id is not None:
            raise ValueError("A subtype cannot be selected without a type")
    else:
        project = session.scalar(
            select(Project)
            .where(Project.id == int(project_id))
            .options(selectinload(Project.subtypes))
        )
        if project is None:
            raise ValueError(f"Project {project_id} not found")
        if project_subtype_id is not None:
            subtype_ids = {subtype.id for subtype in selectable_subtypes(project)}
            if int(project_subtype_id) not in subtype_ids:
                raise ValueError(
                    f"Subtype {project_subtype_id} does not belong to project {project.name} or is only a group"
                )

    for work_order_id in normalized_ids:
        link = links_by_id[work_order_id]
        link.project_id = int(project_id) if project_id is not None else None
        link.project_subtype_id = int(project_subtype_id) if project_subtype_id is not None else None
        link.mapping_source = "manual" if project_id is not None else None
        link.updated_by_user_id = user.id if user is not None else None

    session.flush()
    return [links_by_id[work_order_id] for work_order_id in normalized_ids]


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
    """Stable digest of individual-house mappings for dependent cache keys."""
    parts = [
        (
            link.production_work_order_id,
            link.project_id,
            link.project_subtype_id,
            link.mapping_source,
        )
        for link in session.scalars(select(ProductionHouseLink)).all()
    ]
    serialized = json.dumps(sorted(parts, key=lambda part: part[0]), separators=(",", ":"))
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
            selectinload(Project.bom_entries).selectinload(ProjectBomEntry.instance).selectinload(ProjectInstance.category),
            selectinload(Project.bom_entries).selectinload(ProjectBomEntry.instance).selectinload(ProjectInstance.component),
            selectinload(Project.subtypes).selectinload(ProjectSubtype.parent),
            selectinload(Project.material_occurrence_modes),
        )
    ).all()
    return {project.id: build_project_expected_quantity_map(project) for project in projects}


def linked_projects_bom_fingerprint(session: Session) -> str:
    project_ids = {
        int(project_id)
        for project_id in session.scalars(select(ProductionHouseLink.project_id)).all()
        if project_id is not None
    }
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


def study_instance_breakdown_for_link(
    link: ProductionHouseTypeLink | Mapping[str, Any],
    expected_maps: Mapping[int, Mapping[str, Any]],
    sku_factors: Mapping[str, float],
) -> list[dict[str, Any]]:
    """Return the selected study quantity per app project instance."""

    project_id = int(link["project_id"] if isinstance(link, Mapping) else link.project_id)
    project_subtype_id = link.get("project_subtype_id") if isinstance(link, Mapping) else link.project_subtype_id
    expected_map = expected_maps.get(project_id, {})
    instance_quantities = expected_map.get("instance_quantities", {})
    sources = list(instance_quantities.get("general", []))
    if project_subtype_id is not None:
        by_subtype = instance_quantities.get("by_subtype", {})
        sources.extend(by_subtype.get(project_subtype_id, by_subtype.get(str(project_subtype_id), [])))

    normalized_factors = {
        str(sku).strip().upper(): float(factor)
        for sku, factor in sku_factors.items()
        if str(sku).strip() and float(factor or 0.0) != 0.0
    }
    by_instance: dict[int, dict[str, Any]] = {}
    for source in sources:
        quantities = source.get("quantities", {})
        matched = False
        contribution = 0.0
        for sku, factor in normalized_factors.items():
            if sku not in quantities:
                continue
            matched = True
            contribution += float(quantities.get(sku) or 0.0) * factor
        if not matched:
            continue

        instance_id = int(source["instance_id"])
        row = by_instance.setdefault(
            instance_id,
            {
                "instance_id": instance_id,
                "instance_name": str(source.get("instance_name") or ""),
                "category_name": source.get("category_name"),
                "component_name": source.get("component_name"),
                "quantity": 0.0,
            },
        )
        row["quantity"] += contribution

    return [
        {
            **row,
            "quantity": round(float(row["quantity"]), 4),
        }
        for row in sorted(
            by_instance.values(),
            key=lambda item: (
                (item["category_name"] or "").lower(),
                (item["instance_name"] or "").lower(),
                item["instance_id"],
            ),
        )
    ]


def build_mapped_house_comparison(
    *,
    movements: Sequence[Mapping[str, Any]],
    start_grid: Sequence[Mapping[str, Any]],
    links_by_key: Mapping[Any, Any],
    expected_maps: Mapping[int, Mapping[str, Any]],
    sku_factors: Mapping[str, float],
    start_day: date,
    end_day: date,
) -> dict[str, Any]:
    """Aggregate all produced houses in the window against actual movements.

    ``start_grid`` rows look like {"date": iso_str, "house_type_id": int,
    "sub_type_id": int | None, "house_type_name": str, "sub_type_name":
    str | None, "house_starts": int}. Expected consumption counts every house
    that resolves to a link, including links whose BOM still has undefined
    quantities: those contribute the quantities defined so far and are reported
    in ``partial_summary`` so the UI can warn that the figure is a lower bound.
    Houses with no link, or with a persisted link whose project is undefined,
    contribute nothing and land in ``unmapped_summary``."""

    normalized_factors = {
        str(sku).strip().upper(): float(factor)
        for sku, factor in sku_factors.items()
        if str(sku).strip() and float(factor or 0.0) != 0.0
    }

    per_house_quantity_cache: dict[tuple[int, int | None], float] = {}
    instance_breakdown_cache: dict[tuple[int, int | None], list[dict[str, Any]]] = {}
    starts_by_day: dict[str, dict[str, float]] = defaultdict(
        lambda: {
            "house_starts": 0,
            "mapped_house_starts": 0,
            "partial_house_starts": 0,
            "expected_quantity": 0.0,
        }
    )
    expected_breakdown_by_day: dict[str, dict[tuple[Any, ...], dict[str, Any]]] = defaultdict(dict)
    unmapped_by_key: dict[LinkKey, dict[str, Any]] = {}
    partial_by_key: dict[tuple[Any, ...], dict[str, Any]] = {}
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

        work_order_raw = row.get("work_order_id")
        link = (
            links_by_key.get(int(work_order_raw))
            if work_order_raw is not None
            else resolve_house_type_link(links_by_key, house_type_id, sub_type_id)
        )
        source_key: LinkKey = (house_type_id, sub_type_id)
        project_id_raw = (
            link.get("project_id")
            if isinstance(link, Mapping)
            else link.project_id
        ) if link is not None else None
        if project_id_raw is None:
            summary = unmapped_by_key.setdefault(
                source_key,
                {
                    "house_type_id": house_type_id,
                    "house_type_name": str(row.get("house_type_name") or ""),
                    "sub_type_id": sub_type_id,
                    "sub_type_name": row.get("sub_type_name"),
                    "house_starts": 0,
                    "reason": "unmapped",
                    "missing_quantity_count": 0,
                },
            )
            summary["house_starts"] += count
            continue

        project_id = int(project_id_raw)
        project_subtype_raw = (
            link.get("project_subtype_id")
            if isinstance(link, Mapping)
            else link.project_subtype_id
        )
        project_subtype_id = int(project_subtype_raw) if project_subtype_raw is not None else None
        actual_key = (house_type_id, sub_type_id, project_id, project_subtype_id)

        # A link with undefined quantities still describes part of the house:
        # sum what is defined and flag the gap instead of dropping the house.
        missing_count = link_missing_quantity_count(link, expected_maps)
        if missing_count > 0:
            partial = partial_by_key.setdefault(
                actual_key,
                {
                    "house_type_id": house_type_id,
                    "house_type_name": str(row.get("house_type_name") or ""),
                    "sub_type_id": sub_type_id,
                    "sub_type_name": row.get("sub_type_name"),
                    "house_starts": 0,
                    "reason": "incomplete_bom",
                    "missing_quantity_count": missing_count,
                },
            )
            partial["house_starts"] += count

        resolved_key = (project_id, project_subtype_id)
        if resolved_key not in per_house_quantity_cache:
            per_house_quantity_cache[resolved_key] = study_quantity_for_link(
                link, expected_maps, normalized_factors
            )
        expected_per_house = per_house_quantity_cache[resolved_key]
        expected_map = expected_maps.get(project_id)
        project_name = ""
        if expected_map is not None:
            project_name = str(expected_map.get("project_name") or "")
            mapped_projects[project_id] = project_name
        resolved_key = (project_id, project_subtype_id)
        if resolved_key not in instance_breakdown_cache:
            instance_breakdown_cache[resolved_key] = study_instance_breakdown_for_link(
                link,
                expected_maps,
                normalized_factors,
            )
        bucket["mapped_house_starts"] += count
        if missing_count > 0:
            bucket["partial_house_starts"] += count
        expected_quantity = expected_per_house * count
        bucket["expected_quantity"] += expected_quantity

        mapped_project_subtype_name = None
        if expected_map is not None and project_subtype_id is not None:
            mapped_project_subtype_name = expected_map.get("subtype_paths", {}).get(project_subtype_id)

        breakdown = expected_breakdown_by_day[day_key].setdefault(
            resolved_key,
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
                "mapped_project_subtype_id": project_subtype_id,
                "mapped_project_subtype_name": mapped_project_subtype_name,
                "instance_breakdown": instance_breakdown_cache[resolved_key],
                "missing_quantity_count": missing_count,
            },
        )
        breakdown["house_starts"] += count
        breakdown["total_expected_material_quantity"] += expected_quantity
        breakdown["missing_quantity_count"] = max(int(breakdown["missing_quantity_count"]), missing_count)

    movement_by_day = {
        str(point.get("date")): round(float(point.get("quantity") or 0.0), 4) for point in movements
    }

    window_days = max((end_day - start_day).days + 1, 1)
    points: list[dict[str, Any]] = []
    cumulative_material = 0.0
    cumulative_house_starts = 0
    cumulative_mapped_house_starts = 0
    cumulative_partial_house_starts = 0
    cumulative_expected = 0.0
    total_expected_breakdown: dict[tuple[int, int | None], dict[str, Any]] = {}
    latest_house_start_date: str | None = None
    for offset in range(window_days):
        current_day = start_day + timedelta(days=offset)
        day_key = current_day.isoformat()
        material_quantity = movement_by_day.get(day_key, 0.0)
        bucket = starts_by_day.get(
            day_key,
            {"house_starts": 0, "mapped_house_starts": 0, "partial_house_starts": 0, "expected_quantity": 0.0},
        )
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
            key=lambda row: (
                -int(row["house_starts"]),
                row.get("mapped_project_name") or row["house_type_name"],
                row.get("mapped_project_subtype_name") or "",
            )
        )
        house_starts = int(bucket["house_starts"])
        if house_starts > 0:
            latest_house_start_date = day_key
        cumulative_material += material_quantity
        cumulative_house_starts += house_starts
        cumulative_mapped_house_starts += int(bucket["mapped_house_starts"])
        cumulative_partial_house_starts += int(bucket["partial_house_starts"])
        cumulative_expected += float(bucket["expected_quantity"])
        points.append(
            {
                "date": day_key,
                "material_quantity": round(material_quantity, 4),
                "house_starts": house_starts,
                "mapped_house_starts": int(bucket["mapped_house_starts"]),
                "partial_house_starts": int(bucket["partial_house_starts"]),
                "expected_material_quantity": round(float(bucket["expected_quantity"]), 4),
                "cumulative_material_quantity": round(cumulative_material, 4),
                "cumulative_house_starts": cumulative_house_starts,
                "cumulative_mapped_house_starts": cumulative_mapped_house_starts,
                "cumulative_partial_house_starts": cumulative_partial_house_starts,
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
    total_partial_house_starts = cumulative_partial_house_starts
    total_expected = round(cumulative_expected, 4)
    unmapped_summary = sorted(
        unmapped_by_key.values(),
        key=lambda row: (-int(row["house_starts"]), row["house_type_name"], row["sub_type_name"] or ""),
    )
    partial_summary = sorted(
        partial_by_key.values(),
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
        key=lambda row: (
            -int(row["house_starts"]),
            row.get("mapped_project_name") or row["house_type_name"],
            row.get("mapped_project_subtype_name") or "",
        ),
    )

    return {
        "movement_days": window_days,
        "range_start": start_day.isoformat(),
        "range_end": end_day.isoformat(),
        "total_material_quantity": total_material_quantity,
        "total_house_starts": total_house_starts,
        "total_mapped_house_starts": total_mapped_house_starts,
        "total_unmapped_house_starts": total_house_starts - total_mapped_house_starts,
        "total_partial_house_starts": total_partial_house_starts,
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
        "partial_summary": partial_summary,
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
