"""Add record_type to einvoicing_submissions — distinguish outbound AR vs vendor internal archive."""

from __future__ import annotations

from alembic import op

revision = "023_einvoicing_record_type"
down_revision = "022_einvoicing_submissions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE einvoicing_submissions
        ADD COLUMN IF NOT EXISTS record_type VARCHAR(32) NOT NULL DEFAULT 'outbound_ar'
        """
    )
    op.execute(
        """
        UPDATE einvoicing_submissions
        SET record_type = 'internal_vendor_record'
        WHERE invoice_id LIKE 'gulftax-flow-%'
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_einvoicing_submissions_record_type "
        "ON einvoicing_submissions (record_type)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_einvoicing_submissions_record_type")
    op.execute("ALTER TABLE einvoicing_submissions DROP COLUMN IF EXISTS record_type")
