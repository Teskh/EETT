"""Historic consumption: cost center exclusions and budget lines outside the BOM.

Exclusions are seeded by topic (area), never by site: cost centers are often
misallocated across projects. The areas are those whose withdrawals between
September 2025 and September 2026 were rarely materials of any house BOM, or
that are not house production (site work, after-sales).
"""

from datetime import datetime, timezone

from alembic import op
import sqlalchemy as sa

revision = "20260924_0019"
down_revision = "20260923_0018"
branch_labels = None
depends_on = None

DEFAULTS = [
    ("05", "Administración y finanzas: 10% de sus salidas son materiales de algún presupuesto."),
    ("06", "Prevención de riesgos: elementos de protección, ninguno en presupuestos."),
    ("07", "Mantención: repuestos e insumos de la planta (36% en presupuestos)."),
    ("08", "Oficina de desarrollo: prototipos y pruebas."),
    ("09", "Calidad."),
    ("10", "Logística: 1% de sus salidas son materiales de algún presupuesto."),
    ("11", "Obra: instalación en terreno, meses después de la fábrica."),
    ("12", "Urbanización: obras del loteo, no de la vivienda (32% en presupuestos)."),
    ("14", "Postventa: reparaciones de viviendas ya entregadas."),
    ("15", "Abastecimiento."),
    ("17", "Operaciones vivienda."),
    ("19", "Recursos humanos."),
    ("20", "Tecnología y sistemas."),
    ("21", "Impregnadora: planta de tratamiento de madera."),
    ("23", "Mejora continua."),
    ("24", "Patio."),
]


def upgrade() -> None:
    table = op.create_table(
        "consumption_ceco_exclusions",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("rule", sa.String(20), nullable=False),
        sa.Column("note", sa.Text, nullable=True),
        sa.Column("created_by_user_id", sa.Integer, sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("rule"),
    )
    now = datetime.now(timezone.utc)
    op.bulk_insert(table, [{"rule": rule, "note": note, "created_at": now} for rule, note in DEFAULTS])
    op.create_table(
        "project_cost_model_extras",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("project_id", sa.Integer, sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("sku", sa.String(80), nullable=False),
        sa.Column("name", sa.String(255), nullable=True),
        sa.Column("unit", sa.String(40), nullable=True),
        sa.Column("included", sa.Boolean, nullable=False),
        sa.Column("quantity_per_house", sa.Float, nullable=True),
        sa.Column("unit_cost", sa.Float, nullable=True),
        sa.Column("replaces_sku", sa.String(80), nullable=True),
        sa.Column("source_range_start", sa.Date, nullable=True),
        sa.Column("source_range_end", sa.Date, nullable=True),
        sa.Column("note", sa.Text, nullable=True),
        sa.Column("created_by_user_id", sa.Integer, sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("project_id", "sku"),
    )
    op.create_table(
        "project_cost_model_settings",
        sa.Column("project_id", sa.Integer, sa.ForeignKey("projects.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("extras_default", sa.String(10), nullable=False, server_default="include"),
    )


def downgrade() -> None:
    op.drop_table("project_cost_model_settings")
    op.drop_table("project_cost_model_extras")
    op.drop_table("consumption_ceco_exclusions")
