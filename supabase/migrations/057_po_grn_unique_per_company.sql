-- 057_po_grn_unique_per_company.sql
-- Multi-tenant: PO / GRN numbers must be unique per company, not globally.
-- Without this, Company B cannot upload PO-001 if Company A already has it —
-- Excel import silently fails (or RLS / unique conflicts) for every new company.
-- Safe to re-run.

-- ── purchase_orders: drop global UNIQUE(po_number) ───────────────────────────
DO $$
DECLARE
  cname text;
BEGIN
  -- Named constraint from older schemas
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.purchase_orders'::regclass
      AND contype = 'u'
      AND pg_get_constraintdef(oid) ILIKE '%(po_number)%'
      AND pg_get_constraintdef(oid) NOT ILIKE '%company_id%'
  ) THEN
    SELECT conname INTO cname
    FROM pg_constraint
    WHERE conrelid = 'public.purchase_orders'::regclass
      AND contype = 'u'
      AND pg_get_constraintdef(oid) ILIKE '%(po_number)%'
      AND pg_get_constraintdef(oid) NOT ILIKE '%company_id%'
    LIMIT 1;
    IF cname IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.purchase_orders DROP CONSTRAINT %I', cname);
    END IF;
  END IF;
END $$;

-- Unique indexes created without a named constraint
DROP INDEX IF EXISTS public.purchase_orders_po_number_key;
DROP INDEX IF EXISTS public.idx_purchase_orders_po_number_unique;

CREATE UNIQUE INDEX IF NOT EXISTS idx_purchase_orders_company_po_number
  ON public.purchase_orders (company_id, po_number)
  WHERE company_id IS NOT NULL AND po_number IS NOT NULL AND btrim(po_number) <> '';

-- Keep a non-unique search index on po_number
CREATE INDEX IF NOT EXISTS idx_purchase_orders_po_number
  ON public.purchase_orders (po_number);

-- ── goods_receipts: drop global UNIQUE(grn_number) ───────────────────────────
DO $$
DECLARE
  cname text;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.goods_receipts'::regclass
      AND contype = 'u'
      AND pg_get_constraintdef(oid) ILIKE '%(grn_number)%'
      AND pg_get_constraintdef(oid) NOT ILIKE '%company_id%'
  ) THEN
    SELECT conname INTO cname
    FROM pg_constraint
    WHERE conrelid = 'public.goods_receipts'::regclass
      AND contype = 'u'
      AND pg_get_constraintdef(oid) ILIKE '%(grn_number)%'
      AND pg_get_constraintdef(oid) NOT ILIKE '%company_id%'
    LIMIT 1;
    IF cname IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.goods_receipts DROP CONSTRAINT %I', cname);
    END IF;
  END IF;
END $$;

DROP INDEX IF EXISTS public.goods_receipts_grn_number_key;
DROP INDEX IF EXISTS public.idx_goods_receipts_grn_number_unique;

CREATE UNIQUE INDEX IF NOT EXISTS idx_goods_receipts_company_grn_number
  ON public.goods_receipts (company_id, grn_number)
  WHERE company_id IS NOT NULL AND grn_number IS NOT NULL AND btrim(grn_number) <> '';

CREATE INDEX IF NOT EXISTS idx_goods_receipts_grn_number
  ON public.goods_receipts (grn_number);

NOTIFY pgrst, 'reload schema';
