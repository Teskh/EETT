# Close the Rebuild Gaps

## Summary
Rebuild the remaining system in phases, using the current Postgres core as the base, but treating the legacy app as a behavior reference and [REFACTOR_GUIDE.md](/mnt/c/Code/Spec%20Sheets/legacy_reference_docs/REFACTOR_GUIDE.md) as the source of truth for product intent. For every feature below, the implementer must review the referenced guide sections first, then use [LEGACY_REFERENCE_MAP.md](/mnt/c/Code/Spec%20Sheets/legacy_reference_docs/LEGACY_REFERENCE_MAP.md) to locate the old implementation paths, and only then inspect legacy code if behavior is still unclear. Do not copy the old structure, dual-database split, or hidden/text-encoded relationships; preserve the workflow depth and business semantics.

## Current execution note
- The React + TypeScript frontend migration has started in `/mnt/c/Code/Spec Sheets/Frontend`.
- FastAPI now serves the built SPA from `Backend/app/static/app` for `/`, `/catalog`, `/projects`, and `/projects/{project_id}`.
- The previous FastAPI-rendered HTML remains only as a fallback while the SPA is being built out; new frontend work should go into the React app, not `Backend/app/ui.py`.

## Implementation Changes
### 1. Lock the domain contract before adding features
- Review guide sections `Product summary`, `Mental model to preserve`, `Legacy-to-new model mapping`, `Acceptance criteria for the rebuild`, and `Suggested rebuild sequence`.
- Produce a short internal spec for each domain below listing: preserved behaviors, intentional improvements, legacy anti-patterns to avoid, and acceptance criteria.
- Treat the current schema as provisional. Extend it where needed to satisfy the guide, not the current MVP UI.

### 2. Finish the data model and typed backend APIs
- Add identity/access tables and API enforcement for users, roles, memberships, and project/catalog permissions.
- Add missing collaboration/governance tables: threaded comments, mentions, notifications, change log, approvals.
- Add missing project-composition tables/fields: `project_material_modes`, sync/refresh metadata for project instances, richer project-instance link metadata if needed, managed instance media, per-instance export settings, export jobs/history, ERP cache tables, and public API projection support.
- Add explicit service-layer contracts for:
  - catalog admin
  - project lifecycle and subtype management
  - project workspace composition
  - collaboration/audit
  - exports
  - ERP/dashboard
  - public read-only API
- Build all APIs as typed, stable application contracts. Frontend code must consume these APIs, not reach into ORM/session logic.

Reference instructions for the implementer:
- Catalog/materials: read guide sections `Central catalog administration`, `Material applicability and BOM logic`, `Auxiliary materials`, plus [main.sql](/mnt/c/Code/Spec%20Sheets/legacy_reference_docs/main.sql).
- Projects/subtypes/workspace: read guide sections `Project list and lifecycle`, `Project subtypes`, `Project workspace`, `Project instances`, plus [projects.sql](/mnt/c/Code/Spec%20Sheets/legacy_reference_docs/projects.sql).
- Collaboration/exports/dashboard/API/auth: read the corresponding named sections in the guide first, then use [LEGACY_REFERENCE_MAP.md](/mnt/c/Code/Spec%20Sheets/legacy_reference_docs/LEGACY_REFERENCE_MAP.md) to find the old code paths.

### 3. Rebuild the frontend around the guide’s UX structure
- Replace the server-rendered HTML workflow with a React + TypeScript frontend as required by the guide.
- This migration is now in progress. Preserve the current visual language and workflow shape while moving interaction/state into React components backed by typed API calls.
- Do not add new product behavior to the legacy server-rendered UI except when a temporary fallback is strictly required to avoid breaking the app during the transition.
- Build the frontend in this order:
  1. project workspace shell
  2. catalog admin
  3. project list + settings/subtypes
  4. collaboration/audit views
  5. exports surfaces
  6. material dashboard
  7. ERP/admin tools
- The project workspace must preserve:
  - searchable category tree
  - sticky/global controls
  - subtype-aware material editing
  - linked-accessory workflows
  - auxiliary-material controls
  - clear snapshot-vs-refresh behavior
- Do not accept “basic CRUD” parity. Every screen must be checked against the guide and the legacy app to ensure the workflows are at least as complete as before.

Reference instructions for the implementer:
- Before building each screen, read the corresponding guide section and compare against the old screen/service behavior via [LEGACY_REFERENCE_MAP.md](/mnt/c/Code/Spec%20Sheets/legacy_reference_docs/LEGACY_REFERENCE_MAP.md).
- If the guide and legacy behavior differ, prefer the guide while preserving the old user outcome.

### 4. Close the business-critical behavior gaps
- Implement explicit snapshot refresh/sync flows for project instances, with no silent template rewrites.
- Implement material applicability exactly as described in the guide:
  - OR across rule groups
  - AND within a group
  - operators `=`, `>`, `<`, `IN`, `BETWEEN`, `IS NOT NULL`
- Implement BOM semantics exactly:
  - blank quantity distinct from zero
  - manual override + auto-calculation metadata
  - project-wide vs per-subtype material mode without data loss
  - explainable formula/results in the UI and API
- Implement accessory application as explicit occurrence/link records, never hidden text fields.
- Implement comments, mentions, notifications, and change-log filtering behavior with project/context deep links.
- Implement export contracts as first-class features:
  - commercial PDF
  - full technical PDF
  - total materials PDF
  - by-context/material breakdown PDF
  - detailed material PDF
  - assembly-kit PDF
  - materials Excel
  - cost-model Excel
- Implement the material dashboard on top of explicit BOM snapshots plus separate ERP cache data, not direct transactional joins to operational ERP reads.
- Implement the documented public read-only API and version it from the start.

Reference instructions for the implementer:
- For each of the above, review the exact named section in [REFACTOR_GUIDE.md](/mnt/c/Code/Spec%20Sheets/legacy_reference_docs/REFACTOR_GUIDE.md) before touching code.
- Then inspect the matching legacy schema area in [main.sql](/mnt/c/Code/Spec%20Sheets/legacy_reference_docs/main.sql) or [projects.sql](/mnt/c/Code/Spec%20Sheets/legacy_reference_docs/projects.sql), and use [LEGACY_REFERENCE_MAP.md](/mnt/c/Code/Spec%20Sheets/legacy_reference_docs/LEGACY_REFERENCE_MAP.md) to locate the old behavior/UI/export implementation.
- Add a short implementation note in code review or PR description stating which guide section and which legacy area were checked.

### 5. Ship in controlled milestones
- Milestone 1: domain completion
  - finalize missing schema
  - add migrations
  - add typed API contracts
  - add auth/roles enforcement
- Milestone 2: core workflow parity
  - catalog admin parity
  - project list/lifecycle parity
  - subtype editor parity
  - project workspace parity
  - snapshot refresh flows
  - BOM/material mode parity
- Milestone 3: collaboration and governance
  - comments/mentions/notifications
  - change log
  - approvals
- Milestone 4: outputs
  - all export types
  - per-instance export settings
  - job handling for heavy exports
- Milestone 5: operational layer
  - material dashboard
  - ERP cache/integration services
  - public read-only API
- Each milestone must end with side-by-side behavior checks against representative legacy scenarios before moving on.

## Public APIs / Interfaces / Types
- Define typed API schemas for:
  - auth/session/user permissions
  - catalog categories/components/attributes/material rules/auxiliary materials
  - projects, statuses, subtypes, instances, instance links, sync state
  - BOM rows, material mode, quantity state, calculation provenance
  - comments, mentions, notifications
  - change-log and approvals
  - export settings, export jobs, export artifacts
  - dashboard material snapshots and ERP-enriched metrics
  - public read-only project/material endpoints
- Keep ERP/cache DTOs separate from core project/catalog DTOs.
- Version the public API from the first release that exposes it externally.

## Test Plan
- Schema/migration tests:
  - migration from empty Postgres to full schema
  - enum/index/constraint coverage
  - cascade/deletion behavior for project/subtype/comment/link trees
- Domain/service tests:
  - material rule evaluation across all operators and group semantics
  - blank vs zero BOM semantics
  - project-wide vs per-subtype material mode transitions without data loss
  - snapshot creation, drift detection, refresh, and merge/override behavior
  - linked-accessory multi-occurrence behavior
  - permission enforcement by role
- API tests:
  - typed response contracts
  - authorization boundaries
  - public API versioning and read-only guarantees
- UI acceptance tests:
  - catalog admin workflows
  - project lifecycle workflows
  - subtype editing and deletion constraints
  - project workspace composition/editing
  - comments/mentions notifications
  - export initiation and result retrieval
  - dashboard drill-in flows
- Regression/reference checks:
  - pick representative legacy projects and compare outputs/workflows side-by-side
  - verify each milestone against the guide’s acceptance criteria before release

## Assumptions and Defaults
- Source of truth priority is: guide intent first, legacy behavior second, current MVP third.
- The rebuild remains Postgres-first, FastAPI backend, React + TypeScript frontend, with ERP isolated behind a dedicated service layer.
- Frontend source of truth is now the React app in `Frontend/`; FastAPI HTML renderers are transitional fallback code only.
- Heavy exports and ERP refreshes run as application services/jobs, not in blocking request paths.
- Legacy UX gaps may be improved, but only after the legacy behavior depth is matched or exceeded.
- No feature is considered complete until both are true:
  - it satisfies the named guide section
  - it is at least as functionally complete as the legacy implementation for the same workflow
