import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? '';

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env â€” app will load but data features will fail until set.');
}

export const supabase: SupabaseClient = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder-anon-key'
);

export type Invoice = {
  id: string;
  invoice_number: string;
  invoice_date: string;
  due_date: string;
  vendor_name: string;
  vendor_email: string | null;
  vendor_phone: string | null;
  vendor_address: string | null;
  total_amount: number;
  currency: string;
  exchange_rate_to_base?: number | null;
  status: 'Processing' | 'Approved' | 'Rejected' | 'Paid' | 'On Hold' | 'Queried';
  file_url: string | null;
  file_type: string | null;
  ifrs_category: string | null;
  /** IFRS / classification confidence from n8n (legacy semantic). */
  ifrs_confidence: number | null;
  /** Overall extraction / OCR confidence (0â€“100); may mirror IFRS or come from n8n OCR fields. */
  ocr_confidence?: number | null;
  /** Optional per-field scores from n8n, e.g. { "vendor_name": 95, "total_amount": 88 }. */
  ocr_confidence_fields?: Record<string, number> | string | null;
  ifrs_explanation: string | null;
  ifrs_manual_override: boolean;
  processing_time_seconds: number | null;
  risk_score: 'low' | 'medium' | 'high' | null;
  risk_level?: string | null;
  risk_flags: Array<{
    type?: string;
    severity?: 'low' | 'medium' | 'high' | 'critical';
    message: string;
    explanation?: string;
  }> | string | null;
  approval_level: 'none' | 'manager' | 'cfo' | null;
  /** Multi-step chain (see approval_rules / invoice_approvals). */
  approval_status?: 'not_required' | 'pending' | 'approved' | 'rejected' | null;
  current_approver_index?: number | null;
  approval_rule_id?: string | null;
  approval_chain_emails?: string[] | null;
  approval_total_steps?: number | null;
  submitted_for_approval_at?: string | null;
  approval_submitted_by?: string | null;
  approved_by: string | null;
  approved_at: string | null;
  rejection_reason: string | null;
  tax_type: 'None' | 'VAT' | 'GST' | 'Sales Tax' | 'Withholding Tax' | null;
  tax_code?: string | null;
  tax_breakdown?: string | null;
  tax_rate: number | null;
  tax_amount: number | null;
  subtotal_amount: number | null;
  invoice_language?: string | null;
  po_number: string | null;
  po_id?: string | null;
  match_status: 'matched' | 'partial' | 'mismatch' | 'no_po' | 'three_way_matched' | null;
  match_notes: string | null;
  match_score?: number | null;
  match_difference: number | null;
  match_percentage: number | null;
  po_amount: number | null;
  grn_amount: number | null;
  grn_id?: string | null;
  match_result_id?: string | null;
  auto_matched?: boolean | null;
  match_attempted_at?: string | null;
  grn_confirmed?: boolean | null;
  grn_confirmed_by?: string | null;
  grn_confirmed_at?: string | null;
  gl_code: string | null;
  gl_name: string | null;
  gl_account_code: string | null;
  gl_account_name: string | null;
  gl_account_type: string | null;
  gl_auto_suggested: boolean;
  gl_suggestion_source?: 'company_chart' | 'standard_fallback' | 'ai_suggested' | 'manual' | null;
  gl_confirmed?: boolean | null;
  gl_standard_ref?: string | null;
  gl_source?: 'company_coa' | 'ifrs_auto' | string | null;
  department: string | null;
  cost_center: string | null;
  project_code: string | null;
  company_id?: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  tally_synced?: boolean | null;
  tally_synced_at?: string | null;
  qb_synced?: boolean | null;
  xero_synced?: boolean | null;
  duplicate_flag?: boolean | null;
  duplicate_of_id?: string | null;
  duplicate_reason?: string | null;
  gstin?: string | null;
  gst_amount?: number | null;
  cgst?: number | null;
  sgst?: number | null;
  igst?: number | null;
  gst_recon_status?: 'unmatched' | 'matched' | 'mismatch' | 'ignored' | null;
  /** Set when reconciled to a bank line (Bank Recon / AI). */
  bank_reconciled?: boolean | null;
  bank_ref?: string | null;
  reconciled_at?: string | null;
  payment_status?: 'unpaid' | 'scheduled' | 'paid' | 'overdue' | null;
  scheduled_payment_date?: string | null;
  payment_reference?: string | null;
  /** UTR / NEFT / IMPS / cheque reference (primary display for bank recon). */
  utr_number?: string | null;
  payment_method?: 'NEFT' | 'IMPS' | 'RTGS' | 'UPI' | 'Cheque' | 'Cash' | 'Card' | 'Other' | string | null;
  payment_date?: string | null;
  payment_bank?: string | null;
  payment_account?: string | null;
  payment_note?: string | null;
  payment_proof_url?: string | null;
  paid_at?: string | null;
  source?:
    | 'upload'
    | 'email'
    | 'vendor_portal'
    | 'manual'
    | 'whatsapp'
    | 'camera'
    | 'excel'
    | 'email_n8n'
    | 'excel_vba'
    | null;
  /** purchase = AP (vendor bills), sales = AR (customer / receivable). Matches Supabase CHECK. */
  invoice_type?: 'purchase' | 'sales' | string | null;
  customer_name?: string | null;
  customer_gstin?: string | null;
  /** Receivable due date for sales (AR) invoices. */
  ar_due_date?: string | null;
  payment_received?: boolean | null;
  source_email_from?: string | null;
  source_email_subject?: string | null;
  source_email_received_at?: string | null;
};

export interface EmailInboxConfig {
  id: string;
  forwarding_address: string;
  provider: string;
  is_active: boolean;
  created_at: string;
}

export interface EmailIntakeLog {
  id: string;
  from_address: string | null;
  subject: string | null;
  received_at: string;
  attachment_count: number;
  invoices_created: number;
  status: 'processed' | 'failed' | 'skipped';
  error_message: string | null;
  raw_payload: Record<string, unknown>;
}

export type PaymentBatch = {
  id: string;
  batch_date: string;
  total_amount: number;
  invoice_ids: string[];
  status: 'draft' | 'confirmed' | 'exported';
  created_by: string | null;
  notes: string | null;
  created_at: string;
};

export type Vendor = {
  id: string;
  name: string;
  gstin: string | null;
  created_at: string;
  updated_at: string;
};

export type Gstr2bEntry = {
  id: string;
  company_gstin: string;
  supplier_gstin: string | null;
  supplier_name: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  taxable_value: number;
  igst: number;
  cgst: number;
  sgst: number;
  total_gst: number;
  filing_period: string;
  matched_invoice_id: string | null;
  created_at: string;
};

export type PurchaseOrder = {
  id: string;
  po_number: string;
  vendor_name: string;
  vendor_email?: string | null;
  po_amount: number;
  currency?: string | null;
  po_date: string;
  delivery_date?: string | null;
  description: string | null;
  status: 'Open' | 'Partially Received' | 'Fully Received' | 'Closed' | 'Cancelled';
  line_items?: unknown;
  notes?: string | null;
  company_id?: string | null;
  created_at: string;
  updated_at: string;
};

export type GoodsReceipt = {
  id: string;
  grn_number: string;
  po_id: string | null;
  vendor_name: string;
  received_amount: number;
  /** Some projects add this column as an alias of receipt total; match engine accepts it if present. */
  grn_amount?: number | null;
  received_date: string;
  description: string | null;
  company_id?: string | null;
  status?: string | null;
  received_by?: string | null;
  notes?: string | null;
  /** Set on bulk import from master row when column exists (see migration). */
  invoice_number?: string | null;
  created_at: string;
  updated_at: string;
  grn_line_items?: Array<{
    id: string;
    description: string;
    ordered_qty: number;
    received_qty: number;
    unit_price: number;
    total_value?: number;
  }>;
};

export type InvoiceLineItem = {
  id: string;
  invoice_id: string;
  description: string;
  quantity: number;
  unit_price: number;
  total: number;
  created_at: string;
};

export type AuditLog = {
  id: string;
  invoice_id: string;
  action: string;
  field_changed: string | null;
  old_value: string | null;
  new_value: string | null;
  user_id: string | null;
  user_name: string | null;
  created_at: string;
};

/** Append-only compliance log (`audit_log` table). */
export interface AuditLogEntry {
  id: string;
  entity_type: string;
  entity_id: string | null;
  action: string;
  performed_by: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export type AppSetting = {
  id: string;
  setting_key: string;
  setting_value: string;
  created_at: string;
  updated_at: string;
};

export type ApprovalRule = {
  id: string;
  min_amount: number;
  max_amount: number | null;
  required_approvers: number;
  approver_emails: string[];
  /** Corresponding WhatsApp-enabled phone numbers in E.164 format (+971XXXXXXXX). Index matches approver_emails. */
  approver_phones?: string[] | null;
  department: string | null;
  created_at: string;
};

export type InvoiceApprovalRow = {
  id: string;
  invoice_id: string;
  step_index: number;
  approver_email: string;
  status: 'pending' | 'approved' | 'rejected';
  comment: string | null;
  actioned_at: string | null;
  created_at: string;
};

export type GLAccount = {
  id: string;
  gl_code: string;
  gl_name: string;
  account_type: 'Asset' | 'Liability' | 'Equity' | 'Revenue' | 'Expense' | 'COGS';
  department: string | null;
  cost_center: string | null;
  is_active: boolean;
  imported_from?: string | null;
  standard_reference?: string | null;
  created_at: string;
  updated_at: string;
};

