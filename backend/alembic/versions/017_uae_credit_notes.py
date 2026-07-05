"""Add uae_credit_notes table for AR credit notes.

Revision ID: 017_uae_credit_notes
Revises: 016_unify_company_id
"""

from alembic import op
import sqlalchemy as sa

revision = "017_uae_credit_notes"
down_revision = "016_unify_company_id"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "uae_credit_notes",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("tenant_id", sa.String(36), nullable=False, index=True),
        sa.Column("company_id", sa.String(36), nullable=True, index=True),
        sa.Column("customer_id", sa.String(36), sa.ForeignKey("uae_customers.id"), nullable=True),
        sa.Column(
            "parent_invoice_id",
            sa.String(36),
            sa.ForeignKey("uae_sales_invoices.id"),
            nullable=False,
            index=True,
        ),
        sa.Column("credit_note_number", sa.String(30), nullable=False),
        sa.Column("amount", sa.Numeric(15, 2), nullable=False),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("status", sa.String(20), server_default="issued", nullable=False),
        sa.Column("issued_date", sa.Date(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("uae_credit_notes")
