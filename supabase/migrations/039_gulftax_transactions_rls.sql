-- Allow backend (service role / anon with permissive policies) to sync AP → GulfTax.
-- Without policies, RLS enabled on gulftax_transactions returns 42501 on insert.

ALTER TABLE IF EXISTS gulftax_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "gulftax_transactions_select" ON gulftax_transactions;
DROP POLICY IF EXISTS "gulftax_transactions_insert" ON gulftax_transactions;
DROP POLICY IF EXISTS "gulftax_transactions_update" ON gulftax_transactions;
DROP POLICY IF EXISTS "gulftax_transactions_delete" ON gulftax_transactions;
DROP POLICY IF EXISTS "gulftax_transactions_all" ON gulftax_transactions;

-- Match InvoiceFlow public policies used on invoices — backend uses service/anon key.
CREATE POLICY "gulftax_transactions_all"
  ON gulftax_transactions
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Optional advanced-VAT columns used by sync row builder (no-op if already present).
ALTER TABLE gulftax_transactions ADD COLUMN IF NOT EXISTS designated_zone BOOLEAN DEFAULT FALSE;
ALTER TABLE gulftax_transactions ADD COLUMN IF NOT EXISTS transaction_kind TEXT DEFAULT 'goods';
ALTER TABLE gulftax_transactions ADD COLUMN IF NOT EXISTS dz_supplier_location TEXT;
ALTER TABLE gulftax_transactions ADD COLUMN IF NOT EXISTS dz_customer_location TEXT;

NOTIFY pgrst, 'reload schema';
