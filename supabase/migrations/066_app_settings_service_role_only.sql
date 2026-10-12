-- app_settings holds deployment-wide secrets (Zoho / QuickBooks client secrets and refresh tokens,
-- the email-intake mailbox password) and the n8n webhook URLs invoices are uploaded to.
-- The browser now reads and writes it only through the backend (/api/ap/shared-settings,
-- /api/ap/integrations/*), which uses the service role, so no Supabase session gets direct access.

DO $$
DECLARE
  pol record;
BEGIN
  IF to_regclass('public.app_settings') IS NOT NULL THEN
    ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
    FOR pol IN
      SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'app_settings'
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.app_settings', pol.policyname);
    END LOOP;
    REVOKE ALL ON public.app_settings FROM anon, authenticated;
  END IF;
END $$;
