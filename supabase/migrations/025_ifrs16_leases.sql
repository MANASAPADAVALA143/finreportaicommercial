-- IFRS 16 lease register (FinReportAI workspace tenancy)
-- Matches backend/app/models/ifrs16_lease.py
-- Safe on existing tables: adds missing columns before indexes.

CREATE TABLE IF NOT EXISTS ifrs16_leases (
  id                        TEXT PRIMARY KEY,
  workspace_id              TEXT NOT NULL DEFAULT 'demo',
  company_id                TEXT,
  lease_name                TEXT NOT NULL DEFAULT 'Lease',
  asset_description         TEXT,
  asset_class               TEXT DEFAULT 'property',
  commencement_date         DATE,
  lease_term_months         INTEGER DEFAULT 12,
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

-- Patch legacy/stub tables created before FinReportAI port
ALTER TABLE ifrs16_leases ADD COLUMN IF NOT EXISTS workspace_id TEXT NOT NULL DEFAULT 'demo';
ALTER TABLE ifrs16_leases ADD COLUMN IF NOT EXISTS company_id TEXT;
ALTER TABLE ifrs16_leases ADD COLUMN IF NOT EXISTS lease_name TEXT NOT NULL DEFAULT 'Lease';
ALTER TABLE ifrs16_leases ADD COLUMN IF NOT EXISTS asset_description TEXT;
ALTER TABLE ifrs16_leases ADD COLUMN IF NOT EXISTS asset_class TEXT DEFAULT 'property';
ALTER TABLE ifrs16_leases ADD COLUMN IF NOT EXISTS commencement_date DATE;
ALTER TABLE ifrs16_leases ADD COLUMN IF NOT EXISTS lease_term_months INTEGER DEFAULT 12;
ALTER TABLE ifrs16_leases ADD COLUMN IF NOT EXISTS lease_payments_aed NUMERIC(15, 2);
ALTER TABLE ifrs16_leases ADD COLUMN IF NOT EXISTS payment_frequency TEXT DEFAULT 'monthly';
ALTER TABLE ifrs16_leases ADD COLUMN IF NOT EXISTS incremental_borrowing_rate NUMERIC(8, 6);
ALTER TABLE ifrs16_leases ADD COLUMN IF NOT EXISTS rou_asset_initial NUMERIC(15, 2);
ALTER TABLE ifrs16_leases ADD COLUMN IF NOT EXISTS lease_liability_initial NUMERIC(15, 2);
ALTER TABLE ifrs16_leases ADD COLUMN IF NOT EXISTS rou_asset_current NUMERIC(15, 2);
ALTER TABLE ifrs16_leases ADD COLUMN IF NOT EXISTS lease_liability_current NUMERIC(15, 2);
ALTER TABLE ifrs16_leases ADD COLUMN IF NOT EXISTS accumulated_depreciation NUMERIC(15, 2) DEFAULT 0;
ALTER TABLE ifrs16_leases ADD COLUMN IF NOT EXISTS depreciation_ytd NUMERIC(15, 2) DEFAULT 0;
ALTER TABLE ifrs16_leases ADD COLUMN IF NOT EXISTS interest_ytd NUMERIC(15, 2) DEFAULT 0;
ALTER TABLE ifrs16_leases ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active';
ALTER TABLE ifrs16_leases ADD COLUMN IF NOT EXISTS next_remeasurement_date DATE;
ALTER TABLE ifrs16_leases ADD COLUMN IF NOT EXISTS contract_file_url TEXT;
ALTER TABLE ifrs16_leases ADD COLUMN IF NOT EXISTS je_posted BOOLEAN DEFAULT FALSE;
ALTER TABLE ifrs16_leases ADD COLUMN IF NOT EXISTS last_je_date DATE;
ALTER TABLE ifrs16_leases ADD COLUMN IF NOT EXISTS calculation_json TEXT;
ALTER TABLE ifrs16_leases ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE ifrs16_leases ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_ifrs16_leases_workspace
  ON ifrs16_leases (workspace_id);

CREATE INDEX IF NOT EXISTS idx_ifrs16_leases_company
  ON ifrs16_leases (company_id)
  WHERE company_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ifrs16_leases_status
  ON ifrs16_leases (status);

NOTIFY pgrst, 'reload schema';
