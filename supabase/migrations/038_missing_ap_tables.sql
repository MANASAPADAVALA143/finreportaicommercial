-- Creates 5 tables that live frontend code has referenced for a while but that
-- no migration in this repo ever created (confirmed missing via a live
-- information_schema.columns query against Supabase — zero rows returned).
-- Columns below are inferred directly from how the code reads/writes each
-- table (see references in each section). Two other tables flagged in the
-- same audit — inbound_leads, uae_chart_of_accounts — already exist live
-- with a real schema and are intentionally left untouched here.
-- Safe to re-run (IF NOT EXISTS throughout).

-- 1) chart_of_accounts — GL coding lookup for invoices
-- Used by: frontend/src/utils/coaMapping.ts, frontend/src/pages/ap-invoices/InvoiceList.tsx
CREATE TABLE IF NOT EXISTS public.chart_of_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  gl_code text NOT NULL,
  account_name text,
  ifrs_mapping text,
  department text,
  cost_center text,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chart_of_accounts_company ON public.chart_of_accounts(company_id);
CREATE INDEX IF NOT EXISTS idx_chart_of_accounts_gl_code ON public.chart_of_accounts(gl_code);
CREATE INDEX IF NOT EXISTS idx_chart_of_accounts_ifrs_mapping ON public.chart_of_accounts(ifrs_mapping);

-- 2) gl_suggestions_log — telemetry for AI-suggested GL codes
-- Used by: frontend/src/lib/ap-invoice/accountingStandardService.ts
CREATE TABLE IF NOT EXISTS public.gl_suggestions_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  invoice_id uuid REFERENCES public.invoices(id) ON DELETE CASCADE,
  ifrs_category text,
  suggested_code text,
  suggested_name text,
  accounting_standard text,
  action text,
  final_code text,
  final_name text,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gl_suggestions_log_company ON public.gl_suggestions_log(company_id);
CREATE INDEX IF NOT EXISTS idx_gl_suggestions_log_invoice ON public.gl_suggestions_log(invoice_id);

-- 3) vendor_history — audit trail for vendor bank/detail changes
-- Used by: frontend/src/lib/ap-invoice/vendorMasterService.ts
CREATE TABLE IF NOT EXISTS public.vendor_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid REFERENCES public.vendors(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  changed_by text,
  change_type text NOT NULL,
  field_changed text,
  old_value text,
  new_value text,
  change_reason text,
  approved_by text,
  approved_at timestamptz,
  requires_approval boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vendor_history_vendor ON public.vendor_history(vendor_id);
CREATE INDEX IF NOT EXISTS idx_vendor_history_company ON public.vendor_history(company_id);

-- 4) payment_batches — grouped "batch export" of selected invoices for payment
-- Used by: frontend/src/lib/ap-invoice/paymentService.ts
CREATE TABLE IF NOT EXISTS public.payment_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  batch_date date NOT NULL,
  invoice_ids uuid[] NOT NULL DEFAULT '{}',
  total_amount numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft',
  created_by text,
  notes text,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payment_batches_company ON public.payment_batches(company_id);

-- 5) ap_audit_log — comprehensive AP audit trail (Module 4)
-- Used by: frontend/src/lib/ap-invoice/apAuditService.ts
CREATE TABLE IF NOT EXISTS public.ap_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  entity_id text,
  action text NOT NULL,
  action_by text,
  action_by_role text,
  old_values jsonb,
  new_values jsonb,
  ip_address text,
  user_agent text,
  notes text,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ap_audit_log_company ON public.ap_audit_log(company_id);
CREATE INDEX IF NOT EXISTS idx_ap_audit_log_entity ON public.ap_audit_log(entity_type, entity_id);

-- RLS: tenant-scoped where the shared helper functions exist (see 028/029),
-- permissive fallback otherwise — same pattern used across this project's
-- other migrations (e.g. 031_ap_priority1_2_tables.sql, 037).
DO $$
DECLARE
  t text;
  has_tenant_fns boolean := to_regprocedure('public.is_super_admin()') IS NOT NULL
    AND to_regprocedure('public.get_effective_company_id()') IS NOT NULL;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'chart_of_accounts', 'gl_suggestions_log', 'vendor_history',
    'payment_batches', 'ap_audit_log'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_tenant', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_all', t);
    IF has_tenant_fns THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR ALL TO public USING (public.is_super_admin() OR company_id = public.get_effective_company_id()) WITH CHECK (public.is_super_admin() OR company_id = public.get_effective_company_id())',
        t || '_tenant', t
      );
    ELSE
      EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO public USING (true) WITH CHECK (true)', t || '_all', t);
    END IF;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
