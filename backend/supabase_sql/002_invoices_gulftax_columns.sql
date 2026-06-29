-- GulfTax columns for FinReportAI commercial Supabase (ftlycgfgbboxapxhlpad)
-- Prefer running the full schema first: supabase/migrations/ap_invoice_full_schema.sql
-- Use this file only if invoices table already exists and you need GulfTax columns only.

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS gulftax_decision TEXT,
  ADD COLUMN IF NOT EXISTS gulftax_risk_score NUMERIC,
  ADD COLUMN IF NOT EXISTS gulftax_confidence NUMERIC;

NOTIFY pgrst, 'reload schema';
