"""VAT recon hardening — reconciliation_results columns."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "019_vat_recon"
down_revision = "018_uae_recurring_invoices"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE reconciliation_results ADD COLUMN IF NOT EXISTS tax_period VARCHAR(16)")
    op.execute("ALTER TABLE reconciliation_results ADD COLUMN IF NOT EXISTS period_start DATE")
    op.execute("ALTER TABLE reconciliation_results ADD COLUMN IF NOT EXISTS period_end DATE")
    op.execute("ALTER TABLE reconciliation_results ADD COLUMN IF NOT EXISTS box_breakdown JSONB")
    op.execute("ALTER TABLE reconciliation_results ADD COLUMN IF NOT EXISTS source VARCHAR(64)")
    op.execute("ALTER TABLE reconciliation_results ADD COLUMN IF NOT EXISTS override_reason VARCHAR(2000)")
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_reconciliation_results_tax_period "
        "ON reconciliation_results (company_id, tax_period)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_reconciliation_results_tax_period")
    op.drop_column("reconciliation_results", "override_reason")
    op.drop_column("reconciliation_results", "source")
    op.drop_column("reconciliation_results", "box_breakdown")
    op.drop_column("reconciliation_results", "period_end")
    op.drop_column("reconciliation_results", "period_start")
    op.drop_column("reconciliation_results", "tax_period")
