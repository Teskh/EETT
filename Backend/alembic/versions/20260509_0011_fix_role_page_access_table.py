"""Ensure role page access table exists.

Revision ID: 20260509_0011
Revises: 20260509_0010
Create Date: 2026-05-09
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260509_0011"
down_revision = "20260509_0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    table_names = set(inspector.get_table_names())

    if "role_page_access" not in table_names:
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

    if "user_page_access" in table_names:
        op.drop_table("user_page_access")


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    table_names = set(inspector.get_table_names())
    if "role_page_access" in table_names:
        indexes = {index["name"] for index in inspector.get_indexes("role_page_access")}
        if "ix_role_page_access_role" in indexes:
            op.drop_index("ix_role_page_access_role", table_name="role_page_access")
        op.drop_table("role_page_access")
