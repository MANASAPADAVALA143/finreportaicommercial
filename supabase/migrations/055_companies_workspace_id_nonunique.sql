-- Allow multiple AP companies per FinReport workspace (multi-company banner).
-- Previously UNIQUE(workspace_id) forced every upload onto the first company (Al Noor).

DROP INDEX IF EXISTS idx_companies_workspace_id;

CREATE INDEX IF NOT EXISTS idx_companies_workspace_id
  ON public.companies(workspace_id)
  WHERE workspace_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
