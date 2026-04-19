"""Add stored catalog snapshots for project instance sync state.

Revision ID: 20260418_0004
Revises: 20260310_0003
Create Date: 2026-04-18 12:00:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260418_0004"
down_revision = "20260329_0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("project_instance_sync_states", sa.Column("source_snapshot", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("project_instance_sync_states", "source_snapshot")
