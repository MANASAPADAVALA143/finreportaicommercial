"""Advanced VAT — designated_zone on gulftax_transactions, partial exemption status."""

from __future__ import annotations

from alembic import op

revision = "020_gulftax_advanced_vat"
down_revision = "019_vat_recon"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE gulftax_transactions ADD COLUMN IF NOT EXISTS designated_zone BOOLEAN DEFAULT FALSE"
    )
    op.execute(
        "ALTER TABLE gulftax_transactions ADD COLUMN IF NOT EXISTS transaction_kind VARCHAR(16) DEFAULT 'goods'"
    )
    op.execute(
        "ALTER TABLE gulftax_transactions ADD COLUMN IF NOT EXISTS dz_supplier_location VARCHAR(64)"
    )
    op.execute(
        "ALTER TABLE gulftax_transactions ADD COLUMN IF NOT EXISTS dz_customer_location VARCHAR(64)"
    )
    op.execute(
        "ALTER TABLE partial_exemption_calculations ADD COLUMN IF NOT EXISTS status VARCHAR(32) DEFAULT 'draft'"
    )
    op.execute(
        "ALTER TABLE bad_debt_relief_claims ADD COLUMN IF NOT EXISTS claim_period VARCHAR(16)"
    )


def downgrade() -> None:
    op.drop_column("bad_debt_relief_claims", "claim_period")
    op.drop_column("partial_exemption_calculations", "status")
    op.drop_column("gulftax_transactions", "dz_customer_location")
    op.drop_column("gulftax_transactions", "dz_supplier_location")
    op.drop_column("gulftax_transactions", "transaction_kind")
    op.drop_column("gulftax_transactions", "designated_zone")
