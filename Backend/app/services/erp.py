from __future__ import annotations

import logging
from contextlib import contextmanager
from datetime import date, datetime, timedelta
from typing import Any, Iterable, Sequence

from app.config import Settings

logger = logging.getLogger(__name__)

DEFAULT_STOCK_WAREHOUSE_CODES: tuple[str, ...] = ("001",)


def erp_search_available(settings: Settings) -> bool:
    return bool(
        settings.softland_server
        and settings.softland_database
        and settings.softland_username
        and settings.softland_password
    )


@contextmanager
def _open_connection(settings: Settings):
    if not erp_search_available(settings):
        raise RuntimeError("ERP connection is not configured")

    try:
        import pyodbc  # type: ignore
    except ModuleNotFoundError as exc:
        raise RuntimeError("pyodbc is not installed") from exc

    connection = None
    tried_drivers: list[str] = []
    connection_errors: list[tuple[str, Exception]] = []
    try:
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
                    ),
                    timeout=max(int(settings.softland_connect_timeout_seconds), 1),
                )
                connection.timeout = max(int(settings.softland_query_timeout_seconds), 1)
                break
            except Exception as exc:  # pragma: no cover - driver/network differences
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
        yield connection
    finally:
        if connection is not None:
            connection.close()


def search_erp_material_candidates(query: str, settings: Settings, *, limit: int = 12) -> list[dict[str, Any]]:
    normalized = query.strip()
    if len(normalized) < 2:
        return []

    try:
        with _open_connection(settings) as connection:
            cursor = connection.cursor()
            capped_limit = max(1, min(int(limit), 30))
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


def get_cost_centers(settings: Settings) -> list[dict[str, str]]:
    try:
        with _open_connection(settings) as connection:
            cursor = connection.cursor()
            cursor.execute(
                """
                SELECT
                    RTRIM(LTRIM(CodiCC)) AS Code,
                    RTRIM(LTRIM(DescCC)) AS Name
                FROM softland.cwtccos
                WHERE RTRIM(LTRIM(CodiCC)) <> ''
                ORDER BY Name
                """
            )
            centers: list[dict[str, str]] = []
            for row in cursor.fetchall():
                code = (getattr(row, "Code", None) or "").strip()
                if not code:
                    continue
                centers.append(
                    {
                        "code": code,
                        "name": (getattr(row, "Name", None) or "").strip(),
                    }
                )
            return centers
    except Exception as exc:
        logger.warning("ERP cost center lookup failed: %s", exc)
        raise RuntimeError("Could not load ERP cost centers") from exc


def get_recent_movement_materials(
    settings: Settings,
    *,
    days: int = 60,
    cost_centers: Sequence[str] | None = None,
    excluded_cost_centers: Sequence[str] | None = None,
) -> list[dict[str, Any]]:
    window_days = max(int(days), 1)
    start_day = datetime.utcnow().date() - timedelta(days=window_days)
    ceco_filters = _normalize_cost_centers(cost_centers)
    excluded_ceco_filters = _normalize_cost_centers(excluded_cost_centers)

    try:
        with _open_connection(settings) as connection:
            movement_cursor = connection.cursor()
            return _fetch_recent_movement_materials(
                movement_cursor,
                start_day=start_day,
                cost_centers=ceco_filters,
                excluded_cost_centers=excluded_ceco_filters,
            )
    except Exception as exc:
        logger.warning("ERP recent movement material lookup failed: %s", exc)
        raise RuntimeError("Could not load ERP material movement data") from exc


def get_material_procurement_details(
    settings: Settings,
    sku: str,
    *,
    cost_centers: Sequence[str] | None = None,
    excluded_cost_centers: Sequence[str] | None = None,
) -> dict[str, Any] | None:
    normalized_sku = sku.strip().upper()
    if not normalized_sku:
        return None

    ceco_filters = _normalize_cost_centers(cost_centers)
    excluded_ceco_filters = _normalize_cost_centers(excluded_cost_centers)

    try:
        with _open_connection(settings) as connection:
            stock_cursor = connection.cursor()
            po_cursor = connection.cursor()
            pricing_cursor = connection.cursor()
            lead_cursor = connection.cursor()
            quantity_cursor = connection.cursor()
            product_cursor = connection.cursor()

            product_cursor.execute(
                """
                SELECT TOP 1 RTRIM(LTRIM(CodProd)) AS CodProd, RTRIM(LTRIM(DesProd)) AS DesProd, RTRIM(LTRIM(CodUMed)) AS CodUMed
                FROM softland.iw_tprod
                WHERE RTRIM(LTRIM(CodProd)) = RTRIM(LTRIM(?))
                """,
                (normalized_sku,),
            )
            product_row = product_cursor.fetchone()
            material_name = (getattr(product_row, "DesProd", None) or "").strip() or normalized_sku
            unit = (getattr(product_row, "CodUMed", None) or "").strip() or None

            today_yyyymmdd = datetime.utcnow().strftime("%Y%m%d")
            today_ddmmyyyy = datetime.utcnow().strftime("%d/%m/%Y")
            stock_on_hand = _safe_erp_lookup(
                lambda: _get_stock_for_products_batch(stock_cursor, [normalized_sku], today_yyyymmdd).get(normalized_sku),
                default=None,
                label=f"stock for {normalized_sku}",
            )
            po_date, po_number, pending_qty, estimated_delivery = _safe_erp_lookup(
                lambda: _get_last_purchase_orders_for_products_batch(po_cursor, [normalized_sku]).get(normalized_sku, (None, None, None, None)),
                default=(None, None, None, None),
                label=f"purchase orders for {normalized_sku}",
            )
            average_price = _safe_erp_lookup(
                lambda: _get_average_prices_for_products_batch(pricing_cursor, [normalized_sku], today_ddmmyyyy).get(normalized_sku),
                default=None,
                label=f"average price for {normalized_sku}",
            )
            lead_stats = _safe_erp_lookup(
                lambda: _get_lead_time_stats_for_products_batch(lead_cursor, [normalized_sku], limit=20).get(normalized_sku) or {},
                default={},
                label=f"lead time for {normalized_sku}",
            )
            movement_quantity_30d = _safe_erp_lookup(
                lambda: _get_outgoing_quantities_for_products_batch(
                    quantity_cursor,
                    [normalized_sku],
                    start_day=datetime.utcnow().date() - timedelta(days=30),
                    cost_centers=ceco_filters,
                    excluded_cost_centers=excluded_ceco_filters,
                ).get(normalized_sku, 0.0),
                default=0.0,
                label=f"30-day movement for {normalized_sku}",
            )

            return {
                "sku": normalized_sku,
                "material_name": material_name,
                "unit": unit,
                "stock_on_hand": stock_on_hand,
                "pending_purchase_quantity": pending_qty,
                "average_price": average_price,
                "average_lead_time_days": lead_stats.get("average_lead_time_days"),
                "max_lead_time_days": lead_stats.get("max_lead_time_days"),
                "lead_time_sample_count": lead_stats.get("lead_time_sample_count", 0),
                "last_purchase_order_date": _serialize_datetime(po_date),
                "last_purchase_order_number": po_number,
                "last_purchase_order_estimated_delivery": _serialize_datetime(estimated_delivery),
                "movement_quantity_30d": movement_quantity_30d,
            }
    except Exception as exc:
        logger.warning("ERP procurement detail lookup failed for %s: %s", normalized_sku, exc)
        raise RuntimeError(f"Could not load ERP detail for {normalized_sku}") from exc


def _safe_erp_lookup(loader, *, default: Any, label: str):
    try:
        return loader()
    except Exception as exc:
        logger.warning("ERP detail lookup failed while loading %s: %s", label, exc)
        return default


def get_material_movement_history(
    settings: Settings,
    sku: str,
    *,
    days: int = 90,
    start_day: date | None = None,
    end_day: date | None = None,
    cost_centers: Sequence[str] | None = None,
    excluded_cost_centers: Sequence[str] | None = None,
) -> list[dict[str, Any]]:
    normalized_sku = sku.strip().upper()
    if not normalized_sku:
        return []

    requested_end_day = end_day or datetime.utcnow().date()
    requested_start_day = start_day
    if requested_start_day is None:
        window_days = max(int(days), 1)
        requested_start_day = requested_end_day - timedelta(days=window_days - 1)
    elif requested_start_day > requested_end_day:
        raise ValueError("start_day must be on or before end_day")

    window_days = max((requested_end_day - requested_start_day).days + 1, 1)
    ceco_filters = _normalize_cost_centers(cost_centers)
    excluded_ceco_filters = _normalize_cost_centers(excluded_cost_centers)

    try:
        with _open_connection(settings) as connection:
            cursor = connection.cursor()
            raw_rows = _get_outgoing_movements_for_product(
                cursor,
                product_code=normalized_sku,
                start_day=requested_start_day,
                end_day=requested_end_day,
                cost_centers=ceco_filters,
                excluded_cost_centers=excluded_ceco_filters,
            )
            quantity_by_day = {row_date.isoformat(): quantity for row_date, quantity in raw_rows}
            history: list[dict[str, Any]] = []
            for offset in range(window_days):
                current_day = requested_start_day + timedelta(days=offset)
                history.append(
                    {
                        "date": current_day.isoformat(),
                        "quantity": round(quantity_by_day.get(current_day.isoformat(), 0.0), 4),
                    }
                )
            return history
    except Exception as exc:
        logger.warning("ERP movement history lookup failed for %s: %s", normalized_sku, exc)
        raise RuntimeError(f"Could not load ERP movement history for {normalized_sku}") from exc


def _fetch_recent_movement_materials(
    cursor,
    *,
    start_day: date,
    cost_centers: Sequence[str],
    excluded_cost_centers: Sequence[str],
) -> list[dict[str, Any]]:
    params: list[object] = [start_day.strftime("%Y%m%d")]
    ceco_clause, ceco_params = _build_cost_center_clause(
        "RTRIM(LTRIM(h.CodiCC))",
        cost_centers=cost_centers,
        excluded_cost_centers=excluded_cost_centers,
    )
    params.extend(ceco_params)

    cursor.execute(
        f"""
        SELECT
            RTRIM(LTRIM(d.CodProd)) AS CodProd,
            MAX(CONVERT(date, h.Fecha)) AS LastMovementDate,
            SUM(COALESCE(d.CantDespachada, 0)) AS MovementQuantity,
            COUNT(*) AS MovementCount,
            MAX(RTRIM(LTRIM(p.DesProd))) AS DesProd,
            MAX(RTRIM(LTRIM(p.CodUMed))) AS CodUMed
        FROM softland.iw_gsaen h
        INNER JOIN softland.iw_gmovi d ON h.Tipo = d.Tipo AND h.NroInt = d.NroInt
        LEFT JOIN softland.iw_tprod p ON RTRIM(LTRIM(p.CodProd)) = RTRIM(LTRIM(d.CodProd))
        WHERE
            h.Fecha >= ?
            AND h.Tipo = 'S'
            AND RTRIM(LTRIM(h.Concepto)) = '07'
            AND RTRIM(LTRIM(h.Estado)) = 'V'
            AND RTRIM(LTRIM(h.Proceso)) = 'Guía de Salida'
            AND RTRIM(LTRIM(d.CodProd)) <> ''{ceco_clause}
        GROUP BY RTRIM(LTRIM(d.CodProd))
        ORDER BY MAX(CONVERT(date, h.Fecha)) DESC, SUM(COALESCE(d.CantDespachada, 0)) DESC, RTRIM(LTRIM(d.CodProd)) ASC
        """,
        params,
    )

    materials: list[dict[str, Any]] = []
    for row in cursor.fetchall():
        sku = (getattr(row, "CodProd", None) or "").strip().upper()
        if not sku:
            continue
        movement_qty_raw = getattr(row, "MovementQuantity", None)
        movement_count_raw = getattr(row, "MovementCount", None)
        materials.append(
            {
                "sku": sku,
                "material_name": (getattr(row, "DesProd", None) or "").strip() or sku,
                "unit": (getattr(row, "CodUMed", None) or "").strip() or None,
                "last_movement_date": _serialize_datetime(getattr(row, "LastMovementDate", None)),
                "movement_quantity_60d": round(float(movement_qty_raw or 0.0), 2),
                "movement_count_60d": int(movement_count_raw or 0),
            }
        )
    return materials


def _get_stock_for_products_batch(cursor, product_codes: Sequence[str], date_str: str) -> dict[str, float]:
    if not product_codes:
        return {}
    placeholders = ",".join(["?"] * len(product_codes))
    warehouse_placeholders = ",".join(["?"] * len(DEFAULT_STOCK_WAREHOUSE_CODES))
    cursor.execute(
        f"""
        SELECT CodProd, COALESCE(SUM(Ingresos - Egresos), 0) AS StockValue
        FROM softland.IW_vsnpMovimStockTipoBod
        WHERE Fecha <= ?
          AND CodProd IN ({placeholders})
          AND CodBode IN ({warehouse_placeholders})
        GROUP BY CodProd
        """,
        [date_str, *product_codes, *DEFAULT_STOCK_WAREHOUSE_CODES],
    )
    stocks = {code: 0.0 for code in product_codes}
    for row in cursor.fetchall():
        code = (getattr(row, "CodProd", None) or "").strip().upper()
        if not code:
            continue
        stocks[code] = round(float(getattr(row, "StockValue", 0.0) or 0.0), 2)
    return stocks


def _get_average_prices_for_products_batch(cursor, product_codes: Sequence[str], date_str_ddmmyyyy: str) -> dict[str, float | None]:
    prices: dict[str, float | None] = {}
    for code in product_codes:
        cursor.execute(
            "SELECT softland.IW_fdblCostoPromedio(?, CONVERT(DATETIME, ?, 103)) AS AveragePrice",
            (code, date_str_ddmmyyyy),
        )
        row = cursor.fetchone()
        value = getattr(row, "AveragePrice", None) if row else None
        prices[code] = round(float(value), 2) if value is not None else None
    return prices


def _get_last_purchase_orders_for_products_batch(
    cursor,
    product_codes: Sequence[str],
) -> dict[str, tuple[datetime | None, str | None, float | None, datetime | None]]:
    if not product_codes:
        return {}

    results: dict[str, tuple[datetime | None, str | None, float | None, datetime | None]] = {
        code: (None, None, None, None) for code in product_codes
    }
    placeholders = ",".join(["?"] * len(product_codes))
    cursor.execute(
        f"""
        WITH RankedPOs AS (
            SELECT
                c.fechaOC,
                c.numoc,
                c.FecFinalOC,
                c.NumInterOc AS OCNumInterOc,
                d.NumLinea,
                RTRIM(LTRIM(d.CodProd)) AS CodProd,
                d.cantidad AS cantidadOrdenadaDetalle,
                ROW_NUMBER() OVER (
                    PARTITION BY RTRIM(LTRIM(d.CodProd))
                    ORDER BY c.fechaOC DESC, c.numoc DESC, d.NumLinea ASC
                ) AS rn
            FROM softland.owordencom c
            INNER JOIN softland.owordendet d ON d.numinteroc = c.numinteroc
            WHERE RTRIM(LTRIM(d.codprod)) IN ({placeholders})
        ),
        LastPOBase AS (
            SELECT * FROM RankedPOs WHERE rn = 1
        )
        SELECT
            lpo.CodProd,
            lpo.fechaOC,
            lpo.numoc,
            lpo.FecFinalOC,
            lpo.cantidadOrdenadaDetalle,
            COALESCE(SUM(b.ingresada), 0) AS cantidadIngresadaMovim,
            COALESCE(softland.ow_fdblRecepNoInvOC(lpo.OCNumInterOc, lpo.NumLinea, lpo.CodProd), 0) AS cantidadRecepcionNoInv
        FROM LastPOBase lpo
        LEFT OUTER JOIN softland.ow_vsnpMovimIWDetalleOC b
            ON b.numoc = lpo.numoc AND b.numlinea = lpo.NumLinea AND b.codprod = lpo.CodProd
        GROUP BY
            lpo.CodProd,
            lpo.fechaOC,
            lpo.numoc,
            lpo.FecFinalOC,
            lpo.cantidadOrdenadaDetalle,
            lpo.OCNumInterOc,
            lpo.NumLinea
        """,
        list(product_codes),
    )
    for row in cursor.fetchall():
        code = (getattr(row, "CodProd", None) or "").strip().upper()
        if not code:
            continue
        ordered = float(getattr(row, "cantidadOrdenadaDetalle", 0.0) or 0.0)
        entered_mov = float(getattr(row, "cantidadIngresadaMovim", 0.0) or 0.0)
        entered_non_inv = float(getattr(row, "cantidadRecepcionNoInv", 0.0) or 0.0)
        results[code] = (
            getattr(row, "fechaOC", None),
            str(getattr(row, "numoc", "")).strip() or None,
            round(ordered - (entered_mov + entered_non_inv), 2),
            getattr(row, "FecFinalOC", None),
        )
    return results


def _get_outgoing_quantities_for_products_batch(
    cursor,
    product_codes: Sequence[str],
    *,
    start_day: date,
    cost_centers: Sequence[str],
    excluded_cost_centers: Sequence[str],
) -> dict[str, float]:
    if not product_codes:
        return {}

    product_placeholders = ",".join(["?"] * len(product_codes))
    params: list[object] = [start_day.strftime("%Y%m%d"), *product_codes]
    ceco_clause, ceco_params = _build_cost_center_clause(
        "RTRIM(LTRIM(h.CodiCC))",
        cost_centers=cost_centers,
        excluded_cost_centers=excluded_cost_centers,
    )
    params.extend(ceco_params)

    cursor.execute(
        f"""
        SELECT
            RTRIM(LTRIM(d.CodProd)) AS CodProd,
            SUM(COALESCE(d.CantDespachada, 0)) AS Quantity
        FROM softland.iw_gsaen h
        INNER JOIN softland.iw_gmovi d ON h.Tipo = d.Tipo AND h.NroInt = d.NroInt
        WHERE
            h.Fecha >= ?
            AND h.Tipo = 'S'
            AND RTRIM(LTRIM(h.Concepto)) = '07'
            AND RTRIM(LTRIM(h.Estado)) = 'V'
            AND RTRIM(LTRIM(h.Proceso)) = 'Guía de Salida'
            AND RTRIM(LTRIM(d.CodProd)) IN ({product_placeholders}){ceco_clause}
        GROUP BY RTRIM(LTRIM(d.CodProd))
        """,
        params,
    )

    totals = {code: 0.0 for code in product_codes}
    for row in cursor.fetchall():
        code = (getattr(row, "CodProd", None) or "").strip().upper()
        if not code:
            continue
        totals[code] = round(float(getattr(row, "Quantity", 0.0) or 0.0), 2)
    return totals


def _get_outgoing_movements_for_product(
    cursor,
    *,
    product_code: str,
    start_day: date,
    end_day: date,
    cost_centers: Sequence[str],
    excluded_cost_centers: Sequence[str],
) -> list[tuple[date, float]]:
    params: list[object] = [start_day.strftime("%Y%m%d"), end_day.strftime("%Y%m%d"), product_code]
    ceco_clause, ceco_params = _build_cost_center_clause(
        "RTRIM(LTRIM(h.CodiCC))",
        cost_centers=cost_centers,
        excluded_cost_centers=excluded_cost_centers,
    )
    params.extend(ceco_params)

    cursor.execute(
        f"""
        SELECT
            CONVERT(date, h.Fecha) AS MovementDate,
            SUM(COALESCE(d.CantDespachada, 0)) AS Quantity
        FROM softland.iw_gsaen h
        INNER JOIN softland.iw_gmovi d ON h.Tipo = d.Tipo AND h.NroInt = d.NroInt
        WHERE
            h.Fecha >= ?
            AND h.Fecha <= ?
            AND h.Tipo = 'S'
            AND RTRIM(LTRIM(h.Concepto)) = '07'
            AND RTRIM(LTRIM(h.Estado)) = 'V'
            AND RTRIM(LTRIM(h.Proceso)) = 'Guía de Salida'
            AND RTRIM(LTRIM(d.CodProd)) = RTRIM(LTRIM(?)){ceco_clause}
        GROUP BY CONVERT(date, h.Fecha)
        ORDER BY MovementDate ASC
        """,
        params,
    )
    rows: list[tuple[date, float]] = []
    for row in cursor.fetchall():
        movement_date = getattr(row, "MovementDate", None)
        if movement_date is None:
            continue
        if isinstance(movement_date, datetime):
            movement_date = movement_date.date()
        rows.append((movement_date, round(float(getattr(row, "Quantity", 0.0) or 0.0), 4)))
    return rows


def _get_lead_time_stats_for_products_batch(
    cursor,
    product_codes: Iterable[str],
    *,
    limit: int,
) -> dict[str, dict[str, int | float | None]]:
    return {
        code: _calculate_delivery_time_stats(cursor, code, limit=limit)
        for code in product_codes
    }


def _calculate_delivery_time_stats(cursor, product_code: str, *, limit: int) -> dict[str, int | float | None]:
    samples = _get_lead_time_samples_for_product(cursor, product_code, limit=limit)
    if not samples:
        return {
            "average_lead_time_days": None,
            "max_lead_time_days": None,
            "lead_time_sample_count": 0,
        }
    lead_time_days = [int(sample["lead_time_days"]) for sample in samples if sample.get("lead_time_days") is not None]
    if not lead_time_days:
        return {
            "average_lead_time_days": None,
            "max_lead_time_days": None,
            "lead_time_sample_count": 0,
        }
    return {
        "average_lead_time_days": round(sum(lead_time_days) / len(lead_time_days), 2),
        "max_lead_time_days": max(lead_time_days),
        "lead_time_sample_count": len(lead_time_days),
    }


def _get_lead_time_samples_for_product(cursor, product_code: str, *, limit: int) -> list[dict[str, Any]]:
    normalized_code = product_code.strip().upper()
    if not normalized_code:
        return []
    sample_target = max(int(limit), 1)
    cursor.execute(
        f"""
        SELECT TOP {sample_target * 5}
            c.fechaOC,
            c.FecFinalOC,
            c.numoc,
            c.NumInterOc AS OCNumInterOc,
            d.NumLinea,
            RTRIM(LTRIM(d.CodProd)) AS CodProd
        FROM softland.owordencom c
        INNER JOIN softland.owordendet d ON d.numinteroc = c.numinteroc
        WHERE RTRIM(LTRIM(d.CodProd)) = ?
        ORDER BY c.fechaOC DESC, c.numoc DESC, d.NumLinea ASC
        """,
        (normalized_code,),
    )

    samples: list[dict[str, Any]] = []
    for row in cursor.fetchall():
        order_date = _coerce_date(getattr(row, "fechaOC", None))
        promised_date = _coerce_date(getattr(row, "FecFinalOC", None))
        receipt_date = _coerce_date(
            _fetch_first_receipt_date(
                cursor,
                num_oc=getattr(row, "numoc", None),
                num_inter_oc=getattr(row, "OCNumInterOc", None),
                num_linea=getattr(row, "NumLinea", None),
                product_code=normalized_code,
            )
        )
        if receipt_date is None and promised_date and order_date and promised_date >= order_date:
            receipt_date = promised_date
        if not order_date or not receipt_date:
            continue
        lead_time_days = max((receipt_date - order_date).days, 0)
        samples.append({"lead_time_days": lead_time_days})
        if len(samples) >= sample_target:
            break
    return samples


def _fetch_first_receipt_date(cursor, *, num_oc: Any, num_inter_oc: Any, num_linea: Any, product_code: str):
    if not product_code:
        return None

    oc_candidates = _normalize_identifiers(num_oc, pad_lengths=(6, 8, 10, 12))
    inter_candidates = _normalize_identifiers(num_inter_oc, pad_lengths=(6, 8, 10, 12))
    line_candidates = _normalize_identifiers(num_linea, pad_lengths=(2, 3, 4))
    inter_column_available = True
    process_variants = [
        "Guía de Entrada",
        "GUIA DE ENTRADA",
        "Guia de Entrada",
        "GUIA ENTRADA",
        "GUIA DE ENT",
        "GUIA ENTRADA RECEPCION",
        "Guia de Entrada Recepcion",
        "RECEPCION MERCADERIA",
        "Recepcion Mercaderia",
    ]
    process_filter = " OR ".join(["Proceso = ?" for _ in process_variants])
    type_variants = ["E", "I"]

    def _coerce_fecha(row: Any):
        for attr in ("Fecha", "fecha", "FECHA", "first_date", "FIRST_DATE", "FirstDate"):
            if hasattr(row, attr):
                value = getattr(row, attr)
                if value:
                    return value
        try:
            return row[0]
        except Exception:
            return None

    def _check_gmovi(nroint: Any) -> bool:
        if nroint is None:
            return False
        try:
            cursor.execute(
                """
                SELECT TOP 1 CantIngresada
                FROM softland.iw_gmovi
                WHERE Tipo = 'E'
                  AND NroInt = ?
                  AND RTRIM(LTRIM(CodProd)) = ?
                  AND COALESCE(CantIngresada, 0) > 0
                """,
                (nroint, product_code),
            )
            return cursor.fetchone() is not None
        except Exception:
            return False

    def run_query(where_clause: str, params: Sequence[object]):
        nonlocal inter_column_available
        if "NumInterOc" in where_clause and not inter_column_available:
            return None

        cursor.execute(
            f"""
            SELECT MIN(CONVERT(date, FechaMov)) AS FirstDate
            FROM softland.ow_vsnpMovimIWDetalleOC
            WHERE {where_clause}
            """,
            params,
        )
        row = cursor.fetchone()
        return getattr(row, "FirstDate", None) if row else None

    def safe_run_query(where_clause: str, params: Sequence[object]):
        nonlocal inter_column_available
        try:
            return run_query(where_clause, params)
        except Exception as exc:
            if "NumInterOc" in where_clause and _is_invalid_column_error(exc, "NumInterOc"):
                inter_column_available = False
            return None

    seen_nroint: set[str] = set()
    for oc_value in oc_candidates:
        try:
            rows = []
            for tipo in type_variants:
                cursor.execute(
                    (
                        "SELECT NroInt, CONVERT(date, Fecha) AS Fecha "
                        "FROM softland.iw_gsaen "
                        f"WHERE Tipo = ? AND ({process_filter}) "
                        "AND CAST(Orden AS NVARCHAR(50)) = ? "
                        "ORDER BY Fecha ASC"
                    ),
                    (tipo, *process_variants, oc_value),
                )
                rows.extend(cursor.fetchall())
        except Exception:
            rows = []

        for row in rows:
            nroint = getattr(row, "NroInt", None)
            if nroint in seen_nroint:
                continue
            seen_nroint.add(nroint)
            if _check_gmovi(nroint):
                return _coerce_fecha(row)

    for oc_value in oc_candidates:
        if "%" in oc_value:
            continue
        try:
            rows = []
            for tipo in type_variants:
                cursor.execute(
                    (
                        "SELECT NroInt, CONVERT(date, Fecha) AS Fecha "
                        "FROM softland.iw_gsaen "
                        f"WHERE Tipo = ? AND ({process_filter}) "
                        "AND CAST(Orden AS NVARCHAR(50)) LIKE ? "
                        "ORDER BY Fecha ASC"
                    ),
                    (tipo, *process_variants, f"%{oc_value}%"),
                )
                rows.extend(cursor.fetchall())
        except Exception:
            rows = []

        for row in rows:
            nroint = getattr(row, "NroInt", None)
            if nroint in seen_nroint:
                continue
            seen_nroint.add(nroint)
            if _check_gmovi(nroint):
                return _coerce_fecha(row)

    for inter_value in inter_candidates:
        received = safe_run_query(
            "NumInterOc = ? AND RTRIM(LTRIM(CodProd)) = ? AND Ingresada > 0",
            (inter_value, product_code),
        )
        if received:
            return received
        for line_value in line_candidates:
            received = safe_run_query(
                "NumInterOc = ? AND NumLinea = ? AND RTRIM(LTRIM(CodProd)) = ? AND Ingresada > 0",
                (inter_value, line_value, product_code),
            )
            if received:
                return received

    for oc_value in oc_candidates:
        received = safe_run_query(
            "NumOc = ? AND RTRIM(LTRIM(CodProd)) = ? AND Ingresada > 0",
            (oc_value, product_code),
        )
        if received:
            return received
        for line_value in line_candidates:
            received = safe_run_query(
                "NumOc = ? AND NumLinea = ? AND RTRIM(LTRIM(CodProd)) = ? AND Ingresada > 0",
                (oc_value, line_value, product_code),
            )
            if received:
                return received
    return None


def _normalize_identifiers(raw_value: Any, pad_lengths: Sequence[int] | None = None) -> list[str]:
    values: list[str] = []
    seen: set[str] = set()
    candidates = raw_value if isinstance(raw_value, (list, tuple, set)) else [raw_value]
    for candidate in candidates:
        if candidate is None:
            continue
        cleaned = str(candidate).strip()
        if not cleaned or cleaned in seen:
            continue
        seen.add(cleaned)
        values.append(cleaned)
        digits = "".join(character for character in cleaned if character.isdigit())
        if not digits:
            continue
        for pad_length in pad_lengths or ():
            padded = digits.zfill(pad_length)
            if padded in seen:
                continue
            seen.add(padded)
            values.append(padded)
    return values[:15]


def _normalize_cost_centers(cost_centers: Sequence[str] | None) -> list[str]:
    return [str(value).strip() for value in cost_centers or [] if value is not None and str(value).strip()]


def _build_cost_center_clause(
    column_name: str,
    *,
    cost_centers: Sequence[str],
    excluded_cost_centers: Sequence[str],
) -> tuple[str, list[object]]:
    if cost_centers:
        placeholders = ",".join(["?"] * len(cost_centers))
        return f"\n          AND {column_name} IN ({placeholders})", list(cost_centers)
    if excluded_cost_centers:
        placeholders = ",".join(["?"] * len(excluded_cost_centers))
        return f"\n          AND {column_name} NOT IN ({placeholders})", list(excluded_cost_centers)
    return "", []


def _serialize_datetime(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return str(value)


def _coerce_date(value: Any) -> date | None:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, str):
        text = value.strip()
        for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%Y%m%d"):
            try:
                return datetime.strptime(text[:10], fmt).date()
            except ValueError:
                continue
    return None


def _is_invalid_column_error(exc: Exception, column_name: str) -> bool:
    message = str(exc).lower()
    return "invalid column name" in message and column_name.lower() in message


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
