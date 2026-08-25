-- ============================================================
-- PRIORITY 1 + 2 — AP InvoiceFlow missing tables + duplicate cols
-- Project: ftlycgfgbboxapxhlpad
-- Run in: Supabase Dashboard → SQL Editor → New query → Run
-- Safe to re-run (IF NOT EXISTS / DROP POLICY IF EXISTS)
-- ============================================================

DO $$ BEGIN
  CREATE TYPE invoice_approval_row_status AS ENUM ('pending', 'approved', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- a) gl_accounts
CREATE TABLE IF NOT EXISTS public.gl_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  gl_code text NOT NULL,
  gl_name text NOT NULL,
  account_type text NOT NULL
    CHECK (account_type IN ('Asset', 'Liability', 'Equity', 'Revenue', 'Expense', 'COGS')),
  department text,
  cost_center text,
  vat_treatment text,
  is_active boolean DEFAULT true,
  imported_from text,
  standard_reference text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS gl_accounts_company_code_uidx
  ON public.gl_accounts (company_id, gl_code);
CREATE INDEX IF NOT EXISTS idx_gl_accounts_active ON public.gl_accounts (is_active);
ALTER TABLE public.gl_accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS gl_accounts_all ON public.gl_accounts;
CREATE POLICY gl_accounts_all ON public.gl_accounts FOR ALL TO public USING (true) WITH CHECK (true);

-- b) vendors
CREATE TABLE IF NOT EXISTS public.vendors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  gstin text,
  email text,
  phone text,
  address text,
  risk_score numeric,
  risk_level text,
  risk_flags jsonb DEFAULT '[]'::jsonb,
  bank_account_number text,
  bank_name text,
  bank_iban text,
  bank_swift text,
  bank_last_changed_at timestamptz,
  bank_change_count int DEFAULT 0,
  bank_verification_status text,
  total_invoices_count int DEFAULT 0,
  total_invoices_amount numeric DEFAULT 0,
  avg_invoice_amount numeric DEFAULT 0,
  last_invoice_date date,
  duplicate_invoice_count int DEFAULT 0,
  payment_terms int,
  vendor_since date,
  blacklisted boolean DEFAULT false,
  blacklist_reason text,
  trn_verified boolean DEFAULT false,
  status text DEFAULT 'active',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS vendors_company_name_lower_uidx
  ON public.vendors (company_id, lower(trim(name)));
CREATE INDEX IF NOT EXISTS idx_vendors_company ON public.vendors (company_id);
ALTER TABLE public.vendors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vendors_all ON public.vendors;
CREATE POLICY vendors_all ON public.vendors FOR ALL TO public USING (true) WITH CHECK (true);

-- c) approval_rules
CREATE TABLE IF NOT EXISTS public.approval_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  min_amount numeric(18,2) NOT NULL DEFAULT 0,
  max_amount numeric(18,2),
  required_approvers int NOT NULL DEFAULT 1 CHECK (required_approvers >= 1),
  approver_emails text[] NOT NULL DEFAULT '{}',
  rule_name text,
  department text,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_approval_rules_company ON public.approval_rules (company_id);
ALTER TABLE public.approval_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS approval_rules_all ON public.approval_rules;
CREATE POLICY approval_rules_all ON public.approval_rules FOR ALL TO public USING (true) WITH CHECK (true);

-- d) invoice_approvals
CREATE TABLE IF NOT EXISTS public.invoice_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  step_index int NOT NULL DEFAULT 0 CHECK (step_index >= 0),
  approver_email text NOT NULL,
  status invoice_approval_row_status NOT NULL DEFAULT 'pending',
  comment text,
  actioned_at timestamptz,
  created_at timestamptz DEFAULT now(),
  UNIQUE (invoice_id, step_index)
);
CREATE INDEX IF NOT EXISTS idx_invoice_approvals_invoice ON public.invoice_approvals (invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_approvals_email_status
  ON public.invoice_approvals (approver_email, status);
ALTER TABLE public.invoice_approvals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS invoice_approvals_all ON public.invoice_approvals;
CREATE POLICY invoice_approvals_all ON public.invoice_approvals FOR ALL TO public USING (true) WITH CHECK (true);

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS approval_rule_id uuid REFERENCES public.approval_rules(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS current_approver_index int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS submitted_for_approval_at timestamptz,
  ADD COLUMN IF NOT EXISTS approval_submitted_by text;

-- e) invoice_anomalies
CREATE TABLE IF NOT EXISTS public.invoice_anomalies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid REFERENCES public.invoices(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  anomaly_type text,
  detection_method text,
  severity text,
  risk_score numeric,
  flag_code text,
  flag_reason text,
  flag_details jsonb DEFAULT '{}'::jsonb,
  status text DEFAULT 'open',
  resolved_by text,
  resolved_at timestamptz,
  resolution_notes text,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_invoice_anomalies_invoice ON public.invoice_anomalies (invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_anomalies_company_status
  ON public.invoice_anomalies (company_id, status);
ALTER TABLE public.invoice_anomalies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS invoice_anomalies_all ON public.invoice_anomalies;
CREATE POLICY invoice_anomalies_all ON public.invoice_anomalies FOR ALL TO public USING (true) WITH CHECK (true);

-- f) ap_alerts
CREATE TABLE IF NOT EXISTS public.ap_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  alert_type text NOT NULL,
  priority text DEFAULT 'medium',
  vendor_id uuid REFERENCES public.vendors(id) ON DELETE SET NULL,
  vendor_name text,
  invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL,
  title text,
  message text,
  metadata jsonb DEFAULT '{}'::jsonb,
  status text DEFAULT 'open',
  requires_dual_approval boolean DEFAULT false,
  approved_by_ap text,
  approved_by_cfo text,
  resolved_by text,
  resolved_at timestamptz,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ap_alerts_company_status ON public.ap_alerts (company_id, status);
ALTER TABLE public.ap_alerts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ap_alerts_all ON public.ap_alerts;
CREATE POLICY ap_alerts_all ON public.ap_alerts FOR ALL TO public USING (true) WITH CHECK (true);

-- g) bank_guarantees
CREATE TABLE IF NOT EXISTS public.bank_guarantees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  vendor_id uuid REFERENCES public.vendors(id) ON DELETE SET NULL,
  vendor_name text,
  bg_number text NOT NULL,
  bg_type text,
  issuing_bank text,
  beneficiary text,
  amount_aed numeric,
  currency text DEFAULT 'AED',
  issue_date date,
  expiry_date date NOT NULL,
  status text DEFAULT 'active',
  renewal_required boolean DEFAULT false,
  reminder_sent_30d boolean DEFAULT false,
  reminder_sent_15d boolean DEFAULT false,
  reminder_sent_7d boolean DEFAULT false,
  notes text,
  document_url text,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bank_guarantees_company ON public.bank_guarantees (company_id);
CREATE INDEX IF NOT EXISTS idx_bank_guarantees_expiry ON public.bank_guarantees (expiry_date);
ALTER TABLE public.bank_guarantees ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bank_guarantees_all ON public.bank_guarantees;
CREATE POLICY bank_guarantees_all ON public.bank_guarantees FOR ALL TO public USING (true) WITH CHECK (true);

-- bonus) gstr2b_entries
CREATE TABLE IF NOT EXISTS public.gstr2b_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  company_gstin text NOT NULL,
  supplier_gstin text,
  supplier_name text,
  invoice_number text,
  invoice_date date,
  taxable_value numeric DEFAULT 0,
  igst numeric DEFAULT 0,
  cgst numeric DEFAULT 0,
  sgst numeric DEFAULT 0,
  total_gst numeric GENERATED ALWAYS AS (
    COALESCE(igst, 0) + COALESCE(cgst, 0) + COALESCE(sgst, 0)
  ) STORED,
  filing_period text NOT NULL,
  matched_invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.gstr2b_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS gstr2b_entries_all ON public.gstr2b_entries;
CREATE POLICY gstr2b_entries_all ON public.gstr2b_entries FOR ALL TO public USING (true) WITH CHECK (true);

-- ============================================================
-- PRIORITY 2 — duplicate columns + 90-day trigger
-- ============================================================
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS duplicate_flag boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS duplicate_of_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS duplicate_reason text,
  ADD COLUMN IF NOT EXISTS duplicate_probability numeric(5,2);

CREATE INDEX IF NOT EXISTS idx_invoices_duplicate_flag
  ON public.invoices (duplicate_flag)
  WHERE duplicate_flag = true;

CREATE OR REPLACE FUNCTION public.check_invoice_duplicate()
RETURNS trigger AS $$
DECLARE
  dup_id uuid;
  dup_reason text;
  new_norm text;
BEGIN
  dup_id := NULL;
  dup_reason := NULL;
  new_norm := lower(trim(COALESCE(NEW.vendor_name, '')));

  IF NEW.invoice_number IS NOT NULL AND NEW.invoice_number <> '' AND new_norm <> '' THEN
    SELECT i.id INTO dup_id
    FROM public.invoices i
    WHERE i.id IS DISTINCT FROM NEW.id
      AND lower(trim(COALESCE(i.vendor_name, ''))) = new_norm
      AND i.invoice_number = NEW.invoice_number
    LIMIT 1;
    IF dup_id IS NOT NULL THEN
      dup_reason := 'Same invoice number and vendor';
    END IF;
  END IF;

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
    END IF;
  END IF;

  NEW.duplicate_flag := (dup_id IS NOT NULL);
  NEW.duplicate_of_id := dup_id;
  NEW.duplicate_reason := dup_reason;
  IF dup_id IS NOT NULL AND NEW.duplicate_probability IS NULL THEN
    NEW.duplicate_probability := 87;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_check_duplicate ON public.invoices;
CREATE TRIGGER trg_check_duplicate
  BEFORE INSERT OR UPDATE OF total_amount, vendor_name, invoice_number, invoice_date, updated_at
  ON public.invoices
  FOR EACH ROW
  EXECUTE FUNCTION public.check_invoice_duplicate();

NOTIFY pgrst, 'reload schema';

-- Verify tables
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'gl_accounts','vendors','invoice_approvals','approval_rules',
    'ap_alerts','bank_guarantees','invoice_anomalies','gstr2b_entries'
  )
ORDER BY 1;

-- Verify duplicate columns
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'invoices'
  AND column_name LIKE 'duplicate%'
ORDER BY 1;

-- Trigger test (run after tables exist)
UPDATE public.invoices
SET updated_at = now()
WHERE invoice_number = 'PI-2026-007';

SELECT invoice_number, vendor_name, duplicate_flag,
       duplicate_of_id, duplicate_reason, duplicate_probability
FROM public.invoices
WHERE invoice_number IN ('PI-2026-001','PI-2026-007')
ORDER BY invoice_number;
