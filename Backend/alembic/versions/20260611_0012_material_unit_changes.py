"""Track ERP unit changes for materials.

Revision ID: 20260611_0012
Revises: 20260509_0011
Create Date: 2026-06-11
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260611_0012"
down_revision = "20260509_0011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "material_unit_changes",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("material_id", sa.Integer(), sa.ForeignKey("materials.id", ondelete="CASCADE"), nullable=False),
        sa.Column("sku", sa.String(length=80), nullable=False),
        sa.Column("material_name", sa.String(length=160), nullable=False),
        sa.Column("old_unit", sa.String(length=50), nullable=True),
        sa.Column("new_unit", sa.String(length=50), nullable=True),
        sa.Column(
            "status",
            sa.Enum("pending", "resolved", name="material_unit_change_status"),
            nullable=False,
            server_default="pending",
        ),
        sa.Column("detected_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resolved_by_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("resolution_note", sa.String(length=200), nullable=True),
    )
    op.create_index("ix_material_unit_changes_status", "material_unit_changes", ["status"])


def downgrade() -> None:
    op.drop_index("ix_material_unit_changes_status", table_name="material_unit_changes")
    op.drop_table("material_unit_changes")
    sa.Enum(name="material_unit_change_status").drop(op.get_bind(), checkfirst=True)
