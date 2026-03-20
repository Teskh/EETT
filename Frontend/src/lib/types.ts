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

export type SessionUser = {
  username: string;
  display_name: string;
  roles: string[];
  permissions: PermissionSet;
};

export type MaterialDashboardPurchaseOrder = {
  date: string | null;
  number: string | null;
  estimated_delivery: string | null;
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
  average_lead_time_days: number | null;
  max_lead_time_days: number | null;
  lead_time_sample_count: number;
  average_daily_outgoing_30d: number;
  days_of_stock_30d: number | null;
  reorder_date_recent_rate: string | null;
  last_purchase_order: MaterialDashboardPurchaseOrder;
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
  notes: string | null;
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
  description: string | null;
  updated_at: string;
  instance_count: number;
  material_mode: string;
};

export type ProjectsBoardData = {
  grouped_projects: Record<string, ProjectSummary[]>;
  status_labels: Record<string, string>;
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
  rule_id: number;
  material_id: number;
  material_name: string;
  sku: string;
  unit_qty_per_unit: number | null;
  unit: string | null;
  notes: string | null;
  applicability: MaterialApplicability;
  mode: string;
  bom_entries: BomEntry[];
};

export type SyncState = {
  status: string;
  is_outdated: boolean;
  last_synced_at: string | null;
  source_component_updated_at: string | null;
  notes: string | null;
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
  media: Array<{ kind: string; uri: string; caption: string | null }>;
  export_settings: Array<{ target: string; settings: Record<string, unknown> }>;
  material_mode: string;
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
    description: string | null;
    instance_count: number;
    material_mode: string;
  };
  subtypes: ProjectSubtype[];
  categories: ProjectCategorySection[];
  auxiliary_materials: AuxiliaryMaterialSelection[];
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
  description?: string | null;
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
};

export type UpdateProjectInstanceRequest = {
  name: string;
  short_name?: string | null;
  description?: string | null;
  short_description?: string | null;
  installation?: string | null;
  unit_amount?: number | null;
  attribute_values?: AttributeValueInput[];
};

export type UpdateProjectOccurrenceRequest = {
  relationship_type: string;
  context_label: string | null;
  target_instance_id: number | null;
  attribute_values: AttributeValueInput[];
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
