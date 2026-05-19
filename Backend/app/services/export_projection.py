from __future__ import annotations

from pathlib import Path
from typing import Any

from app.models import Project, ProjectInstance


def number_category_sections(categories: list[dict[str, Any]]) -> list[dict[str, Any]]:
    counters: list[int] = []
    numbered: list[dict[str, Any]] = []

    for section in categories:
        depth = int(section.get("depth") or 0)
        if len(counters) <= depth:
            counters.extend([0] * (depth + 1 - len(counters)))
        counters = counters[: depth + 1]
        counters[depth] += 1
        numbered.append({**section, "number": ".".join(str(value) for value in counters)})

    return numbered


def iter_material_context_rows(project_data: dict[str, Any]):
    for section in number_category_sections(project_data.get("categories", [])):
        category_label = f"{section['number']}. {section['name']}"
        for instance in section.get("instances", []):
            instance_label = instance.get("short_name") or instance["name"]
            for material in instance.get("materials", []):
                for bom_entry in material.get("bom_entries", []):
                    yield {
                        "category_label": category_label,
                        "category_depth": section.get("depth", 0),
                        "instance_name": instance["name"],
                        "instance_label": instance_label,
                        "material_name": material["material_name"],
                        "sku": material["sku"],
                        "unit": material.get("unit") or "",
                        "subtype": bom_entry.get("subtype") or "General",
                        "quantity": bom_entry.get("quantity"),
                        "quantity_state": bom_entry.get("quantity_state"),
                        "assembly_quantity": bom_entry.get("assembly_quantity"),
                        "assembly_quantity_state": bom_entry.get("assembly_quantity_state"),
                    }


def iter_cost_model_rows(project_data: dict[str, Any]):
    for section in number_category_sections(project_data.get("categories", [])):
        category_label = f"{section['number']}. {section['name']}"
        for instance in section.get("instances", []):
            instance_label = instance.get("short_name") or instance["name"]
            for material in instance.get("materials", []):
                for bom_entry in material.get("bom_entries", []):
                    yield {
                        "category_label": category_label,
                        "instance_id": instance.get("id"),
                        "instance_name": instance["name"],
                        "instance_label": instance_label,
                        "material_id": material.get("material_id"),
                        "material_name": material["material_name"],
                        "sku": material["sku"],
                        "unit": material.get("unit") or "",
                        "subtype": bom_entry.get("subtype") or "General",
                        "subtype_id": bom_entry.get("subtype_id"),
                        "quantity": bom_entry.get("quantity"),
                        "quantity_state": bom_entry.get("quantity_state"),
                    }


def build_detailed_material_export_sections(project_data: dict[str, Any], *, quantity_basis: str = "factory") -> list[dict[str, Any]]:
    if quantity_basis not in {"factory", "work", "total"}:
        raise ValueError("quantity_basis must be 'factory', 'work', or 'total'")

    quantity_key = "quantity" if quantity_basis == "factory" else "assembly_quantity"
    quantity_state_key = "quantity_state" if quantity_basis == "factory" else "assembly_quantity_state"
    materials_by_sku: dict[str, dict[str, Any]] = {}

    for section in number_category_sections(project_data.get("categories", [])):
        for instance in section.get("instances", []):
            for material in instance.get("materials", []):
                sku = str(material.get("sku") or "").strip().upper()
                if not sku:
                    continue

                material_entry = materials_by_sku.setdefault(
                    sku,
                    {
                        "material_name": material["material_name"],
                        "sku": sku,
                        "unit": material.get("unit") or "",
                        "subtypes": {},
                    },
                )

                for bom_entry in material.get("bom_entries", []):
                    subtype_name = bom_entry.get("subtype") or "General"
                    subtype_entry = material_entry["subtypes"].setdefault(
                        subtype_name,
                        {
                            "subtype": subtype_name,
                            "quantity_total": 0.0,
                            "has_numeric_quantity": False,
                            "has_blank_quantity": False,
                        },
                    )

                    if quantity_basis == "total":
                        factory_quantity = _numeric_bom_quantity(bom_entry, "quantity", "quantity_state")
                        work_quantity = _numeric_bom_quantity(bom_entry, "assembly_quantity", "assembly_quantity_state")
                        if factory_quantity is not None or work_quantity is not None:
                            subtype_entry["quantity_total"] += (factory_quantity or 0.0) + (work_quantity or 0.0)
                            subtype_entry["has_numeric_quantity"] = True
                        elif bom_entry.get("quantity_state") == "blank" or bom_entry.get("assembly_quantity_state") == "blank":
                            subtype_entry["has_blank_quantity"] = True
                    elif bom_entry.get(quantity_state_key) == "value" and bom_entry.get(quantity_key) is not None:
                        subtype_entry["quantity_total"] += float(bom_entry[quantity_key])
                        subtype_entry["has_numeric_quantity"] = True
                    elif bom_entry.get(quantity_state_key) == "blank":
                        subtype_entry["has_blank_quantity"] = True

    aggregated_materials: list[dict[str, Any]] = []
    for material_entry in materials_by_sku.values():
        rows: list[dict[str, Any]] = []
        for subtype_entry in sorted(
            material_entry["subtypes"].values(),
            key=lambda item: (item["subtype"] != "General", item["subtype"].lower()),
        ):
            if subtype_entry["has_numeric_quantity"]:
                quantity = round(float(subtype_entry["quantity_total"]), 6)
            elif subtype_entry["has_blank_quantity"]:
                quantity = None
            else:
                continue
            rows.append({"subtype": subtype_entry["subtype"], "quantity": quantity})

        if rows:
            aggregated_materials.append(
                {
                    "material_name": material_entry["material_name"],
                    "sku": material_entry["sku"],
                    "unit": material_entry["unit"],
                    "rows": rows,
                }
            )

    if not aggregated_materials:
        return []

    return [
        {
            "number": "",
            "name": "Todos los materiales",
            "depth": 0,
            "hide_header": True,
            "materials": sorted(
                aggregated_materials,
                key=lambda item: (item["material_name"].lower(), item["sku"]),
            ),
        }
    ]


def _numeric_bom_quantity(bom_entry: dict[str, Any], quantity_key: str, quantity_state_key: str) -> float | None:
    if bom_entry.get(quantity_state_key) != "value" or bom_entry.get(quantity_key) is None:
        return None
    return float(bom_entry[quantity_key])


def build_commercial_export_sections(
    project: Project,
    project_data: dict[str, Any],
    *,
    static_dir: Path,
    media_gallery_dir: Path | None = None,
) -> list[dict[str, Any]]:
    orm_instances = {instance.id: instance for instance in project.instances}
    sections: list[dict[str, Any]] = []

    for section in number_category_sections(project_data.get("categories", [])):
        projected_instances: list[dict[str, Any]] = []
        for serialized_instance in section.get("instances", []):
            orm_instance = orm_instances.get(serialized_instance["id"])
            if orm_instance is None:
                continue
            if _is_attached_accessory_instance(orm_instance):
                continue
            settings = normalize_commercial_export_settings(
                instance_type=serialized_instance["type"],
                raw_settings=_instance_export_settings(serialized_instance, "commercial_pdf"),
            )
            if not settings["include"]:
                continue
            projected_instances.append(
                {
                    "number": f"{section['number']}.{len(projected_instances) + 1}",
                    "name": serialized_instance["name"],
                    "display_name": serialized_instance.get("short_name") or serialized_instance["name"],
                    "description": _commercial_description(serialized_instance, settings),
                    "installation": serialized_instance.get("installation") if settings["installation"] else None,
                    "attributes": _commercial_attributes(serialized_instance, settings),
                    "usage_rows": _accessory_usage_rows(orm_instance),
                    "linked_accessories": _commercial_linked_accessories(orm_instance, settings),
                    "image_path": _resolve_media_path(
                        serialized_instance.get("media", []),
                        static_dir=static_dir,
                        media_gallery_dir=media_gallery_dir,
                        include_image=settings["image"],
                    ),
                }
            )

        if projected_instances:
            sections.append(
                {
                    "number": section["number"],
                    "name": section["name"],
                    "instances": projected_instances,
                }
            )

    return sections


def build_full_technical_export_sections(
    project: Project,
    project_data: dict[str, Any],
    *,
    static_dir: Path,
    media_gallery_dir: Path | None = None,
) -> list[dict[str, Any]]:
    orm_instances = {instance.id: instance for instance in project.instances}
    sections: list[dict[str, Any]] = []

    for section in number_category_sections(project_data.get("categories", [])):
        projected_instances: list[dict[str, Any]] = []
        for serialized_instance in section.get("instances", []):
            orm_instance = orm_instances.get(serialized_instance["id"])
            if orm_instance is None:
                continue
            if _is_attached_accessory_instance(orm_instance):
                continue
            settings = normalize_full_export_settings(
                instance_type=serialized_instance["type"],
                raw_settings=_instance_export_settings(serialized_instance, "full_technical_pdf"),
            )
            if not settings["include"]:
                continue
            projected_instances.append(
                {
                    "number": f"{section['number']}.{len(projected_instances) + 1}",
                    "name": serialized_instance["name"],
                    "display_name": serialized_instance["name"],
                    "description": serialized_instance.get("description") or serialized_instance.get("short_description"),
                    "installation": serialized_instance.get("installation") if settings["installation"] else None,
                    "attributes": _technical_attributes(serialized_instance, settings),
                    "usage_rows": _accessory_usage_rows(orm_instance),
                    "linked_accessories": _commercial_linked_accessories(orm_instance, {"accessory_mode": settings["accessory_mode"]}),
                    "image_path": _resolve_media_path(
                        serialized_instance.get("media", []),
                        static_dir=static_dir,
                        media_gallery_dir=media_gallery_dir,
                        include_image=settings["image"],
                    ),
                    "materials": _technical_materials(serialized_instance, settings),
                }
            )

        if projected_instances:
            sections.append(
                {
                    "number": section["number"],
                    "name": section["name"],
                    "instances": projected_instances,
                }
            )

    return sections


def normalize_commercial_export_settings(*, instance_type: str, raw_settings: dict[str, Any] | None) -> dict[str, Any]:
    normalized = {
        "include": True,
        "description": "short",
        "installation": False,
        "image": instance_type == "item",
        "attribute_mode": "all" if instance_type == "item" else "none",
        "attribute_names": [],
        "accessory_mode": "expanded" if instance_type == "item" else "none",
    }
    raw = raw_settings or {}

    include_value = raw.get("include")
    if isinstance(include_value, bool):
        normalized["include"] = include_value

    description_value = str(raw.get("description") or "").strip().lower()
    if description_value in {"short", "full", "long", "none"}:
        normalized["description"] = "full" if description_value == "long" else description_value

    installation_value = raw.get("installation")
    if isinstance(installation_value, bool):
        normalized["installation"] = installation_value

    image_value = raw.get("image")
    if isinstance(image_value, bool):
        normalized["image"] = image_value

    if "include_attributes" in raw:
        include_attributes = raw.get("include_attributes")
        if include_attributes is False:
            normalized["attribute_mode"] = "none"
            normalized["attribute_names"] = []
        elif include_attributes is True:
            normalized["attribute_mode"] = "all"
            normalized["attribute_names"] = []
        elif isinstance(include_attributes, list):
            names = [str(value).strip() for value in include_attributes if str(value).strip()]
            normalized["attribute_mode"] = "whitelist" if names else "none"
            normalized["attribute_names"] = names

    attributes = raw.get("attributes")
    if isinstance(attributes, dict):
        mode = str(attributes.get("mode") or "").strip().lower()
        names = attributes.get("list")
        if mode in {"all", "none", "whitelist", "blacklist"}:
            normalized["attribute_mode"] = mode
        if isinstance(names, list):
            normalized["attribute_names"] = [str(value).strip() for value in names if str(value).strip()]

    accessory_mode = raw.get("accessory_mode")
    if isinstance(accessory_mode, str) and accessory_mode.strip().lower() in {"none", "summary", "expanded"}:
        normalized["accessory_mode"] = accessory_mode.strip().lower()

    linked_accessories = raw.get("linked_accessories")
    if isinstance(linked_accessories, str) and linked_accessories.strip().lower() in {"none", "summary", "expanded"}:
        normalized["accessory_mode"] = linked_accessories.strip().lower()
    elif isinstance(linked_accessories, dict):
        include_linked = linked_accessories.get("include")
        if include_linked is False:
            normalized["accessory_mode"] = "none"
        elif normalized["accessory_mode"] == "none" and include_linked is True:
            normalized["accessory_mode"] = "expanded"

    return normalized


def normalize_full_export_settings(*, instance_type: str, raw_settings: dict[str, Any] | None) -> dict[str, Any]:
    normalized = {
        "include": True,
        "installation": True,
        "image": instance_type == "item",
        "attribute_mode": "all",
        "attribute_names": [],
        "accessory_mode": "expanded",
        "include_materials": True,
    }
    raw = raw_settings or {}

    include_value = raw.get("include")
    if isinstance(include_value, bool):
        normalized["include"] = include_value

    installation_value = raw.get("installation")
    if isinstance(installation_value, bool):
        normalized["installation"] = installation_value

    image_value = raw.get("image")
    if isinstance(image_value, bool):
        normalized["image"] = image_value

    include_materials = raw.get("include_materials")
    if isinstance(include_materials, bool):
        normalized["include_materials"] = include_materials

    attributes = raw.get("attributes")
    if isinstance(attributes, dict):
        mode = str(attributes.get("mode") or "").strip().lower()
        names = attributes.get("list")
        if mode in {"all", "none", "whitelist", "blacklist"}:
            normalized["attribute_mode"] = mode
        if isinstance(names, list):
            normalized["attribute_names"] = [str(value).strip() for value in names if str(value).strip()]

    linked_accessories = raw.get("linked_accessories")
    if isinstance(linked_accessories, str) and linked_accessories.strip().lower() in {"none", "summary", "expanded"}:
        normalized["accessory_mode"] = linked_accessories.strip().lower()
    elif isinstance(linked_accessories, dict):
        include_linked = linked_accessories.get("include")
        if include_linked is False:
            normalized["accessory_mode"] = "none"

    return normalized


def _instance_export_settings(instance: dict[str, Any], target: str) -> dict[str, Any] | None:
    for setting in instance.get("export_settings", []):
        if setting.get("target") == target and isinstance(setting.get("settings"), dict):
            return setting["settings"]
    return None


def _commercial_description(instance: dict[str, Any], settings: dict[str, Any]) -> str | None:
    mode = settings["description"]
    if mode == "none":
        return None
    if mode == "full":
        return instance.get("description") or instance.get("short_description")
    return instance.get("short_description") or instance.get("description")


def _commercial_attributes(instance: dict[str, Any], settings: dict[str, Any]) -> list[dict[str, str | None]]:
    base_group = next((group for group in instance.get("attributes", []) if not group.get("application_label")), None)
    values = list(base_group.get("values", [])) if isinstance(base_group, dict) else []
    mode = settings["attribute_mode"]
    names = set(settings["attribute_names"])

    if mode == "none":
        return []
    if mode == "all":
        return values
    if mode == "whitelist":
        return [value for value in values if value.get("name") in names]
    if mode == "blacklist":
        return [value for value in values if value.get("name") not in names]
    return values


def _technical_attributes(instance: dict[str, Any], settings: dict[str, Any]) -> list[dict[str, str | None]]:
    mode = settings["attribute_mode"]
    names = set(settings["attribute_names"])
    result: list[dict[str, str | None]] = []

    for group in instance.get("attributes", []):
        for value in group.get("values", []):
            row = {
                "name": value.get("name"),
                "value": value.get("value"),
            }
            if mode == "none":
                continue
            if mode == "all":
                result.append(row)
            elif mode == "whitelist" and row["name"] in names:
                result.append(row)
            elif mode == "blacklist" and row["name"] not in names:
                result.append(row)

    return result


def _commercial_linked_accessories(instance: ProjectInstance, settings: dict[str, Any]) -> list[dict[str, Any]]:
    mode = settings["accessory_mode"]
    if mode == "none":
        return []

    accessories: list[dict[str, Any]] = []
    accessory_by_instance_id: dict[int, dict[str, Any]] = {}

    for link in sorted(instance.parent_links, key=lambda item: (item.sort_order, item.id)):
        child = link.child_instance
        _upsert_linked_accessory(
            accessories,
            accessory_by_instance_id,
            instance_id=child.id,
            name=child.short_name or child.name,
            context_label=link.application_label or None,
            attributes=_base_attribute_pairs(child),
        )

    seen_occurrences: set[int] = set()
    for target in sorted(instance.occurrence_targets, key=lambda item: (item.occurrence.sort_order, item.occurrence.id, item.id)):
        occurrence = target.occurrence
        if occurrence.id in seen_occurrences:
            continue
        seen_occurrences.add(occurrence.id)
        source = occurrence.source_instance
        if source.instance_type.value != "accessory":
            continue
        occurrence_attributes = [
            {"name": attribute.attribute_name, "value": attribute.value}
            for attribute in occurrence.attribute_values
        ]
        accessory = _upsert_linked_accessory(
            accessories,
            accessory_by_instance_id,
            instance_id=source.id,
            name=source.short_name or source.name,
            context_label=occurrence.context_label or None,
            attributes=occurrence_attributes,
        )
        accessory["context_label"] = accessory.get("context_label") or occurrence.context_label or None
        accessory["attributes"] = _merge_attribute_pairs(accessory.get("attributes", []), occurrence_attributes)

    if mode == "summary":
        return [{"name": accessory["name"], "context_label": accessory.get("context_label"), "attributes": []} for accessory in accessories]

    return accessories


def _accessory_usage_rows(instance: ProjectInstance) -> list[dict[str, Any]]:
    if instance.instance_type.value != "accessory":
        return []

    rows: list[dict[str, Any]] = []
    for occurrence in sorted(instance.outgoing_occurrences, key=lambda item: (item.sort_order, item.id)):
        application = _occurrence_application_label(occurrence)
        if not application:
            continue
        rows.append(
            {
                "application": application,
                "attributes": [
                    {"name": attribute.attribute_name, "value": attribute.value}
                    for attribute in occurrence.attribute_values
                ],
            }
        )
    return rows


def _occurrence_application_label(occurrence: Any) -> str | None:
    target_names = [
        target.target_instance.name
        for target in occurrence.targets
        if target.target_instance is not None
    ]
    if target_names:
        return ", ".join(target_names)
    label = str(occurrence.context_label or "").strip()
    return label or None


def _upsert_linked_accessory(
    accessories: list[dict[str, Any]],
    accessory_by_instance_id: dict[int, dict[str, Any]],
    *,
    instance_id: int,
    name: str,
    context_label: str | None,
    attributes: list[dict[str, str | None]],
) -> dict[str, Any]:
    accessory = accessory_by_instance_id.get(instance_id)
    if accessory is None:
        accessory = {
            "name": name,
            "context_label": context_label,
            "attributes": attributes,
        }
        accessory_by_instance_id[instance_id] = accessory
        accessories.append(accessory)
    return accessory


def _merge_attribute_pairs(
    existing_attributes: list[dict[str, str | None]],
    incoming_attributes: list[dict[str, str | None]],
) -> list[dict[str, str | None]]:
    merged: list[dict[str, str | None]] = []
    index_by_name: dict[str, int] = {}

    for attribute in [*existing_attributes, *incoming_attributes]:
        name = str(attribute.get("name") or "").strip()
        if not name:
            continue
        row = {"name": name, "value": attribute.get("value")}
        if name in index_by_name:
            merged[index_by_name[name]] = row
        else:
            index_by_name[name] = len(merged)
            merged.append(row)

    return merged


def _is_attached_accessory_instance(instance: ProjectInstance) -> bool:
    if instance.instance_type.value != "accessory":
        return False
    if any(not occurrence.targets for occurrence in instance.outgoing_occurrences):
        return False
    if instance.child_links:
        return True
    return any(occurrence.targets for occurrence in instance.outgoing_occurrences)


def _base_attribute_pairs(instance: ProjectInstance) -> list[dict[str, str | None]]:
    base_group = next((group for group in instance.attribute_groups if not group.application_label), None)
    if base_group is None:
        return []
    return [{"name": value.attribute_name, "value": value.value} for value in base_group.attribute_values]


def _resolve_media_path(
    media_items: list[dict[str, Any]],
    *,
    static_dir: Path,
    media_gallery_dir: Path | None = None,
    include_image: bool,
) -> Path | None:
    if not include_image:
        return None
    for media in media_items:
        if media.get("kind") != "image":
            continue
        storage_key = str(media.get("storage_key") or "").strip()
        if storage_key and media_gallery_dir is not None:
            root = media_gallery_dir.resolve()
            candidate = (root / storage_key).resolve()
            if (root in candidate.parents or candidate == root) and candidate.is_file():
                return candidate
        uri = str(media.get("uri") or "").strip()
        if not uri.startswith("/static/"):
            continue
        candidate = static_dir / uri.removeprefix("/static/")
        if candidate.is_file():
            return candidate
    return None


def _technical_materials(instance: dict[str, Any], settings: dict[str, Any]) -> list[dict[str, Any]]:
    if not settings["include_materials"]:
        return []

    materials: list[dict[str, Any]] = []
    for material in instance.get("materials", []):
        display_rows = []
        for bom_entry in material.get("bom_entries", []):
            state = bom_entry.get("quantity_state")
            value = bom_entry.get("quantity")
            if state == "zero":
                continue
            display_rows.append(
                {
                    "subtype": bom_entry.get("subtype") or "General",
                    "quantity": value if state == "value" else None,
                }
            )
        if not display_rows:
            continue
        materials.append(
            {
                "material_name": material["material_name"],
                "sku": material["sku"],
                "unit": material.get("unit") or "",
                "rows": display_rows,
            }
        )
    return materials
