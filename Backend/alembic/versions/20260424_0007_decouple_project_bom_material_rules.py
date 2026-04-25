"""Decouple project BOM rows from live catalog material rules.

Revision ID: 20260424_0007
Revises: 20260422_0006
Create Date: 2026-04-24 00:00:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "20260424_0007"
down_revision = "20260422_0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint("fk_project_bom_entries_material_rule_id", "project_bom_entries", type_="foreignkey")
    op.alter_column("project_bom_entries", "material_rule_id", nullable=True)
    op.create_index(
        "uq_project_bom_entries_manual_general",
        "project_bom_entries",
        ["project_id", "instance_id", "material_id"],
        unique=True,
        postgresql_where=sa.text("subtype_id IS NULL AND material_rule_id IS NULL"),
    )
    op.create_index(
        "uq_project_bom_entries_manual_subtype",
        "project_bom_entries",
        ["project_id", "instance_id", "material_id", "subtype_id"],
        unique=True,
        postgresql_where=sa.text("subtype_id IS NOT NULL AND material_rule_id IS NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_project_bom_entries_manual_subtype", table_name="project_bom_entries")
    op.drop_index("uq_project_bom_entries_manual_general", table_name="project_bom_entries")
    op.alter_column("project_bom_entries", "material_rule_id", nullable=False)
    op.create_foreign_key(
        "fk_project_bom_entries_material_rule_id",
        "project_bom_entries",
        "component_material_rules",
        ["material_rule_id"],
        ["id"],
        ondelete="CASCADE",
    )
