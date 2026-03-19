"""Add persisted material study groups.

Revision ID: 20260318_0009
Revises: 20260313_0008
Create Date: 2026-03-18 12:00:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260318_0009"
down_revision = "20260313_0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "material_study_groups",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("study_unit", sa.String(length=50), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("name"),
    )
    op.create_table(
        "material_study_group_members",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("group_id", sa.Integer(), sa.ForeignKey("material_study_groups.id", ondelete="CASCADE"), nullable=False),
        sa.Column("sku", sa.String(length=80), nullable=False),
        sa.Column("material_name", sa.String(length=160), nullable=False),
        sa.Column("unit", sa.String(length=50), nullable=True),
        sa.Column("factor_to_study_unit", sa.Float(), nullable=False),
        sa.Column("display_order", sa.Integer(), nullable=False, server_default="0"),
        sa.UniqueConstraint("group_id", "sku"),
    )


def downgrade() -> None:
    op.drop_table("material_study_group_members")
    op.drop_table("material_study_groups")
