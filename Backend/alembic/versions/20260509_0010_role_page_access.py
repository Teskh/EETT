"""Add per-role page access controls.

Revision ID: 20260509_0010
Revises: 20260502_0009
Create Date: 2026-05-09
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260509_0010"
down_revision = "20260502_0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "role_page_access",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("role_id", sa.Integer(), sa.ForeignKey("roles.id", ondelete="CASCADE"), nullable=False),
        sa.Column("page_key", sa.String(length=60), nullable=False),
        sa.Column("can_read", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("can_edit", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.UniqueConstraint("role_id", "page_key"),
    )
    op.create_index("ix_role_page_access_role", "role_page_access", ["role_id"])


def downgrade() -> None:
    op.drop_index("ix_role_page_access_role", table_name="role_page_access")
    op.drop_table("role_page_access")
