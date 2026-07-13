-- Patch: re-apply tenant RLS on training tables after 022 was run post-028.
-- Run in finreportaicommercial SQL Editor. Requires get_effective_company_id() from 028.

DROP POLICY IF EXISTS vendor_profiles_public_all ON public.vendor_profiles;
DROP POLICY IF EXISTS ap_intelligence_public_all ON public.ap_intelligence;
DROP POLICY IF EXISTS training_uploads_public_all ON public.training_uploads;

DROP POLICY IF EXISTS vendor_profiles_tenant ON public.vendor_profiles;
CREATE POLICY vendor_profiles_tenant ON public.vendor_profiles
  FOR ALL TO public
  USING (public.is_super_admin() OR company_id = public.get_effective_company_id())
  WITH CHECK (public.is_super_admin() OR company_id = public.get_effective_company_id());

DROP POLICY IF EXISTS ap_intelligence_tenant ON public.ap_intelligence;
CREATE POLICY ap_intelligence_tenant ON public.ap_intelligence
  FOR ALL TO public
  USING (public.is_super_admin() OR company_id = public.get_effective_company_id())
  WITH CHECK (public.is_super_admin() OR company_id = public.get_effective_company_id());

DROP POLICY IF EXISTS training_uploads_tenant ON public.training_uploads;
CREATE POLICY training_uploads_tenant ON public.training_uploads
  FOR ALL TO public
  USING (public.is_super_admin() OR company_id = public.get_effective_company_id())
  WITH CHECK (public.is_super_admin() OR company_id = public.get_effective_company_id());

NOTIFY pgrst, 'reload schema';
