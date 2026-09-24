"""Distinguish complete scenario quantities from legacy component overrides."""

from alembic import context, op
import sqlalchemy as sa

revision = "20260923_0018"
down_revision = "20260813_0017"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Local databases may have received this additive repair before their
    # migration history was reconciled. Keep a later upgrade safe to run.
    if not context.is_offline_mode():
        columns = sa.inspect(op.get_bind()).get_columns("project_cost_model_adjustments")
        existing = next((column for column in columns if column["name"] == "quantity_scope"), None)
        if existing is not None:
            if not isinstance(existing["type"], sa.String) or existing["type"].length != 20 or existing["nullable"]:
                raise RuntimeError("Existing quantity_scope column does not match the cost-model schema")
            if "component" not in str(existing.get("default") or ""):
                raise RuntimeError("Existing quantity_scope column is missing its component default")
            return
    op.add_column("project_cost_model_adjustments", sa.Column(
        "quantity_scope", sa.String(20), nullable=False, server_default="component",
    ))


def downgrade() -> None:
    op.drop_column("project_cost_model_adjustments", "quantity_scope")
