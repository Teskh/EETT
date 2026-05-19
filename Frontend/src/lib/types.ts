export type PermissionSet = {
  catalog_edit: boolean;
  material_dashboard: boolean;
  erp_admin: boolean;
  project_create: boolean;
  project_edit: boolean;
  project_view: boolean;
  project_change_status: boolean;
  project_delete: boolean;
  cost_model_export: boolean;
  user_admin: boolean;
};

export type PageAccess = {
  can_read: boolean;
  can_edit: boolean;
};

export type PageAccessMap = Record<string, PageAccess>;

export type SessionUser = {
  username: string;
  display_name: string;
  roles: string[];
  permissions: PermissionSet;
  page_access: PageAccessMap;
  is_guest?: boolean;
};

export type MaterialDashboardPurchaseOrder = {
  date: string | null;
  number: string | null;
  estimated_delivery: string | null;
};

export type MaterialDashboardPurchaseOrderLine = {
  date: string | null;
  number: string | null;
  estimated_delivery: string | null;
  status_code: string | null;
  line_number: string | null;
  ordered_quantity: number | null;
  unit_price: number | null;
  received_quantity: number | null;
  received_not_invoiced_quantity: number | null;
  pending_quantity: number | null;
  counted_in_pending: boolean;
};

export type MaterialDashboardListRow = {
  sku: string;
  material_name: string;
  unit: string | null;
  last_movement_date: string | null;
  movement_quantity_60d: number;
  movement_count_60d: number;
};

export type MaterialDashboardDetail = {
  sku: string;
  material_name: string;
  unit: string | null;
  movement_quantity_30d: number;
  stock_on_hand: number | null;
  pending_purchase_quantity: number | null;
  average_price: number | null;
  last_purchase_price: number | null;
  average_lead_time_days: number | null;
  median_lead_time_days: number | null;
  max_lead_time_days: number | null;
  lead_time_sample_count: number;
  average_daily_outgoing_30d: number;
  days_of_stock_30d: number | null;
  reorder_date_recent_rate: string | null;
  last_purchase_order: MaterialDashboardPurchaseOrder;
  purchase_orders: MaterialDashboardPurchaseOrderLine[];
};

export type MaterialDashboardData = {
  materials: MaterialDashboardListRow[];
  movement_window_days: number;
  ceco_filters: string[];
  generated_at: string;
};

export type MaterialDashboardDetailData = MaterialDashboardDetail & {
  generated_at: string;
};

export type MaterialDashboardCeco = {
  code: string;
  name: string;
};

export type MaterialDashboardCecoResponse = {
  cecos: MaterialDashboardCeco[];
};

export type MaterialDashboardMovementPoint = {
  date: string;
  quantity: number;
};

export type MaterialDashboardMovementDetail = {
  date: string;
  quantity: number;
  ceco: string | null;
  ceco_name: string | null;
  desc_sub: string | null;
  movement_internal_number: string | null;
  line_count: number;
};

export type MaterialDashboardMovementData = {
  sku: string;
  movement_days: number;
  ceco_filters: string[];
  range_start: string | null;
  range_end: string | null;
  movements: MaterialDashboardMovementPoint[];
  movement_details?: MaterialDashboardMovementDetail[];
  generated_at: string;
};

export type MaterialDashboardHouseType = {
  id: number;
  name: string;
  number_of_modules: number;
};

export type MaterialDashboardHouseTypesResponse = {
  house_types: MaterialDashboardHouseType[];
};

export type MaterialDashboardHouseComparisonPoint = {
  date: string;
  material_quantity: number;
  house_starts: number;
  cumulative_material_quantity: number;
  cumulative_house_starts: number;
  material_per_house: number | null;
};

export type MaterialDashboardProjectComparison = {
  project_id: number;
  project_name: string;
  predicted_quantity_per_house: number;
  projected_total_material_quantity: number;
};

export type MaterialDashboardEconomicMetric = {
  sku: string;
  material_per_house: number | null;
  predicted_quantity_per_house: number | null;
  consumption_delta_percent: number | null;
  consumption_cost_delta_per_house: number | null;
  average_price: number | null;
  last_purchase_price: number | null;
  min_purchase_price: number | null;
  max_purchase_price: number | null;
  purchase_price_delta: number | null;
  purchase_price_delta_percent: number | null;
  historical_weighted_overprice: number | null;
  estimated_weighted_overprice: number | null;
};

export type MaterialDashboardEconomicMetricsResponse = {
  house_type_id: number;
  project_id: number | null;
  ceco_filters: string[];
  range_start: string | null;
  range_end: string | null;
  total_house_starts: number;
  metrics: MaterialDashboardEconomicMetric[];
  generated_at: string;
};

export type MaterialDashboardHouseComparisonData = {
  sku: string;
  house_type_id: number;
  house_type_name: string;
  number_of_modules: number;
  movement_days: number;
  ceco_filters: string[];
  range_start: string | null;
  range_end: string | null;
  total_material_quantity: number;
  total_house_starts: number;
  material_per_house: number | null;
  latest_house_start_date: string | null;
  project_comparison: MaterialDashboardProjectComparison | null;
  points: MaterialDashboardHouseComparisonPoint[];
  generated_at: string;
};

export type MaterialDashboardMaterialStudyData = {
  detail: MaterialDashboardDetailData;
  history: MaterialDashboardMovementData;
  comparison: MaterialDashboardHouseComparisonData;
};

export type MaterialDashboardProjectUsageBreakdownEntry = {
  subtype_id: number | null;
  subtype_name: string;
  quantity: number | null;
  quantity_state: string;
  assembly_quantity: number | null;
  assembly_quantity_state: string;
  unit: string | null;
  calculation_mode: string;
  calculation_formula: string | null;
  calculation_explanation: string | null;
};

export type MaterialDashboardProjectUsageItem = {
  instance_id: number;
  instance_name: string;
  category_name: string | null;
  component_name: string | null;
  rule_id: number | null;
  material_id: number;
  unit_qty_per_unit: number | null;
  total_quantity: number;
  blank_quantity_count: number;
  zero_quantity_count: number;
  unit: string | null;
  has_calculation_sheet: boolean;
  calculation_sheet_cell_count: number;
  calculation_sheet_updated_at: string | null;
  breakdown: MaterialDashboardProjectUsageBreakdownEntry[];
};

export type MaterialDashboardProjectUsageData = {
  project: {
    id: number;
    name: string;
  };
  sku: string;
  material_name: string | null;
  unit: string | null;
  total_quantity: number;
  item_count: number;
  items: MaterialDashboardProjectUsageItem[];
  generated_at: string;
};

export type MaterialStudyGroupMember = {
  sku: string;
  material_name: string;
  unit: string | null;
  factor_to_study_unit: number;
  display_order: number;
};

export type MaterialStudyGroupRow = {
  group_id: number;
  name: string;
  description: string | null;
  study_unit: string;
  member_count: number;
  members: MaterialStudyGroupMember[];
  sku: string;
  material_name: string;
  unit: string | null;
  last_movement_date: string | null;
  movement_quantity_60d: number;
  movement_count_60d: number;
};

export type MaterialStudyGroupListResponse = {
  groups: MaterialStudyGroupRow[];
  movement_window_days: number;
  ceco_filters: string[];
  generated_at: string;
};

export type MaterialStudyGroupPayloadMember = {
  sku: string;
  material_name: string;
  unit: string | null;
  factor_to_study_unit: number;
};

export type MaterialStudyGroupPayload = {
  name: string;
  description: string | null;
  study_unit: string;
  members: MaterialStudyGroupPayloadMember[];
};

export type MaterialDashboardGroupDetailData = {
  group_id: number;
  name: string;
  description: string | null;
  study_unit: string;
  member_count: number;
  members: MaterialStudyGroupMember[];
  sku: string;
  material_name: string;
  unit: string | null;
  movement_quantity_30d: number;
  stock_on_hand: number | null;
  pending_purchase_quantity: number | null;
  average_price: number | null;
  average_lead_time_days: number | null;
  median_lead_time_days: number | null;
  max_lead_time_days: number | null;
  lead_time_sample_count: number;
  average_daily_outgoing_30d: number;
  days_of_stock_30d: number | null;
  reorder_date_recent_rate: string | null;
  last_purchase_order: MaterialDashboardPurchaseOrder;
  generated_at: string;
};

export type MaterialDashboardGroupMovementDetail = {
  date: string;
  quantity: number;
  ceco: string | null;
  ceco_name: string | null;
  desc_sub: string | null;
  movement_internal_number: string | null;
  line_count: number;
  sku: string;
  material_name: string;
  source_unit: string | null;
  factor_to_study_unit: number;
  source_quantity: number;
};

export type MaterialDashboardGroupMovementData = {
  group_id: number;
  group_name: string;
  description: string | null;
  study_unit: string;
  member_count: number;
  members: MaterialStudyGroupMember[];
  sku: string;
  material_name: string;
  unit: string | null;
  movement_days: number;
  ceco_filters: string[];
  range_start: string | null;
  range_end: string | null;
  movements: MaterialDashboardMovementPoint[];
  movement_details: MaterialDashboardGroupMovementDetail[];
  generated_at: string;
};

export type MaterialDashboardGroupHouseComparisonData = MaterialDashboardHouseComparisonData & {
  group_id: number;
  group_name: string;
  description: string | null;
  study_unit: string;
  member_count: number;
  members: MaterialStudyGroupMember[];
  material_name: string;
  unit: string | null;
};

export type LoginRequest = {
  username: string;
  password: string;
};

export type RoleOption = {
  code: string;
  name: string;
  description: string;
  assignable: boolean;
  page_access: PageAccessMap;
};

export type PageOption = {
  key: string;
  label: string;
};

export type ManagedUser = {
  id: number;
  username: string;
  display_name: string;
  email: string;
  is_active: boolean;
  roles: string[];
  created_at: string;
};

export type UserDirectory = {
  users: ManagedUser[];
  roles: RoleOption[];
  pages: PageOption[];
};

export type CreateUserRequest = {
  username: string;
  display_name: string;
  email: string;
  password: string;
  role_codes: string[];
  is_active: boolean;
};

export type UpdateUserRequest = {
  display_name: string;
  email: string;
  password?: string | null;
  role_codes: string[];
  is_active: boolean;
};

export type RolePageAccessUpdateRequest = {
  role_access: Record<string, PageAccessMap>;
};

export type BackupRecord = {
  filename: string;
  size_bytes: number;
  created_at: string;
  label?: string | null;
};

export type BackupSettings = {
  enabled: boolean;
  interval_minutes: number;
  retention_count: number;
  last_backup_at: string | null;
};

export type BackupCreateResponse = {
  backup: BackupRecord;
  settings: BackupSettings;
  pruned: string[];
};

export type BackupRestoreResponse = {
  primary_db: string;
  archived_db: string;
  restored_from: string;
  checkpoint_backup: BackupRecord;
  pruned: string[];
};

export type CatalogTreeNode = {
  id: number;
  name: string;
  scope: string;
  component_count: number;
  children: CatalogTreeNode[];
};

export type CatalogAttribute = {
  id?: number;
  name: string;
  scope?: string;
  value_type: string;
  options: string[];
};

export type MaterialClause = {
  attribute_name: string;
  operator: string;
  comparison_value: string | null;
  comparison_value_secondary: string | null;
};

export type MaterialConditionGroup = {
  group: string;
  clauses: MaterialClause[];
};

export type CatalogMaterialRule = {
  id?: number;
  material_id?: number | null;
  material_name: string;
  sku: string;
  unit: string | null;
  unit_qty_per_unit: number | null;
  conditions: MaterialConditionGroup[];
};

export type CatalogMaterialSearchResult = {
  material_id: number | null;
  sku: string;
  name: string;
  unit: string | null;
  source: string;
  has_erp_data: boolean;
};

export type CatalogMaterialSearchResponse = {
  results: CatalogMaterialSearchResult[];
  live_erp_available: boolean;
};

export type MediaAsset = {
  id: number;
  kind: string;
  uri: string;
  original_filename: string | null;
  content_type: string | null;
  byte_size: number | null;
  sha256: string | null;
  width: number | null;
  height: number | null;
  created_at: string | null;
  caption?: string | null;
  sort_order?: number;
};

export type CatalogComponent = {
  id: number;
  category_id: number;
  name: string;
  short_name: string | null;
  type: string;
  description: string | null;
  short_description: string | null;
  installation: string | null;
  unit_type: string | null;
  base_attributes: CatalogAttribute[];
  usage_attributes: CatalogAttribute[];
  material_rules: CatalogMaterialRule[];
  media: MediaAsset[];
};

export type CatalogCategoryChip = {
  id: number;
  name: string;
  scope: string;
};

export type CatalogSelectedCategory = {
  id: number;
  name: string;
  description: string | null;
  scope: string;
  parent_id: number | null;
  linked_category_ids: number[];
  linked_categories: Array<{ id: number; name: string }>;
  child_categories: CatalogCategoryChip[];
  components: CatalogComponent[];
};

export type CatalogPageData = {
  summary: {
    categories: number;
    components: number;
    materials: number;
  };
  tree: CatalogTreeNode[];
  selected: CatalogSelectedCategory | null;
  link_targets: Array<{ id: number; name: string }>;
};

export type ProjectSummary = {
  id: number;
  name: string;
  status: string;
  status_label: string;
  updated_at: string;
  instance_count: number;
  material_mode: string;
};

export type ProjectsBoardData = {
  grouped_projects: Record<string, ProjectSummary[]>;
  status_labels: Record<string, string>;
};

export type ExportJob = {
  id: number;
  kind: string;
  status: string;
  requested_by: string | null;
  artifact_uri: string | null;
  payload: Record<string, unknown>;
  created_at: string;
  completed_at: string | null;
};

export type ProjectSubtype = {
  id: number;
  parent_id: number | null;
  name: string;
  children: ProjectSubtype[];
};

export type AttributeValue = {
  name: string;
  value: string | null;
};

export type AttributeGroup = {
  name: string;
  application_label: string | null;
  values: AttributeValue[];
};

export type EditableAttribute = {
  name: string;
  value_type: string;
  options: string[];
  value: string | null;
};

export type InstanceLink = {
  name: string;
  application_label: string | null;
  relationship_type: string;
};

export type OccurrenceAttribute = {
  name: string;
  value: string | null;
};

export type OccurrenceTarget = {
  instance_id: number;
  instance_name: string;
};

export type UsageOccurrence = {
  id: number;
  relationship_type: string;
  context_label: string | null;
  targets: OccurrenceTarget[];
  attributes: OccurrenceAttribute[];
};

export type BomEntry = {
  subtype_id: number | null;
  subtype: string;
  subtype_depth: number;
  quantity: number | null;
  quantity_state: string;
  assembly_quantity: number | null;
  assembly_quantity_state: string;
  unit: string | null;
  calculation_mode: string;
  calculation_formula: string | null;
  calculation_explanation: string | null;
  is_persisted: boolean;
};

export type MaterialApplicabilityGroup = {
  group: string;
  matched: boolean;
  clauses: Array<MaterialClause & { matched: boolean }>;
};

export type MaterialApplicability = {
  applies: boolean;
  matched_groups: string[];
  groups: MaterialApplicabilityGroup[];
};

export type InstanceMaterial = {
  material_key: string;
  rule_id: number | null;
  material_id: number;
  material_name: string;
  sku: string;
  unit_qty_per_unit: number | null;
  unit: string | null;
  source_status: string;
  source_label: string | null;
  applicability: MaterialApplicability;
  mode: string;
  bom_entries: BomEntry[];
};

export type MaterialCalculationCell = {
  row_index: number;
  column_index: number;
  raw_input: string;
};

export type MaterialCalculationSheet = {
  project_id: number;
  instance_id: number;
  rule_id: number;
  material_id: number;
  material_name: string;
  sku: string;
  cell_count: number;
  updated_at: string | null;
  cells: MaterialCalculationCell[];
};

export type SyncState = {
  status: string;
  is_outdated: boolean;
  last_synced_at: string | null;
  source_component_updated_at: string | null;
  notes: string | null;
};

export type SyncScalarField = {
  field: string;
  label: string;
  status: string;
  instance_value: string | null;
  catalog_value: string | null;
  snapshot_value: string | null;
  can_apply_catalog: boolean;
};

export type SyncAttributeDefinition = {
  name: string;
  value_type: string | null;
  options: string[];
};

export type SyncAttributeDifference = {
  name: string;
  status: string;
  instance_definition: SyncAttributeDefinition | null;
  catalog_definition: SyncAttributeDefinition | null;
  snapshot_definition: SyncAttributeDefinition | null;
  can_add: boolean;
  can_remove: boolean;
};

export type SyncAttributeSchema = {
  field: string;
  label: string;
  status: string;
  differences: SyncAttributeDifference[];
};

export type InstanceSyncPreview = {
  instance_id: number;
  instance_name: string;
  component_id: number;
  component_name: string;
  sync_status: string;
  is_outdated: boolean;
  scalar_fields: SyncScalarField[];
  attribute_schema: SyncAttributeSchema;
};

export type AvailableComponent = {
  id: number;
  name: string;
  short_name: string | null;
  type: string;
  description: string | null;
  short_description: string | null;
  installation: string | null;
  base_attributes: CatalogAttribute[];
  usage_attributes: CatalogAttribute[];
  material_rules: CatalogMaterialRule[];
  media: MediaAsset[];
};

export type ProjectInstance = {
  id: number;
  name: string;
  short_name: string | null;
  type: string;
  description: string | null;
  short_description: string | null;
  installation: string | null;
  unit_amount: number | null;
  editable_attributes: EditableAttribute[];
  usage_attribute_definitions: EditableAttribute[];
  attributes: AttributeGroup[];
  linked_accessories: InstanceLink[];
  linked_to: InstanceLink[];
  outgoing_occurrences: UsageOccurrence[];
  incoming_occurrences: UsageOccurrence[];
  materials: InstanceMaterial[];
  sync_state: SyncState;
  media: MediaAsset[];
  export_settings: Array<{ target: string; settings: Record<string, unknown> }>;
  material_mode: string;
  comment_summary: {
    total_count: number;
    unread_count: number;
  };
};

export type ProjectCategorySection = {
  id: number;
  name: string;
  scope: string;
  depth: number;
  linked_category_ids: number[];
  linked_categories: string[];
  available_components: AvailableComponent[];
  instances: ProjectInstance[];
};

export type AuxiliaryMaterialSelection = {
  code: string;
  name: string;
  category: string | null;
  price: number;
  subtype: string;
};

export type ProjectDetailData = {
  project: {
    id: number;
    name: string;
    status: string;
    status_label: string;
    instance_count: number;
    material_mode: string;
  };
  subtypes: ProjectSubtype[];
  categories: ProjectCategorySection[];
  auxiliary_materials: AuxiliaryMaterialSelection[];
};

export type CostModelAdjustment = {
  id: number;
  subtype_id: number | null;
  adjusted_quantity: number;
  source_kind: string;
  source_note: string | null;
  source_house_type_id: number | null;
  source_range_start: string | null;
  source_range_end: string | null;
  source_sample_houses: number | null;
  source_total_consumption: number | null;
  updated_at: string | null;
  created_by: string | null;
};

export type CostModelSubtypeEntry = {
  subtype_id: number | null;
  subtype_name: string;
  estimated_quantity: number | null;
};

export type CostModelInstanceEntry = {
  instance_id: number | null;
  instance_name: string | null;
  category_label: string | null;
  subtype_id: number | null;
  subtype_name: string;
  quantity: number | null;
  quantity_state: string;
};

export type CostModelRow = {
  material_id: number | null;
  sku: string;
  material_name: string;
  unit: string;
  price: number | null;
  estimated_total_quantity: number | null;
  subtypes: CostModelSubtypeEntry[];
  instances: CostModelInstanceEntry[];
  adjustments: CostModelAdjustment[];
  is_auxiliary: boolean;
};

export type CostModelFlatSubtype = {
  id: number;
  name: string;
  parent_id: number | null;
  depth: number;
};

export type CostModelView = {
  project: {
    id: number;
    name: string;
    status: string;
    status_label: string;
    instance_count: number;
    material_mode: string;
  };
  material_mode: string;
  subtypes: ProjectSubtype[];
  flat_subtypes: CostModelFlatSubtype[];
  rows: CostModelRow[];
};

export type CostModelAdjustmentUpsertRequest = {
  material_id: number;
  subtype_id?: number | null;
  adjusted_quantity: number;
  source_kind?: string;
  source_note?: string | null;
  source_house_type_id?: number | null;
  source_range_start?: string | null;
  source_range_end?: string | null;
  source_sample_houses?: number | null;
  source_total_consumption?: number | null;
};

export type CostModelAdjustmentDeleteRequest = {
  material_id: number;
  subtype_id?: number | null;
};

export type Approval = {
  id: number;
  status: string;
  summary: string;
  requested_by: string;
  decided_by: string | null;
  created_at: string;
  decided_at: string | null;
};

export type ActivityChange = {
  label: string;
  before: string | null;
  after: string | null;
};

export type ActivityEntry = {
  id: string;
  kind: string;
  headline: string;
  subject_name: string | null;
  notes: string[];
  changes: ActivityChange[];
  created_at: string;
  actor: string | null;
  is_minor: boolean;
};

export type ActivityGroup = {
  id: number;
  title: string;
  project: {
    id: number;
    name: string;
    status: string;
    status_label: string;
  };
  created_at: string;
  updated_at: string;
  actor: string | null;
  entry_count: number;
  entries: ActivityEntry[];
};

export type CreateCategoryRequest = {
  name: string;
  description?: string | null;
  scope: string;
  parent_id?: number | null;
};

export type CreateComponentRequest = {
  category_id: number;
  component_type: string;
  name: string;
  short_name?: string | null;
  description?: string | null;
  short_description?: string | null;
  installation?: string | null;
  unit_type?: string | null;
};

export type UpdateComponentRequest = {
  name: string;
  short_name?: string | null;
  description?: string | null;
  short_description?: string | null;
  installation?: string | null;
  unit_type?: string | null;
  component_type: string;
};

export type CreateProjectRequest = {
  name: string;
  status: string;
};

export type CopyProjectRequest = {
  name?: string | null;
  status?: string | null;
};

export type UpdateProjectStatusRequest = {
  status: string;
};

export type AttributeValueInput = {
  name: string;
  value: string | null;
};

export type CreateProjectInstanceRequest = {
  category_id: number;
  component_id: number;
  name: string;
  short_name?: string | null;
  description?: string | null;
  short_description?: string | null;
  installation?: string | null;
  unit_amount?: number | null;
  attribute_values?: AttributeValueInput[];
  selected_material_rule_ids?: number[] | null;
  media_asset_id?: number | null;
};

export type UpdateProjectInstanceRequest = {
  name: string;
  short_name?: string | null;
  description?: string | null;
  short_description?: string | null;
  installation?: string | null;
  unit_amount?: number | null;
  attribute_values?: AttributeValueInput[];
  media_asset_id?: number | null;
  clear_media?: boolean;
};

export type UpdateProjectOccurrenceRequest = {
  relationship_type: string;
  context_label: string | null;
  target_instance_id: number | null;
  attribute_values: AttributeValueInput[];
};

export type ProjectComment = {
  id: number;
  body: string;
  author: string;
  author_display_name: string | null;
  project_id: number;
  instance_id: number | null;
  instance: string | null;
  parent_comment_id: number | null;
  created_at: string;
  updated_at: string;
  is_author: boolean;
  is_deleted: boolean;
  mentions: string[];
  replies: ProjectComment[];
};

export type CreateProjectCommentRequest = {
  body: string;
  instance_id?: number | null;
  parent_comment_id?: number | null;
};

export type CommentNotification = {
  id: number;
  type: string;
  route: string;
  is_read: boolean;
  comment_id: number;
  project_id: number;
  instance_id: number | null;
  body: string | null;
  author: string | null;
  project_name: string | null;
  instance_name: string | null;
  created_at: string;
};

export type CommentContext = {
  project_id: number;
  instance_id: number | null;
  comment_id: number;
  parent_comment_id: number | null;
};

export type CreateProjectSubtypeRequest = {
  name: string;
  parent_id?: number | null;
};

export type UpdateProjectSubtypeRequest = {
  name: string;
};

export type MaterialOccurrenceEntryInput = {
  subtype_id?: number | null;
  quantity?: number | null;
  assembly_quantity?: number | null;
};

export type UpdateMaterialOccurrenceRequest = {
  mode: string;
  entries: MaterialOccurrenceEntryInput[];
};

export type UpdateMaterialCalculationSheetRequest = {
  cells: MaterialCalculationCell[];
};

export type MutationResult = {
  ok: boolean;
  category_id?: number | null;
  component_id?: number | null;
  project_id?: number | null;
  instance_id?: number | null;
  occurrence_id?: number | null;
  deleted_id?: number | null;
  linked_category_ids?: number[];
  component?: CatalogComponent | null;
  instance?: ProjectInstance | null;
  occurrence?: UsageOccurrence | null;
};
