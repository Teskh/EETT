"""Cost model by quantity basis: factory (Q_fábrica), site (Q_obra) or both.

Each basis has its own cost center exclusions, adjustments and decisions on
materials outside the BOM. Existing rows are the factory basis.

Seeded exclusions, by area as in 0019:
- factory: unchanged.
- work: only site work (11 Obra) counts, so the factory areas (01 Preparación
  de materiales, 02 Paneles, 03 Armado, 04 Terminaciones, 13 Maestranza) are
  excluded too, besides everything the factory basis excludes.
- total: the factory basis without excluding 11 Obra.
"""

from datetime import datetime, timezone

from alembic import op
import sqlalchemy as sa

revision = "20260927_0021"
down_revision = "20260926_0020"
branch_labels = None
depends_on = None

FACTORY_AREAS = [
    ("01", "Preparación de materiales: fábrica."),
    ("02", "Paneles: fábrica."),
    ("03", "Armado: fábrica."),
    ("04", "Terminaciones: fábrica."),
    ("13", "Maestranza: fábrica."),
]


def upgrade() -> None:
    op.add_column("consumption_ceco_exclusions", sa.Column("basis", sa.String(10), nullable=False, server_default="factory"))
    op.drop_constraint("consumption_ceco_exclusions_rule_key", "consumption_ceco_exclusions", type_="unique")
    op.create_unique_constraint("uq_consumption_ceco_exclusions_basis_rule", "consumption_ceco_exclusions", ["basis", "rule"])

    bind = op.get_bind()
    factory = bind.execute(sa.text("SELECT rule, note FROM consumption_ceco_exclusions WHERE basis = 'factory' ORDER BY rule")).all()
    now = datetime.now(timezone.utc)
    table = sa.table(
        "consumption_ceco_exclusions",
        sa.column("basis", sa.String), sa.column("rule", sa.String), sa.column("note", sa.Text), sa.column("created_at", sa.DateTime(timezone=True)),
    )
    work = [(rule, note) for rule, note in factory if rule != "11"] + FACTORY_AREAS
    total = [(rule, note) for rule, note in factory if rule != "11"]
    op.bulk_insert(table, [{"basis": "work", "rule": rule, "note": note, "created_at": now} for rule, note in work]
                   + [{"basis": "total", "rule": rule, "note": note, "created_at": now} for rule, note in total])

    op.add_column("project_cost_model_adjustments", sa.Column("quantity_basis", sa.String(10), nullable=False, server_default="factory"))
    op.drop_index("uq_project_cost_model_adjustments_general", table_name="project_cost_model_adjustments")
    op.drop_index("uq_project_cost_model_adjustments_subtype", table_name="project_cost_model_adjustments")
    op.create_index(
        "uq_project_cost_model_adjustments_general", "project_cost_model_adjustments", ["project_id", "quantity_basis", "material_id"],
        unique=True, postgresql_where=sa.text("subtype_id IS NULL"),
    )
    op.create_index(
        "uq_project_cost_model_adjustments_subtype", "project_cost_model_adjustments", ["project_id", "quantity_basis", "material_id", "subtype_id"],
        unique=True, postgresql_where=sa.text("subtype_id IS NOT NULL"),
    )

    op.add_column("project_cost_model_extras", sa.Column("quantity_basis", sa.String(10), nullable=False, server_default="factory"))
    op.drop_constraint("project_cost_model_extras_project_id_sku_key", "project_cost_model_extras", type_="unique")
    op.create_unique_constraint("uq_project_cost_model_extras_basis_sku", "project_cost_model_extras", ["project_id", "quantity_basis", "sku"])


def downgrade() -> None:
    op.execute("DELETE FROM project_cost_model_extras WHERE quantity_basis <> 'factory'")
    op.drop_constraint("uq_project_cost_model_extras_basis_sku", "project_cost_model_extras", type_="unique")
    op.create_unique_constraint("project_cost_model_extras_project_id_sku_key", "project_cost_model_extras", ["project_id", "sku"])
    op.drop_column("project_cost_model_extras", "quantity_basis")

    op.execute("DELETE FROM project_cost_model_adjustments WHERE quantity_basis <> 'factory'")
    op.drop_index("uq_project_cost_model_adjustments_general", table_name="project_cost_model_adjustments")
    op.drop_index("uq_project_cost_model_adjustments_subtype", table_name="project_cost_model_adjustments")
    op.create_index(
        "uq_project_cost_model_adjustments_general", "project_cost_model_adjustments", ["project_id", "material_id"],
        unique=True, postgresql_where=sa.text("subtype_id IS NULL"),
    )
    op.create_index(
        "uq_project_cost_model_adjustments_subtype", "project_cost_model_adjustments", ["project_id", "material_id", "subtype_id"],
        unique=True, postgresql_where=sa.text("subtype_id IS NOT NULL"),
    )
    op.drop_column("project_cost_model_adjustments", "quantity_basis")

    op.execute("DELETE FROM consumption_ceco_exclusions WHERE basis <> 'factory'")
    op.drop_constraint("uq_consumption_ceco_exclusions_basis_rule", "consumption_ceco_exclusions", type_="unique")
    op.create_unique_constraint("consumption_ceco_exclusions_rule_key", "consumption_ceco_exclusions", ["rule"])
    op.drop_column("consumption_ceco_exclusions", "basis")
