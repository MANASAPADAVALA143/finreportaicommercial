"""Create vat_classifier_transactions on RDS.

Revision ID: 032_vat_classifier_transactions
Revises: 031_industry_aware_workspace
Create Date: 2026-08-06
"""

from __future__ import annotations

from alembic import op

revision = "032_vat_classifier_transactions"
down_revision = "031_industry_aware_workspace"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS vat_classifier_transactions (
          id VARCHAR(36) PRIMARY KEY,
          company_id VARCHAR(36),
          workspace_id VARCHAR(64),
          transaction_type VARCHAR(20),
          fta_box VARCHAR(8),
          net_amount NUMERIC(15, 2),
          vat_amount NUMERIC(15, 2),
          gross_amount NUMERIC(15, 2),
          invoice_reference VARCHAR(128),
          vendor_name VARCHAR(256),
          source VARCHAR(64),
          transaction_date DATE,
          vat_category VARCHAR(64),
          created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_vat_classifier_tx_company
          ON vat_classifier_transactions (company_id)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_vat_classifier_tx_invoice_source
          ON vat_classifier_transactions (company_id, invoice_reference, source)
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS vat_classifier_transactions")
