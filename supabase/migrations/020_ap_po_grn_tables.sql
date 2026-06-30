-- =============================================================================
-- AP Invoice — Purchase Orders + Goods Receipts (3-way match)
-- Project: finreportaicommercial (ftlycgfgbboxapxhlpad)
-- Run in Supabase SQL Editor after ap_invoice_bootstrap.sql
-- Enables: /ap-invoices/po, /ap-invoices/grn, Excel/CSV import, 3-way match
-- Safe to re-run (IF NOT EXISTS / DROP POLICY IF EXISTS)
-- =============================================================================

-- 1) Purchase orders
CREATE TABLE IF NOT EXISTS public.purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  po_number text UNIQUE NOT NULL,
  vendor_name text NOT NULL,
  vendor_email text,
  po_amount numeric(15, 2) NOT NULL DEFAULT 0,
  currency text DEFAULT 'AED',
  po_date date,
  delivery_date date,
  description text,
  status text DEFAULT 'Open',
  line_items jsonb DEFAULT '[]'::jsonb,
  notes text,
  company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'valid_po_status') THEN
    ALTER TABLE public.purchase_orders
      ADD CONSTRAINT valid_po_status
      CHECK (status IN ('Open', 'Partially Received', 'Fully Received', 'Closed', 'Cancelled'));
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2) Goods receipts
CREATE TABLE IF NOT EXISTS public.goods_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grn_number text UNIQUE NOT NULL,
  po_id uuid REFERENCES public.purchase_orders(id) ON DELETE SET NULL,
  vendor_name text NOT NULL,
  received_amount numeric(15, 2) NOT NULL DEFAULT 0,
  received_date date NOT NULL,
  description text,
  status text DEFAULT 'confirmed',
  received_by text,
  notes text,
  invoice_number text,
  company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 3) GRN line items
CREATE TABLE IF NOT EXISTS public.grn_line_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grn_id uuid NOT NULL REFERENCES public.goods_receipts(id) ON DELETE CASCADE,
  description text NOT NULL DEFAULT '',
  ordered_qty numeric(12, 4) NOT NULL DEFAULT 1,
  received_qty numeric(12, 4) NOT NULL DEFAULT 1,
  unit_price numeric(15, 4) NOT NULL DEFAULT 0,
  condition text DEFAULT 'good',
  total_value numeric(15, 2) GENERATED ALWAYS AS (received_qty * unit_price) STORED,
  created_at timestamptz DEFAULT now()
);

-- 4) Match results (3-way match audit)
CREATE TABLE IF NOT EXISTS public.match_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  invoice_id uuid REFERENCES public.invoices(id) ON DELETE CASCADE,
  po_id uuid REFERENCES public.purchase_orders(id) ON DELETE SET NULL,
  grn_id uuid REFERENCES public.goods_receipts(id) ON DELETE SET NULL,
  match_status text,
  match_score numeric(5, 2),
  invoice_amount numeric(15, 2),
  po_amount numeric(15, 2),
  grn_amount numeric(15, 2),
  amount_variance_pct numeric(8, 4),
  qty_variance_pct numeric(8, 4),
  within_tolerance boolean DEFAULT false,
  auto_approved boolean DEFAULT false,
  checks jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

-- 5) Invoice columns for 3-way match (safe add)
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS po_id uuid REFERENCES public.purchase_orders(id) ON DELETE SET NULL;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS grn_id uuid REFERENCES public.goods_receipts(id) ON DELETE SET NULL;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS match_status text DEFAULT 'no_po';
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS match_notes text;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS match_score numeric(5, 2);
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS match_difference numeric(15, 2);
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS match_percentage numeric(8, 4);
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS po_amount numeric(15, 2);
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS grn_amount numeric(15, 2);
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS match_result_id uuid;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS auto_matched boolean DEFAULT false;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS match_attempted_at timestamptz;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS grn_confirmed boolean DEFAULT false;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS grn_confirmed_by text;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS grn_confirmed_at timestamptz;

-- Link existing rows to default company if unset
UPDATE public.purchase_orders po
SET company_id = c.id
FROM public.companies c
WHERE po.company_id IS NULL AND c.slug = 'my-company';

UPDATE public.goods_receipts gr
SET company_id = c.id
FROM public.companies c
WHERE gr.company_id IS NULL AND c.slug = 'my-company';

-- Indexes
CREATE INDEX IF NOT EXISTS idx_purchase_orders_po_number ON public.purchase_orders(po_number);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_vendor ON public.purchase_orders(vendor_name);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_status ON public.purchase_orders(status);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_company ON public.purchase_orders(company_id);
CREATE INDEX IF NOT EXISTS idx_goods_receipts_grn_number ON public.goods_receipts(grn_number);
CREATE INDEX IF NOT EXISTS idx_goods_receipts_po_id ON public.goods_receipts(po_id);
CREATE INDEX IF NOT EXISTS idx_goods_receipts_company ON public.goods_receipts(company_id);
CREATE INDEX IF NOT EXISTS idx_grn_line_items_grn_id ON public.grn_line_items(grn_id);
CREATE INDEX IF NOT EXISTS idx_match_results_invoice ON public.match_results(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoices_po_id ON public.invoices(po_id);
CREATE INDEX IF NOT EXISTS idx_invoices_match_status ON public.invoices(match_status);

-- RLS (public demo — same as bootstrap invoices)
ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.goods_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grn_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_results ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ap_po_select ON public.purchase_orders;
DROP POLICY IF EXISTS ap_po_insert ON public.purchase_orders;
DROP POLICY IF EXISTS ap_po_update ON public.purchase_orders;
DROP POLICY IF EXISTS ap_po_delete ON public.purchase_orders;
CREATE POLICY ap_po_select ON public.purchase_orders FOR SELECT TO public USING (true);
CREATE POLICY ap_po_insert ON public.purchase_orders FOR INSERT TO public WITH CHECK (true);
CREATE POLICY ap_po_update ON public.purchase_orders FOR UPDATE TO public USING (true) WITH CHECK (true);
CREATE POLICY ap_po_delete ON public.purchase_orders FOR DELETE TO public USING (true);

DROP POLICY IF EXISTS ap_grn_select ON public.goods_receipts;
DROP POLICY IF EXISTS ap_grn_insert ON public.goods_receipts;
DROP POLICY IF EXISTS ap_grn_update ON public.goods_receipts;
DROP POLICY IF EXISTS ap_grn_delete ON public.goods_receipts;
CREATE POLICY ap_grn_select ON public.goods_receipts FOR SELECT TO public USING (true);
CREATE POLICY ap_grn_insert ON public.goods_receipts FOR INSERT TO public WITH CHECK (true);
CREATE POLICY ap_grn_update ON public.goods_receipts FOR UPDATE TO public USING (true) WITH CHECK (true);
CREATE POLICY ap_grn_delete ON public.goods_receipts FOR DELETE TO public USING (true);

DROP POLICY IF EXISTS ap_grn_li_all ON public.grn_line_items;
CREATE POLICY ap_grn_li_all ON public.grn_line_items FOR ALL TO public USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS ap_match_results_all ON public.match_results;
CREATE POLICY ap_match_results_all ON public.match_results FOR ALL TO public USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
