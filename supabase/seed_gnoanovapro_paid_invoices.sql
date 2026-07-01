-- =============================================================================
-- Seed 15 paid AP invoices for GNANOVAPRO tenant (DPO / on-time rate demo data)
-- Run in Supabase SQL Editor (service role or as admin).
-- Safe to re-run: uses deterministic invoice_number prefix SEED-GNP-PAID-
-- =============================================================================

DO $$
DECLARE
  v_company_id uuid;
  v_vendor_names text[] := ARRAY['PwC UAE', 'Emaar Properties', 'Al Futtaim Group'];
  v_amounts numeric[] := ARRAY[
    12500, 18750, 22300, 9800, 31200, 15600, 42000, 8900, 27500, 33400,
    11200, 46800, 19500, 28750, 15300
  ];
  v_pay_offsets int[] := ARRAY[32, 38, 41, 35, 44, 30, 37, 42, 33, 39, 36, 45, 31, 40, 34];
  i int;
  inv_date date;
  due_date date;
  paid_date date;
  vendor_name text;
  inv_num text;
BEGIN
  SELECT id INTO v_company_id
  FROM companies
  WHERE lower(name) LIKE '%gnoanovapro%'
     OR lower(slug) LIKE '%gnoanovapro%'
     OR lower(name) LIKE '%gnanova%pro%'
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'GNANOVAPRO company not found — create the tenant in companies first';
  END IF;

  RAISE NOTICE 'Seeding paid invoices for company_id=%', v_company_id;

  FOR i IN 1..15 LOOP
    inv_num := 'SEED-GNP-PAID-' || lpad(i::text, 3, '0');
    vendor_name := v_vendor_names[1 + ((i - 1) % array_length(v_vendor_names, 1))];
    inv_date := (CURRENT_DATE - (120 + i * 7))::date;
    due_date := (inv_date + 30)::date;
    paid_date := (inv_date + v_pay_offsets[i])::date;

    INSERT INTO invoices (
      company_id,
      invoice_number,
      invoice_date,
      due_date,
      vendor_name,
      total_amount,
      currency,
      status,
      payment_status,
      paid_at,
      payment_date,
      tax_type,
      vat_rate,
      vat_amount,
      subtotal_amount,
      created_at,
      updated_at
    )
    VALUES (
      v_company_id,
      inv_num,
      inv_date,
      due_date,
      vendor_name,
      v_amounts[i],
      'AED',
      'Paid',
      'paid',
      paid_date::timestamptz,
      paid_date,
      'VAT',
      5,
      round(v_amounts[i] * 0.05 / 1.05, 2),
      round(v_amounts[i] / 1.05, 2),
      now(),
      now()
    )
    ON CONFLICT (invoice_number) DO UPDATE SET
      company_id = EXCLUDED.company_id,
      status = 'Paid',
      payment_status = 'paid',
      paid_at = EXCLUDED.paid_at,
      payment_date = EXCLUDED.payment_date,
      total_amount = EXCLUDED.total_amount,
      currency = 'AED',
      vendor_name = EXCLUDED.vendor_name,
      updated_at = now();
  END LOOP;

  -- Ensure vendor master rows exist with default low risk
  INSERT INTO vendors (company_id, name, risk_score, risk_level, total_invoices_amount, updated_at)
  SELECT
    v_company_id,
    vn,
    25,
    'low',
    COALESCE((
      SELECT SUM(total_amount)::numeric
      FROM invoices
      WHERE company_id = v_company_id AND vendor_name = vn
    ), 0),
    now()
  FROM unnest(v_vendor_names) AS vn
  WHERE NOT EXISTS (
    SELECT 1 FROM vendors v2 WHERE lower(trim(v2.name)) = lower(trim(vn))
  );

  UPDATE vendors v
  SET
    total_invoices_amount = s.spend,
    total_invoices_count = s.cnt,
    risk_score = COALESCE(NULLIF(v.risk_score, 0), 25),
    risk_level = COALESCE(v.risk_level, 'low'),
    updated_at = now()
  FROM (
    SELECT vendor_name, SUM(total_amount) AS spend, COUNT(*) AS cnt
    FROM invoices
    WHERE company_id = v_company_id
    GROUP BY vendor_name
  ) s
  WHERE v.company_id = v_company_id
    AND lower(v.name) = lower(s.vendor_name);

  RAISE NOTICE 'Done — 15 paid invoices seeded. Expected DPO ~35–45 days after refresh.';
END $$;

-- Verify
-- SELECT status, payment_status, invoice_date, payment_date, paid_at,
--        (payment_date - invoice_date) AS days_to_pay
-- FROM invoices
-- WHERE invoice_number LIKE 'SEED-GNP-PAID-%'
-- ORDER BY invoice_date;
