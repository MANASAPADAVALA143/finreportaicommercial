"""GL mapping CFO AI Harness columns

Revision ID: 006
Revises: 005
"""

from alembic import op
import sqlalchemy as sa

revision = "006"
down_revision = "005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("gl_mappings", sa.Column("validator_checked", sa.Boolean(), nullable=False, server_default=sa.text("0")))
    op.add_column("gl_mappings", sa.Column("validator_passed", sa.Boolean(), nullable=False, server_default=sa.text("0")))
    op.add_column("gl_mappings", sa.Column("validator_issues", sa.JSON(), nullable=True))
    op.add_column("gl_mappings", sa.Column("validator_score", sa.Float(), nullable=True))
    op.add_column("gl_mappings", sa.Column("is_contra", sa.Boolean(), nullable=False, server_default=sa.text("0")))
    op.add_column("gl_mappings", sa.Column("locked", sa.Boolean(), nullable=False, server_default=sa.text("0")))
    op.alter_column("gl_mappings", "validator_checked", server_default=None)
    op.alter_column("gl_mappings", "validator_passed", server_default=None)
    op.alter_column("gl_mappings", "is_contra", server_default=None)
    op.alter_column("gl_mappings", "locked", server_default=None)


def downgrade() -> None:
    op.drop_column("gl_mappings", "locked")
    op.drop_column("gl_mappings", "is_contra")
    op.drop_column("gl_mappings", "validator_score")
    op.drop_column("gl_mappings", "validator_issues")
    op.drop_column("gl_mappings", "validator_passed")
    op.drop_column("gl_mappings", "validator_checked")
