-- 050_invoices_rls_membership.sql
-- Allow invoice INSERT/UPDATE/SELECT for any company the user belongs to
-- (not only get_effective_company_id()). Fixes Excel bulk upload RLS rejections when
-- workspace-synced company_id differs from JWT active_company_id / first membership.
-- Safe to re-run.

CREATE OR REPLACE FUNCTION public.user_visible_company_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT m.company_id
  FROM public.company_members m
  WHERE m.user_id = auth.uid() AND m.is_active = true;
$$;

GRANT EXECUTE ON FUNCTION public.user_visible_company_ids() TO anon, authenticated;

DROP POLICY IF EXISTS invoices_tenant ON public.invoices;
CREATE POLICY invoices_tenant ON public.invoices
  FOR ALL TO public
  USING (
    public.is_super_admin()
    OR company_id = public.get_effective_company_id()
    OR company_id IN (SELECT public.user_visible_company_ids())
  )
  WITH CHECK (
    public.is_super_admin()
    OR company_id = public.get_effective_company_id()
    OR company_id IN (SELECT public.user_visible_company_ids())
  );

DROP POLICY IF EXISTS invoice_line_items_tenant ON public.invoice_line_items;
CREATE POLICY invoice_line_items_tenant ON public.invoice_line_items
  FOR ALL TO public
  USING (
    EXISTS (
      SELECT 1 FROM public.invoices i
      WHERE i.id = invoice_line_items.invoice_id
        AND (
          public.is_super_admin()
          OR i.company_id = public.get_effective_company_id()
          OR i.company_id IN (SELECT public.user_visible_company_ids())
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.invoices i
      WHERE i.id = invoice_line_items.invoice_id
        AND (
          public.is_super_admin()
          OR i.company_id = public.get_effective_company_id()
          OR i.company_id IN (SELECT public.user_visible_company_ids())
        )
    )
  );

DROP POLICY IF EXISTS audit_logs_tenant ON public.audit_logs;
CREATE POLICY audit_logs_tenant ON public.audit_logs
  FOR ALL TO public
  USING (
    EXISTS (
      SELECT 1 FROM public.invoices i
      WHERE i.id = audit_logs.invoice_id
        AND (
          public.is_super_admin()
          OR i.company_id = public.get_effective_company_id()
          OR i.company_id IN (SELECT public.user_visible_company_ids())
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.invoices i
      WHERE i.id = audit_logs.invoice_id
        AND (
          public.is_super_admin()
          OR i.company_id = public.get_effective_company_id()
          OR i.company_id IN (SELECT public.user_visible_company_ids())
        )
    )
  );
