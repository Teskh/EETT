from __future__ import annotations

from collections import defaultdict

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models import (
    CatalogCategory,
    CatalogCategoryLink,
    CatalogComponent,
    ComponentMaterialRule,
    MaterialRuleGroup,
    Project,
    ProjectAuxiliaryMaterialSelection,
    ProjectBomEntry,
    ProjectInstance,
    ProjectInstanceAttributeGroup,
    ProjectInstanceLink,
    ProjectStatus,
    ProjectSubtype,
)


STATUS_LABELS = {
    ProjectStatus.TEMPLATE.value: "Project Template",
    ProjectStatus.EXECUTION.value: "Execution Projects",
    ProjectStatus.FINISHED.value: "Finished Projects",
}


def get_projects_page_data(session: Session) -> dict:
    projects = session.scalars(
        select(Project)
        .options(selectinload(Project.instances))
        .order_by(Project.status, Project.name)
    ).all()
    grouped = {status.value: [] for status in ProjectStatus}
    for project in projects:
        grouped[project.status.value].append(
            {
                "id": project.id,
                "name": project.name,
                "status": project.status.value,
                "status_label": STATUS_LABELS[project.status.value],
                "description": project.description,
                "updated_at": project.updated_at.strftime("%Y-%m-%d %H:%M"),
                "instance_count": len(project.instances),
            }
        )
    return {"grouped_projects": grouped, "status_labels": STATUS_LABELS}


def create_project(session: Session, *, name: str, description: str | None, status: str) -> Project:
    project = Project(
        name=name.strip(),
        description=(description or "").strip() or None,
        status=ProjectStatus(status),
    )
    session.add(project)
    session.commit()
    session.refresh(project)
    return project


def get_project_view_data(session: Session, project_id: int) -> dict | None:
    project = session.scalar(
        select(Project)
        .where(Project.id == project_id)
        .options(
            selectinload(Project.subtypes).selectinload(ProjectSubtype.children),
            selectinload(Project.instances)
            .selectinload(ProjectInstance.component)
            .selectinload(CatalogComponent.material_rules)
            .selectinload(ComponentMaterialRule.material),
            selectinload(Project.instances)
            .selectinload(ProjectInstance.component)
            .selectinload(CatalogComponent.material_rules)
            .selectinload(ComponentMaterialRule.condition_groups)
            .selectinload(MaterialRuleGroup.conditions),
            selectinload(Project.instances)
            .selectinload(ProjectInstance.attribute_groups)
            .selectinload(ProjectInstanceAttributeGroup.attribute_values),
            selectinload(Project.instances)
            .selectinload(ProjectInstance.parent_links)
            .selectinload(ProjectInstanceLink.child_instance),
            selectinload(Project.instances)
            .selectinload(ProjectInstance.child_links)
            .selectinload(ProjectInstanceLink.parent_instance),
            selectinload(Project.instances).selectinload(ProjectInstance.bom_entries).selectinload(ProjectBomEntry.material),
            selectinload(Project.instances).selectinload(ProjectInstance.category),
            selectinload(Project.auxiliary_materials)
            .selectinload(ProjectAuxiliaryMaterialSelection.auxiliary_material),
            selectinload(Project.auxiliary_materials).selectinload(ProjectAuxiliaryMaterialSelection.subtype),
        )
    )
    if project is None:
        return None

    categories = session.scalars(
        select(CatalogCategory)
        .options(
            selectinload(CatalogCategory.outgoing_links).selectinload(CatalogCategoryLink.linked_category),
        )
        .order_by(CatalogCategory.sort_order, CatalogCategory.name)
    ).all()

    children_by_parent = defaultdict(list)
    for category in categories:
        children_by_parent[category.parent_id].append(category)

    instance_groups = defaultdict(list)
    for instance in project.instances:
        instance_groups[instance.category_id].append(_serialize_instance(instance))

    subtype_nodes = [subtype for subtype in project.subtypes if subtype.parent_id is None]

    category_sections = []
    for root in children_by_parent[None]:
        category_sections.extend(_build_category_sections(root, instance_groups, children_by_parent, depth=0))

    return {
        "project": {
            "id": project.id,
            "name": project.name,
            "status": project.status.value,
            "status_label": STATUS_LABELS[project.status.value],
            "description": project.description,
            "instance_count": len(project.instances),
        },
        "subtypes": [_serialize_subtype(subtype) for subtype in subtype_nodes],
        "categories": category_sections,
        "auxiliary_materials": [
            {
                "code": selection.auxiliary_material.code,
                "name": selection.auxiliary_material.name,
                "category": selection.auxiliary_material.category,
                "price": selection.auxiliary_material.price,
                "subtype": selection.subtype.name if selection.subtype else "General",
            }
            for selection in sorted(project.auxiliary_materials, key=lambda item: item.auxiliary_material.code)
        ],
    }


def _build_category_sections(
    category: CatalogCategory,
    instance_groups: dict[int, list[dict]],
    children_by_parent: dict[int | None, list[CatalogCategory]],
    depth: int,
) -> list[dict]:
    section = {
        "id": category.id,
        "name": category.name,
        "scope": category.scope.value,
        "depth": depth,
        "linked_categories": [link.linked_category.name for link in category.outgoing_links],
        "instances": instance_groups.get(category.id, []),
    }
    sections = [section]
    for child in children_by_parent.get(category.id, []):
        sections.extend(_build_category_sections(child, instance_groups, children_by_parent, depth + 1))
    return sections


def _serialize_subtype(subtype: ProjectSubtype) -> dict:
    return {
        "id": subtype.id,
        "name": subtype.name,
        "children": [_serialize_subtype(child) for child in subtype.children],
    }


def _serialize_instance(instance: ProjectInstance) -> dict:
    linked_accessories = [link.child_instance.name for link in instance.parent_links]
    linked_to = [link.parent_instance.name for link in instance.child_links]
    grouped_attributes = []
    merged_attributes: dict[str, str | None] = {}

    for group in instance.attribute_groups:
        values = []
        for attribute in group.attribute_values:
            merged_attributes[attribute.attribute_name] = attribute.value
            values.append({"name": attribute.attribute_name, "value": attribute.value})
        grouped_attributes.append(
            {
                "name": group.name,
                "application_label": group.application_label,
                "values": values,
            }
        )

    bom_by_material: dict[int, list[dict]] = defaultdict(list)
    for entry in instance.bom_entries:
        bom_by_material[entry.material_id].append(
            {
                "subtype": entry.subtype.name if entry.subtype else "General",
                "quantity": entry.quantity,
                "assembly_quantity": entry.assembly_quantity,
                "unit": entry.unit or entry.material.unit,
                "calculation_mode": entry.calculation_mode.value,
                "calculation_formula": entry.calculation_formula,
            }
        )

    applicable_materials = []
    for rule in sorted(instance.component.material_rules, key=lambda item: item.display_order):
        if not _rule_applies(rule, merged_attributes):
            continue
        applicable_materials.append(
            {
                "material_name": rule.material.name,
                "sku": rule.material.sku,
                "unit_qty_per_unit": rule.unit_qty_per_unit,
                "unit": rule.unit or rule.material.unit,
                "notes": rule.notes,
                "bom_entries": bom_by_material.get(rule.material_id, []),
            }
        )

    return {
        "id": instance.id,
        "name": instance.name,
        "short_name": instance.short_name,
        "type": instance.instance_type.value,
        "description": instance.description,
        "installation": instance.installation,
        "unit_amount": instance.unit_amount,
        "attributes": grouped_attributes,
        "linked_accessories": linked_accessories,
        "linked_to": linked_to,
        "materials": applicable_materials,
    }


def _rule_applies(rule, attribute_values: dict[str, str | None]) -> bool:
    if not rule.condition_groups:
        return True
    for group in rule.condition_groups:
        if all(_condition_matches(condition, attribute_values) for condition in group.conditions):
            return True
    return False


def _condition_matches(condition, attribute_values: dict[str, str | None]) -> bool:
    raw_value = attribute_values.get(condition.attribute_name)
    operator = condition.operator.upper()

    if operator == "IS NOT NULL":
        return raw_value not in (None, "")
    if raw_value in (None, ""):
        return False
    if operator == "=":
        return raw_value == condition.comparison_value
    if operator == ">":
        return _to_float(raw_value) > _to_float(condition.comparison_value)
    if operator == "<":
        return _to_float(raw_value) < _to_float(condition.comparison_value)
    if operator == "IN":
        options = [value.strip() for value in (condition.comparison_value or "").split(",") if value.strip()]
        return raw_value in options
    if operator == "BETWEEN":
        candidate = _to_float(raw_value)
        return _to_float(condition.comparison_value) <= candidate <= _to_float(condition.comparison_value_secondary)
    return False


def _to_float(value: str | float | None) -> float:
    if value is None:
        return 0.0
    return float(value)
