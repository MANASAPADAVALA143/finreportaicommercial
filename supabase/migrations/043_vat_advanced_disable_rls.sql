-- VAT Advanced: 042 enabled RLS and only allowed `authenticated`.
-- Browser clients often call PostgREST as `anon` (or with a non-Supabase JWT),
-- which caused: new row violates row-level security policy.
-- These tables are app-managed (workspace_id filtered in API); disable RLS
-- and keep explicit grants from 026.

ALTER TABLE public.partial_exemption_calculations DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.bad_debt_relief_claims DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.designated_zone_transactions DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pe_auth_all ON public.partial_exemption_calculations;
DROP POLICY IF EXISTS bd_auth_all ON public.bad_debt_relief_claims;
DROP POLICY IF EXISTS dz_auth_all ON public.designated_zone_transactions;

GRANT SELECT, INSERT, UPDATE ON partial_exemption_calculations TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON bad_debt_relief_claims TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON designated_zone_transactions TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
