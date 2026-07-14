"""Preserve the active mode of each project material occurrence.

Revision ID: 20260713_0014
Revises: 20260702_0013
Create Date: 2026-07-13 12:00:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "20260713_0014"
down_revision = "20260702_0013"
branch_labels = None
depends_on = None


material_mode = postgresql.ENUM("general", "per_subtype", name="material_mode", create_type=False)


def upgrade() -> None:
    op.create_table(
        "project_material_occurrence_modes",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("project_id", sa.Integer(), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column(
            "instance_id",
            sa.Integer(),
            sa.ForeignKey("project_instances.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "material_rule_id",
            sa.Integer(),
            sa.ForeignKey("component_material_rules.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("material_id", sa.Integer(), sa.ForeignKey("materials.id", ondelete="CASCADE"), nullable=False),
        sa.Column("mode", material_mode, nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "uq_project_material_occurrence_modes_rule",
        "project_material_occurrence_modes",
        ["project_id", "instance_id", "material_rule_id"],
        unique=True,
        postgresql_where=sa.text("material_rule_id IS NOT NULL"),
    )
    op.create_index(
        "uq_project_material_occurrence_modes_manual",
        "project_material_occurrence_modes",
        ["project_id", "instance_id", "material_id"],
        unique=True,
        postgresql_where=sa.text("material_rule_id IS NULL"),
    )


def downgrade() -> None:
    op.drop_index(
        "uq_project_material_occurrence_modes_manual",
        table_name="project_material_occurrence_modes",
    )
    op.drop_index(
        "uq_project_material_occurrence_modes_rule",
        table_name="project_material_occurrence_modes",
    )
    op.drop_table("project_material_occurrence_modes")
