-- VAT Advanced: status column + RLS so authenticated GulfTax users can save

ALTER TABLE public.partial_exemption_calculations
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft';

ALTER TABLE public.bad_debt_relief_claims
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft';

ALTER TABLE public.partial_exemption_calculations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bad_debt_relief_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.designated_zone_transactions ENABLE ROW LEVEL SECURITY;

-- Authenticated app users (Supabase JWT) can read/write their rows
DROP POLICY IF EXISTS pe_auth_all ON public.partial_exemption_calculations;
CREATE POLICY pe_auth_all ON public.partial_exemption_calculations
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS bd_auth_all ON public.bad_debt_relief_claims;
CREATE POLICY bd_auth_all ON public.bad_debt_relief_claims
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS dz_auth_all ON public.designated_zone_transactions;
CREATE POLICY dz_auth_all ON public.designated_zone_transactions
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- service_role already bypasses RLS; keep grants
GRANT SELECT, INSERT, UPDATE ON partial_exemption_calculations TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON bad_debt_relief_claims TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON designated_zone_transactions TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
