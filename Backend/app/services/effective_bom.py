from __future__ import annotations

import hashlib
import json
from collections import defaultdict
from typing import Any, Iterable

from app.models import Project, ProjectBomEntry, ProjectSubtype
from app.models.entities import MaterialMode


SUBTYPE_KIND_GROUP = "group"
SUBTYPE_KIND_VARIANT = "variant"
VALID_SUBTYPE_KINDS = {SUBTYPE_KIND_GROUP, SUBTYPE_KIND_VARIANT}


def subtype_kind(subtype: ProjectSubtype) -> str:
    value = str(getattr(subtype, "kind", SUBTYPE_KIND_VARIANT) or SUBTYPE_KIND_VARIANT).strip().lower()
    return value if value in VALID_SUBTYPE_KINDS else SUBTYPE_KIND_VARIANT


def subtype_lineage(subtype: ProjectSubtype) -> list[ProjectSubtype]:
    lineage: list[ProjectSubtype] = []
    seen: set[int] = set()
    current: ProjectSubtype | None = subtype
    while current is not None and current.id not in seen:
        lineage.append(current)
        seen.add(current.id)
        current = current.parent
    lineage.reverse()
    return lineage


def subtype_path(subtype: ProjectSubtype) -> str:
    return " › ".join(node.name for node in subtype_lineage(subtype))


def selectable_subtypes(project: Project) -> list[ProjectSubtype]:
    return sorted(
        (subtype for subtype in project.subtypes if subtype_kind(subtype) == SUBTYPE_KIND_VARIANT),
        key=lambda subtype: (subtype_path(subtype).lower(), subtype.id),
    )


def occurrence_key_for_entry(entry: ProjectBomEntry) -> tuple[int, str, int]:
    if entry.material_rule_id is not None:
        return (entry.instance_id, "rule", int(entry.material_rule_id))
    return (entry.instance_id, "manual", int(entry.material_id))


def _occurrence_mode_by_key(project: Project) -> dict[tuple[int, str, int], str]:
    result: dict[tuple[int, str, int], str] = {}
    for setting in project.material_occurrence_modes:
        key = (
            setting.instance_id,
            "rule" if setting.material_rule_id is not None else "manual",
            int(setting.material_rule_id if setting.material_rule_id is not None else setting.material_id),
        )
        result[key] = setting.mode.value
    return result


def active_occurrence_mode(entries: list[ProjectBomEntry], explicit_mode: str | None) -> str:
    if explicit_mode in {MaterialMode.GENERAL.value, MaterialMode.PER_SUBTYPE.value}:
        return explicit_mode
    return MaterialMode.PER_SUBTYPE.value if any(entry.subtype_id is not None for entry in entries) else MaterialMode.GENERAL.value


def inherited_entry_value(
    entries_by_subtype: dict[int, ProjectBomEntry],
    subtype: ProjectSubtype,
    field: str,
) -> tuple[float | None, ProjectSubtype | None]:
    resolved: float | None = None
    source: ProjectSubtype | None = None
    for ancestor in subtype_lineage(subtype):
        entry = entries_by_subtype.get(ancestor.id)
        if entry is None:
            continue
        value = getattr(entry, field)
        if value is not None:
            mode = str(getattr(entry, "inheritance_mode", "override") or "override").strip().lower()
            resolved = (resolved or 0.0) + float(value) if mode == "add" else float(value)
            source = ancestor
    return resolved, source


def effective_occurrence_rows(project: Project) -> list[dict[str, Any]]:
    """Return active BOM rows with nested subtype inheritance already resolved."""

    grouped: dict[tuple[int, str, int], list[ProjectBomEntry]] = defaultdict(list)
    for entry in project.bom_entries:
        grouped[occurrence_key_for_entry(entry)].append(entry)

    explicit_modes = _occurrence_mode_by_key(project)
    variants = selectable_subtypes(project)
    rows: list[dict[str, Any]] = []
    for key, entries in grouped.items():
        mode = active_occurrence_mode(entries, explicit_modes.get(key))
        if mode == MaterialMode.GENERAL.value:
            general_entry = next((entry for entry in entries if entry.subtype_id is None), None)
            if general_entry is not None:
                rows.append(
                    {
                        "entry": general_entry,
                        "subtype": None,
                        "subtype_name": "General",
                        "quantity": general_entry.quantity,
                        "assembly_quantity": general_entry.assembly_quantity,
                        "quantity_source_entry": general_entry,
                        "assembly_source_entry": general_entry,
                    }
                )
            continue

        entries_by_subtype = {entry.subtype_id: entry for entry in entries if entry.subtype_id is not None}
        representative = entries[0]
        for variant in variants:
            quantity, quantity_source = inherited_entry_value(entries_by_subtype, variant, "quantity")
            assembly_quantity, assembly_source = inherited_entry_value(entries_by_subtype, variant, "assembly_quantity")
            rows.append(
                {
                    "entry": entries_by_subtype.get(variant.id, representative),
                    "subtype": variant,
                    "subtype_name": subtype_path(variant),
                    "quantity": quantity,
                    "assembly_quantity": assembly_quantity,
                    "quantity_source_entry": entries_by_subtype.get(quantity_source.id) if quantity_source else None,
                    "assembly_source_entry": entries_by_subtype.get(assembly_source.id) if assembly_source else None,
                }
            )
    return rows


def build_project_instance_quantity_map(project: Project) -> dict[str, Any]:
    """Build effective material quantities grouped by project instance.

    The comparison dashboard needs to explain an app-level project/subtype
    total without exposing the production system's house-type vocabulary. Keep
    only defined factory quantities here; the selected subtype is combined with
    the general bucket later when a production link is resolved.
    """

    general: dict[int, dict[str, Any]] = {}
    by_subtype: dict[int, dict[int, dict[str, Any]]] = defaultdict(dict)

    for effective_row in effective_occurrence_rows(project):
        entry = effective_row["entry"]
        material = entry.material
        instance = entry.instance
        quantity = effective_row["quantity"]
        if material is None or instance is None or quantity is None:
            continue

        sku = str(material.sku or "").strip().upper()
        if not sku:
            continue

        subtype = effective_row["subtype"]
        bucket = general if subtype is None else by_subtype[int(subtype.id)]
        instance_row = bucket.setdefault(
            int(instance.id),
            {
                "instance_id": int(instance.id),
                "instance_name": str(instance.name or ""),
                "category_name": instance.category.name if instance.category else None,
                "component_name": instance.component.name if instance.component else None,
                "quantities": {},
            },
        )
        instance_row["quantities"][sku] = float(instance_row["quantities"].get(sku, 0.0)) + float(quantity)

    def serialize(bucket: dict[int, dict[str, Any]]) -> list[dict[str, Any]]:
        return sorted(
            [
                {
                    **row,
                    "quantities": {
                        sku: round(float(quantity), 4)
                        for sku, quantity in row["quantities"].items()
                    },
                }
                for row in bucket.values()
            ],
            key=lambda row: (
                (row["category_name"] or "").lower(),
                (row["instance_name"] or "").lower(),
                row["instance_id"],
            ),
        )

    return {
        "general": serialize(general),
        "by_subtype": {
            subtype_id: serialize(bucket)
            for subtype_id, bucket in by_subtype.items()
        },
    }


def build_project_expected_quantity_map(project: Project) -> dict[str, Any]:
    """Build the effective per-house BOM used by every production comparison.

    General-mode occurrences contribute to every house. Per-subtype occurrences
    resolve the nearest nonblank value along the selected variant's ancestry.
    Dormant rows are excluded. Missing values remain visible as completeness
    warnings instead of silently becoming zero.
    """

    entries_by_occurrence: dict[tuple[int, str, int], list[ProjectBomEntry]] = defaultdict(list)
    for entry in project.bom_entries:
        entries_by_occurrence[occurrence_key_for_entry(entry)].append(entry)

    explicit_modes = _occurrence_mode_by_key(project)
    variants = selectable_subtypes(project)
    general: dict[str, float] = defaultdict(float)
    by_subtype: dict[int, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    missing_by_subtype: dict[int, int] = defaultdict(int)
    missing_general = 0
    subtype_only_occurrences = 0

    for key, entries in entries_by_occurrence.items():
        material = next((entry.material for entry in entries if entry.material is not None), None)
        sku = str(material.sku if material is not None else "").strip().upper()
        if not sku:
            continue
        mode = active_occurrence_mode(entries, explicit_modes.get(key))
        if mode == MaterialMode.GENERAL.value:
            entry = next((row for row in entries if row.subtype_id is None), None)
            if entry is None or entry.quantity is None:
                missing_general += 1
            else:
                general[sku] += float(entry.quantity)
            continue

        entries_by_subtype = {int(row.subtype_id): row for row in entries if row.subtype_id is not None}
        subtype_only_occurrences += 1
        for variant in variants:
            value, _source = inherited_entry_value(entries_by_subtype, variant, "quantity")
            if value is None:
                missing_by_subtype[variant.id] += 1
            else:
                by_subtype[variant.id][sku] += value

    resolved_missing: dict[int | None, int] = {None: missing_general + subtype_only_occurrences}
    resolved_missing.update(
        {
            subtype.id: missing_general + int(missing_by_subtype.get(subtype.id, 0))
            for subtype in variants
        }
    )

    return {
        "project_id": project.id,
        "project_name": project.name,
        "general": dict(general),
        "by_subtype": {subtype_id: dict(quantities) for subtype_id, quantities in by_subtype.items()},
        "missing_by_subtype": resolved_missing,
        "subtype_paths": {subtype.id: subtype_path(subtype) for subtype in variants},
        "instance_quantities": build_project_instance_quantity_map(project),
    }


def project_bom_fingerprint(projects: Iterable[Project]) -> str:
    parts: list[Any] = []
    for project in sorted(projects, key=lambda item: item.id):
        parts.append(("project", project.id))
        for subtype in sorted(project.subtypes, key=lambda item: item.id):
            parts.append(("subtype", subtype.id, subtype.parent_id, subtype.name, subtype_kind(subtype)))
        for entry in sorted(project.bom_entries, key=lambda item: item.id):
            parts.append(
                (
                    "bom",
                    entry.id,
                    occurrence_key_for_entry(entry),
                    entry.subtype_id,
                    entry.material_id,
                    entry.quantity,
                    entry.assembly_quantity,
                    getattr(entry, "inheritance_mode", "override") or "override",
                )
            )
        for setting in sorted(project.material_occurrence_modes, key=lambda item: item.id):
            parts.append(
                (
                    "mode",
                    setting.id,
                    setting.instance_id,
                    setting.material_rule_id,
                    setting.material_id,
                    setting.mode.value,
                )
            )
    serialized = json.dumps(parts, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()[:16]
