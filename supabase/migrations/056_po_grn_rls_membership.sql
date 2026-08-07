-- 056_po_grn_rls_membership.sql
-- Same fix as 050 for invoices: allow INSERT/UPDATE/SELECT on purchase_orders,
-- goods_receipts (+ line items), and match_results for any company the user
-- belongs to — not only get_effective_company_id().
--
-- Banner company (localStorage) can be Gnanova while JWT / first membership is
-- still Al Noor; PO Excel upload then stamps Gnanova company_id and RLS rejects.
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

DROP POLICY IF EXISTS purchase_orders_tenant ON public.purchase_orders;
CREATE POLICY purchase_orders_tenant ON public.purchase_orders
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

DROP POLICY IF EXISTS goods_receipts_tenant ON public.goods_receipts;
CREATE POLICY goods_receipts_tenant ON public.goods_receipts
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

DROP POLICY IF EXISTS grn_line_items_tenant ON public.grn_line_items;
CREATE POLICY grn_line_items_tenant ON public.grn_line_items
  FOR ALL TO public
  USING (
    EXISTS (
      SELECT 1 FROM public.goods_receipts gr
      WHERE gr.id = grn_line_items.grn_id
        AND (
          public.is_super_admin()
          OR gr.company_id = public.get_effective_company_id()
          OR gr.company_id IN (SELECT public.user_visible_company_ids())
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.goods_receipts gr
      WHERE gr.id = grn_line_items.grn_id
        AND (
          public.is_super_admin()
          OR gr.company_id = public.get_effective_company_id()
          OR gr.company_id IN (SELECT public.user_visible_company_ids())
        )
    )
  );

DROP POLICY IF EXISTS match_results_tenant ON public.match_results;
CREATE POLICY match_results_tenant ON public.match_results
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
