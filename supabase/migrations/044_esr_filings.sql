-- ESR filings persistence for GulfTax Calculate ESR Status
CREATE TABLE IF NOT EXISTS public.esr_filings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID,
  company_id UUID,
  relevant_activity TEXT NOT NULL,
  directed_managed_uae BOOLEAN NOT NULL DEFAULT FALSE,
  cigas_uae BOOLEAN NOT NULL DEFAULT FALSE,
  uae_employees INTEGER NOT NULL DEFAULT 0,
  uae_expenditure NUMERIC(15, 2) NOT NULL DEFAULT 0,
  uae_assets NUMERIC(15, 2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  reasons JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_esr_filings_company
  ON public.esr_filings (company_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE ON public.esr_filings TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
