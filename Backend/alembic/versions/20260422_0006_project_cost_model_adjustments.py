"""Introduce project cost model adjustments.

Revision ID: 20260422_0006
Revises: 20260420_0005
Create Date: 2026-04-22 12:00:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260422_0006"
down_revision = "20260420_0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "project_cost_model_adjustments",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("project_id", sa.Integer(), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("material_id", sa.Integer(), sa.ForeignKey("materials.id", ondelete="CASCADE"), nullable=False),
        sa.Column(
            "subtype_id",
            sa.Integer(),
            sa.ForeignKey("project_subtypes.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("adjusted_quantity", sa.Float(), nullable=False),
        sa.Column("source_kind", sa.String(length=40), nullable=False, server_default="manual"),
        sa.Column("source_note", sa.Text(), nullable=True),
        sa.Column("source_house_type_id", sa.Integer(), nullable=True),
        sa.Column("source_range_start", sa.Date(), nullable=True),
        sa.Column("source_range_end", sa.Date(), nullable=True),
        sa.Column("source_sample_houses", sa.Integer(), nullable=True),
        sa.Column("source_total_consumption", sa.Float(), nullable=True),
        sa.Column(
            "created_by_user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "uq_project_cost_model_adjustments_general",
        "project_cost_model_adjustments",
        ["project_id", "material_id"],
        unique=True,
        postgresql_where=sa.text("subtype_id IS NULL"),
    )
    op.create_index(
        "uq_project_cost_model_adjustments_subtype",
        "project_cost_model_adjustments",
        ["project_id", "material_id", "subtype_id"],
        unique=True,
        postgresql_where=sa.text("subtype_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_project_cost_model_adjustments_subtype", table_name="project_cost_model_adjustments")
    op.drop_index("uq_project_cost_model_adjustments_general", table_name="project_cost_model_adjustments")
    op.drop_table("project_cost_model_adjustments")
