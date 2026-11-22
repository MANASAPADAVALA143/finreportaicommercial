-- =============================================================================
-- Manufacturing Raw Material Workflow — Synthetic Test Data
-- Run against a DEDICATED TEST workspace/company only.
-- Creates: 1 test company, 3 POs, 2 GRNs, 3 invoices.
-- After insert, run runAutoMatch for each invoice_id and check results.
-- =============================================================================

-- Step 1: Identify your test company_id (replace with actual UUID)
-- SELECT id, name FROM companies WHERE name ILIKE '%test%' LIMIT 5;
-- \set test_company_id 'YOUR-TEST-COMPANY-UUID-HERE'

-- =============================================================================
-- SCENARIO A — Full 3-way match (AED 48,000)
-- Invoice 48000 = PO 48000 = GRN 48000 → expected: full_match
-- =============================================================================

INSERT INTO purchase_orders (
  id, company_id, po_number, vendor_name, po_amount, currency, status, created_at, updated_at
) VALUES (
  gen_random_uuid(),
  :'test_company_id',
  'TEST-PO-MFG-A001',
  'Steel Coils Ltd',
  48000,
  'AED',
  'Open',
  now(), now()
) RETURNING id AS po_id_a;

-- Note po_id_a from above, insert GRN with that po_id
-- INSERT INTO goods_receipts (id, company_id, po_id, grn_number, vendor_name, received_amount, received_date, status, updated_at)
-- VALUES (gen_random_uuid(), :'test_company_id', :'po_id_a', 'TEST-GRN-MFG-A001', 'Steel Coils Ltd', 48000, current_date, 'confirmed', now());

INSERT INTO invoices (
  id, company_id, invoice_number, vendor_name, total_amount, currency,
  po_number, invoice_date, due_date, status, expense_category, source, updated_at
) VALUES (
  gen_random_uuid(),
  :'test_company_id',
  'TEST-INV-MFG-A001',
  'Steel Coils Ltd',
  48000,
  'AED',
  'TEST-PO-MFG-A001',
  current_date,
  current_date + 30,
  'Processing',
  'raw_material',
  'camera',
  now()
) RETURNING id AS invoice_id_a;
-- Expected after runAutoMatch:
--   match_status = 'three_way_matched'
--   po_amount = 48000, grn_amount = 48000
--   amount_variance_pct = 0.0
--   within_tolerance = true
--   auto_approved = true (if auto_approve_on_full_match = true)

-- =============================================================================
-- SCENARIO B — Variance: Invoice 33,600 / PO 32,000 / GRN 30,000
-- NOTE: 33600 / 32000 = 1.05 exactly → engine treats as UAE 5% VAT pair
--       Invoice vs PO variance = 0% (VAT-aware) → within_price_tolerance = true
--       GRN 30000 vs PO 32000 = 6.25% → grn_matches_po = FALSE
--       Invoice 33600 vs GRN 30000 = 10.7% → within_qty_tolerance = FALSE
--       Expected engine result: 'failed' (not 'amount_variance')
--       match_status on invoice = 'mismatch'
-- =============================================================================

INSERT INTO purchase_orders (
  id, company_id, po_number, vendor_name, po_amount, currency, status, created_at, updated_at
) VALUES (
  gen_random_uuid(),
  :'test_company_id',
  'TEST-PO-MFG-B001',
  'Copper Wire Industries',
  32000,
  'AED',
  'Open',
  now(), now()
) RETURNING id AS po_id_b;

-- INSERT GRN with po_id_b:
-- INSERT INTO goods_receipts (id, company_id, po_id, grn_number, vendor_name, received_amount, received_date, status, updated_at)
-- VALUES (gen_random_uuid(), :'test_company_id', :'po_id_b', 'TEST-GRN-MFG-B001', 'Copper Wire Industries', 30000, current_date, 'confirmed', now());

INSERT INTO invoices (
  id, company_id, invoice_number, vendor_name, total_amount, currency,
  po_number, invoice_date, due_date, status, expense_category, source, updated_at
) VALUES (
  gen_random_uuid(),
  :'test_company_id',
  'TEST-INV-MFG-B001',
  'Copper Wire Industries',
  33600,
  'AED',
  'TEST-PO-MFG-B001',
  current_date,
  current_date + 30,
  'Processing',
  'raw_material',
  'camera',
  now()
) RETURNING id AS invoice_id_b;
-- Expected after runAutoMatch:
--   match_status = 'mismatch'
--   po_amount = 32000, grn_amount = 30000
--   match_difference = 0 (Invoice/PO treated as VAT pair by engine)
--   exceptions: "GRN total differs from PO by 6.3% (limit 3%)"
--   exceptions: "Invoice vs GRN variance 10.7% exceeds 2%"
--   within_tolerance = false
--   IMPORTANT: Invoice vs PO will show 0% variance (VAT-aware) but GRN mismatch triggers 'failed'

-- =============================================================================
-- SCENARIO C — Missing GRN: Invoice 48,000 / PO 48,000 / No GRN
-- Expected depends on company require_grn_for_match setting:
--   require_grn_for_match = false (default) → engine = 'partial_match', status = 'matched'
--   require_grn_for_match = true            → engine = 'no_grn', status = 'partial'
-- =============================================================================

INSERT INTO purchase_orders (
  id, company_id, po_number, vendor_name, po_amount, currency, status, created_at, updated_at
) VALUES (
  gen_random_uuid(),
  :'test_company_id',
  'TEST-PO-MFG-C001',
  'Aluminium Sheet Co',
  48000,
  'AED',
  'Open',
  now(), now()
);

INSERT INTO invoices (
  id, company_id, invoice_number, vendor_name, total_amount, currency,
  po_number, invoice_date, due_date, status, expense_category, source, updated_at
) VALUES (
  gen_random_uuid(),
  :'test_company_id',
  'TEST-INV-MFG-C001',
  'Aluminium Sheet Co',
  48000,
  'AED',
  'TEST-PO-MFG-C001',
  current_date,
  current_date + 30,
  'Processing',
  'raw_material',
  'camera',
  now()
) RETURNING id AS invoice_id_c;
-- Expected after runAutoMatch (require_grn_for_match = false):
--   match_status = 'matched' (2-way match, no GRN required)
--   po_amount = 48000, grn_amount = null
--   amount_variance_pct = 0.0
--   within_tolerance = true
--   summary: "2-way match: PO TEST-PO-MFG-C001 · within tolerance · no GRN required"

-- =============================================================================
-- Verification query — run after calling runAutoMatch for each invoice_id
-- =============================================================================
SELECT
  invoice_number,
  expense_category,
  total_amount,
  po_number,
  po_amount,
  grn_amount,
  match_status,
  match_score,
  match_percentage AS variance_pct,
  match_difference AS variance_amount,
  match_notes,
  approval_status,
  status AS invoice_status,
  auto_matched
FROM invoices
WHERE company_id = :'test_company_id'
  AND invoice_number IN ('TEST-INV-MFG-A001', 'TEST-INV-MFG-B001', 'TEST-INV-MFG-C001')
ORDER BY invoice_number;

-- =============================================================================
-- Cleanup — run after testing
-- =============================================================================
-- DELETE FROM invoices WHERE company_id = :'test_company_id' AND invoice_number LIKE 'TEST-INV-MFG-%';
-- DELETE FROM goods_receipts WHERE company_id = :'test_company_id' AND grn_number LIKE 'TEST-GRN-MFG-%';
-- DELETE FROM purchase_orders WHERE company_id = :'test_company_id' AND po_number LIKE 'TEST-PO-MFG-%';
