"""Add explicit linked-accessory occurrence tables.

Revision ID: 20260310_0003
Revises: 20260308_0002
Create Date: 2026-03-10 10:00:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260310_0003"
down_revision = "20260308_0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "project_instance_occurrences",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("source_instance_id", sa.Integer(), sa.ForeignKey("project_instances.id", ondelete="CASCADE"), nullable=False),
        sa.Column("relationship_type", sa.String(length=60), nullable=False, server_default="applied_to"),
        sa.Column("context_label", sa.String(length=160), nullable=True),
        sa.Column("context_notes", sa.Text(), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
    )
    op.create_index(
        "ix_project_instance_occurrences_source_sort",
        "project_instance_occurrences",
        ["source_instance_id", "sort_order"],
    )

    op.create_table(
        "project_instance_occurrence_targets",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("occurrence_id", sa.Integer(), sa.ForeignKey("project_instance_occurrences.id", ondelete="CASCADE"), nullable=False),
        sa.Column("target_instance_id", sa.Integer(), sa.ForeignKey("project_instances.id", ondelete="CASCADE"), nullable=False),
        sa.Column("role_label", sa.String(length=120), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
    )
    op.create_index(
        "ix_project_instance_occurrence_targets_occurrence",
        "project_instance_occurrence_targets",
        ["occurrence_id", "sort_order"],
    )
    op.create_index(
        "ix_project_instance_occurrence_targets_target",
        "project_instance_occurrence_targets",
        ["target_instance_id"],
    )

    op.create_table(
        "project_instance_occurrence_attribute_values",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("occurrence_id", sa.Integer(), sa.ForeignKey("project_instance_occurrences.id", ondelete="CASCADE"), nullable=False),
        sa.Column("attribute_name", sa.String(length=100), nullable=False),
        sa.Column("value", sa.String(length=160), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
    )
    op.create_index(
        "ix_project_instance_occurrence_attributes_occurrence",
        "project_instance_occurrence_attribute_values",
        ["occurrence_id", "sort_order"],
    )


def downgrade() -> None:
    op.drop_index("ix_project_instance_occurrence_attributes_occurrence", table_name="project_instance_occurrence_attribute_values")
    op.drop_table("project_instance_occurrence_attribute_values")
    op.drop_index("ix_project_instance_occurrence_targets_target", table_name="project_instance_occurrence_targets")
    op.drop_index("ix_project_instance_occurrence_targets_occurrence", table_name="project_instance_occurrence_targets")
    op.drop_table("project_instance_occurrence_targets")
    op.drop_index("ix_project_instance_occurrences_source_sort", table_name="project_instance_occurrences")
    op.drop_table("project_instance_occurrences")
