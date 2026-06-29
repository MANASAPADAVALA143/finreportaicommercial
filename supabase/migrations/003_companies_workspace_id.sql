-- Link FinReportAI workspaces (backend) to AP Supabase companies
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS workspace_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_workspace_id
  ON public.companies(workspace_id)
  WHERE workspace_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
