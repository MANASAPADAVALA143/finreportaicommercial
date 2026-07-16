-- 029_fix_rls_recursion.sql
-- Fixes infinite recursion: companies_select ↔ company_members circular RLS.
-- Run in Supabase SQL editor after 028_ap_tenant_rls_fix.sql.
-- Safe to re-run (CREATE OR REPLACE + DROP POLICY IF EXISTS).

-- Helper: all company_ids the current user belongs to (bypasses RLS).
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

-- Helper: can current user admin a company (for member invites).
CREATE OR REPLACE FUNCTION public.user_can_admin_company(cid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.company_members m
    WHERE m.company_id = cid
      AND m.user_id = auth.uid()
      AND m.is_active = true
      AND m.role IN ('owner', 'admin', 'super_admin')
  );
$$;

-- Patch get_effective_company_id to bypass RLS on internal lookups.
CREATE OR REPLACE FUNCTION public.get_effective_company_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
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

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.company_members m
    WHERE m.user_id = auth.uid()
      AND m.is_active
      AND m.role = 'super_admin'
  );
$$;

GRANT EXECUTE ON FUNCTION public.user_visible_company_ids() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.user_can_admin_company(uuid) TO anon, authenticated;

-- companies: no inline company_members subquery (that caused recursion on joins).
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS companies_select ON public.companies;
CREATE POLICY companies_select ON public.companies
  FOR SELECT TO public
  USING (
    public.is_super_admin()
    OR id IN (SELECT public.user_visible_company_ids())
    OR id = public.get_effective_company_id()
    OR (auth.uid() IS NULL AND slug = 'my-company')
  );

-- company_members: use SECURITY DEFINER helpers only.
ALTER TABLE public.company_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_members_select ON public.company_members;
CREATE POLICY company_members_select ON public.company_members
  FOR SELECT TO public
  USING (
    public.is_super_admin()
    OR user_id = auth.uid()
    OR company_id IN (SELECT public.user_visible_company_ids())
  );

DROP POLICY IF EXISTS company_members_insert ON public.company_members;
CREATE POLICY company_members_insert ON public.company_members
  FOR INSERT TO public
  WITH CHECK (
    public.is_super_admin()
    OR user_id = auth.uid()
    OR (
      user_id IS NULL
      AND public.user_can_admin_company(company_id)
    )
  );

NOTIFY pgrst, 'reload schema';
