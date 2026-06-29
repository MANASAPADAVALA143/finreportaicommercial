-- GulfTax VAT Advanced modules: partial exemption, designated zones, bad debt relief

CREATE TABLE IF NOT EXISTS partial_exemption_calculations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL,
  company_id UUID,
  period TEXT NOT NULL,
  period_type TEXT NOT NULL DEFAULT 'quarterly',
  taxable_supplies NUMERIC(15, 2) NOT NULL,
  exempt_supplies NUMERIC(15, 2) NOT NULL,
  input_vat_paid NUMERIC(15, 2) NOT NULL,
  recovery_pct NUMERIC(8, 4) NOT NULL,
  recoverable_vat NUMERIC(15, 2) NOT NULL,
  irrecoverable_vat NUMERIC(15, 2) NOT NULL,
  provisional_pct NUMERIC(8, 4),
  annual_adjustment_required BOOLEAN NOT NULL DEFAULT FALSE,
  breakdown JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bad_debt_relief_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL,
  company_id UUID,
  invoice_number TEXT NOT NULL,
  invoice_date DATE NOT NULL,
  due_date DATE NOT NULL,
  invoice_amount NUMERIC(15, 2) NOT NULL,
  vat_amount NUMERIC(15, 2) NOT NULL,
  vat_return_period TEXT,
  written_off_date DATE,
  recovery_steps TEXT,
  connected_party BOOLEAN NOT NULL DEFAULT FALSE,
  eligible BOOLEAN NOT NULL DEFAULT FALSE,
  eligibility_reason TEXT,
  claim_period TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS designated_zone_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL,
  company_id UUID,
  supplier_location TEXT NOT NULL,
  customer_location TEXT NOT NULL,
  transaction_type TEXT NOT NULL,
  supplier_zone_name TEXT,
  customer_zone_name TEXT,
  vat_treatment TEXT NOT NULL,
  vat_rate NUMERIC(5, 2) NOT NULL DEFAULT 0,
  explanation TEXT NOT NULL,
  warning TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_partial_exemption_ws_period
  ON partial_exemption_calculations (workspace_id, period);

CREATE INDEX IF NOT EXISTS idx_bad_debt_ws_status
  ON bad_debt_relief_claims (workspace_id, status);

CREATE INDEX IF NOT EXISTS idx_dz_tx_ws
  ON designated_zone_transactions (workspace_id, created_at DESC);

-- Allow FinReportAI frontend (anon/authenticated) to read/write via PostgREST
GRANT SELECT, INSERT, UPDATE ON partial_exemption_calculations TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON bad_debt_relief_claims TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON designated_zone_transactions TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
