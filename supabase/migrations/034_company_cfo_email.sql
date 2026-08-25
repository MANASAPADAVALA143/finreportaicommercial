-- Per-company CFO email for daily cron briefs (no hardcoded CFO_EMAIL required per client)
ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS cfo_email text;

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS admin_email text;

COMMENT ON COLUMN public.company_settings.cfo_email IS
  'Primary recipient for daily CFO AP briefing (per company)';
COMMENT ON COLUMN public.companies.admin_email IS
  'Fallback admin/CFO contact when company_settings.cfo_email is empty';

NOTIFY pgrst, 'reload schema';
