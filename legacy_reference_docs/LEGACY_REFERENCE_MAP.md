# Legacy Reference Map

Use this file during the rebuild when intended behavior is unclear.

## Original project path

`C:\Mess\CODE REPO\Testgrounds\2025.03.04 SPGXI`

This repo is the legacy behavior reference.
Use it to understand workflow intent, UX, and output contents.
Do not copy its implementation patterns blindly.

All file references below are repo-relative to that path.

## Start here

- `/REFACTOR_GUIDE.md`
  - behavior-first rebuild guide
- `/database_editor/app.py`
  - legacy app entrypoint and route wiring
- `/database_editor/main.sql`
  - legacy catalog schema
- `/projects/projects.sql`
  - legacy project/runtime schema

## Quick feature map

### Auth, roles, landing

- `/database_editor/login.py`
- `/database_editor/config.py`
- `/database_editor/database_editor_templates/landing.html`

### Central catalog

- `/database_editor/database_editor_templates/index.html`
- `/database_editor/categories.py`
- `/database_editor/items.py`
- `/database_editor/accessories.py`
- `/database_editor/materials.py`
- `/database_editor/auxiliary_materials.py`

### Projects and subtypes

- `/projects/projects_management.py`
- `/projects/projects.html`
- `/projects/edit_project.html`
- `/projects/copy_project.py`

### Project workspace UI

- `/projects/categories.html`
- `/projects/tables.html`
- `/projects/static/table_logic.js`
- `/projects/static/instance_edit_delete.js`
- `/projects/static/linked_accessories.js`

### Instance behavior and data loading

- `/projects/data_retrieval.py`
- `/projects/instances_management.py`
- `/projects/schema_utils.py`

### Material applicability and BOM

- `/projects/materials_logic.py`
- `/projects/bom_routes.py`
- `/projects/material_applicability.py`

### Comments and notifications

- `/projects/comments.py`
- `/projects/static/comments.js`

### Logs and approvals

- `/projects/logs.py`
- `/database_editor/database_editor_templates/logs.html`

### Exports

- `/projects/generate_project_pdf.py`
- `/projects/generate_material_pdf.py`
- `/projects/generate_detailed_material_pdf.py`
- `/projects/excel_export.py`
- `/projects/excel_cost_model.py`

### Material dashboard and ERP-backed behavior

- `/projects/material_dashboard.py`
- `/projects/material_dashboard_service.py`
- `/projects/material_dashboard.html`
- `/projects/static/material_dashboard.js`
- `/projects/erp_data.py`

### Public API and other integrations

- `/database_editor/external_api.py`
- `/database_editor/llm_assist.py`

## If the question is about...

- catalog/template editing:
  - open `/database_editor/main.sql`, `/database_editor/database_editor_templates/index.html`, and the relevant `/database_editor/*.py` module
- project/category/instance behavior:
  - open `/projects/categories.html`, `/projects/static/table_logic.js`, `/projects/data_retrieval.py`, and `/projects/instances_management.py`
- why a material appears:
  - open `/projects/materials_logic.py` and `/projects/bom_routes.py`
- subtype behavior:
  - open `/projects/edit_project.html`, `/projects/projects_management.py`, and `/projects/bom_routes.py`
- comments or mentions:
  - open `/projects/comments.py`
- exports:
  - open the relevant `/projects/generate_*` or `/projects/excel_*` file
- dashboard or ERP behavior:
  - open `/projects/material_dashboard.py`, `/projects/material_dashboard_service.py`, and `/projects/erp_data.py`

## Rule for rebuild developers

When unsure, check the legacy code to understand intended behavior.
Then implement that behavior in the new architecture without inheriting the
legacy storage hacks or frontend structure.
