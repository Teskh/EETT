"""Add persisted cache entries for material dashboard responses.

Revision ID: 20260313_0008
Revises: 20260312_0007
Create Date: 2026-03-13 10:00:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260313_0008"
down_revision = "20260312_0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "material_dashboard_cache_entries",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("cache_kind", sa.String(length=32), nullable=False),
        sa.Column("cache_key", sa.String(length=255), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("refreshed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("cache_kind", "cache_key"),
    )
    op.create_index(
        "ix_material_dashboard_cache_entries_kind_expires",
        "material_dashboard_cache_entries",
        ["cache_kind", "expires_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_material_dashboard_cache_entries_kind_expires", table_name="material_dashboard_cache_entries")
    op.drop_table("material_dashboard_cache_entries")
