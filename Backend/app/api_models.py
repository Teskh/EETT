from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class PermissionSet(BaseModel):
    catalog_edit: bool
    erp_admin: bool
    project_edit: bool
    project_view: bool
    project_change_status: bool
    project_delete: bool


class SessionUserResponse(BaseModel):
    username: str
    display_name: str
    roles: list[str]
    permissions: PermissionSet


class ProjectSummaryModel(BaseModel):
    id: int
    name: str
    status: str
    status_label: str
    description: str | None
    updated_at: str
    instance_count: int
    material_mode: str


class ProjectsBoardResponse(BaseModel):
    grouped_projects: dict[str, list[ProjectSummaryModel]]
    status_labels: dict[str, str]


class SyncStateModel(BaseModel):
    status: str
    last_synced_at: str | None
    source_component_updated_at: str | None
    notes: str | None


class MediaModel(BaseModel):
    kind: str
    uri: str
    caption: str | None


class ExportSettingModel(BaseModel):
    target: str
    settings: dict[str, Any]


class MaterialClauseModel(BaseModel):
    attribute_name: str
    operator: str
    comparison_value: str | None
    comparison_value_secondary: str | None
    matched: bool


class MaterialGroupEvaluationModel(BaseModel):
    group: str
    matched: bool
    clauses: list[MaterialClauseModel]


class MaterialApplicabilityModel(BaseModel):
    applies: bool
    matched_groups: list[str]
    groups: list[MaterialGroupEvaluationModel]


class BomEntryModel(BaseModel):
    subtype: str
    quantity: float | None
    quantity_state: str
    assembly_quantity: float | None
    assembly_quantity_state: str
    unit: str | None
    calculation_mode: str
    calculation_formula: str | None
    calculation_explanation: str | None


class MaterialModel(BaseModel):
    material_name: str
    sku: str
    unit_qty_per_unit: float | None
    unit: str | None
    notes: str | None
    applicability: MaterialApplicabilityModel
    bom_entries: list[BomEntryModel]


class AttributeValueModel(BaseModel):
    name: str
    value: str | None


class AttributeGroupModel(BaseModel):
    name: str
    application_label: str | None
    values: list[AttributeValueModel]


class InstanceLinkModel(BaseModel):
    name: str
    application_label: str | None
    relationship_type: str


class ProjectInstanceModel(BaseModel):
    id: int
    name: str
    short_name: str | None
    type: str
    description: str | None
    installation: str | None
    unit_amount: float | None
    attributes: list[AttributeGroupModel]
    linked_accessories: list[InstanceLinkModel]
    linked_to: list[InstanceLinkModel]
    materials: list[MaterialModel]
    sync_state: SyncStateModel
    media: list[MediaModel]
    export_settings: list[ExportSettingModel]
    material_mode: str


class CategorySectionModel(BaseModel):
    id: int
    name: str
    scope: str
    depth: int
    linked_categories: list[str]
    instances: list[ProjectInstanceModel]


class ProjectSubtypeModel(BaseModel):
    id: int
    name: str
    children: list["ProjectSubtypeModel"] = Field(default_factory=list)


class AuxiliaryMaterialSelectionModel(BaseModel):
    code: str
    name: str
    category: str | None
    price: float
    subtype: str


class ProjectDetailModel(BaseModel):
    id: int
    name: str
    status: str
    status_label: str
    description: str | None
    instance_count: int
    material_mode: str


class ProjectDetailResponse(BaseModel):
    project: ProjectDetailModel
    subtypes: list[ProjectSubtypeModel]
    categories: list[CategorySectionModel]
    auxiliary_materials: list[AuxiliaryMaterialSelectionModel]


class SyncFieldChangeModel(BaseModel):
    field: str
    current: str | None
    catalog: str | None


class SyncPreviewResponse(BaseModel):
    instance_id: int
    instance_name: str
    component_id: int
    component_name: str
    sync_status: str
    is_outdated: bool
    changes: list[SyncFieldChangeModel]


class MaterialModeResponse(BaseModel):
    project_id: int
    mode: str
    updated_at: str
    changed_by: str | None


class CommentModel(BaseModel):
    id: int
    body: str
    author: str
    instance: str | None
    created_at: str
    mentions: list[str]
    replies: list["CommentModel"] = Field(default_factory=list)


class ActivityLogModel(BaseModel):
    id: int
    entity_type: str
    entity_id: int | None
    action: str
    details: dict[str, Any]
    created_at: str
    actor: str | None


class ApprovalModel(BaseModel):
    id: int
    status: str
    summary: str
    requested_by: str
    decided_by: str | None
    created_at: str
    decided_at: str | None


class ExportJobModel(BaseModel):
    id: int
    kind: str
    status: str
    requested_by: str | None
    artifact_uri: str | None
    payload: dict[str, Any]
    created_at: str
    completed_at: str | None


class DashboardRowModel(BaseModel):
    sku: str
    material_name: str
    unit: str | None
    project_quantity: float
    blank_quantity_count: int
    instance_contexts: list[dict[str, Any]]
    stock_on_hand: float | None
    pending_purchase_quantity: float | None
    average_price: float | None
    average_lead_time_days: float | None
    recent_monthly_consumption: float | None
    shortage: float


class DashboardProjectModel(BaseModel):
    id: int
    name: str


class DashboardResponse(BaseModel):
    project: DashboardProjectModel
    rows: list[DashboardRowModel]


class NotificationModel(BaseModel):
    id: int
    type: str
    route: str
    is_read: bool
    comment_id: int
    created_at: str


class PublicProjectModel(BaseModel):
    id: int
    name: str
    status: str
    description: str | None


class PublicProjectListResponse(BaseModel):
    projects: list[PublicProjectModel]


class PublicProjectSkuResponse(BaseModel):
    project: dict[str, Any]
    skus: list[str]


class CatalogResponse(BaseModel):
    model_config = ConfigDict(extra="allow")


ProjectSubtypeModel.model_rebuild()
CommentModel.model_rebuild()
