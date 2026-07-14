# Legacy SQLite Migration

This is a one-off replacement migration from the legacy `main.db` and
`projects.db` files into the PostgreSQL application database.

## Safety rules

- Keep untouched copies of both SQLite files and back up PostgreSQL before the
  committed replacement run.
- Run `alembic upgrade head` before the migration.
- The target must be empty unless `--replace-target` is supplied.
- Replacement, import, and validation run in one PostgreSQL transaction.
- Any error or failed validation rolls the entire database change back.
- `--dry-run` performs the complete import and validation, then rolls it back.
- Use the same SQLite files for the dry run and committed run; confirm their
  SHA-256 values match in both reports.
- Images are migrated as URI references only; no files are copied.

## Cleanup decisions

- Duplicate BOM rows are resolved exactly as the legacy editing screen resolves
  them: keep the lowest `bom_id` and ignore later duplicates.
- Blank quantities and zero quantities remain distinct.
- General and subtype BOM values are both retained. An explicit material
  occurrence setting records which set is active, so dormant values are not
  destroyed when modes change.
- Missing catalog records may produce placeholders. Missing or uncertain links,
  all duplicate decisions, and validation results are written to the report.

## Recommended run

First run the complete migration without committing:

```bash
PYTHONPATH=Backend Backend/venv/bin/python Backend/scripts/import_legacy_sqlite.py \
  --main-db Backend/scripts/main.db \
  --projects-db Backend/scripts/projects.db \
  --replace-target \
  --dry-run \
  --report-file /tmp/legacy_import_dry_run.txt
```

Review the report, then run the same command without `--dry-run` and use a
permanent report path.

## Report contents

The text report contains:

- source file paths and SHA-256 hashes
- source SQLite integrity checks
- imported record counts
- duplicate BOM cleanup decisions
- missing templates, materials, links, and other warnings
- source-to-target reconciliation checks
- blank/zero quantity checks
- unit, automatic-calculation, comment-deletion, and material-mode checks
- final committed, rolled-back, or failed status

Keep the successful report with the migration backup. No permanent legacy IDs
or legacy mapping tables are added to the application schema.
