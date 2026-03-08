# Rebuild Contract

This backend must treat [REFACTOR_GUIDE.md](/mnt/c/Code/Spec%20Sheets/legacy_reference_docs/REFACTOR_GUIDE.md) as the product source of truth and the legacy app as the behavior reference. For every new feature or gap closure:

1. Read the named guide section first.
2. Use [LEGACY_REFERENCE_MAP.md](/mnt/c/Code/Spec%20Sheets/legacy_reference_docs/LEGACY_REFERENCE_MAP.md) to find the old implementation path.
3. Inspect [main.sql](/mnt/c/Code/Spec%20Sheets/legacy_reference_docs/main.sql) and [projects.sql](/mnt/c/Code/Spec%20Sheets/legacy_reference_docs/projects.sql) when schema or behavior detail is unclear.
4. Preserve the business semantics and workflow completeness, not the old dual-database design or hidden relationship encoding.

## Domain expectations

- Catalog: categories, linked categories, template attributes/options, material rules, and auxiliary materials must be at least as complete as the legacy app.
- Projects: lifecycle, subtype hierarchy, workspace composition, linked accessory applications, snapshot-by-default instances, and explicit refresh/sync must match or exceed legacy behavior.
- Materials/BOM: OR-across-groups and AND-within-group logic, blank-vs-zero quantity semantics, explainable auto-calculation, and project-vs-subtype material mode must be preserved.
- Collaboration/governance: comments, mentions, notifications, change log, and approvals are core features, not optional polish.
- Outputs: exports, export preferences, dashboard metrics, ERP cache data, and public read-only API are first-class product surfaces.

## Implementation defaults

- Backend remains Postgres-first and API-first.
- ERP access stays behind dedicated service methods and cache tables.
- Heavy exports and ERP refreshes should be modeled as jobs/services, not direct request-path work.
- No feature is complete until it satisfies the guide section and matches or exceeds the legacy workflow depth.
