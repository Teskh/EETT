export type PermissionSet = {
  catalog_edit: boolean;
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
