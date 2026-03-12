from __future__ import annotations

import logging
from typing import Any

from app.config import Settings

logger = logging.getLogger(__name__)


def erp_search_available(settings: Settings) -> bool:
    return bool(
        settings.softland_server
        and settings.softland_database
        and settings.softland_username
        and settings.softland_password
    )


def search_erp_material_candidates(query: str, settings: Settings, *, limit: int = 12) -> list[dict[str, Any]]:
    normalized = query.strip()
    if len(normalized) < 2 or not erp_search_available(settings):
        return []

    try:
        import pyodbc  # type: ignore
    except ModuleNotFoundError:
        return []

    connection = None
    tried_drivers: list[str] = []
    connection_errors: list[tuple[str, Exception]] = []
    try:
        capped_limit = max(1, min(int(limit), 30))
        connection = None
        for driver_name in _candidate_driver_names(settings.softland_driver):
            tried_drivers.append(driver_name)
            try:
                connection = pyodbc.connect(
                    (
                        f"DRIVER={{{driver_name}}};"
                        f"SERVER={settings.softland_server};"
                        f"DATABASE={settings.softland_database};"
                        f"UID={settings.softland_username};"
                        f"PWD={settings.softland_password};"
                        "Encrypt=yes;"
                        "TrustServerCertificate=yes"
                    )
                )
                break
            except Exception as exc:
                connection_errors.append((driver_name, exc))
                logger.info("ERP connection attempt with driver %s failed: %s", driver_name, exc)

        if connection is None:
            if connection_errors:
                first_non_missing_driver = next(
                    (
                        (driver_name, exc)
                        for driver_name, exc in connection_errors
                        if "Can't open lib" not in str(exc)
                    ),
                    None,
                )
                if first_non_missing_driver is not None:
                    driver_name, exc = first_non_missing_driver
                    raise RuntimeError(f"ERP connection failed using driver {driver_name}: {exc}") from exc
            raise RuntimeError(f"No supported SQL Server ODBC driver could be opened. Tried: {', '.join(tried_drivers)}")
        cursor = connection.cursor()
        like_value = f"%{normalized}%"
        prefix_value = f"{normalized}%"
        sql = f"""
            SELECT TOP {capped_limit} CodProd, DesProd, CodUMed
            FROM softland.iw_tprod
            WHERE (CodProd LIKE ? OR DesProd LIKE ?)
              AND Inventariable = -1
              AND Inactivo = 0
            ORDER BY
                CASE
                    WHEN CodProd = ? THEN 0
                    WHEN CodProd LIKE ? THEN 1
                    WHEN DesProd LIKE ? THEN 2
                    ELSE 3
                END,
                DesProd ASC,
                CodProd ASC
        """
        cursor.execute(sql, like_value, like_value, normalized, prefix_value, prefix_value)

        results = []
        seen: set[str] = set()
        for row in cursor.fetchall():
            sku = (getattr(row, "CodProd", None) or "").strip().upper()
            if not sku or sku in seen:
                continue
            seen.add(sku)
            results.append(
                {
                    "material_id": None,
                    "sku": sku,
                    "name": (getattr(row, "DesProd", None) or "").strip() or sku,
                    "unit": (getattr(row, "CodUMed", None) or "").strip() or None,
                    "source": "erp",
                    "has_erp_data": True,
                }
            )
        return results
    except Exception as exc:
        logger.warning("ERP material candidate search failed for query %r: %s", normalized, exc)
        return []
    finally:
        if connection is not None:
            connection.close()


def _candidate_driver_names(configured_driver: str | None) -> list[str]:
    candidates = [
        configured_driver or "",
        "ODBC Driver 18 for SQL Server",
        "ODBC Driver 17 for SQL Server",
    ]
    seen: set[str] = set()
    ordered: list[str] = []
    for candidate in candidates:
        normalized = candidate.strip()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        ordered.append(normalized)
    return ordered
