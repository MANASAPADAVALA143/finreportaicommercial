"""earnings_reviews table for Earnings Reviewer module."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "009"
down_revision = "008"
branch_labels = None
depends_on = None


def upgrade():
    json_t = postgresql.JSONB().with_variant(sa.JSON(), "sqlite")
    op.create_table(
        "earnings_reviews",
        sa.Column("review_id", sa.String(length=40), nullable=False),
        sa.Column("entity_id", sa.String(length=128), nullable=False),
        sa.Column("period", sa.String(length=64), nullable=False),
        sa.Column("period_type", sa.String(length=16), nullable=False),
        sa.Column("currency", sa.String(length=8), nullable=False),
        sa.Column("company_name", sa.String(length=256), nullable=True),
        sa.Column("status", sa.String(length=24), nullable=False),
        sa.Column("variances_json", json_t, nullable=False),
        sa.Column("commentary_json", json_t, nullable=False),
        sa.Column("quality_score", sa.Float(), nullable=True),
        sa.Column("flags_json", json_t, nullable=False),
        sa.Column("headline_verdict", sa.String(length=32), nullable=True),
        sa.Column("total_seconds", sa.Float(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("approved_by", sa.String(length=256), nullable=True),
        sa.Column("approved_at", sa.DateTime(), nullable=True),
        sa.Column("snapshot_json", json_t, nullable=False),
        sa.PrimaryKeyConstraint("review_id"),
    )
    op.create_index("ix_earnings_reviews_entity_id", "earnings_reviews", ["entity_id"], unique=False)


def downgrade():
    op.drop_index("ix_earnings_reviews_entity_id", table_name="earnings_reviews")
    op.drop_table("earnings_reviews")
