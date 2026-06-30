-- AP invoices — GL posting + overdue notification (xuaaqonmaarldzklocax)
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS je_posted BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS je_reference VARCHAR(100),
  ADD COLUMN IF NOT EXISTS overdue_notified_at TIMESTAMPTZ;

NOTIFY pgrst, 'reload schema';
