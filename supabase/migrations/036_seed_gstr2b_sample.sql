-- ============================================================
-- P4 — Seed 5 sample GSTR-2B entries (filing_period 2026-07)
-- company: My Company 0deaa402-f6a1-4c38-90e8-711f4fd0aa09
-- ============================================================

-- Clear prior sample seed for this company/period (idempotent re-seed)
DELETE FROM public.gstr2b_entries
WHERE company_id = '0deaa402-f6a1-4c38-90e8-711f4fd0aa09'
  AND filing_period = '2026-07'
  AND company_gstin = '29AAAAA0000A1Z5';

INSERT INTO public.gstr2b_entries (
  company_id, company_gstin, supplier_gstin, supplier_name,
  invoice_number, invoice_date, taxable_value, igst, cgst, sgst, filing_period
) VALUES
  (
    '0deaa402-f6a1-4c38-90e8-711f4fd0aa09',
    '29AAAAA0000A1Z5',
    '29AABCU9603R1ZM',
    'Bangalore Office Supplies Pvt Ltd',
    'INV-IN-001',
    '2026-07-03',
    100000, 0, 9000, 9000,
    '2026-07'
  ),
  (
    '0deaa402-f6a1-4c38-90e8-711f4fd0aa09',
    '29AAAAA0000A1Z5',
    '27AADCB2230M1ZV',
    'Mumbai IT Services LLP',
    'INV-IN-002',
    '2026-07-08',
    50000, 9000, 0, 0,
    '2026-07'
  ),
  (
    '0deaa402-f6a1-4c38-90e8-711f4fd0aa09',
    '29AAAAA0000A1Z5',
    '07AAACW3775F1Z8',
    'Delhi Logistics Co',
    'INV-IN-003',
    '2026-07-12',
    25000, 0, 2250, 2250,
    '2026-07'
  ),
  (
    '0deaa402-f6a1-4c38-90e8-711f4fd0aa09',
    '29AAAAA0000A1Z5',
    '33AABCT1332L1ZA',
    'Chennai Power & Fuel Traders',
    'INV-IN-004',
    '2026-07-15',
    75000, 0, 6750, 6750,
    '2026-07'
  ),
  (
    '0deaa402-f6a1-4c38-90e8-711f4fd0aa09',
    '29AAAAA0000A1Z5',
    '19AABCM9910C1Z2',
    'Kolkata Marketing House',
    'INV-IN-005-UNMATCHED',
    '2026-07-20',
    12000, 0, 1080, 1080,
    '2026-07'
  );

-- Soft-link first two entries to existing invoices if invoice numbers match later uploads
UPDATE public.gstr2b_entries g
SET matched_invoice_id = i.id
FROM public.invoices i
WHERE g.company_id = i.company_id
  AND g.filing_period = '2026-07'
  AND g.invoice_number = i.invoice_number
  AND g.company_gstin = '29AAAAA0000A1Z5';

SELECT supplier_name, invoice_number, taxable_value, cgst, sgst, igst, matched_invoice_id
FROM public.gstr2b_entries
WHERE company_id = '0deaa402-f6a1-4c38-90e8-711f4fd0aa09'
  AND filing_period = '2026-07'
ORDER BY invoice_number;
