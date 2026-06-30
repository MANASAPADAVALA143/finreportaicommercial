"""Add company_id to UAE tables + consolidation_eliminations.

Revision ID: 014_uae_company_id
Revises: 013_company_setup
Create Date: 2026-06-08
"""

from alembic import op
import sqlalchemy as sa

revision = "014_uae_company_id"
down_revision = "013_company_setup"
branch_labels = None
depends_on = None


def _add_company_id(table: str) -> None:
    with op.batch_alter_table(table) as batch:
        batch.add_column(sa.Column("company_id", sa.String(36), nullable=True))
        batch.create_index(f"ix_{table}_company_id", ["company_id"])


def upgrade() -> None:
    for tbl in (
        "uae_accounts",
        "uae_journal_entries",
        "uae_sales_invoices",
        "uae_bank_accounts",
        "uae_fixed_assets",
    ):
        try:
            _add_company_id(tbl)
        except Exception:
            pass

    op.create_table(
        "consolidation_eliminations",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("workspace_id", sa.String(36), sa.ForeignKey("workspaces.id"), nullable=False, index=True),
        sa.Column("period_id", sa.String(36), sa.ForeignKey("accounting_periods.id"), nullable=False, index=True),
        sa.Column("account_category", sa.String(64), nullable=False),
        sa.Column("company_from_id", sa.String(36), sa.ForeignKey("uae_company_profiles.id"), nullable=True),
        sa.Column("company_to_id", sa.String(36), sa.ForeignKey("uae_company_profiles.id"), nullable=True),
        sa.Column("amount", sa.Numeric(15, 2), nullable=False, server_default="0"),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_by", sa.String(36), sa.ForeignKey("rbac_users.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("consolidation_eliminations")
    for tbl in (
        "uae_fixed_assets",
        "uae_bank_accounts",
        "uae_sales_invoices",
        "uae_journal_entries",
        "uae_accounts",
    ):
        try:
            with op.batch_alter_table(tbl) as batch:
                batch.drop_index(f"ix_{tbl}_company_id")
                batch.drop_column("company_id")
        except Exception:
            pass
