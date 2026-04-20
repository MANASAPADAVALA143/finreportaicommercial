"""enterprise bank reconciliation tables

Revision ID: 002
Revises: 001

SQLite / PostgreSQL–compatible DDL for the eight reconciliation tables.
On a fresh DB: alembic stamp 001 && alembic upgrade 002
"""
from alembic import op
import sqlalchemy as sa

revision = "002"
down_revision = "001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "recon_workspaces",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("tenant_id", sa.String(length=64), nullable=False),
        sa.Column("workspace_name", sa.String(length=512), nullable=False),
        sa.Column("period_start", sa.Date(), nullable=False),
        sa.Column("period_end", sa.Date(), nullable=False),
        sa.Column("recon_type", sa.String(length=32), nullable=False),
        sa.Column("currency", sa.String(length=8), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("assigned_preparer_id", sa.String(length=256), nullable=True),
        sa.Column("assigned_reviewer_id", sa.String(length=256), nullable=True),
        sa.Column("due_date", sa.Date(), nullable=True),
        sa.Column("completed_date", sa.Date(), nullable=True),
        sa.Column("sign_off_preparer", sa.Boolean(), nullable=False),
        sa.Column("sign_off_reviewer", sa.Boolean(), nullable=False),
        sa.Column("total_book_balance", sa.Numeric(18, 4), nullable=True),
        sa.Column("total_bank_balance", sa.Numeric(18, 4), nullable=True),
        sa.Column("outstanding_deposits", sa.Numeric(18, 4), nullable=False),
        sa.Column("outstanding_cheques", sa.Numeric(18, 4), nullable=False),
        sa.Column("adjusted_book_balance", sa.Numeric(18, 4), nullable=True),
        sa.Column("adjusted_bank_balance", sa.Numeric(18, 4), nullable=True),
        sa.Column("variance", sa.Numeric(18, 4), nullable=False),
        sa.Column("is_reconciled", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_recon_workspaces_tenant_id", "recon_workspaces", ["tenant_id"])

    op.create_table(
        "match_groups",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("workspace_id", sa.Integer(), nullable=False),
        sa.Column("match_type", sa.String(length=32), nullable=False),
        sa.Column("confidence_score", sa.Float(), nullable=False),
        sa.Column("amount_variance", sa.Numeric(18, 4), nullable=False),
        sa.Column("date_variance_days", sa.Integer(), nullable=True),
        sa.Column("description_similarity", sa.Float(), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("confirmed_by", sa.String(length=256), nullable=True),
        sa.Column("confirmed_at", sa.DateTime(), nullable=True),
        sa.Column("ai_reasoning", sa.Text(), nullable=True),
        sa.Column("metadata", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["workspace_id"], ["recon_workspaces.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_match_groups_workspace_id", "match_groups", ["workspace_id"])

    op.create_table(
        "book_transactions",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("workspace_id", sa.Integer(), nullable=False),
        sa.Column("txn_date", sa.Date(), nullable=False),
        sa.Column("value_date", sa.Date(), nullable=True),
        sa.Column("posting_date", sa.Date(), nullable=True),
        sa.Column("amount", sa.Numeric(18, 4), nullable=False),
        sa.Column("debit_credit", sa.String(length=2), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("reference", sa.String(length=512), nullable=True),
        sa.Column("gl_account", sa.String(length=128), nullable=True),
        sa.Column("cost_center", sa.String(length=128), nullable=True),
        sa.Column("document_number", sa.String(length=256), nullable=True),
        sa.Column("source_system", sa.String(length=64), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("match_id", sa.Integer(), nullable=True),
        sa.Column("exception_reason", sa.Text(), nullable=True),
        sa.Column("is_reconciling_item", sa.Boolean(), nullable=False),
        sa.Column("reconciling_item_type", sa.String(length=32), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["workspace_id"], ["recon_workspaces.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["match_id"], ["match_groups.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_book_transactions_workspace_id", "book_transactions", ["workspace_id"])
    op.create_index("ix_book_transactions_match_id", "book_transactions", ["match_id"])

    op.create_table(
        "bank_transactions",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("workspace_id", sa.Integer(), nullable=False),
        sa.Column("txn_date", sa.Date(), nullable=False),
        sa.Column("value_date", sa.Date(), nullable=True),
        sa.Column("amount", sa.Numeric(18, 4), nullable=False),
        sa.Column("debit_credit", sa.String(length=2), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("bank_reference", sa.String(length=512), nullable=True),
        sa.Column("counterparty", sa.String(length=512), nullable=True),
        sa.Column("bank_account_number", sa.String(length=128), nullable=True),
        sa.Column("bank_name", sa.String(length=256), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("match_id", sa.Integer(), nullable=True),
        sa.Column("exception_reason", sa.Text(), nullable=True),
        sa.Column("is_reconciling_item", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["workspace_id"], ["recon_workspaces.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["match_id"], ["match_groups.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_bank_transactions_workspace_id", "bank_transactions", ["workspace_id"])
    op.create_index("ix_bank_transactions_match_id", "bank_transactions", ["match_id"])

    op.create_table(
        "subledger_transactions",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("workspace_id", sa.Integer(), nullable=False),
        sa.Column("txn_date", sa.Date(), nullable=False),
        sa.Column("amount", sa.Numeric(18, 4), nullable=False),
        sa.Column("debit_credit", sa.String(length=2), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("subledger_type", sa.String(length=32), nullable=True),
        sa.Column("document_reference", sa.String(length=512), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("match_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["workspace_id"], ["recon_workspaces.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["match_id"], ["match_groups.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_subledger_transactions_workspace_id", "subledger_transactions", ["workspace_id"])
    op.create_index("ix_subledger_transactions_match_id", "subledger_transactions", ["match_id"])

    op.create_table(
        "recon_adjustments",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("workspace_id", sa.Integer(), nullable=False),
        sa.Column("adjustment_type", sa.String(length=48), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("amount", sa.Numeric(18, 4), nullable=False),
        sa.Column("affects_side", sa.String(length=16), nullable=False),
        sa.Column("journal_entry_required", sa.Boolean(), nullable=False),
        sa.Column("je_posted", sa.Boolean(), nullable=False),
        sa.Column("posted_by", sa.String(length=256), nullable=True),
        sa.Column("posted_at", sa.DateTime(), nullable=True),
        sa.Column("created_by", sa.String(length=256), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["workspace_id"], ["recon_workspaces.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_recon_adjustments_workspace_id", "recon_adjustments", ["workspace_id"])

    op.create_table(
        "recon_exceptions",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("workspace_id", sa.Integer(), nullable=False),
        sa.Column("exception_type", sa.String(length=48), nullable=False),
        sa.Column("severity", sa.String(length=16), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("bank_txn_id", sa.Integer(), nullable=True),
        sa.Column("book_txn_id", sa.Integer(), nullable=True),
        sa.Column("amount", sa.Numeric(18, 4), nullable=True),
        sa.Column("age_days", sa.Integer(), nullable=True),
        sa.Column("assigned_to", sa.String(length=256), nullable=True),
        sa.Column("resolution_notes", sa.Text(), nullable=True),
        sa.Column("resolved", sa.Boolean(), nullable=False),
        sa.Column("resolved_at", sa.DateTime(), nullable=True),
        sa.Column("resolved_by", sa.String(length=256), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["workspace_id"], ["recon_workspaces.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["bank_txn_id"], ["bank_transactions.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["book_txn_id"], ["book_transactions.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table(
        "recon_audit_trail",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("workspace_id", sa.Integer(), nullable=False),
        sa.Column("action", sa.String(length=48), nullable=False),
        sa.Column("performed_by", sa.String(length=256), nullable=True),
        sa.Column("performed_at", sa.DateTime(), nullable=False),
        sa.Column("details", sa.JSON(), nullable=True),
        sa.Column("ip_address", sa.String(length=64), nullable=True),
        sa.ForeignKeyConstraint(["workspace_id"], ["recon_workspaces.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    op.drop_table("recon_audit_trail")
    op.drop_table("recon_exceptions")
    op.drop_table("recon_adjustments")
    op.drop_table("subledger_transactions")
    op.drop_table("bank_transactions")
    op.drop_table("book_transactions")
    op.drop_table("match_groups")
    op.drop_table("recon_workspaces")
