-- =============================================================================
-- Backfill demo property_ref for Al Noor Commercial LLC AP invoices
-- Company: ae7301ab-38ce-413f-9d76-c254b506d47a
-- Assigns demo_properties names in round-robin order by invoice_number.
-- =============================================================================

WITH props AS (
  SELECT property_name,
         ROW_NUMBER() OVER (ORDER BY property_name) - 1 AS idx,
         COUNT(*) OVER () AS n
  FROM public.demo_properties
),
invs AS (
  SELECT id,
         ROW_NUMBER() OVER (ORDER BY invoice_number) - 1 AS idx
  FROM public.invoices
  WHERE company_id = 'ae7301ab-38ce-413f-9d76-c254b506d47a'
    AND COALESCE(TRIM(property_ref), '') = ''
),
mapped AS (
  SELECT i.id, p.property_name
  FROM invs i
  JOIN props p ON p.idx = MOD(i.idx, p.n)
)
UPDATE public.invoices inv
SET property_ref = m.property_name,
    updated_at = NOW()
FROM mapped m
WHERE inv.id = m.id;

SELECT property_ref, COUNT(*) AS n
FROM public.invoices
WHERE company_id = 'ae7301ab-38ce-413f-9d76-c254b506d47a'
GROUP BY property_ref
ORDER BY property_ref NULLS FIRST;
