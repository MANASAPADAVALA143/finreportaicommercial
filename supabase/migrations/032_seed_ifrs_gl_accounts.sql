-- ============================================================
-- PRIORITY 3 — Seed IFRS GL accounts into public.gl_accounts
-- Prerequisite: 031_ap_priority1_2_tables.sql (gl_accounts exists)
-- Company: My Company (0deaa402-f6a1-4c38-90e8-711f4fd0aa09)
-- Safe to re-run (ON CONFLICT DO NOTHING on company_id + gl_code)
-- ============================================================

INSERT INTO public.gl_accounts (
  company_id, gl_code, gl_name, account_type, vat_treatment, is_active, imported_from, standard_reference
)
VALUES
  ('0deaa402-f6a1-4c38-90e8-711f4fd0aa09', '1000', 'Property Plant & Equipment', 'Asset', 'standard', true, 'ifrs_seed', 'IAS 16'),
  ('0deaa402-f6a1-4c38-90e8-711f4fd0aa09', '1100', 'Cash & Bank', 'Asset', 'exempt', true, 'ifrs_seed', 'IAS 7'),
  ('0deaa402-f6a1-4c38-90e8-711f4fd0aa09', '1500', 'Intangible Assets', 'Asset', 'standard', true, 'ifrs_seed', 'IAS 38'),
  ('0deaa402-f6a1-4c38-90e8-711f4fd0aa09', '1810', 'Input VAT Recoverable', 'Asset', 'standard', true, 'ifrs_seed', 'IAS 12 / UAE VAT'),
  ('0deaa402-f6a1-4c38-90e8-711f4fd0aa09', '2100', 'Accounts Payable', 'Liability', 'standard', true, 'ifrs_seed', 'IAS 1'),
  ('0deaa402-f6a1-4c38-90e8-711f4fd0aa09', '2200', 'Output VAT Payable', 'Liability', 'standard', true, 'ifrs_seed', 'IAS 12 / UAE VAT'),
  ('0deaa402-f6a1-4c38-90e8-711f4fd0aa09', '5000', 'Cost of Sales', 'COGS', 'standard', true, 'ifrs_seed', 'IAS 2'),
  ('0deaa402-f6a1-4c38-90e8-711f4fd0aa09', '6000', 'Employee Benefits', 'Expense', 'exempt', true, 'ifrs_seed', 'IAS 19'),
  ('0deaa402-f6a1-4c38-90e8-711f4fd0aa09', '6100', 'Professional Services', 'Expense', 'standard', true, 'ifrs_seed', 'IAS 1'),
  ('0deaa402-f6a1-4c38-90e8-711f4fd0aa09', '6200', 'Lease Expense', 'Expense', 'standard', true, 'ifrs_seed', 'IFRS 16'),
  ('0deaa402-f6a1-4c38-90e8-711f4fd0aa09', '6300', 'Utilities', 'Expense', 'standard', true, 'ifrs_seed', 'IAS 1'),
  ('0deaa402-f6a1-4c38-90e8-711f4fd0aa09', '6400', 'Marketing & Advertising', 'Expense', 'standard', true, 'ifrs_seed', 'IAS 38'),
  ('0deaa402-f6a1-4c38-90e8-711f4fd0aa09', '6500', 'Travel & Entertainment', 'Expense', 'standard', true, 'ifrs_seed', 'IAS 1'),
  ('0deaa402-f6a1-4c38-90e8-711f4fd0aa09', '6600', 'IT & Technology', 'Expense', 'standard', true, 'ifrs_seed', 'IAS 38'),
  ('0deaa402-f6a1-4c38-90e8-711f4fd0aa09', '7000', 'Research & Development', 'Expense', 'standard', true, 'ifrs_seed', 'IAS 38'),
  ('0deaa402-f6a1-4c38-90e8-711f4fd0aa09', '7100', 'Finance Costs', 'Expense', 'exempt', true, 'ifrs_seed', 'IAS 23')
ON CONFLICT (company_id, gl_code) DO NOTHING;

-- After create: NOTIFY pgrst, 'reload schema';
SELECT gl_code, gl_name, account_type, vat_treatment
FROM public.gl_accounts
WHERE company_id = '0deaa402-f6a1-4c38-90e8-711f4fd0aa09'
ORDER BY gl_code;
