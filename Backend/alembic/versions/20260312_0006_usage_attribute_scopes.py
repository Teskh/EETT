"""Add scoped catalog attributes for base vs usage fields.

Revision ID: 20260312_0006
Revises: 20260312_0005
Create Date: 2026-03-12 22:15:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = "20260312_0006"
down_revision = "20260312_0005"
branch_labels = None
depends_on = None


attribute_scope = postgresql.ENUM("base", "usage", name="attribute_scope", create_type=False)


def upgrade() -> None:
    bind = op.get_bind()
    attribute_scope.create(bind, checkfirst=True)
    op.add_column(
        "catalog_attribute_definitions",
        sa.Column("scope", attribute_scope, nullable=False, server_default="base"),
    )
    op.alter_column("catalog_attribute_definitions", "scope", server_default=None)


def downgrade() -> None:
    op.drop_column("catalog_attribute_definitions", "scope")
    bind = op.get_bind()
    attribute_scope.drop(bind, checkfirst=True)
