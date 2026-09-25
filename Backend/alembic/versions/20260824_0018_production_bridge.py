"""Bridge the revision recorded by the production database.

Production records 20260824_0018, a revision whose file never reached this
repository. Its schema matches 20260813_0017 exactly, so this revision makes
no change. It lets databases synced from production upgrade to head.

Revision ID: 20260824_0018
Revises: 20260813_0017
Create Date: 2026-08-24
"""

from __future__ import annotations


revision = "20260824_0018"
down_revision = "20260813_0017"
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
