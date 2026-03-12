"""Attach BOM rows to explicit material rule occurrences.

Revision ID: 20260312_0005
Revises: 20260312_0004
Create Date: 2026-03-12 18:00:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "20260312_0005"
down_revision = "20260312_0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("project_bom_entries", sa.Column("material_rule_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_project_bom_entries_material_rule_id",
        "project_bom_entries",
        "component_material_rules",
        ["material_rule_id"],
        ["id"],
        ondelete="CASCADE",
    )

    op.execute(
        """
        UPDATE project_bom_entries AS bom
        SET material_rule_id = mapping.rule_id
        FROM (
            SELECT bom_inner.id AS bom_id, MIN(rule.id) AS rule_id
            FROM project_bom_entries AS bom_inner
            JOIN project_instances AS instance ON instance.id = bom_inner.instance_id
            JOIN component_material_rules AS rule
              ON rule.component_id = instance.component_id
             AND rule.material_id = bom_inner.material_id
            GROUP BY bom_inner.id
        ) AS mapping
        WHERE bom.id = mapping.bom_id
        """
    )

    op.alter_column("project_bom_entries", "material_rule_id", nullable=False)

    op.drop_index("uq_project_bom_entries_general", table_name="project_bom_entries")
    op.drop_index("uq_project_bom_entries_subtype", table_name="project_bom_entries")
    op.create_index(
        "uq_project_bom_entries_general",
        "project_bom_entries",
        ["project_id", "instance_id", "material_rule_id"],
        unique=True,
        postgresql_where=sa.text("subtype_id IS NULL"),
    )
    op.create_index(
        "uq_project_bom_entries_subtype",
        "project_bom_entries",
        ["project_id", "instance_id", "material_rule_id", "subtype_id"],
        unique=True,
        postgresql_where=sa.text("subtype_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_project_bom_entries_subtype", table_name="project_bom_entries")
    op.drop_index("uq_project_bom_entries_general", table_name="project_bom_entries")
    op.create_index(
        "uq_project_bom_entries_general",
        "project_bom_entries",
        ["project_id", "instance_id", "material_id"],
        unique=True,
        postgresql_where=sa.text("subtype_id IS NULL"),
    )
    op.create_index(
        "uq_project_bom_entries_subtype",
        "project_bom_entries",
        ["project_id", "instance_id", "material_id", "subtype_id"],
        unique=True,
        postgresql_where=sa.text("subtype_id IS NOT NULL"),
    )
    op.drop_constraint("fk_project_bom_entries_material_rule_id", "project_bom_entries", type_="foreignkey")
    op.drop_column("project_bom_entries", "material_rule_id")
