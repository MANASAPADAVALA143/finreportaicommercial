-- ============================================================
-- PRIORITY 1 — India mode schema (AP InvoiceFlow)
-- Project: ftlycgfgbboxapxhlpad
-- Run AFTER 031 tables exist. Safe to re-run.
-- Company: 0deaa402-f6a1-4c38-90e8-711f4fd0aa09 (My Company)
-- NOTE: This company already has UAE IFRS GL rows on the same codes.
--       Option A (below) uses ON CONFLICT DO UPDATE so India labels win for testing.
--       Swap to DO NOTHING if you only want net-new codes.
-- Do NOT run against GulfTax / UAE Finance Suite schemas.
-- ============================================================

-- a0) gst_treatment on gl_accounts (India GST; UAE keeps vat_treatment)
ALTER TABLE public.gl_accounts
  ADD COLUMN IF NOT EXISTS gst_treatment text
  CHECK (
    gst_treatment IS NULL
    OR gst_treatment IN ('taxable', 'exempt', 'nil_rated', 'zero_rated', 'non_gst')
  );

COMMENT ON COLUMN public.gl_accounts.gst_treatment IS
  'India GST treatment: taxable | exempt | nil_rated | zero_rated | non_gst';

-- a1) Seed India Ind AS / IGAAP chart (same company_id for dual-market testing)
INSERT INTO public.gl_accounts (
  company_id, gl_code, gl_name, account_type, gst_treatment, vat_treatment,
  is_active, imported_from, standard_reference
) VALUES
  ('0deaa402-f6a1-4c38-90e8-711f4fd0aa09', '1000', 'Fixed Assets',              'Asset',     'non_gst',  NULL, true, 'india_indas_seed', 'Ind AS 16'),
  ('0deaa402-f6a1-4c38-90e8-711f4fd0aa09', '1100', 'Cash & Bank',                'Asset',     'non_gst',  NULL, true, 'india_indas_seed', 'Ind AS 7'),
  ('0deaa402-f6a1-4c38-90e8-711f4fd0aa09', '2100', 'Sundry Creditors',           'Liability', 'taxable',  NULL, true, 'india_indas_seed', 'Ind AS 1'),
  ('0deaa402-f6a1-4c38-90e8-711f4fd0aa09', '2200', 'GST Payable',                'Liability', 'taxable',  NULL, true, 'india_indas_seed', 'GST'),
  ('0deaa402-f6a1-4c38-90e8-711f4fd0aa09', '4000', 'Sales/Revenue',              'Revenue',   'taxable',  NULL, true, 'india_indas_seed', 'Ind AS 115'),
  ('0deaa402-f6a1-4c38-90e8-711f4fd0aa09', '5000', 'Cost of Materials',          'COGS',      'taxable',  NULL, true, 'india_indas_seed', 'Ind AS 2'),
  ('0deaa402-f6a1-4c38-90e8-711f4fd0aa09', '6000', 'Employee Costs',             'Expense',   'exempt',   NULL, true, 'india_indas_seed', 'Ind AS 19'),
  ('0deaa402-f6a1-4c38-90e8-711f4fd0aa09', '6100', 'Professional Charges',       'Expense',   'taxable',  NULL, true, 'india_indas_seed', 'Ind AS 1'),
  ('0deaa402-f6a1-4c38-90e8-711f4fd0aa09', '6200', 'Rent',                       'Expense',   'taxable',  NULL, true, 'india_indas_seed', 'Ind AS 116'),
  ('0deaa402-f6a1-4c38-90e8-711f4fd0aa09', '6300', 'Power & Fuel',               'Expense',   'taxable',  NULL, true, 'india_indas_seed', 'Ind AS 1'),
  ('0deaa402-f6a1-4c38-90e8-711f4fd0aa09', '6400', 'Advertisement Expenses',     'Expense',   'taxable',  NULL, true, 'india_indas_seed', 'Ind AS 1'),
  ('0deaa402-f6a1-4c38-90e8-711f4fd0aa09', '6500', 'Travelling Expenses',        'Expense',   'taxable',  NULL, true, 'india_indas_seed', 'Ind AS 1'),
  ('0deaa402-f6a1-4c38-90e8-711f4fd0aa09', '6600', 'IT & Software',              'Expense',   'taxable',  NULL, true, 'india_indas_seed', 'Ind AS 38'),
  ('0deaa402-f6a1-4c38-90e8-711f4fd0aa09', '7000', 'Depreciation',               'Expense',   'non_gst',  NULL, true, 'india_indas_seed', 'Ind AS 16'),
  ('0deaa402-f6a1-4c38-90e8-711f4fd0aa09', '7100', 'Finance Charges',            'Expense',   'exempt',   NULL, true, 'india_indas_seed', 'Ind AS 23')
ON CONFLICT (company_id, gl_code) DO UPDATE SET
  gl_name            = EXCLUDED.gl_name,
  account_type       = EXCLUDED.account_type,
  gst_treatment      = EXCLUDED.gst_treatment,
  imported_from      = EXCLUDED.imported_from,
  standard_reference = EXCLUDED.standard_reference,
  updated_at         = now();

-- If you prefer NOT to overwrite UAE IFRS names, replace the ON CONFLICT clause with:
-- ON CONFLICT (company_id, gl_code) DO NOTHING;

-- b) India-specific invoice columns
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS gstin VARCHAR(15),
  ADD COLUMN IF NOT EXISTS gst_amount NUMERIC(15,2),
  ADD COLUMN IF NOT EXISTS cgst_amount NUMERIC(15,2),
  ADD COLUMN IF NOT EXISTS sgst_amount NUMERIC(15,2),
  ADD COLUMN IF NOT EXISTS igst_amount NUMERIC(15,2),
  ADD COLUMN IF NOT EXISTS tds_amount NUMERIC(15,2),
  ADD COLUMN IF NOT EXISTS tds_section VARCHAR(20),
  ADD COLUMN IF NOT EXISTS hsn_sac_code VARCHAR(20),
  ADD COLUMN IF NOT EXISTS place_of_supply VARCHAR(50),
  ADD COLUMN IF NOT EXISTS reverse_charge BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS gstr2b_matched BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS gstr2b_match_date TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_invoices_gstin
  ON public.invoices (gstin)
  WHERE gstin IS NOT NULL AND gstin <> '';

NOTIFY pgrst, 'reload schema';

-- Verify GL seed
SELECT gl_code, gl_name, account_type, gst_treatment, standard_reference, imported_from
FROM public.gl_accounts
WHERE company_id = '0deaa402-f6a1-4c38-90e8-711f4fd0aa09'
ORDER BY gl_code;

-- Verify invoice GST columns
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'invoices'
  AND column_name IN (
    'gstin','gst_amount','cgst_amount','sgst_amount','igst_amount',
    'tds_amount','tds_section','hsn_sac_code','place_of_supply',
    'reverse_charge','gstr2b_matched','gstr2b_match_date'
  )
ORDER BY 1;
