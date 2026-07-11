-- DPDP / privacy: consent records for email invoice processing (per company).
-- Run in Supabase SQL Editor after ap_invoice_full_schema / multi-tenant RLS.

CREATE TABLE IF NOT EXISTS public.consent_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  consent_type text NOT NULL,
  accepted_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  accepted_by_email text,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  consent_version text NOT NULL,
  ip_address inet,
  user_agent text,
  withdrawn_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_consent_log_company_type
  ON public.consent_log (company_id, consent_type, accepted_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_consent_log_active_per_company_type
  ON public.consent_log (company_id, consent_type)
  WHERE withdrawn_at IS NULL;

COMMENT ON TABLE public.consent_log IS
  'Immutable consent grants; withdrawal sets withdrawn_at (do not delete rows).';

CREATE OR REPLACE FUNCTION public.has_active_email_intake_consent(p_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.consent_log
    WHERE company_id = p_company_id
      AND consent_type = 'email_invoice_processing'
      AND withdrawn_at IS NULL
  );
$$;

ALTER TABLE public.consent_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS consent_log_select_tenant ON public.consent_log;
CREATE POLICY consent_log_select_tenant ON public.consent_log
  FOR SELECT TO public
  USING (
    public.is_super_admin()
    OR company_id = public.get_effective_company_id()
  );

-- Writes go through FastAPI service role (not anon client).

DO $$
BEGIN
  IF to_regclass('public.email_inbox_config') IS NOT NULL THEN
    DROP POLICY IF EXISTS email_inbox_config_tenant ON public.email_inbox_config;
    EXECUTE $p$
      CREATE POLICY email_inbox_config_tenant ON public.email_inbox_config
        FOR ALL TO public
        USING (
          public.is_super_admin()
          OR company_id = public.get_effective_company_id()
        )
        WITH CHECK (
          public.is_super_admin()
          OR (
            company_id = public.get_effective_company_id()
            AND (
              is_active IS NOT TRUE
              OR public.has_active_email_intake_consent(company_id)
            )
          )
        );
    $p$;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
