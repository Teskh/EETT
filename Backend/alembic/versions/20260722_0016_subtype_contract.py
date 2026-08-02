"""Add explicit project subtype kinds.

Revision ID: 20260722_0016
Revises: 20260717_0015
Create Date: 2026-07-22
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260722_0016"
down_revision = "20260717_0015"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "project_subtypes",
        sa.Column("kind", sa.String(length=20), nullable=False, server_default="variant"),
    )
    op.create_check_constraint(
        "ck_project_subtypes_kind",
        "project_subtypes",
        "kind IN ('group', 'variant')",
    )
    op.execute(
        sa.text(
            "CREATE UNIQUE INDEX uq_project_subtypes_sibling_name "
            "ON project_subtypes (project_id, COALESCE(parent_id, 0), lower(name))"
        )
    )
    op.add_column(
        "project_bom_entries",
        sa.Column("inheritance_mode", sa.String(length=20), nullable=False, server_default="override"),
    )
    op.create_check_constraint(
        "ck_project_bom_entries_inheritance_mode",
        "project_bom_entries",
        "inheritance_mode IN ('override', 'add')",
    )
    op.add_column(
        "project_material_calculation_sheets",
        sa.Column(
            "subtype_id",
            sa.Integer(),
            sa.ForeignKey("project_subtypes.id", ondelete="CASCADE"),
            nullable=True,
        ),
    )
    op.drop_constraint(
        "project_material_calculation__project_id_instance_id_materi_key",
        "project_material_calculation_sheets",
        type_="unique",
    )
    op.create_index(
        "uq_project_material_calculation_sheets_general",
        "project_material_calculation_sheets",
        ["project_id", "instance_id", "material_id"],
        unique=True,
        postgresql_where=sa.text("subtype_id IS NULL"),
    )
    op.create_index(
        "uq_project_material_calculation_sheets_subtype",
        "project_material_calculation_sheets",
        ["project_id", "instance_id", "material_id", "subtype_id"],
        unique=True,
        postgresql_where=sa.text("subtype_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index(
        "uq_project_material_calculation_sheets_subtype",
        table_name="project_material_calculation_sheets",
    )
    op.drop_index(
        "uq_project_material_calculation_sheets_general",
        table_name="project_material_calculation_sheets",
    )
    op.create_unique_constraint(
        "project_material_calculation__project_id_instance_id_materi_key",
        "project_material_calculation_sheets",
        ["project_id", "instance_id", "material_id"],
    )
    op.drop_column("project_material_calculation_sheets", "subtype_id")
    op.drop_constraint(
        "ck_project_bom_entries_inheritance_mode",
        "project_bom_entries",
        type_="check",
    )
    op.drop_column("project_bom_entries", "inheritance_mode")
    op.drop_index("uq_project_subtypes_sibling_name", table_name="project_subtypes")
    op.drop_constraint("ck_project_subtypes_kind", "project_subtypes", type_="check")
    op.drop_column("project_subtypes", "kind")
