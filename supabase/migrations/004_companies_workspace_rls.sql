-- Allow FinReportAI (anon key, no Supabase auth session) to read workspace-linked companies
-- and the default demo tenant (my-company).
DROP POLICY IF EXISTS companies_workspace_linked_select ON public.companies;
CREATE POLICY companies_workspace_linked_select ON public.companies
  FOR SELECT TO public
  USING (workspace_id IS NOT NULL OR slug = 'my-company');

NOTIFY pgrst, 'reload schema';
