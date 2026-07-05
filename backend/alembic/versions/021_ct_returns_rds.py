"""CT returns table on RDS — draft / approved / filed workflow."""

from __future__ import annotations

from alembic import op

revision = "021_ct_returns_rds"
down_revision = "020_gulftax_advanced_vat"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS ct_returns (
            id VARCHAR(36) PRIMARY KEY,
            tenant_id VARCHAR(36) NOT NULL,
            company_id VARCHAR(36) NOT NULL,
            period_start DATE NOT NULL,
            period_end DATE NOT NULL,
            revenue NUMERIC(15, 2),
            accounting_profit NUMERIC(15, 2),
            non_deductible_expenses NUMERIC(15, 2) DEFAULT 0,
            taxable_income NUMERIC(15, 2),
            ct_payable_aed NUMERIC(15, 2),
            sbr_eligible BOOLEAN NOT NULL DEFAULT FALSE,
            qfzp_eligible BOOLEAN NOT NULL DEFAULT FALSE,
            free_zone_status VARCHAR(32) DEFAULT 'mainland',
            free_zone_income NUMERIC(15, 2) DEFAULT 0,
            breakdown JSONB,
            status VARCHAR(20) NOT NULL DEFAULT 'draft',
            override_reason TEXT,
            approved_at TIMESTAMP,
            filed_at TIMESTAMP,
            created_at TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
            updated_at TIMESTAMP DEFAULT (now() AT TIME ZONE 'utc')
        )
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS ix_ct_returns_tenant_id ON ct_returns (tenant_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_ct_returns_company_id ON ct_returns (company_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_ct_returns_status ON ct_returns (status)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS ct_returns")
