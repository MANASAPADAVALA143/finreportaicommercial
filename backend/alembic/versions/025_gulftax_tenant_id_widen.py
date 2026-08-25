"""Widen GulfTax tenant_id columns past UUID-36.

QA workspace_id is 37 chars (malformed last hex group). VARCHAR(36)
silently blocked gulftax_transactions inserts on RDS.

Revision ID: 025_gulftax_tenant_id_widen
Revises: 024_uae_fixed_assets_company_id
Create Date: 2026-07-20
"""

from __future__ import annotations

from alembic import op

revision = "025_gulftax_tenant_id_widen"
down_revision = "024_uae_fixed_assets_company_id"
branch_labels = None
depends_on = None

_TABLES = (
    "gulftax_transactions",
    "vat_return_entries",
    "partial_exemption_calculations",
    "bad_debt_relief_claims",
    "company_config",
)


def upgrade() -> None:
    for table in _TABLES:
        op.execute(
            f"ALTER TABLE {table} ALTER COLUMN tenant_id TYPE VARCHAR(64)"
        )


def downgrade() -> None:
    # Do not shrink — existing 37-char values would fail.
    pass
