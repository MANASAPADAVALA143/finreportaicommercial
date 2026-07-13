-- IFRS 15 contract register (FinReportAI workspace tenancy)
-- Matches backend/app/models/ifrs15_contract.py
-- Run this in Supabase SQL editor if ifrs15_contracts does not exist yet.

CREATE TABLE IF NOT EXISTS ifrs15_contracts (
  id                      TEXT PRIMARY KEY,
  workspace_id            TEXT NOT NULL,
  company_id              TEXT,
  contract_number         TEXT NOT NULL,
  customer_name           TEXT NOT NULL,
  contract_date           TEXT,
  contract_value_aed      NUMERIC(15, 2) DEFAULT 0,
  performance_obligations TEXT,
  total_recognised_aed    NUMERIC(15, 2) DEFAULT 0,
  total_remaining_aed     NUMERIC(15, 2) DEFAULT 0,
  contract_liability_aed  NUMERIC(15, 2) DEFAULT 0,
  contract_asset_aed      NUMERIC(15, 2) DEFAULT 0,
  calculation_json        TEXT,
  status                  TEXT DEFAULT 'active',
  je_posted               BOOLEAN DEFAULT FALSE,
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW()
);

-- Safe if table already existed from an older partial deploy (column-only patch)
ALTER TABLE ifrs15_contracts ADD COLUMN IF NOT EXISTS calculation_json TEXT;

CREATE INDEX IF NOT EXISTS idx_ifrs15_contracts_workspace
  ON ifrs15_contracts (workspace_id);

CREATE INDEX IF NOT EXISTS idx_ifrs15_contracts_company
  ON ifrs15_contracts (company_id)
  WHERE company_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ifrs15_contracts_status
  ON ifrs15_contracts (status);

NOTIFY pgrst, 'reload schema';
