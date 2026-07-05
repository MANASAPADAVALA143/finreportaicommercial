"""CT return Phase 2 — adjustments JSON and SBR election."""

from __future__ import annotations

from alembic import op

revision = "023_ct_return_phase2"
down_revision = "022_einvoicing_submissions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE gulftax_ct_returns ADD COLUMN IF NOT EXISTS adjustments JSONB")
    op.execute(
        "ALTER TABLE gulftax_ct_returns ADD COLUMN IF NOT EXISTS sbr_elected BOOLEAN NOT NULL DEFAULT FALSE"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE gulftax_ct_returns DROP COLUMN IF EXISTS sbr_elected")
    op.execute("ALTER TABLE gulftax_ct_returns DROP COLUMN IF EXISTS adjustments")
