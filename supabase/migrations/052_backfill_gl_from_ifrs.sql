-- =============================================================================
-- Backfill GL codes from ifrs_category for invoices missing gl_code
-- Company: ae7301ab-38ce-413f-9d76-c254b506d47a
-- Property cannot be invented — set via Excel "Property" column or invoice modal.
-- =============================================================================

UPDATE public.invoices i
SET
  gl_code = m.code,
  gl_account_code = m.code,
  gl_name = m.name,
  gl_account_name = m.name,
  updated_at = now()
FROM (
  VALUES
    ('Professional Services', '6100', 'Professional Fees'),
    ('IT Infrastructure', '1500', 'Fixed Assets IT'),
    ('IT Equipment', '1500', 'Fixed Assets IT'),
    ('Office Supplies', '6050', 'Office Expenses'),
    ('Utilities', '6300', 'Utilities Expense'),
    ('Marketing', '6400', 'Marketing & Ads'),
    ('Marketing & Advertising', '6400', 'Marketing & Ads'),
    ('Rent & Lease', '6500', 'Rent Expense'),
    ('Travel & Entertainment', '6600', 'Travel Expenses'),
    ('Industrial Supplies', '6050', 'Supply & Materials')
) AS m(ifrs_category, code, name)
WHERE i.company_id = 'ae7301ab-38ce-413f-9d76-c254b506d47a'::uuid
  AND i.ifrs_category IS NOT NULL
  AND trim(i.ifrs_category) = m.ifrs_category
  AND COALESCE(NULLIF(trim(i.gl_code), ''), NULLIF(trim(i.gl_account_code), '')) IS NULL;

-- Fallback: VAT treatment → AP control / expense when still blank
UPDATE public.invoices i
SET
  gl_code = '2100',
  gl_account_code = '2100',
  gl_name = 'Accounts Payable',
  gl_account_name = 'Accounts Payable',
  updated_at = now()
WHERE i.company_id = 'ae7301ab-38ce-413f-9d76-c254b506d47a'::uuid
  AND COALESCE(NULLIF(trim(i.gl_code), ''), NULLIF(trim(i.gl_account_code), '')) IS NULL;

SELECT
  count(*) AS invoices,
  count(*) FILTER (WHERE COALESCE(gl_code, gl_account_code, '') <> '') AS with_gl,
  count(*) FILTER (WHERE COALESCE(property_ref, '') <> '') AS with_property
FROM public.invoices
WHERE company_id = 'ae7301ab-38ce-413f-9d76-c254b506d47a'::uuid;
