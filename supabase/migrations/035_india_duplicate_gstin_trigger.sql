-- ============================================================
-- P3 — India duplicate detection: GSTIN + invoice#, near-duplicate same month
-- Safe to re-run. Replaces check_invoice_duplicate().
-- ============================================================

CREATE OR REPLACE FUNCTION public.check_invoice_duplicate()
RETURNS trigger AS $$
DECLARE
  dup_id uuid;
  dup_reason text;
  new_norm text;
  new_gstin text;
  prob numeric(5,2);
BEGIN
  dup_id := NULL;
  dup_reason := NULL;
  prob := NULL;
  new_norm := lower(trim(COALESCE(NEW.vendor_name, '')));
  new_gstin := upper(trim(COALESCE(NEW.gstin, '')));

  -- India: same GSTIN + same invoice number = definite duplicate (priority)
  IF new_gstin <> '' AND NEW.invoice_number IS NOT NULL AND NEW.invoice_number <> '' THEN
    SELECT i.id INTO dup_id
    FROM public.invoices i
    WHERE i.id IS DISTINCT FROM NEW.id
      AND upper(trim(COALESCE(i.gstin, ''))) = new_gstin
      AND i.invoice_number = NEW.invoice_number
    LIMIT 1;
    IF dup_id IS NOT NULL THEN
      dup_reason := 'Same GSTIN and invoice number';
      prob := 98;
    END IF;
  END IF;

  -- Same invoice number + vendor
  IF dup_id IS NULL AND NEW.invoice_number IS NOT NULL AND NEW.invoice_number <> '' AND new_norm <> '' THEN
    SELECT i.id INTO dup_id
    FROM public.invoices i
    WHERE i.id IS DISTINCT FROM NEW.id
      AND lower(trim(COALESCE(i.vendor_name, ''))) = new_norm
      AND i.invoice_number = NEW.invoice_number
    LIMIT 1;
    IF dup_id IS NOT NULL THEN
      dup_reason := 'Same invoice number and vendor';
      prob := 95;
    END IF;
  END IF;

  -- Same vendor + amount + same calendar month (near duplicate)
  IF dup_id IS NULL AND new_norm <> '' AND NEW.invoice_date IS NOT NULL AND NEW.total_amount IS NOT NULL THEN
    SELECT i.id INTO dup_id
    FROM public.invoices i
    WHERE i.id IS DISTINCT FROM NEW.id
      AND lower(trim(COALESCE(i.vendor_name, ''))) = new_norm
      AND i.total_amount IS NOT DISTINCT FROM NEW.total_amount
      AND i.invoice_date IS NOT NULL
      AND date_trunc('month', i.invoice_date::timestamp)
          = date_trunc('month', NEW.invoice_date::timestamp)
    LIMIT 1;
    IF dup_id IS NOT NULL THEN
      dup_reason := 'Same vendor and amount in the same month';
      prob := 90;
    END IF;
  END IF;

  -- Same vendor + amount within 90 days
  IF dup_id IS NULL AND new_norm <> '' AND NEW.invoice_date IS NOT NULL THEN
    SELECT i.id INTO dup_id
    FROM public.invoices i
    WHERE i.id IS DISTINCT FROM NEW.id
      AND lower(trim(COALESCE(i.vendor_name, ''))) = new_norm
      AND i.total_amount IS NOT DISTINCT FROM NEW.total_amount
      AND i.invoice_date IS NOT NULL
      AND ABS((i.invoice_date::date) - (NEW.invoice_date::date)) <= 90
    LIMIT 1;
    IF dup_id IS NOT NULL THEN
      dup_reason := 'Same vendor and amount within 90 days';
      prob := 87;
    END IF;
  END IF;

  NEW.duplicate_flag := (dup_id IS NOT NULL);
  NEW.duplicate_of_id := dup_id;
  NEW.duplicate_reason := dup_reason;
  IF dup_id IS NOT NULL THEN
    NEW.duplicate_probability := COALESCE(NEW.duplicate_probability, prob, 87);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_check_duplicate ON public.invoices;
CREATE TRIGGER trg_check_duplicate
  BEFORE INSERT OR UPDATE OF total_amount, vendor_name, invoice_number, invoice_date, gstin, updated_at
  ON public.invoices
  FOR EACH ROW
  EXECUTE FUNCTION public.check_invoice_duplicate();

NOTIFY pgrst, 'reload schema';
