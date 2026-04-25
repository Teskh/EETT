from __future__ import annotations

from datetime import date, datetime, timezone
from enum import Enum

from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    DateTime,
    Enum as SqlEnum,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, foreign, mapped_column, relationship

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


class AttributeScope(str, Enum):
    BASE = "base"
    USAGE = "usage"


class BomCalculationMode(str, Enum):
    MANUAL = "manual"
    AUTO = "auto"


class MembershipRole(str, Enum):
    ADMIN = "admin"
    EDITOR = "editor"
    VIEWER = "viewer"


class SyncStatus(str, Enum):
    UP_TO_DATE = "up_to_date"
    OUT_OF_SYNC = "out_of_sync"
    CUSTOMIZED = "customized"


class MaterialMode(str, Enum):
    GENERAL = "general"
    PER_SUBTYPE = "per_subtype"


class NotificationType(str, Enum):
    COMMENT_MENTION = "comment_mention"
    COMMENT_REPLY = "comment_reply"
    APPROVAL_REQUEST = "approval_request"


class ApprovalStatus(str, Enum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"


class ExportKind(str, Enum):
    COMMERCIAL_PDF = "commercial_pdf"
    FULL_TECHNICAL_PDF = "full_technical_pdf"
    TOTAL_MATERIALS_PDF = "total_materials_pdf"
    CONTEXT_MATERIALS_PDF = "context_materials_pdf"
    DETAILED_MATERIAL_PDF = "detailed_material_pdf"
    ASSEMBLY_KIT_PDF = "assembly_kit_pdf"
    MATERIALS_WORKBOOK = "materials_workbook"
    COST_MODEL_WORKBOOK = "cost_model_workbook"


class ExportStatus(str, Enum):
    PENDING = "pending"
    COMPLETED = "completed"
    FAILED = "failed"


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(80), nullable=False, unique=True)
    display_name: Mapped[str] = mapped_column(String(120), nullable=False)
    email: Mapped[str] = mapped_column(String(160), nullable=False, unique=True)
    password_hash: Mapped[str | None] = mapped_column(String(255), default=None)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    roles: Mapped[list["UserRole"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    project_memberships: Mapped[list["ProjectMembership"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    comments: Mapped[list["ProjectComment"]] = relationship(back_populates="author")
    notifications: Mapped[list["CommentNotification"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    activity_groups: Mapped[list["ProjectActivityGroup"]] = relationship(back_populates="actor")
    activity_logs: Mapped[list["ProjectActivityLog"]] = relationship(back_populates="actor")
    requested_approvals: Mapped[list["ProjectApproval"]] = relationship(
        foreign_keys="ProjectApproval.requested_by_user_id",
        back_populates="requested_by",
    )
    decided_approvals: Mapped[list["ProjectApproval"]] = relationship(
        foreign_keys="ProjectApproval.decided_by_user_id",
        back_populates="decided_by",
    )
    requested_exports: Mapped[list["ProjectExportJob"]] = relationship(back_populates="requested_by")
    changed_material_modes: Mapped[list["ProjectMaterialMode"]] = relationship(back_populates="changed_by")


class Role(Base):
    __tablename__ = "roles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(40), nullable=False, unique=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, default=None)

    users: Mapped[list["UserRole"]] = relationship(back_populates="role", cascade="all, delete-orphan")


class UserRole(Base):
    __tablename__ = "user_roles"
    __table_args__ = (UniqueConstraint("user_id", "role_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    role_id: Mapped[int] = mapped_column(ForeignKey("roles.id", ondelete="CASCADE"), nullable=False)

    user: Mapped[User] = relationship(back_populates="roles")
    role: Mapped[Role] = relationship(back_populates="users")


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
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

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
    scope: Mapped[AttributeScope] = mapped_column(
        enum_column(AttributeScope, "attribute_scope"),
        default=AttributeScope.BASE,
        nullable=False,
    )
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
    calculation_sheets: Mapped[list["ProjectMaterialCalculationSheet"]] = relationship(back_populates="material")
    erp_cache_entries: Mapped[list["ErpMaterialCache"]] = relationship(back_populates="material")


class MaterialStudyGroup(Base):
    __tablename__ = "material_study_groups"
    __table_args__ = (UniqueConstraint("name"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, default=None)
    study_unit: Mapped[str] = mapped_column(String(50), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

    members: Mapped[list["MaterialStudyGroupMember"]] = relationship(
        back_populates="group",
        cascade="all, delete-orphan",
        order_by="MaterialStudyGroupMember.display_order",
    )


class MaterialStudyGroupMember(Base):
    __tablename__ = "material_study_group_members"
    __table_args__ = (UniqueConstraint("group_id", "sku"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    group_id: Mapped[int] = mapped_column(ForeignKey("material_study_groups.id", ondelete="CASCADE"), nullable=False)
    sku: Mapped[str] = mapped_column(String(80), nullable=False)
    material_name: Mapped[str] = mapped_column(String(160), nullable=False)
    unit: Mapped[str | None] = mapped_column(String(50), default=None)
    factor_to_study_unit: Mapped[float] = mapped_column(Float, nullable=False)
    display_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    group: Mapped[MaterialStudyGroup] = relationship(back_populates="members")


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
    bom_entries: Mapped[list["ProjectBomEntry"]] = relationship(
        back_populates="material_rule",
        primaryjoin="ComponentMaterialRule.id == foreign(ProjectBomEntry.material_rule_id)",
    )
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
    memberships: Mapped[list["ProjectMembership"]] = relationship(back_populates="project", cascade="all, delete-orphan")
    material_mode: Mapped["ProjectMaterialMode | None"] = relationship(
        back_populates="project",
        cascade="all, delete-orphan",
        uselist=False,
    )
    bom_entries: Mapped[list["ProjectBomEntry"]] = relationship(back_populates="project", cascade="all, delete-orphan")
    auxiliary_materials: Mapped[list["ProjectAuxiliaryMaterialSelection"]] = relationship(
        back_populates="project",
        cascade="all, delete-orphan",
    )
    comments: Mapped[list["ProjectComment"]] = relationship(back_populates="project", cascade="all, delete-orphan")
    activity_groups: Mapped[list["ProjectActivityGroup"]] = relationship(back_populates="project", cascade="all, delete-orphan")
    activity_logs: Mapped[list["ProjectActivityLog"]] = relationship(back_populates="project", cascade="all, delete-orphan")
    approvals: Mapped[list["ProjectApproval"]] = relationship(back_populates="project", cascade="all, delete-orphan")
    export_jobs: Mapped[list["ProjectExportJob"]] = relationship(back_populates="project", cascade="all, delete-orphan")
    export_settings: Mapped[list["InstanceExportSetting"]] = relationship(back_populates="project", cascade="all, delete-orphan")
    calculation_sheets: Mapped[list["ProjectMaterialCalculationSheet"]] = relationship(
        back_populates="project",
        cascade="all, delete-orphan",
    )
    cost_model_adjustments: Mapped[list["ProjectCostModelAdjustment"]] = relationship(
        back_populates="project",
        cascade="all, delete-orphan",
    )


class ProjectMembership(Base):
    __tablename__ = "project_memberships"
    __table_args__ = (UniqueConstraint("project_id", "user_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    role: Mapped[MembershipRole] = mapped_column(
        enum_column(MembershipRole, "membership_role"),
        default=MembershipRole.VIEWER,
        nullable=False,
    )

    project: Mapped[Project] = relationship(back_populates="memberships")
    user: Mapped[User] = relationship(back_populates="project_memberships")


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


class ProjectMaterialMode(Base):
    __tablename__ = "project_material_modes"
    __table_args__ = (UniqueConstraint("project_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    mode: Mapped[MaterialMode] = mapped_column(
        enum_column(MaterialMode, "material_mode"),
        default=MaterialMode.GENERAL,
        nullable=False,
    )
    changed_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), default=None)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

    project: Mapped[Project] = relationship(back_populates="material_mode")
    changed_by: Mapped[User | None] = relationship(back_populates="changed_material_modes")


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
    sync_state: Mapped["ProjectInstanceSyncState | None"] = relationship(
        back_populates="instance",
        cascade="all, delete-orphan",
        uselist=False,
    )
    media: Mapped[list["ProjectInstanceMedia"]] = relationship(
        back_populates="instance",
        cascade="all, delete-orphan",
        order_by="ProjectInstanceMedia.sort_order",
    )
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
    outgoing_occurrences: Mapped[list["ProjectInstanceOccurrence"]] = relationship(
        back_populates="source_instance",
        cascade="all, delete-orphan",
        foreign_keys="ProjectInstanceOccurrence.source_instance_id",
        order_by="ProjectInstanceOccurrence.sort_order",
    )
    occurrence_targets: Mapped[list["ProjectInstanceOccurrenceTarget"]] = relationship(
        back_populates="target_instance",
        cascade="all, delete-orphan",
        foreign_keys="ProjectInstanceOccurrenceTarget.target_instance_id",
    )
    bom_entries: Mapped[list["ProjectBomEntry"]] = relationship(back_populates="instance", cascade="all, delete-orphan")
    calculation_sheets: Mapped[list["ProjectMaterialCalculationSheet"]] = relationship(
        back_populates="instance",
        cascade="all, delete-orphan",
    )
    comments: Mapped[list["ProjectComment"]] = relationship(back_populates="instance")
    export_settings: Mapped[list["InstanceExportSetting"]] = relationship(back_populates="instance", cascade="all, delete-orphan")


class ProjectInstanceSyncState(Base):
    __tablename__ = "project_instance_sync_states"
    __table_args__ = (UniqueConstraint("instance_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    instance_id: Mapped[int] = mapped_column(ForeignKey("project_instances.id", ondelete="CASCADE"), nullable=False)
    sync_status: Mapped[SyncStatus] = mapped_column(
        enum_column(SyncStatus, "sync_status"),
        default=SyncStatus.UP_TO_DATE,
        nullable=False,
    )
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
    source_component_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
    sync_notes: Mapped[str | None] = mapped_column(Text, default=None)
    source_snapshot: Mapped[dict | None] = mapped_column(JSON, default=None)

    instance: Mapped[ProjectInstance] = relationship(back_populates="sync_state")


class ProjectInstanceMedia(Base):
    __tablename__ = "project_instance_media"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    instance_id: Mapped[int] = mapped_column(ForeignKey("project_instances.id", ondelete="CASCADE"), nullable=False)
    kind: Mapped[str] = mapped_column(String(40), default="image", nullable=False)
    uri: Mapped[str] = mapped_column(String(255), nullable=False)
    caption: Mapped[str | None] = mapped_column(String(255), default=None)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    instance: Mapped[ProjectInstance] = relationship(back_populates="media")


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
    __table_args__ = (UniqueConstraint("parent_instance_id", "child_instance_id", "relationship_type", "application_label"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    parent_instance_id: Mapped[int] = mapped_column(ForeignKey("project_instances.id", ondelete="CASCADE"), nullable=False)
    child_instance_id: Mapped[int] = mapped_column(ForeignKey("project_instances.id", ondelete="CASCADE"), nullable=False)
    relationship_type: Mapped[str] = mapped_column(String(60), default="applied_accessory", nullable=False)
    application_label: Mapped[str] = mapped_column(String(120), default="", nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    parent_instance: Mapped[ProjectInstance] = relationship(foreign_keys=[parent_instance_id], back_populates="parent_links")
    child_instance: Mapped[ProjectInstance] = relationship(foreign_keys=[child_instance_id], back_populates="child_links")


class ProjectInstanceOccurrence(Base):
    __tablename__ = "project_instance_occurrences"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    source_instance_id: Mapped[int] = mapped_column(ForeignKey("project_instances.id", ondelete="CASCADE"), nullable=False)
    relationship_type: Mapped[str] = mapped_column(String(60), default="applied_to", nullable=False)
    context_label: Mapped[str | None] = mapped_column(String(160), default=None)
    context_notes: Mapped[str | None] = mapped_column(Text, default=None)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    source_instance: Mapped[ProjectInstance] = relationship(
        foreign_keys=[source_instance_id],
        back_populates="outgoing_occurrences",
    )
    targets: Mapped[list["ProjectInstanceOccurrenceTarget"]] = relationship(
        back_populates="occurrence",
        cascade="all, delete-orphan",
        order_by="ProjectInstanceOccurrenceTarget.sort_order",
    )
    attribute_values: Mapped[list["ProjectInstanceOccurrenceAttributeValue"]] = relationship(
        back_populates="occurrence",
        cascade="all, delete-orphan",
        order_by="ProjectInstanceOccurrenceAttributeValue.sort_order",
    )


class ProjectInstanceOccurrenceTarget(Base):
    __tablename__ = "project_instance_occurrence_targets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    occurrence_id: Mapped[int] = mapped_column(ForeignKey("project_instance_occurrences.id", ondelete="CASCADE"), nullable=False)
    target_instance_id: Mapped[int] = mapped_column(ForeignKey("project_instances.id", ondelete="CASCADE"), nullable=False)
    role_label: Mapped[str | None] = mapped_column(String(120), default=None)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    occurrence: Mapped[ProjectInstanceOccurrence] = relationship(back_populates="targets")
    target_instance: Mapped[ProjectInstance] = relationship(
        foreign_keys=[target_instance_id],
        back_populates="occurrence_targets",
    )


class ProjectInstanceOccurrenceAttributeValue(Base):
    __tablename__ = "project_instance_occurrence_attribute_values"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    occurrence_id: Mapped[int] = mapped_column(ForeignKey("project_instance_occurrences.id", ondelete="CASCADE"), nullable=False)
    attribute_name: Mapped[str] = mapped_column(String(100), nullable=False)
    value: Mapped[str | None] = mapped_column(String(160), default=None)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    occurrence: Mapped[ProjectInstanceOccurrence] = relationship(back_populates="attribute_values")


class ProjectBomEntry(Base):
    __tablename__ = "project_bom_entries"
    __table_args__ = (
        Index(
            "uq_project_bom_entries_general",
            "project_id",
            "instance_id",
            "material_rule_id",
            unique=True,
            postgresql_where=text("subtype_id IS NULL"),
        ),
        Index(
            "uq_project_bom_entries_subtype",
            "project_id",
            "instance_id",
            "material_rule_id",
            "subtype_id",
            unique=True,
            postgresql_where=text("subtype_id IS NOT NULL"),
        ),
        Index(
            "uq_project_bom_entries_manual_general",
            "project_id",
            "instance_id",
            "material_id",
            unique=True,
            postgresql_where=text("subtype_id IS NULL AND material_rule_id IS NULL"),
        ),
        Index(
            "uq_project_bom_entries_manual_subtype",
            "project_id",
            "instance_id",
            "material_id",
            "subtype_id",
            unique=True,
            postgresql_where=text("subtype_id IS NOT NULL AND material_rule_id IS NULL"),
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    instance_id: Mapped[int] = mapped_column(ForeignKey("project_instances.id", ondelete="CASCADE"), nullable=False)
    material_rule_id: Mapped[int | None] = mapped_column(Integer, default=None)
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
    material_rule: Mapped[ComponentMaterialRule | None] = relationship(
        back_populates="bom_entries",
        primaryjoin="foreign(ProjectBomEntry.material_rule_id) == ComponentMaterialRule.id",
    )
    material: Mapped[Material] = relationship(back_populates="bom_entries")
    subtype: Mapped[ProjectSubtype | None] = relationship(back_populates="bom_entries")


class ProjectMaterialCalculationSheet(Base):
    __tablename__ = "project_material_calculation_sheets"
    __table_args__ = (UniqueConstraint("project_id", "instance_id", "material_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    instance_id: Mapped[int] = mapped_column(ForeignKey("project_instances.id", ondelete="CASCADE"), nullable=False)
    material_id: Mapped[int] = mapped_column(ForeignKey("materials.id", ondelete="CASCADE"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

    project: Mapped[Project] = relationship(back_populates="calculation_sheets")
    instance: Mapped[ProjectInstance] = relationship(back_populates="calculation_sheets")
    material: Mapped[Material] = relationship(back_populates="calculation_sheets")
    cells: Mapped[list["ProjectMaterialCalculationCell"]] = relationship(
        back_populates="sheet",
        cascade="all, delete-orphan",
        order_by="ProjectMaterialCalculationCell.row_index, ProjectMaterialCalculationCell.column_index",
    )


class ProjectMaterialCalculationCell(Base):
    __tablename__ = "project_material_calculation_cells"
    __table_args__ = (UniqueConstraint("sheet_id", "row_index", "column_index"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    sheet_id: Mapped[int] = mapped_column(
        ForeignKey("project_material_calculation_sheets.id", ondelete="CASCADE"),
        nullable=False,
    )
    row_index: Mapped[int] = mapped_column(Integer, nullable=False)
    column_index: Mapped[int] = mapped_column(Integer, nullable=False)
    raw_input: Mapped[str] = mapped_column(Text, nullable=False)

    sheet: Mapped[ProjectMaterialCalculationSheet] = relationship(back_populates="cells")


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


class ProjectCostModelAdjustment(Base):
    __tablename__ = "project_cost_model_adjustments"
    __table_args__ = (
        Index(
            "uq_project_cost_model_adjustments_general",
            "project_id",
            "material_id",
            unique=True,
            postgresql_where=text("subtype_id IS NULL"),
        ),
        Index(
            "uq_project_cost_model_adjustments_subtype",
            "project_id",
            "material_id",
            "subtype_id",
            unique=True,
            postgresql_where=text("subtype_id IS NOT NULL"),
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    material_id: Mapped[int] = mapped_column(ForeignKey("materials.id", ondelete="CASCADE"), nullable=False)
    subtype_id: Mapped[int | None] = mapped_column(
        ForeignKey("project_subtypes.id", ondelete="CASCADE"), default=None
    )
    adjusted_quantity: Mapped[float] = mapped_column(Float, nullable=False)
    source_kind: Mapped[str] = mapped_column(String(40), default="manual", nullable=False)
    source_note: Mapped[str | None] = mapped_column(Text, default=None)
    source_house_type_id: Mapped[int | None] = mapped_column(Integer, default=None)
    source_range_start: Mapped[date | None] = mapped_column(Date, default=None)
    source_range_end: Mapped[date | None] = mapped_column(Date, default=None)
    source_sample_houses: Mapped[int | None] = mapped_column(Integer, default=None)
    source_total_consumption: Mapped[float | None] = mapped_column(Float, default=None)
    created_by_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), default=None
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False
    )

    project: Mapped[Project] = relationship(back_populates="cost_model_adjustments")
    material: Mapped[Material] = relationship()
    subtype: Mapped[ProjectSubtype | None] = relationship()
    created_by: Mapped[User | None] = relationship()


class ProjectComment(Base):
    __tablename__ = "project_comments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    instance_id: Mapped[int | None] = mapped_column(ForeignKey("project_instances.id", ondelete="CASCADE"), default=None)
    parent_comment_id: Mapped[int | None] = mapped_column(ForeignKey("project_comments.id", ondelete="CASCADE"), default=None)
    author_user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)

    project: Mapped[Project] = relationship(back_populates="comments")
    instance: Mapped[ProjectInstance | None] = relationship(back_populates="comments")
    author: Mapped[User] = relationship(back_populates="comments")
    parent_comment: Mapped["ProjectComment | None"] = relationship(remote_side="ProjectComment.id", back_populates="replies")
    replies: Mapped[list["ProjectComment"]] = relationship(back_populates="parent_comment", cascade="all, delete-orphan")
    mentions: Mapped[list["CommentMention"]] = relationship(back_populates="comment", cascade="all, delete-orphan")
    notifications: Mapped[list["CommentNotification"]] = relationship(back_populates="comment", cascade="all, delete-orphan")


class CommentMention(Base):
    __tablename__ = "comment_mentions"
    __table_args__ = (UniqueConstraint("comment_id", "mentioned_user_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    comment_id: Mapped[int] = mapped_column(ForeignKey("project_comments.id", ondelete="CASCADE"), nullable=False)
    mentioned_user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)

    comment: Mapped[ProjectComment] = relationship(back_populates="mentions")
    user: Mapped[User] = relationship()


class CommentNotification(Base):
    __tablename__ = "comment_notifications"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    comment_id: Mapped[int] = mapped_column(ForeignKey("project_comments.id", ondelete="CASCADE"), nullable=False)
    notification_type: Mapped[NotificationType] = mapped_column(
        enum_column(NotificationType, "notification_type"),
        nullable=False,
    )
    route: Mapped[str] = mapped_column(String(255), nullable=False)
    is_read: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    user: Mapped[User] = relationship(back_populates="notifications")
    comment: Mapped[ProjectComment] = relationship(back_populates="notifications")


class ProjectActivityGroup(Base):
    __tablename__ = "project_activity_groups"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    actor_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), default=None)
    mutation_batch_id: Mapped[str | None] = mapped_column(String(80), default=None)
    title: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    scope_type: Mapped[str | None] = mapped_column(String(80), default=None)
    scope_id: Mapped[int | None] = mapped_column(Integer, default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

    project: Mapped[Project] = relationship(back_populates="activity_groups")
    actor: Mapped[User | None] = relationship(back_populates="activity_groups")
    events: Mapped[list["ProjectActivityLog"]] = relationship(
        back_populates="group",
        cascade="all, delete-orphan",
        order_by="ProjectActivityLog.created_at",
    )
    approvals: Mapped[list["ProjectApproval"]] = relationship(back_populates="activity_group")


class ProjectActivityLog(Base):
    __tablename__ = "project_activity_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    group_id: Mapped[int | None] = mapped_column(ForeignKey("project_activity_groups.id", ondelete="SET NULL"), default=None)
    actor_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), default=None)
    entity_type: Mapped[str] = mapped_column(String(60), nullable=False)
    entity_id: Mapped[int | None] = mapped_column(Integer, default=None)
    action: Mapped[str] = mapped_column(String(60), nullable=False)
    details: Mapped[dict | None] = mapped_column(JSON, default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    project: Mapped[Project] = relationship(back_populates="activity_logs")
    group: Mapped[ProjectActivityGroup | None] = relationship(back_populates="events")
    actor: Mapped[User | None] = relationship(back_populates="activity_logs")


class ProjectApproval(Base):
    __tablename__ = "project_approvals"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    activity_group_id: Mapped[int | None] = mapped_column(ForeignKey("project_activity_groups.id", ondelete="SET NULL"), default=None)
    requested_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    decided_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), default=None)
    status: Mapped[ApprovalStatus] = mapped_column(
        enum_column(ApprovalStatus, "approval_status"),
        default=ApprovalStatus.PENDING,
        nullable=False,
    )
    summary: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)

    project: Mapped[Project] = relationship(back_populates="approvals")
    activity_group: Mapped[ProjectActivityGroup | None] = relationship(back_populates="approvals")
    requested_by: Mapped[User] = relationship(
        foreign_keys=[requested_by_user_id],
        back_populates="requested_approvals",
    )
    decided_by: Mapped[User | None] = relationship(
        foreign_keys=[decided_by_user_id],
        back_populates="decided_approvals",
    )


class InstanceExportSetting(Base):
    __tablename__ = "instance_export_settings"
    __table_args__ = (UniqueConstraint("project_id", "instance_id", "target"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    instance_id: Mapped[int] = mapped_column(ForeignKey("project_instances.id", ondelete="CASCADE"), nullable=False)
    target: Mapped[str] = mapped_column(String(80), nullable=False)
    settings: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

    project: Mapped[Project] = relationship(back_populates="export_settings")
    instance: Mapped[ProjectInstance] = relationship(back_populates="export_settings")


class ProjectExportJob(Base):
    __tablename__ = "project_export_jobs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    export_kind: Mapped[ExportKind] = mapped_column(
        enum_column(ExportKind, "export_kind"),
        nullable=False,
    )
    status: Mapped[ExportStatus] = mapped_column(
        enum_column(ExportStatus, "export_status"),
        default=ExportStatus.PENDING,
        nullable=False,
    )
    requested_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), default=None)
    payload: Mapped[dict | None] = mapped_column(JSON, default=None)
    artifact_uri: Mapped[str | None] = mapped_column(String(255), default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)

    project: Mapped[Project] = relationship(back_populates="export_jobs")
    requested_by: Mapped[User | None] = relationship(back_populates="requested_exports")


class ErpMaterialCache(Base):
    __tablename__ = "erp_material_cache"
    __table_args__ = (UniqueConstraint("sku"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    material_id: Mapped[int | None] = mapped_column(ForeignKey("materials.id", ondelete="SET NULL"), default=None)
    sku: Mapped[str] = mapped_column(String(80), nullable=False)
    stock_on_hand: Mapped[float | None] = mapped_column(Float, default=None)
    pending_purchase_quantity: Mapped[float | None] = mapped_column(Float, default=None)
    average_price: Mapped[float | None] = mapped_column(Float, default=None)
    last_purchase_price: Mapped[float | None] = mapped_column(Float, default=None)
    average_lead_time_days: Mapped[float | None] = mapped_column(Float, default=None)
    recent_monthly_consumption: Mapped[float | None] = mapped_column(Float, default=None)
    refreshed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    material: Mapped[Material | None] = relationship(back_populates="erp_cache_entries")


class MaterialDashboardCacheEntry(Base):
    __tablename__ = "material_dashboard_cache_entries"
    __table_args__ = (
        UniqueConstraint("cache_kind", "cache_key"),
        Index("ix_material_dashboard_cache_entries_kind_expires", "cache_kind", "expires_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    cache_kind: Mapped[str] = mapped_column(String(32), nullable=False)
    cache_key: Mapped[str] = mapped_column(String(255), nullable=False)
    payload: Mapped[dict] = mapped_column(JSON, nullable=False)
    refreshed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
