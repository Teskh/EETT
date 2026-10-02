"""Snapshot of a project's Modelo de costos, for estimating the cost of a house.

Run from Backend/ with its venv (read-only: it never writes to the database):

    PYTHONIOENCODING=utf-8 venv/Scripts/python.exe ../.agents/skills/modelo-de-costos/scripts/cost_snapshot.py \
        --project 8 --subtypes 19,20 --out <scratchpad>/snapshot.json

Without --start/--end it uses the study period the page suggests. It prints a
per-subtype summary and writes every budget line, the study, the materials
outside the BOM and the material groups to --out for further analysis.

Budget lines follow the page (Frontend/src/pages/costModel/budget.ts):
scenario adjustments replace the whole quantity; `hist` is the study's
historic quantity per house for that subtype.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import date
from pathlib import Path

BACKEND = Path.cwd()
sys.path.insert(0, str(BACKEND))

from app.config import Settings  # noqa: E402
from app.database import create_session_factory  # noqa: E402
from app.services.cost_model import get_cost_model_view  # noqa: E402
from app.services.cost_model_extras import get_cost_model_extras  # noqa: E402
from app.services.cost_model_study import get_cost_model_study, get_cost_model_timeline  # noqa: E402
from app.services.material_groups import list_material_study_groups  # noqa: E402


def component(row: dict, subtype_id: int | None) -> float | None:
    entry = next((item for item in row["subtypes"] if item["subtype_id"] == subtype_id), None)
    if entry is None:
        return 0.0
    return None if entry.get("has_missing_quantity") else entry["estimated_quantity"]


def budget_lines(view: dict, study: dict, subtype_id: int) -> list[dict]:
    materials = {item["sku"]: item for item in study["materials"]}
    lines = []
    for row in view["rows"]:
        belongs = any(item["subtype_id"] in (None, subtype_id) for item in row["subtypes"])
        if not belongs and not any(adj.get("subtype_id") == subtype_id for adj in row["adjustments"]):
            continue
        general, own = component(row, None), component(row, subtype_id)
        estimate = None if general is None or own is None else general + own
        adjustment = next((adj for adj in row["adjustments"] if adj.get("subtype_id") == subtype_id), None)
        quantity, source = estimate, "estimated"
        if adjustment and adjustment.get("quantity_scope") == "scenario":
            source = adjustment["source_kind"]
            quantity = estimate if source == "estimated" else adjustment["adjusted_quantity"]
        elif adjustment:
            source, quantity = "legacy", adjustment["adjusted_quantity"]
        price = row["price"] if row["price"] and row["price"] > 0 else None
        material = materials.get(str(row["sku"]).strip().upper())
        historic = material["quantity_per_house"].get(str(subtype_id)) if material else None
        lines.append({
            "sku": row["sku"], "name": row["material_name"], "unit": row["unit"], "price": price,
            "estimate": estimate, "quantity": quantity, "source": source, "historic": historic,
            "grade": material and material["grade"], "ratio": material and material["ratio"],
            "reasons": material and material["reasons"], "excluded_share": material and material["excluded_share"],
            "stability": material and material["signals"].get("stability"),
            "estimated_cost": (estimate or 0) * (price or 0), "budget_cost": (quantity or 0) * (price or 0),
            "historic_cost": None if historic is None else historic * (price or 0),
        })
    return lines


def extras_per_house(study: dict, extras: dict) -> tuple[float, list[dict]]:
    decisions = {item["sku"]: item for item in extras["items"]}
    include_default = extras["default"] == "include"
    total, rows = 0.0, []
    for item in study["unbudgeted"]:
        decision = decisions.get(item["sku"])
        included = decision["included"] if decision else include_default
        value = item["value_per_house"]
        if decision and decision.get("quantity_per_house") is not None:
            unit_cost = decision.get("unit_cost") or (item["value_per_house"] / item["quantity_per_house"] if item["quantity_per_house"] else 0)
            value = decision["quantity_per_house"] * unit_cost
        rows.append({**item, "included": included, "decided": decision is not None, "budget_value_per_house": value})
        if included:
            total += value
    return total, rows


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--project", type=int, required=True)
    parser.add_argument("--subtypes", default="", help="Comma-separated subtype ids; default: all variants")
    parser.add_argument("--start")
    parser.add_argument("--end")
    parser.add_argument("--basis", default="factory", choices=["factory", "work", "total"], help="Q_fábrica, Q_obra or both")
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    settings = Settings()
    factory = create_session_factory(settings.database_url)
    with factory() as session:
        timeline = get_cost_model_timeline(settings, session=session, project_id=args.project)
        period = timeline["suggested"] or {"start_date": timeline["data_start"], "end_date": timeline["data_end"]}
        start = date.fromisoformat(args.start or period["start_date"])
        end = date.fromisoformat(args.end or period["end_date"])
        view = get_cost_model_view(session, args.project, settings=settings, live_prices=True, basis=args.basis)
        study = get_cost_model_study(settings, session=session, project_id=args.project, start_date=start, end_date=end, basis=args.basis)
        extras = get_cost_model_extras(session, args.project, args.basis)
        groups = list_material_study_groups(session)

    subtypes = [int(value) for value in args.subtypes.split(",") if value] or [item["id"] for item in view["flat_subtypes"]]
    names = {item["id"]: item["name"] for item in view["flat_subtypes"]}
    extras_total, extras_rows = extras_per_house(study, extras)
    print(f"{view['project']['name']} · base {args.basis} · período {start} a {end} · casas {study['houses']}")
    print(f"Fuera de presupuesto incluido / viv.: {extras_total:,.0f} ({sum(1 for row in extras_rows if row['included'])} de {len(extras_rows)})")
    by_subtype = {}
    for subtype_id in subtypes:
        lines = budget_lines(view, study, subtype_id)
        by_subtype[subtype_id] = lines
        estimated = sum(line["estimated_cost"] for line in lines)
        budget = sum(line["budget_cost"] for line in lines)
        print(f"{names.get(subtype_id, subtype_id)}: BOM estimado {estimated:,.0f} · BOM presupuesto {budget:,.0f} · "
              f"total con fuera de presupuesto {budget + extras_total:,.0f} · ajustados {sum(1 for line in lines if line['source'] != 'estimated')} · "
              f"sin precio {sum(1 for line in lines if line['price'] is None)} · sin cantidad {sum(1 for line in lines if line['estimate'] is None)}")

    Path(args.out).write_text(json.dumps({
        "project": view["project"], "range": [start.isoformat(), end.isoformat()], "timeline": timeline,
        "lines": {str(key): value for key, value in by_subtype.items()}, "study": study,
        "extras": extras, "extras_rows": extras_rows, "extras_total": extras_total, "groups": groups,
    }, default=str, ensure_ascii=False), encoding="utf-8")
    print(f"Detalle en {args.out}")


if __name__ == "__main__":
    main()
