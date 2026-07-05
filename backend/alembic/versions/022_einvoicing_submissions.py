"""E-invoicing submissions table on RDS."""

from __future__ import annotations

from alembic import op

revision = "022_einvoicing_submissions"
down_revision = "021_ct_returns_rds"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS einvoicing_submissions (
            id VARCHAR(36) PRIMARY KEY,
            tenant_id VARCHAR(36) NOT NULL,
            company_id VARCHAR(36) NOT NULL,
            invoice_id VARCHAR(36),
            invoice_number VARCHAR(128) NOT NULL,
            submission_status VARCHAR(20) NOT NULL DEFAULT 'pending',
            xml_payload TEXT,
            submitted_at TIMESTAMP,
            asp_reference VARCHAR(128),
            error_message TEXT,
            created_at TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
            updated_at TIMESTAMP DEFAULT (now() AT TIME ZONE 'utc')
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_einvoicing_submissions_tenant_id ON einvoicing_submissions (tenant_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_einvoicing_submissions_company_id ON einvoicing_submissions (company_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_einvoicing_submissions_invoice_id ON einvoicing_submissions (invoice_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_einvoicing_submissions_status ON einvoicing_submissions (submission_status)"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS einvoicing_submissions")
