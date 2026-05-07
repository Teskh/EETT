"""Remove component material rule notes.

Revision ID: 20260502_0009
Revises: 20260502_0008
Create Date: 2026-05-02
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260502_0009"
down_revision = "20260502_0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_column("component_material_rules", "notes")


def downgrade() -> None:
    op.add_column("component_material_rules", sa.Column("notes", sa.Text(), nullable=True))
