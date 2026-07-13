-- AP AI training tables (vendor profiles, company intelligence, upload history)
-- Run in Supabase SQL Editor for project ftlycgfgbboxapxhlpad

CREATE TABLE IF NOT EXISTS public.vendor_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  vendor_name text NOT NULL,
  mean_amount numeric(15, 2) DEFAULT 0,
  std_deviation numeric(15, 2) DEFAULT 0,
  min_amount numeric(15, 2) DEFAULT 0,
  max_amount numeric(15, 2) DEFAULT 0,
  median_amount numeric(15, 2) DEFAULT 0,
  avg_invoices_per_month numeric(10, 2) DEFAULT 0,
  typical_gl_code text,
  typical_gl_confidence numeric(5, 2) DEFAULT 0,
  typical_ifrs_category text,
  historical_rejection_rate numeric(5, 4) DEFAULT 0,
  is_recurring boolean DEFAULT false,
  is_splitting_vendor boolean DEFAULT false,
  price_trend text DEFAULT 'stable' CHECK (price_trend IN ('stable', 'increasing', 'decreasing')),
  price_trend_pct numeric(8, 2) DEFAULT 0,
  training_invoice_count integer DEFAULT 0,
  training_date_from date,
  training_date_to date,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (company_id, vendor_name)
);

CREATE INDEX IF NOT EXISTS idx_vendor_profiles_company ON public.vendor_profiles(company_id);

CREATE TABLE IF NOT EXISTS public.ap_intelligence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL UNIQUE REFERENCES public.companies(id) ON DELETE CASCADE,
  avg_invoice_amount numeric(15, 2) DEFAULT 0,
  median_invoice_amount numeric(15, 2) DEFAULT 0,
  avg_invoices_per_month numeric(10, 2) DEFAULT 0,
  is_trained boolean DEFAULT false,
  training_invoice_count integer DEFAULT 0,
  training_date_from date,
  training_date_to date,
  last_trained_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.training_uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  file_name text,
  uploaded_at timestamptz DEFAULT now(),
  status text DEFAULT 'processing' CHECK (status IN ('processing', 'completed', 'failed')),
  rows_processed integer DEFAULT 0,
  vendors_profiled integer DEFAULT 0,
  gl_mappings_created integer DEFAULT 0,
  error_message text
);

CREATE INDEX IF NOT EXISTS idx_training_uploads_company ON public.training_uploads(company_id);

ALTER TABLE public.vendor_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ap_intelligence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.training_uploads ENABLE ROW LEVEL SECURITY;

-- RLS policies: apply via 028_ap_tenant_rls_fix.sql (tenant-scoped).
-- Do NOT add *_public_all policies here — they override tenant isolation.
