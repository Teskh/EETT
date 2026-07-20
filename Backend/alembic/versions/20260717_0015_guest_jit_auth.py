"""Add Microsoft JIT guest identities.

Revision ID: 20260717_0015
Revises: 20260713_0014
Create Date: 2026-07-17
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260717_0015"
down_revision = "20260713_0014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("is_auto_provisioned", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column("users", sa.Column("microsoft_tenant_id", sa.String(length=80), nullable=True))
    op.add_column("users", sa.Column("microsoft_object_id", sa.String(length=80), nullable=True))
    op.create_unique_constraint(
        "uq_users_microsoft_identity",
        "users",
        ["microsoft_tenant_id", "microsoft_object_id"],
    )
    op.execute(
        sa.text(
            """
            INSERT INTO roles (code, name, description)
            VALUES (
                'guest',
                'Invitado',
                'Acceso de solo lectura a proyectos en ejecución para cuentas Microsoft autoprovisionadas.'
            )
            ON CONFLICT (code) DO UPDATE
            SET name = EXCLUDED.name, description = EXCLUDED.description
            """
        )
    )


def downgrade() -> None:
    op.execute(sa.text("DELETE FROM users WHERE is_auto_provisioned IS TRUE"))
    op.execute(sa.text("DELETE FROM roles WHERE code = 'guest'"))
    op.drop_constraint("uq_users_microsoft_identity", "users", type_="unique")
    op.drop_column("users", "microsoft_object_id")
    op.drop_column("users", "microsoft_tenant_id")
    op.drop_column("users", "is_auto_provisioned")
