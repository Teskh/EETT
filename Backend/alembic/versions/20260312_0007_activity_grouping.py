"""Add activity grouping metadata for project audit history.

Revision ID: 20260312_0007
Revises: 20260312_0006
Create Date: 2026-03-12 11:30:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260312_0007"
down_revision = "20260312_0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "project_activity_groups",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("project_id", sa.Integer(), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("actor_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("mutation_batch_id", sa.String(length=80), nullable=True),
        sa.Column("title", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("scope_type", sa.String(length=80), nullable=True),
        sa.Column("scope_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_project_activity_groups_project_created",
        "project_activity_groups",
        ["project_id", "created_at"],
    )
    op.create_index(
        "ix_project_activity_groups_project_actor_batch",
        "project_activity_groups",
        ["project_id", "actor_user_id", "mutation_batch_id"],
    )

    op.add_column("project_activity_logs", sa.Column("group_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_project_activity_logs_group_id",
        "project_activity_logs",
        "project_activity_groups",
        ["group_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_project_activity_logs_group_id", "project_activity_logs", ["group_id"])

    op.add_column("project_approvals", sa.Column("activity_group_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_project_approvals_activity_group_id",
        "project_approvals",
        "project_activity_groups",
        ["activity_group_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_project_approvals_activity_group_id", "project_approvals", ["activity_group_id"])


def downgrade() -> None:
    op.drop_index("ix_project_approvals_activity_group_id", table_name="project_approvals")
    op.drop_constraint("fk_project_approvals_activity_group_id", "project_approvals", type_="foreignkey")
    op.drop_column("project_approvals", "activity_group_id")

    op.drop_index("ix_project_activity_logs_group_id", table_name="project_activity_logs")
    op.drop_constraint("fk_project_activity_logs_group_id", "project_activity_logs", type_="foreignkey")
    op.drop_column("project_activity_logs", "group_id")

    op.drop_index("ix_project_activity_groups_project_actor_batch", table_name="project_activity_groups")
    op.drop_index("ix_project_activity_groups_project_created", table_name="project_activity_groups")
    op.drop_table("project_activity_groups")
