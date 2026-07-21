"""Add GulfTax classify columns to uae_sales_invoices.

AR classify-on-create stores VAT treatment / risk decision on the draft
so HARD_BLOCK can leave invoices unposted for manual review.

Revision ID: 026_ar_gulftax_classify_columns
Revises: 025_gulftax_tenant_id_widen
Create Date: 2026-07-20
"""

from __future__ import annotations

from alembic import op

revision = "026_ar_gulftax_classify_columns"
down_revision = "025_gulftax_tenant_id_widen"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE uae_sales_invoices ADD COLUMN IF NOT EXISTS vat_treatment VARCHAR(64)"
    )
    op.execute(
        "ALTER TABLE uae_sales_invoices ADD COLUMN IF NOT EXISTS gulftax_decision VARCHAR(32)"
    )
    op.execute(
        "ALTER TABLE uae_sales_invoices ADD COLUMN IF NOT EXISTS gulftax_risk_score NUMERIC(8, 2)"
    )
    op.execute(
        "ALTER TABLE uae_sales_invoices ADD COLUMN IF NOT EXISTS gulftax_confidence NUMERIC(8, 4)"
    )
    op.execute(
        "ALTER TABLE uae_sales_invoices ADD COLUMN IF NOT EXISTS trn_valid BOOLEAN"
    )
    op.execute(
        "ALTER TABLE uae_sales_invoices "
        "ADD COLUMN IF NOT EXISTS flag_for_review BOOLEAN DEFAULT FALSE"
    )
    op.execute(
        "ALTER TABLE uae_sales_invoices ADD COLUMN IF NOT EXISTS gulftax_reasoning TEXT"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE uae_sales_invoices DROP COLUMN IF EXISTS gulftax_reasoning")
    op.execute("ALTER TABLE uae_sales_invoices DROP COLUMN IF EXISTS flag_for_review")
    op.execute("ALTER TABLE uae_sales_invoices DROP COLUMN IF EXISTS trn_valid")
    op.execute("ALTER TABLE uae_sales_invoices DROP COLUMN IF EXISTS gulftax_confidence")
    op.execute("ALTER TABLE uae_sales_invoices DROP COLUMN IF EXISTS gulftax_risk_score")
    op.execute("ALTER TABLE uae_sales_invoices DROP COLUMN IF EXISTS gulftax_decision")
    op.execute("ALTER TABLE uae_sales_invoices DROP COLUMN IF EXISTS vat_treatment")
