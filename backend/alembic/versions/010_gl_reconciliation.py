"""gl_reconciliations table."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "010"
down_revision = "009"
branch_labels = None
depends_on = None


def upgrade():
    json_t = postgresql.JSONB().with_variant(sa.JSON(), "sqlite")
    op.create_table(
        "gl_reconciliations",
        sa.Column("recon_id", sa.String(length=40), nullable=False),
        sa.Column("entity_id", sa.String(length=128), nullable=False),
        sa.Column("period", sa.String(length=32), nullable=False),
        sa.Column("account_code", sa.String(length=64), nullable=False),
        sa.Column("account_name", sa.String(length=256), nullable=True),
        sa.Column("currency", sa.String(length=8), nullable=False),
        sa.Column("company_name", sa.String(length=256), nullable=True),
        sa.Column("status", sa.String(length=24), nullable=False),
        sa.Column("summary_json", json_t, nullable=False),
        sa.Column("matches_json", json_t, nullable=False),
        sa.Column("unmatched_gl", json_t, nullable=False),
        sa.Column("unmatched_bank", json_t, nullable=False),
        sa.Column("suggested_jes", json_t, nullable=False),
        sa.Column("audit_trail", json_t, nullable=False),
        sa.Column("total_seconds", sa.Float(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("approved_by", sa.String(length=256), nullable=True),
        sa.Column("approved_at", sa.DateTime(), nullable=True),
        sa.Column("snapshot_json", json_t, nullable=False),
        sa.PrimaryKeyConstraint("recon_id"),
    )
    op.create_index("ix_gl_reconciliations_entity_id", "gl_reconciliations", ["entity_id"], unique=False)
    op.create_index("ix_gl_reconciliations_account_code", "gl_reconciliations", ["account_code"], unique=False)


def downgrade():
    op.drop_index("ix_gl_reconciliations_account_code", table_name="gl_reconciliations")
    op.drop_index("ix_gl_reconciliations_entity_id", table_name="gl_reconciliations")
    op.drop_table("gl_reconciliations")
