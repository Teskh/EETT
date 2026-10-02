"""Historic consumption study for the cost model.

Loads production houses, their BOMs and ERP withdrawals, applies the cost
center exclusion policy and delegates the analysis to consumption_study.
"""

from __future__ import annotations

import re
from datetime import date, datetime, timedelta, timezone
from threading import Lock
from time import monotonic

from sqlalchemy import delete, select
from sqlalchemy.exc import OperationalError, ProgrammingError
from sqlalchemy.orm import Session

from app.config import Settings
from app.models import ConsumptionCecoExclusion, User
from app.services import consumption_study as cs
from app.services import erp_history
from app.services.dashboard import _load_material_dashboard_cache, get_production_house_starts_with_links_and_maps
from app.services.effective_bom import QUANTITY_BASES
from app.services.erp import get_cost_centers, get_outgoing_withdrawals
from app.services.house_type_links import expected_quantities_for_link

HISTORY_DAYS = 730
MAX_PERIOD_DAYS = 730
WITHDRAWALS_CACHE_KIND = "withdrawals"
WITHDRAWALS_TTL = timedelta(hours=2)
_MEMORY_TTL_SECONDS = 600
_memory: dict[str, tuple[float, dict]] = {}
_memory_lock = Lock()
RULE_PATTERN = re.compile(r"^(\d{2}|\*-\d{2}|\d{2}-\d{2}-\d{2})$")

# By topic (area), never by site: cost centers are often misallocated across
# projects. Used until the exclusions table exists; its migration seeds them.
DEFAULT_CECO_EXCLUSIONS = [
    ("05", "Administración y finanzas: 10% de sus salidas son materiales de algún presupuesto."),
    ("06", "Prevención de riesgos: elementos de protección, ninguno en presupuestos."),
    ("07", "Mantención: repuestos e insumos de la planta (36% en presupuestos)."),
    ("08", "Oficina de desarrollo: prototipos y pruebas."),
    ("09", "Calidad."),
    ("10", "Logística: 1% de sus salidas son materiales de algún presupuesto."),
    ("11", "Obra: instalación en terreno, meses después de la fábrica."),
    ("12", "Urbanización: obras del loteo, no de la vivienda (32% en presupuestos)."),
    ("14", "Postventa: reparaciones de viviendas ya entregadas."),
    ("15", "Abastecimiento."),
    ("17", "Operaciones vivienda."),
    ("19", "Recursos humanos."),
    ("20", "Tecnología y sistemas."),
    ("21", "Impregnadora: planta de tratamiento de madera."),
    ("23", "Mejora continua."),
    ("24", "Patio."),
]
# Q_obra counts only site work (11 Obra): the factory areas are left out too.
FACTORY_AREAS = [
    ("01", "Preparación de materiales: fábrica."),
    ("02", "Paneles: fábrica."),
    ("03", "Armado: fábrica."),
    ("04", "Terminaciones: fábrica."),
    ("13", "Maestranza: fábrica."),
]
DEFAULT_EXCLUSIONS_BY_BASIS = {
    "factory": DEFAULT_CECO_EXCLUSIONS,
    "work": [item for item in DEFAULT_CECO_EXCLUSIONS if item[0] != "11"] + FACTORY_AREAS,
    "total": [item for item in DEFAULT_CECO_EXCLUSIONS if item[0] != "11"],
}


def _check_basis(basis: str) -> str:
    if basis not in QUANTITY_BASES:
        raise ValueError(f"Base de cantidad no válida: {basis}")
    return basis


def list_ceco_exclusions(session: Session, basis: str = "factory") -> dict:
    """The cost centers left out of the historic consumption for one quantity basis."""
    _check_basis(basis)
    try:
        rows = session.scalars(
            select(ConsumptionCecoExclusion).where(ConsumptionCecoExclusion.basis == basis).order_by(ConsumptionCecoExclusion.rule)
        ).all()
    except (ProgrammingError, OperationalError):
        session.rollback()
        return {"stored": False, "basis": basis, "rules": [{"rule": rule, "note": note} for rule, note in DEFAULT_EXCLUSIONS_BY_BASIS[basis]]}
    return {"stored": True, "basis": basis, "rules": [{"rule": row.rule, "note": row.note} for row in rows]}


def replace_ceco_exclusions(session: Session, rules: list[dict], *, actor: User | None, basis: str = "factory") -> dict:
    _check_basis(basis)
    seen: dict[str, str | None] = {}
    for item in rules:
        rule = str(item.get("rule") or "").strip()
        if not RULE_PATTERN.match(rule):
            raise ValueError(f"Regla de centro de costo no válida: {rule or '(vacía)'}")
        seen[rule] = str(item.get("note") or "").strip() or None
    session.execute(delete(ConsumptionCecoExclusion).where(ConsumptionCecoExclusion.basis == basis))
    for rule, note in sorted(seen.items()):
        session.add(ConsumptionCecoExclusion(basis=basis, rule=rule, note=note, created_by_user_id=actor.id if actor else None))
    session.commit()
    return list_ceco_exclusions(session, basis)


def _history_window() -> tuple[date, date]:
    today = datetime.now(timezone.utc).date()
    return today - timedelta(days=HISTORY_DAYS), today


def _remember(key: str, loader):
    """Keep the parsed withdrawals in memory between requests: the database
    cache survives restarts, but decoding it on every request is wasteful."""
    now = monotonic()
    with _memory_lock:
        cached = _memory.get(key)
        if cached and now - cached[0] < _MEMORY_TTL_SECONDS:
            return cached[1]
    value = loader()
    with _memory_lock:
        # Drop expired entries so keys that change over time don't pile up.
        for stale in [name for name, (stamp, _) in _memory.items() if now - stamp >= _MEMORY_TTL_SECONDS]:
            del _memory[stale]
        _memory[key] = (now, value)
    return value


def _withdrawals(settings: Settings, session: Session) -> dict:
    start, end = _history_window()
    if erp_history.store_covers(session, start, end):
        # Our stored copy of the ERP: remembered until the next sync changes it.
        key = f"stored:{start.isoformat()}:{end.isoformat()}:{erp_history.store_version(session)}"

        def load_stored():
            payload = erp_history.outgoing_withdrawals(settings, session=session, start_day=start, end_day=end)
            rows = [cs.Withdrawal(sku, date.fromisoformat(day), center, quantity, value) for sku, day, center, quantity, value in payload["rows"]]
            return {"rows": rows, "products": payload.get("products", {})}

        return _remember(f"withdrawals:{key}", load_stored)

    key = f"{start.isoformat()}:{end.isoformat()}"

    def load():
        payload = _load_material_dashboard_cache(
            session, cache_kind=WITHDRAWALS_CACHE_KIND, cache_key=key, ttl=WITHDRAWALS_TTL,
            loader=lambda: get_outgoing_withdrawals(settings, start_day=start, end_day=end), force_refresh=False,
        )
        rows = [cs.Withdrawal(sku, date.fromisoformat(day), center, quantity, value) for sku, day, center, quantity, value in payload["rows"]]
        return {"rows": rows, "products": payload.get("products", {})}

    return _remember(f"withdrawals:{key}", load)


def _cost_center_names(settings: Settings) -> dict[str, str]:
    try:
        return _remember("cost-centers", lambda: {center["code"]: center["name"] for center in get_cost_centers(settings)})
    except RuntimeError:
        return {}


def _production(settings: Settings, session: Session, project_id: int, basis: str = "factory") -> tuple[dict, dict, list[cs.House]]:
    start, end = _history_window()
    production, expected_maps = get_production_house_starts_with_links_and_maps(
        settings, session=session, start_date=start, end_date=end, extra_project_ids={project_id}, basis=basis,
    )
    houses = []
    for house in production["houses"]:
        day = house.get("start_date")
        day = day if isinstance(day, date) else date.fromisoformat(str(day)[:10])
        if not house.get("mapped"):
            houses.append(cs.House(day=day, project_id=None, subtype_id=None))
            continue
        link = {"project_id": house["mapped_project_id"], "project_subtype_id": house.get("mapped_project_subtype_id")}
        missing: frozenset[str] = frozenset()
        if house.get("missing_quantity_count"):
            by_subtype = expected_maps.get(link["project_id"], {}).get("missing_skus_by_subtype", {})
            missing = frozenset(by_subtype.get(link["project_subtype_id"], []))
        houses.append(cs.House(
            day=day, project_id=link["project_id"], subtype_id=link["project_subtype_id"],
            quantities=expected_quantities_for_link(link, expected_maps), incomplete_skus=missing,
        ))
    return production, expected_maps, houses


def _group_key(project_id: int | None, subtype_id: int | None) -> str:
    return "unmapped" if project_id is None else f"{project_id}:{subtype_id if subtype_id is not None else 'general'}"


def get_cost_model_timeline(settings: Settings, *, session: Session, project_id: int) -> dict:
    """Weekly house starts of every project, to choose the study period."""
    production, _expected_maps, houses = _production(settings, session, project_id)
    groups: dict[str, dict] = {}
    for house in production["houses"]:
        mapped = bool(house.get("mapped"))
        project = house.get("mapped_project_id") if mapped else None
        subtype = house.get("mapped_project_subtype_id") if mapped else None
        key = _group_key(project, subtype)
        group = groups.setdefault(key, {
            "key": key, "project_id": project, "subtype_id": subtype,
            "project_name": house.get("mapped_project_name") if mapped else None,
            "subtype_name": house.get("mapped_project_subtype_name") if mapped else None,
            "houses": 0,
        })
        group["houses"] += 1
    data_start = min((house.day for house in houses), default=None)
    suggested = cs.suggest_period(houses, project_id, data_start) if data_start else None
    return {
        "project_id": project_id,
        "data_start": data_start.isoformat() if data_start else None,
        "data_end": max(house.day for house in houses).isoformat() if houses else None,
        "suggested": {"start_date": suggested[0].isoformat(), "end_date": suggested[1].isoformat()} if suggested else None,
        "groups": sorted(groups.values(), key=lambda item: (item["project_id"] is None, item["project_name"] or "", item["subtype_name"] or "")),
        "weeks": [
            {"week": week["week"], "starts": [{"key": _group_key(item["project_id"], item["subtype_id"]), "houses": item["houses"]} for item in week["starts"]]}
            for week in cs.production_timeline(houses)
        ],
    }


def get_cost_model_material_series(settings: Settings, *, session: Session, project_id: int, sku: str, start_date: date, end_date: date, basis: str = "factory") -> dict:
    """One material's daily series in the study's terms, so its chart and the
    budget table say the same thing."""
    if start_date > end_date:
        raise ValueError("La fecha inicial debe ser anterior a la fecha final.")
    if (end_date - start_date).days > MAX_PERIOD_DAYS:
        raise ValueError("Selecciona un período de hasta dos años.")
    sku = sku.strip().upper()
    _payload, expected_maps, houses = _production(settings, session, project_id, _check_basis(basis))
    if project_id not in expected_maps:
        raise ValueError("Proyecto no encontrado.")
    rules = [item["rule"] for item in list_ceco_exclusions(session, basis)["rules"]]
    excluded = cs.exclusion_filter(rules)
    rows = [row for row in _withdrawals(settings, session)["rows"] if row.sku == sku]
    site_share = cs.site_shares(row for row in rows if not excluded(row.cost_center)).get(sku, 0.0)
    in_period = [house for house in houses if start_date <= house.day <= end_date]
    return {
        "project_id": project_id,
        "sku": sku,
        "range_start": start_date.isoformat(),
        "range_end": end_date.isoformat(),
        "site_share": round(site_share, 3),
        "other_houses": sum(1 for house in in_period if house.mapped and house.project_id != project_id),
        "unmapped_houses": sum(1 for house in in_period if not house.mapped),
        "points": cs.material_series(
            project_id=project_id, sku=sku, start=start_date, end=end_date, houses=houses, withdrawals=rows,
            site_share=site_share, excluded_cost_centers=rules,
        ),
    }


def get_cost_model_study(settings: Settings, *, session: Session, project_id: int, start_date: date, end_date: date, basis: str = "factory") -> dict:
    if start_date > end_date:
        raise ValueError("La fecha inicial debe ser anterior a la fecha final.")
    if (end_date - start_date).days > MAX_PERIOD_DAYS:
        raise ValueError("Selecciona un período de hasta dos años.")
    _payload, expected_maps, houses = _production(settings, session, project_id, _check_basis(basis))
    project_map = expected_maps.get(project_id)
    if project_map is None:
        raise ValueError("Proyecto no encontrado.")
    variants = list(project_map.get("subtype_paths", {}).keys()) or [None]
    target_quantities = {
        subtype_id: expected_quantities_for_link({"project_id": project_id, "project_subtype_id": subtype_id}, expected_maps)
        for subtype_id in variants
    }
    exclusions = list_ceco_exclusions(session, basis)
    rules = [item["rule"] for item in exclusions["rules"]]
    withdrawals = _withdrawals(settings, session)
    products = withdrawals["products"]
    excluded = cs.exclusion_filter(rules)
    site_share = cs.site_shares(row for row in withdrawals["rows"] if not excluded(row.cost_center))
    excluded_share = cs.excluded_shares(withdrawals["rows"], excluded)
    result = cs.study_project(
        project_id=project_id, start=start_date, end=end_date, houses=houses, withdrawals=withdrawals["rows"],
        target_quantities=target_quantities, site_share=site_share,
        data_start=min((house.day for house in houses), default=start_date),
        excluded_cost_centers=rules, names={sku: product.get("name") or "" for sku, product in products.items()},
        units={sku: product.get("unit") for sku, product in products.items()},
        excluded_share=excluded_share,
    )
    centers = _cost_center_names(settings)
    for item in result["unbudgeted"]:
        item["main_cost_center_name"] = centers.get(item["main_cost_center"] or "")
        product = products.get(item["sku"], {})
        item["name"], item["unit"] = product.get("name") or item["sku"], product.get("unit")
        for candidate in item["replaces"]:
            candidate["name"] = (products.get(candidate["sku"]) or {}).get("name") or candidate["sku"]
    result["exclusions"] = exclusions
    result["basis"] = basis
    result["generated_at"] = datetime.now(timezone.utc).isoformat()
    return result
