"""Initial unified catalog and project schema.

Revision ID: 20260307_0001
Revises:
Create Date: 2026-03-07 15:00:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = "20260307_0001"
down_revision = None
branch_labels = None
depends_on = None


category_scope = postgresql.ENUM("item", "accessory", "mixed", name="category_scope", create_type=False)
component_type = postgresql.ENUM("item", "accessory", name="component_type", create_type=False)
attribute_value_type = postgresql.ENUM("text", "number", "select", name="attribute_value_type", create_type=False)
project_status = postgresql.ENUM("template", "execution", "finished", name="project_status", create_type=False)
bom_calculation_mode = postgresql.ENUM("manual", "auto", name="bom_calculation_mode", create_type=False)


def upgrade() -> None:
    bind = op.get_bind()
    category_scope.create(bind, checkfirst=True)
    component_type.create(bind, checkfirst=True)
    attribute_value_type.create(bind, checkfirst=True)
    project_status.create(bind, checkfirst=True)
    bom_calculation_mode.create(bind, checkfirst=True)

    op.create_table(
        "catalog_categories",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("scope", category_scope, nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("parent_id", sa.Integer(), sa.ForeignKey("catalog_categories.id", ondelete="CASCADE"), nullable=True),
    )

    op.create_table(
        "materials",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("sku", sa.String(length=80), nullable=False),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("unit", sa.String(length=50), nullable=True),
        sa.UniqueConstraint("sku"),
    )

    op.create_table(
        "auxiliary_materials",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("code", sa.String(length=80), nullable=False),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("category", sa.String(length=100), nullable=True),
        sa.Column("price", sa.Float(), nullable=False),
        sa.UniqueConstraint("code"),
    )

    op.create_table(
        "projects",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("status", project_status, nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("name"),
    )

    op.create_table(
        "catalog_category_links",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("category_id", sa.Integer(), sa.ForeignKey("catalog_categories.id", ondelete="CASCADE"), nullable=False),
        sa.Column("linked_category_id", sa.Integer(), sa.ForeignKey("catalog_categories.id", ondelete="CASCADE"), nullable=False),
        sa.UniqueConstraint("category_id", "linked_category_id"),
    )

    op.create_table(
        "catalog_components",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("category_id", sa.Integer(), sa.ForeignKey("catalog_categories.id", ondelete="CASCADE"), nullable=False),
        sa.Column("component_type", component_type, nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("short_name", sa.String(length=120), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("short_description", sa.Text(), nullable=True),
        sa.Column("installation", sa.Text(), nullable=True),
        sa.Column("unit_type", sa.String(length=50), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )

    op.create_table(
        "catalog_attribute_definitions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("component_id", sa.Integer(), sa.ForeignKey("catalog_components.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("value_type", attribute_value_type, nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
    )

    op.create_table(
        "catalog_attribute_options",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("attribute_definition_id", sa.Integer(), sa.ForeignKey("catalog_attribute_definitions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("value", sa.String(length=100), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
    )

    op.create_table(
        "component_material_rules",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("component_id", sa.Integer(), sa.ForeignKey("catalog_components.id", ondelete="CASCADE"), nullable=False),
        sa.Column("material_id", sa.Integer(), sa.ForeignKey("materials.id", ondelete="CASCADE"), nullable=False),
        sa.Column("display_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("unit", sa.String(length=50), nullable=True),
        sa.Column("unit_qty_per_unit", sa.Float(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
    )

    op.create_table(
        "material_rule_groups",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("rule_id", sa.Integer(), sa.ForeignKey("component_material_rules.id", ondelete="CASCADE"), nullable=False),
        sa.Column("group_key", sa.String(length=60), nullable=False),
    )

    op.create_table(
        "material_rule_conditions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("group_id", sa.Integer(), sa.ForeignKey("material_rule_groups.id", ondelete="CASCADE"), nullable=False),
        sa.Column("attribute_name", sa.String(length=100), nullable=False),
        sa.Column("operator", sa.String(length=20), nullable=False),
        sa.Column("comparison_value", sa.String(length=120), nullable=True),
        sa.Column("comparison_value_secondary", sa.String(length=120), nullable=True),
    )

    op.create_table(
        "project_subtypes",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("project_id", sa.Integer(), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("parent_id", sa.Integer(), sa.ForeignKey("project_subtypes.id", ondelete="CASCADE"), nullable=True),
        sa.Column("name", sa.String(length=120), nullable=False),
    )

    op.create_table(
        "project_instances",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("project_id", sa.Integer(), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("component_id", sa.Integer(), sa.ForeignKey("catalog_components.id"), nullable=False),
        sa.Column("category_id", sa.Integer(), sa.ForeignKey("catalog_categories.id"), nullable=False),
        sa.Column("instance_type", component_type, nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("short_name", sa.String(length=120), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("short_description", sa.Text(), nullable=True),
        sa.Column("installation", sa.Text(), nullable=True),
        sa.Column("image_uri", sa.String(length=255), nullable=True),
        sa.Column("unit_amount", sa.Float(), nullable=True),
    )

    op.create_table(
        "project_instance_attribute_groups",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("instance_id", sa.Integer(), sa.ForeignKey("project_instances.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("application_label", sa.String(length=120), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
    )

    op.create_table(
        "project_instance_attribute_values",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("group_id", sa.Integer(), sa.ForeignKey("project_instance_attribute_groups.id", ondelete="CASCADE"), nullable=False),
        sa.Column("attribute_name", sa.String(length=100), nullable=False),
        sa.Column("value", sa.String(length=120), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
    )

    op.create_table(
        "project_instance_links",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("parent_instance_id", sa.Integer(), sa.ForeignKey("project_instances.id", ondelete="CASCADE"), nullable=False),
        sa.Column("child_instance_id", sa.Integer(), sa.ForeignKey("project_instances.id", ondelete="CASCADE"), nullable=False),
        sa.Column("relationship_type", sa.String(length=60), nullable=False, server_default="applied_accessory"),
        sa.UniqueConstraint("parent_instance_id", "child_instance_id"),
    )

    op.create_table(
        "project_bom_entries",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("project_id", sa.Integer(), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("instance_id", sa.Integer(), sa.ForeignKey("project_instances.id", ondelete="CASCADE"), nullable=False),
        sa.Column("material_id", sa.Integer(), sa.ForeignKey("materials.id"), nullable=False),
        sa.Column("subtype_id", sa.Integer(), sa.ForeignKey("project_subtypes.id", ondelete="CASCADE"), nullable=True),
        sa.Column("quantity", sa.Float(), nullable=True),
        sa.Column("assembly_quantity", sa.Float(), nullable=True),
        sa.Column("unit", sa.String(length=50), nullable=True),
        sa.Column("calculation_mode", bom_calculation_mode, nullable=False),
        sa.Column("calculation_formula", sa.String(length=160), nullable=True),
    )
    op.create_index(
        "uq_project_bom_entries_general",
        "project_bom_entries",
        ["project_id", "instance_id", "material_id"],
        unique=True,
        postgresql_where=sa.text("subtype_id IS NULL"),
    )
    op.create_index(
        "uq_project_bom_entries_subtype",
        "project_bom_entries",
        ["project_id", "instance_id", "material_id", "subtype_id"],
        unique=True,
        postgresql_where=sa.text("subtype_id IS NOT NULL"),
    )

    op.create_table(
        "project_auxiliary_material_selections",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("project_id", sa.Integer(), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("auxiliary_material_id", sa.Integer(), sa.ForeignKey("auxiliary_materials.id"), nullable=False),
        sa.Column("subtype_id", sa.Integer(), sa.ForeignKey("project_subtypes.id", ondelete="SET NULL"), nullable=True),
        sa.UniqueConstraint("project_id", "auxiliary_material_id"),
    )


def downgrade() -> None:
    bind = op.get_bind()

    op.drop_table("project_auxiliary_material_selections")
    op.drop_index("uq_project_bom_entries_subtype", table_name="project_bom_entries")
    op.drop_index("uq_project_bom_entries_general", table_name="project_bom_entries")
    op.drop_table("project_bom_entries")
    op.drop_table("project_instance_links")
    op.drop_table("project_instance_attribute_values")
    op.drop_table("project_instance_attribute_groups")
    op.drop_table("project_instances")
    op.drop_table("project_subtypes")
    op.drop_table("material_rule_conditions")
    op.drop_table("material_rule_groups")
    op.drop_table("component_material_rules")
    op.drop_table("catalog_attribute_options")
    op.drop_table("catalog_attribute_definitions")
    op.drop_table("catalog_components")
    op.drop_table("catalog_category_links")
    op.drop_table("projects")
    op.drop_table("auxiliary_materials")
    op.drop_table("materials")
    op.drop_table("catalog_categories")

    bom_calculation_mode.drop(bind, checkfirst=True)
    project_status.drop(bind, checkfirst=True)
    attribute_value_type.drop(bind, checkfirst=True)
    component_type.drop(bind, checkfirst=True)
    category_scope.drop(bind, checkfirst=True)
