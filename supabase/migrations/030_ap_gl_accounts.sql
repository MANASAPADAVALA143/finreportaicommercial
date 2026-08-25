-- AP InvoiceFlow: gl_accounts table (creates if missing)
-- Safe to re-run. Prefer this when Supabase lacks public.gl_accounts.
-- If gl_accounts cannot be created, the app falls back to uae_chart_of_accounts.

CREATE TABLE IF NOT EXISTS public.gl_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  gl_code text NOT NULL,
  gl_name text NOT NULL,
  account_type text NOT NULL,
  department text,
  cost_center text,
  is_active boolean DEFAULT true,
  imported_from text,
  standard_reference text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT gl_accounts_valid_account_type CHECK (
    account_type IN ('Asset', 'Liability', 'Equity', 'Revenue', 'Expense', 'COGS')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS gl_accounts_company_code_uidx
  ON public.gl_accounts (company_id, gl_code);

CREATE INDEX IF NOT EXISTS idx_gl_accounts_code ON public.gl_accounts (gl_code);
CREATE INDEX IF NOT EXISTS idx_gl_accounts_active ON public.gl_accounts (is_active);
CREATE INDEX IF NOT EXISTS idx_gl_accounts_company ON public.gl_accounts (company_id);

ALTER TABLE public.gl_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read access to gl_accounts" ON public.gl_accounts;
DROP POLICY IF EXISTS "Allow public insert access to gl_accounts" ON public.gl_accounts;
DROP POLICY IF EXISTS "Allow public update access to gl_accounts" ON public.gl_accounts;
DROP POLICY IF EXISTS "Allow public delete access to gl_accounts" ON public.gl_accounts;
DROP POLICY IF EXISTS gl_accounts_tenant ON public.gl_accounts;
DROP POLICY IF EXISTS gl_accounts_all ON public.gl_accounts;

CREATE POLICY gl_accounts_all ON public.gl_accounts
  FOR ALL TO public
  USING (true)
  WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
