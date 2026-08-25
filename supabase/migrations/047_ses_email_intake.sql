-- SES email intake + WhatsApp source fields (additive).
-- AP invoices live in public.invoices (not ap_invoices).
-- email_intake_log already has from_address / attachment_count / status;
-- this migration adds SES-specific columns and expands allowed values.

-- ── email_intake_log extras ──────────────────────────────────────────────────
ALTER TABLE public.email_intake_log
  ADD COLUMN IF NOT EXISTS from_email TEXT,
  ADD COLUMN IF NOT EXISTS attachments_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS processing_status TEXT DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS s3_key TEXT;

-- Backfill aliases from legacy columns when present
UPDATE public.email_intake_log
SET from_email = from_address
WHERE from_email IS NULL AND from_address IS NOT NULL;

UPDATE public.email_intake_log
SET attachments_count = COALESCE(attachment_count, 0)
WHERE attachments_count IS NULL OR attachments_count = 0;

UPDATE public.email_intake_log
SET processing_status = COALESCE(NULLIF(status, ''), 'processed')
WHERE processing_status IS NULL OR processing_status = 'pending';

-- Allow pending on legacy status column
DO $$
BEGIN
  IF to_regclass('public.email_intake_log') IS NOT NULL THEN
    ALTER TABLE public.email_intake_log DROP CONSTRAINT IF EXISTS email_intake_log_status_check;
    ALTER TABLE public.email_intake_log
      ADD CONSTRAINT email_intake_log_status_check
      CHECK (status IN ('pending', 'processed', 'failed', 'skipped'));
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_email_intake_log_s3_key
  ON public.email_intake_log (s3_key)
  WHERE s3_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_email_intake_log_processing_status
  ON public.email_intake_log (processing_status);

-- ── invoices source columns ────────────────────────────────────────────────
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'upload',
  ADD COLUMN IF NOT EXISTS source_email_from TEXT,
  ADD COLUMN IF NOT EXISTS source_email_subject TEXT,
  ADD COLUMN IF NOT EXISTS source_email_received_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS source_whatsapp_from TEXT;

DO $$
BEGIN
  IF to_regclass('public.invoices') IS NOT NULL THEN
    ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_source_check;
    ALTER TABLE public.invoices
      ADD CONSTRAINT invoices_source_check
      CHECK (
        source IS NULL
        OR source IN (
          'upload',
          'email',
          'email_n8n',
          'vendor_portal',
          'manual',
          'whatsapp',
          'camera',
          'excel',
          'excel_vba',
          'pdf'
        )
      );
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

NOTIFY pgrst, 'reload schema';
