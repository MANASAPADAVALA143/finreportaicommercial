"""Create RERA OS tables on RDS (rera_projects, bookings, payments, escrow, QPR, risk flags, webhook events).

Revision ID: 033_rera_os
Revises: 032_vat_classifier_transactions
Create Date: 2026-08-11
"""

from __future__ import annotations

from alembic import op

revision = "033_rera_os"
down_revision = "032_vat_classifier_transactions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS rera_projects (
          id VARCHAR(36) PRIMARY KEY,
          workspace_id VARCHAR(36) NOT NULL REFERENCES workspaces(id),
          name VARCHAR(256) NOT NULL,
          rera_number VARCHAR(64) NOT NULL,
          location VARCHAR(256),
          total_units INTEGER,
          total_project_cost NUMERIC(18, 2),
          total_collections_target NUMERIC(18, 2),
          escrow_percentage NUMERIC(5, 2) DEFAULT 70.0,
          construction_progress NUMERIC(5, 2) DEFAULT 0.0,
          utilization_percentage NUMERIC(5, 2) DEFAULT 0.0,
          escrow_balance NUMERIC(18, 2) DEFAULT 0.0,
          withdrawn NUMERIC(18, 2) DEFAULT 0.0,
          total_collected NUMERIC(18, 2) DEFAULT 0.0,
          start_date DATE,
          completion_date DATE,
          status VARCHAR(32) DEFAULT 'active',
          developer_pan VARCHAR(16),
          promoter_din VARCHAR(8),
          gstin VARCHAR(20),
          trn_number VARCHAR(20),
          qpr_deadline DATE,
          currency VARCHAR(3) DEFAULT 'AED',
          created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_rera_projects_workspace ON rera_projects (workspace_id)"
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS rera_bookings (
          id VARCHAR(36) PRIMARY KEY,
          project_id VARCHAR(36) NOT NULL REFERENCES rera_projects(id),
          unit_number VARCHAR(64),
          customer_name VARCHAR(256),
          customer_email VARCHAR(256),
          customer_phone VARCHAR(32),
          total_value NUMERIC(18, 2),
          booking_date DATE,
          payment_schedule JSONB DEFAULT '[]',
          status VARCHAR(32) DEFAULT 'active',
          oqood_status VARCHAR(32) DEFAULT 'pending',
          spa_id VARCHAR(128),
          created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
        )
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS idx_rera_bookings_project ON rera_bookings (project_id)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_rera_bookings_spa ON rera_bookings (spa_id)")

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS rera_payments (
          id VARCHAR(36) PRIMARY KEY,
          project_id VARCHAR(36) NOT NULL REFERENCES rera_projects(id),
          booking_id VARCHAR(36) NOT NULL REFERENCES rera_bookings(id),
          installment_number INTEGER,
          gross_amount NUMERIC(18, 2) DEFAULT 0,
          gst_amount NUMERIC(18, 2) DEFAULT 0,
          vat_amount NUMERIC(18, 2) DEFAULT 0,
          tds_amount NUMERIC(18, 2) DEFAULT 0,
          net_amount NUMERIC(18, 2) DEFAULT 0,
          escrow_split NUMERIC(18, 2) DEFAULT 0,
          payment_date DATE,
          payment_mode VARCHAR(32) DEFAULT 'bank_transfer',
          status VARCHAR(32) DEFAULT 'received',
          created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
        )
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS idx_rera_payments_project ON rera_payments (project_id)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_rera_payments_booking ON rera_payments (booking_id)")

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS rera_escrow_transactions (
          id VARCHAR(36) PRIMARY KEY,
          project_id VARCHAR(36) NOT NULL REFERENCES rera_projects(id),
          type VARCHAR(16) NOT NULL,
          amount NUMERIC(18, 2) DEFAULT 0,
          transaction_date DATE,
          purpose VARCHAR(256),
          approved_by VARCHAR(256),
          reference_no VARCHAR(128),
          source_payment_id VARCHAR(36) REFERENCES rera_payments(id),
          created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_rera_escrow_tx_project ON rera_escrow_transactions (project_id)"
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS rera_qpr_records (
          id VARCHAR(36) PRIMARY KEY,
          project_id VARCHAR(36) NOT NULL REFERENCES rera_projects(id),
          quarter VARCHAR(16) NOT NULL,
          total_collections NUMERIC(18, 2) DEFAULT 0,
          escrow_deposited NUMERIC(18, 2) DEFAULT 0,
          withdrawals NUMERIC(18, 2) DEFAULT 0,
          construction_progress NUMERIC(5, 2) DEFAULT 0,
          utilization NUMERIC(5, 2) DEFAULT 0,
          status VARCHAR(16) DEFAULT 'draft',
          generated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
        )
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS idx_rera_qpr_project ON rera_qpr_records (project_id)")

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS rera_risk_flags (
          id VARCHAR(36) PRIMARY KEY,
          project_id VARCHAR(36) NOT NULL REFERENCES rera_projects(id),
          severity VARCHAR(16) DEFAULT 'medium',
          category VARCHAR(32) NOT NULL,
          title VARCHAR(256) NOT NULL,
          description TEXT,
          resolved BOOLEAN DEFAULT FALSE,
          created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
        )
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS idx_rera_risk_flags_project ON rera_risk_flags (project_id)")

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS rera_webhook_events (
          id VARCHAR(36) PRIMARY KEY,
          idempotency_key VARCHAR(256) NOT NULL UNIQUE,
          workspace_id VARCHAR(36) REFERENCES workspaces(id),
          spa_id VARCHAR(128) NOT NULL,
          event_type VARCHAR(64),
          event_timestamp TIMESTAMP WITHOUT TIME ZONE,
          received_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW(),
          source VARCHAR(32) DEFAULT 'zoho_webhook',
          data JSONB,
          zoho_raw JSONB,
          is_dlq BOOLEAN DEFAULT FALSE,
          dlq_reason TEXT
        )
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS idx_rera_webhook_spa ON rera_webhook_events (spa_id)")
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_rera_webhook_workspace ON rera_webhook_events (workspace_id)"
    )
    op.execute("CREATE INDEX IF NOT EXISTS idx_rera_webhook_dlq ON rera_webhook_events (is_dlq)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS rera_webhook_events")
    op.execute("DROP TABLE IF EXISTS rera_risk_flags")
    op.execute("DROP TABLE IF EXISTS rera_qpr_records")
    op.execute("DROP TABLE IF EXISTS rera_escrow_transactions")
    op.execute("DROP TABLE IF EXISTS rera_payments")
    op.execute("DROP TABLE IF EXISTS rera_bookings")
    op.execute("DROP TABLE IF EXISTS rera_projects")
