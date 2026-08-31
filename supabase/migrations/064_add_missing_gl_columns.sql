-- =============================================================================
-- Add missing GL classification columns on invoices.
--
-- invoiceGlFieldsFromResult() in frontend/src/utils/coaMapping.ts (and the
-- classify webhook handler in InvoiceUpload.tsx) writes these columns on
-- every IFRS-classified invoice save. Only gl_account_code actually existed
-- in the live database — every write of the other 8 fields has been failing
-- with PostgREST error 42703 ("column does not exist"), either silently
-- swallowed by a try/catch (GL classification never persisting) or, on the
-- initial single-invoice insert path where these fields are inlined into the
-- insert payload directly, failing the whole invoice save.
--
-- gl_account_code, gl_account_name, gl_account_type, gl_auto_suggested,
-- gl_code, gl_name were already written (but apparently never run) in
-- ap_invoice_full_schema.sql lines 432-435 and 769-770. gl_source,
-- gl_suggestion_source, gl_confirmed, gl_standard_ref were never defined
-- anywhere. This migration adds all 9 missing columns in one place,
-- idempotently, so which of the two categories a column falls into doesn't
-- matter — safe to run regardless of what already exists.
--
-- Note: NOT gl_confirmed's near-namesake grn_confirmed (goods-receipt-note
-- confirmation) — that's a separate, unrelated, already-existing column.
-- =============================================================================

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS gl_code text,
  ADD COLUMN IF NOT EXISTS gl_name text,
  ADD COLUMN IF NOT EXISTS gl_account_code text,
  ADD COLUMN IF NOT EXISTS gl_account_name text,
  ADD COLUMN IF NOT EXISTS gl_account_type text,
  ADD COLUMN IF NOT EXISTS gl_source text,
  ADD COLUMN IF NOT EXISTS gl_suggestion_source text,
  ADD COLUMN IF NOT EXISTS gl_confirmed boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS gl_auto_suggested boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS gl_standard_ref text;

-- Force PostgREST to pick up the new columns immediately rather than waiting
-- for its next periodic schema-cache refresh.
NOTIFY pgrst, 'reload schema';
