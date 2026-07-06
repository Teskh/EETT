"""Introduce production house type links.

Revision ID: 20260702_0013
Revises: 20260611_0012
Create Date: 2026-07-02 12:00:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260702_0013"
down_revision = "20260611_0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "production_house_type_links",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("production_house_type_id", sa.Integer(), nullable=False),
        sa.Column("production_sub_type_id", sa.Integer(), nullable=True),
        sa.Column("production_house_type_name", sa.String(length=200), nullable=False, server_default=""),
        sa.Column("production_sub_type_name", sa.String(length=200), nullable=True),
        sa.Column("project_id", sa.Integer(), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column(
            "project_subtype_id",
            sa.Integer(),
            sa.ForeignKey("project_subtypes.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "updated_by_user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "uq_production_house_type_links_general",
        "production_house_type_links",
        ["production_house_type_id"],
        unique=True,
        postgresql_where=sa.text("production_sub_type_id IS NULL"),
    )
    op.create_index(
        "uq_production_house_type_links_subtype",
        "production_house_type_links",
        ["production_house_type_id", "production_sub_type_id"],
        unique=True,
        postgresql_where=sa.text("production_sub_type_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_production_house_type_links_subtype", table_name="production_house_type_links")
    op.drop_index("uq_production_house_type_links_general", table_name="production_house_type_links")
    op.drop_table("production_house_type_links")
