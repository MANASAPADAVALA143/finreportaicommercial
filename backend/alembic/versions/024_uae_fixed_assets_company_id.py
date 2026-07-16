"""Add company_id to uae_fixed_assets (missed on RDS after 014).

Fixes GET /api/uae/full/dashboard crashing with:
  column uae_fixed_assets.company_id does not exist

Backfill is intentionally NOT done here: tenant_id → company is not 1:1 for
multi-company workspaces. Leave company_id NULL until a per-row signal exists
(e.g. gl_account_id → uae_accounts.company_id) or manual assignment.

Revision ID: 024_uae_fixed_assets_company_id
Revises: 023_einvoicing_record_type
Create Date: 2026-07-14
"""

from __future__ import annotations

from alembic import op

revision = "024_uae_fixed_assets_company_id"
down_revision = "023_einvoicing_record_type"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE uae_fixed_assets ADD COLUMN IF NOT EXISTS company_id VARCHAR(36)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_uae_fixed_assets_company_id "
        "ON uae_fixed_assets (company_id)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_uae_fixed_assets_company_id")
    op.execute("ALTER TABLE uae_fixed_assets DROP COLUMN IF EXISTS company_id")
