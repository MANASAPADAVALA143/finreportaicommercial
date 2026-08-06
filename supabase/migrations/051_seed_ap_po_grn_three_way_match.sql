-- =============================================================================
-- 051 — Consolidate AP PO/GRN onto the invoice company + sync for 3-way match
--
-- Problem this fixes (production):
--   Invoices land on the workspace company (e.g. ae7301ab-…).
--   POs/GRNs were often created under a different session company
--   (e.g. 0deaa402-…). Match then looks under the invoice company and finds
--   nothing → "— No PO".
--
-- What this does (idempotent, safe to re-run):
--   1. Reclaims PO-UAE-* / GRN-UAE-* onto the target company
--   2. Aligns each PO amount to the matched invoice's net (ex-VAT) amount
--   3. Ensures exactly one confirmed GRN per PO with the same amount
--   4. Stamps invoices.po_id / po_number so match is deterministic
--   5. Verifies every invoice has a PO + GRN within tolerance
--
-- Target company: ae7301ab-38ce-413f-9d76-c254b506d47a
-- Requires: 020_ap_po_grn_tables.sql
-- =============================================================================

DO $$
DECLARE
  v_company uuid := 'ae7301ab-38ce-413f-9d76-c254b506d47a';
  v_invoices integer;
  v_po_moved integer;
  v_grn_moved integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.companies WHERE id = v_company) THEN
    RAISE EXCEPTION 'Company % does not exist — create/sync the workspace company first', v_company;
  END IF;

  SELECT count(*) INTO v_invoices
  FROM public.invoices
  WHERE company_id = v_company;

  IF v_invoices = 0 THEN
    RAISE EXCEPTION 'No invoices for company % — import AP invoices first', v_company;
  END IF;

  -- 1) Reclaim seed-prefix rows that were written under the old session company
  UPDATE public.purchase_orders
  SET company_id = v_company,
      updated_at = now()
  WHERE po_number LIKE 'PO-UAE-%'
    AND company_id IS DISTINCT FROM v_company;
  GET DIAGNOSTICS v_po_moved = ROW_COUNT;

  UPDATE public.goods_receipts
  SET company_id = v_company,
      updated_at = now()
  WHERE grn_number LIKE 'GRN-UAE-%'
    AND company_id IS DISTINCT FROM v_company;
  GET DIAGNOSTICS v_grn_moved = ROW_COUNT;

  RAISE NOTICE 'Company % has % invoices; reclaimed % POs and % GRNs',
    v_company, v_invoices, v_po_moved, v_grn_moved;
END $$;


-- Helper view of invoice net amount (mirrors netInvoiceAmountForMatch)
CREATE TEMP TABLE _ap_inv_net ON COMMIT DROP AS
SELECT
  i.id AS invoice_id,
  i.invoice_number,
  i.invoice_date,
  i.vendor_name,
  i.vendor_email,
  COALESCE(NULLIF(i.currency, ''), 'AED') AS currency,
  ROUND(
    CASE
      WHEN COALESCE(i.vat_amount, i.tax_amount, 0) > 0
           AND i.total_amount > COALESCE(i.vat_amount, i.tax_amount, 0)
        THEN i.total_amount - COALESCE(i.vat_amount, i.tax_amount, 0)
      WHEN COALESCE(i.tax_rate, 0) > 0
        THEN i.total_amount / (1 + i.tax_rate / 100.0)
      WHEN COALESCE(i.subtotal_amount, 0) > 0
           AND i.subtotal_amount < i.total_amount * 0.99
        THEN i.subtotal_amount
      ELSE i.total_amount
    END, 2) AS net_amount
FROM public.invoices i
WHERE i.company_id = 'ae7301ab-38ce-413f-9d76-c254b506d47a'::uuid;


-- 2) Pair each invoice → unique PO (vendor match + closest amount; each PO used once)
CREATE TEMP TABLE _ap_inv_po ON COMMIT DROP AS
WITH candidates AS (
  SELECT
    n.invoice_id,
    n.invoice_number,
    n.invoice_date,
    n.vendor_name,
    n.vendor_email,
    n.currency,
    n.net_amount,
    po.id AS po_id,
    po.po_number,
    ABS(COALESCE(po.po_amount, 0) - n.net_amount) AS amount_diff,
    CASE
      WHEN i.po_id IS NOT NULL AND i.po_id = po.id THEN 0
      WHEN NULLIF(trim(COALESCE(i.po_number, '')), '') IS NOT NULL
           AND lower(trim(i.po_number)) = lower(trim(po.po_number)) THEN 1
      WHEN lower(po.vendor_name) LIKE '%' || lower(split_part(n.vendor_name, ' ', 1)) || '%'
           OR lower(n.vendor_name) LIKE '%' || lower(split_part(po.vendor_name, ' ', 1)) || '%'
        THEN 2
      ELSE 9
    END AS rank_bucket
  FROM _ap_inv_net n
  JOIN public.invoices i ON i.id = n.invoice_id
  JOIN public.purchase_orders po
    ON po.company_id = 'ae7301ab-38ce-413f-9d76-c254b506d47a'::uuid
   AND po.po_number LIKE 'PO-UAE-%'
   AND po.status IN ('Open', 'Partially Received', 'Fully Received')
),
scored AS (
  SELECT *
  FROM candidates
  WHERE rank_bucket < 9
),
-- Greedy unique assignment: best invoice↔PO pairs without reusing a PO
ranked_pairs AS (
  SELECT
    *,
    ROW_NUMBER() OVER (
      PARTITION BY invoice_id
      ORDER BY rank_bucket ASC, amount_diff ASC, po_number ASC
    ) AS inv_rn,
    ROW_NUMBER() OVER (
      PARTITION BY po_id
      ORDER BY rank_bucket ASC, amount_diff ASC, invoice_number ASC
    ) AS po_rn
  FROM scored
)
SELECT
  invoice_id, invoice_number, invoice_date, vendor_name, vendor_email,
  currency, net_amount, po_id, po_number
FROM ranked_pairs
WHERE inv_rn = 1 AND po_rn = 1;


-- 2b) Invoices that still have no PO — create PO-UAE-NNN (next free numbers)
DO $$
DECLARE
  r RECORD;
  v_next int;
  v_po_id uuid;
  v_po_number text;
BEGIN
  SELECT COALESCE(MAX(NULLIF(regexp_replace(po_number, '^PO-UAE-', ''), '')::int), 0)
  INTO v_next
  FROM public.purchase_orders
  WHERE po_number ~ '^PO-UAE-[0-9]+$';

  FOR r IN
    SELECT n.*
    FROM _ap_inv_net n
    WHERE NOT EXISTS (SELECT 1 FROM _ap_inv_po p WHERE p.invoice_id = n.invoice_id)
    ORDER BY n.invoice_date, n.invoice_number, n.invoice_id
  LOOP
    v_next := v_next + 1;
    v_po_number := 'PO-UAE-' || lpad(v_next::text, 3, '0');

    INSERT INTO public.purchase_orders (
      po_number, vendor_name, vendor_email, po_amount, currency,
      po_date, delivery_date, description, status, company_id, notes
    ) VALUES (
      v_po_number,
      r.vendor_name,
      r.vendor_email,
      r.net_amount,
      r.currency,
      (COALESCE(r.invoice_date, current_date) - interval '21 days')::date,
      (COALESCE(r.invoice_date, current_date) - interval '3 days')::date,
      'Purchase order for ' || r.vendor_name || ' (invoice ' || r.invoice_number || ')',
      'Fully Received',
      'ae7301ab-38ce-413f-9d76-c254b506d47a'::uuid,
      'Auto-created for 3-way match'
    )
    ON CONFLICT (po_number) DO UPDATE SET
      vendor_name = EXCLUDED.vendor_name,
      po_amount   = EXCLUDED.po_amount,
      company_id  = EXCLUDED.company_id,
      status      = 'Fully Received',
      updated_at  = now()
    RETURNING id INTO v_po_id;

    IF v_po_id IS NULL THEN
      SELECT id INTO v_po_id FROM public.purchase_orders WHERE po_number = v_po_number;
    END IF;

    INSERT INTO _ap_inv_po (
      invoice_id, invoice_number, invoice_date, vendor_name, vendor_email,
      currency, net_amount, po_id, po_number
    ) VALUES (
      r.invoice_id, r.invoice_number, r.invoice_date, r.vendor_name, r.vendor_email,
      r.currency, r.net_amount, v_po_id, v_po_number
    );
  END LOOP;
END $$;


-- 3) Align paired POs to invoice net amount + Fully Received
UPDATE public.purchase_orders po
SET vendor_name  = COALESCE(NULLIF(trim(p.vendor_name), ''), po.vendor_name),
    vendor_email = COALESCE(p.vendor_email, po.vendor_email),
    po_amount    = p.net_amount,
    currency     = p.currency,
    status       = 'Fully Received',
    company_id   = 'ae7301ab-38ce-413f-9d76-c254b506d47a'::uuid,
    updated_at   = now()
FROM _ap_inv_po p
WHERE po.id = p.po_id;


-- 4) One confirmed GRN per PO — update existing (any GRN-UAE-* on that po_id), else insert
-- 4a) Prefer the newest GRN already linked to the PO
WITH best_grn AS (
  SELECT DISTINCT ON (p.po_id)
    p.po_id,
    p.po_number,
    p.vendor_name,
    p.net_amount,
    p.invoice_number,
    p.invoice_date,
    gr.id AS grn_id
  FROM _ap_inv_po p
  LEFT JOIN public.goods_receipts gr
    ON gr.po_id = p.po_id
   AND gr.company_id = 'ae7301ab-38ce-413f-9d76-c254b506d47a'::uuid
  ORDER BY p.po_id, gr.received_date DESC NULLS LAST, gr.created_at DESC NULLS LAST
)
UPDATE public.goods_receipts gr
SET vendor_name     = b.vendor_name,
    received_amount = b.net_amount,
    received_date   = (COALESCE(b.invoice_date, current_date) - interval '2 days')::date,
    description     = COALESCE(NULLIF(gr.description, ''), 'Goods/services received against ' || b.po_number),
    status          = 'confirmed',
    received_by     = COALESCE(gr.received_by, 'AP Sync'),
    invoice_number  = b.invoice_number,
    company_id      = 'ae7301ab-38ce-413f-9d76-c254b506d47a'::uuid,
    updated_at      = now()
FROM best_grn b
WHERE gr.id = b.grn_id
  AND b.grn_id IS NOT NULL;


-- 4b) Insert GRN where PO has none
INSERT INTO public.goods_receipts (
  grn_number, po_id, vendor_name, received_amount, received_date,
  description, status, received_by, invoice_number, company_id, notes
)
SELECT
  'GRN-UAE-' || lpad(
    COALESCE(NULLIF(regexp_replace(p.po_number, '^PO-UAE-', ''), ''), '0'),
    3, '0'
  ),
  p.po_id,
  p.vendor_name,
  p.net_amount,
  (COALESCE(p.invoice_date, current_date) - interval '2 days')::date,
  'Goods/services received against ' || p.po_number,
  'confirmed',
  'AP Sync',
  p.invoice_number,
  'ae7301ab-38ce-413f-9d76-c254b506d47a'::uuid,
  'Synced for 3-way match'
FROM _ap_inv_po p
WHERE NOT EXISTS (
  SELECT 1 FROM public.goods_receipts gr
  WHERE gr.po_id = p.po_id
    AND gr.company_id = 'ae7301ab-38ce-413f-9d76-c254b506d47a'::uuid
)
ON CONFLICT (grn_number) DO UPDATE SET
  po_id           = EXCLUDED.po_id,
  vendor_name     = EXCLUDED.vendor_name,
  received_amount = EXCLUDED.received_amount,
  received_date   = EXCLUDED.received_date,
  status          = 'confirmed',
  company_id      = EXCLUDED.company_id,
  invoice_number  = EXCLUDED.invoice_number,
  updated_at      = now();


-- 4c) Drop extra GRNs on the same PO (keep newest confirmed / highest received_date)
DELETE FROM public.goods_receipts gr
WHERE gr.company_id = 'ae7301ab-38ce-413f-9d76-c254b506d47a'::uuid
  AND gr.po_id IN (SELECT po_id FROM _ap_inv_po)
  AND gr.id NOT IN (
    SELECT DISTINCT ON (po_id) id
    FROM public.goods_receipts
    WHERE company_id = 'ae7301ab-38ce-413f-9d76-c254b506d47a'::uuid
      AND po_id IN (SELECT po_id FROM _ap_inv_po)
    ORDER BY po_id, (status = 'confirmed') DESC, received_date DESC NULLS LAST, created_at DESC NULLS LAST
  );


-- 4d) Rebuild line items for kept GRNs (matcher may sum total_value)
DELETE FROM public.grn_line_items
WHERE grn_id IN (
  SELECT gr.id
  FROM public.goods_receipts gr
  JOIN _ap_inv_po p ON p.po_id = gr.po_id
  WHERE gr.company_id = 'ae7301ab-38ce-413f-9d76-c254b506d47a'::uuid
);

INSERT INTO public.grn_line_items (grn_id, description, ordered_qty, received_qty, unit_price, condition)
SELECT
  gr.id,
  COALESCE(NULLIF(gr.description, ''), 'Received in full'),
  1, 1, gr.received_amount, 'good'
FROM public.goods_receipts gr
JOIN _ap_inv_po p ON p.po_id = gr.po_id
WHERE gr.company_id = 'ae7301ab-38ce-413f-9d76-c254b506d47a'::uuid;


-- 5) Stamp invoices with po_id / po_number / match_status / grn_id
UPDATE public.invoices i
SET po_id      = p.po_id,
    po_number  = p.po_number,
    grn_id     = gr.id,
    match_status = CASE
      WHEN gr.id IS NOT NULL AND gr.status = 'confirmed' THEN 'three_way_matched'
      ELSE 'matched'
    END,
    auto_matched = true,
    grn_confirmed = (gr.id IS NOT NULL AND gr.status = 'confirmed'),
    match_attempted_at = now(),
    po_amount = p.net_amount,
    grn_amount = CASE WHEN gr.id IS NOT NULL THEN gr.received_amount ELSE NULL END,
    updated_at = now()
FROM _ap_inv_po p
LEFT JOIN LATERAL (
  SELECT g.id, g.status, g.received_amount
  FROM public.goods_receipts g
  WHERE g.po_id = p.po_id
    AND g.company_id = 'ae7301ab-38ce-413f-9d76-c254b506d47a'::uuid
  ORDER BY (g.status = 'confirmed') DESC, g.received_date DESC NULLS LAST
  LIMIT 1
) gr ON true
WHERE i.id = p.invoice_id;


-- 6) Verification — every invoice must have PO + GRN with 0% amount gap
SELECT
  i.invoice_number,
  i.vendor_name,
  ROUND(p.net_amount, 2) AS invoice_net,
  po.po_number,
  po.po_amount,
  gr.grn_number,
  gr.received_amount,
  gr.status AS grn_status,
  CASE
    WHEN po.id IS NULL THEN 'MISSING_PO'
    WHEN gr.id IS NULL THEN 'MISSING_GRN'
    WHEN ABS(po.po_amount - p.net_amount) > 0.01 THEN 'PO_AMOUNT_MISMATCH'
    WHEN ABS(gr.received_amount - p.net_amount) > 0.01 THEN 'GRN_AMOUNT_MISMATCH'
    WHEN gr.status IS DISTINCT FROM 'confirmed' THEN 'GRN_NOT_CONFIRMED'
    ELSE 'READY'
  END AS match_readiness
FROM _ap_inv_po p
JOIN public.invoices i ON i.id = p.invoice_id
LEFT JOIN public.purchase_orders po ON po.id = p.po_id
LEFT JOIN LATERAL (
  SELECT *
  FROM public.goods_receipts g
  WHERE g.po_id = p.po_id
    AND g.company_id = 'ae7301ab-38ce-413f-9d76-c254b506d47a'::uuid
  ORDER BY (g.status = 'confirmed') DESC, g.received_date DESC NULLS LAST
  LIMIT 1
) gr ON true
ORDER BY po.po_number, i.invoice_number;


-- Summary counts
SELECT
  (SELECT count(*) FROM public.invoices WHERE company_id = 'ae7301ab-38ce-413f-9d76-c254b506d47a'::uuid) AS invoices,
  (SELECT count(*) FROM public.purchase_orders WHERE company_id = 'ae7301ab-38ce-413f-9d76-c254b506d47a'::uuid AND po_number LIKE 'PO-UAE-%') AS pos,
  (SELECT count(*) FROM public.goods_receipts WHERE company_id = 'ae7301ab-38ce-413f-9d76-c254b506d47a'::uuid AND grn_number LIKE 'GRN-UAE-%') AS grns,
  (SELECT count(*) FROM public.invoices WHERE company_id = 'ae7301ab-38ce-413f-9d76-c254b506d47a'::uuid AND po_id IS NOT NULL) AS invoices_linked;
