"""Client data consolidation — AWS RDS tables with tenant_id + company_id.

Revision ID: 015_client_data_rds
Revises: 014_uae_company_id
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "015_client_data_rds"
down_revision = "014_uae_company_id"
branch_labels = None
depends_on = None

_json = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")


def upgrade() -> None:
    op.create_table(
        "tenants",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("name", sa.String(256), nullable=False),
        sa.Column("plan", sa.String(32), nullable=False, server_default="starter"),
        sa.Column("is_demo", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )

    with op.batch_alter_table("rbac_users") as batch:
        batch.add_column(sa.Column("tenant_id", sa.String(36), nullable=True))
        batch.create_index("ix_rbac_users_tenant_id", ["tenant_id"])

    # Remaining tables created via SQLAlchemy init_db / create_all on deploy.
    # Run: alembic upgrade head && uvicorn (init_db ensures client_data tables)


def downgrade() -> None:
    with op.batch_alter_table("rbac_users") as batch:
        batch.drop_index("ix_rbac_users_tenant_id")
        batch.drop_column("tenant_id")
    op.drop_table("tenants")
