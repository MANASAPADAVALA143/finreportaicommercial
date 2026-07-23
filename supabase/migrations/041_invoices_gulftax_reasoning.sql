-- Fix 6: optional GulfTax classification audit columns on AP invoices
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS trn_valid BOOLEAN,
  ADD COLUMN IF NOT EXISTS gulftax_reasoning TEXT;
