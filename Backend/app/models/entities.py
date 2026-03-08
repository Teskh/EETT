from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum

from sqlalchemy import DateTime, Enum as SqlEnum, Float, ForeignKey, Index, Integer, String, Text, UniqueConstraint, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def enum_column(enum_cls: type[Enum], name: str) -> SqlEnum:
    return SqlEnum(
        enum_cls,
        name=name,
        values_callable=lambda members: [member.value for member in members],
    )


class ProjectStatus(str, Enum):
    TEMPLATE = "template"
    EXECUTION = "execution"
    FINISHED = "finished"


class ComponentType(str, Enum):
    ITEM = "item"
    ACCESSORY = "accessory"


class CategoryScope(str, Enum):
    ITEM = "item"
    ACCESSORY = "accessory"
    MIXED = "mixed"


class AttributeValueType(str, Enum):
    TEXT = "text"
    NUMBER = "number"
    SELECT = "select"


class BomCalculationMode(str, Enum):
    MANUAL = "manual"
    AUTO = "auto"


class CatalogCategory(Base):
    __tablename__ = "catalog_categories"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, default=None)
    scope: Mapped[CategoryScope] = mapped_column(
        enum_column(CategoryScope, "category_scope"),
        default=CategoryScope.ITEM,
        nullable=False,
    )
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    parent_id: Mapped[int | None] = mapped_column(ForeignKey("catalog_categories.id", ondelete="CASCADE"), default=None)

    parent: Mapped["CatalogCategory | None"] = relationship(remote_side="CatalogCategory.id", back_populates="children")
    children: Mapped[list["CatalogCategory"]] = relationship(
        back_populates="parent",
        cascade="all, delete-orphan",
        order_by="CatalogCategory.sort_order",
    )
    components: Mapped[list["CatalogComponent"]] = relationship(
        back_populates="category",
        cascade="all, delete-orphan",
        order_by="CatalogComponent.name",
    )
    outgoing_links: Mapped[list["CatalogCategoryLink"]] = relationship(
        foreign_keys="CatalogCategoryLink.category_id",
        back_populates="category",
        cascade="all, delete-orphan",
    )
    incoming_links: Mapped[list["CatalogCategoryLink"]] = relationship(
        foreign_keys="CatalogCategoryLink.linked_category_id",
        back_populates="linked_category",
        cascade="all, delete-orphan",
    )


class CatalogCategoryLink(Base):
    __tablename__ = "catalog_category_links"
    __table_args__ = (UniqueConstraint("category_id", "linked_category_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    category_id: Mapped[int] = mapped_column(ForeignKey("catalog_categories.id", ondelete="CASCADE"), nullable=False)
    linked_category_id: Mapped[int] = mapped_column(ForeignKey("catalog_categories.id", ondelete="CASCADE"), nullable=False)

    category: Mapped[CatalogCategory] = relationship(foreign_keys=[category_id], back_populates="outgoing_links")
    linked_category: Mapped[CatalogCategory] = relationship(foreign_keys=[linked_category_id], back_populates="incoming_links")


class CatalogComponent(Base):
    __tablename__ = "catalog_components"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    category_id: Mapped[int] = mapped_column(ForeignKey("catalog_categories.id", ondelete="CASCADE"), nullable=False)
    component_type: Mapped[ComponentType] = mapped_column(
        enum_column(ComponentType, "component_type"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    short_name: Mapped[str | None] = mapped_column(String(120), default=None)
    description: Mapped[str | None] = mapped_column(Text, default=None)
    short_description: Mapped[str | None] = mapped_column(Text, default=None)
    installation: Mapped[str | None] = mapped_column(Text, default=None)
    unit_type: Mapped[str | None] = mapped_column(String(50), default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    category: Mapped[CatalogCategory] = relationship(back_populates="components")
    attribute_definitions: Mapped[list["CatalogAttributeDefinition"]] = relationship(
        back_populates="component",
        cascade="all, delete-orphan",
        order_by="CatalogAttributeDefinition.sort_order",
    )
    material_rules: Mapped[list["ComponentMaterialRule"]] = relationship(
        back_populates="component",
        cascade="all, delete-orphan",
        order_by="ComponentMaterialRule.display_order",
    )
    instances: Mapped[list["ProjectInstance"]] = relationship(back_populates="component")


class CatalogAttributeDefinition(Base):
    __tablename__ = "catalog_attribute_definitions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    component_id: Mapped[int] = mapped_column(ForeignKey("catalog_components.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    value_type: Mapped[AttributeValueType] = mapped_column(
        enum_column(AttributeValueType, "attribute_value_type"),
        default=AttributeValueType.TEXT,
        nullable=False,
    )
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    component: Mapped[CatalogComponent] = relationship(back_populates="attribute_definitions")
    options: Mapped[list["CatalogAttributeOption"]] = relationship(
        back_populates="attribute_definition",
        cascade="all, delete-orphan",
        order_by="CatalogAttributeOption.sort_order",
    )


class CatalogAttributeOption(Base):
    __tablename__ = "catalog_attribute_options"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    attribute_definition_id: Mapped[int] = mapped_column(
        ForeignKey("catalog_attribute_definitions.id", ondelete="CASCADE"),
        nullable=False,
    )
    value: Mapped[str] = mapped_column(String(100), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    attribute_definition: Mapped[CatalogAttributeDefinition] = relationship(back_populates="options")


class Material(Base):
    __tablename__ = "materials"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    sku: Mapped[str] = mapped_column(String(80), nullable=False, unique=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    unit: Mapped[str | None] = mapped_column(String(50), default=None)

    component_rules: Mapped[list["ComponentMaterialRule"]] = relationship(back_populates="material")
    bom_entries: Mapped[list["ProjectBomEntry"]] = relationship(back_populates="material")


class ComponentMaterialRule(Base):
    __tablename__ = "component_material_rules"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    component_id: Mapped[int] = mapped_column(ForeignKey("catalog_components.id", ondelete="CASCADE"), nullable=False)
    material_id: Mapped[int] = mapped_column(ForeignKey("materials.id", ondelete="CASCADE"), nullable=False)
    display_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    unit: Mapped[str | None] = mapped_column(String(50), default=None)
    unit_qty_per_unit: Mapped[float | None] = mapped_column(Float, default=None)
    notes: Mapped[str | None] = mapped_column(Text, default=None)

    component: Mapped[CatalogComponent] = relationship(back_populates="material_rules")
    material: Mapped[Material] = relationship(back_populates="component_rules")
    condition_groups: Mapped[list["MaterialRuleGroup"]] = relationship(
        back_populates="rule",
        cascade="all, delete-orphan",
        order_by="MaterialRuleGroup.group_key",
    )


class MaterialRuleGroup(Base):
    __tablename__ = "material_rule_groups"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    rule_id: Mapped[int] = mapped_column(ForeignKey("component_material_rules.id", ondelete="CASCADE"), nullable=False)
    group_key: Mapped[str] = mapped_column(String(60), nullable=False)

    rule: Mapped[ComponentMaterialRule] = relationship(back_populates="condition_groups")
    conditions: Mapped[list["MaterialRuleCondition"]] = relationship(
        back_populates="group",
        cascade="all, delete-orphan",
        order_by="MaterialRuleCondition.id",
    )


class MaterialRuleCondition(Base):
    __tablename__ = "material_rule_conditions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    group_id: Mapped[int] = mapped_column(ForeignKey("material_rule_groups.id", ondelete="CASCADE"), nullable=False)
    attribute_name: Mapped[str] = mapped_column(String(100), nullable=False)
    operator: Mapped[str] = mapped_column(String(20), nullable=False)
    comparison_value: Mapped[str | None] = mapped_column(String(120), default=None)
    comparison_value_secondary: Mapped[str | None] = mapped_column(String(120), default=None)

    group: Mapped[MaterialRuleGroup] = relationship(back_populates="conditions")


class AuxiliaryMaterial(Base):
    __tablename__ = "auxiliary_materials"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(80), nullable=False, unique=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    category: Mapped[str | None] = mapped_column(String(100), default=None)
    price: Mapped[float] = mapped_column(Float, nullable=False)

    project_selections: Mapped[list["ProjectAuxiliaryMaterialSelection"]] = relationship(back_populates="auxiliary_material")


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False, unique=True)
    status: Mapped[ProjectStatus] = mapped_column(
        enum_column(ProjectStatus, "project_status"),
        default=ProjectStatus.TEMPLATE,
        nullable=False,
    )
    description: Mapped[str | None] = mapped_column(Text, default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

    subtypes: Mapped[list["ProjectSubtype"]] = relationship(
        back_populates="project",
        cascade="all, delete-orphan",
        order_by="ProjectSubtype.name",
    )
    instances: Mapped[list["ProjectInstance"]] = relationship(
        back_populates="project",
        cascade="all, delete-orphan",
        order_by="ProjectInstance.name",
    )
    bom_entries: Mapped[list["ProjectBomEntry"]] = relationship(back_populates="project", cascade="all, delete-orphan")
    auxiliary_materials: Mapped[list["ProjectAuxiliaryMaterialSelection"]] = relationship(
        back_populates="project",
        cascade="all, delete-orphan",
    )


class ProjectSubtype(Base):
    __tablename__ = "project_subtypes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    parent_id: Mapped[int | None] = mapped_column(ForeignKey("project_subtypes.id", ondelete="CASCADE"), default=None)
    name: Mapped[str] = mapped_column(String(120), nullable=False)

    project: Mapped[Project] = relationship(back_populates="subtypes")
    parent: Mapped["ProjectSubtype | None"] = relationship(remote_side="ProjectSubtype.id", back_populates="children")
    children: Mapped[list["ProjectSubtype"]] = relationship(back_populates="parent", cascade="all, delete-orphan")
    auxiliary_materials: Mapped[list["ProjectAuxiliaryMaterialSelection"]] = relationship(back_populates="subtype")
    bom_entries: Mapped[list["ProjectBomEntry"]] = relationship(back_populates="subtype")


class ProjectInstance(Base):
    __tablename__ = "project_instances"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    component_id: Mapped[int] = mapped_column(ForeignKey("catalog_components.id"), nullable=False)
    category_id: Mapped[int] = mapped_column(ForeignKey("catalog_categories.id"), nullable=False)
    instance_type: Mapped[ComponentType] = mapped_column(
        enum_column(ComponentType, "component_type"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    short_name: Mapped[str | None] = mapped_column(String(120), default=None)
    description: Mapped[str | None] = mapped_column(Text, default=None)
    short_description: Mapped[str | None] = mapped_column(Text, default=None)
    installation: Mapped[str | None] = mapped_column(Text, default=None)
    image_uri: Mapped[str | None] = mapped_column(String(255), default=None)
    unit_amount: Mapped[float | None] = mapped_column(Float, default=None)

    project: Mapped[Project] = relationship(back_populates="instances")
    component: Mapped[CatalogComponent] = relationship(back_populates="instances")
    category: Mapped[CatalogCategory] = relationship()
    attribute_groups: Mapped[list["ProjectInstanceAttributeGroup"]] = relationship(
        back_populates="instance",
        cascade="all, delete-orphan",
        order_by="ProjectInstanceAttributeGroup.sort_order",
    )
    parent_links: Mapped[list["ProjectInstanceLink"]] = relationship(
        foreign_keys="ProjectInstanceLink.parent_instance_id",
        back_populates="parent_instance",
        cascade="all, delete-orphan",
    )
    child_links: Mapped[list["ProjectInstanceLink"]] = relationship(
        foreign_keys="ProjectInstanceLink.child_instance_id",
        back_populates="child_instance",
        cascade="all, delete-orphan",
    )
    bom_entries: Mapped[list["ProjectBomEntry"]] = relationship(back_populates="instance", cascade="all, delete-orphan")


class ProjectInstanceAttributeGroup(Base):
    __tablename__ = "project_instance_attribute_groups"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    instance_id: Mapped[int] = mapped_column(ForeignKey("project_instances.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    application_label: Mapped[str | None] = mapped_column(String(120), default=None)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    instance: Mapped[ProjectInstance] = relationship(back_populates="attribute_groups")
    attribute_values: Mapped[list["ProjectInstanceAttributeValue"]] = relationship(
        back_populates="group",
        cascade="all, delete-orphan",
        order_by="ProjectInstanceAttributeValue.sort_order",
    )


class ProjectInstanceAttributeValue(Base):
    __tablename__ = "project_instance_attribute_values"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    group_id: Mapped[int] = mapped_column(ForeignKey("project_instance_attribute_groups.id", ondelete="CASCADE"), nullable=False)
    attribute_name: Mapped[str] = mapped_column(String(100), nullable=False)
    value: Mapped[str | None] = mapped_column(String(120), default=None)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    group: Mapped[ProjectInstanceAttributeGroup] = relationship(back_populates="attribute_values")


class ProjectInstanceLink(Base):
    __tablename__ = "project_instance_links"
    __table_args__ = (UniqueConstraint("parent_instance_id", "child_instance_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    parent_instance_id: Mapped[int] = mapped_column(ForeignKey("project_instances.id", ondelete="CASCADE"), nullable=False)
    child_instance_id: Mapped[int] = mapped_column(ForeignKey("project_instances.id", ondelete="CASCADE"), nullable=False)
    relationship_type: Mapped[str] = mapped_column(String(60), default="applied_accessory", nullable=False)

    parent_instance: Mapped[ProjectInstance] = relationship(foreign_keys=[parent_instance_id], back_populates="parent_links")
    child_instance: Mapped[ProjectInstance] = relationship(foreign_keys=[child_instance_id], back_populates="child_links")


class ProjectBomEntry(Base):
    __tablename__ = "project_bom_entries"
    __table_args__ = (
        Index(
            "uq_project_bom_entries_general",
            "project_id",
            "instance_id",
            "material_id",
            unique=True,
            postgresql_where=text("subtype_id IS NULL"),
        ),
        Index(
            "uq_project_bom_entries_subtype",
            "project_id",
            "instance_id",
            "material_id",
            "subtype_id",
            unique=True,
            postgresql_where=text("subtype_id IS NOT NULL"),
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    instance_id: Mapped[int] = mapped_column(ForeignKey("project_instances.id", ondelete="CASCADE"), nullable=False)
    material_id: Mapped[int] = mapped_column(ForeignKey("materials.id"), nullable=False)
    subtype_id: Mapped[int | None] = mapped_column(ForeignKey("project_subtypes.id", ondelete="CASCADE"), default=None)
    quantity: Mapped[float | None] = mapped_column(Float, default=None)
    assembly_quantity: Mapped[float | None] = mapped_column(Float, default=None)
    unit: Mapped[str | None] = mapped_column(String(50), default=None)
    calculation_mode: Mapped[BomCalculationMode] = mapped_column(
        enum_column(BomCalculationMode, "bom_calculation_mode"),
        default=BomCalculationMode.MANUAL,
        nullable=False,
    )
    calculation_formula: Mapped[str | None] = mapped_column(String(160), default=None)

    project: Mapped[Project] = relationship(back_populates="bom_entries")
    instance: Mapped[ProjectInstance] = relationship(back_populates="bom_entries")
    material: Mapped[Material] = relationship(back_populates="bom_entries")
    subtype: Mapped[ProjectSubtype | None] = relationship(back_populates="bom_entries")


class ProjectAuxiliaryMaterialSelection(Base):
    __tablename__ = "project_auxiliary_material_selections"
    __table_args__ = (UniqueConstraint("project_id", "auxiliary_material_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    auxiliary_material_id: Mapped[int] = mapped_column(ForeignKey("auxiliary_materials.id"), nullable=False)
    subtype_id: Mapped[int | None] = mapped_column(ForeignKey("project_subtypes.id", ondelete="SET NULL"), default=None)

    project: Mapped[Project] = relationship(back_populates="auxiliary_materials")
    auxiliary_material: Mapped[AuxiliaryMaterial] = relationship(back_populates="project_selections")
    subtype: Mapped[ProjectSubtype | None] = relationship(back_populates="auxiliary_materials")
