from __future__ import annotations

from collections import defaultdict

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models import (
    AttributeScope,
    CatalogAttributeDefinition,
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
    ProjectInstanceAttributeValue,
    ProjectInstanceLink,
    ProjectInstanceMedia,
    ProjectInstanceOccurrence,
    ProjectInstanceOccurrenceAttributeValue,
    ProjectInstanceOccurrenceTarget,
    ProjectInstanceSyncState,
    ProjectMaterialMode,
    ProjectMembership,
    ProjectStatus,
    ProjectSubtype,
    SyncStatus,
    User,
)
from app.models.entities import BomCalculationMode, MaterialMode, MembershipRole, utcnow
from app.services.audit import build_activity_change, build_activity_details, build_audit_context, record_project_activity
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
    mutation_batch_id: str | None = None,
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
    if actor_user is not None:
        record_project_activity(
            session,
            project=project,
            context=build_audit_context(
                actor=actor_user,
                mutation_batch_id=mutation_batch_id,
                title="Project created",
                scope_type="project",
                scope_id=project.id,
            ),
            entity_type="Project",
            entity_id=project.id,
            action="created",
            title="Project created",
            scope_type="project",
            scope_id=project.id,
            details=build_activity_details(
                headline="Project created",
                subject_name=project.name,
                notes=[f"Status: {project.status.value.replace('_', ' ')}"],
                changes=[build_activity_change("Description", None, project.description)],
                kind="project",
            ),
        )
    session.commit()
    session.refresh(project)
    return project


def create_project_subtype(
    session: Session,
    *,
    project: Project,
    name: str,
    parent_id: int | None = None,
    actor_user: User | None = None,
    mutation_batch_id: str | None = None,
) -> ProjectSubtype:
    clean_name = name.strip()
    if not clean_name:
        raise ValueError("Subtype name is required.")

    parent: ProjectSubtype | None = None
    if parent_id is not None:
        parent = session.scalar(
            select(ProjectSubtype).where(ProjectSubtype.id == parent_id, ProjectSubtype.project_id == project.id)
        )
        if parent is None:
            raise ValueError("Parent subtype was not found in this project.")

    subtype = ProjectSubtype(project=project, parent=parent, name=clean_name)
    session.add(subtype)
    session.flush()
    if actor_user is not None:
        record_project_activity(
            session,
            project=project,
            context=build_audit_context(
                actor=actor_user,
                mutation_batch_id=mutation_batch_id,
                title=f"Created subtype {subtype.name}",
                scope_type="subtype",
                scope_id=subtype.id,
            ),
            entity_type="ProjectSubtype",
            entity_id=subtype.id,
            action="created",
            title=f"Created subtype {subtype.name}",
            scope_type="subtype",
            scope_id=subtype.id,
            details=build_activity_details(
                headline="Subtype created",
                subject_name=subtype.name,
                notes=[f"Parent subtype: {parent.name}" if parent else "Top-level subtype"],
                kind="subtype",
            ),
        )
    session.commit()
    session.refresh(subtype)
    return subtype


def update_project_subtype(
    session: Session,
    *,
    project: Project,
    subtype_id: int,
    name: str,
    actor_user: User | None = None,
    mutation_batch_id: str | None = None,
) -> ProjectSubtype | None:
    subtype = session.scalar(
        select(ProjectSubtype).where(ProjectSubtype.id == subtype_id, ProjectSubtype.project_id == project.id)
    )
    if subtype is None:
        return None

    clean_name = name.strip()
    if not clean_name:
        raise ValueError("Subtype name is required.")

    previous_name = subtype.name
    subtype.name = clean_name
    if actor_user is not None and previous_name != subtype.name:
        record_project_activity(
            session,
            project=project,
            context=build_audit_context(
                actor=actor_user,
                mutation_batch_id=mutation_batch_id,
                title=f"Updated subtype {subtype.name}",
                scope_type="subtype",
                scope_id=subtype.id,
            ),
            entity_type="ProjectSubtype",
            entity_id=subtype.id,
            action="updated",
            title=f"Updated subtype {subtype.name}",
            scope_type="subtype",
            scope_id=subtype.id,
            details=build_activity_details(
                headline="Subtype renamed",
                subject_name=subtype.name,
                changes=[build_activity_change("Subtype name", previous_name, subtype.name)],
                kind="subtype",
            ),
        )
    session.commit()
    session.refresh(subtype)
    return subtype


def delete_project_subtype(
    session: Session,
    *,
    project: Project,
    subtype_id: int,
    actor_user: User | None = None,
    mutation_batch_id: str | None = None,
) -> bool:
    subtype = session.scalar(
        select(ProjectSubtype).where(ProjectSubtype.id == subtype_id, ProjectSubtype.project_id == project.id)
    )
    if subtype is None:
        return False
    details = {"name": subtype.name, "parent_id": subtype.parent_id}
    if actor_user is not None:
        record_project_activity(
            session,
            project=project,
            context=build_audit_context(
                actor=actor_user,
                mutation_batch_id=mutation_batch_id,
                title=f"Deleted subtype {subtype.name}",
                scope_type="subtype",
                scope_id=subtype.id,
            ),
            entity_type="ProjectSubtype",
            entity_id=subtype.id,
            action="deleted",
            title=f"Deleted subtype {subtype.name}",
            scope_type="subtype",
            scope_id=subtype.id,
            details=build_activity_details(
                headline="Subtype deleted",
                subject_name=subtype.name,
                notes=[
                    f"Parent subtype: {parent.name}" if (parent := subtype.parent) else "Top-level subtype",
                ],
                kind="subtype",
            ),
        )
    session.delete(subtype)
    session.commit()
    return True


def create_project_instance(
    session: Session,
    *,
    project: Project,
    category_id: int,
    component_id: int,
    name: str,
    short_name: str | None,
    description: str | None,
    short_description: str | None,
    installation: str | None,
    unit_amount: float | None,
    attribute_values: dict[str, str | None] | None = None,
    actor_user: User | None = None,
    mutation_batch_id: str | None = None,
) -> ProjectInstance:
    component = session.scalar(
        select(CatalogComponent)
        .where(CatalogComponent.id == component_id, CatalogComponent.category_id == category_id)
        .options(selectinload(CatalogComponent.attribute_definitions))
    )
    if component is None:
        raise ValueError("Selected component does not belong to the requested category.")

    clean_description = (description or "").strip() or component.description
    clean_short_description = (short_description or "").strip() or component.short_description
    clean_installation = (installation or "").strip() or component.installation
    instance = ProjectInstance(
        project=project,
        component=component,
        category_id=category_id,
        instance_type=component.component_type,
        name=name.strip(),
        short_name=(short_name or "").strip() or None,
        description=clean_description,
        short_description=clean_short_description,
        installation=clean_installation,
        unit_amount=unit_amount,
    )
    session.add(instance)
    session.flush()
    _sync_base_attribute_group(instance)
    _apply_base_attribute_values(instance, attribute_values or {})
    session.add(
        ProjectInstanceSyncState(
            instance=instance,
            sync_status=SyncStatus.UP_TO_DATE,
            last_synced_at=utcnow(),
            source_component_updated_at=component.updated_at,
            sync_notes="Snapshot created from catalog template.",
        )
    )
    if actor_user is not None:
        record_project_activity(
            session,
            project=project,
            context=build_audit_context(
                actor=actor_user,
                mutation_batch_id=mutation_batch_id,
                title=f"Added {instance.name}",
                scope_type="instance",
                scope_id=instance.id,
            ),
            entity_type="ProjectInstance",
            entity_id=instance.id,
            action="created",
            title=f"Added {instance.name}",
            scope_type="instance",
            scope_id=instance.id,
            details=build_activity_details(
                headline="Component added",
                subject_name=instance.name,
                notes=[
                    f"Category: {instance.component.category.name}" if instance.component.category else "",
                    f"Template: {instance.component.name}",
                ],
                changes=_instance_creation_changes(instance),
                kind="instance",
            ),
        )
    session.commit()
    session.refresh(instance)
    return instance


def update_project_instance(
    session: Session,
    *,
    project: Project,
    instance_id: int,
    name: str,
    short_name: str | None,
    description: str | None,
    short_description: str | None,
    installation: str | None,
    unit_amount: float | None,
    attribute_values: dict[str, str | None] | None = None,
    actor_user: User | None = None,
    mutation_batch_id: str | None = None,
) -> ProjectInstance | None:
    instance = session.scalar(
        select(ProjectInstance)
        .where(ProjectInstance.id == instance_id, ProjectInstance.project_id == project.id)
        .options(
            selectinload(ProjectInstance.component).selectinload(CatalogComponent.attribute_definitions),
            selectinload(ProjectInstance.attribute_groups).selectinload(ProjectInstanceAttributeGroup.attribute_values),
            selectinload(ProjectInstance.sync_state),
        )
    )
    if instance is None:
        return None

    previous_snapshot = _instance_snapshot(instance)
    clean_description = (description or "").strip() or None
    clean_short_description = (short_description or "").strip() or None
    clean_installation = (installation or "").strip() or None
    instance.name = name.strip()
    instance.short_name = (short_name or "").strip() or None
    instance.description = clean_description
    instance.short_description = clean_short_description
    instance.installation = clean_installation
    instance.unit_amount = unit_amount
    _sync_base_attribute_group(instance)
    _apply_base_attribute_values(instance, attribute_values or {})

    if instance.sync_state is None:
        instance.sync_state = ProjectInstanceSyncState(instance=instance)
        session.add(instance.sync_state)
    instance.sync_state.sync_status = SyncStatus.CUSTOMIZED
    instance.sync_state.last_synced_at = utcnow()
    instance.sync_state.source_component_updated_at = instance.component.updated_at
    instance.sync_state.sync_notes = "Project instance customized after snapshot creation."
    next_snapshot = _instance_snapshot(instance)
    activity_changes = _describe_instance_changes(previous_snapshot, next_snapshot)
    if actor_user is not None and activity_changes:
        record_project_activity(
            session,
            project=project,
            context=build_audit_context(
                actor=actor_user,
                mutation_batch_id=mutation_batch_id,
                title=f"Updated {instance.name}",
                scope_type="instance",
                scope_id=instance.id,
            ),
            entity_type="ProjectInstance",
            entity_id=instance.id,
            action="updated",
            title=f"Updated {instance.name}",
            scope_type="instance",
            scope_id=instance.id,
            details=build_activity_details(
                headline="Component details changed",
                subject_name=instance.name,
                changes=activity_changes,
                kind="instance",
            ),
        )
    session.commit()
    session.refresh(instance)
    return instance


def create_project_instance_occurrence(
    session: Session,
    *,
    project: Project,
    instance_id: int,
    relationship_type: str,
    context_label: str | None,
    target_instance_id: int | None,
    attribute_values: dict[str, str | None] | None = None,
    actor_user: User | None = None,
    mutation_batch_id: str | None = None,
) -> ProjectInstanceOccurrence | None:
    instance = _load_instance_for_occurrence_edit(session, project_id=project.id, instance_id=instance_id)
    if instance is None:
        return None

    occurrence = ProjectInstanceOccurrence(
        source_instance=instance,
        relationship_type=(relationship_type or "").strip() or "uses",
        context_label=(context_label or "").strip() or None,
        context_notes=None,
        sort_order=(instance.outgoing_occurrences[-1].sort_order + 1) if instance.outgoing_occurrences else 1,
    )
    session.add(occurrence)
    session.flush()
    _replace_occurrence_target(
        session,
        project=project,
        source_instance=instance,
        occurrence=occurrence,
        target_instance_id=target_instance_id,
    )
    _replace_occurrence_attribute_values(instance, occurrence, attribute_values or {})
    if actor_user is not None:
        record_project_activity(
            session,
            project=project,
            context=build_audit_context(
                actor=actor_user,
                mutation_batch_id=mutation_batch_id,
                title=f"Updated usage for {instance.name}",
                scope_type="instance",
                scope_id=instance.id,
            ),
            entity_type="ProjectInstanceOccurrence",
            entity_id=occurrence.id,
            action="created",
            title=f"Updated usage for {instance.name}",
            scope_type="instance",
            scope_id=instance.id,
            details=build_activity_details(
                headline="Usage added",
                subject_name=instance.name,
                notes=_occurrence_notes(occurrence),
                changes=_describe_occurrence_creation(occurrence),
                kind="usage",
            ),
        )
    session.commit()
    session.refresh(occurrence)
    return occurrence


def update_project_instance_occurrence(
    session: Session,
    *,
    project: Project,
    instance_id: int,
    occurrence_id: int,
    relationship_type: str,
    context_label: str | None,
    target_instance_id: int | None,
    attribute_values: dict[str, str | None] | None = None,
    actor_user: User | None = None,
    mutation_batch_id: str | None = None,
) -> ProjectInstanceOccurrence | None:
    instance = _load_instance_for_occurrence_edit(session, project_id=project.id, instance_id=instance_id)
    if instance is None:
        return None

    occurrence = next((row for row in instance.outgoing_occurrences if row.id == occurrence_id), None)
    if occurrence is None:
        return None

    previous_snapshot = _occurrence_snapshot(occurrence)
    occurrence.relationship_type = (relationship_type or "").strip() or occurrence.relationship_type or "uses"
    occurrence.context_label = (context_label or "").strip() or None
    occurrence.context_notes = None
    _replace_occurrence_target(
        session,
        project=project,
        source_instance=instance,
        occurrence=occurrence,
        target_instance_id=target_instance_id,
    )
    _replace_occurrence_attribute_values(instance, occurrence, attribute_values or {})
    next_snapshot = _occurrence_snapshot(occurrence)
    activity_changes = _describe_occurrence_changes(previous_snapshot, next_snapshot)
    if actor_user is not None and activity_changes:
        record_project_activity(
            session,
            project=project,
            context=build_audit_context(
                actor=actor_user,
                mutation_batch_id=mutation_batch_id,
                title=f"Updated usage for {instance.name}",
                scope_type="instance",
                scope_id=instance.id,
            ),
            entity_type="ProjectInstanceOccurrence",
            entity_id=occurrence.id,
            action="updated",
            title=f"Updated usage for {instance.name}",
            scope_type="instance",
            scope_id=instance.id,
            details=build_activity_details(
                headline="Usage changed",
                subject_name=instance.name,
                changes=activity_changes,
                kind="usage",
            ),
        )
    session.commit()
    session.refresh(occurrence)
    return occurrence


def delete_project_instance_occurrence(
    session: Session,
    *,
    project: Project,
    instance_id: int,
    occurrence_id: int,
    actor_user: User | None = None,
    mutation_batch_id: str | None = None,
) -> bool:
    instance = _load_instance_for_occurrence_edit(session, project_id=project.id, instance_id=instance_id)
    if instance is None:
        return False

    occurrence = next((row for row in instance.outgoing_occurrences if row.id == occurrence_id), None)
    if occurrence is None:
        return False

    details = _occurrence_snapshot(occurrence)
    if actor_user is not None:
        record_project_activity(
            session,
            project=project,
            context=build_audit_context(
                actor=actor_user,
                mutation_batch_id=mutation_batch_id,
                title=f"Updated usage for {instance.name}",
                scope_type="instance",
                scope_id=instance.id,
            ),
            entity_type="ProjectInstanceOccurrence",
            entity_id=occurrence.id,
            action="deleted",
            title=f"Updated usage for {instance.name}",
            scope_type="instance",
            scope_id=instance.id,
            details=build_activity_details(
                headline="Usage removed",
                subject_name=instance.name,
                notes=_occurrence_notes_from_snapshot(details),
                kind="usage",
            ),
        )
    session.delete(occurrence)
    session.commit()
    return True


def delete_project_instance(
    session: Session,
    *,
    project: Project,
    instance_id: int,
    actor_user: User | None = None,
    mutation_batch_id: str | None = None,
) -> bool:
    instance = session.scalar(
        select(ProjectInstance)
        .where(ProjectInstance.id == instance_id, ProjectInstance.project_id == project.id)
    )
    if instance is None:
        return False
    details = _instance_snapshot(instance)
    if actor_user is not None:
        record_project_activity(
            session,
            project=project,
            context=build_audit_context(
                actor=actor_user,
                mutation_batch_id=mutation_batch_id,
                title=f"Deleted {instance.name}",
                scope_type="instance",
                scope_id=instance.id,
            ),
            entity_type="ProjectInstance",
            entity_id=instance.id,
            action="deleted",
            title=f"Deleted {instance.name}",
            scope_type="instance",
            scope_id=instance.id,
            details=build_activity_details(
                headline="Component deleted",
                subject_name=instance.name,
                changes=_describe_instance_deletion(details),
                kind="instance",
            ),
        )
    session.delete(instance)
    session.commit()
    return True


def get_project_instance_data(session: Session, project_id: int, instance_id: int) -> dict | None:
    project = get_project_with_details(session, project_id)
    if project is None:
        return None

    instance = next((row for row in project.instances if row.id == instance_id), None)
    if instance is None:
        return None

    flat_subtypes = _flatten_subtypes(project.subtypes)
    return _serialize_instance(instance, flat_subtypes, project.material_mode)


def get_project_occurrence_data(
    session: Session,
    project_id: int,
    instance_id: int,
    occurrence_id: int,
) -> dict | None:
    project = get_project_with_details(session, project_id)
    if project is None:
        return None

    instance = next((row for row in project.instances if row.id == instance_id), None)
    if instance is None:
        return None

    occurrence = next((row for row in instance.outgoing_occurrences if row.id == occurrence_id), None)
    if occurrence is None:
        return None

    return _serialize_occurrence(occurrence)


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
            selectinload(CatalogCategory.components)
            .selectinload(CatalogComponent.attribute_definitions)
            .selectinload(CatalogAttributeDefinition.options),
            selectinload(CatalogCategory.components)
            .selectinload(CatalogComponent.attribute_definitions),
        )
        .order_by(CatalogCategory.sort_order, CatalogCategory.name)
    ).all()

    children_by_parent = defaultdict(list)
    for category in categories:
        children_by_parent[category.parent_id].append(category)

    subtype_nodes = [subtype for subtype in project.subtypes if subtype.parent_id is None]
    flat_subtypes = _flatten_subtypes(subtype_nodes)

    instance_groups = defaultdict(list)
    for instance in project.instances:
        instance_groups[instance.category_id].append(_serialize_instance(instance, flat_subtypes, project.material_mode))

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
            .selectinload(CatalogComponent.attribute_definitions)
            .selectinload(CatalogAttributeDefinition.options),
            selectinload(Project.instances)
            .selectinload(ProjectInstance.component)
            .selectinload(CatalogComponent.attribute_definitions),
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
            .selectinload(ProjectInstance.outgoing_occurrences)
            .selectinload(ProjectInstanceOccurrence.targets)
            .selectinload(ProjectInstanceOccurrenceTarget.target_instance),
            selectinload(Project.instances)
            .selectinload(ProjectInstance.outgoing_occurrences)
            .selectinload(ProjectInstanceOccurrence.attribute_values),
            selectinload(Project.instances)
            .selectinload(ProjectInstance.occurrence_targets)
            .selectinload(ProjectInstanceOccurrenceTarget.occurrence)
            .selectinload(ProjectInstanceOccurrence.source_instance),
            selectinload(Project.instances)
            .selectinload(ProjectInstance.occurrence_targets)
            .selectinload(ProjectInstanceOccurrenceTarget.occurrence)
            .selectinload(ProjectInstanceOccurrence.attribute_values),
            selectinload(Project.instances)
            .selectinload(ProjectInstance.occurrence_targets)
            .selectinload(ProjectInstanceOccurrenceTarget.occurrence)
            .selectinload(ProjectInstanceOccurrence.targets)
            .selectinload(ProjectInstanceOccurrenceTarget.target_instance),
            selectinload(Project.instances)
            .selectinload(ProjectInstance.bom_entries)
            .selectinload(ProjectBomEntry.material),
            selectinload(Project.instances)
            .selectinload(ProjectInstance.bom_entries)
            .selectinload(ProjectBomEntry.material_rule)
            .selectinload(ComponentMaterialRule.material),
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
    mutation_batch_id: str | None = None,
) -> ProjectMaterialMode:
    current = project.material_mode
    previous_mode = current.mode.value if current is not None else None
    if current is None:
        current = ProjectMaterialMode(project=project)
        session.add(current)
    current.mode = MaterialMode(mode)
    current.changed_by = actor_user
    current.updated_at = utcnow()
    session.flush()
    if actor_user is not None and previous_mode != current.mode.value:
        record_project_activity(
            session,
            project=project,
            context=build_audit_context(
                actor=actor_user,
                mutation_batch_id=mutation_batch_id,
                title="Material mode updated",
                scope_type="project",
                scope_id=project.id,
            ),
            entity_type="ProjectMaterialMode",
            entity_id=current.id,
            action="updated",
            title="Material mode updated",
            scope_type="project",
            scope_id=project.id,
            details=build_activity_details(
                headline="Project material mode changed",
                subject_name=project.name,
                changes=[build_activity_change("Material mode", _material_mode_label(previous_mode), _material_mode_label(current.mode.value))],
                kind="material",
            ),
        )
    session.commit()
    session.refresh(current)
    return current


def replace_project_material_occurrence(
    session: Session,
    *,
    project: Project,
    instance_id: int,
    rule_id: int,
    mode: str,
    entries: list[dict],
    actor_user: User | None = None,
    mutation_batch_id: str | None = None,
) -> bool:
    instance = session.scalar(
        select(ProjectInstance)
        .where(ProjectInstance.id == instance_id, ProjectInstance.project_id == project.id)
        .options(
            selectinload(ProjectInstance.component)
            .selectinload(CatalogComponent.material_rules)
            .selectinload(ComponentMaterialRule.material),
            selectinload(ProjectInstance.component)
            .selectinload(CatalogComponent.material_rules)
            .selectinload(ComponentMaterialRule.condition_groups)
            .selectinload(MaterialRuleGroup.conditions),
            selectinload(ProjectInstance.attribute_groups).selectinload(ProjectInstanceAttributeGroup.attribute_values),
            selectinload(ProjectInstance.bom_entries),
        )
    )
    if instance is None:
        return False

    normalized_mode = mode.strip()
    if normalized_mode not in {MaterialMode.GENERAL.value, MaterialMode.PER_SUBTYPE.value}:
        raise ValueError("Invalid material mode.")

    rule = next((item for item in instance.component.material_rules if item.id == rule_id), None)
    if rule is None:
        raise ValueError("Material occurrence was not found on this instance.")

    attribute_values = _collect_attribute_values(instance)
    evaluation = _evaluate_rule(rule, attribute_values)
    if not evaluation["applies"]:
        raise ValueError("Material occurrence is no longer applicable for this instance.")

    subtype_rows = _visible_project_subtype_rows(project)
    subtype_map = {subtype["id"]: subtype["model"] for subtype in subtype_rows}
    normalized_entries: list[dict] = []
    seen_subtype_ids: set[int | None] = set()
    for row in entries:
        subtype_id = row.get("subtype_id")
        if subtype_id is not None and subtype_id not in subtype_map:
            raise ValueError("One or more subtype rows do not belong to this project.")
        if subtype_id in seen_subtype_ids:
            raise ValueError("Duplicate subtype rows are not allowed.")
        seen_subtype_ids.add(subtype_id)
        normalized_entries.append(
            {
                "subtype_id": subtype_id,
                "quantity": row.get("quantity"),
                "assembly_quantity": row.get("assembly_quantity"),
            }
        )

    if normalized_mode == MaterialMode.GENERAL.value:
        if len(normalized_entries) != 1 or normalized_entries[0]["subtype_id"] is not None:
            raise ValueError("General material mode requires exactly one general row.")
    else:
        required_subtype_ids = {subtype["id"] for subtype in subtype_rows}
        submitted_subtype_ids = {row["subtype_id"] for row in normalized_entries}
        if required_subtype_ids != submitted_subtype_ids:
            raise ValueError("Subtype material mode requires one row for each project subtype.")

    previous_snapshot = _bom_entry_snapshot(
        [entry for entry in instance.bom_entries if entry.material_rule_id == rule.id]
    )

    for bom_entry in list(instance.bom_entries):
        if bom_entry.material_rule_id == rule.id:
            instance.bom_entries.remove(bom_entry)
            session.delete(bom_entry)
    session.flush()

    for row in normalized_entries:
        instance.bom_entries.append(
            ProjectBomEntry(
                project=project,
                instance=instance,
                material_rule=rule,
                material=rule.material,
                subtype=subtype_map.get(row["subtype_id"]),
                quantity=row["quantity"],
                assembly_quantity=row["assembly_quantity"],
                unit=rule.unit or rule.material.unit,
                calculation_mode=BomCalculationMode.MANUAL,
                calculation_formula=None,
            )
        )

    next_snapshot = _normalized_bom_snapshot(normalized_entries, project)
    if actor_user is not None and previous_snapshot != next_snapshot:
        record_project_activity(
            session,
            project=project,
            context=build_audit_context(
                actor=actor_user,
                mutation_batch_id=mutation_batch_id,
                title=f"Updated materials for {instance.name}",
                scope_type="instance",
                scope_id=instance.id,
            ),
            entity_type="ProjectBomEntry",
            entity_id=rule.id,
            action="updated",
            title=f"Updated materials for {instance.name}",
            scope_type="instance",
            scope_id=instance.id,
            details=build_activity_details(
                headline="Material quantities changed",
                subject_name=rule.material.name,
                notes=[f"Component: {instance.name}"],
                changes=_describe_material_quantity_changes(previous_snapshot, next_snapshot),
                kind="material",
            ),
        )
    session.commit()
    return True


def get_instance_sync_preview(session: Session, instance_id: int) -> dict | None:
    instance = session.scalar(
        select(ProjectInstance)
        .where(ProjectInstance.id == instance_id)
        .options(
            selectinload(ProjectInstance.component).selectinload(CatalogComponent.attribute_definitions),
            selectinload(ProjectInstance.attribute_groups).selectinload(ProjectInstanceAttributeGroup.attribute_values),
            selectinload(ProjectInstance.sync_state),
        )
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

    base_group = next((group for group in instance.attribute_groups if not group.application_label), None)
    instance_attributes = [value.attribute_name for value in base_group.attribute_values] if base_group else []
    component_attributes = [definition.name for definition in _component_attribute_definitions(instance.component, AttributeScope.BASE)]
    if instance_attributes != component_attributes:
        changes.append(
            {
                "field": "attributes",
                "current": ", ".join(instance_attributes) if instance_attributes else None,
                "catalog": ", ".join(component_attributes) if component_attributes else None,
            }
        )

    sync_status = _effective_sync_status(instance).value
    is_outdated = _is_instance_outdated(instance)

    return {
        "instance_id": instance.id,
        "instance_name": instance.name,
        "component_id": instance.component_id,
        "component_name": instance.component.name,
        "sync_status": sync_status,
        "is_outdated": is_outdated or bool(changes),
        "changes": changes,
    }


def refresh_instance_snapshot(
    session: Session,
    *,
    instance_id: int,
    actor_user: User | None,
    mutation_batch_id: str | None = None,
) -> dict | None:
    instance = session.scalar(
        select(ProjectInstance)
        .where(ProjectInstance.id == instance_id)
        .options(
            selectinload(ProjectInstance.component).selectinload(CatalogComponent.attribute_definitions),
            selectinload(ProjectInstance.attribute_groups).selectinload(ProjectInstanceAttributeGroup.attribute_values),
            selectinload(ProjectInstance.sync_state),
        )
    )
    if instance is None:
        return None

    previous_preview = get_instance_sync_preview(session, instance_id)
    for field in SNAPSHOT_FIELDS:
        setattr(instance, field, getattr(instance.component, field))
    _sync_base_attribute_group(instance)

    if instance.sync_state is None:
        instance.sync_state = ProjectInstanceSyncState(instance=instance)
        session.add(instance.sync_state)
    instance.sync_state.sync_status = SyncStatus.UP_TO_DATE
    instance.sync_state.last_synced_at = utcnow()
    instance.sync_state.source_component_updated_at = instance.component.updated_at
    instance.sync_state.sync_notes = f"Refreshed manually by {actor_user.username if actor_user else 'system'}."
    if actor_user is not None:
        record_project_activity(
            session,
            project=instance.project,
            context=build_audit_context(
                actor=actor_user,
                mutation_batch_id=mutation_batch_id,
                title=f"Refreshed {instance.name}",
                scope_type="instance",
                scope_id=instance.id,
            ),
            entity_type="ProjectInstance",
            entity_id=instance.id,
            action="refreshed",
            title=f"Refreshed {instance.name}",
            scope_type="instance",
            scope_id=instance.id,
            details=build_activity_details(
                headline="Catalog values reapplied",
                subject_name=instance.name,
                notes=[f"Template: {instance.component.name}"],
                changes=_describe_sync_preview_changes(previous_preview["changes"] if previous_preview else []),
                kind="instance",
            ),
        )
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
        "linked_category_ids": [link.linked_category_id for link in category.outgoing_links],
        "linked_categories": [link.linked_category.name for link in category.outgoing_links],
        "available_components": [
            {
                "id": component.id,
                "name": component.name,
                "short_name": component.short_name,
                "type": component.component_type.value,
                "description": component.description,
                "short_description": component.short_description,
                "installation": component.installation,
                "base_attributes": [_serialize_editable_definition(definition) for definition in _component_attribute_definitions(component, AttributeScope.BASE)],
                "usage_attributes": [_serialize_editable_definition(definition) for definition in _component_attribute_definitions(component, AttributeScope.USAGE)],
            }
            for component in sorted(category.components, key=lambda item: item.name)
        ],
        "instances": instance_groups.get(category.id, []),
    }
    sections = [section]
    for child in children_by_parent.get(category.id, []):
        sections.extend(_build_category_sections(child, instance_groups, children_by_parent, depth + 1))
    return sections


def _serialize_subtype(subtype: ProjectSubtype) -> dict:
    return {
        "id": subtype.id,
        "parent_id": subtype.parent_id,
        "name": subtype.name,
        "children": [_serialize_subtype(child) for child in subtype.children],
    }


def _serialize_instance(
    instance: ProjectInstance,
    flat_subtypes: list[dict],
    project_material_mode: ProjectMaterialMode | None,
) -> dict:
    base_definitions = _component_attribute_definitions(instance.component, AttributeScope.BASE)
    usage_definitions = _component_attribute_definitions(instance.component, AttributeScope.USAGE)
    legacy_linked_accessories = [
        {
            "name": link.child_instance.name,
            "application_label": link.application_label or None,
            "relationship_type": link.relationship_type,
        }
        for link in sorted(instance.parent_links, key=lambda item: (item.sort_order, item.id))
    ]
    legacy_linked_to = [
        {
            "name": link.parent_instance.name,
            "application_label": link.application_label or None,
            "relationship_type": link.relationship_type,
        }
        for link in sorted(instance.child_links, key=lambda item: (item.sort_order, item.id))
    ]
    outgoing_occurrences = [_serialize_occurrence(occurrence) for occurrence in instance.outgoing_occurrences]
    incoming_occurrence_rows = sorted(
        {target.occurrence.id: target.occurrence for target in instance.occurrence_targets}.values(),
        key=lambda occurrence: (occurrence.sort_order, occurrence.id),
    )
    incoming_occurrences = [_serialize_occurrence(occurrence) for occurrence in incoming_occurrence_rows]
    linked_accessories = _merge_link_badges(
        legacy_linked_accessories,
        [
            {
                "name": occurrence.source_instance.name,
                "application_label": occurrence.context_label or None,
                "relationship_type": occurrence.relationship_type,
            }
            for occurrence in incoming_occurrence_rows
        ],
    )
    linked_to = _merge_link_badges(
        legacy_linked_to,
        [
            {
                "name": ", ".join(target.target_instance.name for target in occurrence.targets) or "Freeform context",
                "application_label": occurrence.context_label or None,
                "relationship_type": occurrence.relationship_type,
            }
            for occurrence in instance.outgoing_occurrences
        ],
    )
    grouped_attributes = []
    merged_attributes: dict[str, str | None] = {}
    base_attribute_values: dict[str, str | None] = {}

    for group in instance.attribute_groups:
        values = []
        for attribute in group.attribute_values:
            merged_attributes[attribute.attribute_name] = attribute.value
            if not group.application_label:
                base_attribute_values[attribute.attribute_name] = attribute.value
            values.append({"name": attribute.attribute_name, "value": attribute.value})
        grouped_attributes.append(
            {
                "name": group.name,
                "application_label": group.application_label,
                "values": values,
            }
        )

    bom_by_rule: dict[int, list[ProjectBomEntry]] = defaultdict(list)
    for entry in instance.bom_entries:
        bom_by_rule[entry.material_rule_id].append(entry)

    applicable_materials = []
    for rule in sorted(instance.component.material_rules, key=lambda item: item.display_order):
        evaluation = _evaluate_rule(rule, merged_attributes)
        if not evaluation["applies"]:
            continue
        applicable_materials.append(
            {
                "rule_id": rule.id,
                "material_id": rule.material_id,
                "material_name": rule.material.name,
                "sku": rule.material.sku,
                "unit_qty_per_unit": rule.unit_qty_per_unit,
                "unit": rule.unit or rule.material.unit,
                "notes": rule.notes,
                "applicability": evaluation,
                "mode": _material_mode_for_entries(bom_by_rule.get(rule.id, [])),
                "bom_entries": _serialize_material_bom_entries(rule, bom_by_rule.get(rule.id, []), flat_subtypes),
            }
        )

    effective_sync_status = _effective_sync_status(instance)
    is_outdated = _is_instance_outdated(instance)

    return {
        "id": instance.id,
        "name": instance.name,
        "short_name": instance.short_name,
        "type": instance.instance_type.value,
        "description": instance.description,
        "short_description": instance.short_description,
        "installation": instance.installation,
        "unit_amount": instance.unit_amount,
        "editable_attributes": [
            {
                **_serialize_editable_definition(definition),
                "value": base_attribute_values.get(definition.name),
            }
            for definition in base_definitions
        ],
        "usage_attribute_definitions": [_serialize_editable_definition(definition) for definition in usage_definitions],
        "attributes": grouped_attributes,
        "linked_accessories": linked_accessories,
        "linked_to": linked_to,
        "outgoing_occurrences": outgoing_occurrences,
        "incoming_occurrences": incoming_occurrences,
        "materials": applicable_materials,
        "sync_state": {
            "status": effective_sync_status.value,
            "is_outdated": is_outdated,
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


def _serialize_occurrence(occurrence: ProjectInstanceOccurrence) -> dict:
    return {
        "id": occurrence.id,
        "relationship_type": occurrence.relationship_type,
        "context_label": occurrence.context_label,
        "targets": [
            {
                "instance_id": target.target_instance_id,
                "instance_name": target.target_instance.name,
            }
            for target in occurrence.targets
        ],
        "attributes": [
            {
                "name": attribute.attribute_name,
                "value": attribute.value,
            }
            for attribute in occurrence.attribute_values
        ],
    }


def _merge_link_badges(*badge_groups: list[dict]) -> list[dict]:
    merged: list[dict] = []
    seen: set[tuple[str, str | None, str]] = set()
    for group in badge_groups:
        for badge in group:
            key = (badge["name"], badge["application_label"], badge["relationship_type"])
            if key in seen:
                continue
            seen.add(key)
            merged.append(badge)
    return merged


def _serialize_editable_definition(definition: CatalogAttributeDefinition) -> dict:
    return {
        "name": definition.name,
        "value_type": definition.value_type.value,
        "options": [option.value for option in definition.options],
    }


def _component_attribute_definitions(
    component: CatalogComponent,
    scope: AttributeScope,
) -> list[CatalogAttributeDefinition]:
    return [definition for definition in component.attribute_definitions if definition.scope == scope]


def _load_instance_for_occurrence_edit(
    session: Session,
    *,
    project_id: int,
    instance_id: int,
) -> ProjectInstance | None:
    return session.scalar(
        select(ProjectInstance)
        .where(ProjectInstance.id == instance_id, ProjectInstance.project_id == project_id)
        .options(
            selectinload(ProjectInstance.component)
            .selectinload(CatalogComponent.attribute_definitions)
            .selectinload(CatalogAttributeDefinition.options),
            selectinload(ProjectInstance.outgoing_occurrences)
            .selectinload(ProjectInstanceOccurrence.targets)
            .selectinload(ProjectInstanceOccurrenceTarget.target_instance),
            selectinload(ProjectInstance.outgoing_occurrences)
            .selectinload(ProjectInstanceOccurrence.attribute_values),
        )
    )


def _replace_occurrence_target(
    session: Session,
    *,
    project: Project,
    source_instance: ProjectInstance,
    occurrence: ProjectInstanceOccurrence,
    target_instance_id: int | None,
) -> None:
    occurrence.targets.clear()
    if target_instance_id is None:
        return

    if target_instance_id == source_instance.id:
        raise ValueError("An occurrence cannot target its own source instance.")

    target_instance = session.scalar(
        select(ProjectInstance).where(ProjectInstance.id == target_instance_id, ProjectInstance.project_id == project.id)
    )
    if target_instance is None:
        raise ValueError("Target instance was not found in this project.")

    occurrence.targets.append(
        ProjectInstanceOccurrenceTarget(
            target_instance=target_instance,
            role_label=None,
            sort_order=1,
        )
    )


def _replace_occurrence_attribute_values(
    instance: ProjectInstance,
    occurrence: ProjectInstanceOccurrence,
    attribute_values: dict[str, str | None],
) -> None:
    defined_names = {definition.name for definition in _component_attribute_definitions(instance.component, AttributeScope.USAGE)}
    occurrence.attribute_values.clear()
    for index, definition in enumerate(_component_attribute_definitions(instance.component, AttributeScope.USAGE), start=1):
        value = attribute_values.get(definition.name)
        normalized = value.strip() if isinstance(value, str) else value
        if not normalized:
            continue
        occurrence.attribute_values.append(
            ProjectInstanceOccurrenceAttributeValue(
                attribute_name=definition.name,
                value=normalized,
                sort_order=index,
            )
        )

    # Preserve unknown legacy values until the catalog definition is explicitly cleaned up.
    for name, value in attribute_values.items():
        if name in defined_names:
            continue
        normalized = value.strip() if isinstance(value, str) else value
        if not normalized:
            continue
        occurrence.attribute_values.append(
            ProjectInstanceOccurrenceAttributeValue(
                attribute_name=name,
                value=normalized,
                sort_order=len(occurrence.attribute_values) + 1,
            )
            )


def _instance_snapshot(instance: ProjectInstance) -> dict:
    return {
        "name": instance.name,
        "short_name": instance.short_name,
        "description": instance.description,
        "short_description": instance.short_description,
        "installation": instance.installation,
        "unit_amount": instance.unit_amount,
        "attributes": _collect_attribute_values(instance),
    }


def _occurrence_snapshot(occurrence: ProjectInstanceOccurrence) -> dict:
    return {
        "relationship_type": occurrence.relationship_type,
        "context_label": occurrence.context_label,
        "targets": [target.target_instance.name for target in occurrence.targets if target.target_instance is not None],
        "attributes": {
            attribute.attribute_name: attribute.value
            for attribute in sorted(occurrence.attribute_values, key=lambda item: item.sort_order)
        },
    }


def _bom_entry_snapshot(entries: list[ProjectBomEntry]) -> list[dict]:
    return [
        {
            "subtype_id": entry.subtype_id,
            "subtype_name": entry.subtype.name if entry.subtype else None,
            "quantity": entry.quantity,
            "assembly_quantity": entry.assembly_quantity,
        }
        for entry in sorted(entries, key=lambda item: (item.subtype_id is None, item.subtype_id or -1))
    ]


def _normalized_bom_snapshot(entries: list[dict], project: Project) -> list[dict]:
    subtype_names = {subtype["id"]: subtype["name"] for subtype in _visible_project_subtype_rows(project)}
    return [
        {
            "subtype_id": entry["subtype_id"],
            "subtype_name": subtype_names.get(entry["subtype_id"]),
            "quantity": entry["quantity"],
            "assembly_quantity": entry["assembly_quantity"],
        }
        for entry in sorted(entries, key=lambda item: (item["subtype_id"] is None, item["subtype_id"] or -1))
    ]


INSTANCE_FIELD_LABELS = {
    "name": "Name",
    "short_name": "Short name",
    "description": "Description",
    "short_description": "Short description",
    "installation": "Installation",
    "unit_amount": "Unit amount",
}

OCCURRENCE_FIELD_LABELS = {
    "relationship_type": "Relationship",
    "context_label": "Usage label",
    "targets": "Targets",
}

MATERIAL_MODE_LABELS = {
    MaterialMode.GENERAL.value: "General",
    MaterialMode.PER_SUBTYPE.value: "Per subtype",
}


def _instance_creation_changes(instance: ProjectInstance) -> list[dict]:
    snapshot = _instance_snapshot(instance)
    changes = [
        build_activity_change(label, None, snapshot[field])
        for field, label in INSTANCE_FIELD_LABELS.items()
        if snapshot.get(field) is not None
    ]
    changes.extend(build_activity_change(name, None, value) for name, value in sorted(snapshot["attributes"].items()) if value is not None)
    return changes


def _describe_instance_changes(before: dict, after: dict) -> list[dict]:
    changes = [
        build_activity_change(label, before.get(field), after.get(field))
        for field, label in INSTANCE_FIELD_LABELS.items()
        if before.get(field) != after.get(field)
    ]
    before_attributes = before.get("attributes", {})
    after_attributes = after.get("attributes", {})
    for name in sorted(set(before_attributes) | set(after_attributes)):
        if before_attributes.get(name) != after_attributes.get(name):
            changes.append(build_activity_change(name, before_attributes.get(name), after_attributes.get(name)))
    return changes


def _describe_instance_deletion(snapshot: dict) -> list[dict]:
    changes = [
        build_activity_change(label, snapshot.get(field), None)
        for field, label in INSTANCE_FIELD_LABELS.items()
        if snapshot.get(field) is not None
    ]
    changes.extend(build_activity_change(name, value, None) for name, value in sorted(snapshot.get("attributes", {}).items()) if value is not None)
    return changes


def _describe_occurrence_creation(occurrence: ProjectInstanceOccurrence) -> list[dict]:
    snapshot = _occurrence_snapshot(occurrence)
    return _describe_occurrence_changes({}, snapshot)


def _describe_occurrence_changes(before: dict, after: dict) -> list[dict]:
    changes = [
        build_activity_change(label, before.get(field), after.get(field))
        for field, label in OCCURRENCE_FIELD_LABELS.items()
        if before.get(field) != after.get(field)
    ]
    before_attributes = before.get("attributes", {})
    after_attributes = after.get("attributes", {})
    for name in sorted(set(before_attributes) | set(after_attributes)):
        if before_attributes.get(name) != after_attributes.get(name):
            changes.append(build_activity_change(name, before_attributes.get(name), after_attributes.get(name)))
    return changes


def _occurrence_notes(occurrence: ProjectInstanceOccurrence) -> list[str]:
    notes = []
    if occurrence.targets:
        notes.append(f"Linked to: {', '.join(target.target_instance.name for target in occurrence.targets if target.target_instance is not None)}")
    return notes


def _occurrence_notes_from_snapshot(snapshot: dict) -> list[str]:
    targets = snapshot.get("targets") or []
    if targets:
        return [f"Removed link to: {', '.join(str(target) for target in targets)}"]
    return []


def _describe_material_quantity_changes(before: list[dict], after: list[dict]) -> list[dict]:
    def key_for(row: dict) -> int | None:
        return row.get("subtype_id")

    before_map = {key_for(row): row for row in before}
    after_map = {key_for(row): row for row in after}
    changes: list[dict] = []
    for subtype_id in sorted(set(before_map) | set(after_map), key=lambda value: (value is None, value or -1)):
        previous_row = before_map.get(subtype_id, {})
        next_row = after_map.get(subtype_id, {})
        label_prefix = next_row.get("subtype_name") or previous_row.get("subtype_name") or "General"
        if previous_row.get("quantity") != next_row.get("quantity"):
            changes.append(build_activity_change(f"{label_prefix} quantity", previous_row.get("quantity"), next_row.get("quantity")))
        if previous_row.get("assembly_quantity") != next_row.get("assembly_quantity"):
            changes.append(
                build_activity_change(
                    f"{label_prefix} assembly quantity",
                    previous_row.get("assembly_quantity"),
                    next_row.get("assembly_quantity"),
                )
            )
    return changes


def _describe_sync_preview_changes(changes: list[dict]) -> list[dict]:
    described: list[dict] = []
    for change in changes:
        field = change.get("field")
        current = change.get("current")
        catalog = change.get("catalog")
        if field == "attributes":
            described.append(build_activity_change("Attributes", current, catalog))
            continue
        described.append(build_activity_change(INSTANCE_FIELD_LABELS.get(field, str(field).replace("_", " ").title()), current, catalog))
    return described


def _material_mode_label(value: str | None) -> str | None:
    if value is None:
        return None
    return MATERIAL_MODE_LABELS.get(value, value.replace("_", " ").title())


def _flatten_subtypes(subtypes: list[ProjectSubtype], depth: int = 0) -> list[dict]:
    rows: list[dict] = []
    for subtype in subtypes:
        rows.append(
            {
                "id": subtype.id,
                "name": subtype.name,
                "depth": depth,
            }
        )
        rows.extend(_flatten_subtypes(subtype.children, depth + 1))
    return rows


def _visible_project_subtype_rows(project: Project) -> list[dict]:
    subtype_nodes = [subtype for subtype in project.subtypes if subtype.parent_id is None]
    rows: list[dict] = []
    for subtype in subtype_nodes:
        rows.extend(_flatten_visible_project_subtypes(subtype))
    return rows


def _flatten_visible_project_subtypes(subtype: ProjectSubtype, depth: int = 0) -> list[dict]:
    rows = [
        {
            "id": subtype.id,
            "name": subtype.name,
            "depth": depth,
            "model": subtype,
        }
    ]
    for child in subtype.children:
        rows.extend(_flatten_visible_project_subtypes(child, depth + 1))
    return rows


def _collect_attribute_values(instance: ProjectInstance) -> dict[str, str | None]:
    attribute_values: dict[str, str | None] = {}
    for group in instance.attribute_groups:
        for value in group.attribute_values:
            attribute_values[value.attribute_name] = value.value
    return attribute_values


def _material_mode_for_entries(entries: list[ProjectBomEntry]) -> str:
    return MaterialMode.PER_SUBTYPE.value if any(entry.subtype_id is not None for entry in entries) else MaterialMode.GENERAL.value


def _serialize_material_bom_entries(
    rule: ComponentMaterialRule,
    entries: list[ProjectBomEntry],
    flat_subtypes: list[dict],
) -> list[dict]:
    if _material_mode_for_entries(entries) == MaterialMode.PER_SUBTYPE.value:
        entries_by_subtype = {entry.subtype_id: entry for entry in entries if entry.subtype_id is not None}
        rows: list[dict] = []
        for subtype in flat_subtypes:
            entry = entries_by_subtype.get(subtype["id"])
            if entry is None:
                rows.append(
                    _serialize_empty_bom_entry(
                        subtype_id=subtype["id"],
                        subtype_name=subtype["name"],
                        subtype_depth=subtype["depth"],
                        unit=rule.unit or rule.material.unit,
                    )
                )
                continue
            row = _serialize_bom_entry(entry)
            row["subtype_depth"] = subtype["depth"]
            rows.append(row)
        return rows

    general_entry = next((entry for entry in entries if entry.subtype_id is None), None)
    if general_entry is not None:
        return [_serialize_bom_entry(general_entry)]
    return [
        _serialize_empty_bom_entry(
            subtype_id=None,
            subtype_name="General",
            subtype_depth=0,
            unit=rule.unit or rule.material.unit,
        )
    ]


def _serialize_empty_bom_entry(
    *,
    subtype_id: int | None,
    subtype_name: str,
    subtype_depth: int,
    unit: str | None,
) -> dict:
    return {
        "subtype_id": subtype_id,
        "subtype": subtype_name,
        "subtype_depth": subtype_depth,
        "quantity": None,
        "quantity_state": "blank",
        "assembly_quantity": None,
        "assembly_quantity_state": "blank",
        "unit": unit,
        "calculation_mode": "manual",
        "calculation_formula": None,
        "calculation_explanation": None,
        "is_persisted": False,
    }


def _sync_base_attribute_group(instance: ProjectInstance) -> None:
    base_group = next((group for group in instance.attribute_groups if not group.application_label), None)
    if base_group is None:
        base_group = ProjectInstanceAttributeGroup(
            name="Base Attributes",
            application_label=None,
            sort_order=1,
        )
        instance.attribute_groups.append(base_group)

    base_group.name = "Base Attributes"
    base_group.sort_order = 1

    existing_values = {value.attribute_name: value for value in base_group.attribute_values}
    target_names = []
    for index, definition in enumerate(_component_attribute_definitions(instance.component, AttributeScope.BASE), start=1):
        target_names.append(definition.name)
        current = existing_values.get(definition.name)
        if current is None:
            current = ProjectInstanceAttributeValue(
                attribute_name=definition.name,
                value=None,
                sort_order=index,
            )
            base_group.attribute_values.append(current)
        current.attribute_name = definition.name
        current.sort_order = index

    for value in list(base_group.attribute_values):
        if value.attribute_name not in target_names:
            base_group.attribute_values.remove(value)


def _apply_base_attribute_values(instance: ProjectInstance, attribute_values: dict[str, str | None]) -> None:
    base_group = next((group for group in instance.attribute_groups if not group.application_label), None)
    if base_group is None:
        return

    normalized = {name: (value.strip() if isinstance(value, str) else value) for name, value in attribute_values.items()}
    for value in base_group.attribute_values:
        if value.attribute_name in normalized:
            value.value = normalized[value.attribute_name] or None


def _is_instance_outdated(instance: ProjectInstance) -> bool:
    return bool(instance.sync_state and instance.sync_state.source_component_updated_at != instance.component.updated_at)


def _effective_sync_status(instance: ProjectInstance) -> SyncStatus:
    base_status = instance.sync_state.sync_status if instance.sync_state else SyncStatus.UP_TO_DATE
    if _is_instance_outdated(instance) and base_status == SyncStatus.UP_TO_DATE:
        return SyncStatus.OUT_OF_SYNC
    return base_status


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
        "subtype_id": entry.subtype_id,
        "subtype": entry.subtype.name if entry.subtype else "General",
        "subtype_depth": 0,
        "quantity": entry.quantity,
        "quantity_state": quantity_state,
        "assembly_quantity": entry.assembly_quantity,
        "assembly_quantity_state": assembly_state,
        "unit": entry.unit or entry.material.unit,
        "calculation_mode": entry.calculation_mode.value,
        "calculation_formula": entry.calculation_formula,
        "calculation_explanation": _build_formula_explanation(entry),
        "is_persisted": True,
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
