-- Invoice numbers are vendor-issued, so they only need to be unique within one company.
-- A global UNIQUE(invoice_number) blocks a second company from importing the same file and
-- made imports silently move another company's rows. Mirrors 057_po_grn_unique_per_company.sql.
-- Idempotent; applied by the backend at startup.

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT i.indexrelid::regclass::text AS idx, c.conname
    FROM pg_index i
    LEFT JOIN pg_constraint c ON c.conindid = i.indexrelid AND c.conrelid = i.indrelid
    WHERE i.indrelid = 'public.invoices'::regclass
      AND i.indisunique
      AND NOT i.indisprimary
      AND i.indnatts = 1
      AND pg_get_indexdef(i.indexrelid) ILIKE '%(invoice_number)%'
  LOOP
    IF r.conname IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.invoices DROP CONSTRAINT %I', r.conname);
    ELSE
      EXECUTE format('DROP INDEX IF EXISTS %s', r.idx);
    END IF;
  END LOOP;
END $$;

-- Non-partial so PostgREST upserts can target on_conflict=company_id,invoice_number
CREATE UNIQUE INDEX IF NOT EXISTS invoices_company_invoice_number_key
  ON public.invoices (company_id, invoice_number);

CREATE INDEX IF NOT EXISTS idx_invoices_invoice_number
  ON public.invoices (invoice_number);

NOTIFY pgrst, 'reload schema';
