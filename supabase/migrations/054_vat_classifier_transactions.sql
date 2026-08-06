-- VAT Classifier staging / approved mirror (Supabase)
-- Complements RDS `transactions` used by the Classifier UI.

CREATE TABLE IF NOT EXISTS vat_classifier_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID,
  workspace_id TEXT,
  transaction_type VARCHAR(20),
  fta_box TEXT,
  net_amount NUMERIC,
  vat_amount NUMERIC,
  gross_amount NUMERIC,
  invoice_reference VARCHAR,
  vendor_name TEXT,
  source VARCHAR,
  transaction_date DATE,
  vat_category TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vat_classifier_tx_company
  ON vat_classifier_transactions (company_id);

CREATE INDEX IF NOT EXISTS idx_vat_classifier_tx_invoice_source
  ON vat_classifier_transactions (company_id, invoice_reference, source);

NOTIFY pgrst, 'reload schema';
