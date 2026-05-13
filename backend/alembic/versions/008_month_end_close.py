"""close_runs table for IFRS month-end close module."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "008"
down_revision = "007"
branch_labels = None
depends_on = None


def upgrade():
    json_type = postgresql.JSONB().with_variant(sa.JSON(), "sqlite")
    op.create_table(
        "close_runs",
        sa.Column("run_id", sa.String(length=64), nullable=False),
        sa.Column("entity_id", sa.String(length=128), nullable=False),
        sa.Column("period", sa.String(length=32), nullable=False),
        sa.Column("company_name", sa.String(length=256), nullable=True),
        sa.Column("currency", sa.String(length=8), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("checks_json", json_type, nullable=False),
        sa.Column("snapshot_json", json_type, nullable=False),
        sa.Column("audit_trail", json_type, nullable=False),
        sa.Column("total_seconds", sa.Float(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("approved_by", sa.String(length=256), nullable=True),
        sa.Column("approved_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("run_id"),
    )
    op.create_index("ix_close_runs_entity_id", "close_runs", ["entity_id"], unique=False)
    op.create_index("ix_close_runs_period", "close_runs", ["period"], unique=False)


def downgrade():
    op.drop_index("ix_close_runs_period", table_name="close_runs")
    op.drop_index("ix_close_runs_entity_id", table_name="close_runs")
    op.drop_table("close_runs")
