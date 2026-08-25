"""Unify company_id on uae_purchase_invoices and fpa_master_data → ap_companies.

Revision ID: 016_unify_company_id
Revises: 015_client_data_rds
"""

from alembic import op
import sqlalchemy as sa

revision = "016_unify_company_id"
down_revision = "015_client_data_rds"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("uae_purchase_invoices") as batch:
        batch.add_column(sa.Column("company_id", sa.String(36), nullable=True))
        batch.create_index("ix_uae_purchase_invoices_company_id", ["company_id"])
        batch.create_foreign_key(
            "fk_uae_purchase_invoices_company_id",
            "ap_companies",
            ["company_id"],
            ["id"],
        )

    with op.batch_alter_table("fpa_master_data") as batch:
        try:
            batch.alter_column("company_id", existing_type=sa.String(64), type_=sa.String(36))
        except Exception:
            pass
        try:
            batch.create_foreign_key(
                "fk_fpa_master_data_company_id",
                "ap_companies",
                ["company_id"],
                ["id"],
            )
        except Exception:
            pass


def downgrade() -> None:
    with op.batch_alter_table("fpa_master_data") as batch:
        try:
            batch.drop_constraint("fk_fpa_master_data_company_id", type_="foreignkey")
        except Exception:
            pass

    with op.batch_alter_table("uae_purchase_invoices") as batch:
        batch.drop_constraint("fk_uae_purchase_invoices_company_id", type_="foreignkey")
        batch.drop_index("ix_uae_purchase_invoices_company_id")
        batch.drop_column("company_id")
