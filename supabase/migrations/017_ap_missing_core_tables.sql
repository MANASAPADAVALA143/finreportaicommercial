-- =============================================================================
-- AP Invoice — missing core tables (company_settings, app_settings, company_members)
-- Run in Supabase SQL Editor for project ftlycgfgbboxapxhlpad
-- Safe to re-run (IF NOT EXISTS / DROP POLICY IF EXISTS)
-- =============================================================================

-- 1) App configuration (n8n webhook URLs, IFRS toggle, Tally, etc.)
CREATE TABLE IF NOT EXISTS public.app_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  setting_key text UNIQUE NOT NULL,
  setting_value text NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS app_settings_public_select ON public.app_settings;
DROP POLICY IF EXISTS app_settings_public_insert ON public.app_settings;
DROP POLICY IF EXISTS app_settings_public_update ON public.app_settings;
CREATE POLICY app_settings_public_select ON public.app_settings FOR SELECT TO public USING (true);
CREATE POLICY app_settings_public_insert ON public.app_settings FOR INSERT TO public WITH CHECK (true);
CREATE POLICY app_settings_public_update ON public.app_settings FOR UPDATE TO public USING (true) WITH CHECK (true);

-- 2) Per-company preferences (currency, accounting standard, exports)
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

CREATE INDEX IF NOT EXISTS idx_company_settings_company ON public.company_settings(company_id);
CREATE INDEX IF NOT EXISTS idx_company_settings_updated ON public.company_settings(updated_at DESC);

ALTER TABLE public.company_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_settings_public_all ON public.company_settings;
CREATE POLICY company_settings_public_all ON public.company_settings
  FOR ALL TO public USING (true) WITH CHECK (true);

-- 3) User ↔ tenant membership (required by getMyCompany / RLS helpers)
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

CREATE INDEX IF NOT EXISTS idx_company_members_user ON public.company_members(user_id);
CREATE INDEX IF NOT EXISTS idx_company_members_company ON public.company_members(company_id);

ALTER TABLE public.company_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_members_public_all ON public.company_members;
CREATE POLICY company_members_public_all ON public.company_members
  FOR ALL TO public USING (true) WITH CHECK (true);

-- 4) Link existing auth users to all companies (demo / multi-tenant bootstrap)
INSERT INTO public.company_members (company_id, user_id, role, joined_at, is_active)
SELECT c.id, u.id, 'owner', now(), true
FROM auth.users u
CROSS JOIN public.companies c
ON CONFLICT (company_id, user_id) DO NOTHING;

-- 5) Companies SELECT — allow workspace-linked rows and default demo tenant
DROP POLICY IF EXISTS companies_workspace_linked_select ON public.companies;
CREATE POLICY companies_workspace_linked_select ON public.companies
  FOR SELECT TO public
  USING (workspace_id IS NOT NULL OR slug = 'my-company');

NOTIFY pgrst, 'reload schema';

-- Verify
SELECT 'app_settings' AS tbl, COUNT(*) AS rows FROM public.app_settings
UNION ALL SELECT 'company_settings', COUNT(*) FROM public.company_settings
UNION ALL SELECT 'company_members', COUNT(*) FROM public.company_members;
