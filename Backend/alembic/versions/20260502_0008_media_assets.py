"""Add managed media assets.

Revision ID: 20260502_0008
Revises: 20260424_0007
Create Date: 2026-05-02
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260502_0008"
down_revision = "20260424_0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "media_assets",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("kind", sa.String(length=40), nullable=False, server_default="image"),
        sa.Column("storage_key", sa.String(length=255), nullable=False),
        sa.Column("uri", sa.String(length=255), nullable=False),
        sa.Column("original_filename", sa.String(length=255), nullable=True),
        sa.Column("content_type", sa.String(length=120), nullable=False),
        sa.Column("byte_size", sa.Integer(), nullable=False),
        sa.Column("sha256", sa.String(length=64), nullable=False),
        sa.Column("width", sa.Integer(), nullable=True),
        sa.Column("height", sa.Integer(), nullable=True),
        sa.Column("created_by_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("storage_key"),
        sa.UniqueConstraint("uri"),
        sa.UniqueConstraint("sha256"),
    )
    op.create_index("ix_media_assets_kind_deleted", "media_assets", ["kind", "deleted_at"])

    op.create_table(
        "catalog_component_media",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("component_id", sa.Integer(), sa.ForeignKey("catalog_components.id", ondelete="CASCADE"), nullable=False),
        sa.Column("media_asset_id", sa.Integer(), sa.ForeignKey("media_assets.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("role", sa.String(length=40), nullable=False, server_default="primary"),
        sa.Column("caption", sa.String(length=255), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.UniqueConstraint("component_id", "media_asset_id", "role"),
    )
    op.create_index("ix_catalog_component_media_component", "catalog_component_media", ["component_id"])

    op.add_column("project_instance_media", sa.Column("media_asset_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_project_instance_media_asset",
        "project_instance_media",
        "media_assets",
        ["media_asset_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_index("ix_project_instance_media_asset", "project_instance_media", ["media_asset_id"])


def downgrade() -> None:
    op.drop_index("ix_project_instance_media_asset", table_name="project_instance_media")
    op.drop_constraint("fk_project_instance_media_asset", "project_instance_media", type_="foreignkey")
    op.drop_column("project_instance_media", "media_asset_id")
    op.drop_index("ix_catalog_component_media_component", table_name="catalog_component_media")
    op.drop_table("catalog_component_media")
    op.drop_index("ix_media_assets_kind_deleted", table_name="media_assets")
    op.drop_table("media_assets")
