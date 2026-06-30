-- =============================================================================
-- AP Invoice MINIMAL bootstrap — run this first if ap_invoice_full_schema.sql fails
-- Project: finreportaicommercial (ftlycgfgbboxapxhlpad)
-- Safe to re-run (IF NOT EXISTS throughout)
-- =============================================================================

-- 1) Core invoice tables
CREATE TABLE IF NOT EXISTS public.invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number text UNIQUE NOT NULL,
  invoice_date date NOT NULL,
  due_date date NOT NULL,
  vendor_name text NOT NULL,
  vendor_email text,
  vendor_phone text,
  vendor_address text,
  total_amount decimal(15, 2) NOT NULL,
  subtotal_amount decimal(15, 2) DEFAULT 0,
  currency text DEFAULT 'USD',
  status text DEFAULT 'Processing',
  tax_type text DEFAULT 'None',
  tax_rate decimal(5, 2) DEFAULT 0,
  tax_amount decimal(15, 2) DEFAULT 0,
  tax_code text DEFAULT 'NONE',
  tax_breakdown jsonb DEFAULT '[]'::jsonb,
  file_url text,
  file_type text,
  ifrs_category text,
  ifrs_confidence decimal(5, 2),
  ifrs_explanation text,
  ifrs_manual_override boolean DEFAULT false,
  processing_time_seconds integer,
  approval_level text,
  risk_score decimal(5, 2),
  risk_flags jsonb DEFAULT '[]'::jsonb,
  risk_level text,
  po_number text,
  company_id uuid,
  vendor_trn text,
  vat_amount decimal(15, 2),
  vat_rate decimal(5, 2),
  vat_treatment text,
  exchange_rate_to_base numeric DEFAULT 1,
  invoice_language text DEFAULT 'en',
  gulftax_decision text,
  gulftax_risk_score numeric,
  gulftax_confidence numeric,
  description text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  created_by uuid,
  approved_by uuid,
  approved_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.invoice_line_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  description text NOT NULL,
  quantity decimal(10, 2) NOT NULL,
  unit_price decimal(15, 2) NOT NULL,
  total decimal(15, 2) NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  action text NOT NULL,
  field_changed text,
  old_value text,
  new_value text,
  user_id uuid,
  user_name text,
  created_at timestamptz DEFAULT now()
);

-- 2) Tenant company (AP multi-tenant)
CREATE TABLE IF NOT EXISTS public.companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text UNIQUE NOT NULL,
  industry text DEFAULT 'general',
  accounting_standard text DEFAULT 'IFRS',
  market text DEFAULT 'uae',
  subscription_tier text NOT NULL DEFAULT 'starter',
  subscription_status text NOT NULL DEFAULT 'trial',
  max_invoices_per_month int NOT NULL DEFAULT 100,
  max_users int NOT NULL DEFAULT 5,
  workspace_id text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS workspace_id text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_workspace_id
  ON public.companies(workspace_id)
  WHERE workspace_id IS NOT NULL;

INSERT INTO public.companies (name, slug, industry, market)
VALUES ('My Company', 'my-company', 'finance', 'uae')
ON CONFLICT (slug) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.app_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  setting_key text UNIQUE NOT NULL,
  setting_value text NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.company_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  company_name text,
  country text DEFAULT 'IN',
  base_currency text DEFAULT 'INR',
  accounting_standard text DEFAULT 'IND_AS',
  date_format text DEFAULT 'DD-MM-YYYY',
  timezone text DEFAULT 'Asia/Kolkata',
  fy_start text DEFAULT '04-01',
  company_type text,
  gst_registered text,
  tds_applicable text,
  export_zoho_enabled boolean DEFAULT true,
  export_tally_enabled boolean DEFAULT true,
  export_formats text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.company_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'viewer'
    CHECK (role IN ('super_admin', 'owner', 'admin', 'finance_manager', 'approver', 'viewer')),
  name text,
  email text,
  is_active boolean NOT NULL DEFAULT true,
  invited_at timestamptz DEFAULT now(),
  joined_at timestamptz,
  UNIQUE (company_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.company_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL UNIQUE REFERENCES public.companies(id) ON DELETE CASCADE,
  approval_flow jsonb DEFAULT '["Finance Manager", "CFO"]'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

INSERT INTO public.company_config (company_id)
SELECT id FROM public.companies WHERE slug = 'my-company'
ON CONFLICT (company_id) DO NOTHING;

-- Link invoices to default company
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id);

UPDATE public.invoices i
SET company_id = c.id
FROM public.companies c
WHERE c.slug = 'my-company' AND i.company_id IS NULL;

-- 3) RLS — demo-friendly public access
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ap_invoices_select" ON public.invoices;
DROP POLICY IF EXISTS "ap_invoices_insert" ON public.invoices;
DROP POLICY IF EXISTS "ap_invoices_update" ON public.invoices;
DROP POLICY IF EXISTS "ap_invoices_delete" ON public.invoices;

CREATE POLICY "ap_invoices_select" ON public.invoices FOR SELECT TO public USING (true);
CREATE POLICY "ap_invoices_insert" ON public.invoices FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "ap_invoices_update" ON public.invoices FOR UPDATE TO public USING (true) WITH CHECK (true);
CREATE POLICY "ap_invoices_delete" ON public.invoices FOR DELETE TO public USING (true);

DROP POLICY IF EXISTS "ap_line_items_all" ON public.invoice_line_items;
CREATE POLICY "ap_line_items_all" ON public.invoice_line_items FOR ALL TO public USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "ap_audit_logs_all" ON public.audit_logs;
CREATE POLICY "ap_audit_logs_all" ON public.audit_logs FOR ALL TO public USING (true) WITH CHECK (true);

ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS companies_workspace_linked_select ON public.companies;
CREATE POLICY companies_workspace_linked_select ON public.companies
  FOR SELECT TO public
  USING (workspace_id IS NOT NULL OR slug = 'my-company');

-- 4) Indexes
CREATE INDEX IF NOT EXISTS idx_invoices_status ON public.invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_company ON public.invoices(company_id);
CREATE INDEX IF NOT EXISTS idx_invoices_vendor_trn ON public.invoices(vendor_trn);

NOTIFY pgrst, 'reload schema';

-- Verify
SELECT 'invoices' AS tbl, COUNT(*) AS rows FROM public.invoices
UNION ALL
SELECT 'companies', COUNT(*) FROM public.companies;
