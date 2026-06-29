/**
 * AP data helpers — FinReportAI native (no external InvoiceFlow app).
 * Uses the same Supabase project as the rest of FinReportAI (ftlycgfgbboxapxhlpad).
 */

import axios from 'axios';
import { supabase as apSupabaseClient } from './ap-invoice/supabase';

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined)?.trim().replace(/\/$/, '') ?? '';

/** axios client for FinReportAI FastAPI */
export const invoiceFlowApi = axios.create({
  baseURL: API_BASE || undefined,
  timeout: 30_000,
});

invoiceFlowApi.interceptors.request.use((config) => {
  try {
    const raw = localStorage.getItem('finreport_access_token');
    if (raw) config.headers['Authorization'] = `Bearer ${raw}`;
  } catch {
    // no session
  }
  return config;
});

/** @deprecated use ap-invoice/supabase directly */
export const invoiceFlowDb = apSupabaseClient;

export interface APKPIs {
  openInvoices: number;
  overdueAmount: number;
  thisMonthSpend: number;
  duplicateAlerts: number;
  avgProcessingDays: number;
  loading: boolean;
  error: string | null;
}

export const emptyAPKPIs: APKPIs = {
  openInvoices: 0,
  overdueAmount: 0,
  thisMonthSpend: 0,
  duplicateAlerts: 0,
  avgProcessingDays: 0,
  loading: true,
  error: null,
};

export async function fetchAPKPIs(companyId?: string): Promise<APKPIs> {
  try {
    const today = new Date().toISOString().split('T')[0];
    const firstOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
      .toISOString()
      .split('T')[0];

    let q = apSupabaseClient.from('invoices').select('id', { count: 'exact', head: true });
    if (companyId) q = q.eq('company_id', companyId);

    const openRes = await q.in('status', ['Processing', 'Queried', 'On Hold']);

    let overdueQ = apSupabaseClient
      .from('invoices')
      .select('total_amount')
      .lt('due_date', today)
      .not('status', 'in', '("Paid","Rejected")');
    if (companyId) overdueQ = overdueQ.eq('company_id', companyId);
    const overdueRes = await overdueQ;

    let monthQ = apSupabaseClient.from('invoices').select('total_amount').gte('invoice_date', firstOfMonth);
    if (companyId) monthQ = monthQ.eq('company_id', companyId);
    const monthRes = await monthQ;

    let dupeQ = apSupabaseClient
      .from('invoices')
      .select('id', { count: 'exact', head: true })
      .eq('risk_score', 'high');
    if (companyId) dupeQ = dupeQ.eq('company_id', companyId);
    const dupeRes = await dupeQ;

    let procQ = apSupabaseClient
      .from('invoices')
      .select('invoice_date, approved_at')
      .eq('status', 'Approved')
      .not('approved_at', 'is', null)
      .limit(200);
    if (companyId) procQ = procQ.eq('company_id', companyId);
    const processingRes = await procQ;

    const overdueAmount = (overdueRes.data ?? []).reduce(
      (sum, r) => sum + (Number(r.total_amount) || 0),
      0,
    );
    const thisMonthSpend = (monthRes.data ?? []).reduce(
      (sum, r) => sum + (Number(r.total_amount) || 0),
      0,
    );

    let avgProcessingDays = 0;
    const procRows = (processingRes.data ?? []).filter((r) => r.invoice_date && r.approved_at);
    if (procRows.length > 0) {
      const totalDays = procRows.reduce((sum, r) => {
        const diff =
          (new Date(r.approved_at).getTime() - new Date(r.invoice_date).getTime()) /
          (1000 * 60 * 60 * 24);
        return sum + Math.max(0, diff);
      }, 0);
      avgProcessingDays = Math.round(totalDays / procRows.length);
    }

    return {
      openInvoices: openRes.count ?? 0,
      overdueAmount,
      thisMonthSpend,
      duplicateAlerts: dupeRes.count ?? 0,
      avgProcessingDays,
      loading: false,
      error: null,
    };
  } catch (err) {
    return {
      ...emptyAPKPIs,
      loading: false,
      error: err instanceof Error ? err.message : 'Failed to load AP data',
    };
  }
}

export async function getInvoices(params?: Record<string, string>) {
  if (!API_BASE) {
    const { data, error } = await apSupabaseClient.from('invoices').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    return data;
  }
  const res = await invoiceFlowApi.get('/api/ap/invoices', { params });
  return res.data;
}

export async function getAPAging() {
  const res = await invoiceFlowApi.get('/api/ap/invoices/aging');
  return res.data;
}

export async function pushToTally(payload: Record<string, unknown>) {
  const res = await invoiceFlowApi.post('/api/tally/push', payload);
  return res.data;
}
