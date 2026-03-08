from __future__ import annotations

from collections import defaultdict

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models import (
    CatalogCategory,
    CatalogCategoryLink,
    CatalogComponent,
    ComponentMaterialRule,
    InstanceExportSetting,
    MaterialRuleGroup,
    Project,
    ProjectAuxiliaryMaterialSelection,
    ProjectBomEntry,
    ProjectInstance,
    ProjectInstanceAttributeGroup,
    ProjectInstanceLink,
    ProjectInstanceSyncState,
    ProjectMaterialMode,
    ProjectMembership,
    ProjectStatus,
    ProjectSubtype,
    SyncStatus,
    User,
)
from app.models.entities import BomCalculationMode, MaterialMode, MembershipRole, utcnow
from app.services.auth import can_view_project


STATUS_LABELS = {
    ProjectStatus.TEMPLATE.value: "Project Template",
    ProjectStatus.EXECUTION.value: "Execution Projects",
    ProjectStatus.FINISHED.value: "Finished Projects",
}

SNAPSHOT_FIELDS = ("name", "short_name", "description", "short_description", "installation")


def get_projects_page_data(session: Session, user: User | None = None) -> dict:
    projects = session.scalars(
        select(Project)
        .options(selectinload(Project.instances), selectinload(Project.material_mode))
        .order_by(Project.status, Project.name)
    ).all()
    grouped = {status.value: [] for status in ProjectStatus}
    for project in projects:
        if user is not None and not can_view_project(user, project):
            continue
        grouped[project.status.value].append(_serialize_project_summary(project))
    return {"grouped_projects": grouped, "status_labels": STATUS_LABELS}


def create_project(
    session: Session,
    *,
    name: str,
    description: str | None,
    status: str,
    actor_user: User | None = None,
) -> Project:
    project = Project(
        name=name.strip(),
        description=(description or "").strip() or None,
        status=ProjectStatus(status),
    )
    session.add(project)
    session.flush()
    session.add(
        ProjectMaterialMode(
            project=project,
            mode=MaterialMode.GENERAL,
            changed_by=actor_user,
        )
    )
    if actor_user is not None:
        session.add(ProjectMembership(project=project, user=actor_user, role=MembershipRole.ADMIN))
    session.commit()
    session.refresh(project)
    return project


def get_project_view_data(session: Session, project_id: int, user: User | None = None) -> dict | None:
    project = get_project_with_details(session, project_id)
    if project is None:
        return None
    if user is not None and not can_view_project(user, project):
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
        instance_groups[instance.category_id].append(_serialize_instance(instance, project.material_mode))

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
            "material_mode": (project.material_mode.mode.value if project.material_mode else MaterialMode.GENERAL.value),
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


def get_project_with_details(session: Session, project_id: int) -> Project | None:
    return session.scalar(
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
            selectinload(Project.instances)
            .selectinload(ProjectInstance.bom_entries)
            .selectinload(ProjectBomEntry.material),
            selectinload(Project.instances).selectinload(ProjectInstance.category),
            selectinload(Project.instances).selectinload(ProjectInstance.sync_state),
            selectinload(Project.instances).selectinload(ProjectInstance.media),
            selectinload(Project.instances).selectinload(ProjectInstance.export_settings),
            selectinload(Project.auxiliary_materials)
            .selectinload(ProjectAuxiliaryMaterialSelection.auxiliary_material),
            selectinload(Project.auxiliary_materials).selectinload(ProjectAuxiliaryMaterialSelection.subtype),
            selectinload(Project.material_mode),
        )
    )


def set_project_material_mode(
    session: Session,
    *,
    project: Project,
    mode: str,
    actor_user: User | None,
) -> ProjectMaterialMode:
    current = project.material_mode
    if current is None:
        current = ProjectMaterialMode(project=project)
        session.add(current)
    current.mode = MaterialMode(mode)
    current.changed_by = actor_user
    current.updated_at = utcnow()
    session.commit()
    session.refresh(current)
    return current


def get_instance_sync_preview(session: Session, instance_id: int) -> dict | None:
    instance = session.scalar(
        select(ProjectInstance)
        .where(ProjectInstance.id == instance_id)
        .options(selectinload(ProjectInstance.component), selectinload(ProjectInstance.sync_state))
    )
    if instance is None:
        return None

    changes = []
    for field in SNAPSHOT_FIELDS:
        instance_value = getattr(instance, field)
        component_value = getattr(instance.component, field)
        if instance_value != component_value:
            changes.append(
                {
                    "field": field,
                    "current": instance_value,
                    "catalog": component_value,
                }
            )

    sync_status = instance.sync_state.sync_status.value if instance.sync_state else SyncStatus.UP_TO_DATE.value
    is_outdated = bool(instance.sync_state and instance.sync_state.source_component_updated_at != instance.component.updated_at)

    return {
        "instance_id": instance.id,
        "instance_name": instance.name,
        "component_id": instance.component_id,
        "component_name": instance.component.name,
        "sync_status": sync_status,
        "is_outdated": is_outdated or bool(changes),
        "changes": changes,
    }


def refresh_instance_snapshot(session: Session, *, instance_id: int, actor_user: User | None) -> dict | None:
    instance = session.scalar(
        select(ProjectInstance)
        .where(ProjectInstance.id == instance_id)
        .options(selectinload(ProjectInstance.component), selectinload(ProjectInstance.sync_state))
    )
    if instance is None:
        return None

    for field in SNAPSHOT_FIELDS:
        setattr(instance, field, getattr(instance.component, field))

    if instance.sync_state is None:
        instance.sync_state = ProjectInstanceSyncState(instance=instance)
        session.add(instance.sync_state)
    instance.sync_state.sync_status = SyncStatus.UP_TO_DATE
    instance.sync_state.last_synced_at = utcnow()
    instance.sync_state.source_component_updated_at = instance.component.updated_at
    instance.sync_state.sync_notes = f"Refreshed manually by {actor_user.username if actor_user else 'system'}."
    session.commit()
    return get_instance_sync_preview(session, instance_id)


def _serialize_project_summary(project: Project) -> dict:
    return {
        "id": project.id,
        "name": project.name,
        "status": project.status.value,
        "status_label": STATUS_LABELS[project.status.value],
        "description": project.description,
        "updated_at": project.updated_at.strftime("%Y-%m-%d %H:%M"),
        "instance_count": len(project.instances),
        "material_mode": (project.material_mode.mode.value if project.material_mode else MaterialMode.GENERAL.value),
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


def _serialize_instance(instance: ProjectInstance, project_material_mode: ProjectMaterialMode | None) -> dict:
    linked_accessories = [
        {
            "name": link.child_instance.name,
            "application_label": link.application_label or None,
            "relationship_type": link.relationship_type,
        }
        for link in sorted(instance.parent_links, key=lambda item: (item.sort_order, item.id))
    ]
    linked_to = [
        {
            "name": link.parent_instance.name,
            "application_label": link.application_label or None,
            "relationship_type": link.relationship_type,
        }
        for link in sorted(instance.child_links, key=lambda item: (item.sort_order, item.id))
    ]
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
        bom_by_material[entry.material_id].append(_serialize_bom_entry(entry))

    applicable_materials = []
    for rule in sorted(instance.component.material_rules, key=lambda item: item.display_order):
        evaluation = _evaluate_rule(rule, merged_attributes)
        if not evaluation["applies"]:
            continue
        applicable_materials.append(
            {
                "material_name": rule.material.name,
                "sku": rule.material.sku,
                "unit_qty_per_unit": rule.unit_qty_per_unit,
                "unit": rule.unit or rule.material.unit,
                "notes": rule.notes,
                "applicability": evaluation,
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
        "sync_state": {
            "status": instance.sync_state.sync_status.value if instance.sync_state else SyncStatus.UP_TO_DATE.value,
            "last_synced_at": instance.sync_state.last_synced_at.isoformat() if instance.sync_state and instance.sync_state.last_synced_at else None,
            "source_component_updated_at": instance.sync_state.source_component_updated_at.isoformat()
            if instance.sync_state and instance.sync_state.source_component_updated_at
            else None,
            "notes": instance.sync_state.sync_notes if instance.sync_state else None,
        },
        "media": [{"kind": media.kind, "uri": media.uri, "caption": media.caption} for media in instance.media],
        "export_settings": [
            {
                "target": setting.target,
                "settings": setting.settings,
            }
            for setting in sorted(instance.export_settings, key=lambda item: item.target)
        ],
        "material_mode": project_material_mode.mode.value if project_material_mode else MaterialMode.GENERAL.value,
    }


def _serialize_bom_entry(entry: ProjectBomEntry) -> dict:
    if entry.quantity is None:
        quantity_state = "blank"
    elif entry.quantity == 0:
        quantity_state = "zero"
    else:
        quantity_state = "value"

    if entry.assembly_quantity is None:
        assembly_state = "blank"
    elif entry.assembly_quantity == 0:
        assembly_state = "zero"
    else:
        assembly_state = "value"

    return {
        "subtype": entry.subtype.name if entry.subtype else "General",
        "quantity": entry.quantity,
        "quantity_state": quantity_state,
        "assembly_quantity": entry.assembly_quantity,
        "assembly_quantity_state": assembly_state,
        "unit": entry.unit or entry.material.unit,
        "calculation_mode": entry.calculation_mode.value,
        "calculation_formula": entry.calculation_formula,
        "calculation_explanation": _build_formula_explanation(entry),
    }


def _build_formula_explanation(entry: ProjectBomEntry) -> str | None:
    if entry.calculation_mode == BomCalculationMode.AUTO and entry.calculation_formula:
        return f"Auto calculated from formula {entry.calculation_formula}"
    if entry.calculation_mode == BomCalculationMode.MANUAL:
        return "Manually overridden quantity"
    return None


def _evaluate_rule(rule, attribute_values: dict[str, str | None]) -> dict:
    if not rule.condition_groups:
        return {
            "applies": True,
            "matched_groups": [],
            "groups": [],
        }

    group_results = []
    for group in rule.condition_groups:
        clause_results = []
        group_matches = True
        for condition in group.conditions:
            matched = _condition_matches(condition, attribute_values)
            clause_results.append(
                {
                    "attribute_name": condition.attribute_name,
                    "operator": condition.operator,
                    "comparison_value": condition.comparison_value,
                    "comparison_value_secondary": condition.comparison_value_secondary,
                    "matched": matched,
                }
            )
            if not matched:
                group_matches = False
        group_results.append(
            {
                "group": group.group_key,
                "matched": group_matches,
                "clauses": clause_results,
            }
        )

    return {
        "applies": any(group["matched"] for group in group_results),
        "matched_groups": [group["group"] for group in group_results if group["matched"]],
        "groups": group_results,
    }


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
