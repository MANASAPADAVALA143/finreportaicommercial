-- =============================================================================
-- FinReportAI AP Invoice — full schema for ftlycgfgbboxapxhlpad
-- Run ONCE in Supabase SQL Editor (project: finreportaicommercial / ftlycgfgbboxapxhlpad)
-- Source: https://github.com/MANASAPADAVALA143/apinvoice.git
-- Safe to re-run: uses IF NOT EXISTS / DROP POLICY IF EXISTS throughout
-- =============================================================================


-- >>> FILE: 20251210104937_create_invoice_tables.sql

/*
  # AP Invoice Processing System Schema

  1. New Tables
    - `invoices`
      - `id` (uuid, primary key)
      - `invoice_number` (text, unique, not null)
      - `invoice_date` (date, not null)
      - `due_date` (date, not null)
      - `vendor_name` (text, not null)
      - `vendor_email` (text)
      - `vendor_phone` (text)
      - `vendor_address` (text)
      - `total_amount` (decimal, not null)
      - `currency` (text, default 'USD')
      - `status` (text, default 'Processing')
      - `file_url` (text)
      - `file_type` (text)
      - `ifrs_category` (text)
      - `ifrs_confidence` (decimal)
      - `ifrs_explanation` (text)
      - `ifrs_manual_override` (boolean, default false)
      - `processing_time_seconds` (integer)
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)
      - `created_by` (uuid)
      - `approved_by` (uuid)
      - `approved_at` (timestamptz)

    - `invoice_line_items`
      - `id` (uuid, primary key)
      - `invoice_id` (uuid, foreign key)
      - `description` (text, not null)
      - `quantity` (decimal, not null)
      - `unit_price` (decimal, not null)
      - `total` (decimal, not null)
      - `created_at` (timestamptz)

    - `audit_logs`
      - `id` (uuid, primary key)
      - `invoice_id` (uuid, foreign key)
      - `action` (text, not null)
      - `field_changed` (text)
      - `old_value` (text)
      - `new_value` (text)
      - `user_id` (uuid)
      - `user_name` (text)
      - `created_at` (timestamptz)

  2. Security
    - Enable RLS on all tables
    - Add policies for public access (for demo purposes)
*/

-- Create invoices table
CREATE TABLE IF NOT EXISTS invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number text UNIQUE NOT NULL,
  invoice_date date NOT NULL,
  due_date date NOT NULL,
  vendor_name text NOT NULL,
  vendor_email text,
  vendor_phone text,
  vendor_address text,
  total_amount decimal(15, 2) NOT NULL,
  currency text DEFAULT 'USD',
  status text DEFAULT 'Processing',
  file_url text,
  file_type text,
  ifrs_category text,
  ifrs_confidence decimal(5, 2),
  ifrs_explanation text,
  ifrs_manual_override boolean DEFAULT false,
  processing_time_seconds integer,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  created_by uuid,
  approved_by uuid,
  approved_at timestamptz,
  CONSTRAINT valid_status CHECK (status IN ('Processing', 'Approved', 'Rejected', 'Paid'))
);

-- Create invoice_line_items table
CREATE TABLE IF NOT EXISTS invoice_line_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  description text NOT NULL,
  quantity decimal(10, 2) NOT NULL,
  unit_price decimal(15, 2) NOT NULL,
  total decimal(15, 2) NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Create audit_logs table
CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  action text NOT NULL,
  field_changed text,
  old_value text,
  new_value text,
  user_id uuid,
  user_name text,
  created_at timestamptz DEFAULT now()
);

-- Create settings table for app configuration
CREATE TABLE IF NOT EXISTS app_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  setting_key text UNIQUE NOT NULL,
  setting_value text NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

-- Idempotent: re-running in SQL Editor fails with 42710 if policies already exist
DROP POLICY IF EXISTS "Allow public read access to invoices" ON invoices;
DROP POLICY IF EXISTS "Allow public insert access to invoices" ON invoices;
DROP POLICY IF EXISTS "Allow public update access to invoices" ON invoices;
DROP POLICY IF EXISTS "Allow public delete access to invoices" ON invoices;
DROP POLICY IF EXISTS "Allow public read access to line items" ON invoice_line_items;
DROP POLICY IF EXISTS "Allow public insert access to line items" ON invoice_line_items;
DROP POLICY IF EXISTS "Allow public update access to line items" ON invoice_line_items;
DROP POLICY IF EXISTS "Allow public delete access to line items" ON invoice_line_items;
DROP POLICY IF EXISTS "Allow public read access to audit logs" ON audit_logs;
DROP POLICY IF EXISTS "Allow public insert access to audit logs" ON audit_logs;
DROP POLICY IF EXISTS "Allow public read access to settings" ON app_settings;
DROP POLICY IF EXISTS "Allow public write access to settings" ON app_settings;
DROP POLICY IF EXISTS "Allow public update access to settings" ON app_settings;

-- Create policies for public access (for demo purposes)
CREATE POLICY "Allow public read access to invoices"
  ON invoices FOR SELECT
  TO public
  USING (true);

CREATE POLICY "Allow public insert access to invoices"
  ON invoices FOR INSERT
  TO public
  WITH CHECK (true);

CREATE POLICY "Allow public update access to invoices"
  ON invoices FOR UPDATE
  TO public
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow public delete access to invoices"
  ON invoices FOR DELETE
  TO public
  USING (true);

CREATE POLICY "Allow public read access to line items"
  ON invoice_line_items FOR SELECT
  TO public
  USING (true);

CREATE POLICY "Allow public insert access to line items"
  ON invoice_line_items FOR INSERT
  TO public
  WITH CHECK (true);

CREATE POLICY "Allow public update access to line items"
  ON invoice_line_items FOR UPDATE
  TO public
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow public delete access to line items"
  ON invoice_line_items FOR DELETE
  TO public
  USING (true);

CREATE POLICY "Allow public read access to audit logs"
  ON audit_logs FOR SELECT
  TO public
  USING (true);

CREATE POLICY "Allow public insert access to audit logs"
  ON audit_logs FOR INSERT
  TO public
  WITH CHECK (true);

CREATE POLICY "Allow public read access to settings"
  ON app_settings FOR SELECT
  TO public
  USING (true);

CREATE POLICY "Allow public write access to settings"
  ON app_settings FOR INSERT
  TO public
  WITH CHECK (true);

CREATE POLICY "Allow public update access to settings"
  ON app_settings FOR UPDATE
  TO public
  USING (true)
  WITH CHECK (true);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_invoice_date ON invoices(invoice_date);
CREATE INDEX IF NOT EXISTS idx_invoices_vendor_name ON invoices(vendor_name);
CREATE INDEX IF NOT EXISTS idx_line_items_invoice_id ON invoice_line_items(invoice_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_invoice_id ON audit_logs(invoice_id);

-- >>> FILE: ADD-MISSING-INVOICE-COLUMNS.sql

-- Add missing columns to invoices table
-- Run this in Supabase SQL Editor: Dashboard â†’ SQL Editor â†’ New Query â†’ Paste â†’ Run
-- Fixes: "Could not find the 'approval_level' column" and related errors

-- Add approval workflow columns
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS approval_level text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS subtotal_amount decimal(15, 2);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS tax_type text DEFAULT 'None';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS tax_rate decimal(5, 2) DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS tax_amount decimal(15, 2) DEFAULT 0;

-- Add risk/anomaly detection columns
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS risk_score decimal(5, 2);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS risk_flags jsonb;

-- Add po_number if missing
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS po_number text;

-- Verify
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_schema = 'public' AND table_name = 'invoices'
ORDER BY ordinal_position;


-- >>> FILE: ADD-TAX-FIELDS-MANUAL.sql

-- Add Tax Handling Fields to invoices table
-- Run this SQL in your Supabase SQL Editor
-- Go to: Supabase Dashboard â†’ SQL Editor â†’ New Query â†’ Paste this â†’ Run

-- Add tax fields to invoices table
ALTER TABLE invoices
ADD COLUMN IF NOT EXISTS tax_type text DEFAULT 'None',
ADD COLUMN IF NOT EXISTS tax_rate decimal(5, 2) DEFAULT 0.00,
ADD COLUMN IF NOT EXISTS tax_amount decimal(15, 2) DEFAULT 0.00,
ADD COLUMN IF NOT EXISTS subtotal_amount decimal(15, 2);

-- Update existing invoices: set subtotal = total if subtotal is null
UPDATE invoices
SET subtotal_amount = total_amount
WHERE subtotal_amount IS NULL;

-- Make subtotal_amount NOT NULL after setting defaults
ALTER TABLE invoices
ALTER COLUMN subtotal_amount SET NOT NULL,
ALTER COLUMN subtotal_amount SET DEFAULT 0.00;

-- Add check constraint for tax_type (Postgres: no ADD CONSTRAINT IF NOT EXISTS)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'valid_tax_type') THEN
    ALTER TABLE invoices
      ADD CONSTRAINT valid_tax_type CHECK (tax_type IN ('None', 'VAT', 'GST', 'Sales Tax', 'Withholding Tax'));
  END IF;
END $$;

-- Create index for tax_type
CREATE INDEX IF NOT EXISTS idx_invoices_tax_type ON invoices(tax_type);

-- Verify the changes
SELECT 
  column_name, 
  data_type, 
  column_default
FROM information_schema.columns
WHERE table_name = 'invoices'
  AND column_name IN ('tax_type', 'tax_rate', 'tax_amount', 'subtotal_amount')
ORDER BY column_name;


-- >>> FILE: ADD-RISK-FIELDS-MANUAL.sql

-- Run this SQL in your Supabase SQL Editor to add risk detection fields
-- Go to: Supabase Dashboard â†’ SQL Editor â†’ New Query â†’ Paste this â†’ Run

-- Add risk_score column (low, medium, high)
ALTER TABLE invoices 
ADD COLUMN IF NOT EXISTS risk_score text CHECK (risk_score IN ('low', 'medium', 'high'));

-- Add risk_flags column (JSONB array to store risk flag objects)
ALTER TABLE invoices 
ADD COLUMN IF NOT EXISTS risk_flags jsonb DEFAULT '[]'::jsonb;

-- Add comment to explain the columns
COMMENT ON COLUMN invoices.risk_score IS 'Risk score calculated by anomaly detection: low, medium, or high';
COMMENT ON COLUMN invoices.risk_flags IS 'Array of risk flags detected during anomaly analysis';

-- Verify columns were added
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'invoices' 
  AND column_name IN ('risk_score', 'risk_flags');


-- >>> FILE: ADD-RISK-LEVEL-COLUMN.sql

-- Add risk_level column to invoices table
-- Run in Supabase: Dashboard â†’ SQL Editor â†’ New Query â†’ Paste â†’ Run
-- This fixes: "Could not find the 'risk_level' column of 'invoices' in the schema cache"

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS risk_level TEXT;

COMMENT ON COLUMN invoices.risk_level IS 'Risk level label from AI extraction: low, medium, or high';


-- >>> FILE: ADD-APPROVAL-FIELDS-MANUAL.sql

-- Run this SQL in your Supabase SQL Editor to add approval workflow fields
-- Go to: Supabase Dashboard â†’ SQL Editor â†’ New Query â†’ Paste this â†’ Run

-- Add approval_level column (none, manager, cfo)
ALTER TABLE invoices 
ADD COLUMN IF NOT EXISTS approval_level text CHECK (approval_level IN ('none', 'manager', 'cfo'));

-- Add rejection_reason column
ALTER TABLE invoices 
ADD COLUMN IF NOT EXISTS rejection_reason text;

-- Update approved_by and approved_at columns if they don't exist
-- (These might already exist, so we check first)
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'invoices' AND column_name = 'approved_by'
  ) THEN
    ALTER TABLE invoices ADD COLUMN approved_by text;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'invoices' AND column_name = 'approved_at'
  ) THEN
    ALTER TABLE invoices ADD COLUMN approved_at timestamptz;
  END IF;
END $$;

-- Add comments to explain the columns
COMMENT ON COLUMN invoices.approval_level IS 'Required approval level: none (auto-approved), manager, or cfo';
COMMENT ON COLUMN invoices.approved_by IS 'Name of the person who approved the invoice';
COMMENT ON COLUMN invoices.approved_at IS 'Timestamp when the invoice was approved';
COMMENT ON COLUMN invoices.rejection_reason IS 'Reason provided when invoice was rejected';

-- Verify columns were added
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'invoices' 
  AND column_name IN ('approval_level', 'approved_by', 'approved_at', 'rejection_reason');


-- >>> FILE: ADD-EXCHANGE-RATE-COLUMN.sql

-- Fix: "Could not find the 'exchange_rate_to_base' column" â€” bulk upload fails
-- Run in: Supabase Dashboard â†’ SQL Editor â†’ Paste â†’ Run
-- Then re-upload your Excel; all rows will import.

ALTER TABLE invoices
ADD COLUMN IF NOT EXISTS exchange_rate_to_base NUMERIC DEFAULT 1;

ALTER TABLE invoices
ADD COLUMN IF NOT EXISTS invoice_language text DEFAULT 'en';

NOTIFY pgrst, 'reload schema';


-- >>> FILE: OCR-CONFIDENCE-MIGRATION.sql

-- OCR / extraction confidence (global score + optional per-field map from n8n)
-- Safe to re-run.

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS ocr_confidence NUMERIC;

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS ocr_confidence_fields JSONB DEFAULT '{}'::jsonb;

-- Prefer explicit IFRS score where OCR column not set
UPDATE invoices
SET ocr_confidence = LEAST(100, GREATEST(0, ifrs_confidence))
WHERE ocr_confidence IS NULL
  AND ifrs_confidence IS NOT NULL
  AND ifrs_confidence > 0;

-- Field completeness fallback (20 points each): matches app logic
UPDATE invoices
SET ocr_confidence = LEAST(
  100,
  GREATEST(
    0,
    (CASE WHEN vendor_name IS NOT NULL AND trim(vendor_name) <> '' THEN 20 ELSE 0 END)
    + (CASE WHEN total_amount IS NOT NULL AND total_amount > 0 THEN 20 ELSE 0 END)
    + (CASE WHEN invoice_date IS NOT NULL AND trim(invoice_date::text) <> '' THEN 20 ELSE 0 END)
    + (CASE WHEN invoice_number IS NOT NULL AND trim(invoice_number) <> '' THEN 20 ELSE 0 END)
    + (CASE WHEN due_date IS NOT NULL AND trim(due_date::text) <> '' THEN 20 ELSE 0 END)
  )
)
WHERE ocr_confidence IS NULL;

NOTIFY pgrst, 'reload schema';


-- >>> FILE: ADD-GL-AUTO-SUGGEST-COLUMNS.sql

-- GL auto-suggest and account columns for invoices table
-- Run in Supabase SQL Editor if columns are missing.

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS gl_account_code TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS gl_account_name TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS gl_account_type TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS gl_auto_suggested BOOLEAN DEFAULT false;


-- >>> FILE: ADD-3WAY-MATCH-COLUMNS.sql

-- 3-Way Match columns for invoices table
-- Run in Supabase SQL Editor if columns are missing.
-- match_status and match_notes may already exist from CREATE-3WAY-MATCHING-TABLES.sql.

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS match_status TEXT DEFAULT 'no_po';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS match_difference NUMERIC;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS match_percentage NUMERIC;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS po_amount NUMERIC;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS grn_amount NUMERIC;


-- >>> FILE: ADD-GRN-CONFIRMATION-COLUMNS.sql

-- Add GRN (Goods Receipt Note) confirmation columns for true 3-way match
-- Run in: Supabase Dashboard â†’ SQL Editor â†’ Paste â†’ Run
-- Option B: Simple checkbox acts as GRN confirmation (no separate GRN upload)

ALTER TABLE invoices
ADD COLUMN IF NOT EXISTS grn_confirmed BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS grn_confirmed_by TEXT,
ADD COLUMN IF NOT EXISTS grn_confirmed_at TIMESTAMPTZ;

NOTIFY pgrst, 'reload schema';


-- >>> FILE: DUPLICATE-INVOICE-DETECTION.sql

-- Duplicate invoice detection (advisory flags on invoices).
-- InvoiceFlow uses vendor_name + total_amount (not vendor_id / amount). Adjust if you add vendor_id later.
-- Run in Supabase SQL Editor.

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS duplicate_flag BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS duplicate_of_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS duplicate_reason TEXT;

CREATE OR REPLACE FUNCTION check_invoice_duplicate()
RETURNS TRIGGER AS $$
DECLARE
  dup_id UUID;
  dup_reason TEXT;
  v_norm TEXT;
  new_norm TEXT;
BEGIN
  dup_id := NULL;
  dup_reason := NULL;
  new_norm := lower(trim(COALESCE(NEW.vendor_name, '')));

  -- Rule 1: same invoice_number + same vendor (by name)
  IF NEW.invoice_number IS NOT NULL AND NEW.invoice_number <> '' AND new_norm <> '' THEN
    SELECT i.id INTO dup_id
    FROM invoices i
    WHERE i.id IS DISTINCT FROM NEW.id
      AND lower(trim(COALESCE(i.vendor_name, ''))) = new_norm
      AND i.invoice_number = NEW.invoice_number
    LIMIT 1;

    IF dup_id IS NOT NULL THEN
      dup_reason := 'Same invoice number and vendor';
    END IF;
  END IF;

  -- Rule 2: same vendor + same total_amount + invoice_date within 7 days
  IF dup_id IS NULL AND new_norm <> '' AND NEW.invoice_date IS NOT NULL THEN
    SELECT i.id INTO dup_id
    FROM invoices i
    WHERE i.id IS DISTINCT FROM NEW.id
      AND lower(trim(COALESCE(i.vendor_name, ''))) = new_norm
      AND i.total_amount IS NOT DISTINCT FROM NEW.total_amount
      AND i.invoice_date IS NOT NULL
      AND ABS((i.invoice_date::date) - (NEW.invoice_date::date)) <= 7
    LIMIT 1;

    IF dup_id IS NOT NULL THEN
      dup_reason := 'Same vendor and amount within 7 days';
    END IF;
  END IF;

  -- Rule 3: same vendor + same amount + same invoice_number (redundant if R1 matched; catches edge NULL cases)
  IF dup_id IS NULL AND new_norm <> '' AND NEW.invoice_number IS NOT NULL THEN
    SELECT i.id INTO dup_id
    FROM invoices i
    WHERE i.id IS DISTINCT FROM NEW.id
      AND lower(trim(COALESCE(i.vendor_name, ''))) = new_norm
      AND i.total_amount IS NOT DISTINCT FROM NEW.total_amount
      AND i.invoice_number = NEW.invoice_number
    LIMIT 1;

    IF dup_id IS NOT NULL THEN
      dup_reason := 'Same vendor, amount, and invoice number';
    END IF;
  END IF;

  NEW.duplicate_flag := (dup_id IS NOT NULL);
  NEW.duplicate_of_id := dup_id;
  NEW.duplicate_reason := dup_reason;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_check_duplicate ON invoices;

CREATE TRIGGER trg_check_duplicate
  BEFORE INSERT OR UPDATE OF total_amount, vendor_name, invoice_number, invoice_date
  ON invoices
  FOR EACH ROW
  EXECUTE FUNCTION check_invoice_duplicate();
-- If your Postgres build rejects EXECUTE FUNCTION, use: EXECUTE PROCEDURE check_invoice_duplicate();

NOTIFY pgrst, 'reload schema';


-- >>> FILE: APPROVAL-WORKFLOW-MIGRATION.sql

-- Multi-step AP approval chain: rules, per-approver rows, invoice columns.
-- Run in Supabase SQL Editor. Safe to re-run: uses IF NOT EXISTS where possible.

-- Enum types
DO $$ BEGIN
  CREATE TYPE invoice_chain_approval_status AS ENUM (
    'not_required',
    'pending',
    'approved',
    'rejected'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE invoice_approval_row_status AS ENUM (
    'pending',
    'approved',
    'rejected'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Rules: amount bands + approver emails
CREATE TABLE IF NOT EXISTS approval_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  min_amount NUMERIC(18, 2) NOT NULL DEFAULT 0,
  max_amount NUMERIC(18, 2),
  required_approvers INT NOT NULL DEFAULT 1 CHECK (required_approvers >= 1),
  approver_emails TEXT[] NOT NULL DEFAULT '{}',
  department TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_approval_rules_department ON approval_rules (department);
CREATE INDEX IF NOT EXISTS idx_approval_rules_min_max ON approval_rules (min_amount, max_amount);

-- One row per approver step (only the current step exists as pending until advanced)
CREATE TABLE IF NOT EXISTS invoice_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  step_index INT NOT NULL DEFAULT 0 CHECK (step_index >= 0),
  approver_email TEXT NOT NULL,
  status invoice_approval_row_status NOT NULL DEFAULT 'pending',
  comment TEXT,
  actioned_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (invoice_id, step_index)
);

CREATE INDEX IF NOT EXISTS idx_invoice_approvals_invoice ON invoice_approvals (invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_approvals_email_status ON invoice_approvals (approver_email, status);

-- Invoice columns (chain workflow; complements existing status / approval_level)
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS approval_status invoice_chain_approval_status NOT NULL DEFAULT 'not_required';

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS current_approver_index INT NOT NULL DEFAULT 0;

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS approval_rule_id UUID REFERENCES approval_rules(id) ON DELETE SET NULL;

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS submitted_for_approval_at TIMESTAMPTZ;

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS approval_submitted_by TEXT;

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS approval_chain_emails TEXT[];

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS approval_total_steps INT;

-- Demo-friendly policies (aligns with optional RLS-off on invoices)
ALTER TABLE approval_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_approvals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "approval_rules_all" ON approval_rules;
CREATE POLICY "approval_rules_all" ON approval_rules FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "invoice_approvals_all" ON invoice_approvals;
CREATE POLICY "invoice_approvals_all" ON invoice_approvals FOR ALL USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload schema';


-- >>> FILE: UAE-MARKET-MIGRATION.sql

-- UAE Market Mode Migration
-- Run this in Supabase SQL Editor
-- Adds UAE VAT fields to invoices and companies tables

-- Step 1: Add UAE VAT columns to invoices
ALTER TABLE invoices
ADD COLUMN IF NOT EXISTS vendor_trn TEXT,
ADD COLUMN IF NOT EXISTS buyer_trn TEXT,
ADD COLUMN IF NOT EXISTS vat_amount DECIMAL(15,2),
ADD COLUMN IF NOT EXISTS vat_rate DECIMAL(5,2),
ADD COLUMN IF NOT EXISTS trn_valid BOOLEAN,
ADD COLUMN IF NOT EXISTS designated_zone BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS reverse_charge BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS vat_treatment TEXT,
ADD COLUMN IF NOT EXISTS fta_filing_period TEXT;

-- Step 2: Add market columns to companies (only after companies table exists — created in MULTI-TENANT section below)
DO $$
BEGIN
  IF to_regclass('public.companies') IS NOT NULL THEN
    ALTER TABLE public.companies
      ADD COLUMN IF NOT EXISTS market TEXT DEFAULT 'india',
      ADD COLUMN IF NOT EXISTS fta_registration TEXT,
      ADD COLUMN IF NOT EXISTS vat_filing_frequency TEXT DEFAULT 'quarterly',
      ADD COLUMN IF NOT EXISTS emirate TEXT;
    CREATE INDEX IF NOT EXISTS idx_companies_market ON public.companies(market);
  END IF;
END $$;

-- Step 3: Add index for TRN lookups
CREATE INDEX IF NOT EXISTS idx_invoices_vendor_trn ON invoices(vendor_trn);


-- >>> FILE: CREATE-PURCHASE-ORDERS-TABLE.sql

-- Create purchase_orders table (run in Supabase SQL Editor)
-- Use this if the table is missing or RLS is blocking the app.
--
-- Order: If starting fresh, prefer SETUP-PURCHASE-ORDERS.sql (table + RLS in one file).
-- If FIX-PO-RLS.sql failed with "relation does not exist", create the table first (this file),
-- then run FIX-PO-RLS.sql to replace migrations that blocked the anon key.

-- Table schema compatible with InvoiceFlow (po_amount, po_date for 3-way match)
CREATE TABLE IF NOT EXISTS purchase_orders (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  po_number TEXT UNIQUE NOT NULL,
  vendor_name TEXT NOT NULL,
  vendor_email TEXT,
  po_amount NUMERIC NOT NULL DEFAULT 0,
  currency TEXT DEFAULT 'USD',
  po_date DATE,
  delivery_date DATE,
  description TEXT,
  status TEXT DEFAULT 'Open',
  line_items JSONB DEFAULT '[]',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Ensure status constraint exists (skip if already present)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'valid_po_status'
  ) THEN
    ALTER TABLE purchase_orders
    ADD CONSTRAINT valid_po_status
    CHECK (status IN ('Open', 'Partially Received', 'Fully Received', 'Closed', 'Cancelled'));
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Enable RLS
ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;

-- Drop restrictive policy if it exists (e.g. "Users can manage own POs" that blocks anon)
DROP POLICY IF EXISTS "Users can manage own POs" ON purchase_orders;

-- Allow public read/write for demo (so app works without auth)
CREATE POLICY "Allow public read access to purchase_orders"
  ON purchase_orders FOR SELECT TO public USING (true);

CREATE POLICY "Allow public insert access to purchase_orders"
  ON purchase_orders FOR INSERT TO public WITH CHECK (true);

CREATE POLICY "Allow public update access to purchase_orders"
  ON purchase_orders FOR UPDATE TO public USING (true) WITH CHECK (true);

CREATE POLICY "Allow public delete access to purchase_orders"
  ON purchase_orders FOR DELETE TO public USING (true);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_purchase_orders_po_number ON purchase_orders(po_number);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_vendor_name ON purchase_orders(vendor_name);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_status ON purchase_orders(status);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_created_at ON purchase_orders(created_at DESC);


-- >>> FILE: CREATE-GL-ACCOUNTS-TABLE.sql

-- Create GL Accounts Table
-- Run this SQL in your Supabase SQL Editor
-- Go to: Supabase Dashboard â†’ SQL Editor â†’ New Query â†’ Paste this â†’ Run

-- Create gl_accounts table
CREATE TABLE IF NOT EXISTS gl_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gl_code text UNIQUE NOT NULL,
  gl_name text NOT NULL,
  account_type text NOT NULL,
  department text,
  cost_center text,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT valid_account_type CHECK (account_type IN ('Asset', 'Liability', 'Equity', 'Revenue', 'Expense', 'COGS'))
);

-- Add GL fields to invoices table
ALTER TABLE invoices
ADD COLUMN IF NOT EXISTS gl_code text,
ADD COLUMN IF NOT EXISTS gl_name text,
ADD COLUMN IF NOT EXISTS department text,
ADD COLUMN IF NOT EXISTS cost_center text,
ADD COLUMN IF NOT EXISTS project_code text;

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_gl_accounts_code ON gl_accounts(gl_code);
CREATE INDEX IF NOT EXISTS idx_gl_accounts_active ON gl_accounts(is_active);
CREATE INDEX IF NOT EXISTS idx_invoices_gl_code ON invoices(gl_code);
CREATE INDEX IF NOT EXISTS idx_invoices_department ON invoices(department);

-- Enable RLS
ALTER TABLE gl_accounts ENABLE ROW LEVEL SECURITY;

-- Create policies for public access (for demo purposes)
CREATE POLICY "Allow public read access to gl_accounts"
  ON gl_accounts FOR SELECT
  TO public
  USING (true);

CREATE POLICY "Allow public insert access to gl_accounts"
  ON gl_accounts FOR INSERT
  TO public
  WITH CHECK (true);

CREATE POLICY "Allow public update access to gl_accounts"
  ON gl_accounts FOR UPDATE
  TO public
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow public delete access to gl_accounts"
  ON gl_accounts FOR DELETE
  TO public
  USING (true);

-- Pre-populate with common GL accounts
INSERT INTO gl_accounts (gl_code, gl_name, account_type, department, cost_center) VALUES
  ('6100', 'Office Supplies', 'Expense', 'Administration', 'ADM-001'),
  ('6200', 'Professional Services', 'Expense', 'Operations', 'OPS-001'),
  ('6300', 'Marketing & Advertising', 'Expense', 'Marketing', 'MKT-001'),
  ('6400', 'Travel & Entertainment', 'Expense', 'Operations', 'OPS-002'),
  ('5000', 'Cost of Goods Sold', 'COGS', 'Operations', 'OPS-001'),
  ('2100', 'Accounts Payable', 'Liability', 'Finance', 'FIN-001'),
  ('7100', 'Interest Expense', 'Expense', 'Finance', 'FIN-001'),
  ('1600', 'Capital Equipment', 'Asset', 'Operations', 'OPS-001'),
  ('4100', 'Revenue - Services', 'Revenue', 'Sales', 'SAL-001'),
  ('4200', 'Revenue - Products', 'Revenue', 'Sales', 'SAL-001'),
  ('6500', 'Utilities', 'Expense', 'Operations', 'OPS-001'),
  ('6600', 'Rent Expense', 'Expense', 'Operations', 'OPS-001'),
  ('6700', 'Insurance', 'Expense', 'Finance', 'FIN-001'),
  ('6800', 'Depreciation', 'Expense', 'Finance', 'FIN-001')
ON CONFLICT (gl_code) DO NOTHING;

-- Verify tables were created
SELECT 
  'gl_accounts' as table_name, 
  COUNT(*) as row_count 
FROM gl_accounts;


-- >>> FILE: CREATE-3WAY-MATCHING-TABLES.sql

-- Create 3-Way Matching Tables
-- Run this SQL in your Supabase SQL Editor
-- Go to: Supabase Dashboard â†’ SQL Editor â†’ New Query â†’ Paste this â†’ Run

-- Create purchase_orders table
CREATE TABLE IF NOT EXISTS purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  po_number text UNIQUE NOT NULL,
  vendor_name text NOT NULL,
  po_amount decimal(15, 2) NOT NULL,
  po_date date NOT NULL,
  description text,
  status text DEFAULT 'Open',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT valid_po_status CHECK (status IN ('Open', 'Partially Received', 'Fully Received', 'Closed', 'Cancelled'))
);

-- Create goods_receipts table
CREATE TABLE IF NOT EXISTS goods_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grn_number text UNIQUE NOT NULL,
  po_id uuid REFERENCES purchase_orders(id) ON DELETE SET NULL,
  vendor_name text NOT NULL,
  received_amount decimal(15, 2) NOT NULL,
  received_date date NOT NULL,
  description text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Add match fields to invoices table
ALTER TABLE invoices
ADD COLUMN IF NOT EXISTS po_number text,
ADD COLUMN IF NOT EXISTS match_status text DEFAULT 'no_po',
ADD COLUMN IF NOT EXISTS match_notes text;

-- Add check constraint for match_status
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'valid_match_status') THEN
    ALTER TABLE invoices
      ADD CONSTRAINT valid_match_status CHECK (match_status IN ('matched', 'partial', 'mismatch', 'no_po'));
  END IF;
END $$;

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_purchase_orders_po_number ON purchase_orders(po_number);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_vendor_name ON purchase_orders(vendor_name);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_status ON purchase_orders(status);
CREATE INDEX IF NOT EXISTS idx_goods_receipts_grn_number ON goods_receipts(grn_number);
CREATE INDEX IF NOT EXISTS idx_goods_receipts_po_id ON goods_receipts(po_id);
CREATE INDEX IF NOT EXISTS idx_invoices_po_number ON invoices(po_number);
CREATE INDEX IF NOT EXISTS idx_invoices_match_status ON invoices(match_status);

-- Enable RLS
ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE goods_receipts ENABLE ROW LEVEL SECURITY;

-- Create policies for public access (for demo purposes)
CREATE POLICY "Allow public read access to purchase_orders"
  ON purchase_orders FOR SELECT
  TO public
  USING (true);

CREATE POLICY "Allow public insert access to purchase_orders"
  ON purchase_orders FOR INSERT
  TO public
  WITH CHECK (true);

CREATE POLICY "Allow public update access to purchase_orders"
  ON purchase_orders FOR UPDATE
  TO public
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow public delete access to purchase_orders"
  ON purchase_orders FOR DELETE
  TO public
  USING (true);

CREATE POLICY "Allow public read access to goods_receipts"
  ON goods_receipts FOR SELECT
  TO public
  USING (true);

CREATE POLICY "Allow public insert access to goods_receipts"
  ON goods_receipts FOR INSERT
  TO public
  WITH CHECK (true);

CREATE POLICY "Allow public update access to goods_receipts"
  ON goods_receipts FOR UPDATE
  TO public
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow public delete access to goods_receipts"
  ON goods_receipts FOR DELETE
  TO public
  USING (true);

-- Verify tables were created
SELECT 
  'purchase_orders' as table_name, 
  COUNT(*) as row_count 
FROM purchase_orders
UNION ALL
SELECT 
  'goods_receipts' as table_name, 
  COUNT(*) as row_count 
FROM goods_receipts;


-- >>> FILE: GST-RECONCILIATION-MIGRATION.sql

-- GST reconciliation: invoice GST fields, vendor GSTIN, GSTR-2B staging, reconcile RPC.
-- Run in Supabase SQL Editor.

-- Invoice GST columns
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS gstin TEXT,
  ADD COLUMN IF NOT EXISTS gst_amount NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cgst NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sgst NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS igst NUMERIC DEFAULT 0;

DO $$ BEGIN
  ALTER TABLE invoices
    ADD COLUMN gst_recon_status TEXT DEFAULT 'unmatched'
      CHECK (gst_recon_status IS NULL OR gst_recon_status IN ('unmatched', 'matched', 'mismatch', 'ignored'));
EXCEPTION
  WHEN duplicate_column THEN NULL;
END $$;

-- Vendor master (app previously had no vendors table â€” created here with GSTIN)
CREATE TABLE IF NOT EXISTS vendors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  gstin TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS vendors_name_lower_unique ON vendors (lower(trim(name)));

-- GSTR-2B upload rows
CREATE TABLE IF NOT EXISTS gstr2b_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_gstin TEXT NOT NULL,
  supplier_gstin TEXT,
  supplier_name TEXT,
  invoice_number TEXT,
  invoice_date DATE,
  taxable_value NUMERIC DEFAULT 0,
  igst NUMERIC DEFAULT 0,
  cgst NUMERIC DEFAULT 0,
  sgst NUMERIC DEFAULT 0,
  total_gst NUMERIC GENERATED ALWAYS AS (COALESCE(igst, 0) + COALESCE(cgst, 0) + COALESCE(sgst, 0)) STORED,
  filing_period TEXT NOT NULL,
  matched_invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gstr2b_supplier_inv ON gstr2b_entries (supplier_gstin, invoice_number);
CREATE INDEX IF NOT EXISTS idx_gstr2b_company_period ON gstr2b_entries (company_gstin, filing_period);
CREATE INDEX IF NOT EXISTS idx_invoices_gstin ON invoices (gstin);

ALTER TABLE gstr2b_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "gstr2b_entries_all" ON gstr2b_entries;
CREATE POLICY "gstr2b_entries_all" ON gstr2b_entries FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "vendors_all" ON vendors;
CREATE POLICY "vendors_all" ON vendors FOR ALL USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION reconcile_gst_period(p_period TEXT, p_company_gstin TEXT)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  matched_count INT := 0;
  mismatch_count INT := 0;
  unmatched_count INT := 0;
  inv RECORD;
  gstr_id UUID;
  gstr_total NUMERIC;
BEGIN
  UPDATE gstr2b_entries
  SET matched_invoice_id = NULL
  WHERE company_gstin = p_company_gstin
    AND filing_period = p_period;

  UPDATE invoices
  SET gst_recon_status = 'unmatched'
  WHERE to_char(invoice_date::date, 'YYYY-MM') = p_period
    AND COALESCE(gst_amount, 0) > 0
    AND gst_recon_status IS DISTINCT FROM 'ignored';

  FOR inv IN
    SELECT *
    FROM invoices
    WHERE to_char(invoice_date::date, 'YYYY-MM') = p_period
      AND COALESCE(gst_amount, 0) > 0
      AND gst_recon_status IS DISTINCT FROM 'ignored'
  LOOP
    gstr_id := NULL;
    gstr_total := NULL;

    IF inv.gstin IS NOT NULL AND btrim(inv.gstin) <> '' AND inv.invoice_number IS NOT NULL THEN
      SELECT g.id, g.total_gst
      INTO gstr_id, gstr_total
      FROM gstr2b_entries g
      WHERE g.company_gstin = p_company_gstin
        AND g.filing_period = p_period
        AND upper(replace(btrim(g.supplier_gstin), ' ', '')) = upper(replace(btrim(inv.gstin), ' ', ''))
        AND g.invoice_number = inv.invoice_number
      LIMIT 1;
    END IF;

    IF gstr_id IS NULL AND inv.gstin IS NOT NULL AND btrim(inv.gstin) <> '' THEN
      SELECT g.id, g.total_gst
      INTO gstr_id, gstr_total
      FROM gstr2b_entries g
      WHERE g.company_gstin = p_company_gstin
        AND g.filing_period = p_period
        AND upper(replace(btrim(g.supplier_gstin), ' ', '')) = upper(replace(btrim(inv.gstin), ' ', ''))
        AND abs(g.total_gst - COALESCE(inv.gst_amount, 0)) < 1
        AND g.invoice_date IS NOT NULL
        AND abs((g.invoice_date::date) - (inv.invoice_date::date)) <= 3
      LIMIT 1;
    END IF;

    IF gstr_id IS NOT NULL THEN
      IF abs(COALESCE(gstr_total, 0) - COALESCE(inv.gst_amount, 0)) < 1 THEN
        UPDATE invoices SET gst_recon_status = 'matched' WHERE id = inv.id;
        UPDATE gstr2b_entries SET matched_invoice_id = inv.id WHERE id = gstr_id;
        matched_count := matched_count + 1;
      ELSE
        UPDATE invoices SET gst_recon_status = 'mismatch' WHERE id = inv.id;
        mismatch_count := mismatch_count + 1;
      END IF;
    ELSE
      unmatched_count := unmatched_count + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'matched', matched_count,
    'mismatch', mismatch_count,
    'unmatched', unmatched_count,
    'period', p_period
  );
END;
$$;

GRANT EXECUTE ON FUNCTION reconcile_gst_period(TEXT, TEXT) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';


-- >>> FILE: EMAIL-INBOX-MIGRATION.sql

-- Email intake tracking on invoices
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS source text
    DEFAULT 'upload'
    CHECK (source IN ('upload', 'email', 'vendor_portal', 'manual')),
  ADD COLUMN IF NOT EXISTS source_email_from text,
  ADD COLUMN IF NOT EXISTS source_email_subject text,
  ADD COLUMN IF NOT EXISTS source_email_received_at timestamptz;

-- Email inbox configuration
CREATE TABLE IF NOT EXISTS email_inbox_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  forwarding_address text NOT NULL,
  provider text DEFAULT 'n8n',
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- Email intake log (one row per email received)
CREATE TABLE IF NOT EXISTS email_intake_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_address text,
  subject text,
  received_at timestamptz DEFAULT now(),
  attachment_count int DEFAULT 0,
  invoices_created int DEFAULT 0,
  status text DEFAULT 'processed' CHECK (status IN ('processed', 'failed', 'skipped')),
  error_message text,
  raw_payload jsonb DEFAULT '{}'::jsonb
);

ALTER TABLE email_inbox_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_intake_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "email_inbox_config_all" ON email_inbox_config
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "email_intake_log_all" ON email_intake_log
  FOR ALL USING (true) WITH CHECK (true);


-- >>> FILE: MULTI-TENANT-MIGRATION.sql

-- ============================================================
-- InvoiceFlow â€” Multi-tenant company layer + RLS
-- Run in Supabase SQL Editor AFTER backups.
-- Migrates existing rows into default company "my-company".
--
-- IMPORTANT: Run this file from the FIRST line to the LAST line
-- in ONE execution. Do not paste only the bottom (indexes/NOTIFY);
-- that will fail if companies / approval_rules / etc. are missing.
--
-- Optional: run APPROVAL-WORKFLOW-MIGRATION.sql (and other feature
-- SQL) first if you need approval_rules, invoice_approvals, etc.
-- ============================================================

-- â”€â”€ 1) Core tables â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

CREATE TABLE IF NOT EXISTS public.companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text UNIQUE NOT NULL,
  industry text DEFAULT 'general',
  accounting_standard text DEFAULT 'IFRS',
  logo_url text,
  primary_color text DEFAULT '#1D9E75',
  subscription_tier text NOT NULL DEFAULT 'starter'
    CHECK (subscription_tier IN ('starter', 'growth', 'enterprise')),
  subscription_status text NOT NULL DEFAULT 'trial'
    CHECK (subscription_status IN ('trial', 'active', 'paused', 'cancelled')),
  trial_ends_at timestamptz DEFAULT (now() + interval '30 days'),
  max_invoices_per_month int NOT NULL DEFAULT 100,
  max_users int NOT NULL DEFAULT 5,
  price_inr_monthly int DEFAULT 2999,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

COMMENT ON TABLE public.companies IS 'One row per SaaS client / tenant.';

CREATE TABLE IF NOT EXISTS public.company_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'viewer'
    CHECK (role IN ('super_admin', 'owner', 'admin', 'finance_manager', 'approver', 'viewer')),
  name text,
  email text,
  is_active boolean NOT NULL DEFAULT true,
  invited_at timestamptz DEFAULT now(),
  joined_at timestamptz,
  UNIQUE (company_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_company_members_user ON public.company_members(user_id);
CREATE INDEX IF NOT EXISTS idx_company_members_company ON public.company_members(company_id);

CREATE TABLE IF NOT EXISTS public.company_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL UNIQUE REFERENCES public.companies(id) ON DELETE CASCADE,
  approval_flow jsonb DEFAULT '["Finance Manager", "CFO"]'::jsonb,
  vendor_rules jsonb DEFAULT '{}'::jsonb,
  gl_mapping jsonb DEFAULT '{}'::jsonb,
  compliance_rules jsonb DEFAULT '{
    "gst_check_enabled": true,
    "duplicate_check_enabled": true,
    "duplicate_lookback_days": 365,
    "max_amount_without_po": 50000,
    "require_po_above": 100000,
    "blocked_vendors": []
  }'::jsonb,
  agent_config jsonb DEFAULT '{
    "high_value_threshold_inr": 500000,
    "auto_approve_min_confidence": 90,
    "auto_approve_max_risk_score": 30,
    "require_human_new_vendor": true,
    "require_human_critical_risk": true,
    "require_human_duplicate": true,
    "sla_hours_before_escalation": 4
  }'::jsonb,
  erp_config jsonb DEFAULT '{
    "primary_erp": "none",
    "tally_enabled": false,
    "zoho_enabled": false,
    "sap_enabled": false,
    "quickbooks_enabled": false,
    "export_format": "csv"
  }'::jsonb,
  notification_config jsonb DEFAULT '{
    "approval_email_enabled": true,
    "approval_whatsapp_enabled": false,
    "weekly_summary_enabled": true,
    "fraud_alert_email": ""
  }'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- â”€â”€ 2) Helper functions (RLS) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

CREATE OR REPLACE FUNCTION public.get_my_company_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT company_id
  FROM public.company_members
  WHERE user_id = auth.uid() AND is_active = true
  ORDER BY joined_at NULLS LAST, invited_at
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.company_members m
    WHERE m.user_id = auth.uid()
      AND m.is_active
      AND m.role = 'super_admin'
  );
$$;

CREATE OR REPLACE FUNCTION public.get_effective_company_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  jwt jsonb := coalesce(auth.jwt(), '{}'::jsonb);
  meta text := jwt #>> '{user_metadata,active_company_id}';
  meta_uuid uuid;
  mid uuid;
  def uuid;
BEGIN
  SELECT c.id INTO def FROM public.companies c WHERE c.slug = 'my-company' LIMIT 1;

  IF uid IS NULL THEN
    RETURN def;
  END IF;

  IF meta IS NOT NULL AND btrim(meta) <> '' THEN
    BEGIN
      meta_uuid := meta::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      meta_uuid := NULL;
    END;
    IF meta_uuid IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.company_members m
      WHERE m.user_id = uid AND m.is_active AND m.company_id = meta_uuid
    ) THEN
      RETURN meta_uuid;
    END IF;
  END IF;

  SELECT m.company_id INTO mid
  FROM public.company_members m
  WHERE m.user_id = uid AND m.is_active
  ORDER BY m.joined_at NULLS LAST, m.invited_at
  LIMIT 1;

  IF mid IS NOT NULL THEN
    RETURN mid;
  END IF;

  RETURN def;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_company_id() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_effective_company_id() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_super_admin() TO anon, authenticated;

-- â”€â”€ 3) Default company + attach existing data â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

DO $$
DECLARE
  default_company_id uuid;
BEGIN
  INSERT INTO public.companies (name, slug, industry, subscription_tier, max_invoices_per_month, max_users, price_inr_monthly)
  VALUES ('My Company', 'my-company', 'finance', 'starter', 100, 5, 2999)
  ON CONFLICT (slug) DO NOTHING;

  SELECT id INTO default_company_id FROM public.companies WHERE slug = 'my-company' LIMIT 1;

  INSERT INTO public.company_config (company_id)
  VALUES (default_company_id)
  ON CONFLICT (company_id) DO NOTHING;

  -- invoices
  IF to_regclass('public.invoices') IS NOT NULL THEN
    ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id);
    UPDATE public.invoices SET company_id = default_company_id WHERE company_id IS NULL;
  END IF;

  -- vendors
  IF to_regclass('public.vendors') IS NOT NULL THEN
    ALTER TABLE public.vendors ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id);
    UPDATE public.vendors SET company_id = default_company_id WHERE company_id IS NULL;
  END IF;

  -- gl_accounts
  IF to_regclass('public.gl_accounts') IS NOT NULL THEN
    ALTER TABLE public.gl_accounts ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id);
    UPDATE public.gl_accounts SET company_id = default_company_id WHERE company_id IS NULL;
  END IF;

  -- approval_rules
  IF to_regclass('public.approval_rules') IS NOT NULL THEN
    ALTER TABLE public.approval_rules ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id);
    UPDATE public.approval_rules SET company_id = default_company_id WHERE company_id IS NULL;
  END IF;

  -- purchase_orders
  IF to_regclass('public.purchase_orders') IS NOT NULL THEN
    ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id);
    UPDATE public.purchase_orders SET company_id = default_company_id WHERE company_id IS NULL;
  END IF;

  -- goods_receipts
  IF to_regclass('public.goods_receipts') IS NOT NULL THEN
    ALTER TABLE public.goods_receipts ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id);
    UPDATE public.goods_receipts SET company_id = default_company_id WHERE company_id IS NULL;
  END IF;

  -- fraud_scan_results (optional)
  IF to_regclass('public.fraud_scan_results') IS NOT NULL THEN
    ALTER TABLE public.fraud_scan_results ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id);
    UPDATE public.fraud_scan_results SET company_id = default_company_id WHERE company_id IS NULL;
  END IF;

  -- audit_log (singular, compliance)
  IF to_regclass('public.audit_log') IS NOT NULL THEN
    ALTER TABLE public.audit_log ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id);
    UPDATE public.audit_log SET company_id = default_company_id WHERE company_id IS NULL;
  END IF;

  -- chart_of_accounts
  IF to_regclass('public.chart_of_accounts') IS NOT NULL THEN
    ALTER TABLE public.chart_of_accounts ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id);
    UPDATE public.chart_of_accounts SET company_id = default_company_id WHERE company_id IS NULL;
  END IF;

  -- company_settings
  IF to_regclass('public.company_settings') IS NOT NULL THEN
    ALTER TABLE public.company_settings ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id);
    UPDATE public.company_settings SET company_id = default_company_id WHERE company_id IS NULL;
  END IF;

  -- payment_batches
  IF to_regclass('public.payment_batches') IS NOT NULL THEN
    ALTER TABLE public.payment_batches ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id);
    UPDATE public.payment_batches SET company_id = default_company_id WHERE company_id IS NULL;
  END IF;

  -- gstr2b_entries
  IF to_regclass('public.gstr2b_entries') IS NOT NULL THEN
    ALTER TABLE public.gstr2b_entries ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id);
    UPDATE public.gstr2b_entries SET company_id = default_company_id WHERE company_id IS NULL;
  END IF;

  -- email_inbox_config
  IF to_regclass('public.email_inbox_config') IS NOT NULL THEN
    ALTER TABLE public.email_inbox_config ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id);
    UPDATE public.email_inbox_config SET company_id = default_company_id WHERE company_id IS NULL;
  END IF;

  -- email_intake_log
  IF to_regclass('public.email_intake_log') IS NOT NULL THEN
    ALTER TABLE public.email_intake_log ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id);
    UPDATE public.email_intake_log SET company_id = default_company_id WHERE company_id IS NULL;
  END IF;

  -- gl_suggestions_log
  IF to_regclass('public.gl_suggestions_log') IS NOT NULL THEN
    ALTER TABLE public.gl_suggestions_log ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id);
    UPDATE public.gl_suggestions_log SET company_id = default_company_id WHERE company_id IS NULL;
  END IF;
END $$;

-- Map existing auth users to default company as owner (so RLS works when logged in)
INSERT INTO public.company_members (company_id, user_id, role, joined_at, is_active)
SELECT c.id, u.id, 'owner', now(), true
FROM auth.users u
CROSS JOIN (SELECT id FROM public.companies WHERE slug = 'my-company' LIMIT 1) c
ON CONFLICT (company_id, user_id) DO NOTHING;

-- â”€â”€ 4) Drop permissive policies (replace with tenant RLS) â”€â”€

DO $$
DECLARE pol record;
BEGIN
  FOR pol IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = ANY (ARRAY[
        'invoices','invoice_line_items','audit_logs','vendors','gl_accounts',
        'approval_rules','invoice_approvals','purchase_orders','goods_receipts',
        'gstr2b_entries','payment_batches','email_inbox_config','email_intake_log',
        'company_settings','chart_of_accounts','gl_suggestions_log','audit_log',
        'fraud_scan_results'
      ])
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', pol.policyname, pol.schemaname, pol.tablename);
  END LOOP;
END $$;

-- â”€â”€ 5) Enable RLS + tenant policies â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS companies_select ON public.companies;
DROP POLICY IF EXISTS companies_insert ON public.companies;
DROP POLICY IF EXISTS companies_update ON public.companies;
DROP POLICY IF EXISTS company_config_all ON public.company_config;
DROP POLICY IF EXISTS company_members_select ON public.company_members;
DROP POLICY IF EXISTS company_members_insert ON public.company_members;
DROP POLICY IF EXISTS company_members_update ON public.company_members;
DROP POLICY IF EXISTS invoices_tenant ON public.invoices;
DROP POLICY IF EXISTS invoice_line_items_tenant ON public.invoice_line_items;
DROP POLICY IF EXISTS audit_logs_tenant ON public.audit_logs;

DO $$
BEGIN
  IF to_regclass('public.vendors') IS NOT NULL THEN
    DROP POLICY IF EXISTS vendors_tenant ON public.vendors;
  END IF;
  IF to_regclass('public.gl_accounts') IS NOT NULL THEN
    DROP POLICY IF EXISTS gl_accounts_tenant ON public.gl_accounts;
  END IF;
  IF to_regclass('public.approval_rules') IS NOT NULL THEN
    DROP POLICY IF EXISTS approval_rules_tenant ON public.approval_rules;
  END IF;
  IF to_regclass('public.invoice_approvals') IS NOT NULL THEN
    DROP POLICY IF EXISTS invoice_approvals_tenant ON public.invoice_approvals;
  END IF;
  IF to_regclass('public.purchase_orders') IS NOT NULL THEN
    DROP POLICY IF EXISTS purchase_orders_tenant ON public.purchase_orders;
  END IF;
END $$;

CREATE POLICY companies_select ON public.companies
  FOR SELECT TO public
  USING (
    public.is_super_admin()
    OR id IN (SELECT m.company_id FROM public.company_members m WHERE m.user_id = auth.uid() AND m.is_active)
    OR (auth.uid() IS NULL AND slug = 'my-company')
  );

CREATE POLICY companies_insert ON public.companies
  FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY companies_update ON public.companies
  FOR UPDATE TO public
  USING (public.is_super_admin() OR id = public.get_effective_company_id())
  WITH CHECK (public.is_super_admin() OR id = public.get_effective_company_id());

CREATE POLICY company_config_all ON public.company_config
  FOR ALL TO public
  USING (public.is_super_admin() OR company_id = public.get_effective_company_id())
  WITH CHECK (public.is_super_admin() OR company_id = public.get_effective_company_id());

CREATE POLICY company_members_select ON public.company_members
  FOR SELECT TO public
  USING (
    public.is_super_admin()
    OR company_id = public.get_effective_company_id()
    OR user_id = auth.uid()
  );

CREATE POLICY company_members_insert ON public.company_members
  FOR INSERT TO public
  WITH CHECK (
    public.is_super_admin()
    OR user_id = auth.uid()
    OR (
      user_id IS NULL
      AND EXISTS (
        SELECT 1 FROM public.company_members x
        WHERE x.company_id = company_members.company_id
          AND x.user_id = auth.uid()
          AND x.is_active
          AND x.role IN ('owner', 'admin', 'super_admin')
      )
    )
  );

CREATE POLICY company_members_update ON public.company_members
  FOR UPDATE TO public
  USING (public.is_super_admin() OR company_id = public.get_effective_company_id())
  WITH CHECK (public.is_super_admin() OR company_id = public.get_effective_company_id());

-- Invoices
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY invoices_tenant ON public.invoices
  FOR ALL TO public
  USING (public.is_super_admin() OR company_id = public.get_effective_company_id())
  WITH CHECK (public.is_super_admin() OR company_id = public.get_effective_company_id());

-- Line items (via parent invoice)
ALTER TABLE public.invoice_line_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY invoice_line_items_tenant ON public.invoice_line_items
  FOR ALL TO public
  USING (
    EXISTS (
      SELECT 1 FROM public.invoices i
      WHERE i.id = invoice_line_items.invoice_id
        AND (public.is_super_admin() OR i.company_id = public.get_effective_company_id())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.invoices i
      WHERE i.id = invoice_line_items.invoice_id
        AND (public.is_super_admin() OR i.company_id = public.get_effective_company_id())
    )
  );

-- Invoice-scoped audit_logs
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_logs_tenant ON public.audit_logs
  FOR ALL TO public
  USING (
    EXISTS (
      SELECT 1 FROM public.invoices i
      WHERE i.id = audit_logs.invoice_id
        AND (public.is_super_admin() OR i.company_id = public.get_effective_company_id())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.invoices i
      WHERE i.id = audit_logs.invoice_id
        AND (public.is_super_admin() OR i.company_id = public.get_effective_company_id())
    )
  );

-- Vendors (optional table â€” GST / vendor master)
DO $$
BEGIN
  IF to_regclass('public.vendors') IS NOT NULL THEN
    ALTER TABLE public.vendors ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS vendors_tenant ON public.vendors;
    EXECUTE $p$
      CREATE POLICY vendors_tenant ON public.vendors
        FOR ALL TO public
        USING (public.is_super_admin() OR company_id = public.get_effective_company_id())
        WITH CHECK (public.is_super_admin() OR company_id = public.get_effective_company_id());
    $p$;
  END IF;
END $$;

-- GL accounts (optional until GL migration)
DO $$
BEGIN
  IF to_regclass('public.gl_accounts') IS NOT NULL THEN
    ALTER TABLE public.gl_accounts ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS gl_accounts_tenant ON public.gl_accounts;
    EXECUTE $p$
      CREATE POLICY gl_accounts_tenant ON public.gl_accounts
        FOR ALL TO public
        USING (public.is_super_admin() OR company_id = public.get_effective_company_id())
        WITH CHECK (public.is_super_admin() OR company_id = public.get_effective_company_id());
    $p$;
  END IF;
END $$;

-- Approval rules (run APPROVAL-WORKFLOW-MIGRATION.sql first if missing)
DO $$
BEGIN
  IF to_regclass('public.approval_rules') IS NOT NULL THEN
    ALTER TABLE public.approval_rules ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS approval_rules_tenant ON public.approval_rules;
    EXECUTE $p$
      CREATE POLICY approval_rules_tenant ON public.approval_rules
        FOR ALL TO public
        USING (public.is_super_admin() OR company_id = public.get_effective_company_id())
        WITH CHECK (public.is_super_admin() OR company_id = public.get_effective_company_id());
    $p$;
  END IF;
END $$;

-- Invoice approvals
DO $$
BEGIN
  IF to_regclass('public.invoice_approvals') IS NOT NULL THEN
    ALTER TABLE public.invoice_approvals ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS invoice_approvals_tenant ON public.invoice_approvals;
    EXECUTE $p$
      CREATE POLICY invoice_approvals_tenant ON public.invoice_approvals
        FOR ALL TO public
        USING (
          EXISTS (
            SELECT 1 FROM public.invoices i
            WHERE i.id = invoice_approvals.invoice_id
              AND (public.is_super_admin() OR i.company_id = public.get_effective_company_id())
          )
        )
        WITH CHECK (
          EXISTS (
            SELECT 1 FROM public.invoices i
            WHERE i.id = invoice_approvals.invoice_id
              AND (public.is_super_admin() OR i.company_id = public.get_effective_company_id())
          )
        );
    $p$;
  END IF;
END $$;

-- Purchase orders (optional until PO migration)
DO $$
BEGIN
  IF to_regclass('public.purchase_orders') IS NOT NULL THEN
    ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS purchase_orders_tenant ON public.purchase_orders;
    EXECUTE $p$
      CREATE POLICY purchase_orders_tenant ON public.purchase_orders
        FOR ALL TO public
        USING (public.is_super_admin() OR company_id = public.get_effective_company_id())
        WITH CHECK (public.is_super_admin() OR company_id = public.get_effective_company_id());
    $p$;
  END IF;
END $$;

-- Goods receipts
DO $$
BEGIN
  IF to_regclass('public.goods_receipts') IS NOT NULL THEN
    ALTER TABLE public.goods_receipts ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS goods_receipts_tenant ON public.goods_receipts;
    EXECUTE $p$
      CREATE POLICY goods_receipts_tenant ON public.goods_receipts
        FOR ALL TO public
        USING (public.is_super_admin() OR company_id = public.get_effective_company_id())
        WITH CHECK (public.is_super_admin() OR company_id = public.get_effective_company_id());
    $p$;
  END IF;
END $$;

-- Optional tables
DO $$
BEGIN
  IF to_regclass('public.fraud_scan_results') IS NOT NULL THEN
    ALTER TABLE public.fraud_scan_results ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS fraud_scan_results_tenant ON public.fraud_scan_results;
    EXECUTE $p$
      CREATE POLICY fraud_scan_results_tenant ON public.fraud_scan_results
        FOR ALL TO public
        USING (public.is_super_admin() OR company_id = public.get_effective_company_id())
        WITH CHECK (public.is_super_admin() OR company_id = public.get_effective_company_id());
    $p$;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.audit_log') IS NOT NULL THEN
    ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS audit_log_tenant ON public.audit_log;
    EXECUTE $p$
      CREATE POLICY audit_log_tenant ON public.audit_log
        FOR ALL TO public
        USING (public.is_super_admin() OR company_id = public.get_effective_company_id())
        WITH CHECK (public.is_super_admin() OR company_id = public.get_effective_company_id());
    $p$;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.chart_of_accounts') IS NOT NULL THEN
    ALTER TABLE public.chart_of_accounts ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS chart_of_accounts_tenant ON public.chart_of_accounts;
    EXECUTE $p$
      CREATE POLICY chart_of_accounts_tenant ON public.chart_of_accounts
        FOR ALL TO public
        USING (public.is_super_admin() OR company_id = public.get_effective_company_id())
        WITH CHECK (public.is_super_admin() OR company_id = public.get_effective_company_id());
    $p$;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.company_settings') IS NOT NULL THEN
    ALTER TABLE public.company_settings ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS company_settings_tenant ON public.company_settings;
    EXECUTE $p$
      CREATE POLICY company_settings_tenant ON public.company_settings
        FOR ALL TO public
        USING (public.is_super_admin() OR company_id = public.get_effective_company_id())
        WITH CHECK (public.is_super_admin() OR company_id = public.get_effective_company_id());
    $p$;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.payment_batches') IS NOT NULL THEN
    ALTER TABLE public.payment_batches ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS payment_batches_tenant ON public.payment_batches;
    EXECUTE $p$
      CREATE POLICY payment_batches_tenant ON public.payment_batches
        FOR ALL TO public
        USING (public.is_super_admin() OR company_id = public.get_effective_company_id())
        WITH CHECK (public.is_super_admin() OR company_id = public.get_effective_company_id());
    $p$;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.gstr2b_entries') IS NOT NULL THEN
    ALTER TABLE public.gstr2b_entries ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS gstr2b_entries_tenant ON public.gstr2b_entries;
    EXECUTE $p$
      CREATE POLICY gstr2b_entries_tenant ON public.gstr2b_entries
        FOR ALL TO public
        USING (public.is_super_admin() OR company_id = public.get_effective_company_id())
        WITH CHECK (public.is_super_admin() OR company_id = public.get_effective_company_id());
    $p$;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.email_inbox_config') IS NOT NULL THEN
    ALTER TABLE public.email_inbox_config ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS email_inbox_config_tenant ON public.email_inbox_config;
    EXECUTE $p$
      CREATE POLICY email_inbox_config_tenant ON public.email_inbox_config
        FOR ALL TO public
        USING (public.is_super_admin() OR company_id = public.get_effective_company_id())
        WITH CHECK (public.is_super_admin() OR company_id = public.get_effective_company_id());
    $p$;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.email_intake_log') IS NOT NULL THEN
    ALTER TABLE public.email_intake_log ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS email_intake_log_tenant ON public.email_intake_log;
    EXECUTE $p$
      CREATE POLICY email_intake_log_tenant ON public.email_intake_log
        FOR ALL TO public
        USING (public.is_super_admin() OR company_id = public.get_effective_company_id())
        WITH CHECK (public.is_super_admin() OR company_id = public.get_effective_company_id());
    $p$;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.gl_suggestions_log') IS NOT NULL THEN
    ALTER TABLE public.gl_suggestions_log ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS gl_suggestions_log_tenant ON public.gl_suggestions_log;
    EXECUTE $p$
      CREATE POLICY gl_suggestions_log_tenant ON public.gl_suggestions_log
        FOR ALL TO public
        USING (
          public.is_super_admin()
          OR company_id = public.get_effective_company_id()
          OR (
            invoice_id IS NOT NULL AND EXISTS (
              SELECT 1 FROM public.invoices i
              WHERE i.id = gl_suggestions_log.invoice_id
                AND i.company_id = public.get_effective_company_id()
            )
          )
        )
        WITH CHECK (
          public.is_super_admin()
          OR company_id = public.get_effective_company_id()
          OR (
            invoice_id IS NOT NULL AND EXISTS (
              SELECT 1 FROM public.invoices i
              WHERE i.id = gl_suggestions_log.invoice_id
                AND i.company_id = public.get_effective_company_id()
            )
          )
        );
    $p$;
  END IF;
END $$;

-- â”€â”€ 6) Indexes (only if table exists â€” safe if you re-run this block alone) â”€â”€

DO $$
BEGIN
  IF to_regclass('public.invoices') IS NOT NULL THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_invoices_company ON public.invoices(company_id)';
  END IF;
  IF to_regclass('public.vendors') IS NOT NULL THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_vendors_company ON public.vendors(company_id)';
  END IF;
  IF to_regclass('public.gl_accounts') IS NOT NULL THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_gl_accounts_company ON public.gl_accounts(company_id)';
  END IF;
  IF to_regclass('public.approval_rules') IS NOT NULL THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_approval_rules_company ON public.approval_rules(company_id)';
  END IF;
  IF to_regclass('public.purchase_orders') IS NOT NULL THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_purchase_orders_company ON public.purchase_orders(company_id)';
  END IF;
  IF to_regclass('public.company_config') IS NOT NULL THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_company_config_company ON public.company_config(company_id)';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

-- â”€â”€ 7) Promote first user to super_admin (optional) â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- (optional super_admin promotion — edit and run separately after companies exists)


-- GulfTax AI columns (FinReportAI embedded classifier)
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS gulftax_decision TEXT,
  ADD COLUMN IF NOT EXISTS gulftax_risk_score NUMERIC,
  ADD COLUMN IF NOT EXISTS gulftax_confidence NUMERIC;

NOTIFY pgrst, 'reload schema';
