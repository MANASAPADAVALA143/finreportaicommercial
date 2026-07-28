"""Create ap_payment_runs for AP Payment Run Center.

Revision ID: 029_ap_payment_runs
Revises: 027_ar_approve_and_post
Create Date: 2026-07-28
"""

from __future__ import annotations

from alembic import op

revision = "029_ap_payment_runs"
down_revision = "027_ar_approve_and_post"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS ap_payment_runs (
            id VARCHAR(36) PRIMARY KEY,
            run_number VARCHAR(32) NOT NULL,
            workspace_id VARCHAR(36) NOT NULL,
            company_id VARCHAR(36) NOT NULL,
            created_by VARCHAR(200),
            created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
            submitted_at TIMESTAMP WITHOUT TIME ZONE,
            approved_by VARCHAR(200),
            approved_at TIMESTAMP WITHOUT TIME ZONE,
            executed_at TIMESTAMP WITHOUT TIME ZONE,
            status VARCHAR(32) NOT NULL DEFAULT 'draft',
            rejection_reason TEXT,
            total_invoices INTEGER NOT NULL DEFAULT 0,
            total_net_aed NUMERIC(15, 2) NOT NULL DEFAULT 0,
            total_vat_aed NUMERIC(15, 2) NOT NULL DEFAULT 0,
            total_gross_aed NUMERIC(15, 2) NOT NULL DEFAULT 0,
            invoice_ids JSON NOT NULL DEFAULT '[]',
            journal_entry_id VARCHAR(36),
            extra JSON
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_ap_payment_runs_workspace_id ON ap_payment_runs (workspace_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_ap_payment_runs_company_id ON ap_payment_runs (company_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_ap_payment_runs_status ON ap_payment_runs (status)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_ap_payment_runs_run_number ON ap_payment_runs (run_number)"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS ap_payment_runs")
