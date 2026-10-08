-- AP data quality: source category fields, vendor normalisation, recurring-aware duplicate detection.
-- Idempotent; applied by the backend at startup.

ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS expense_category text;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS gl_category text;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS vendor_code text;

-- 'DEWA (Dubai Electricity)' and 'DEWA' -> 'dewa'; mirrors app/services/vendor_normalize.py
CREATE OR REPLACE FUNCTION public.normalize_vendor_name(name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT btrim(regexp_replace(
    regexp_replace(
      regexp_replace(
        replace(regexp_replace(lower(COALESCE(name, '')), '\([^)]*\)', ' ', 'g'), 'middle east', ' '),
        '[^a-z0-9&\s]', ' ', 'g'),
      '\m(llc|fze|fzco|fz|fzllc|pjsc|psc|plc|ltd|limited|inc|co|company|est|establishment|uae|the)\M', ' ', 'g'),
    '\s+', ' ', 'g'));
$$;

-- Exact duplicate      : same invoice number + same vendor (or same TRN/GSTIN)           -> flagged 95-98
-- Possible duplicate   : same vendor + same amount within 7 days, different invoice number,
--                        and not on two different POs                                      -> flagged 80
-- Recurring transaction: same vendor + amount but different month / PO                    -> not flagged
CREATE OR REPLACE FUNCTION public.check_invoice_duplicate()
RETURNS trigger AS $$
DECLARE
  dup_id uuid;
  dup_reason text;
  new_vendor text;
  new_tax_id text;
  new_po text;
  prob numeric(5,2);
BEGIN
  dup_id := NULL;
  dup_reason := NULL;
  prob := NULL;
  new_vendor := public.normalize_vendor_name(NEW.vendor_name);
  new_tax_id := upper(regexp_replace(COALESCE(NULLIF(NEW.gstin, ''), NEW.vendor_trn, ''), '[^A-Za-z0-9]', '', 'g'));
  new_po := lower(btrim(COALESCE(NEW.po_number, '')));

  IF new_tax_id <> '' AND COALESCE(NEW.invoice_number, '') <> '' THEN
    SELECT i.id INTO dup_id
    FROM public.invoices i
    WHERE i.id IS DISTINCT FROM NEW.id
      AND i.company_id IS NOT DISTINCT FROM NEW.company_id
      AND upper(regexp_replace(COALESCE(NULLIF(i.gstin, ''), i.vendor_trn, ''), '[^A-Za-z0-9]', '', 'g')) = new_tax_id
      AND lower(btrim(i.invoice_number)) = lower(btrim(NEW.invoice_number))
    LIMIT 1;
    IF dup_id IS NOT NULL THEN
      dup_reason := 'Exact duplicate: same supplier tax ID and invoice number';
      prob := 98;
    END IF;
  END IF;

  IF dup_id IS NULL AND COALESCE(NEW.invoice_number, '') <> '' AND new_vendor <> '' THEN
    SELECT i.id INTO dup_id
    FROM public.invoices i
    WHERE i.id IS DISTINCT FROM NEW.id
      AND i.company_id IS NOT DISTINCT FROM NEW.company_id
      AND public.normalize_vendor_name(i.vendor_name) = new_vendor
      AND lower(btrim(i.invoice_number)) = lower(btrim(NEW.invoice_number))
    LIMIT 1;
    IF dup_id IS NOT NULL THEN
      dup_reason := 'Exact duplicate: same vendor and invoice number';
      prob := 95;
    END IF;
  END IF;

  IF dup_id IS NULL AND new_vendor <> '' AND NEW.invoice_date IS NOT NULL AND NEW.total_amount IS NOT NULL THEN
    SELECT i.id INTO dup_id
    FROM public.invoices i
    WHERE i.id IS DISTINCT FROM NEW.id
      AND i.company_id IS NOT DISTINCT FROM NEW.company_id
      AND public.normalize_vendor_name(i.vendor_name) = new_vendor
      AND i.total_amount = NEW.total_amount
      AND i.invoice_date IS NOT NULL
      AND ABS((i.invoice_date::date) - (NEW.invoice_date::date)) <= 7
      AND NOT (new_po <> '' AND COALESCE(btrim(i.po_number), '') <> '' AND lower(btrim(i.po_number)) <> new_po)
    LIMIT 1;
    IF dup_id IS NOT NULL THEN
      dup_reason := 'Possible duplicate: same vendor and amount within 7 days, different invoice number';
      prob := 80;
    END IF;
  END IF;

  NEW.duplicate_flag := (dup_id IS NOT NULL);
  NEW.duplicate_of_id := dup_id;
  NEW.duplicate_reason := dup_reason;
  NEW.duplicate_probability := prob;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_check_duplicate ON public.invoices;
CREATE TRIGGER trg_check_duplicate
  BEFORE INSERT OR UPDATE OF total_amount, vendor_name, invoice_number, invoice_date, gstin, vendor_trn, po_number, updated_at
  ON public.invoices
  FOR EACH ROW
  EXECUTE FUNCTION public.check_invoice_duplicate();

-- Re-evaluate rows flagged under the old same-vendor-same-amount-within-90-days rule.
UPDATE public.invoices SET updated_at = updated_at WHERE duplicate_flag IS TRUE;

NOTIFY pgrst, 'reload schema';
