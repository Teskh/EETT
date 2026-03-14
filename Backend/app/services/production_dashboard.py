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
    except OperationalError as exc:
        raise RuntimeError("Could not connect to the Production II database") from exc
    except SQLAlchemyError as exc:
        raise RuntimeError(f"Production II query failed: {exc.__class__.__name__}") from exc
    return {
        "house_types": [
            {
                "id": int(row["id"]),
                "name": str(row["name"]),
                "number_of_modules": int(row["number_of_modules"] or 0),
            }
            for row in rows
        ]
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

    movement_by_day = {
        str(point.get("date")): round(float(point.get("quantity") or 0.0), 4)
        for point in movements
    }
    house_starts_by_day = {
        row["start_date"].isoformat(): int(row["house_starts"] or 0)
        for row in start_rows
        if row["start_date"] is not None
    }

    points: list[dict] = []
    cumulative_material = 0.0
    cumulative_house_starts = 0
    latest_house_start_date = None
    for offset in range(window_days):
        current_day = start_day + timedelta(days=offset)
        day_key = current_day.isoformat()
        material_quantity = movement_by_day.get(day_key, 0.0)
        house_starts = house_starts_by_day.get(day_key, 0)
        cumulative_material += material_quantity
        cumulative_house_starts += house_starts
        if house_starts > 0:
            latest_house_start_date = day_key
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
    total_house_starts = sum(point["house_starts"] for point in points)

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
