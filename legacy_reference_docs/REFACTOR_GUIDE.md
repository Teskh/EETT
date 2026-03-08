# Refactor Guide

## Purpose

This document defines what the application must continue to do after a rebuild.
It is intentionally written as a product and domain guide, not as a request to
preserve the current Flask, Jinja, jQuery, SQLite, or file-layout decisions.

The current codebase is useful as behavioral evidence, but it is not the target
architecture. Rebuild from user workflows, business rules, and output contracts.

## Core refactor stance

Preserve:

- the business purpose of the system
- the operator workflows
- the information architecture
- the data semantics
- the export contracts
- the ERP/dashboard outcomes

Do not preserve by default:

- the two-database split (`main.db` + `projects.db`)
- server-rendered HTML and jQuery-heavy UI flows
- JSON arrays or comma-separated IDs stored in text columns
- runtime `ALTER TABLE` migrations at app startup
- hardcoded users/passwords in config
- overloaded accessory application fields stored as freeform text
- duplicated query/export logic scattered across templates and Python files

## Mandatory rebuild decisions

These are explicit goals for the rebuild:

- Use a single PostgreSQL database instead of the current SQLite split.
- Use a React + TypeScript frontend instead of the current vanilla HTML/CSS/JS frontend.

Strong recommendations:

- Keep the backend API-first. The exact backend framework is open, but domain
  boundaries and typed contracts matter more than framework choice.
- Isolate ERP/Softland access behind a dedicated integration layer.
- Move authentication and authorization into a real user system, SSO layer, or
  at minimum a proper users/roles model in the database.
- Treat exports, ERP refreshes, and heavy calculations as application services,
  not template-side logic.

## When in doubt

If a developer is unsure how a workflow is supposed to behave during the rebuild,
they should refer back to the original project in this repository as a behavior
reference.

Use the legacy code to answer questions about intent, UX, and output contents.
Do not use it as a reason to preserve weak implementation details. See
LEGACY_REFERENCE_MAP.md for a quick file map.

## Product summary

At a high level, the application is a technical specification and project
composition tool for construction/productized housing work.

It has two main halves:

1. A central reusable catalog where teams define categories, item/accessory
   templates, template attributes, linked accessory relationships, and material
   applicability rules.
2. A project workspace where teams instantiate those templates inside a project,
   tune attributes, define BOM quantities, break quantities down by subtype,
   collaborate through comments, and export technical/commercial/material
   outputs.

The system also overlays ERP data to answer operational questions such as:

- what stock exists for project materials
- what is pending on purchase orders
- what average price and lead time a material has
- how many "houses" can be built with current supply
- when a new purchase order should be raised

## Mental model to preserve

The current product behaves as if it had the following conceptual layers:

1. Catalog definition layer
   - categories
   - reusable component templates
   - attribute definitions and possible values
   - material applicability rules
   - auxiliary material definitions
2. Project composition layer
   - projects
   - project subtypes
   - project-specific instances of catalog components
   - per-instance attribute values
   - per-instance linked accessories / applications
   - project-specific BOM quantities and assembly-kit quantities
3. Collaboration and governance layer
   - comments
   - mentions
   - notifications
   - change log
   - approvals
4. Output and operational layer
   - PDF exports
   - Excel exports
   - cost model
   - material dashboard
   - public read-only API
   - ERP lookups and caches

This layering should survive the refactor even if the code structure changes
completely.

## Roles and permissions

Current role semantics should be preserved, though the implementation should be
modernized:

- `Admin`
  - full access
  - can edit the central catalog
  - can edit projects
  - can use ERP-only/admin-only tools
  - can change project status
  - can approve logs
  - can delete projects
  - can access cost-model export
- `Editor`
  - can edit catalog and projects
  - cannot use certain admin-only ERP tooling
  - cannot access cost-model export
- `OT`
  - same core editing powers as `Editor`
  - additionally can access the cost-model export
- `Viewer`
  - read-only
  - sees project outputs and project browsing
  - cannot edit project content
  - currently only sees execution projects in the project list
  - price-sensitive outputs may be partially hidden for this role

## Primary workflows

## 1. Landing / app shell

The landing page is a role-aware launcher into the main product areas:

- Central catalog administration
- Projects
- Material dashboard
- Change history
- ERP lookup (admin only)

The exact landing-page design can change, but these product areas still exist.

## 2. Central catalog administration

This workspace is for defining reusable product building blocks.

### Capabilities to preserve

- manage a nested category tree
- create, edit, reorder, and delete categories
- define whether categories contain items or accessories
- define categories that can link to other categories for accessory attachment
- create reusable item templates
- create reusable accessory templates
- define template attributes and possible values/options
- define materials for each template
- define material conditions for when each material applies
- define auxiliary materials outside the normal item/accessory template model

### Important business semantics

- Categories are hierarchical.
- Items and accessories both belong to categories.
- Items and accessories share many fields:
  - name
  - short name
  - description
  - short description
  - installation text
  - category
  - unit type
- Accessories differ mainly by how they are applied inside projects.
- A category can expose linkable accessory categories. In the current system
  this is stored poorly as a comma-separated field; in the rebuild it should be
  modeled relationally.

### What not to preserve

- separate item and accessory tables are not mandatory
- attribute values stored as JSON text arrays are not mandatory
- category link rules stored as comma-separated IDs must not be preserved

## 3. Project list and lifecycle

Projects are currently grouped into statuses:

- `Proyecto Tipo`
- `Proyectos en Ejecucion`
- `Proyecto Finalizado`

Preserve the concept, not necessarily the raw status strings.

### Capabilities to preserve

- create project
- edit project name
- copy project
- delete project
- browse projects by status
- export directly from the project list
- drag/drop status changes for privileged users
- read-only export access for viewers

### Recommended interpretation

Treat "project template" and "execution project" as explicit domain states, not
just display labels. The current app uses status both as workflow state and as
access filter.

## 4. Project subtypes

Projects can define nested subtypes.

Examples of what subtypes are used for:

- per-subtype material quantities
- subtype-specific auxiliary materials
- subtype-specific cost breakdowns

### Capabilities to preserve

- add root subtype
- add child subtype
- rename subtype
- delete subtype with descendants

### Data/UX behavior to preserve

- subtype hierarchy matters
- subtype data can affect BOM behavior and exports
- deleting a subtype currently cascades into BOM rows; the rebuild should make
  the intended deletion behavior explicit and safe

## 5. Project workspace: category tree and instances

This is the main operating screen of the application.

### Current UX contract

The user opens a project and sees:

- a searchable category index/sidebar
- a category tree in the main pane
- sticky global controls
- export actions
- auxiliary-material selection controls
- instance cards loaded per category

### Global controls to preserve

- toggle all attributes visibility
- toggle all materials visibility
- toggle description/installation visibility
- toggle comments visibility
- export menu
- fast navigation through the category tree

The exact React layout can change, but the workspace should still feel like a
single project composition surface rather than many disconnected screens.

### Category behavior to preserve

- categories show only project instances that belong there
- empty categories can still exist in the tree because they matter for browsing
- linked-accessory affordances should appear where relevant
- category-level lazy loading is acceptable and recommended

## 6. Project instances

Project instances are snapshots/customizations of catalog templates.

This snapshot behavior is important: changing the central catalog should not
silently rewrite old projects unless the product explicitly supports sync or
refresh workflows.

The rebuild should preserve `snapshot by default`, but it should also make it
easier to deliberately pull forward template changes into older projects when
needed. In particular, if a template gains or loses attributes, or otherwise
changes in a way that existing projects may want to adopt, the product should
support an explicit, reviewable sync/update path rather than forcing users to
recreate or hand-edit old instances. The exact sync mechanics can be designed
during implementation, but the intent should be:

- old instances remain stable unless a user chooses otherwise
- template drift can be detected and surfaced
- users can deliberately apply some or all relevant template changes to existing
  project instances
- the process should be previewable rather than silent

### Item instance behavior

An item instance currently has:

- project ownership
- pointer back to the original item template
- name / short name
- description / short description
- installation text
- optional image
- unit amount
- project-specific attribute values
- linked accessories
- project-specific export settings

### Accessory instance behavior

An accessory instance can be:

- standalone in the project
- linked to an item instance
- repeated across multiple application groups

The important behavior is:

- accessories can carry attributes per application context
- accessory applications can be associated with a specific item instance
- accessory material applicability can depend on the attribute group of a given
  application

### Critical note for the rebuild

Do not preserve the current storage shape where accessory application context is
hidden inside text fields such as `application` and `group_id`.

Preserve only the user-visible capability:

- an accessory can be attached to one or more item instances, with per-link or
  per-occurrence attributes

In the new data model this should be explicit, for example through either:

- an accessory occurrence table, or
- an accessory-to-item application join entity plus grouped attribute values

Either approach is better than the current overloaded text-based scheme.

## 7. Material applicability and BOM logic

This is one of the most important areas to preserve.

### Current rule model

Each catalog component has candidate material lines.

Each material line may have:

- no conditions, meaning it always applies
- one or more condition groups

Condition groups behave as:

- OR across groups
- AND within a group

Supported condition operators currently include:

- `=`
- `>`
- `<`
- `IN`
- `BETWEEN`
- `IS NOT NULL`

The rebuild must preserve this rule-evaluation behavior, but the storage model
can be redesigned.

### Project BOM behavior to preserve

For each applicable material, the project can store:

- quantity
- assembly-kit quantity
- optional subtype-specific quantity rows
- whether the row was auto-calculated
- instance association

### Quantity semantics that must be preserved

This is easy to lose in a refactor and must be kept explicit:

- `NULL` / blank quantity means:
  - the material is applicable
  - the material should still appear in editing surfaces
  - the material may still appear in exports, just without a quantity
- `0` quantity means:
  - the material is intentionally suppressed
  - it is visually dimmed in the current UI
  - it should not be exported in the same way as a positive quantity
- positive quantity means normal inclusion

Blank and zero are not the same thing.

### Per-subtype behavior

A material can be tracked:

- generally for the whole project instance, or
- separately by project subtype

The current toggle changes presentation and data entry mode. It should not
destroy previously entered subtype data when toggled off.

### Auto-calculation behavior

The current system can auto-calculate material quantity as:

- `instance.unit_amount * material.unit_qty_per_unit`

Preserve the behavior, but modernize the model:

- store the calculation source
- allow manual override
- keep the formula explainable in the UI
- avoid recalculating in hidden side effects

## 8. Auxiliary materials

Auxiliary materials are a separate class of project-selectable cost/material
lines that are not part of the main item/accessory template structure.

### Capabilities to preserve

- define reusable auxiliary materials centrally
- select them per project
- optionally associate them to a project subtype
- include them in Excel/cost-model outputs

This should be a first-class feature in the new schema, not an afterthought.

## 9. Comments, mentions, and notifications

Each project instance can have a threaded comment stream.

### Capabilities to preserve

- comment on an item instance
- comment on an accessory instance
- reply to comments
- mention users with `@username`
- notify mentioned users
- notify parent-comment authors on replies
- show unread notification count
- deep-link back to the relevant project/instance context

### Deletion behavior to preserve

Current behavior:

- if a comment has no replies, it is hard deleted
- if a comment has replies, it is soft deleted and replaced with a deleted
  marker

That behavior is defensible and should be preserved unless product owners want
it changed explicitly.

### Recommended improvements

- source mentionable users from the real user directory
- support proper user IDs instead of raw display names as the primary key

## 10. Change log and approvals

The application currently tracks significant project changes in a change log.

### Behaviors to preserve

- log create/update/delete operations for project content
- log link/unlink behavior
- log BOM quantity and assembly-kit changes
- group related log lines into meaningful timeline entries
- display logs grouped by project
- allow filtering by project status
- allow hiding noisy material-quantity logs
- allow admin approval of log groups

### Recommended rebuild direction

Use a proper audit/event model:

- immutable log events
- structured metadata
- actor identity
- approval metadata stored separately or as explicit event state

Preserve the approval workflow and timeline utility, not the current rendering
logic.

## 11. Exports and output contracts

Exports are core product outputs, not side features.

They should be treated as named contracts with regression coverage.

### A. Technical specification PDF: Commercial

Intent:

- present the project in a cleaner client/commercial-facing way

Behavior to preserve:

- cover page and project identity
- category and instance numbering
- use short name when available
- use short description when available
- per-instance export settings control what is included
- optional image inclusion
- optional installation inclusion
- optional attribute inclusion
- linked accessories can also be included with configurable attribute behavior
- execution-only material tables are omitted

### B. Technical specification PDF: Full

Intent:

- present the technically complete project description

Behavior to preserve:

- full descriptions and installations
- attribute tables
- linked accessories
- materials sections
- category hierarchy and instance numbering
- cover page and index/table of contents

### C. Material list PDF: total materials

Intent:

- aggregate material demand across the whole project

Behavior to preserve:

- aggregate by SKU/material
- include quantities in a flattened list
- respect quantity semantics around blank vs zero

### D. Material list PDF: by partida / category-instance context

Intent:

- show materials in the structure users think in when working on the project

Behavior to preserve:

- hierarchical or grouped presentation by category / instance context
- quantities sourced from project BOM

### E. Detailed material PDF

Intent:

- operational/procurement-facing report

Behavior to preserve:

- stock
- average price
- recent purchase-order data
- pending PO quantity
- recent consumption
- houses-in-stock and houses-with-PO metrics
- per-category grouping
- subtype-aware display where relevant
- viewer role may hide prices

### F. Assembly-kit PDF

Intent:

- show only assembly-kit quantities

Behavior to preserve:

- include only materials with assembly-kit demand
- preserve category grouping

### G. Material Excel workbook

Current workbook semantics to preserve:

- sheet for total materials
- sheet for materials by partida
- sheet for assembly kit

### H. Cost model Excel

Intent:

- commercial/operational costing model

Behavior to preserve:

- per-instance material rows
- unit price column, prefilled when possible
- line cost formulas
- subtotals per instance
- summary/total-material view
- inclusion of auxiliary materials
- role restriction to Admin / OT

### Per-instance export preferences

The current application already has per-instance export settings.

That capability should remain, but it should be modeled as a real preference
system rather than opaque JSON blobs if possible.

The product-level options to preserve include:

- include/exclude instance
- short vs full description mode
- include installation or not
- image on/off
- attribute inclusion mode
- linked accessory inclusion mode

## 12. Material dashboard

The material dashboard is not just a report. It is an operational planning
surface.

### Inputs/controls to preserve

- project selector
- CECO / cost-center filter
- houses target threshold
- daily production assumption
- lead-time sample count
- lead-time strategy
- search
- refresh live data
- refresh movement/consumption history

### Data sources

The dashboard combines:

- project material demand derived from BOM data
- ERP stock
- ERP pending PO information
- ERP last purchase-order data
- ERP average price
- ERP lead time samples
- ERP movement history / recent consumption
- cached ERP data

### Metrics to preserve

- stock
- pending purchase order quantity
- houses from stock
- houses from stock plus pending PO
- average price
- lead time reference
- reorder date from projected build rate
- reorder date from recent 30-day movement rate
- last PO date
- last PO number

### Important formulas/interpretations

- houses from stock ~= `stock / BOM quantity`
- houses from stock+PO ~= `(stock + pending_po) / BOM quantity`
- reorder dates are projections and should remain explainable, not magical
- CECO filters affect movement/consumption views and therefore certain derived
  planning outputs

### UX behaviors worth preserving

- sortable table
- alert coloring for risky supply positions
- cached vs refreshed state visibility
- per-material movement/projection detail on hover or drill-in

### Architectural guidance

- keep ERP reads out of the transactional request path where reasonable
- cache ERP snapshots separately from core project data
- consider background refresh jobs
- do not let dashboard cache tables pollute core catalog tables

## 13. Public read-only API

The app currently exposes a small public API.

Behavior to preserve:

- list relevant projects
- list distinct SKUs used by a project

The exact endpoint paths can change, but the integration need remains.

This API should be documented and versioned.

## 14. ERP/Softland integration

Current ERP integration is spread across admin lookup, dashboard, and cached
material enrichment.

### Capabilities to preserve

- fetch stock by SKU
- fetch average purchase price
- fetch recent purchase orders
- fetch pending PO quantity
- fetch delivery time samples / lead time
- fetch outgoing consumption/movement history
- fetch available cost centers

### Rebuild guidance

- isolate all ERP access behind explicit service methods
- centralize retry, timeout, circuit-breaker, and logging behavior
- treat ERP data as eventually consistent operational data
- cache aggressively where user experience allows

## Recommended PostgreSQL domain model

The exact table names are flexible. The domain boundaries below are the real
recommendation.

## A. Identity and access

- `users`
- `roles`
- `user_roles`
- optional SSO mapping / external identity fields

## B. Catalog

- `catalog_categories`
- `catalog_category_links`
  - replaces comma-separated linked category IDs
- `catalog_components`
  - recommended unified table for both items and accessories
  - include `component_type` (`item`, `accessory`)
- `catalog_attribute_definitions`
- `catalog_attribute_options`

## C. Materials

- `materials`
  - one row per real material/SKU
- `component_material_rules`
  - component -> material relationship
  - includes display order, unit, unit_qty_per_unit, etc.
- `material_rule_groups`
- `material_rule_conditions`

This is a key normalization improvement over the current model, where material
master data and component-association data are mixed together.

## D. Projects

- `projects`
- `project_statuses` or enum-backed status field
- `project_subtypes`

## E. Project composition

- `project_instances`
  - recommended unified table for item/accessory instances
  - include `instance_type`
  - include snapshot fields copied from catalog at creation time
- `project_instance_attribute_groups`
  - especially useful for accessory application contexts
- `project_instance_attribute_values`
- `project_instance_links`
  - recommended place to model accessory-to-item application explicitly
- `project_instance_media`
  - store managed URI/path references to files in `media_gallery/`
  - enforce media lifecycle rules so there are no orphan database rows or orphan files

## F. Project BOM and material settings

- `project_bom_entries`
  - unique per project + instance + material + subtype context
- `project_material_modes`
  - general vs per-subtype mode
- `project_auxiliary_material_selections`
- `auxiliary_materials`

## G. Collaboration

- `instance_comments`
- `comment_mentions`
- `comment_notifications`

## H. Exports/preferences

- `instance_export_preferences`
- optional `project_export_jobs` if exports are generated asynchronously

## I. Audit/governance

- `audit_events`
- `audit_event_groups` or equivalent grouping strategy
- `audit_approvals`

## J. ERP/cache layer

- `erp_material_cache`
- optional movement cache tables
- optional refresh job tables

This can live in the same PostgreSQL database if necessary, but it should be
clearly separated from core transactional tables.

## Modeling direction: simplify by making relationships explicit

The rebuild should generally prefer explicit relationships over inferred ones.

In the current app, some important concepts are represented indirectly through:

- duplicated item/accessory table families
- duplicated item-instance/accessory-instance table families
- attribute blobs
- nullable columns that change meaning by context
- accessory application data hidden inside attribute rows

The rebuild should steer toward a model where the data says more directly what
the user means.

### Example: linked accessories

Fictional project:

- project: `Casa Robles`
- item instances:
  - `Door A`
  - `Door B`
- accessory type:
  - `Smart Lock`
- applied result:
  - Door A gets a black, left-handed smart lock
  - Door B gets a silver, right-handed smart lock

How the current model tends to represent this:

- one accessory instance for `Smart Lock`
- multiple accessory attribute rows
- `application` and `group_id` are used to imply:
  - which item the lock is attached to
  - which set of attributes belongs to which occurrence

Conceptually, one accessory record is doing the work of multiple installed
accessories.

Preferred direction in the rebuild:

- keep a reusable catalog component for `Smart Lock`
- create explicit project-level occurrences or links for each installed use
- store each occurrence's attributes against that explicit occurrence

That means the data can say, directly:

- this smart lock occurrence belongs to Door A
- this smart lock occurrence belongs to Door B
- each occurrence has its own attribute values

This is simpler because the relationship is no longer hidden inside attribute
rows.

### Example: items vs accessories

Right now, items and accessories are modeled as parallel systems that share much
of the same structure:

- catalog records
- instance records
- attributes
- descriptions
- unit behavior

Preferred direction in the rebuild:

- use one core `component` idea in the catalog
- use one core `project instance` idea in the project layer
- keep a `type` or similar field to distinguish different UX behavior where
  needed

This keeps the UI flexible without forcing the backend into duplicated logic for
nearly identical concepts.

### Example: materials

Right now, a material row often mixes two different ideas:

- the material itself
- the rule that says when a component uses that material

Preferred direction in the rebuild:

- one concept for the material/SKU master record
- one concept for the rule that associates a component with that material

For example:

- `Screw M5` should exist once as a material
- `Door uses Screw M5 when lock_type = smart` should exist once as a rule

That separation makes BOM generation, ERP enrichment, exports, and dashboard
logic easier to reason about.

### Example: BOM state

The current app has useful behavior, but the model is muddied by rows that are
sometimes:

- general
- subtype-specific
- auto-calculated
- manually overridden
- blank but intentionally visible
- zero and intentionally suppressed

Preferred direction in the rebuild:

- make BOM entries first-class records with explicit context
- make calculation source explicit
- preserve the blank-vs-zero distinction as an intentional product rule

The goal is not to change the UX. The goal is to make the data model explain the
UX more directly.

## Legacy-to-new model mapping

Recommended conceptual mapping from the current system:

- `Items` + `Accesory_Item`
  - `catalog_components`
- `Item_Attributes` + `Accesory_Attributes`
  - `catalog_attribute_definitions` + `catalog_attribute_options`
- `Materials`
  - split into `materials` and `component_material_rules`
- `Material_Conditions`
  - `material_rule_groups` + `material_rule_conditions`
- `Item_Instances` + `Accessory_Instance`
  - `project_instances`
- `Item_Instance_Attributes`
  - `project_instance_attribute_values`
- `Accessory_Instance_Attributes`
  - `project_instance_attribute_groups` + `project_instance_attribute_values`
  - possibly also `project_instance_links`
- `Bill_Of_Materials`
  - `project_bom_entries`
- `Project_Material_Config`
  - `project_material_modes`
- `Project_Auxiliary_Materials`
  - `project_auxiliary_material_selections`
- `Instance_Comments`, `Comment_Mentions`, `Comment_Notifications`
  - same concepts, normalized and retained
- `Changelog`
  - `audit_events` / `audit_approvals`

## Recommended application stack

The rebuild should use:

- React + TypeScript
- FastAPI
- Uvicorn
- SQLAlchemy 2.x
- Alembic
- PostgreSQL

Supporting recommendations:

- use a background job mechanism for heavy exports and ERP refreshes
- keep ERP integration behind a dedicated service layer
- keep media in a managed `media_gallery/` folder with database-backed metadata

## React/TypeScript frontend guidance

The UI should be rebuilt as a typed client application with domain-focused
screens rather than server-rendered pages.

Recommended top-level frontend areas:

- catalog admin
- projects list
- project settings / subtype editor
- project workspace
- material dashboard
- logs/history
- ERP tools

Recommended UX structure for the project workspace:

- persistent project shell
- searchable category navigation
- main category/instance canvas
- comments side panel or side column
- sticky global action bar
- local optimistic edits with server reconciliation

Recommended technical approach:

- typed API contracts
- normalized frontend domain models
- React Query or equivalent data-fetching/caching layer
- componentized tables/forms rather than raw imperative DOM mutation
- deliberate support for progressive loading and skeleton states

Avoid rebuilding the current page by page DOM-jQuery behavior in React.

## Non-goals: legacy implementation details to leave behind

The rebuild should explicitly avoid carrying forward these patterns:

- dual SQLite files with cross-database assumptions
- startup-time schema mutation in production code
- hardcoded safe-directory/workstation assumptions
- user/password definitions in source code
- category link IDs stored in strings
- attribute options stored as JSON blobs when they are structured data
- accessory application context stored as arbitrary text
- duplicated material aggregation logic across many export scripts
- repeated N+1 data retrieval inside exports and dashboards
- template logic doing service-layer work
- unmanaged image storage tied to ad hoc static asset paths

## Resolved implementation directions

These decisions are now assumed for the rebuild unless explicitly revisited:

1. Project instances should remain snapshots by default, but there should be an
   explicit refresh/sync-from-catalog capability.
2. An accessory linked to multiple items should be modeled as many accessory
   occurrences, one per attachment/application.
3. Project-template records (`Proyecto Tipo`) should remain in the same project
   table/model as execution projects, because they are the same core concept at
   different lifecycle stages.
4. Task-association features are not required in the rebuilt product and should
   not shape the initial domain model.
5. Authentication should move to company identity / SSO.
6. Export generation should use a hybrid model: synchronous for smaller/faster
   outputs and queued for larger/heavier ones.
7. Instance images should live in a managed `media_gallery/` folder inside the
   repo/workspace, with the database storing URI/path references and the app
   enforcing a no-orphans media lifecycle.

## Suggested rebuild sequence

1. Lock the domain model and behavioral contracts in this document.
2. Design the PostgreSQL schema from the domain model, not from the SQLite
   tables. Use Alembic.
3. Stand up typed backend APIs for:
   - catalog
   - project composition
   - BOM
   - comments
   - logs
   - exports
   - dashboard
   - ERP integration
4. Build the React/TypeScript project workspace first, because it is the core
   daily-use surface.
5. Rebuild exports against the new domain services, not against template logic.
6. Rebuild the material dashboard against explicit material snapshot endpoints.
7. Migrate data from SQLite to PostgreSQL with validation around:
   - category hierarchy
   - instance snapshots
   - BOM rows
   - subtype breakdowns
   - comments
   - audit history
8. Run side-by-side output comparisons for representative projects.

## Acceptance criteria for the rebuild

The refactor should be considered successful only if all of the following are
true:

- users can manage the reusable catalog without losing material-rule behavior
- users can compose projects from catalog templates
- users can assign and use project subtypes
- linked accessory workflows still work
- applicable materials resolve correctly from instance attributes
- blank vs zero quantity semantics are preserved
- exports match the intent of current commercial/full/material outputs
- auxiliary materials still participate in project outputs and cost models
- comments, mentions, and notifications still work
- audit history remains meaningful
- the material dashboard still answers procurement questions correctly
- the system runs on PostgreSQL with a React/TypeScript frontend

## Final note

If there is ever a conflict between:

- preserving a legacy table shape, and
- preserving the product behavior more cleanly

choose the cleaner model and preserve the behavior.

This project should be recreated from its domain logic and UX intent, not from
its current implementation shortcuts.









