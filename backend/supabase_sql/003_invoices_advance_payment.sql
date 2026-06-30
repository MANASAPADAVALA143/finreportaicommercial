-- Advance payment VAT columns for existing invoices tables
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS is_advance_payment BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS contract_value NUMERIC(15, 2),
  ADD COLUMN IF NOT EXISTS delivery_date DATE,
  ADD COLUMN IF NOT EXISTS advance_vat_amount NUMERIC(15, 2),
  ADD COLUMN IF NOT EXISTS remaining_vat_amount NUMERIC(15, 2);

NOTIFY pgrst, 'reload schema';
