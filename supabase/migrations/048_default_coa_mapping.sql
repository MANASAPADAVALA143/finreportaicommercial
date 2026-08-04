-- Default + per-company COA mapping for AP VAT/IFRS treatment → GL codes.
-- Display layer uses these maps; approve-and-post continues to use invoice gl_* columns.

CREATE TABLE IF NOT EXISTS public.default_coa_mapping (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_key text NOT NULL UNIQUE,
  category_label text,
  gl_code text NOT NULL,
  gl_name text NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.company_coa_mapping (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  category_key text NOT NULL,
  gl_code text NOT NULL,
  gl_name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, category_key)
);

CREATE INDEX IF NOT EXISTS idx_company_coa_mapping_company
  ON public.company_coa_mapping (company_id);

-- Seed UAE IFRS / VAT treatment defaults (idempotent)
INSERT INTO public.default_coa_mapping (category_key, category_label, gl_code, gl_name, sort_order)
VALUES
  ('standard_rated', 'Standard rated (5% VAT) — AP control', '2100', 'Accounts Payable', 10),
  ('vat_input', 'VAT input recoverable (5%)', '1810', 'VAT Input Recoverable', 20),
  ('zero_rated', 'Zero rated', '2100', 'Accounts Payable', 30),
  ('exempt', 'Exempt', '2100', 'Accounts Payable', 40),
  ('out_of_scope', 'Out of scope', '2100', 'Accounts Payable', 50),
  ('blocked', 'Blocked / non-recoverable VAT (e.g. entertainment)', '6500', 'Non-Recoverable VAT Expense', 60)
ON CONFLICT (category_key) DO UPDATE SET
  category_label = EXCLUDED.category_label,
  gl_code = EXCLUDED.gl_code,
  gl_name = EXCLUDED.gl_name,
  sort_order = EXCLUDED.sort_order,
  updated_at = now();

ALTER TABLE public.default_coa_mapping ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_coa_mapping ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS default_coa_mapping_read ON public.default_coa_mapping;
CREATE POLICY default_coa_mapping_read ON public.default_coa_mapping
  FOR SELECT TO public USING (true);

DROP POLICY IF EXISTS company_coa_mapping_tenant ON public.company_coa_mapping;
CREATE POLICY company_coa_mapping_tenant ON public.company_coa_mapping
  FOR ALL TO public
  USING (
    company_id IN (
      SELECT m.company_id FROM public.company_members m
      WHERE m.user_id = auth.uid() AND COALESCE(m.is_active, true)
    )
  )
  WITH CHECK (
    company_id IN (
      SELECT m.company_id FROM public.company_members m
      WHERE m.user_id = auth.uid() AND COALESCE(m.is_active, true)
    )
  );

NOTIFY pgrst, 'reload schema';
