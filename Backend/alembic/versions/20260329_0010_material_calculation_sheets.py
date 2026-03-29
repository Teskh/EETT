"""Add sparse material calculation sheet storage.

Revision ID: 20260329_0010
Revises: 20260318_0009
Create Date: 2026-03-29 10:00:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260329_0010"
down_revision = "20260318_0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "project_material_calculation_sheets",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("project_id", sa.Integer(), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("instance_id", sa.Integer(), sa.ForeignKey("project_instances.id", ondelete="CASCADE"), nullable=False),
        sa.Column("material_id", sa.Integer(), sa.ForeignKey("materials.id", ondelete="CASCADE"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("project_id", "instance_id", "material_id"),
    )
    op.create_table(
        "project_material_calculation_cells",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "sheet_id",
            sa.Integer(),
            sa.ForeignKey("project_material_calculation_sheets.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("row_index", sa.Integer(), nullable=False),
        sa.Column("column_index", sa.Integer(), nullable=False),
        sa.Column("raw_input", sa.Text(), nullable=False),
        sa.UniqueConstraint("sheet_id", "row_index", "column_index"),
    )


def downgrade() -> None:
    op.drop_table("project_material_calculation_cells")
    op.drop_table("project_material_calculation_sheets")
