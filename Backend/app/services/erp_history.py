"""Our stored copy of the ERP's production withdrawals.

Past withdrawals almost never change, so rather than rebuilding them from the
ERP whenever a cache expires we keep them in `erp_withdrawals` and keep that
copy up to date:

* first run: the whole history window is loaded, newest month first, so
  recent charts work within minutes;
* during the day: new withdrawals are picked up every hour or so;
* every night: the last 30 days are fetched again, catching slips that were
  cancelled, corrected or entered late with an earlier date;
* every month, at night: the whole window is re-checked.

The ERP is only ever asked for one chunk of days at a time, with a pause
between chunks and a growing wait before retrying a failure, so a sync never
floods it with requests.

Readers (material charts, material groups, the cost model) use the stored copy
when it covers the requested days and is up to date, and fall back to asking
the ERP directly otherwise, so nothing breaks before the first sync finishes
or if syncing stalls.
"""

from __future__ import annotations

import logging
import threading
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from typing import Any, Callable, Sequence

from sqlalchemy import delete, inspect, insert, select
from sqlalchemy.exc import OperationalError, ProgrammingError
from sqlalchemy.orm import Session, sessionmaker

from app.config import Settings
from app.models import ErpProduct, ErpSyncState, ErpWithdrawal
from app.services import erp

logger = logging.getLogger(__name__)

STATE_KEY = "withdrawals"
INTRADAY_DAYS = 3
_DELETE_BATCH = 500

_sync_lock = threading.Lock()
_stop_event = threading.Event()
_tables_ready: dict[int, bool] = {}


class SyncStopped(Exception):
    """The run left its allowed time window, or the app is shutting down; it
    resumes on the next run."""


def request_stop() -> None:
    """Ask a running sync to stop after its current ERP query (app shutdown)."""
    _stop_event.set()


def allow_runs() -> None:
    _stop_event.clear()


def _pause(seconds: float) -> None:
    if _stop_event.wait(max(float(seconds), 0.0)):
        raise SyncStopped()


# ---------------------------------------------------------------------------
# Time helpers


def _local_now() -> datetime:
    return datetime.now().astimezone()


def _today() -> date:
    # ERP dates are local, but some readers ask up to the UTC date, which is
    # ahead of Chile in the evening: cover whichever is later.
    return max(_local_now().date(), datetime.now(timezone.utc).date())


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _as_aware(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)


def sync_enabled(settings: Settings) -> bool:
    if not erp.erp_search_available(settings):
        return False
    if settings.erp_sync_enabled is None:
        return settings.environment.strip().lower() == "production"
    return settings.erp_sync_enabled


def _history_start(settings: Settings, today: date) -> date:
    return today - timedelta(days=max(int(settings.erp_sync_history_days), 1))


def _in_night_window(settings: Settings, now: datetime) -> bool:
    start = int(settings.erp_sync_night_hour) % 24
    hours = max(int(settings.erp_sync_night_window_hours), 1)
    return (now.hour - start) % 24 < hours


def _night_window_end(settings: Settings, now: datetime) -> datetime:
    start = int(settings.erp_sync_night_hour) % 24
    hours = max(int(settings.erp_sync_night_window_hours), 1)
    elapsed = (now.hour - start) % 24
    window_start = now.replace(minute=0, second=0, microsecond=0) - timedelta(hours=elapsed)
    return window_start + timedelta(hours=hours)


# ---------------------------------------------------------------------------
# State


def tables_ready(session: Session) -> bool:
    bind = session.get_bind()
    key = id(bind)
    if not _tables_ready.get(key):
        try:
            _tables_ready[key] = inspect(bind).has_table("erp_sync_state")
        except Exception:  # pragma: no cover - defensive
            return False
    return _tables_ready[key]


def _load_state(session: Session) -> ErpSyncState | None:
    return session.get(ErpSyncState, STATE_KEY)


def _state_for_update(session: Session) -> ErpSyncState:
    state = session.get(ErpSyncState, STATE_KEY)
    if state is None:
        state = ErpSyncState(key=STATE_KEY)
        session.add(state)
    return state


def get_sync_status(session: Session) -> dict[str, Any]:
    if not tables_ready(session):
        return {"available": False}
    state = _load_state(session)
    if state is None:
        return {"available": True, "covered_from": None, "covered_to": None}

    def iso(value):
        return value.isoformat() if value is not None else None

    return {
        "available": True,
        "covered_from": iso(state.covered_from),
        "covered_to": iso(state.covered_to),
        "last_recent_sync_at": iso(state.last_recent_sync_at),
        "last_nightly_sync_at": iso(state.last_nightly_sync_at),
        "last_full_sync_at": iso(state.last_full_sync_at),
        "full_sync_resume_from": iso(state.full_sync_resume_from),
        "last_error": state.last_error,
        "last_error_at": iso(state.last_error_at),
    }


# ---------------------------------------------------------------------------
# Writing: one chunk of days at a time


def _replace_chunk(session: Session, start: date, end: date, payload: dict[str, Any]) -> None:
    """Swap the stored rows for these days for what the ERP returned now.

    Rows of the same documents are removed wherever they are stored, so a slip
    whose date was changed in the ERP moves instead of being counted twice."""
    documents = payload.get("documents") or []
    names = payload.get("cost_center_names") or {}
    session.execute(delete(ErpWithdrawal).where(ErpWithdrawal.movement_date >= start, ErpWithdrawal.movement_date <= end))
    document_numbers = sorted({document["document_number"] for document in documents})
    for index in range(0, len(document_numbers), _DELETE_BATCH):
        batch = document_numbers[index:index + _DELETE_BATCH]
        session.execute(delete(ErpWithdrawal).where(ErpWithdrawal.document_number.in_(batch)))
    if documents:
        session.execute(
            insert(ErpWithdrawal),
            [
                {
                    "document_number": document["document_number"],
                    "movement_date": document["movement_date"],
                    "sku": document["sku"],
                    "cost_center": document.get("cost_center") or "",
                    "cost_center_name": names.get(document.get("cost_center") or ""),
                    "request_note": document.get("request_note"),
                    "quantity": round(float(document.get("quantity") or 0.0), 6),
                    "value": round(float(document.get("value") or 0.0), 4),
                    "line_count": int(document.get("line_count") or 0),
                }
                for document in documents
            ],
        )
    products = payload.get("products") or {}
    existing_by_sku: dict[str, ErpProduct] = {}
    skus = sorted(products)
    for index in range(0, len(skus), _DELETE_BATCH):
        batch = skus[index:index + _DELETE_BATCH]
        existing_by_sku.update({product.sku: product for product in session.scalars(select(ErpProduct).where(ErpProduct.sku.in_(batch)))})
    for sku, product in products.items():
        existing = existing_by_sku.get(sku)
        name = (product.get("name") or sku)[:255]
        unit = product.get("unit")
        if existing is None:
            session.add(ErpProduct(sku=sku, name=name, unit=unit))
        elif existing.name != name or existing.unit != unit:
            existing.name = name
            existing.unit = unit


def _extend_coverage(state: ErpSyncState, start: date, end: date) -> None:
    """Grow the covered range only when the chunk touches it, so the range
    always means "every day in here is stored"."""
    if state.covered_from is None or state.covered_to is None:
        state.covered_from, state.covered_to = start, end
        return
    if start <= state.covered_to + timedelta(days=1) and end >= state.covered_from - timedelta(days=1):
        state.covered_from = min(state.covered_from, start)
        state.covered_to = max(state.covered_to, end)


def _chunks(start: date, end: date, chunk_days: int, *, newest_first: bool) -> list[tuple[date, date]]:
    size = max(int(chunk_days), 1)
    chunks: list[tuple[date, date]] = []
    if newest_first:
        chunk_end = end
        while chunk_end >= start:
            chunk_start = max(start, chunk_end - timedelta(days=size - 1))
            chunks.append((chunk_start, chunk_end))
            chunk_end = chunk_start - timedelta(days=1)
    else:
        chunk_start = start
        while chunk_start <= end:
            chunk_end = min(end, chunk_start + timedelta(days=size - 1))
            chunks.append((chunk_start, chunk_end))
            chunk_start = chunk_end + timedelta(days=1)
    return chunks


def _fetch_with_retries(settings: Settings, start: date, end: date, *, fetch, sleep, deadline: datetime | None) -> dict[str, Any]:
    waits = list(settings.erp_sync_retry_seconds or ())
    attempt = 0
    while True:
        try:
            return fetch(settings, start_day=start, end_day=end)
        except RuntimeError:
            if attempt >= len(waits):
                raise
            wait = max(int(waits[attempt]), 0)
            attempt += 1
            if deadline is not None and _local_now() + timedelta(seconds=wait) >= deadline:
                raise
            logger.info("ERP withdrawals %s..%s failed; retrying in %ss", start, end, wait)
            sleep(wait)


def _sync_range(
    settings: Settings,
    session_factory: sessionmaker[Session],
    start: date,
    end: date,
    *,
    newest_first: bool,
    fetch=None,
    sleep: Callable[[float], None] = _pause,
    deadline: datetime | None = None,
    on_chunk_done: Callable[[ErpSyncState, date, date], None] | None = None,
) -> int:
    """Re-fetch [start, end] chunk by chunk. Each chunk is committed on its
    own, so an interrupted run keeps what it finished."""
    fetch = fetch or erp.fetch_withdrawal_documents
    chunks = _chunks(start, end, settings.erp_sync_chunk_days, newest_first=newest_first)
    stored = 0
    for index, (chunk_start, chunk_end) in enumerate(chunks):
        if _stop_event.is_set() or (deadline is not None and _local_now() >= deadline):
            raise SyncStopped()
        if index > 0 and settings.erp_sync_pause_seconds > 0:
            sleep(float(settings.erp_sync_pause_seconds))
        payload = _fetch_with_retries(settings, chunk_start, chunk_end, fetch=fetch, sleep=sleep, deadline=deadline)
        with session_factory() as session:
            _replace_chunk(session, chunk_start, chunk_end, payload)
            state = _state_for_update(session)
            _extend_coverage(state, chunk_start, chunk_end)
            if on_chunk_done is not None:
                on_chunk_done(state, chunk_start, chunk_end)
            session.commit()
        stored += len(payload.get("documents") or [])
        logger.info("ERP withdrawals %s..%s stored (%s documents)", chunk_start, chunk_end, len(payload.get("documents") or []))
    return stored


def _record_error(session_factory: sessionmaker[Session], message: str) -> None:
    try:
        with session_factory() as session:
            state = _state_for_update(session)
            state.last_error = message[:2000]
            state.last_error_at = _utcnow()
            session.commit()
    except Exception:  # pragma: no cover - never let error bookkeeping raise
        logger.exception("Could not record ERP sync error")


def _clear_error(state: ErpSyncState) -> None:
    state.last_error = None
    state.last_error_at = None


# ---------------------------------------------------------------------------
# What is due


def run_due_sync(
    settings: Settings,
    session_factory: sessionmaker[Session],
    *,
    now: datetime | None = None,
    fetch=None,
    sleep: Callable[[float], None] = _pause,
) -> str | None:
    """Run whichever sync is due, if any. Returns what ran. Called every minute
    by the app's background scheduler; overlapping calls are skipped."""
    if not sync_enabled(settings):
        return None
    if not _sync_lock.acquire(blocking=False):
        return None
    try:
        return _run_due_sync_locked(settings, session_factory, now=now or _local_now(), fetch=fetch, sleep=sleep)
    except SyncStopped:
        return "stopped"
    except Exception as exc:
        logger.warning("ERP withdrawal sync failed: %s", exc)
        _record_error(session_factory, str(exc))
        return "failed"
    finally:
        _sync_lock.release()


def _run_due_sync_locked(settings: Settings, session_factory, *, now: datetime, fetch, sleep) -> str | None:
    with session_factory() as session:
        if not tables_ready(session):
            return None
        state = _load_state(session)
        covered_from = state.covered_from if state else None
        covered_to = state.covered_to if state else None
        last_recent = _as_aware(state.last_recent_sync_at) if state else None
        last_nightly = _as_aware(state.last_nightly_sync_at) if state else None
        last_full = _as_aware(state.last_full_sync_at) if state else None
        resume_from = state.full_sync_resume_from if state else None
        last_error_at = _as_aware(state.last_error_at) if state else None

    # After a failure, wait a while before asking the ERP again.
    if last_error_at is not None and _utcnow() - last_error_at < timedelta(minutes=30):
        return None

    today = _today()
    history_start = _history_start(settings, today)
    night = _in_night_window(settings, now)
    # How long the night window still lasts, measured from `now`, as a wall-clock deadline.
    night_end = _local_now() + (_night_window_end(settings, now) - now) if night else None

    # 1. First load (or a longer window configured): newest month first.
    if covered_from is None or covered_to is None or covered_from > history_start:
        top = today if covered_from is None or covered_to is None else covered_from - timedelta(days=1)
        if covered_to is not None and covered_to < today:
            # Close any gap at the recent end first so the range stays whole.
            _sync_recent(settings, session_factory, start=covered_to - timedelta(days=INTRADAY_DAYS), today=today, fetch=fetch, sleep=sleep)
        def mark_initial(state: ErpSyncState, chunk_start: date, chunk_end: date) -> None:
            _clear_error(state)
            if chunk_end >= today:
                state.last_recent_sync_at = _utcnow()

        _sync_range(settings, session_factory, history_start, top, newest_first=True, fetch=fetch, sleep=sleep, on_chunk_done=mark_initial)
        with session_factory() as session:
            state = _state_for_update(session)
            # A fresh load is as good as a full re-check: the next one is due in a month.
            state.last_full_sync_at = state.last_full_sync_at or _utcnow()
            session.commit()
        return "initial"

    # 2. At night: re-check the last 30 days, then the monthly full re-check.
    if night and (last_nightly is None or last_nightly.astimezone(now.tzinfo).date() < now.date()):
        recent_days = max(int(settings.erp_sync_recent_days), 30)
        start = min(today, covered_to) - timedelta(days=recent_days)

        def mark_nightly(state: ErpSyncState, chunk_start: date, chunk_end: date) -> None:
            _mark_ok(state, chunk_start, chunk_end)
            if chunk_end >= today:
                state.last_recent_sync_at = _utcnow()

        _sync_range(settings, session_factory, start, today, newest_first=True, fetch=fetch, sleep=sleep, deadline=night_end, on_chunk_done=mark_nightly)
        with session_factory() as session:
            state = _state_for_update(session)
            state.last_nightly_sync_at = _utcnow()
            session.commit()
        return "nightly"

    full_due = resume_from is not None or last_full is None or _utcnow() - last_full >= timedelta(days=max(int(settings.erp_sync_full_interval_days), 1))
    if night and full_due:
        top = resume_from or today

        def mark_full(state: ErpSyncState, chunk_start: date, chunk_end: date) -> None:
            _mark_ok(state, chunk_start, chunk_end)
            # Remember where to pick up if the night ends before we finish.
            state.full_sync_resume_from = chunk_start - timedelta(days=1)

        _sync_range(settings, session_factory, history_start, top, newest_first=True, fetch=fetch, sleep=sleep, deadline=night_end, on_chunk_done=mark_full)
        with session_factory() as session:
            state = _state_for_update(session)
            state.full_sync_resume_from = None
            state.last_full_sync_at = _utcnow()
            session.commit()
        return "full"

    # 3. During the day: pick up today's new withdrawals every hour or so.
    interval = timedelta(minutes=max(int(settings.erp_sync_intraday_minutes), 5))
    if covered_to < today - timedelta(days=1) or last_recent is None or _utcnow() - last_recent >= interval:
        _sync_recent(settings, session_factory, start=min(today - timedelta(days=INTRADAY_DAYS - 1), covered_to), today=today, fetch=fetch, sleep=sleep)
        return "recent"
    return None


def _mark_ok(state: ErpSyncState, chunk_start: date, chunk_end: date) -> None:
    _clear_error(state)


def _sync_recent(settings: Settings, session_factory, *, start: date, today: date, fetch, sleep) -> None:
    def mark(state: ErpSyncState, chunk_start: date, chunk_end: date) -> None:
        _clear_error(state)
        if chunk_end >= today:
            state.last_recent_sync_at = _utcnow()

    _sync_range(settings, session_factory, start, today, newest_first=True, fetch=fetch, sleep=sleep, on_chunk_done=mark)


def run_full_resync(settings: Settings, session_factory: sessionmaker[Session], *, fetch=None, sleep: Callable[[float], None] = _pause) -> int:
    """Re-fetch the whole window now (for the command-line script). Paced the
    same way as the scheduled sync."""
    with _sync_lock:
        today = _today()

        def mark(state: ErpSyncState, chunk_start: date, chunk_end: date) -> None:
            _clear_error(state)
            if chunk_end >= today:
                state.last_recent_sync_at = _utcnow()

        stored = _sync_range(settings, session_factory, _history_start(settings, today), today, newest_first=True, fetch=fetch, sleep=sleep, on_chunk_done=mark)
        with session_factory() as session:
            state = _state_for_update(session)
            state.full_sync_resume_from = None
            state.last_full_sync_at = _utcnow()
            session.commit()
        return stored


# ---------------------------------------------------------------------------
# Reading


def store_covers(session: Session | None, start: date, end: date) -> bool:
    """True when the stored copy holds every day from `start` and is current."""
    if session is None:
        return False
    try:
        if not tables_ready(session):
            return False
        state = _load_state(session)
    except (ProgrammingError, OperationalError):
        session.rollback()
        return False
    if state is None or state.covered_from is None or state.covered_to is None:
        return False
    if state.covered_from > start:
        return False
    # Stale copy (sync stopped for a day or more): ask the ERP instead.
    return state.covered_to >= min(end, _today()) - timedelta(days=1)


def _resolve_range(days: int, start_day: date | None, end_day: date | None) -> tuple[date, date]:
    end = end_day or datetime.now(timezone.utc).date()
    start = start_day
    if start is None:
        start = end - timedelta(days=max(int(days), 1) - 1)
    elif start > end:
        raise ValueError("start_day must be on or before end_day")
    return start, end


def _cost_center_matcher(cost_centers: Sequence[str], excluded_cost_centers: Sequence[str]) -> Callable[[str], bool]:
    """Same rules as the ERP query: "01-00-00" means every "01…" center,
    "01-02-00" every "01-02…" center, anything else that exact center."""

    def scope_test(codes: Sequence[str]) -> Callable[[str], bool]:
        exact: set[str] = set()
        prefixes: list[str] = []
        for code in codes:
            scope = erp._cost_center_scope_prefix(code)
            if scope is None:
                exact.add(code.strip())
            else:
                prefixes.append(scope[1])
        return lambda center: center in exact or any(center[:len(prefix)] == prefix for prefix in prefixes)

    included = [code for code in (cost_centers or []) if code and code.strip()]
    excluded = [code for code in (excluded_cost_centers or []) if code and code.strip()]
    if included:
        return scope_test(included)
    if excluded:
        test = scope_test(excluded)
        return lambda center: not test(center)
    return lambda center: True


def _stored_rows(session: Session, sku: str, start: date, end: date) -> list[ErpWithdrawal]:
    return list(
        session.scalars(
            select(ErpWithdrawal).where(
                ErpWithdrawal.sku == sku,
                ErpWithdrawal.movement_date >= start,
                ErpWithdrawal.movement_date <= end,
            )
        )
    )


def movement_history(
    settings: Settings,
    sku: str,
    *,
    session: Session | None = None,
    days: int = 90,
    start_day: date | None = None,
    end_day: date | None = None,
    cost_centers: Sequence[str] | None = None,
    excluded_cost_centers: Sequence[str] | None = None,
) -> list[dict[str, Any]]:
    """Daily withdrawn quantity of one material; same shape as
    `erp.get_material_movement_history`."""
    normalized_sku = sku.strip().upper()
    start, end = _resolve_range(days, start_day, end_day)
    if not normalized_sku or not store_covers(session, start, end):
        return erp.get_material_movement_history(
            settings, sku, days=days, start_day=start_day, end_day=end_day,
            cost_centers=cost_centers, excluded_cost_centers=excluded_cost_centers,
        )
    matches = _cost_center_matcher(erp._normalize_cost_centers(cost_centers), erp._normalize_cost_centers(excluded_cost_centers))
    by_day: dict[date, float] = defaultdict(float)
    for row in _stored_rows(session, normalized_sku, start, end):
        if matches(row.cost_center):
            by_day[row.movement_date] += row.quantity
    return [
        {"date": (start + timedelta(days=offset)).isoformat(), "quantity": round(by_day.get(start + timedelta(days=offset), 0.0), 4)}
        for offset in range((end - start).days + 1)
    ]


def movement_details(
    settings: Settings,
    sku: str,
    *,
    session: Session | None = None,
    days: int = 90,
    start_day: date | None = None,
    end_day: date | None = None,
    cost_centers: Sequence[str] | None = None,
    excluded_cost_centers: Sequence[str] | None = None,
) -> list[dict[str, Any]]:
    """Each withdrawal slip of one material; same shape as
    `erp.get_material_movement_details`."""
    normalized_sku = sku.strip().upper()
    start, end = _resolve_range(days, start_day, end_day)
    if not normalized_sku or not store_covers(session, start, end):
        return erp.get_material_movement_details(
            settings, sku, days=days, start_day=start_day, end_day=end_day,
            cost_centers=cost_centers, excluded_cost_centers=excluded_cost_centers,
        )
    matches = _cost_center_matcher(erp._normalize_cost_centers(cost_centers), erp._normalize_cost_centers(excluded_cost_centers))
    rows = [
        {
            "date": row.movement_date.isoformat(),
            "quantity": round(row.quantity, 4),
            "ceco": row.cost_center or None,
            "ceco_name": row.cost_center_name or None,
            "desc_sub": row.request_note or None,
            "movement_internal_number": row.document_number or None,
            "line_count": row.line_count,
        }
        for row in _stored_rows(session, normalized_sku, start, end)
        if matches(row.cost_center)
    ]
    # Newest first, then largest, as the ERP query orders them.
    rows.sort(key=lambda row: (row["date"], row["quantity"], row["movement_internal_number"] or ""), reverse=True)
    return rows


def outgoing_withdrawals(settings: Settings, *, session: Session | None, start_day: date, end_day: date) -> dict[str, Any]:
    """Every withdrawal in the period grouped by material, day and cost center;
    same shape as `erp.get_outgoing_withdrawals`."""
    if not store_covers(session, start_day, end_day):
        return erp.get_outgoing_withdrawals(settings, start_day=start_day, end_day=end_day)
    grouped: dict[tuple[str, date, str], list[float]] = defaultdict(lambda: [0.0, 0.0])
    result = session.execute(
        select(ErpWithdrawal.sku, ErpWithdrawal.movement_date, ErpWithdrawal.cost_center, ErpWithdrawal.quantity, ErpWithdrawal.value).where(
            ErpWithdrawal.movement_date >= start_day,
            ErpWithdrawal.movement_date <= end_day,
        )
    )
    for sku, day, center, quantity, value in result:
        totals = grouped[(sku, day, center or "")]
        totals[0] += quantity
        totals[1] += value
    rows = [
        [sku, day.isoformat(), center, round(quantity, 4), round(value, 2)]
        for (sku, day, center), (quantity, value) in grouped.items()
    ]
    skus = {row[0] for row in rows}
    products = {
        product.sku: {"name": product.name, "unit": product.unit}
        for product in session.scalars(select(ErpProduct))
        if product.sku in skus
    }
    return {"rows": rows, "products": products}


def store_version(session: Session | None) -> str | None:
    """Changes whenever the stored copy is updated; for in-memory caches built
    on top of it."""
    if session is None:
        return None
    try:
        if not tables_ready(session):
            return None
        state = _load_state(session)
    except (ProgrammingError, OperationalError):
        session.rollback()
        return None
    if state is None:
        return None
    stamps = [state.last_recent_sync_at, state.last_nightly_sync_at, state.last_full_sync_at]
    latest = max((_as_aware(stamp) for stamp in stamps if stamp is not None), default=None)
    return f"{state.covered_from}:{state.covered_to}:{latest.isoformat() if latest else ''}"
