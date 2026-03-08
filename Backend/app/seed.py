from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from app.database import Base
from app.models import (
    ApprovalStatus,
    AttributeValueType,
    AuxiliaryMaterial,
    CatalogAttributeDefinition,
    CatalogAttributeOption,
    CatalogCategory,
    CatalogCategoryLink,
    CatalogComponent,
    CommentMention,
    CommentNotification,
    ComponentMaterialRule,
    ComponentType,
    ErpMaterialCache,
    ExportKind,
    ExportStatus,
    InstanceExportSetting,
    Material,
    MaterialMode,
    MaterialRuleCondition,
    MaterialRuleGroup,
    MembershipRole,
    NotificationType,
    Project,
    ProjectActivityLog,
    ProjectApproval,
    ProjectAuxiliaryMaterialSelection,
    ProjectBomEntry,
    ProjectComment,
    ProjectExportJob,
    ProjectInstance,
    ProjectInstanceAttributeGroup,
    ProjectInstanceAttributeValue,
    ProjectInstanceLink,
    ProjectInstanceMedia,
    ProjectInstanceSyncState,
    ProjectMaterialMode,
    ProjectMembership,
    ProjectStatus,
    ProjectSubtype,
    Role,
    SyncStatus,
    User,
    UserRole,
)
from app.models.entities import BomCalculationMode, CategoryScope, utcnow


def init_database(engine, session_factory, seed_demo_data: bool = True) -> None:
    Base.metadata.create_all(bind=engine)
    if not seed_demo_data:
        return

    seed_demo_data_if_empty(session_factory)


def seed_demo_data_if_empty(session_factory: sessionmaker[Session]) -> None:
    with session_factory() as session:
        existing = session.scalar(select(CatalogCategory.id).limit(1))
        if existing is None:
            seed_demo_dataset(session)
        else:
            backfill_demo_supporting_records(session)
        session.commit()


def seed_demo_dataset(session: Session) -> None:
    admin_role = Role(code="admin", name="Admin", description="Full access including ERP/admin tooling.")
    editor_role = Role(code="editor", name="Editor", description="Can edit catalog and projects.")
    viewer_role = Role(code="viewer", name="Viewer", description="Read-only project and output access.")
    session.add_all([admin_role, editor_role, viewer_role])
    session.flush()

    admin_user = User(username="admin", display_name="Admin User", email="admin@specsheets.local")
    editor_user = User(username="editor", display_name="Project Editor", email="editor@specsheets.local")
    viewer_user = User(username="viewer", display_name="Project Viewer", email="viewer@specsheets.local")
    session.add_all([admin_user, editor_user, viewer_user])
    session.flush()

    session.add_all(
        [
            UserRole(user=admin_user, role=admin_role),
            UserRole(user=editor_user, role=editor_role),
            UserRole(user=viewer_user, role=viewer_role),
        ]
    )

    openings = CatalogCategory(name="Openings", description="Envelope and access categories", scope=CategoryScope.MIXED, sort_order=1)
    doors = CatalogCategory(name="Doors", description="Primary and service doors", scope=CategoryScope.ITEM, sort_order=1, parent=openings)
    windows = CatalogCategory(name="Windows", description="Sliding and fixed windows", scope=CategoryScope.ITEM, sort_order=2, parent=openings)
    lock_hardware = CatalogCategory(name="Lock Hardware", description="Accessory families attached to door instances", scope=CategoryScope.ACCESSORY, sort_order=3, parent=openings)
    trim = CatalogCategory(name="Trim", description="Accessory finishing lines", scope=CategoryScope.ACCESSORY, sort_order=4, parent=openings)
    kitchens = CatalogCategory(name="Kitchens", description="Reusable cabinet and countertop templates", scope=CategoryScope.ITEM, sort_order=2)

    session.add_all([openings, doors, windows, lock_hardware, trim, kitchens])
    session.flush()

    session.add_all(
        [
            CatalogCategoryLink(category=doors, linked_category=lock_hardware),
            CatalogCategoryLink(category=windows, linked_category=trim),
        ]
    )

    door = CatalogComponent(
        category=doors,
        component_type=ComponentType.ITEM,
        name="Entry Door",
        short_name="Door Type A",
        description="Thermal entry door with configurable finish and lock preparation.",
        short_description="Thermal entry door.",
        installation="Install on prepared frame, verify plumb before fixing anchor screws.",
        unit_type="unit",
    )
    window = CatalogComponent(
        category=windows,
        component_type=ComponentType.ITEM,
        name="Sliding Window",
        short_name="Win Slide",
        description="Aluminum sliding window with optional trim kit.",
        short_description="Sliding aluminum window.",
        installation="Shim the sill, plumb the frame, then seal the perimeter.",
        unit_type="unit",
    )
    smart_lock = CatalogComponent(
        category=lock_hardware,
        component_type=ComponentType.ACCESSORY,
        name="Smart Lock",
        short_name="Lock Smart",
        description="Linked accessory applied per door leaf with finish-specific options.",
        short_description="Connected smart lock.",
        installation="Mount after door alignment; pair and test with client app before handover.",
        unit_type="unit",
    )
    trim_kit = CatalogComponent(
        category=trim,
        component_type=ComponentType.ACCESSORY,
        name="Interior Trim Kit",
        short_name="Trim Kit",
        description="Applied finishing profile for exposed frames.",
        short_description="Frame trim kit.",
        installation="Cut to size and fix after final glazing adjustment.",
        unit_type="set",
    )
    cabinet = CatalogComponent(
        category=kitchens,
        component_type=ComponentType.ITEM,
        name="Base Cabinet 900",
        short_name="Cab 900",
        description="Base kitchen cabinet with adjustable shelf and melamine finish.",
        short_description="Base cabinet, 900 mm.",
        installation="Level on site, anchor to wall, then install countertop support hardware.",
        unit_type="unit",
    )
    session.add_all([door, window, smart_lock, trim_kit, cabinet])
    session.flush()

    add_attribute(session, door, "Width", AttributeValueType.NUMBER, 1)
    add_attribute(session, door, "Finish", AttributeValueType.SELECT, 2, ["Walnut", "White Oak", "Graphite"])
    add_attribute(session, door, "Lock Type", AttributeValueType.SELECT, 3, ["Mechanical", "Smart", "Biometric"])
    add_attribute(session, window, "Width", AttributeValueType.NUMBER, 1)
    add_attribute(session, window, "Glazing", AttributeValueType.SELECT, 2, ["Standard", "Laminated"])
    add_attribute(session, smart_lock, "Finish", AttributeValueType.SELECT, 1, ["Black", "Silver"])
    add_attribute(session, smart_lock, "Handing", AttributeValueType.SELECT, 2, ["Left", "Right"])
    add_attribute(session, trim_kit, "Color", AttributeValueType.SELECT, 1, ["White", "Charcoal"])
    add_attribute(session, cabinet, "Countertop", AttributeValueType.SELECT, 1, ["Laminate", "Quartz"])

    anchor_screw = Material(sku="MAT-001", name="Anchor Screw 5x70", unit="ea")
    smart_lock_kit = Material(sku="MAT-002", name="Smart Lock Kit", unit="ea")
    laminated_glass = Material(sku="MAT-003", name="Laminated Glass Panel", unit="m2")
    frame_trim = Material(sku="MAT-004", name="Interior Trim Profile", unit="m")
    cabinet_board = Material(sku="MAT-005", name="Melamine Cabinet Board", unit="sheet")
    silicone = Material(sku="MAT-006", name="Neutral Cure Silicone", unit="cartridge")
    session.add_all([anchor_screw, smart_lock_kit, laminated_glass, frame_trim, cabinet_board, silicone])
    session.flush()

    always_rule = ComponentMaterialRule(component=door, material=anchor_screw, display_order=1, unit="ea", unit_qty_per_unit=8, notes="Always used on every installed door.")
    smart_rule = ComponentMaterialRule(component=door, material=smart_lock_kit, display_order=2, unit="ea", unit_qty_per_unit=1, notes="Only applies to smart-ready door configurations.")
    window_glass_rule = ComponentMaterialRule(component=window, material=laminated_glass, display_order=1, unit="m2", unit_qty_per_unit=1.8, notes="Only for laminated glazing selections.")
    window_silicone_rule = ComponentMaterialRule(component=window, material=silicone, display_order=2, unit="cartridge", unit_qty_per_unit=0.25, notes="Sealant remains visible even if quantity is blank.")
    trim_rule = ComponentMaterialRule(component=trim_kit, material=frame_trim, display_order=1, unit="m", unit_qty_per_unit=5.5, notes="Accessory material pulled through linked trim applications.")
    cabinet_rule = ComponentMaterialRule(component=cabinet, material=cabinet_board, display_order=1, unit="sheet", unit_qty_per_unit=1.2, notes="Manual override allowed for custom cabinet layouts.")
    session.add_all([always_rule, smart_rule, window_glass_rule, window_silicone_rule, trim_rule, cabinet_rule])
    session.flush()

    add_condition_group(session, smart_rule, "smart-only", [("Lock Type", "IN", "Smart,Biometric", None)])
    add_condition_group(session, window_glass_rule, "laminated", [("Glazing", "=", "Laminated", None)])

    aux_transport = AuxiliaryMaterial(code="AUX-001", name="On-site lift and maneuvering", category="Logistics", price=185000)
    aux_protection = AuxiliaryMaterial(code="AUX-002", name="Temporary floor protection", category="Protection", price=32000)
    session.add_all([aux_transport, aux_protection])
    session.flush()

    project_template = Project(
        name="Casa Nogal Template",
        status=ProjectStatus.TEMPLATE,
        description="Reference project template for detached single-family housing packages.",
    )
    execution_project = Project(
        name="Casa Robles - Block A",
        status=ProjectStatus.EXECUTION,
        description="Execution project with subtype-specific BOM breakdown for the current block.",
    )
    finished_project = Project(
        name="Casa Alerce - Delivered",
        status=ProjectStatus.FINISHED,
        description="Closed project kept for export and historical reference.",
    )
    session.add_all([project_template, execution_project, finished_project])
    session.flush()

    session.add_all(
        [
            ProjectMembership(project=execution_project, user=admin_user, role=MembershipRole.ADMIN),
            ProjectMembership(project=execution_project, user=editor_user, role=MembershipRole.EDITOR),
            ProjectMembership(project=execution_project, user=viewer_user, role=MembershipRole.VIEWER),
            ProjectMembership(project=project_template, user=editor_user, role=MembershipRole.EDITOR),
            ProjectMembership(project=finished_project, user=viewer_user, role=MembershipRole.VIEWER),
        ]
    )

    subtype_standard = ProjectSubtype(project=execution_project, name="Standard")
    subtype_premium = ProjectSubtype(project=execution_project, name="Premium", parent=subtype_standard)
    session.add_all([subtype_standard, subtype_premium])
    session.flush()

    session.add_all(
        [
            ProjectMaterialMode(project=project_template, mode=MaterialMode.GENERAL, changed_by=admin_user),
            ProjectMaterialMode(project=execution_project, mode=MaterialMode.PER_SUBTYPE, changed_by=editor_user),
            ProjectMaterialMode(project=finished_project, mode=MaterialMode.GENERAL, changed_by=admin_user),
        ]
    )

    door_instance = ProjectInstance(
        project=execution_project,
        component=door,
        category=doors,
        instance_type=ComponentType.ITEM,
        name="Door A",
        short_name="EA-01",
        description=door.description,
        short_description=door.short_description,
        installation=door.installation,
        unit_amount=3,
    )
    window_instance = ProjectInstance(
        project=execution_project,
        component=window,
        category=windows,
        instance_type=ComponentType.ITEM,
        name="Living Window",
        short_name="LW-01",
        description=window.description,
        short_description=window.short_description,
        installation=window.installation,
        unit_amount=2,
    )
    lock_instance = ProjectInstance(
        project=execution_project,
        component=smart_lock,
        category=lock_hardware,
        instance_type=ComponentType.ACCESSORY,
        name="Door A Smart Lock",
        short_name="SL-A",
        description=smart_lock.description,
        short_description=smart_lock.short_description,
        installation=smart_lock.installation,
        unit_amount=1,
    )
    trim_instance = ProjectInstance(
        project=execution_project,
        component=trim_kit,
        category=trim,
        instance_type=ComponentType.ACCESSORY,
        name="Window Trim Kit",
        short_name="TK-01",
        description=trim_kit.description,
        short_description=trim_kit.short_description,
        installation=trim_kit.installation,
        unit_amount=1,
    )
    cabinet_instance = ProjectInstance(
        project=execution_project,
        component=cabinet,
        category=kitchens,
        instance_type=ComponentType.ITEM,
        name="Kitchen Cabinet Run",
        short_name="KC-01",
        description=cabinet.description,
        short_description=cabinet.short_description,
        installation=cabinet.installation,
        unit_amount=4,
    )
    session.add_all([door_instance, window_instance, lock_instance, trim_instance, cabinet_instance])
    session.flush()

    add_instance_group(session, door_instance, "Base Attributes", [("Width", "900"), ("Finish", "Walnut"), ("Lock Type", "Smart")])
    add_instance_group(session, window_instance, "Base Attributes", [("Width", "1800"), ("Glazing", "Laminated")])
    add_instance_group(session, lock_instance, "Door A Application", [("Finish", "Black"), ("Handing", "Left")], application_label="Attached to Door A")
    add_instance_group(session, trim_instance, "Window Application", [("Color", "White")], application_label="Attached to Living Window")
    add_instance_group(session, cabinet_instance, "Base Attributes", [("Countertop", "Quartz")])

    session.add_all(
        [
            ProjectInstanceSyncState(
                instance=door_instance,
                sync_status=SyncStatus.UP_TO_DATE,
                last_synced_at=utcnow(),
                source_component_updated_at=door.updated_at,
            ),
            ProjectInstanceSyncState(
                instance=window_instance,
                sync_status=SyncStatus.CUSTOMIZED,
                last_synced_at=utcnow(),
                source_component_updated_at=window.updated_at,
                sync_notes="Project-specific glazing notes were customized after snapshot creation.",
            ),
            ProjectInstanceSyncState(
                instance=lock_instance,
                sync_status=SyncStatus.UP_TO_DATE,
                last_synced_at=utcnow(),
                source_component_updated_at=smart_lock.updated_at,
            ),
            ProjectInstanceSyncState(
                instance=trim_instance,
                sync_status=SyncStatus.OUT_OF_SYNC,
                last_synced_at=utcnow(),
                source_component_updated_at=None,
                sync_notes="Catalog trim instructions changed after this accessory was attached.",
            ),
            ProjectInstanceSyncState(
                instance=cabinet_instance,
                sync_status=SyncStatus.CUSTOMIZED,
                last_synced_at=utcnow(),
                source_component_updated_at=cabinet.updated_at,
            ),
        ]
    )

    session.add_all(
        [
            ProjectInstanceMedia(instance=door_instance, kind="image", uri="/static/demo/door-a.png", caption="Door elevation", sort_order=1),
            ProjectInstanceMedia(instance=window_instance, kind="image", uri="/static/demo/window-living.png", caption="Living room window", sort_order=1),
        ]
    )

    session.add_all(
        [
            ProjectInstanceLink(parent_instance=door_instance, child_instance=lock_instance, application_label="Main leaf", sort_order=1),
            ProjectInstanceLink(parent_instance=window_instance, child_instance=trim_instance, application_label="Interior perimeter", sort_order=1),
        ]
    )
    session.flush()

    session.add_all(
        [
            ProjectBomEntry(
                project=execution_project,
                instance=door_instance,
                material=anchor_screw,
                quantity=24,
                assembly_quantity=24,
                unit="ea",
                calculation_mode=BomCalculationMode.AUTO,
                calculation_formula="3 x 8",
            ),
            ProjectBomEntry(
                project=execution_project,
                instance=door_instance,
                material=smart_lock_kit,
                quantity=3,
                assembly_quantity=3,
                unit="ea",
                calculation_mode=BomCalculationMode.AUTO,
                calculation_formula="3 x 1",
            ),
            ProjectBomEntry(
                project=execution_project,
                instance=window_instance,
                material=laminated_glass,
                subtype=subtype_standard,
                quantity=3.2,
                assembly_quantity=0,
                unit="m2",
                calculation_mode=BomCalculationMode.MANUAL,
                calculation_formula=None,
            ),
            ProjectBomEntry(
                project=execution_project,
                instance=window_instance,
                material=laminated_glass,
                subtype=subtype_premium,
                quantity=4.1,
                assembly_quantity=0,
                unit="m2",
                calculation_mode=BomCalculationMode.MANUAL,
                calculation_formula=None,
            ),
            ProjectBomEntry(
                project=execution_project,
                instance=window_instance,
                material=silicone,
                quantity=None,
                assembly_quantity=None,
                unit="cartridge",
                calculation_mode=BomCalculationMode.AUTO,
                calculation_formula="2 x 0.25",
            ),
            ProjectBomEntry(
                project=execution_project,
                instance=trim_instance,
                material=frame_trim,
                quantity=0,
                assembly_quantity=0,
                unit="m",
                calculation_mode=BomCalculationMode.MANUAL,
                calculation_formula=None,
            ),
            ProjectBomEntry(
                project=execution_project,
                instance=cabinet_instance,
                material=cabinet_board,
                quantity=5.25,
                assembly_quantity=0,
                unit="sheet",
                calculation_mode=BomCalculationMode.MANUAL,
                calculation_formula=None,
            ),
        ]
    )

    session.add_all(
        [
            ProjectAuxiliaryMaterialSelection(project=execution_project, auxiliary_material=aux_transport, subtype=subtype_standard),
            ProjectAuxiliaryMaterialSelection(project=execution_project, auxiliary_material=aux_protection, subtype=None),
        ]
    )

    session.add_all(
        [
            InstanceExportSetting(
                project=execution_project,
                instance=door_instance,
                target="commercial_pdf",
                settings={"include_attributes": ["Finish"], "accessory_mode": "summary"},
            ),
            InstanceExportSetting(
                project=execution_project,
                instance=window_instance,
                target="full_technical_pdf",
                settings={"include_materials": True, "linked_accessories": "expanded"},
            ),
        ]
    )

    root_comment = ProjectComment(
        project=execution_project,
        instance=window_instance,
        author=editor_user,
        body="Please confirm if the laminated glazing remains client-facing in the commercial export.",
    )
    session.add(root_comment)
    session.flush()

    reply_comment = ProjectComment(
        project=execution_project,
        instance=window_instance,
        parent_comment=root_comment,
        author=admin_user,
        body="Keep it in the full technical export only. @viewer can validate the client-facing wording.",
    )
    session.add(reply_comment)
    session.flush()

    mention = CommentMention(comment=reply_comment, user=viewer_user)
    notification = CommentNotification(
        user=viewer_user,
        comment=reply_comment,
        notification_type=NotificationType.COMMENT_MENTION,
        route=f"/projects/{execution_project.id}#comment-{reply_comment.id}",
    )
    session.add_all([mention, notification])

    session.add_all(
        [
            ProjectActivityLog(
                project=execution_project,
                actor=editor_user,
                entity_type="ProjectInstance",
                entity_id=window_instance.id,
                action="created",
                details={"name": window_instance.name, "category": "Windows"},
            ),
            ProjectActivityLog(
                project=execution_project,
                actor=editor_user,
                entity_type="BomEntry",
                entity_id=3,
                action="quantity_changed",
                details={"material": "MAT-003", "quantity": 3.2, "subtype": "Standard"},
            ),
            ProjectActivityLog(
                project=execution_project,
                actor=admin_user,
                entity_type="ProjectComment",
                entity_id=reply_comment.id,
                action="commented",
                details={"instance": window_instance.name},
            ),
        ]
    )

    session.add(
        ProjectApproval(
            project=execution_project,
            requested_by=editor_user,
            decided_by=admin_user,
            status=ApprovalStatus.APPROVED,
            summary="Approve project BOM for procurement export package.",
            decided_at=utcnow(),
        )
    )

    session.add_all(
        [
            ProjectExportJob(
                project=execution_project,
                export_kind=ExportKind.FULL_TECHNICAL_PDF,
                status=ExportStatus.COMPLETED,
                requested_by=editor_user,
                payload={"include_materials": True, "include_accessories": True},
                artifact_uri="/exports/casa-robles-full-tech.pdf",
                completed_at=utcnow(),
            ),
            ProjectExportJob(
                project=execution_project,
                export_kind=ExportKind.MATERIALS_WORKBOOK,
                status=ExportStatus.PENDING,
                requested_by=admin_user,
                payload={"group_by": "category"},
            ),
        ]
    )

    session.add_all(
        [
            ErpMaterialCache(
                material=anchor_screw,
                sku=anchor_screw.sku,
                stock_on_hand=320,
                pending_purchase_quantity=150,
                average_price=45,
                last_purchase_price=48,
                average_lead_time_days=7,
                recent_monthly_consumption=210,
            ),
            ErpMaterialCache(
                material=laminated_glass,
                sku=laminated_glass.sku,
                stock_on_hand=14.5,
                pending_purchase_quantity=20,
                average_price=81250,
                last_purchase_price=83000,
                average_lead_time_days=18,
                recent_monthly_consumption=10,
            ),
            ErpMaterialCache(
                material=silicone,
                sku=silicone.sku,
                stock_on_hand=12,
                pending_purchase_quantity=60,
                average_price=3900,
                last_purchase_price=4100,
                average_lead_time_days=5,
                recent_monthly_consumption=18,
            ),
        ]
    )


def backfill_demo_supporting_records(session: Session) -> None:
    admin_role = ensure_role(session, "admin", "Admin", "Full access including ERP/admin tooling.")
    editor_role = ensure_role(session, "editor", "Editor", "Can edit catalog and projects.")
    viewer_role = ensure_role(session, "viewer", "Viewer", "Read-only project and output access.")

    admin_user = ensure_user(session, "admin", "Admin User", "admin@specsheets.local")
    editor_user = ensure_user(session, "editor", "Project Editor", "editor@specsheets.local")
    viewer_user = ensure_user(session, "viewer", "Project Viewer", "viewer@specsheets.local")

    ensure_user_role(session, admin_user, admin_role)
    ensure_user_role(session, editor_user, editor_role)
    ensure_user_role(session, viewer_user, viewer_role)

    projects = {project.name: project for project in session.scalars(select(Project)).all()}
    instances = {instance.name: instance for instance in session.scalars(select(ProjectInstance)).all()}
    materials = {material.sku: material for material in session.scalars(select(Material)).all()}

    for project in projects.values():
        if project.material_mode is None:
            mode = MaterialMode.PER_SUBTYPE if project.name == "Casa Robles - Block A" else MaterialMode.GENERAL
            session.add(ProjectMaterialMode(project=project, mode=mode, changed_by=admin_user))

    ensure_membership(session, projects.get("Casa Robles - Block A"), admin_user, MembershipRole.ADMIN)
    ensure_membership(session, projects.get("Casa Robles - Block A"), editor_user, MembershipRole.EDITOR)
    ensure_membership(session, projects.get("Casa Robles - Block A"), viewer_user, MembershipRole.VIEWER)
    ensure_membership(session, projects.get("Casa Nogal Template"), editor_user, MembershipRole.EDITOR)
    ensure_membership(session, projects.get("Casa Alerce - Delivered"), viewer_user, MembershipRole.VIEWER)

    for instance_name, status, notes in [
        ("Door A", SyncStatus.UP_TO_DATE, None),
        ("Living Window", SyncStatus.CUSTOMIZED, "Project-specific glazing notes were customized after snapshot creation."),
        ("Door A Smart Lock", SyncStatus.UP_TO_DATE, None),
        ("Window Trim Kit", SyncStatus.OUT_OF_SYNC, "Catalog trim instructions changed after this accessory was attached."),
        ("Kitchen Cabinet Run", SyncStatus.CUSTOMIZED, None),
    ]:
        instance = instances.get(instance_name)
        if instance is None or instance.sync_state is not None:
            continue
        session.add(
            ProjectInstanceSyncState(
                instance=instance,
                sync_status=status,
                last_synced_at=utcnow(),
                source_component_updated_at=None if status == SyncStatus.OUT_OF_SYNC else instance.component.updated_at,
                sync_notes=notes,
            )
        )

    ensure_media(session, instances.get("Door A"), "/static/demo/door-a.png", "Door elevation")
    ensure_media(session, instances.get("Living Window"), "/static/demo/window-living.png", "Living room window")

    project = projects.get("Casa Robles - Block A")
    window_instance = instances.get("Living Window")
    door_instance = instances.get("Door A")
    if project is not None and window_instance is not None and not session.scalar(select(ProjectComment.id).limit(1)):
        root_comment = ProjectComment(
            project=project,
            instance=window_instance,
            author=editor_user,
            body="Please confirm if the laminated glazing remains client-facing in the commercial export.",
        )
        session.add(root_comment)
        session.flush()
        reply_comment = ProjectComment(
            project=project,
            instance=window_instance,
            parent_comment=root_comment,
            author=admin_user,
            body="Keep it in the full technical export only. @viewer can validate the client-facing wording.",
        )
        session.add(reply_comment)
        session.flush()
        session.add(CommentMention(comment=reply_comment, user=viewer_user))
        session.add(
            CommentNotification(
                user=viewer_user,
                comment=reply_comment,
                notification_type=NotificationType.COMMENT_MENTION,
                route=f"/projects/{project.id}#comment-{reply_comment.id}",
            )
        )

    if project is not None and not session.scalar(select(ProjectActivityLog.id).limit(1)):
        if window_instance is not None:
            session.add(
                ProjectActivityLog(
                    project=project,
                    actor=editor_user,
                    entity_type="ProjectInstance",
                    entity_id=window_instance.id,
                    action="created",
                    details={"name": window_instance.name, "category": "Windows"},
                )
            )
        if door_instance is not None:
            session.add(
                ProjectActivityLog(
                    project=project,
                    actor=admin_user,
                    entity_type="ProjectInstance",
                    entity_id=door_instance.id,
                    action="reviewed",
                    details={"name": door_instance.name},
                )
            )

    if project is not None and not session.scalar(select(ProjectApproval.id).limit(1)):
        session.add(
            ProjectApproval(
                project=project,
                requested_by=editor_user,
                decided_by=admin_user,
                status=ApprovalStatus.APPROVED,
                summary="Approve project BOM for procurement export package.",
                decided_at=utcnow(),
            )
        )

    if project is not None and not session.scalar(select(ProjectExportJob.id).limit(1)):
        session.add_all(
            [
                ProjectExportJob(
                    project=project,
                    export_kind=ExportKind.FULL_TECHNICAL_PDF,
                    status=ExportStatus.COMPLETED,
                    requested_by=editor_user,
                    payload={"include_materials": True, "include_accessories": True},
                    artifact_uri="/exports/casa-robles-full-tech.pdf",
                    completed_at=utcnow(),
                ),
                ProjectExportJob(
                    project=project,
                    export_kind=ExportKind.MATERIALS_WORKBOOK,
                    status=ExportStatus.PENDING,
                    requested_by=admin_user,
                    payload={"group_by": "category"},
                ),
            ]
        )

    if project is not None and door_instance is not None and not session.scalar(select(InstanceExportSetting.id).limit(1)):
        session.add(
            InstanceExportSetting(
                project=project,
                instance=door_instance,
                target="commercial_pdf",
                settings={"include_attributes": ["Finish"], "accessory_mode": "summary"},
            )
        )

    if not session.scalar(select(ErpMaterialCache.id).limit(1)):
        for sku, stock, pending, avg_price, last_price, lead_time, monthly in [
            ("MAT-001", 320, 150, 45, 48, 7, 210),
            ("MAT-003", 14.5, 20, 81250, 83000, 18, 10),
            ("MAT-006", 12, 60, 3900, 4100, 5, 18),
        ]:
            material = materials.get(sku)
            if material is None:
                continue
            session.add(
                ErpMaterialCache(
                    material=material,
                    sku=material.sku,
                    stock_on_hand=stock,
                    pending_purchase_quantity=pending,
                    average_price=avg_price,
                    last_purchase_price=last_price,
                    average_lead_time_days=lead_time,
                    recent_monthly_consumption=monthly,
                )
            )


def ensure_role(session: Session, code: str, name: str, description: str) -> Role:
    role = session.scalar(select(Role).where(Role.code == code))
    if role is None:
        role = Role(code=code, name=name, description=description)
        session.add(role)
        session.flush()
    return role


def ensure_user(session: Session, username: str, display_name: str, email: str) -> User:
    user = session.scalar(select(User).where(User.username == username))
    if user is None:
        user = User(username=username, display_name=display_name, email=email)
        session.add(user)
        session.flush()
    return user


def ensure_user_role(session: Session, user: User, role: Role) -> None:
    existing = session.scalar(
        select(UserRole.id).where(UserRole.user_id == user.id, UserRole.role_id == role.id)
    )
    if existing is None:
        session.add(UserRole(user=user, role=role))


def ensure_membership(session: Session, project: Project | None, user: User, role: MembershipRole) -> None:
    if project is None:
        return
    existing = session.scalar(
        select(ProjectMembership.id).where(ProjectMembership.project_id == project.id, ProjectMembership.user_id == user.id)
    )
    if existing is None:
        session.add(ProjectMembership(project=project, user=user, role=role))


def ensure_media(session: Session, instance: ProjectInstance | None, uri: str, caption: str) -> None:
    if instance is None:
        return
    existing = session.scalar(
        select(ProjectInstanceMedia.id).where(ProjectInstanceMedia.instance_id == instance.id, ProjectInstanceMedia.uri == uri)
    )
    if existing is None:
        session.add(ProjectInstanceMedia(instance=instance, kind="image", uri=uri, caption=caption, sort_order=1))


def add_attribute(
    session: Session,
    component: CatalogComponent,
    name: str,
    value_type: AttributeValueType,
    sort_order: int,
    options: list[str] | None = None,
) -> CatalogAttributeDefinition:
    definition = CatalogAttributeDefinition(
        component=component,
        name=name,
        value_type=value_type,
        sort_order=sort_order,
    )
    session.add(definition)
    session.flush()
    for index, option in enumerate(options or [], start=1):
        session.add(CatalogAttributeOption(attribute_definition=definition, value=option, sort_order=index))
    return definition


def add_condition_group(
    session: Session,
    rule: ComponentMaterialRule,
    group_key: str,
    conditions: list[tuple[str, str, str | None, str | None]],
) -> None:
    group = MaterialRuleGroup(rule=rule, group_key=group_key)
    session.add(group)
    session.flush()
    for attribute_name, operator, comparison_value, comparison_value_secondary in conditions:
        session.add(
            MaterialRuleCondition(
                group=group,
                attribute_name=attribute_name,
                operator=operator,
                comparison_value=comparison_value,
                comparison_value_secondary=comparison_value_secondary,
            )
        )


def add_instance_group(
    session: Session,
    instance: ProjectInstance,
    name: str,
    attributes: list[tuple[str, str]],
    application_label: str | None = None,
) -> None:
    group = ProjectInstanceAttributeGroup(instance=instance, name=name, application_label=application_label, sort_order=1)
    session.add(group)
    session.flush()
    for index, (attribute_name, value) in enumerate(attributes, start=1):
        session.add(
            ProjectInstanceAttributeValue(
                group=group,
                attribute_name=attribute_name,
                value=value,
                sort_order=index,
            )
        )
