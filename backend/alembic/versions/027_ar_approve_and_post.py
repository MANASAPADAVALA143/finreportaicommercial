"""Add AR approve-and-post metadata on uae_sales_invoices.

Adds approved_at / approved_by used by POST /api/uae/ar/approve-and-post.
journal_entry_id already exists from earlier UAE full accounting migrations.

Revision ID: 027_ar_approve_and_post
Revises: 026_ar_gulftax_classify_columns
Create Date: 2026-07-28
"""

from __future__ import annotations

from alembic import op

revision = "027_ar_approve_and_post"
down_revision = "026_ar_gulftax_classify_columns"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE uae_sales_invoices "
        "ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP WITHOUT TIME ZONE"
    )
    op.execute(
        "ALTER TABLE uae_sales_invoices "
        "ADD COLUMN IF NOT EXISTS approved_by VARCHAR(200)"
    )
    # Defensive: ensure journal_entry_id exists on older DBs
    op.execute(
        "ALTER TABLE uae_sales_invoices "
        "ADD COLUMN IF NOT EXISTS journal_entry_id VARCHAR(36)"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE uae_sales_invoices DROP COLUMN IF EXISTS approved_by")
    op.execute("ALTER TABLE uae_sales_invoices DROP COLUMN IF EXISTS approved_at")
    # Do not drop journal_entry_id — used by existing AR GL posts
