-- 046_industry_config.sql
-- Industry-aware workspace: config lookup + cost centers master
-- Note: companies.industry / industry_label already added in 045

-- Industry config lookup table
CREATE TABLE IF NOT EXISTS public.industry_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  industry TEXT UNIQUE NOT NULL,
  industry_label TEXT NOT NULL,
  cost_center_label TEXT NOT NULL,
  cost_center_placeholder TEXT,
  ap_label TEXT,
  ar_label TEXT,
  sidebar_theme TEXT,
  show_ifrs15 BOOLEAN DEFAULT false,
  show_ifrs16 BOOLEAN DEFAULT false,
  show_rera BOOLEAN DEFAULT false,
  show_ejari BOOLEAN DEFAULT false,
  show_property_tagging BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed all industries
INSERT INTO public.industry_config (
  industry, industry_label, cost_center_label,
  cost_center_placeholder, ap_label, ar_label,
  sidebar_theme, show_ifrs15, show_ifrs16,
  show_rera, show_ejari, show_property_tagging
)
VALUES
  ('real_estate', 'Real Estate & Property',
   'Property', 'Select property...',
   'Vendor Payments', 'Rent & Sales Invoices',
   'real_estate', true, true, true, true, true),
  ('construction', 'Construction',
   'Site / Project', 'Select site...',
   'Subcontractor Invoices', 'Progress Claims',
   'construction', false, false, false, false, true),
  ('manufacturing', 'Manufacturing',
   'Plant / Division', 'Select plant...',
   'Supplier Invoices', 'Customer Invoices',
   'manufacturing', false, false, false, false, true),
  ('healthcare', 'Healthcare',
   'Branch / Clinic', 'Select branch...',
   'Supplier Invoices', 'Patient Billing',
   'healthcare', false, true, false, false, true),
  ('retail', 'Retail',
   'Store / Outlet', 'Select store...',
   'Supplier Invoices', 'Sales Invoices',
   'retail', false, true, false, false, true),
  ('ca_firm', 'CA Firm / Accounting',
   'Client', 'Select client...',
   'Vendor Invoices', 'Client Billing',
   'ca_firm', true, true, false, false, true),
  ('general', 'General Business',
   'Cost Center', 'Select cost center...',
   'Vendor Invoices', 'Sales Invoices',
   'general', false, false, false, false, true)
ON CONFLICT (industry) DO NOTHING;

-- Cost centers master table (per company)
CREATE TABLE IF NOT EXISTS public.cost_centers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  name TEXT NOT NULL,
  code TEXT,
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cost_centers_company_id
  ON public.cost_centers (company_id);

CREATE INDEX IF NOT EXISTS idx_cost_centers_company_active
  ON public.cost_centers (company_id, is_active);

-- RLS on cost_centers (tenant isolation via company_members)
ALTER TABLE public.cost_centers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cost_centers_company_isolation" ON public.cost_centers;
CREATE POLICY "cost_centers_company_isolation"
ON public.cost_centers
FOR ALL
USING (
  company_id IN (
    SELECT m.company_id
    FROM public.company_members m
    WHERE m.user_id = auth.uid()
      AND COALESCE(m.is_active, true) = true
  )
)
WITH CHECK (
  company_id IN (
    SELECT m.company_id
    FROM public.company_members m
    WHERE m.user_id = auth.uid()
      AND COALESCE(m.is_active, true) = true
  )
);

-- AP invoices live in public.invoices (not ap_invoices)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'invoices'
  ) THEN
    ALTER TABLE public.invoices
      ADD COLUMN IF NOT EXISTS cost_center_id UUID REFERENCES public.cost_centers(id);
  END IF;
END $$;

-- AR sales invoices (only if table exists in this project)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'uae_sales_invoices'
  ) THEN
    ALTER TABLE public.uae_sales_invoices
      ADD COLUMN IF NOT EXISTS cost_center_id UUID REFERENCES public.cost_centers(id);
  END IF;
END $$;

-- RLS on industry_config (global read-only catalog)
ALTER TABLE public.industry_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "industry_config_read_all" ON public.industry_config;
CREATE POLICY "industry_config_read_all"
ON public.industry_config
FOR SELECT
USING (true);

NOTIFY pgrst, 'reload schema';
