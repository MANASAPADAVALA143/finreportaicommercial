-- GulfTax AI tables for FinReportAI (ftlycgfgbboxapxhlpad)
-- Run in Supabase SQL editor if not using migration runner.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS vat_return_entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID,
  workspace_id TEXT,
  period TEXT,
  source TEXT,
  transaction_id TEXT,
  vendor_name TEXT,
  net_amount NUMERIC,
  vat_amount NUMERIC,
  vat_treatment TEXT,
  box_number INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ct_computations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID,
  workspace_id TEXT,
  fiscal_year TEXT,
  revenue NUMERIC,
  accounting_profit NUMERIC,
  taxable_income NUMERIC,
  ct_payable NUMERIC,
  effective_rate NUMERIC,
  entity_type TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS einvoice_validations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID,
  workspace_id TEXT,
  invoice_id TEXT,
  compliance_score NUMERIC,
  passed JSONB,
  errors JSONB,
  warnings JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vat_return_entries_workspace_period
  ON vat_return_entries (workspace_id, period);
