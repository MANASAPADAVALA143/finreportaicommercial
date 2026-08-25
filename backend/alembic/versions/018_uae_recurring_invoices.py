"""Add uae_recurring_invoices and link generated sales invoices.

Revision ID: 018_uae_recurring_invoices
Revises: 017_uae_credit_notes
"""

from alembic import op
import sqlalchemy as sa

revision = "018_uae_recurring_invoices"
down_revision = "017_uae_credit_notes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "uae_recurring_invoices",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("tenant_id", sa.String(36), nullable=False, index=True),
        sa.Column("company_id", sa.String(36), nullable=True, index=True),
        sa.Column("customer_id", sa.String(36), sa.ForeignKey("uae_customers.id"), nullable=False),
        sa.Column("description", sa.String(500), nullable=False),
        sa.Column("amount", sa.Numeric(15, 2), nullable=False),
        sa.Column("vat_rate", sa.Numeric(5, 2), server_default="5", nullable=False),
        sa.Column("recurrence_type", sa.String(20), nullable=False),
        sa.Column("interval", sa.Integer(), server_default="1", nullable=False),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("next_due_date", sa.Date(), nullable=False),
        sa.Column("end_date", sa.Date(), nullable=True),
        sa.Column("status", sa.String(20), server_default="active", nullable=False),
        sa.Column("last_generated_at", sa.DateTime(), nullable=True),
        sa.Column("generated_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
    )
    op.add_column(
        "uae_sales_invoices",
        sa.Column(
            "recurring_template_id",
            sa.String(36),
            sa.ForeignKey("uae_recurring_invoices.id"),
            nullable=True,
            index=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("uae_sales_invoices", "recurring_template_id")
    op.drop_table("uae_recurring_invoices")
