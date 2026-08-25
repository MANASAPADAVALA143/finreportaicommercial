"""Add ap_payment_run_items and payment_date/notes/bank_account on runs.

Revision ID: 030_ap_payment_run_items
Revises: 029_ap_payment_runs
Create Date: 2026-08-01
"""

from __future__ import annotations

from alembic import op

revision = "030_ap_payment_run_items"
down_revision = "029_ap_payment_runs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE ap_payment_runs ADD COLUMN IF NOT EXISTS payment_date DATE
        """
    )
    op.execute(
        """
        ALTER TABLE ap_payment_runs ADD COLUMN IF NOT EXISTS notes TEXT
        """
    )
    op.execute(
        """
        ALTER TABLE ap_payment_runs ADD COLUMN IF NOT EXISTS bank_account VARCHAR(128)
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS ap_payment_run_items (
            id VARCHAR(36) PRIMARY KEY,
            payment_run_id VARCHAR(36) NOT NULL REFERENCES ap_payment_runs(id) ON DELETE CASCADE,
            invoice_id VARCHAR(36) NOT NULL,
            vendor_name VARCHAR(256),
            amount_aed NUMERIC(15, 2) NOT NULL DEFAULT 0,
            property_id VARCHAR(36),
            created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_ap_payment_run_items_run_id ON ap_payment_run_items (payment_run_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_ap_payment_run_items_invoice_id ON ap_payment_run_items (invoice_id)"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS ap_payment_run_items")
    op.execute("ALTER TABLE ap_payment_runs DROP COLUMN IF EXISTS bank_account")
    op.execute("ALTER TABLE ap_payment_runs DROP COLUMN IF EXISTS notes")
    op.execute("ALTER TABLE ap_payment_runs DROP COLUMN IF EXISTS payment_date")
