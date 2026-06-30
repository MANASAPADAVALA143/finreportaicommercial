-- AP InvoiceFlow → GulfTax transaction store (agentic pipeline)
-- tenant boundary = company_id (maps to API param tenant_id)

CREATE TABLE IF NOT EXISTS gulftax_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL DEFAULT 'ap_invoiceflow',
  ap_invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
  company_id UUID NOT NULL,
  workspace_id TEXT,
  tax_period TEXT NOT NULL,
  transaction_date DATE NOT NULL,
  vendor_name TEXT,
  vendor_trn TEXT,
  invoice_number TEXT,
  gross_amount NUMERIC(15, 2) NOT NULL,
  vat_amount NUMERIC(15, 2) NOT NULL DEFAULT 0,
  net_amount NUMERIC(15, 2) GENERATED ALWAYS AS (gross_amount - vat_amount) STORED,
  vat_category TEXT NOT NULL,
  fta_box TEXT,
  direction TEXT NOT NULL DEFAULT 'input',
  status TEXT NOT NULL DEFAULT 'posted',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gulftax_tx_company_period
  ON gulftax_transactions (company_id, tax_period);

CREATE INDEX IF NOT EXISTS idx_gulftax_tx_ap_invoice
  ON gulftax_transactions (ap_invoice_id)
  WHERE ap_invoice_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_gulftax_tx_ap_invoice_unique
  ON gulftax_transactions (ap_invoice_id)
  WHERE ap_invoice_id IS NOT NULL AND status = 'posted';

NOTIFY pgrst, 'reload schema';
