-- AP invoices — GL posting tracking (commercial Supabase: xuaaqonmaarldzklocax)
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS je_posted BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS je_reference VARCHAR(100);

NOTIFY pgrst, 'reload schema';
