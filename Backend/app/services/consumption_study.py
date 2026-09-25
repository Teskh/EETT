"""Historic consumption study for one project over a period.

Pure functions only: callers load production houses, ERP withdrawals and BOM
quantities. The study answers, per material, "how much does a house of this
project really consume?" and how much that answer can be trusted.

Model
-----
Withdrawals are not tagged by house, so each material's withdrawals in the
period are compared with the consumption expected from every house whose
consumption falls in the period. A house does not consume everything the week
it starts: factory withdrawals follow within about two weeks, while site work
("Obra") follows months later. Each material splits its expected quantity
between both streams according to its own withdrawal history.

The project's ratio (real / expected) is applied to each subtype's BOM. The
production mix is implicit: it is whatever houses were started in the period.
When other projects share the period, the ratio assumes they deviate alike;
where the mix varied enough, the project's ratio is separated from the rest.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, timedelta
from math import log, sqrt
from typing import Iterable, Mapping

# Share of a house's factory consumption withdrawn in the weeks after its start
# (week 0 = start week). Fitted to the ramp-downs of Sol de Quillón and Jardines
# de San Pedro, where withdrawals halved the week after the last start.
FACTORY_PROFILE = {0: 0.65, 1: 0.30, 2: 0.05}
# Site work follows the factory by roughly one to six months.
SITE_PROFILE = {week: 1 / 22 for week in range(5, 27)}
SITE_AREAS = frozenset({"11"})
LOOKBACK_WEEKS = max(max(FACTORY_PROFILE), max(SITE_PROFILE)) + 1

# Grading thresholds, calibrated by backtest: each clean campaign (Jardines de
# San Pedro, Sol de Quillón, Los Escritores) was split in halves and the first
# half's ratio compared with the second's. Each signal's error grew steadily
# past these values (see docs/cost-model-budget.md).
MIN_HOUSES_HIGH = 10
MIN_HOUSES_LOW = 4
MIN_SHARE_HIGH = 0.6
MIN_SHARE_LOW = 0.25
MAX_TRACKING_HIGH = 0.12
MAX_TRACKING_LOW = 0.30
MAX_EDGE_HIGH = 0.15
MAX_EDGE_LOW = 0.25
MAX_BREAK_HIGH = 1.6
MAX_BREAK_LOW = 3.0
MIN_ACTIVE_HIGH = 0.75
MIN_ACTIVE_LOW = 0.5
MAX_SITE_HIGH = 0.3
MAX_SITE_LOW = 0.5
PLAUSIBLE_RATIO = (0.5, 2.0)
MIN_IDENTIFIABILITY = 0.5
RELEVANT_DEVIATION = 0.10
MAX_EXCLUDED_SHARE = 0.5
# After a switch the old material keeps at most this share of its usage.
SWITCH_REMAINDER = 0.35
# Replacements worth reviewing: cheaper consumables (brushes, sandpaper) are not.
MIN_REPLACEMENT_VALUE_PER_HOUSE = 2000


@dataclass
class House:
    day: date
    project_id: int | None
    subtype_id: int | None
    quantities: Mapping[str, float] = field(default_factory=dict)
    incomplete_skus: frozenset[str] = frozenset()

    @property
    def mapped(self) -> bool:
        return self.project_id is not None


@dataclass
class Withdrawal:
    sku: str
    day: date
    cost_center: str
    quantity: float
    value: float = 0.0


def monday(day: date) -> date:
    return day - timedelta(days=day.weekday())


def ceco_matches(code: str, rule: str) -> bool:
    """Rules: "05" (area), "*-34" (site in any area) or an exact center code."""
    parts = code.split("-")
    if rule.startswith("*-"):
        return len(parts) > 1 and parts[1] == rule[2:]
    if "-" not in rule:
        return parts[0] == rule
    return code == rule


def is_excluded(code: str, rules: Iterable[str]) -> bool:
    return any(ceco_matches(code, rule) for rule in rules)


def exclusion_filter(rules: Iterable[str]):
    """is_excluded for many withdrawals: few distinct cost centers repeat."""
    rules = list(rules)
    cache: dict[str, bool] = {}

    def excluded(code: str) -> bool:
        if code not in cache:
            cache[code] = is_excluded(code, rules)
        return cache[code]

    return excluded


def is_site(code: str) -> bool:
    return code.split("-")[0] in SITE_AREAS


def excluded_shares(withdrawals: Iterable[Withdrawal], excluded) -> dict[str, float]:
    """Share of each material withdrawn through excluded cost centers."""
    total: dict[str, float] = defaultdict(float)
    left_out: dict[str, float] = defaultdict(float)
    for row in withdrawals:
        total[row.sku] += row.quantity
        if excluded(row.cost_center):
            left_out[row.sku] += row.quantity
    return {sku: left_out[sku] / value for sku, value in total.items() if value > 0}


def site_shares(withdrawals: Iterable[Withdrawal]) -> dict[str, float]:
    """Share of each material withdrawn through site cost centers."""
    total: dict[str, float] = defaultdict(float)
    site: dict[str, float] = defaultdict(float)
    for row in withdrawals:
        total[row.sku] += row.quantity
        if is_site(row.cost_center):
            site[row.sku] += row.quantity
    return {sku: site[sku] / value for sku, value in total.items() if value > 0}


class Window:
    """Business-day coverage of each week by the period [start, end]."""

    def __init__(self, start: date, end: date):
        self.start, self.end = start, end
        self._cache: dict[date, float] = {}

    def coverage(self, week: date) -> float:
        if week not in self._cache:
            days = sum(1 for offset in range(5) if self.start <= week + timedelta(days=offset) <= self.end)
            self._cache[week] = days / 5
        return self._cache[week]

    def weeks(self) -> list[date]:
        first, weeks = monday(self.start), []
        while first <= self.end:
            weeks.append(first)
            first += timedelta(days=7)
        return weeks

    def trimmed(self, start_weeks: int = 0, end_weeks: int = 0) -> "Window":
        return Window(self.start + timedelta(days=7 * start_weeks), self.end - timedelta(days=7 * end_weeks))


def _profile_in(window: Window, start_week: date, profile: Mapping[int, float]) -> float:
    return sum(weight * window.coverage(start_week + timedelta(days=7 * lag)) for lag, weight in profile.items())


def _profile_by_week(window: Window, start_week: date, profile: Mapping[int, float]) -> dict[date, float]:
    out: dict[date, float] = {}
    for lag, weight in profile.items():
        week = start_week + timedelta(days=7 * lag)
        coverage = window.coverage(week)
        if coverage:
            out[week] = weight * coverage
    return out


def _ratio(actual: float, expected: float) -> float | None:
    return actual / expected if expected > 0 else None


def _separate(actual_by_bucket: list[float], target_by_bucket: list[float], other_by_bucket: list[float]) -> tuple[float, float, float] | None:
    """Least squares for actual ≈ r_target·target + r_other·other.

    Returns (r_target, r_other, identifiability). Identifiability is 1 when both
    series vary independently and 0 when they are proportional, in which case
    the two ratios cannot be told apart.
    """
    a11 = sum(x * x for x in target_by_bucket)
    a22 = sum(y * y for y in other_by_bucket)
    a12 = sum(x * y for x, y in zip(target_by_bucket, other_by_bucket))
    if a11 <= 0 or a22 <= 0:
        return None
    identifiability = 1 - (a12 * a12) / (a11 * a22)
    det = a11 * a22 - a12 * a12
    if det <= 0:
        return None
    b1 = sum(x * z for x, z in zip(target_by_bucket, actual_by_bucket))
    b2 = sum(y * z for y, z in zip(other_by_bucket, actual_by_bucket))
    r_target = (a22 * b1 - a12 * b2) / det
    r_other = (a11 * b2 - a12 * b1) / det
    if r_target < 0 or r_other < 0:
        return None
    return r_target, r_other, identifiability


def production_timeline(houses: Iterable[House]) -> list[dict]:
    """Weekly starts per project and subtype, for choosing a period."""
    weeks: dict[date, dict[tuple[int | None, int | None], int]] = defaultdict(lambda: defaultdict(int))
    for house in houses:
        weeks[monday(house.day)][(house.project_id, house.subtype_id)] += 1
    return [
        {"week": week.isoformat(), "starts": [
            {"project_id": project_id, "subtype_id": subtype_id, "houses": count}
            for (project_id, subtype_id), count in sorted(groups.items(), key=lambda item: (item[0][0] is None, item[0][0] or 0, item[0][1] or 0))
        ]}
        for week, groups in sorted(weeks.items())
    ]


def suggest_period(houses: Iterable[House], project_id: int, data_start: date, min_weeks: int = 4) -> tuple[date, date] | None:
    """Longest stretch where the project dominates production.

    Each week scores the project's starts minus half of everyone else's, and the
    best-scoring contiguous stretch wins. Weeks right after production data
    begins are skipped: earlier houses are invisible but still consuming.
    """
    target: dict[date, int] = defaultdict(int)
    other: dict[date, int] = defaultdict(int)
    for house in houses:
        (target if house.project_id == project_id else other)[monday(house.day)] += 1
    if not target:
        return None
    first_usable = monday(data_start) + timedelta(days=7 * (max(FACTORY_PROFILE) + 1))
    weeks = [week for week in sorted(set(target) | set(other)) if week >= first_usable]
    if not weeks:
        return None
    all_weeks, cursor = [], weeks[0]
    while cursor <= weeks[-1]:
        all_weeks.append(cursor)
        cursor += timedelta(days=7)
    best, best_range, score, begin = float("-inf"), None, 0.0, 0
    for index, week in enumerate(all_weeks):
        value = target[week] - 0.5 * other[week]
        if score <= 0:
            score, begin = value, index
        else:
            score += value
        if score > best:
            best, best_range = score, (begin, index)
    if best_range is None or best <= 0:
        project_weeks = sorted(target)
        return project_weeks[0], project_weeks[-1] + timedelta(days=4)
    start_index, end_index = best_range
    while end_index - start_index + 1 < min_weeks and (start_index > 0 or end_index < len(all_weeks) - 1):
        if end_index < len(all_weeks) - 1:
            end_index += 1
        if end_index - start_index + 1 < min_weeks and start_index > 0:
            start_index -= 1
    return all_weeks[start_index], all_weeks[end_index] + timedelta(days=4)


def study_project(
    *,
    project_id: int,
    start: date,
    end: date,
    houses: list[House],
    withdrawals: list[Withdrawal],
    target_quantities: Mapping[int | None, Mapping[str, float]],
    site_share: Mapping[str, float],
    data_start: date,
    excluded_cost_centers: Iterable[str] = (),
    names: Mapping[str, str] | None = None,
    units: Mapping[str, str | None] | None = None,
    excluded_share: Mapping[str, float] | None = None,
) -> dict:
    """Study the project's consumption over [start, end].

    `houses` must include every house started since LOOKBACK_WEEKS before the
    period, since they still consume inside it. `withdrawals` may cover any
    dates; only those inside the period and outside the excluded cost centers
    count. `target_quantities` maps each subtype (None for the project's
    general bucket) to its expected quantity per house.
    """
    window = Window(start, end)
    excluded = exclusion_filter(excluded_cost_centers)
    actual: dict[str, float] = defaultdict(float)
    actual_value: dict[str, float] = defaultdict(float)
    # Unit cost from every non-excluded withdrawal given, not only the period's,
    # so materials that stopped being withdrawn can still be valued.
    cost_quantity: dict[str, float] = defaultdict(float)
    cost_value: dict[str, float] = defaultdict(float)
    actual_by_week: dict[str, dict[date, float]] = defaultdict(lambda: defaultdict(float))
    actual_by_day: dict[str, dict[date, float]] = defaultdict(lambda: defaultdict(float))
    actual_by_center: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    for row in withdrawals:
        if excluded(row.cost_center):
            continue
        if row.quantity > 0 and row.value > 0:
            cost_quantity[row.sku] += row.quantity
            cost_value[row.sku] += row.value
        if not start <= row.day <= end:
            continue
        actual[row.sku] += row.quantity
        actual_value[row.sku] += row.value
        actual_by_week[row.sku][monday(row.day)] += row.quantity
        actual_by_day[row.sku][row.day] += row.quantity
        actual_by_center[row.sku][row.cost_center] += row.quantity

    # Expected consumption inside the period, per material, split by target.
    expected_target: dict[str, float] = defaultdict(float)
    expected_other: dict[str, float] = defaultdict(float)
    expected_by_week_target: dict[str, dict[date, float]] = defaultdict(lambda: defaultdict(float))
    expected_by_week_other: dict[str, dict[date, float]] = defaultdict(lambda: defaultdict(float))
    unmapped_weight = 0.0
    mapped_weight = 0.0
    incomplete: set[str] = set()
    target_starts: dict[int | None, int] = defaultdict(int)
    other_starts = 0
    unmapped_starts = 0
    for house in houses:
        week = monday(house.day)
        factory = _profile_by_week(window, week, FACTORY_PROFILE)
        site = _profile_by_week(window, week, SITE_PROFILE)
        weight = sum(factory.values())
        if start <= house.day <= end:
            if house.project_id == project_id:
                target_starts[house.subtype_id] += 1
            elif house.mapped:
                other_starts += 1
            else:
                unmapped_starts += 1
        if not house.mapped:
            unmapped_weight += weight
            continue
        mapped_weight += weight
        if not factory and not site:
            continue
        incomplete |= house.incomplete_skus
        is_target = house.project_id == project_id
        totals = expected_target if is_target else expected_other
        by_week = expected_by_week_target if is_target else expected_by_week_other
        for sku, quantity in house.quantities.items():
            if quantity <= 0:
                continue
            site_part = site_share.get(sku, 0.0)
            for week_key, share in factory.items():
                value = quantity * (1 - site_part) * share
                totals[sku] += value
                by_week[sku][week_key] += value
            if site_part:
                for week_key, share in site.items():
                    value = quantity * site_part * share
                    totals[sku] += value
                    by_week[sku][week_key] += value

    unit_cost = {sku: cost_value[sku] / quantity for sku, quantity in cost_quantity.items() if quantity > 0}
    weeks = window.weeks()
    total_target_starts = sum(target_starts.values())
    total_starts = total_target_starts + other_starts + unmapped_starts
    unmapped_share = unmapped_weight / (unmapped_weight + mapped_weight) if unmapped_weight + mapped_weight else 0.0
    horizon_weeks = (monday(start) - monday(data_start)).days // 7
    materials = []
    target_skus = {sku for quantities in target_quantities.values() for sku, value in quantities.items() if value > 0}
    for sku in sorted(target_skus):
        materials.append(_study_material(
            sku=sku, window=window, weeks=weeks,
            actual=actual.get(sku, 0.0), actual_by_week=actual_by_week.get(sku, {}), actual_by_day=actual_by_day.get(sku, {}),
            expected_target=expected_target.get(sku, 0.0), expected_other=expected_other.get(sku, 0.0),
            expected_by_week_target=expected_by_week_target.get(sku, {}), expected_by_week_other=expected_by_week_other.get(sku, {}),
            site_share=site_share.get(sku, 0.0), target_houses=total_target_starts, incomplete=sku in incomplete,
            unmapped_share=unmapped_share, horizon_weeks=horizon_weeks,
            target_quantities=target_quantities, unit_cost=unit_cost.get(sku), excluded_share=(excluded_share or {}).get(sku, 0.0),
        ))

    unbudgeted = _unbudgeted(
        actual=actual, actual_value=actual_value, actual_by_week=actual_by_week, actual_by_center=actual_by_center, budgeted=target_skus, expected_other=expected_other,
        houses=mapped_weight + unmapped_weight, materials=materials, names=names or {}, units=units or {},
        houses_since=lambda since: sum(sum(_profile_by_week(Window(since, end), monday(house.day), FACTORY_PROFILE).values()) for house in houses),
    )
    return {
        "project_id": project_id,
        "range_start": start.isoformat(),
        "range_end": end.isoformat(),
        "houses": {
            "target": total_target_starts,
            "target_by_subtype": [{"subtype_id": key, "houses": value} for key, value in sorted(target_starts.items(), key=lambda item: (item[0] is None, item[0] or 0))],
            "other_projects": other_starts,
            "unmapped": unmapped_starts,
            "target_share": round(total_target_starts / total_starts, 4) if total_starts else None,
        },
        "unmapped_share": round(unmapped_share, 4),
        "data_start": data_start.isoformat(),
        "warnings": _period_warnings(horizon_weeks, unmapped_share, total_target_starts),
        "materials": materials,
        "unbudgeted": unbudgeted,
    }


def material_series(
    *,
    project_id: int,
    sku: str,
    start: date,
    end: date,
    houses: list[House],
    withdrawals: Iterable[Withdrawal],
    site_share: float,
    excluded_cost_centers: Iterable[str] = (),
) -> list[dict]:
    """One material's business days over [start, end], in the study's terms.

    Each day carries the withdrawals outside excluded cost centers (weekend
    ones on the Friday before), the expected consumption of the project's
    houses and of other projects' houses (each week's share of the timing
    profile spread over its business days), the project's house starts, and
    its equivalent houses: the part of each house's work falling on that day.
    Summed over any span, real / (target + other) is the study's pooled ratio
    and target / equivalent houses is the BOM per house of the mix.
    """
    excluded = exclusion_filter(excluded_cost_centers)
    days = [start + timedelta(days=offset) for offset in range((end - start).days + 1)]
    points = {day: {"actual": 0.0, "expected_target": 0.0, "expected_other": 0.0, "target_starts": 0, "equivalent_houses": 0.0}
              for day in days if day.weekday() < 5}
    if not points:
        return []

    def business_day(day: date) -> date:
        return day - timedelta(days=max(0, day.weekday() - 4))

    for row in withdrawals:
        if row.sku != sku or not start <= row.day <= end or excluded(row.cost_center):
            continue
        day = business_day(row.day)
        if day in points:
            points[day]["actual"] += row.quantity

    def spread(week_weights: Mapping[date, float]):
        for week, weight in week_weights.items():
            for offset in range(5):
                day = week + timedelta(days=offset)
                if day in points:
                    yield day, weight / 5

    window = Window(start, end)
    for house in houses:
        if not house.mapped:
            continue
        is_target = house.project_id == project_id
        if is_target and start <= house.day <= end and business_day(house.day) in points:
            points[business_day(house.day)]["target_starts"] += 1
        quantity = house.quantities.get(sku, 0.0)
        week = monday(house.day)
        # Full weights; `spread` keeps only the days inside the period.
        factory = {week + timedelta(days=7 * lag): weight for lag, weight in FACTORY_PROFILE.items()}
        site = {week + timedelta(days=7 * lag): weight for lag, weight in SITE_PROFILE.items()} if site_share else {}
        if not any(window.coverage(key) for key in [*factory, *site]):
            continue
        key = "expected_target" if is_target else "expected_other"
        for day, weight in spread(factory):
            share = (1 - site_share) * weight
            if quantity > 0:
                points[day][key] += quantity * share
            if is_target:
                points[day]["equivalent_houses"] += share
        for day, weight in spread(site):
            share = site_share * weight
            if quantity > 0:
                points[day][key] += quantity * share
            if is_target:
                points[day]["equivalent_houses"] += share

    return [{"date": day.isoformat(), **{name: round(value, 6) if isinstance(value, float) else value for name, value in point.items()}}
            for day, point in sorted(points.items())]


def _period_warnings(horizon_weeks: int, unmapped_share: float, target_houses: int) -> list[str]:
    warnings = []
    if horizon_weeks < max(FACTORY_PROFILE) + 1:
        warnings.append("before_data_start")
    elif horizon_weeks < max(SITE_PROFILE):
        warnings.append("site_before_data_start")
    if unmapped_share > 0.05:
        warnings.append("unmapped_houses")
    if target_houses == 0:
        warnings.append("no_target_houses")
    return warnings


def _study_material(
    *, sku: str, window: Window, weeks: list[date], actual: float, actual_by_week: Mapping[date, float],
    actual_by_day: Mapping[date, float], expected_target: float, expected_other: float,
    expected_by_week_target: Mapping[date, float], expected_by_week_other: Mapping[date, float],
    site_share: float, target_houses: int, incomplete: bool, unmapped_share: float, horizon_weeks: int,
    target_quantities: Mapping[int | None, Mapping[str, float]], unit_cost: float | None, excluded_share: float = 0.0,
) -> dict:
    expected = expected_target + expected_other
    share = expected_target / expected if expected > 0 else None
    pooled = _ratio(actual, expected)
    ratio, method, identifiability = pooled, "pooled", None
    if share is not None and share < 0.9 and pooled is not None:
        buckets = [weeks[index:index + 2] for index in range(0, len(weeks), 2)]
        separated = _separate(
            [sum(actual_by_week.get(week, 0.0) for week in bucket) for bucket in buckets],
            [sum(expected_by_week_target.get(week, 0.0) for week in bucket) for bucket in buckets],
            [sum(expected_by_week_other.get(week, 0.0) for week in bucket) for bucket in buckets],
        )
        if separated is not None:
            identifiability = separated[2]
            if identifiability >= MIN_IDENTIFIABILITY and len(buckets) >= 4:
                ratio, method = separated[0], "separated"

    signals = _signals(window, weeks, actual, actual_by_week, actual_by_day, expected_by_week_target, expected_by_week_other)
    grade, reasons = _grade(
        ratio=ratio, share=share, target_houses=target_houses, incomplete=incomplete, signals=signals,
        unmapped_share=unmapped_share, site_share=site_share, horizon_weeks=horizon_weeks, method=method,
        excluded_share=excluded_share,
    )
    suggestion = _suggest(ratio, grade)
    return {
        "sku": sku,
        "ratio": round(ratio, 4) if ratio is not None else None,
        "pooled_ratio": round(pooled, 4) if pooled is not None else None,
        "method": method,
        "identifiability": round(identifiability, 3) if identifiability is not None else None,
        "actual": round(actual, 4),
        "expected": round(expected, 4),
        "expected_target": round(expected_target, 4),
        "target_share": round(share, 4) if share is not None else None,
        "site_share": round(site_share, 3),
        "excluded_share": round(excluded_share, 3),
        "unit_cost": round(unit_cost, 4) if unit_cost is not None else None,
        "quantity_per_house": {
            ("general" if subtype_id is None else str(subtype_id)): round(quantities.get(sku, 0.0) * ratio, 6)
            for subtype_id, quantities in target_quantities.items()
        } if ratio is not None and not incomplete and excluded_share <= MAX_EXCLUDED_SHARE else {},
        "signals": signals,
        "grade": grade,
        "reasons": reasons,
        "suggestion": suggestion,
    }


def _signals(window, weeks, actual, actual_by_week, actual_by_day, expected_by_week_target, expected_by_week_other) -> dict:
    expected_week = [expected_by_week_target.get(week, 0.0) + expected_by_week_other.get(week, 0.0) for week in weeks]
    actual_week = [actual_by_week.get(week, 0.0) for week in weeks]
    expected_total = sum(expected_week)
    tracking = None
    stability = None
    if actual > 0 and expected_total > 0:
        cumulative_actual = cumulative_expected = 0.0
        gap = 0.0
        for a, e in zip(actual_week, expected_week):
            cumulative_actual += a / actual
            cumulative_expected += e / expected_total
            gap = max(gap, abs(cumulative_actual - cumulative_expected))
        tracking = round(gap, 4)
        stability = _change_point(weeks, actual_week, expected_week)
    # Share of the weeks expecting consumption that saw any withdrawal. Monthly
    # "shelf" withdrawals leave most weeks empty.
    expecting = [a for a, e in zip(actual_week, expected_week) if e > 0]
    active_weeks = round(sum(1 for a in expecting if a > 0) / len(expecting), 4) if expecting else None

    def trimmed_ratio(start_weeks, end_weeks):
        sub = weeks[start_weeks:len(weeks) - end_weeks]
        e = sum(expected_by_week_target.get(week, 0.0) + expected_by_week_other.get(week, 0.0) for week in sub)
        a = sum(actual_by_week.get(week, 0.0) for week in sub)
        return _ratio(a, e)

    edge = None
    full = _ratio(actual, expected_total)
    if full and len(weeks) >= 8:
        variants = [trimmed_ratio(2, 0), trimmed_ratio(0, 2)]
        spreads = [abs(value / full - 1) for value in variants if value is not None]
        edge = round(max(spreads), 4) if spreads else None
    return {
        "tracking": tracking,
        "active_weeks": active_weeks,
        "edge_sensitivity": edge,
        "stability": stability,
        "weekly_actual": [round(value, 4) for value in actual_week],
        "weekly_expected": [round(value, 4) for value in expected_week],
        "weeks": [week.isoformat() for week in weeks],
    }


def _change_point(weeks, actual_week, expected_week) -> dict | None:
    total = sum(expected_week)
    best = None
    cumulative_expected = cumulative_actual = 0.0
    for index in range(len(weeks) - 1):
        cumulative_expected += expected_week[index]
        cumulative_actual += actual_week[index]
        rest_expected = total - cumulative_expected
        if cumulative_expected < 0.25 * total or rest_expected < 0.25 * total:
            continue
        before = cumulative_actual / cumulative_expected
        after = (sum(actual_week) - cumulative_actual) / rest_expected
        change = log(max(after, 1e-6) / max(before, 1e-6))
        if best is None or abs(change) > abs(best[0]):
            best = (change, weeks[index + 1], before, after)
    if best is None:
        return None
    return {"ratio_before": round(best[2], 4), "ratio_after": round(best[3], 4), "change_week": best[1].isoformat()}


def _grade(*, ratio, share, target_houses, incomplete, signals, unmapped_share, site_share, horizon_weeks, method, excluded_share=0.0) -> tuple[str, list[str]]:
    # Mostly withdrawn through excluded centers (e.g. Obra): what remains
    # would look like a false shortfall.
    if excluded_share > MAX_EXCLUDED_SHARE:
        return "none", ["excluded_centers"]
    if ratio is None:
        return "none", ["no_expected"]
    if incomplete:
        return "none", ["incomplete_bom"]
    low: list[str] = []
    medium: list[str] = []

    def check(value, high_limit, low_limit, reason, larger_is_worse=True):
        if value is None:
            return
        worse_than = (lambda limit: value > limit) if larger_is_worse else (lambda limit: value < limit)
        if worse_than(low_limit):
            low.append(reason)
        elif worse_than(high_limit):
            medium.append(reason)

    check(target_houses, MIN_HOUSES_HIGH, MIN_HOUSES_LOW, "few_houses", larger_is_worse=False)
    if method != "separated":
        check(share, MIN_SHARE_HIGH, MIN_SHARE_LOW, "shared_production", larger_is_worse=False)
    check(signals["tracking"], MAX_TRACKING_HIGH, MAX_TRACKING_LOW, "irregular")
    check(signals["active_weeks"], MIN_ACTIVE_HIGH, MIN_ACTIVE_LOW, "lumpy", larger_is_worse=False)
    check(signals["edge_sensitivity"], MAX_EDGE_HIGH, MAX_EDGE_LOW, "edge_sensitive")
    stability = signals["stability"]
    if stability:
        before, after = stability["ratio_before"], stability["ratio_after"]
        check(max(before, after) / min(before, after) if min(before, after) > 0 else float("inf"), MAX_BREAK_HIGH, MAX_BREAK_LOW, "change_point")
    if horizon_weeks < max(SITE_PROFILE) and site_share > MAX_SITE_HIGH:
        low.append("site_before_data_start")
    else:
        check(site_share, MAX_SITE_HIGH, MAX_SITE_LOW, "site_material")
    if ratio == 0:
        low.append("no_consumption")
    elif not PLAUSIBLE_RATIO[0] <= ratio <= PLAUSIBLE_RATIO[1]:
        medium.append("extreme_ratio")
    if unmapped_share > 0.05:
        medium.append("unmapped_houses")
    if low:
        return "low", low + medium
    if medium:
        return "medium", medium
    return "high", []


def _suggest(ratio: float | None, grade: str) -> str:
    if ratio is None or grade in {"none", "low"}:
        return "estimated"
    if abs(ratio - 1) < RELEVANT_DEVIATION:
        return "estimated"
    return "historic" if grade == "high" else "review"


def _name_similarity(left: str, right: str) -> float:
    """Word overlap between two material names, ignoring sizes and codes."""
    def words(name: str) -> set[str]:
        return {word for word in name.upper().replace(",", " ").replace(".", " ").split() if len(word) >= 3 and word.isalpha()}
    a, b = words(left), words(right)
    return len(a & b) / len(a | b) if a and b else 0.0


def _unbudgeted(*, actual, actual_value, actual_by_week, actual_by_center, budgeted, expected_other, houses, materials, names, units, houses_since) -> list[dict]:
    """Consumption of materials outside the project's BOM that the BOMs of the
    other houses in the period do not explain.

    With cost centers filtered well, it should not exist: it is unbudgeted
    consumables or equivalents replacing a BOM material. A material another
    project budgets still counts when the period's consumption far exceeds
    that project's houses, e.g. one Sol de Quillón house in a Jardines period
    while Jardines switched to the same board. Only the unexplained excess is
    listed, spread over every house consuming in the period.

    A BOM material counts as possibly replaced on either evidence:
    - switch: it practically stopped at a change point and this material, of
      the same family, started within three weeks for a similar amount in
      pesos (within 2x), as when a floor board is replaced mid-project;
    - name: their names share words and the amounts are within 3x, e.g. the
      same door under another code.
    Both must share the unit of measure, and pairs are one-to-one: each
    budgeted material is replaced by at most one other, the closest in pesos.
    Steady co-movement is not evidence: in production every material moves
    together.
    """
    if houses <= 0:
        return []
    shortfalls = []
    for material in materials:
        signals, cost = material["signals"], material["unit_cost"]
        if material["ratio"] is None or not cost or material["expected"] <= 0:
            continue
        weeks = [date.fromisoformat(week) for week in signals["weeks"]]
        stability = signals["stability"]
        change = None
        # A switch leaves the old material almost unused, not just lower.
        if stability and stability["ratio_before"] >= 0.5 and stability["ratio_after"] <= SWITCH_REMAINDER * stability["ratio_before"]:
            change = date.fromisoformat(stability["change_week"])
            after = [(a, e) for week, a, e in zip(weeks, signals["weekly_actual"], signals["weekly_expected"]) if week >= change]
            change_shortfall = sum(e - a for a, e in after) * cost / houses
            change = (change, change_shortfall) if change_shortfall > 0 else None
        overall = (material["expected"] - material["actual"]) * cost / houses if material["ratio"] < 0.8 else None
        if change or overall:
            shortfalls.append((material["sku"], overall, change))
    out = []
    pairs = []
    for sku, total in actual.items():
        if sku in budgeted or total <= 0:
            continue
        quantity = total - expected_other.get(sku, 0.0)
        if quantity <= 0.5 * total:
            continue
        weekly = actual_by_week.get(sku, {})
        value_per_house = actual_value.get(sku, 0.0) * quantity / total / houses
        candidates = []
        for other, overall, change in shortfalls:
            if value_per_house < MIN_REPLACEMENT_VALUE_PER_HOUSE or (units.get(sku) and units.get(other) and units[sku] != units[other]):
                continue
            if change:
                since, shortfall = change
                active_weeks = sorted(week for week, value in weekly.items() if value > 0)
                started = sum(value for week, value in weekly.items() if week >= since - timedelta(days=14))
                share = min(started / total, 1.0)
                # The new material starts when the old one drops, not weeks later.
                begins = next((week for week in active_weeks if week >= since - timedelta(days=14)), None)
                onset = begins is not None and begins <= since + timedelta(days=21)
                # Substitutes are the same kind of product (board for board,
                # door for door) and fill a similar amount in pesos.
                same_family = other[:4] == sku[:4]
                if same_family and onset and share >= 0.8 and len(active_weeks) >= 2 and 1 / 2 <= shortfall / (value_per_house * share) <= 2:
                    after_houses = houses_since(since)
                    candidates.append({
                        "sku": other, "evidence": "switch", "since_week": since.isoformat(),
                        "shortfall_value_per_house": round(shortfall, 2),
                        # What a house uses since the switch, the basis for budgeting future houses.
                        "quantity_per_house_since": round(started / after_houses, 6) if after_houses > 0 else None,
                    })
                    continue
            similarity = _name_similarity(names.get(sku, ""), names.get(other, "")) if other[:4] == sku[:4] else 0.0
            if overall and similarity >= 0.25 and 1 / 3 <= overall / value_per_house <= 3:
                candidates.append({"sku": other, "evidence": "name", "since_week": None, "shortfall_value_per_house": round(overall, 2), "quantity_per_house_since": None})
        for candidate in candidates:
            similarity = _name_similarity(names.get(sku, ""), names.get(candidate["sku"], ""))
            score = abs(log(candidate["shortfall_value_per_house"] / value_per_house)) - 0.5 * similarity - (0.3 if candidate["evidence"] == "switch" else 0)
            pairs.append((score, sku, candidate))
        out.append({
            "sku": sku,
            "quantity": round(quantity, 4),
            "quantity_per_house": round(quantity / houses, 6),
            "value_per_house": round(value_per_house, 2),
            "active_weeks": sum(1 for value in weekly.values() if value > 0),
            "explained_elsewhere": round(1 - quantity / total, 4),
            # Where it was withdrawn: cost centers are often misallocated, so
            # this is what tells a real consumption from another site's.
            "main_cost_center": max(actual_by_center[sku], key=actual_by_center[sku].get) if actual_by_center.get(sku) else None,
            "main_cost_center_share": round(max(actual_by_center[sku].values()) / total, 4) if actual_by_center.get(sku) else None,
            "replaces": [],
        })
    by_sku = {item["sku"]: item for item in out}
    replaced: set[str] = set()
    for _score, sku, candidate in sorted(pairs, key=lambda pair: pair[0]):
        if candidate["sku"] in replaced or by_sku[sku]["replaces"]:
            continue
        replaced.add(candidate["sku"])
        by_sku[sku]["replaces"].append(candidate)
    out.sort(key=lambda item: -item["value_per_house"])
    return out


def _correlation(left: list[float], right: list[float]) -> float | None:
    n = len(left)
    if n < 3:
        return None
    mean_left, mean_right = sum(left) / n, sum(right) / n
    cov = sum((x - mean_left) * (y - mean_right) for x, y in zip(left, right))
    var_left = sum((x - mean_left) ** 2 for x in left)
    var_right = sum((y - mean_right) ** 2 for y in right)
    if var_left <= 0 or var_right <= 0:
        return None
    return cov / sqrt(var_left * var_right)
