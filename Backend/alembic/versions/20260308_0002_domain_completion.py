"""Add identity, collaboration, export, sync, and ERP domain tables.

Revision ID: 20260308_0002
Revises: 20260307_0001
Create Date: 2026-03-08 12:00:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "20260308_0002"
down_revision = "20260307_0001"
branch_labels = None
depends_on = None


membership_role = postgresql.ENUM("admin", "editor", "viewer", name="membership_role", create_type=False)
sync_status = postgresql.ENUM("up_to_date", "out_of_sync", "customized", name="sync_status", create_type=False)
material_mode = postgresql.ENUM("general", "per_subtype", name="material_mode", create_type=False)
notification_type = postgresql.ENUM(
    "comment_mention",
    "comment_reply",
    "approval_request",
    name="notification_type",
    create_type=False,
)
approval_status = postgresql.ENUM("pending", "approved", "rejected", name="approval_status", create_type=False)
export_kind = postgresql.ENUM(
    "commercial_pdf",
    "full_technical_pdf",
    "total_materials_pdf",
    "context_materials_pdf",
    "detailed_material_pdf",
    "assembly_kit_pdf",
    "materials_workbook",
    "cost_model_workbook",
    name="export_kind",
    create_type=False,
)
export_status = postgresql.ENUM("pending", "completed", "failed", name="export_status", create_type=False)


def upgrade() -> None:
    bind = op.get_bind()
    membership_role.create(bind, checkfirst=True)
    sync_status.create(bind, checkfirst=True)
    material_mode.create(bind, checkfirst=True)
    notification_type.create(bind, checkfirst=True)
    approval_status.create(bind, checkfirst=True)
    export_kind.create(bind, checkfirst=True)
    export_status.create(bind, checkfirst=True)

    op.add_column(
        "catalog_components",
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
    )

    op.add_column(
        "project_instance_links",
        sa.Column("application_label", sa.String(length=120), nullable=False, server_default=""),
    )
    op.add_column(
        "project_instance_links",
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
    )
    op.drop_constraint("project_instance_links_parent_instance_id_child_instance_id_key", "project_instance_links", type_="unique")
    op.create_unique_constraint(
        "uq_project_instance_link_occurrence",
        "project_instance_links",
        ["parent_instance_id", "child_instance_id", "relationship_type", "application_label"],
    )

    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("username", sa.String(length=80), nullable=False),
        sa.Column("display_name", sa.String(length=120), nullable=False),
        sa.Column("email", sa.String(length=160), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("username"),
        sa.UniqueConstraint("email"),
    )

    op.create_table(
        "roles",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("code", sa.String(length=40), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.UniqueConstraint("code"),
    )

    op.create_table(
        "user_roles",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("role_id", sa.Integer(), sa.ForeignKey("roles.id", ondelete="CASCADE"), nullable=False),
        sa.UniqueConstraint("user_id", "role_id"),
    )

    op.create_table(
        "project_memberships",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("project_id", sa.Integer(), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("role", membership_role, nullable=False),
        sa.UniqueConstraint("project_id", "user_id"),
    )

    op.create_table(
        "project_material_modes",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("project_id", sa.Integer(), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("mode", material_mode, nullable=False),
        sa.Column("changed_by_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("project_id"),
    )

    op.create_table(
        "project_instance_sync_states",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("instance_id", sa.Integer(), sa.ForeignKey("project_instances.id", ondelete="CASCADE"), nullable=False),
        sa.Column("sync_status", sync_status, nullable=False),
        sa.Column("last_synced_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("source_component_updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("sync_notes", sa.Text(), nullable=True),
        sa.UniqueConstraint("instance_id"),
    )

    op.create_table(
        "project_instance_media",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("instance_id", sa.Integer(), sa.ForeignKey("project_instances.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.String(length=40), nullable=False, server_default="image"),
        sa.Column("uri", sa.String(length=255), nullable=False),
        sa.Column("caption", sa.String(length=255), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
    )

    op.create_table(
        "project_comments",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("project_id", sa.Integer(), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("instance_id", sa.Integer(), sa.ForeignKey("project_instances.id", ondelete="CASCADE"), nullable=True),
        sa.Column("parent_comment_id", sa.Integer(), sa.ForeignKey("project_comments.id", ondelete="CASCADE"), nullable=True),
        sa.Column("author_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_project_comments_project", "project_comments", ["project_id"])
    op.create_index("ix_project_comments_instance", "project_comments", ["instance_id"])
    op.create_index("ix_project_comments_parent", "project_comments", ["parent_comment_id"])

    op.create_table(
        "comment_mentions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("comment_id", sa.Integer(), sa.ForeignKey("project_comments.id", ondelete="CASCADE"), nullable=False),
        sa.Column("mentioned_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.UniqueConstraint("comment_id", "mentioned_user_id"),
    )

    op.create_table(
        "comment_notifications",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("comment_id", sa.Integer(), sa.ForeignKey("project_comments.id", ondelete="CASCADE"), nullable=False),
        sa.Column("notification_type", notification_type, nullable=False),
        sa.Column("route", sa.String(length=255), nullable=False),
        sa.Column("is_read", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_comment_notifications_user_read", "comment_notifications", ["user_id", "is_read"])

    op.create_table(
        "project_activity_logs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("project_id", sa.Integer(), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("actor_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("entity_type", sa.String(length=60), nullable=False),
        sa.Column("entity_id", sa.Integer(), nullable=True),
        sa.Column("action", sa.String(length=60), nullable=False),
        sa.Column("details", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_project_activity_logs_project_created", "project_activity_logs", ["project_id", "created_at"])

    op.create_table(
        "project_approvals",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("project_id", sa.Integer(), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("requested_by_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("decided_by_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("status", approval_status, nullable=False),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_project_approvals_project", "project_approvals", ["project_id"])

    op.create_table(
        "instance_export_settings",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("project_id", sa.Integer(), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("instance_id", sa.Integer(), sa.ForeignKey("project_instances.id", ondelete="CASCADE"), nullable=False),
        sa.Column("target", sa.String(length=80), nullable=False),
        sa.Column("settings", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("project_id", "instance_id", "target"),
    )

    op.create_table(
        "project_export_jobs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("project_id", sa.Integer(), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("export_kind", export_kind, nullable=False),
        sa.Column("status", export_status, nullable=False),
        sa.Column("requested_by_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("payload", sa.JSON(), nullable=True),
        sa.Column("artifact_uri", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_project_export_jobs_project_status", "project_export_jobs", ["project_id", "status"])

    op.create_table(
        "erp_material_cache",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("material_id", sa.Integer(), sa.ForeignKey("materials.id", ondelete="SET NULL"), nullable=True),
        sa.Column("sku", sa.String(length=80), nullable=False),
        sa.Column("stock_on_hand", sa.Float(), nullable=True),
        sa.Column("pending_purchase_quantity", sa.Float(), nullable=True),
        sa.Column("average_price", sa.Float(), nullable=True),
        sa.Column("last_purchase_price", sa.Float(), nullable=True),
        sa.Column("average_lead_time_days", sa.Float(), nullable=True),
        sa.Column("recent_monthly_consumption", sa.Float(), nullable=True),
        sa.Column("refreshed_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("sku"),
    )


def downgrade() -> None:
    bind = op.get_bind()

    op.drop_table("erp_material_cache")
    op.drop_index("ix_project_export_jobs_project_status", table_name="project_export_jobs")
    op.drop_table("project_export_jobs")
    op.drop_table("instance_export_settings")
    op.drop_index("ix_project_approvals_project", table_name="project_approvals")
    op.drop_table("project_approvals")
    op.drop_index("ix_project_activity_logs_project_created", table_name="project_activity_logs")
    op.drop_table("project_activity_logs")
    op.drop_index("ix_comment_notifications_user_read", table_name="comment_notifications")
    op.drop_table("comment_notifications")
    op.drop_table("comment_mentions")
    op.drop_index("ix_project_comments_parent", table_name="project_comments")
    op.drop_index("ix_project_comments_instance", table_name="project_comments")
    op.drop_index("ix_project_comments_project", table_name="project_comments")
    op.drop_table("project_comments")
    op.drop_table("project_instance_media")
    op.drop_table("project_instance_sync_states")
    op.drop_table("project_material_modes")
    op.drop_table("project_memberships")
    op.drop_table("user_roles")
    op.drop_table("roles")
    op.drop_table("users")

    op.drop_constraint("uq_project_instance_link_occurrence", "project_instance_links", type_="unique")
    op.create_unique_constraint(
        "project_instance_links_parent_instance_id_child_instance_id_key",
        "project_instance_links",
        ["parent_instance_id", "child_instance_id"],
    )
    op.drop_column("project_instance_links", "sort_order")
    op.drop_column("project_instance_links", "application_label")
    op.drop_column("catalog_components", "updated_at")

    export_status.drop(bind, checkfirst=True)
    export_kind.drop(bind, checkfirst=True)
    approval_status.drop(bind, checkfirst=True)
    notification_type.drop(bind, checkfirst=True)
    material_mode.drop(bind, checkfirst=True)
    sync_status.drop(bind, checkfirst=True)
    membership_role.drop(bind, checkfirst=True)
