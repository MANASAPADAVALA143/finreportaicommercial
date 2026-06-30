/**
 * AP Supabase — same FinReportAI project (ftlycgfgbboxapxhlpad).
 * Re-exports the shared AP client; no separate InvoiceFlow project.
 */

import { supabase } from './ap-invoice/supabase';
import { invoiceFlowAgentUrl } from './ap-invoice/apiBase';

export const apSupabase = supabase;

export type APInvoice = {
  id: string;
  invoice_number: string;
  invoice_date: string | null;
  due_date: string | null;
  vendor_name: string;
  total_amount: number;
  currency: string;
  status: 'Processing' | 'Approved' | 'Rejected' | 'Paid' | 'On Hold' | 'Queried';
  tax_amount: number | null;
  tax_rate: number | null;
  subtotal_amount: number | null;
  risk_score: 'low' | 'medium' | 'high' | null;
  risk_flags: Array<{ message: string; severity?: string; type?: string }> | string | null;
  ifrs_category: string | null;
  ifrs_confidence: number | null;
  match_status: 'matched' | 'partial' | 'mismatch' | 'no_po' | 'three_way_matched' | null;
  match_notes: string | null;
  approval_status: 'not_required' | 'pending' | 'approved' | 'rejected' | null;
  approved_by: string | null;
  approved_at: string | null;
  rejection_reason: string | null;
  po_number: string | null;
  file_url: string | null;
  processing_time_seconds: number | null;
  created_at: string;
};

export type APVendor = {
  id?: string;
  name: string;
  gstin?: string | null;
  trn?: string | null;
  email?: string | null;
  phone?: string | null;
  created_at?: string;
};

export type APApprovalRow = {
  id: string;
  invoice_id: string;
  approver_email: string;
  status: 'pending' | 'approved' | 'rejected';
  step_index: number;
  comment: string | null;
  actioned_at: string | null;
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
  grn_number?: string | null;
  match_status?: string | null;
};

export type GoodsReceipt = {
  id: string;
  grn_number: string;
  po_id: string | null;
  vendor_name: string;
  received_amount: number;
  grn_amount?: number | null;
  received_date: string;
  description: string | null;
  status?: string | null;
  received_by?: string | null;
  notes?: string | null;
  invoice_number?: string | null;
  company_id?: string | null;
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

export type APInvoiceLineItem = {
  id: string;
  invoice_id: string;
  description: string;
  quantity: number;
  unit_price: number;
  total: number;
  created_at: string;
};

/** FinReportAI FastAPI — OCR / agent endpoints */
export const apAgentUrl = invoiceFlowAgentUrl;
