-- AP invoices — OCR / extraction language (e.g. ar, hi, en)
-- Fixes: "Could not find the 'invoice_language' column of 'invoices' in the schema cache"
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS invoice_language text DEFAULT 'en';

NOTIFY pgrst, 'reload schema';
