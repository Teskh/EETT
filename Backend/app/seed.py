from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from app.database import Base
from app.models import (
    AttributeValueType,
    AuxiliaryMaterial,
    CatalogAttributeDefinition,
    CatalogAttributeOption,
    CatalogCategory,
    CatalogCategoryLink,
    CatalogComponent,
    ComponentMaterialRule,
    Material,
    MaterialRuleCondition,
    MaterialRuleGroup,
    Project,
    ProjectAuxiliaryMaterialSelection,
    ProjectBomEntry,
    ProjectInstance,
    ProjectInstanceAttributeGroup,
    ProjectInstanceAttributeValue,
    ProjectInstanceLink,
    ProjectStatus,
    ProjectSubtype,
)
from app.models.entities import BomCalculationMode, CategoryScope, ComponentType


def init_database(engine, session_factory, seed_demo_data: bool = True) -> None:
    Base.metadata.create_all(bind=engine)
    if not seed_demo_data:
        return

    seed_demo_data_if_empty(session_factory)


def seed_demo_data_if_empty(session_factory: sessionmaker[Session]) -> None:
    with session_factory() as session:
        existing = session.scalar(select(CatalogCategory.id).limit(1))
        if existing is not None:
            return
        seed_demo_dataset(session)
        session.commit()


def seed_demo_dataset(session: Session) -> None:
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

    subtype_standard = ProjectSubtype(project=execution_project, name="Standard")
    subtype_premium = ProjectSubtype(project=execution_project, name="Premium", parent=subtype_standard)
    session.add_all([subtype_standard, subtype_premium])
    session.flush()

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
            ProjectInstanceLink(parent_instance=door_instance, child_instance=lock_instance),
            ProjectInstanceLink(parent_instance=window_instance, child_instance=trim_instance),
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
