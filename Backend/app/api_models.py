from __future__ import annotations

from datetime import date
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class PermissionSet(BaseModel):
    catalog_edit: bool
    material_dashboard: bool
    erp_admin: bool
    project_create: bool
    project_edit: bool
    project_view: bool
    project_change_status: bool
    project_delete: bool
    cost_model_export: bool
    user_admin: bool


class SessionUserResponse(BaseModel):
    username: str
    display_name: str
    roles: list[str]
    permissions: PermissionSet


class LoginRequest(BaseModel):
    username: str
    password: str


class RoleOptionModel(BaseModel):
    code: str
    name: str
    description: str
    assignable: bool


class ManagedUserModel(BaseModel):
    id: int
    username: str
    display_name: str
    email: str
    is_active: bool
    roles: list[str]
    created_at: str


class UserDirectoryResponse(BaseModel):
    users: list[ManagedUserModel]
    roles: list[RoleOptionModel]


class UserCreateRequest(BaseModel):
    username: str
    display_name: str
    email: str
    password: str
    role_codes: list[str] = Field(default_factory=list)
    is_active: bool = True


class UserUpdateRequest(BaseModel):
    display_name: str
    email: str
    password: str | None = None
    role_codes: list[str] = Field(default_factory=list)
    is_active: bool = True


class MutationResultModel(BaseModel):
    ok: bool = True
    category_id: int | None = None
    component_id: int | None = None
    project_id: int | None = None
    instance_id: int | None = None
    occurrence_id: int | None = None
    subtype_id: int | None = None
    deleted_id: int | None = None
    linked_category_ids: list[int] = Field(default_factory=list)


class CatalogCategoryCreateRequest(BaseModel):
    name: str
    description: str | None = None
    scope: str = "item"
    parent_id: int | None = None


class CatalogComponentCreateRequest(BaseModel):
    category_id: int
    component_type: str
    name: str
    short_name: str | None = None
    description: str | None = None
    short_description: str | None = None
    installation: str | None = None
    unit_type: str | None = None


class CatalogComponentUpdateRequest(BaseModel):
    name: str
    short_name: str | None = None
    description: str | None = None
    short_description: str | None = None
    installation: str | None = None
    unit_type: str | None = None
    component_type: str


class CatalogAttributePayloadModel(BaseModel):
    name: str
    scope: str = "base"
    value_type: str
    options: list[str] = Field(default_factory=list)


class CatalogComponentAttributesReplaceRequest(BaseModel):
    scope: str = "base"
    attributes: list[CatalogAttributePayloadModel] = Field(default_factory=list)


class CatalogCategoryLinksUpdateRequest(BaseModel):
    linked_category_ids: list[int] = Field(default_factory=list)


class CatalogMaterialClausePayloadModel(BaseModel):
    attribute_name: str
    operator: str
    comparison_value: str | None = None
    comparison_value_secondary: str | None = None


class CatalogMaterialConditionGroupPayloadModel(BaseModel):
    group: str
    clauses: list[CatalogMaterialClausePayloadModel] = Field(default_factory=list)


class CatalogMaterialRulePayloadModel(BaseModel):
    id: int | None = None
    material_id: int | None = None
    material_name: str
    sku: str
    unit: str | None = None
    unit_qty_per_unit: float | None = None
    notes: str | None = None
    conditions: list[CatalogMaterialConditionGroupPayloadModel] = Field(default_factory=list)


class CatalogComponentMaterialsReplaceRequest(BaseModel):
    rules: list[CatalogMaterialRulePayloadModel] = Field(default_factory=list)


class CatalogMaterialSearchResultModel(BaseModel):
    material_id: int | None = None
    sku: str
    name: str
    unit: str | None = None
    source: str
    has_erp_data: bool = False


class CatalogMaterialSearchResponse(BaseModel):
    results: list[CatalogMaterialSearchResultModel] = Field(default_factory=list)
    live_erp_available: bool


class ProjectCreateRequest(BaseModel):
    name: str
    description: str | None = None
    status: str = "template"


class AttributeValueInputModel(BaseModel):
    name: str
    value: str | None = None


class ProjectInstanceCreateRequest(BaseModel):
    category_id: int
    component_id: int
    name: str
    short_name: str | None = None
    description: str | None = None
    short_description: str | None = None
    installation: str | None = None
    unit_amount: float | None = None
    attribute_values: list[AttributeValueInputModel] = Field(default_factory=list)


class ProjectInstanceUpdateRequest(BaseModel):
    name: str
    short_name: str | None = None
    description: str | None = None
    short_description: str | None = None
    installation: str | None = None
    unit_amount: float | None = None
    attribute_values: list[AttributeValueInputModel] = Field(default_factory=list)


class ProjectSubtypeCreateRequest(BaseModel):
    name: str
    parent_id: int | None = None


class ProjectSubtypeUpdateRequest(BaseModel):
    name: str


class MaterialOccurrenceEntryInputModel(BaseModel):
    subtype_id: int | None = None
    quantity: float | None = None
    assembly_quantity: float | None = None


class MaterialOccurrenceUpdateRequest(BaseModel):
    mode: str
    entries: list[MaterialOccurrenceEntryInputModel] = Field(default_factory=list)


class MaterialCalculationCellInputModel(BaseModel):
    row_index: int
    column_index: int
    raw_input: str


class MaterialCalculationSheetUpdateRequest(BaseModel):
    cells: list[MaterialCalculationCellInputModel] = Field(default_factory=list)


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
    is_outdated: bool
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
    subtype_id: int | None
    subtype: str
    subtype_depth: int
    quantity: float | None
    quantity_state: str
    assembly_quantity: float | None
    assembly_quantity_state: str
    unit: str | None
    calculation_mode: str
    calculation_formula: str | None
    calculation_explanation: str | None
    is_persisted: bool = True


class MaterialModel(BaseModel):
    rule_id: int
    material_id: int
    material_name: str
    sku: str
    unit_qty_per_unit: float | None
    unit: str | None
    notes: str | None
    applicability: MaterialApplicabilityModel
    mode: str
    bom_entries: list[BomEntryModel]


class MaterialCalculationCellModel(BaseModel):
    row_index: int
    column_index: int
    raw_input: str


class MaterialCalculationSheetResponse(BaseModel):
    project_id: int
    instance_id: int
    rule_id: int
    material_id: int
    material_name: str
    sku: str
    cell_count: int
    updated_at: str | None
    cells: list[MaterialCalculationCellModel] = Field(default_factory=list)


class AttributeValueModel(BaseModel):
    name: str
    value: str | None


class AttributeGroupModel(BaseModel):
    name: str
    application_label: str | None
    values: list[AttributeValueModel]


class EditableAttributeModel(BaseModel):
    name: str
    value_type: str
    options: list[str]
    value: str | None = None


class AvailableComponentModel(BaseModel):
    id: int
    name: str
    short_name: str | None
    type: str
    description: str | None
    short_description: str | None
    installation: str | None
    base_attributes: list[EditableAttributeModel]
    usage_attributes: list[EditableAttributeModel]


class InstanceLinkModel(BaseModel):
    name: str
    application_label: str | None
    relationship_type: str


class OccurrenceAttributeModel(BaseModel):
    name: str
    value: str | None


class OccurrenceTargetModel(BaseModel):
    instance_id: int
    instance_name: str


class OccurrenceModel(BaseModel):
    id: int
    relationship_type: str
    context_label: str | None
    targets: list[OccurrenceTargetModel]
    attributes: list[OccurrenceAttributeModel]


class ProjectInstanceModel(BaseModel):
    id: int
    name: str
    short_name: str | None
    type: str
    description: str | None
    short_description: str | None
    installation: str | None
    unit_amount: float | None
    editable_attributes: list[EditableAttributeModel] = Field(default_factory=list)
    usage_attribute_definitions: list[EditableAttributeModel] = Field(default_factory=list)
    attributes: list[AttributeGroupModel]
    linked_accessories: list[InstanceLinkModel]
    linked_to: list[InstanceLinkModel]
    outgoing_occurrences: list[OccurrenceModel] = Field(default_factory=list)
    incoming_occurrences: list[OccurrenceModel] = Field(default_factory=list)
    materials: list[MaterialModel]
    sync_state: SyncStateModel
    media: list[MediaModel]
    export_settings: list[ExportSettingModel]
    material_mode: str


class CatalogComponentMutationResultModel(MutationResultModel):
    component: CatalogComponentModel | None = None


class ProjectInstanceMutationResultModel(MutationResultModel):
    instance: ProjectInstanceModel | None = None


class ProjectOccurrenceMutationResultModel(MutationResultModel):
    occurrence: OccurrenceModel | None = None


class CategorySectionModel(BaseModel):
    id: int
    name: str
    scope: str
    depth: int
    linked_category_ids: list[int] = Field(default_factory=list)
    linked_categories: list[str]
    available_components: list[AvailableComponentModel] = Field(default_factory=list)
    instances: list[ProjectInstanceModel]


class ProjectSubtypeModel(BaseModel):
    id: int
    parent_id: int | None = None
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


class ProjectOccurrenceUpdateRequest(BaseModel):
    relationship_type: str = "uses"
    context_label: str | None = None
    target_instance_id: int | None = None
    attribute_values: list[AttributeValueInputModel] = Field(default_factory=list)


class SyncScalarFieldModel(BaseModel):
    field: str
    label: str
    status: str
    instance_value: str | None
    catalog_value: str | None
    snapshot_value: str | None
    can_apply_catalog: bool = False


class SyncAttributeDefinitionModel(BaseModel):
    name: str
    value_type: str | None = None
    options: list[str] = Field(default_factory=list)


class SyncAttributeDifferenceModel(BaseModel):
    name: str
    status: str
    instance_definition: SyncAttributeDefinitionModel | None = None
    catalog_definition: SyncAttributeDefinitionModel | None = None
    snapshot_definition: SyncAttributeDefinitionModel | None = None
    can_add: bool = False
    can_remove: bool = False


class SyncAttributeSchemaModel(BaseModel):
    field: str
    label: str
    status: str
    differences: list[SyncAttributeDifferenceModel] = Field(default_factory=list)


class SyncPreviewResponse(BaseModel):
    instance_id: int
    instance_name: str
    component_id: int
    component_name: str
    sync_status: str
    is_outdated: bool
    scalar_fields: list[SyncScalarFieldModel] = Field(default_factory=list)
    attribute_schema: SyncAttributeSchemaModel


class SyncFieldApplyRequest(BaseModel):
    field: str


class SyncAttributeSchemaUpdateRequest(BaseModel):
    add_attribute_names: list[str] = Field(default_factory=list)
    remove_attribute_names: list[str] = Field(default_factory=list)


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


class ActivityChangeModel(BaseModel):
    label: str
    before: str | None
    after: str | None


class ActivityEntryModel(BaseModel):
    id: str
    kind: str
    headline: str
    subject_name: str | None
    notes: list[str] = Field(default_factory=list)
    changes: list[ActivityChangeModel] = Field(default_factory=list)
    created_at: str
    actor: str | None
    is_minor: bool = False


class ApprovalModel(BaseModel):
    id: int
    status: str
    summary: str
    requested_by: str
    decided_by: str | None
    created_at: str
    decided_at: str | None


class ActivityGroupProjectModel(BaseModel):
    id: int
    name: str
    status: str
    status_label: str


class ActivityGroupModel(BaseModel):
    id: int
    title: str
    project: ActivityGroupProjectModel
    created_at: str
    updated_at: str
    actor: str | None
    entry_count: int
    entries: list[ActivityEntryModel] = Field(default_factory=list)


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


class MaterialDashboardPurchaseOrderModel(BaseModel):
    date: str | None
    number: str | None
    estimated_delivery: str | None


class MaterialDashboardListRowModel(BaseModel):
    sku: str
    material_name: str
    unit: str | None
    last_movement_date: str | None
    movement_quantity_60d: float
    movement_count_60d: int


class MaterialDashboardDetailModel(BaseModel):
    sku: str
    material_name: str
    unit: str | None
    movement_quantity_30d: float
    stock_on_hand: float | None
    pending_purchase_quantity: float | None
    average_price: float | None
    average_lead_time_days: float | None
    median_lead_time_days: float | None
    max_lead_time_days: float | None
    lead_time_sample_count: int
    average_daily_outgoing_30d: float
    days_of_stock_30d: float | None
    reorder_date_recent_rate: str | None
    last_purchase_order: MaterialDashboardPurchaseOrderModel


class MaterialDashboardResponse(BaseModel):
    materials: list[MaterialDashboardListRowModel]
    movement_window_days: int
    ceco_filters: list[str] = Field(default_factory=list)
    generated_at: str


class MaterialDashboardFilterRequest(BaseModel):
    cecos: list[str] = Field(default_factory=list)
    excluded_cecos: list[str] = Field(default_factory=list)
    refresh: bool = False


class MaterialDashboardDateRangeRequest(MaterialDashboardFilterRequest):
    start_date: date | None = None
    end_date: date | None = None


class MaterialDashboardListRequest(MaterialDashboardDateRangeRequest):
    movement_days: int = Field(default=60, ge=1)


class MaterialDashboardHouseComparisonRequest(MaterialDashboardDateRangeRequest):
    house_type_id: int = Field(ge=1)
    project_id: int | None = Field(default=None, ge=1)


class MaterialDashboardDetailResponse(MaterialDashboardDetailModel):
    generated_at: str


class MaterialDashboardCecoModel(BaseModel):
    code: str
    name: str


class MaterialDashboardCecoResponse(BaseModel):
    cecos: list[MaterialDashboardCecoModel] = Field(default_factory=list)


class MaterialDashboardMovementPointModel(BaseModel):
    date: str
    quantity: float


class MaterialDashboardMovementDetailModel(BaseModel):
    date: str
    quantity: float
    ceco: str | None
    ceco_name: str | None
    desc_sub: str | None = None
    movement_internal_number: str | None
    line_count: int


class MaterialDashboardMovementResponse(BaseModel):
    sku: str
    movement_days: int
    ceco_filters: list[str] = Field(default_factory=list)
    range_start: str | None
    range_end: str | None
    movements: list[MaterialDashboardMovementPointModel] = Field(default_factory=list)
    movement_details: list[MaterialDashboardMovementDetailModel] = Field(default_factory=list)
    generated_at: str


class MaterialDashboardHouseTypeModel(BaseModel):
    id: int
    name: str
    number_of_modules: int


class MaterialDashboardHouseTypesResponse(BaseModel):
    house_types: list[MaterialDashboardHouseTypeModel] = Field(default_factory=list)


class MaterialDashboardHouseComparisonPointModel(BaseModel):
    date: str
    material_quantity: float
    house_starts: int
    cumulative_material_quantity: float
    cumulative_house_starts: int
    material_per_house: float | None


class MaterialDashboardProjectComparisonModel(BaseModel):
    project_id: int
    project_name: str
    predicted_quantity_per_house: float
    projected_total_material_quantity: float


class MaterialDashboardEconomicMetricModel(BaseModel):
    sku: str
    material_per_house: float | None
    predicted_quantity_per_house: float | None
    consumption_delta_percent: float | None
    consumption_cost_delta_per_house: float | None
    average_price: float | None


class MaterialDashboardEconomicMetricsResponse(BaseModel):
    house_type_id: int
    project_id: int | None = None
    ceco_filters: list[str] = Field(default_factory=list)
    range_start: str | None
    range_end: str | None
    total_house_starts: int
    metrics: list[MaterialDashboardEconomicMetricModel] = Field(default_factory=list)
    generated_at: str


class MaterialDashboardProjectUsageProjectModel(BaseModel):
    id: int
    name: str


class MaterialDashboardProjectUsageBreakdownEntryModel(BaseModel):
    subtype_id: int | None
    subtype_name: str
    quantity: float | None
    quantity_state: str
    assembly_quantity: float | None
    assembly_quantity_state: str
    unit: str | None
    calculation_mode: str
    calculation_formula: str | None
    calculation_explanation: str | None


class MaterialDashboardProjectUsageItemModel(BaseModel):
    instance_id: int
    instance_name: str
    category_name: str | None
    component_name: str | None
    rule_id: int
    material_id: int
    unit_qty_per_unit: float | None
    rule_notes: str | None
    total_quantity: float
    blank_quantity_count: int
    zero_quantity_count: int
    unit: str | None
    has_calculation_sheet: bool
    calculation_sheet_cell_count: int
    calculation_sheet_updated_at: str | None
    breakdown: list[MaterialDashboardProjectUsageBreakdownEntryModel] = Field(default_factory=list)


class MaterialDashboardProjectUsageResponse(BaseModel):
    project: MaterialDashboardProjectUsageProjectModel
    sku: str
    material_name: str | None
    unit: str | None
    total_quantity: float
    item_count: int
    items: list[MaterialDashboardProjectUsageItemModel] = Field(default_factory=list)
    generated_at: str


class MaterialDashboardHouseComparisonResponse(BaseModel):
    sku: str
    house_type_id: int
    house_type_name: str
    number_of_modules: int
    movement_days: int
    ceco_filters: list[str] = Field(default_factory=list)
    range_start: str | None
    range_end: str | None
    total_material_quantity: float
    total_house_starts: int
    material_per_house: float | None
    latest_house_start_date: str | None
    project_comparison: MaterialDashboardProjectComparisonModel | None = None
    points: list[MaterialDashboardHouseComparisonPointModel] = Field(default_factory=list)
    generated_at: str


class MaterialStudyGroupMemberModel(BaseModel):
    sku: str
    material_name: str
    unit: str | None
    factor_to_study_unit: float
    display_order: int


class MaterialStudyGroupMemberPayloadModel(BaseModel):
    sku: str
    material_name: str
    unit: str | None = None
    factor_to_study_unit: float


class MaterialStudyGroupModel(BaseModel):
    group_id: int
    name: str
    description: str | None
    study_unit: str
    member_count: int
    members: list[MaterialStudyGroupMemberModel] = Field(default_factory=list)
    sku: str
    material_name: str
    unit: str | None
    last_movement_date: str | None
    movement_quantity_60d: float
    movement_count_60d: int


class MaterialStudyGroupListResponse(BaseModel):
    groups: list[MaterialStudyGroupModel] = Field(default_factory=list)
    movement_window_days: int
    ceco_filters: list[str] = Field(default_factory=list)
    generated_at: str


class MaterialStudyGroupPayloadModel(BaseModel):
    name: str
    description: str | None = None
    study_unit: str
    members: list[MaterialStudyGroupMemberPayloadModel] = Field(default_factory=list)


class MaterialDashboardGroupDetailResponse(MaterialDashboardDetailModel):
    group_id: int
    name: str
    description: str | None
    study_unit: str
    member_count: int
    members: list[MaterialStudyGroupMemberModel] = Field(default_factory=list)
    generated_at: str


class MaterialDashboardGroupMovementDetailModel(MaterialDashboardMovementDetailModel):
    sku: str
    material_name: str
    source_unit: str | None
    factor_to_study_unit: float
    source_quantity: float


class MaterialDashboardGroupMovementResponse(BaseModel):
    group_id: int
    group_name: str
    description: str | None
    study_unit: str
    member_count: int
    members: list[MaterialStudyGroupMemberModel] = Field(default_factory=list)
    sku: str
    material_name: str
    unit: str | None
    movement_days: int
    ceco_filters: list[str] = Field(default_factory=list)
    range_start: str | None
    range_end: str | None
    movements: list[MaterialDashboardMovementPointModel] = Field(default_factory=list)
    movement_details: list[MaterialDashboardGroupMovementDetailModel] = Field(default_factory=list)
    generated_at: str


class MaterialDashboardGroupHouseComparisonResponse(MaterialDashboardHouseComparisonResponse):
    group_id: int
    group_name: str
    description: str | None
    study_unit: str
    member_count: int
    members: list[MaterialStudyGroupMemberModel] = Field(default_factory=list)
    material_name: str
    unit: str | None


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
