"""Bookkeeping Autopilot tables

Revision ID: 004
Revises: 003
"""
from alembic import op
import sqlalchemy as sa

revision = "004"
down_revision = "003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "bookkeeping_client_profiles",
        sa.Column("client_id", sa.String(length=64), nullable=False),
        sa.Column("weekend_operations", sa.Boolean(), nullable=False),
        sa.Column("receipt_threshold", sa.Float(), nullable=False),
        sa.Column("chart_of_accounts", sa.JSON(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("client_id"),
    )
    op.create_table(
        "bookkeeping_transactions",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("client_id", sa.String(length=64), nullable=False),
        sa.Column("period_year", sa.Integer(), nullable=True),
        sa.Column("period_month", sa.Integer(), nullable=True),
        sa.Column("txn_date", sa.DateTime(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("amount", sa.Float(), nullable=False),
        sa.Column("type", sa.String(length=32), nullable=True),
        sa.Column("category", sa.String(length=256), nullable=True),
        sa.Column("confidence", sa.Float(), nullable=True),
        sa.Column("flag_for_review", sa.Boolean(), nullable=False),
        sa.Column("auto_approved", sa.Boolean(), nullable=False),
        sa.Column("anomaly_flags", sa.JSON(), nullable=True),
        sa.Column("receipt_url", sa.String(length=1024), nullable=True),
        sa.Column("vendor_name", sa.String(length=512), nullable=True),
        sa.Column("bank_account_id", sa.String(length=128), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_bookkeeping_transactions_client_id", "bookkeeping_transactions", ["client_id"])
    op.create_table(
        "client_vendors",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("client_id", sa.String(length=64), nullable=False),
        sa.Column("vendor_name", sa.String(length=512), nullable=False),
        sa.Column("category", sa.String(length=256), nullable=True),
        sa.Column("avg_amount", sa.Float(), nullable=True),
        sa.Column("last_seen", sa.DateTime(), nullable=True),
        sa.Column("transaction_count", sa.Integer(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("client_id", "vendor_name", name="uq_client_vendor"),
    )
    op.create_index("ix_client_vendors_client_id", "client_vendors", ["client_id"])
    op.create_table(
        "client_rules",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("client_id", sa.String(length=64), nullable=False),
        sa.Column("vendor_pattern", sa.String(length=512), nullable=False),
        sa.Column("category", sa.String(length=256), nullable=False),
        sa.Column("confidence_boost", sa.Float(), nullable=True),
        sa.Column("source", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_client_rules_client_id", "client_rules", ["client_id"])
    op.create_table(
        "transaction_categories",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("transaction_id", sa.Integer(), nullable=False),
        sa.Column("category", sa.String(length=256), nullable=False),
        sa.Column("confidence", sa.Float(), nullable=False),
        sa.Column("method", sa.String(length=32), nullable=False),
        sa.Column("claude_reason", sa.Text(), nullable=True),
        sa.Column("staff_corrected", sa.Boolean(), nullable=False),
        sa.Column("corrected_to", sa.String(length=256), nullable=True),
        sa.Column("corrected_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["transaction_id"], ["bookkeeping_transactions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_transaction_categories_transaction_id", "transaction_categories", ["transaction_id"])
    op.create_table(
        "missing_receipts",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("transaction_id", sa.Integer(), nullable=False),
        sa.Column("amount", sa.Float(), nullable=False),
        sa.Column("vendor", sa.String(length=512), nullable=True),
        sa.Column("date", sa.DateTime(), nullable=True),
        sa.Column("reminder_sent_count", sa.Integer(), nullable=True),
        sa.Column("resolved", sa.Boolean(), nullable=False),
        sa.ForeignKeyConstraint(["transaction_id"], ["bookkeeping_transactions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("transaction_id"),
    )
    op.create_index("ix_missing_receipts_transaction_id", "missing_receipts", ["transaction_id"])
    op.create_table(
        "accuracy_metrics",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("client_id", sa.String(length=64), nullable=False),
        sa.Column("month", sa.Integer(), nullable=False),
        sa.Column("year", sa.Integer(), nullable=False),
        sa.Column("total_transactions", sa.Integer(), nullable=True),
        sa.Column("auto_approved", sa.Integer(), nullable=True),
        sa.Column("staff_corrected", sa.Integer(), nullable=True),
        sa.Column("flagged", sa.Integer(), nullable=True),
        sa.Column("anomalies_real", sa.Integer(), nullable=True),
        sa.Column("anomalies_false_positive", sa.Integer(), nullable=True),
        sa.Column("accuracy_pct", sa.Float(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("client_id", "month", "year", name="uq_accuracy_client_period"),
    )
    op.create_index("ix_accuracy_metrics_client_id", "accuracy_metrics", ["client_id"])
    op.create_table(
        "bookkeeping_reconciliation_runs",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("client_id", sa.String(length=64), nullable=False),
        sa.Column("variance_amount", sa.Float(), nullable=False),
        sa.Column("escalated", sa.Boolean(), nullable=False),
        sa.Column("summary_json", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_bookkeeping_reconciliation_runs_client_id", "bookkeeping_reconciliation_runs", ["client_id"])
    op.create_table(
        "reconciliation_signoffs",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("client_id", sa.String(length=64), nullable=False),
        sa.Column("period_month", sa.Integer(), nullable=False),
        sa.Column("period_year", sa.Integer(), nullable=False),
        sa.Column("signed_by", sa.String(length=256), nullable=False),
        sa.Column("signed_at", sa.DateTime(), nullable=True),
        sa.Column("variance_amount", sa.Float(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_reconciliation_signoffs_client_id", "reconciliation_signoffs", ["client_id"])


def downgrade() -> None:
    op.drop_index("ix_reconciliation_signoffs_client_id", table_name="reconciliation_signoffs")
    op.drop_table("reconciliation_signoffs")
    op.drop_index("ix_bookkeeping_reconciliation_runs_client_id", table_name="bookkeeping_reconciliation_runs")
    op.drop_table("bookkeeping_reconciliation_runs")
    op.drop_index("ix_accuracy_metrics_client_id", table_name="accuracy_metrics")
    op.drop_table("accuracy_metrics")
    op.drop_index("ix_missing_receipts_transaction_id", table_name="missing_receipts")
    op.drop_table("missing_receipts")
    op.drop_index("ix_transaction_categories_transaction_id", table_name="transaction_categories")
    op.drop_table("transaction_categories")
    op.drop_index("ix_client_rules_client_id", table_name="client_rules")
    op.drop_table("client_rules")
    op.drop_index("ix_client_vendors_client_id", table_name="client_vendors")
    op.drop_table("client_vendors")
    op.drop_index("ix_bookkeeping_transactions_client_id", table_name="bookkeeping_transactions")
    op.drop_table("bookkeeping_transactions")
    op.drop_table("bookkeeping_client_profiles")
