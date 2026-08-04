-- Manual property / project tag for AP invoices.
-- AP InvoiceFlow uses public.invoices (not ap_invoices).

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS property_ref TEXT;

CREATE INDEX IF NOT EXISTS idx_invoices_property_ref
  ON public.invoices (property_ref)
  WHERE property_ref IS NOT NULL AND property_ref <> '';

COMMENT ON COLUMN public.invoices.property_ref IS
  'Manual property/project tag for AP InvoiceFlow. Future: Gnanova Real Estate CRM API.';

NOTIFY pgrst, 'reload schema';
