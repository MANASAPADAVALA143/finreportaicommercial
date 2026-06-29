-- Add payment_status to invoices (required by AP aging, payment calendar, vendor risk)
-- Run in Supabase SQL Editor for project ftlycgfgbboxapxhlpad
-- Safe to re-run

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS payment_status text DEFAULT 'unpaid';

COMMENT ON COLUMN public.invoices.payment_status IS
  'unpaid | scheduled | paid | overdue | frozen | cancelled | pending | processing';

-- Backfill from legacy status column where possible
UPDATE public.invoices
SET payment_status = CASE
  WHEN lower(coalesce(status, '')) IN ('paid', 'cancelled') THEN lower(status)
  WHEN due_date IS NOT NULL AND due_date < current_date THEN 'overdue'
  ELSE coalesce(payment_status, 'unpaid')
END
WHERE payment_status IS NULL OR payment_status = 'unpaid';

CREATE INDEX IF NOT EXISTS idx_invoices_payment_status ON public.invoices(payment_status);
