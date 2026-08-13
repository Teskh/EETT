"""Map individual Production II houses.

Revision ID: 20260813_0017
Revises: 20260722_0016
Create Date: 2026-08-13
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260813_0017"
down_revision = "20260722_0016"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "production_house_links",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("production_work_order_id", sa.Integer(), nullable=False),
        sa.Column("production_project_name", sa.String(length=200), nullable=False, server_default=""),
        sa.Column("house_identifier", sa.String(length=200), nullable=True),
        sa.Column("production_house_type_id", sa.Integer(), nullable=False),
        sa.Column("production_house_type_name", sa.String(length=200), nullable=False, server_default=""),
        sa.Column("production_sub_type_id", sa.Integer(), nullable=True),
        sa.Column("production_sub_type_name", sa.String(length=200), nullable=True),
        sa.Column("planned_start_date", sa.Date(), nullable=True),
        sa.Column("planned_sequence", sa.Integer(), nullable=True),
        sa.Column("start_date", sa.Date(), nullable=True),
        sa.Column("project_id", sa.Integer(), sa.ForeignKey("projects.id", ondelete="SET NULL"), nullable=True),
        sa.Column(
            "project_subtype_id",
            sa.Integer(),
            sa.ForeignKey("project_subtypes.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("mapping_source", sa.String(length=20), nullable=True),
        sa.Column(
            "updated_by_user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("first_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "mapping_source IS NULL OR mapping_source IN ('manual', 'automatic', 'legacy')",
            name="ck_production_house_links_mapping_source",
        ),
        sa.UniqueConstraint("production_work_order_id", name="uq_production_house_links_work_order"),
    )
    op.create_index(
        "ix_production_house_links_house_type",
        "production_house_links",
        ["production_house_type_id"],
    )
    op.create_index(
        "ix_production_house_links_lifecycle",
        "production_house_links",
        ["start_date", "planned_start_date"],
    )
    op.create_index(
        "ix_production_house_links_project",
        "production_house_links",
        ["project_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_production_house_links_project", table_name="production_house_links")
    op.drop_index("ix_production_house_links_lifecycle", table_name="production_house_links")
    op.drop_index("ix_production_house_links_house_type", table_name="production_house_links")
    op.drop_table("production_house_links")
