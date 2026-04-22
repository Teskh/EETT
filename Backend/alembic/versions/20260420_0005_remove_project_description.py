"""Remove project description column.

Revision ID: 20260420_0005
Revises: 20260418_0004
Create Date: 2026-04-20 12:00:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260420_0005"
down_revision = "20260418_0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_column("projects", "description")


def downgrade() -> None:
    op.add_column("projects", sa.Column("description", sa.Text(), nullable=True))
