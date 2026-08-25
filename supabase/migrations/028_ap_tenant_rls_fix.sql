-- 028_ap_tenant_rls_fix.sql
-- Idempotent tenant RLS for finreportaicommercial (ftlycgfgbboxapxhlpad).
-- Safe to re-run: drops every policy on target tables before CREATE.
--
-- Option B: orphan agent tables (zero FinReportAI call sites) — RLS on, no
-- permissive policy for anon/authenticated (service_role bypasses RLS).
--
-- NOTE: public.agent_config (TABLE) is NOT company_config.agent_config (JSONB).
-- Live agent_config table: id, config_key, config_value, description — three
-- global seed rows (checkpoint_rules, notification_config, autonomy_stages).
-- Unused by current code; lock only, do not delete.
--
-- Run after bootstrap / 017 / 020 / 022. Requires company_members + companies.

-- ── 1) RLS helper functions ─────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_my_company_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT company_id
  FROM public.company_members
  WHERE user_id = auth.uid() AND is_active = true
  ORDER BY joined_at NULLS LAST, invited_at
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.company_members m
    WHERE m.user_id = auth.uid()
      AND m.is_active
      AND m.role = 'super_admin'
  );
$$;

CREATE OR REPLACE FUNCTION public.get_effective_company_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  jwt jsonb := coalesce(auth.jwt(), '{}'::jsonb);
  meta text := jwt #>> '{user_metadata,active_company_id}';
  meta_uuid uuid;
  mid uuid;
  def uuid;
BEGIN
  SELECT c.id INTO def FROM public.companies c WHERE c.slug = 'my-company' LIMIT 1;

  IF uid IS NULL THEN
    RETURN def;
  END IF;

  IF meta IS NOT NULL AND btrim(meta) <> '' THEN
    BEGIN
      meta_uuid := meta::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      meta_uuid := NULL;
    END;
    IF meta_uuid IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.company_members m
      WHERE m.user_id = uid AND m.is_active AND m.company_id = meta_uuid
    ) THEN
      RETURN meta_uuid;
    END IF;
  END IF;

  SELECT m.company_id INTO mid
  FROM public.company_members m
  WHERE m.user_id = uid AND m.is_active
  ORDER BY m.joined_at NULLS LAST, m.invited_at
  LIMIT 1;

  IF mid IS NOT NULL THEN
    RETURN mid;
  END IF;

  RETURN def;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_company_id() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_effective_company_id() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_super_admin() TO anon, authenticated;

-- ── 2) Utility: drop ALL policies on a table (any policy name) ───────────────

CREATE OR REPLACE FUNCTION public._drop_all_policies_on(p_table regclass)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pol record;
  tbl text := p_table::text;
  sch text;
  rel text;
BEGIN
  IF p_table IS NULL THEN
    RETURN;
  END IF;
  sch := split_part(tbl, '.', 1);
  rel := split_part(tbl, '.', 2);
  FOR pol IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = sch AND tablename = rel
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %s', pol.policyname, tbl);
  END LOOP;
END;
$$;

-- ── 3) Option B — lock orphan agent / unused tables ──────────────────────────
-- agent_config here is a TABLE (not company_config.agent_config JSONB).
-- FinReportAI has zero .from() call sites for these four tables.

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'agent_config',
    'agent_decisions',
    'autonomy_metrics',
    'vendor_trust',
    'audit_leads'
  ]
  LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      PERFORM public._drop_all_policies_on(to_regclass('public.' || t));
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
      -- Intentionally no CREATE POLICY: authenticated/anon denied; service_role OK.
    END IF;
  END LOOP;
END $$;

-- ── 4) Backfill company_id on tenant tables (nullable rows → default company) ─

DO $$
DECLARE
  default_company_id uuid;
  t text;
BEGIN
  SELECT id INTO default_company_id FROM public.companies WHERE slug = 'my-company' LIMIT 1;
  IF default_company_id IS NULL THEN
    RETURN;
  END IF;

  FOREACH t IN ARRAY ARRAY[
    'invoices', 'vendors', 'gl_accounts', 'approval_rules', 'purchase_orders',
    'goods_receipts', 'vendor_profiles', 'ap_intelligence', 'training_uploads',
    'match_results', 'audit_log', 'ap_audit_log', 'bank_guarantees',
    'company_settings', 'chart_of_accounts', 'gl_suggestions_log',
    'payment_batches', 'gstr2b_entries', 'fraud_scan_results',
    'email_inbox_config', 'email_intake_log'
  ]
  LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id)',
        t
      );
      EXECUTE format(
        'UPDATE public.%I SET company_id = $1 WHERE company_id IS NULL',
        t
      ) USING default_company_id;
    END IF;
  END LOOP;
END $$;

-- ── 5) Drop every bootstrap / open policy on tenant tables ───────────────────

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'companies', 'company_members', 'company_config', 'company_settings',
    'invoices', 'invoice_line_items', 'audit_logs', 'audit_log', 'ap_audit_log',
    'vendors', 'vendor_profiles', 'gl_accounts', 'purchase_orders', 'goods_receipts',
    'grn_line_items', 'match_results', 'approval_rules', 'invoice_approvals',
    'ap_intelligence', 'training_uploads', 'consent_log',
    'email_inbox_config', 'email_intake_log', 'bank_guarantees',
    'chart_of_accounts', 'gl_suggestions_log', 'payment_batches',
    'gstr2b_entries', 'fraud_scan_results', 'app_settings'
  ]
  LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      PERFORM public._drop_all_policies_on(to_regclass('public.' || t));
    END IF;
  END LOOP;
END $$;

-- ── 6) Tenant policies (DROP + CREATE — symmetric, idempotent) ───────────────

-- companies
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS companies_select ON public.companies;
CREATE POLICY companies_select ON public.companies
  FOR SELECT TO public
  USING (
    public.is_super_admin()
    OR id IN (
      SELECT m.company_id FROM public.company_members m
      WHERE m.user_id = auth.uid() AND m.is_active
    )
    OR (auth.uid() IS NULL AND slug = 'my-company')
  );

DROP POLICY IF EXISTS companies_insert ON public.companies;
CREATE POLICY companies_insert ON public.companies
  FOR INSERT TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS companies_update ON public.companies;
CREATE POLICY companies_update ON public.companies
  FOR UPDATE TO public
  USING (public.is_super_admin() OR id = public.get_effective_company_id())
  WITH CHECK (public.is_super_admin() OR id = public.get_effective_company_id());

-- company_config (includes agent_config JSONB — not the orphan agent_config table)
ALTER TABLE public.company_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_config_tenant ON public.company_config;
CREATE POLICY company_config_tenant ON public.company_config
  FOR ALL TO public
  USING (public.is_super_admin() OR company_id = public.get_effective_company_id())
  WITH CHECK (public.is_super_admin() OR company_id = public.get_effective_company_id());

-- company_members
ALTER TABLE public.company_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_members_select ON public.company_members;
CREATE POLICY company_members_select ON public.company_members
  FOR SELECT TO public
  USING (
    public.is_super_admin()
    OR company_id = public.get_effective_company_id()
    OR user_id = auth.uid()
  );

DROP POLICY IF EXISTS company_members_insert ON public.company_members;
CREATE POLICY company_members_insert ON public.company_members
  FOR INSERT TO public
  WITH CHECK (
    public.is_super_admin()
    OR user_id = auth.uid()
    OR (
      user_id IS NULL
      AND EXISTS (
        SELECT 1 FROM public.company_members x
        WHERE x.company_id = company_members.company_id
          AND x.user_id = auth.uid()
          AND x.is_active
          AND x.role IN ('owner', 'admin', 'super_admin')
      )
    )
  );

DROP POLICY IF EXISTS company_members_update ON public.company_members;
CREATE POLICY company_members_update ON public.company_members
  FOR UPDATE TO public
  USING (public.is_super_admin() OR company_id = public.get_effective_company_id())
  WITH CHECK (public.is_super_admin() OR company_id = public.get_effective_company_id());

-- company_settings
DO $$
BEGIN
  IF to_regclass('public.company_settings') IS NOT NULL THEN
    ALTER TABLE public.company_settings ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS company_settings_tenant ON public.company_settings;
    CREATE POLICY company_settings_tenant ON public.company_settings
      FOR ALL TO public
      USING (public.is_super_admin() OR company_id = public.get_effective_company_id())
      WITH CHECK (public.is_super_admin() OR company_id = public.get_effective_company_id());
  END IF;
END $$;

-- invoices
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS invoices_tenant ON public.invoices;
CREATE POLICY invoices_tenant ON public.invoices
  FOR ALL TO public
  USING (public.is_super_admin() OR company_id = public.get_effective_company_id())
  WITH CHECK (public.is_super_admin() OR company_id = public.get_effective_company_id());

-- invoice_line_items (via parent invoice)
ALTER TABLE public.invoice_line_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS invoice_line_items_tenant ON public.invoice_line_items;
CREATE POLICY invoice_line_items_tenant ON public.invoice_line_items
  FOR ALL TO public
  USING (
    EXISTS (
      SELECT 1 FROM public.invoices i
      WHERE i.id = invoice_line_items.invoice_id
        AND (public.is_super_admin() OR i.company_id = public.get_effective_company_id())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.invoices i
      WHERE i.id = invoice_line_items.invoice_id
        AND (public.is_super_admin() OR i.company_id = public.get_effective_company_id())
    )
  );

-- audit_logs (invoice-scoped trail — plural)
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS audit_logs_tenant ON public.audit_logs;
CREATE POLICY audit_logs_tenant ON public.audit_logs
  FOR ALL TO public
  USING (
    EXISTS (
      SELECT 1 FROM public.invoices i
      WHERE i.id = audit_logs.invoice_id
        AND (public.is_super_admin() OR i.company_id = public.get_effective_company_id())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.invoices i
      WHERE i.id = audit_logs.invoice_id
        AND (public.is_super_admin() OR i.company_id = public.get_effective_company_id())
    )
  );

-- audit_log (entity trail — singular, company_id direct)
DO $$
BEGIN
  IF to_regclass('public.audit_log') IS NOT NULL THEN
    ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS audit_log_tenant ON public.audit_log;
    CREATE POLICY audit_log_tenant ON public.audit_log
      FOR ALL TO public
      USING (public.is_super_admin() OR company_id = public.get_effective_company_id())
      WITH CHECK (public.is_super_admin() OR company_id = public.get_effective_company_id());
  END IF;
END $$;

-- ap_audit_log (comprehensive AP trail)
DO $$
BEGIN
  IF to_regclass('public.ap_audit_log') IS NOT NULL THEN
    ALTER TABLE public.ap_audit_log ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS ap_audit_log_tenant ON public.ap_audit_log;
    CREATE POLICY ap_audit_log_tenant ON public.ap_audit_log
      FOR ALL TO public
      USING (public.is_super_admin() OR company_id = public.get_effective_company_id())
      WITH CHECK (public.is_super_admin() OR company_id = public.get_effective_company_id());
  END IF;
END $$;

-- Macro for direct company_id tables
DO $$
DECLARE
  t text;
  pol text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'vendors', 'vendor_profiles', 'gl_accounts', 'purchase_orders', 'goods_receipts',
    'approval_rules', 'ap_intelligence', 'training_uploads', 'match_results',
    'bank_guarantees', 'chart_of_accounts', 'gl_suggestions_log', 'payment_batches',
    'gstr2b_entries', 'fraud_scan_results', 'email_inbox_config', 'email_intake_log'
  ]
  LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      CONTINUE;
    END IF;
    pol := t || '_tenant';
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol, t);
    EXECUTE format($p$
      CREATE POLICY %I ON public.%I
        FOR ALL TO public
        USING (public.is_super_admin() OR company_id = public.get_effective_company_id())
        WITH CHECK (public.is_super_admin() OR company_id = public.get_effective_company_id())
    $p$, pol, t);
  END LOOP;
END $$;

-- invoice_approvals (via invoice)
DO $$
BEGIN
  IF to_regclass('public.invoice_approvals') IS NOT NULL THEN
    ALTER TABLE public.invoice_approvals ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS invoice_approvals_tenant ON public.invoice_approvals;
    CREATE POLICY invoice_approvals_tenant ON public.invoice_approvals
      FOR ALL TO public
      USING (
        EXISTS (
          SELECT 1 FROM public.invoices i
          WHERE i.id = invoice_approvals.invoice_id
            AND (public.is_super_admin() OR i.company_id = public.get_effective_company_id())
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.invoices i
          WHERE i.id = invoice_approvals.invoice_id
            AND (public.is_super_admin() OR i.company_id = public.get_effective_company_id())
        )
      );
  END IF;
END $$;

-- grn_line_items (via goods_receipts)
DO $$
BEGIN
  IF to_regclass('public.grn_line_items') IS NOT NULL THEN
    ALTER TABLE public.grn_line_items ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS grn_line_items_tenant ON public.grn_line_items;
    CREATE POLICY grn_line_items_tenant ON public.grn_line_items
      FOR ALL TO public
      USING (
        EXISTS (
          SELECT 1 FROM public.goods_receipts gr
          WHERE gr.id = grn_line_items.grn_id
            AND (public.is_super_admin() OR gr.company_id = public.get_effective_company_id())
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.goods_receipts gr
          WHERE gr.id = grn_line_items.grn_id
            AND (public.is_super_admin() OR gr.company_id = public.get_effective_company_id())
        )
      );
  END IF;
END $$;

-- consent_log (read tenant; writes via service_role)
DO $$
BEGIN
  IF to_regclass('public.consent_log') IS NOT NULL THEN
    ALTER TABLE public.consent_log ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS consent_log_select_tenant ON public.consent_log;
    CREATE POLICY consent_log_select_tenant ON public.consent_log
      FOR SELECT TO public
      USING (
        public.is_super_admin()
        OR company_id = public.get_effective_company_id()
      );
  END IF;
END $$;

-- app_settings — global key/value (no company_id)
-- Tighter than bootstrap (no anon write); still allows any authenticated session
-- until webhook settings are moved behind service_role API.
DO $$
BEGIN
  IF to_regclass('public.app_settings') IS NOT NULL THEN
    ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS app_settings_select ON public.app_settings;
    CREATE POLICY app_settings_select ON public.app_settings
      FOR SELECT TO authenticated
      USING (true);

    DROP POLICY IF EXISTS app_settings_insert ON public.app_settings;
    CREATE POLICY app_settings_insert ON public.app_settings
      FOR INSERT TO authenticated
      WITH CHECK (true);

    DROP POLICY IF EXISTS app_settings_update ON public.app_settings;
    CREATE POLICY app_settings_update ON public.app_settings
      FOR UPDATE TO authenticated
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

-- Cleanup helper (optional leave in place for ops)
-- DROP FUNCTION IF EXISTS public._drop_all_policies_on(regclass);

NOTIFY pgrst, 'reload schema';
