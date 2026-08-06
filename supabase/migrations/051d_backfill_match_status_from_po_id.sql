-- =============================================================================
-- Force-set match_status from linked PO/GRN (no filter on existing match_status)
-- Company: ae7301ab-38ce-413f-9d76-c254b506d47a
-- Run in Supabase SQL Editor, then hard-refresh the Invoice List.
-- =============================================================================

UPDATE public.invoices i
SET
  match_status = CASE
    WHEN EXISTS (
      SELECT 1 FROM public.goods_receipts gr
      WHERE gr.po_id = i.po_id
        AND gr.company_id = i.company_id
        AND gr.status = 'confirmed'
    ) THEN 'three_way_matched'
    ELSE 'matched'
  END,
  grn_id = (
    SELECT gr.id FROM public.goods_receipts gr
    WHERE gr.po_id = i.po_id AND gr.company_id = i.company_id
    ORDER BY (gr.status = 'confirmed') DESC, gr.received_date DESC NULLS LAST
    LIMIT 1
  ),
  grn_confirmed = EXISTS (
    SELECT 1 FROM public.goods_receipts gr
    WHERE gr.po_id = i.po_id
      AND gr.company_id = i.company_id
      AND gr.status = 'confirmed'
  ),
  auto_matched = true,
  updated_at = now()
WHERE i.company_id = 'ae7301ab-38ce-413f-9d76-c254b506d47a'::uuid
  AND i.po_id IS NOT NULL;

SELECT match_status, count(*) AS n
FROM public.invoices
WHERE company_id = 'ae7301ab-38ce-413f-9d76-c254b506d47a'::uuid
GROUP BY match_status
ORDER BY n DESC;
