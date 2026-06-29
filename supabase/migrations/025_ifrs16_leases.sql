-- IFRS 16 lease register (FinReportAI workspace tenancy)
-- Matches backend/app/models/ifrs16_lease.py

CREATE TABLE IF NOT EXISTS ifrs16_leases (
  id                        TEXT PRIMARY KEY,
  workspace_id              TEXT NOT NULL,
  company_id                TEXT,
  lease_name                TEXT NOT NULL,
  asset_description         TEXT,
  asset_class               TEXT DEFAULT 'property',
  commencement_date         DATE NOT NULL,
  lease_term_months         INTEGER NOT NULL,
  lease_payments_aed        NUMERIC(15, 2),
  payment_frequency         TEXT DEFAULT 'monthly',
  incremental_borrowing_rate NUMERIC(8, 6),
  rou_asset_initial         NUMERIC(15, 2),
  lease_liability_initial   NUMERIC(15, 2),
  rou_asset_current         NUMERIC(15, 2),
  lease_liability_current   NUMERIC(15, 2),
  accumulated_depreciation  NUMERIC(15, 2) DEFAULT 0,
  depreciation_ytd          NUMERIC(15, 2) DEFAULT 0,
  interest_ytd              NUMERIC(15, 2) DEFAULT 0,
  status                    TEXT DEFAULT 'active',
  next_remeasurement_date   DATE,
  contract_file_url         TEXT,
  je_posted                 BOOLEAN DEFAULT FALSE,
  last_je_date              DATE,
  calculation_json          TEXT,
  created_at                TIMESTAMPTZ DEFAULT NOW(),
  updated_at                TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ifrs16_leases_workspace
  ON ifrs16_leases (workspace_id);

CREATE INDEX IF NOT EXISTS idx_ifrs16_leases_company
  ON ifrs16_leases (company_id)
  WHERE company_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ifrs16_leases_status
  ON ifrs16_leases (status);

NOTIFY pgrst, 'reload schema';
