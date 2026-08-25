-- =============================================================================
-- Delete orphan PO-UAE-* (and their GRNs) not linked to any invoice
-- Company: ae7301ab-38ce-413f-9d76-c254b506d47a
-- Safe after 051 consolidation when orphan_pos > 0.
-- =============================================================================

DELETE FROM public.grn_line_items
WHERE grn_id IN (
  SELECT gr.id
  FROM public.goods_receipts gr
  JOIN public.purchase_orders po ON po.id = gr.po_id
  WHERE po.company_id = 'ae7301ab-38ce-413f-9d76-c254b506d47a'::uuid
    AND po.po_number LIKE 'PO-UAE-%'
    AND NOT EXISTS (SELECT 1 FROM public.invoices i WHERE i.po_id = po.id)
);

DELETE FROM public.goods_receipts
WHERE po_id IN (
  SELECT po.id
  FROM public.purchase_orders po
  WHERE po.company_id = 'ae7301ab-38ce-413f-9d76-c254b506d47a'::uuid
    AND po.po_number LIKE 'PO-UAE-%'
    AND NOT EXISTS (SELECT 1 FROM public.invoices i WHERE i.po_id = po.id)
);

DELETE FROM public.purchase_orders po
WHERE po.company_id = 'ae7301ab-38ce-413f-9d76-c254b506d47a'::uuid
  AND po.po_number LIKE 'PO-UAE-%'
  AND NOT EXISTS (SELECT 1 FROM public.invoices i WHERE i.po_id = po.id);

SELECT
  (SELECT count(*) FROM public.invoices WHERE company_id = 'ae7301ab-38ce-413f-9d76-c254b506d47a'::uuid) AS invoices,
  (SELECT count(*) FROM public.purchase_orders WHERE company_id = 'ae7301ab-38ce-413f-9d76-c254b506d47a'::uuid AND po_number LIKE 'PO-UAE-%') AS pos,
  (SELECT count(*) FROM public.invoices WHERE company_id = 'ae7301ab-38ce-413f-9d76-c254b506d47a'::uuid AND po_id IS NOT NULL) AS invoices_linked,
  (SELECT count(*) FROM public.purchase_orders po
   WHERE po.company_id = 'ae7301ab-38ce-413f-9d76-c254b506d47a'::uuid
     AND po.po_number LIKE 'PO-UAE-%'
     AND NOT EXISTS (SELECT 1 FROM public.invoices i WHERE i.po_id = po.id)) AS orphan_pos;
