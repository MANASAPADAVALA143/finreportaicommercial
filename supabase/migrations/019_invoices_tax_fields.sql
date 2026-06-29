-- AP invoices — tax regime fields used by single-invoice upload & detail view
-- Fixes: "Could not find the 'tax_code' / 'tax_breakdown' column" on bulk import retries
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS tax_code text DEFAULT 'NONE';

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS tax_breakdown jsonb DEFAULT '[]'::jsonb;

NOTIFY pgrst, 'reload schema';
