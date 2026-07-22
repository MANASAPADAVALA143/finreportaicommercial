-- Optional: WhatsApp phones on approval rules (safe if already applied)
ALTER TABLE public.approval_rules
  ADD COLUMN IF NOT EXISTS approver_phones TEXT[];

NOTIFY pgrst, 'reload schema';
