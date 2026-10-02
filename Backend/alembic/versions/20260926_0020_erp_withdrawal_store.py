"""Stored copy of ERP withdrawals, kept up to date by a scheduled sync.

Past withdrawals rarely change, so instead of rebuilding them from the ERP on
every cache miss we keep them and re-check recent days nightly and everything
monthly.
"""

from alembic import op
import sqlalchemy as sa

revision = "20260926_0020"
down_revision = "20260924_0019"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "erp_withdrawals",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("document_number", sa.String(50), nullable=False),
        sa.Column("movement_date", sa.Date, nullable=False),
        sa.Column("sku", sa.String(80), nullable=False),
        sa.Column("cost_center", sa.String(40), nullable=False, server_default=""),
        sa.Column("cost_center_name", sa.String(255), nullable=True),
        sa.Column("request_note", sa.Text, nullable=True),
        sa.Column("quantity", sa.Float, nullable=False, server_default="0"),
        sa.Column("value", sa.Float, nullable=False, server_default="0"),
        sa.Column("line_count", sa.Integer, nullable=False, server_default="0"),
        sa.UniqueConstraint("document_number", "sku"),
    )
    op.create_index("ix_erp_withdrawals_sku_date", "erp_withdrawals", ["sku", "movement_date"])
    op.create_index("ix_erp_withdrawals_date", "erp_withdrawals", ["movement_date"])
    op.create_table(
        "erp_products",
        sa.Column("sku", sa.String(80), primary_key=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("unit", sa.String(40), nullable=True),
    )
    op.create_table(
        "erp_sync_state",
        sa.Column("key", sa.String(40), primary_key=True),
        sa.Column("covered_from", sa.Date, nullable=True),
        sa.Column("covered_to", sa.Date, nullable=True),
        sa.Column("last_recent_sync_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_nightly_sync_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_full_sync_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("full_sync_resume_from", sa.Date, nullable=True),
        sa.Column("last_error", sa.Text, nullable=True),
        sa.Column("last_error_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("erp_sync_state")
    op.drop_table("erp_products")
    op.drop_index("ix_erp_withdrawals_date", table_name="erp_withdrawals")
    op.drop_index("ix_erp_withdrawals_sku_date", table_name="erp_withdrawals")
    op.drop_table("erp_withdrawals")
