from __future__ import annotations

from contextlib import contextmanager
from datetime import date, datetime, timedelta
from functools import lru_cache

from sqlalchemy import text
from sqlalchemy.exc import OperationalError, SQLAlchemyError
from sqlalchemy.orm import Session, sessionmaker

from app.config import Settings
from app.database import create_session_factory


def get_material_dashboard_house_types(settings: Settings) -> dict:
    try:
        with production_session(settings) as session:
            rows = list(
                session.execute(
                    text(
                        """
                        SELECT id, name, number_of_modules
                        FROM house_types
                        ORDER BY name, id
                        """
                    )
                ).mappings()
            )
            sub_type_rows = list(
                session.execute(
                    text(
                        """
                        SELECT id, house_type_id, name
                        FROM house_sub_types
                        ORDER BY name, id
                        """
                    )
                ).mappings()
            )
    except OperationalError as exc:
        raise RuntimeError("Could not connect to the Production II database") from exc
    except SQLAlchemyError as exc:
        raise RuntimeError(f"Production II query failed: {exc.__class__.__name__}") from exc
    sub_types_by_house_type: dict[int, list[dict]] = {}
    for row in sub_type_rows:
        sub_types_by_house_type.setdefault(int(row["house_type_id"]), []).append(
            {"id": int(row["id"]), "name": str(row["name"])}
        )
    return {
        "house_types": [
            {
                "id": int(row["id"]),
                "name": str(row["name"]),
                "number_of_modules": int(row["number_of_modules"] or 0),
                "sub_types": sub_types_by_house_type.get(int(row["id"]), []),
            }
            for row in rows
        ]
    }


def get_material_dashboard_house_start_summary(
    settings: Settings,
    *,
    house_type_id: int,
    cost_centers: list[str] | None = None,
    history_days: int = 90,
    start_date: str | None = None,
    end_date: str | None = None,
) -> dict:
    context = _load_house_start_context(
        settings,
        house_type_id=house_type_id,
        history_days=history_days,
        start_date=start_date,
        end_date=end_date,
    )
    house_type = context["house_type"]
    return {
        "house_type_id": int(house_type["id"]),
        "house_type_name": str(house_type["name"]),
        "number_of_modules": int(house_type["number_of_modules"] or 0),
        "movement_days": context["window_days"],
        "ceco_filters": list(cost_centers or []),
        "range_start": context["start_day"].isoformat(),
        "range_end": context["end_day"].isoformat(),
        "total_house_starts": context["total_house_starts"],
        "latest_house_start_date": context["latest_house_start_date"],
        "generated_at": datetime.utcnow().isoformat(),
    }


def get_material_dashboard_house_start_comparison(
    settings: Settings,
    *,
    sku: str,
    movements: list[dict],
    house_type_id: int,
    cost_centers: list[str] | None = None,
    history_days: int = 90,
    start_date: str | None = None,
    end_date: str | None = None,
) -> dict:
    normalized_sku = sku.strip().upper()
    context = _load_house_start_context(
        settings,
        house_type_id=house_type_id,
        history_days=history_days,
        start_date=start_date,
        end_date=end_date,
    )
    house_type = context["house_type"]
    end_day = context["end_day"]
    start_day = context["start_day"]
    window_days = context["window_days"]

    movement_by_day = {
        str(point.get("date")): round(float(point.get("quantity") or 0.0), 4)
        for point in movements
    }
    house_starts_by_day = context["house_starts_by_day"]

    points: list[dict] = []
    cumulative_material = 0.0
    cumulative_house_starts = 0
    latest_house_start_date = context["latest_house_start_date"]
    for offset in range(window_days):
        current_day = start_day + timedelta(days=offset)
        day_key = current_day.isoformat()
        material_quantity = movement_by_day.get(day_key, 0.0)
        house_starts = house_starts_by_day.get(day_key, 0)
        cumulative_material += material_quantity
        cumulative_house_starts += house_starts
        points.append(
            {
                "date": day_key,
                "material_quantity": round(material_quantity, 4),
                "house_starts": house_starts,
                "cumulative_material_quantity": round(cumulative_material, 4),
                "cumulative_house_starts": cumulative_house_starts,
                "material_per_house": round(cumulative_material / cumulative_house_starts, 4)
                if cumulative_house_starts > 0
                else None,
            }
        )

    total_material_quantity = round(sum(point["material_quantity"] for point in points), 4)
    total_house_starts = context["total_house_starts"]

    return {
        "sku": normalized_sku,
        "house_type_id": int(house_type["id"]),
        "house_type_name": str(house_type["name"]),
        "number_of_modules": int(house_type["number_of_modules"] or 0),
        "movement_days": window_days,
        "ceco_filters": list(cost_centers or []),
        "range_start": start_day.isoformat(),
        "range_end": end_day.isoformat(),
        "total_material_quantity": total_material_quantity,
        "total_house_starts": total_house_starts,
        "material_per_house": round(total_material_quantity / total_house_starts, 4) if total_house_starts > 0 else None,
        "latest_house_start_date": latest_house_start_date,
        "points": points,
        "generated_at": datetime.utcnow().isoformat(),
    }


_ALL_HOUSE_STARTS_SQL = """
    WITH panel_events AS (
        SELECT
            wu.work_order_id AS work_order_id,
            COALESCE(ti.started_at, ti.completed_at) AS event_at
        FROM task_instances ti
        JOIN panel_units pu ON pu.id = ti.panel_unit_id
        JOIN work_units wu ON wu.id = pu.work_unit_id
        WHERE UPPER(ti.scope::text) = :scope_panel
          AND COALESCE(ti.started_at, ti.completed_at) IS NOT NULL
        UNION ALL
        SELECT
            wu.work_order_id AS work_order_id,
            te.created_at AS event_at
        FROM task_exceptions te
        JOIN panel_units pu ON pu.id = te.panel_unit_id
        JOIN work_units wu ON wu.id = pu.work_unit_id
        WHERE UPPER(te.scope::text) = :scope_panel
          AND te.created_at IS NOT NULL
    ),
    first_panel_task AS (
        SELECT
            work_order_id,
            MIN(event_at) AS first_started_at
        FROM panel_events
        GROUP BY work_order_id
    )
    SELECT
        wo.id AS work_order_id,
        wo.project_name AS production_project_name,
        wo.house_identifier AS house_identifier,
        wo.house_type_id AS house_type_id,
        ht.name AS house_type_name,
        wo.sub_type_id AS sub_type_id,
        hst.name AS sub_type_name,
        CAST(f.first_started_at AS DATE) AS start_date
    FROM first_panel_task f
    JOIN work_orders wo ON wo.id = f.work_order_id
    JOIN house_types ht ON ht.id = wo.house_type_id
    LEFT JOIN house_sub_types hst ON hst.id = wo.sub_type_id
    WHERE f.first_started_at >= :start_ts
      AND f.first_started_at < :end_ts
    ORDER BY f.first_started_at, wo.id
"""


_ALL_PRODUCTION_HOUSES_SQL = """
    WITH panel_events AS (
        SELECT
            wu.work_order_id AS work_order_id,
            COALESCE(ti.started_at, ti.completed_at) AS event_at
        FROM task_instances ti
        JOIN panel_units pu ON pu.id = ti.panel_unit_id
        JOIN work_units wu ON wu.id = pu.work_unit_id
        WHERE UPPER(ti.scope::text) = :scope_panel
          AND COALESCE(ti.started_at, ti.completed_at) IS NOT NULL
        UNION ALL
        SELECT
            wu.work_order_id AS work_order_id,
            te.created_at AS event_at
        FROM task_exceptions te
        JOIN panel_units pu ON pu.id = te.panel_unit_id
        JOIN work_units wu ON wu.id = pu.work_unit_id
        WHERE UPPER(te.scope::text) = :scope_panel
          AND te.created_at IS NOT NULL
    ),
    first_panel_task AS (
        SELECT work_order_id, MIN(event_at) AS first_started_at
        FROM panel_events
        GROUP BY work_order_id
    ),
    work_order_plan AS (
        SELECT
            work_order_id,
            MIN(planned_start_datetime) AS planned_start_at,
            MIN(planned_sequence) AS planned_sequence
        FROM work_units
        GROUP BY work_order_id
    )
    SELECT
        wo.id AS work_order_id,
        wo.project_name AS production_project_name,
        wo.house_identifier AS house_identifier,
        wo.house_type_id AS house_type_id,
        ht.name AS house_type_name,
        wo.sub_type_id AS sub_type_id,
        hst.name AS sub_type_name,
        p.planned_start_at AS planned_start_at,
        p.planned_sequence AS planned_sequence,
        f.first_started_at AS first_started_at
    FROM work_orders wo
    JOIN house_types ht ON ht.id = wo.house_type_id
    LEFT JOIN house_sub_types hst ON hst.id = wo.sub_type_id
    JOIN work_order_plan p ON p.work_order_id = wo.id
    LEFT JOIN first_panel_task f ON f.work_order_id = wo.id
    ORDER BY
        CASE WHEN f.first_started_at IS NULL THEN 0 ELSE 1 END,
        p.planned_start_at NULLS LAST,
        p.planned_sequence NULLS LAST,
        f.first_started_at DESC,
        wo.id
"""


def get_production_houses(settings: Settings) -> dict:
    """Every current Production II work order, including planned houses.

    A work order is considered started only when it satisfies the dashboard''s
    existing first-PANEL-event definition. All remaining queued work orders
    are explicitly marked planned.
    """

    try:
        with production_session(settings) as session:
            rows = list(
                session.execute(
                    text(_ALL_PRODUCTION_HOUSES_SQL),
                    {"scope_panel": "PANEL"},
                ).mappings()
            )
    except OperationalError as exc:
        raise RuntimeError("Could not connect to the Production II database") from exc
    except SQLAlchemyError as exc:
        raise RuntimeError(f"Production II house query failed: {exc.__class__.__name__}") from exc

    houses: list[dict] = []
    for row in rows:
        planned_value = row["planned_start_at"]
        started_value = row["first_started_at"]
        if isinstance(planned_value, datetime):
            planned_value = planned_value.date()
        if isinstance(started_value, datetime):
            started_value = started_value.date()
        houses.append(
            {
                "work_order_id": int(row["work_order_id"]),
                "production_project_name": str(row["production_project_name"] or ""),
                "house_identifier": (str(row["house_identifier"]).strip() or None)
                if row["house_identifier"] is not None
                else None,
                "house_type_id": int(row["house_type_id"]),
                "house_type_name": str(row["house_type_name"] or ""),
                "sub_type_id": int(row["sub_type_id"]) if row["sub_type_id"] is not None else None,
                "sub_type_name": str(row["sub_type_name"]) if row["sub_type_name"] is not None else None,
                "planned_start_date": planned_value.isoformat() if planned_value is not None else None,
                "planned_sequence": int(row["planned_sequence"]) if row["planned_sequence"] is not None else None,
                "start_date": started_value.isoformat() if started_value is not None else None,
                "lifecycle_status": "started" if started_value is not None else "planned",
            }
        )

    return {
        "houses": houses,
        "total_houses": len(houses),
        "planned_houses": sum(1 for house in houses if house["lifecycle_status"] == "planned"),
        "started_houses": sum(1 for house in houses if house["lifecycle_status"] == "started"),
        "generated_at": datetime.utcnow().isoformat(),
    }


def get_production_house_starts(
    settings: Settings,
    *,
    start_date: str | None = None,
    end_date: str | None = None,
    history_days: int = 90,
) -> dict:
    """Every house (work order) whose first panel task fell inside the window,
    across all house types, with its house type and sub type."""

    requested_start_day = _parse_house_comparison_date(start_date, field_name="start_date")
    requested_end_day = _parse_house_comparison_date(end_date, field_name="end_date")
    end_day = min(requested_end_day or datetime.utcnow().date(), datetime.utcnow().date())
    if requested_start_day is None:
        start_day = end_day - timedelta(days=max(int(history_days), 1) - 1)
    else:
        start_day = requested_start_day
    if start_day > end_day:
        raise ValueError("start_date must be on or before end_date")
    end_exclusive = end_day + timedelta(days=1)

    try:
        with production_session(settings) as session:
            rows = list(
                session.execute(
                    text(_ALL_HOUSE_STARTS_SQL),
                    {
                        "scope_panel": "PANEL",
                        "start_ts": datetime.combine(start_day, datetime.min.time()),
                        "end_ts": datetime.combine(end_exclusive, datetime.min.time()),
                    },
                ).mappings()
            )
    except OperationalError as exc:
        raise RuntimeError("Could not connect to the Production II database") from exc
    except SQLAlchemyError as exc:
        raise RuntimeError(f"Production II house start query failed: {exc.__class__.__name__}") from exc

    houses = []
    for row in rows:
        start_value = row["start_date"]
        if start_value is None:
            continue
        if isinstance(start_value, datetime):
            start_value = start_value.date()
        houses.append(
            {
                "work_order_id": int(row["work_order_id"]),
                "production_project_name": str(row["production_project_name"] or ""),
                "house_identifier": (str(row["house_identifier"]).strip() or None)
                if row["house_identifier"] is not None
                else None,
                "house_type_id": int(row["house_type_id"]),
                "house_type_name": str(row["house_type_name"] or ""),
                "sub_type_id": int(row["sub_type_id"]) if row["sub_type_id"] is not None else None,
                "sub_type_name": str(row["sub_type_name"]) if row["sub_type_name"] is not None else None,
                "start_date": start_value.isoformat(),
            }
        )

    return {
        "range_start": start_day.isoformat(),
        "range_end": end_day.isoformat(),
        "houses": houses,
        "generated_at": datetime.utcnow().isoformat(),
    }


def build_house_start_grid(houses: list[dict]) -> list[dict]:
    """Collapse per-house rows into (date, house type, sub type) start counts —
    the shape the mapped comparison aggregates over."""
    grid: dict[tuple[str, int, int | None], dict] = {}
    for house in houses:
        key = (str(house["start_date"]), int(house["house_type_id"]), house.get("sub_type_id"))
        bucket = grid.get(key)
        if bucket is None:
            bucket = {
                "date": str(house["start_date"]),
                "house_type_id": int(house["house_type_id"]),
                "house_type_name": str(house.get("house_type_name") or ""),
                "sub_type_id": house.get("sub_type_id"),
                "sub_type_name": house.get("sub_type_name"),
                "house_starts": 0,
            }
            grid[key] = bucket
        bucket["house_starts"] += 1
    return sorted(grid.values(), key=lambda row: (row["date"], row["house_type_name"], row["sub_type_name"] or ""))


def build_individual_house_start_grid(houses: list[dict]) -> list[dict]:
    """Preserve one row per started work order for per-house mapping."""

    return [
        {
            "date": str(house["start_date"]),
            "work_order_id": int(house["work_order_id"]),
            "house_type_id": int(house["house_type_id"]),
            "house_type_name": str(house.get("house_type_name") or ""),
            "sub_type_id": house.get("sub_type_id"),
            "sub_type_name": house.get("sub_type_name"),
            "house_starts": 1,
        }
        for house in houses
        if house.get("start_date") is not None
    ]


def _load_house_start_context(
    settings: Settings,
    *,
    house_type_id: int,
    history_days: int = 90,
    start_date: str | None = None,
    end_date: str | None = None,
) -> dict:
    requested_start_day = _parse_house_comparison_date(start_date, field_name="start_date")
    requested_end_day = _parse_house_comparison_date(end_date, field_name="end_date")
    end_day = min(requested_end_day or datetime.utcnow().date(), datetime.utcnow().date())
    if requested_start_day is None:
        window_days = max(int(history_days), 1)
        start_day = end_day - timedelta(days=window_days - 1)
    else:
        start_day = requested_start_day
        window_days = (end_day - start_day).days + 1
    if start_day > end_day:
        raise ValueError("start_date must be on or before end_date")
    end_exclusive = end_day + timedelta(days=1)

    try:
        with production_session(settings) as session:
            house_type = session.execute(
                text(
                    """
                    SELECT id, name, number_of_modules
                    FROM house_types
                    WHERE id = :house_type_id
                    """
                ),
                {"house_type_id": house_type_id},
            ).mappings().first()
            if house_type is None:
                raise RuntimeError("Production II house type not found")

            start_rows = list(
                session.execute(
                    text(
                        """
                        WITH relevant_work_orders AS (
                            SELECT id
                            FROM work_orders
                            WHERE house_type_id = :house_type_id
                        ),
                        panel_events AS (
                            SELECT
                                wo.id AS work_order_id,
                                COALESCE(ti.started_at, ti.completed_at) AS event_at
                            FROM task_instances ti
                            JOIN panel_units pu ON pu.id = ti.panel_unit_id
                            JOIN work_units wu ON wu.id = pu.work_unit_id
                            JOIN relevant_work_orders wo ON wo.id = wu.work_order_id
                            WHERE UPPER(ti.scope::text) = :scope_panel
                              AND COALESCE(ti.started_at, ti.completed_at) IS NOT NULL
                            UNION ALL
                            SELECT
                                wo.id AS work_order_id,
                                te.created_at AS event_at
                            FROM task_exceptions te
                            JOIN panel_units pu ON pu.id = te.panel_unit_id
                            JOIN work_units wu ON wu.id = pu.work_unit_id
                            JOIN relevant_work_orders wo ON wo.id = wu.work_order_id
                            WHERE UPPER(te.scope::text) = :scope_panel
                              AND te.created_at IS NOT NULL
                        ),
                        first_panel_task AS (
                            SELECT
                                work_order_id,
                                MIN(event_at) AS first_started_at
                            FROM panel_events
                            GROUP BY work_order_id
                        )
                        SELECT
                            CAST(first_started_at AS DATE) AS start_date,
                            COUNT(*) AS house_starts
                        FROM first_panel_task
                        WHERE first_started_at >= :start_ts
                          AND first_started_at < :end_ts
                        GROUP BY CAST(first_started_at AS DATE)
                        ORDER BY CAST(first_started_at AS DATE)
                        """
                    ),
                    {
                        "scope_panel": "PANEL",
                        "house_type_id": house_type_id,
                        "start_ts": datetime.combine(start_day, datetime.min.time()),
                        "end_ts": datetime.combine(end_exclusive, datetime.min.time()),
                    },
                ).mappings()
            )
    except OperationalError as exc:
        raise RuntimeError("Could not connect to the Production II database") from exc
    except SQLAlchemyError as exc:
        raise RuntimeError(f"Production II comparison query failed: {exc.__class__.__name__}") from exc

    house_starts_by_day = {
        row["start_date"].isoformat(): int(row["house_starts"] or 0)
        for row in start_rows
        if row["start_date"] is not None
    }
    latest_house_start_date = max((day for day, count in house_starts_by_day.items() if count > 0), default=None)
    total_house_starts = sum(house_starts_by_day.values())

    return {
        "house_type": house_type,
        "start_day": start_day,
        "end_day": end_day,
        "window_days": window_days,
        "house_starts_by_day": house_starts_by_day,
        "latest_house_start_date": latest_house_start_date,
        "total_house_starts": total_house_starts,
    }


def _parse_house_comparison_date(value: str | None, *, field_name: str) -> date | None:
    if value is None:
        return None
    normalized = value.strip()
    if not normalized:
        return None
    try:
        return date.fromisoformat(normalized)
    except ValueError as exc:
        raise ValueError(f"Invalid {field_name}; expected YYYY-MM-DD") from exc


@lru_cache(maxsize=4)
def _get_production_session_factory(
    database_url: str,
    connect_timeout_seconds: int,
    statement_timeout_ms: int,
) -> sessionmaker[Session]:
    normalized_url = database_url
    if normalized_url.startswith("postgresql+psycopg2://"):
        normalized_url = normalized_url.replace("postgresql+psycopg2://", "postgresql+psycopg://", 1)
    return create_session_factory(
        normalized_url,
        connect_timeout_seconds=connect_timeout_seconds,
        statement_timeout_ms=statement_timeout_ms,
    )


@contextmanager
def production_session(settings: Settings):
    database_url = (settings.production_database_url or "").strip()
    if not database_url:
        raise RuntimeError("Production II database is not configured")
    session_factory = _get_production_session_factory(
        database_url,
        max(int(settings.production_database_connect_timeout_seconds), 1),
        max(int(settings.production_database_statement_timeout_ms), 1),
    )
    session = session_factory()
    try:
        yield session
    finally:
        session.close()
