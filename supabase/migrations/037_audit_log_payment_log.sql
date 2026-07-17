-- Fixes two schema gaps surfaced by the frontend at runtime:
--   1. audit_log (singular, compliance trail written by auditService.ts) was never
--      created by any migration and/or is missing its `metadata` jsonb column
--      -> PostgREST 400 "Could not find the 'metadata' column of 'audit_log'"
--   2. payment_log (referenced by InvoiceDetailModal.tsx / PaymentLog.tsx) was never
--      created -> PostgREST 404 on GET/POST .../rest/v1/payment_log
-- Also adds the "Mark Paid" columns on invoices that payment_log's insert path
-- depends on (utr_number, payment_method, payment_date, payment_bank, payment_note,
-- payment_reference, payment_proof_url, paid_at). payment_status already exists
-- (see 021_invoices_payment_status.sql).
-- Safe to re-run (IF NOT EXISTS throughout).

-- 1) audit_log (singular, compliance UI schema)
CREATE TABLE IF NOT EXISTS public.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  entity_id text,
  action text NOT NULL,
  performed_by text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

-- Patch columns individually in case audit_log already exists from a prior
-- manual/partial setup without these columns (this is what threw the 400 above).
ALTER TABLE public.audit_log ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE;
ALTER TABLE public.audit_log ADD COLUMN IF NOT EXISTS entity_type text;
ALTER TABLE public.audit_log ADD COLUMN IF NOT EXISTS entity_id text;
ALTER TABLE public.audit_log ADD COLUMN IF NOT EXISTS action text;
ALTER TABLE public.audit_log ADD COLUMN IF NOT EXISTS performed_by text;
ALTER TABLE public.audit_log ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb;
ALTER TABLE public.audit_log ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_audit_log_company ON public.audit_log(company_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON public.audit_log(entity_type, entity_id);

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF to_regprocedure('public.is_super_admin()') IS NOT NULL
     AND to_regprocedure('public.get_effective_company_id()') IS NOT NULL THEN
    DROP POLICY IF EXISTS audit_log_tenant ON public.audit_log;
    CREATE POLICY audit_log_tenant ON public.audit_log
      FOR ALL TO public
      USING (public.is_super_admin() OR company_id = public.get_effective_company_id())
      WITH CHECK (public.is_super_admin() OR company_id = public.get_effective_company_id());
  ELSE
    DROP POLICY IF EXISTS audit_log_all ON public.audit_log;
    CREATE POLICY audit_log_all ON public.audit_log FOR ALL TO public USING (true) WITH CHECK (true);
  END IF;
END $$;

-- 2) payment_log (append-only "Mark Paid" trail)
CREATE TABLE IF NOT EXISTS public.payment_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  invoice_id uuid REFERENCES public.invoices(id) ON DELETE CASCADE,
  invoice_number text,
  vendor_name text,
  amount numeric,
  payment_method text,
  utr_number text,
  payment_date date,
  payment_bank text,
  payment_note text,
  paid_by text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_log_company ON public.payment_log(company_id);
CREATE INDEX IF NOT EXISTS idx_payment_log_invoice ON public.payment_log(invoice_id);

ALTER TABLE public.payment_log ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF to_regprocedure('public.is_super_admin()') IS NOT NULL
     AND to_regprocedure('public.get_effective_company_id()') IS NOT NULL THEN
    DROP POLICY IF EXISTS payment_log_tenant ON public.payment_log;
    CREATE POLICY payment_log_tenant ON public.payment_log
      FOR ALL TO public
      USING (public.is_super_admin() OR company_id = public.get_effective_company_id())
      WITH CHECK (public.is_super_admin() OR company_id = public.get_effective_company_id());
  ELSE
    DROP POLICY IF EXISTS payment_log_all ON public.payment_log;
    CREATE POLICY payment_log_all ON public.payment_log FOR ALL TO public USING (true) WITH CHECK (true);
  END IF;
END $$;

-- 3) "Mark Paid" columns on invoices (payment_status already added in 021)
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS utr_number text;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS payment_method text;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS payment_date date;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS payment_bank text;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS payment_note text;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS payment_reference text;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS payment_proof_url text;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS paid_at timestamptz;

-- PostgREST caches the schema; force a reload so the columns/tables above are
-- visible immediately instead of requiring an API restart.
NOTIFY pgrst, 'reload schema';
