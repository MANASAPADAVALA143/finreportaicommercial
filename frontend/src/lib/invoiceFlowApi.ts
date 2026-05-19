/**
 * invoiceFlowApi.ts
 * ──────────────────
 * Shared axios client for calling InvoiceFlow's FastAPI backend.
 * Used by FinReportAI for cross-app data (AP KPIs, aging, Tally push).
 *
 * Base URL: https://apinvoice-production.up.railway.app
 * Shared Supabase company_id: 11fab3d0-7374-4205-8c10-4a61f49cd60d
 */

import axios from 'axios';
import { createClient } from '@supabase/supabase-js';

// ── InvoiceFlow FastAPI base URL ───────────────────────────────────────────────
const INVOICEFLOW_BASE =
  import.meta.env.VITE_INVOICEFLOW_API_URL ?? 'https://apinvoice-production.up.railway.app';

// ── InvoiceFlow Supabase (read AP data directly) ──────────────────────────────
const INVOICEFLOW_SUPABASE_URL  = 'https://xuaaqonmaarldzklocax.supabase.co';
const INVOICEFLOW_SUPABASE_ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh1YWFxb25tYWFybGR6a2xvY2F4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIyMTc1NzIsImV4cCI6MjA4Nzc5MzU3Mn0.sUma_C4OOhs6DtFuFegGnuXXQZsretylm_F30aB3hjg';

export const SHARED_COMPANY_ID = '11fab3d0-7374-4205-8c10-4a61f49cd60d';

/** Supabase client pointing at InvoiceFlow's project — read-only AP data */
export const invoiceFlowDb = createClient(
  INVOICEFLOW_SUPABASE_URL,
  INVOICEFLOW_SUPABASE_ANON,
);

/** axios instance for InvoiceFlow FastAPI — use for Tally push, aging, invoice list */
export const invoiceFlowApi = axios.create({
  baseURL: INVOICEFLOW_BASE,
  timeout: 30_000,
  headers: { 'X-Company-ID': SHARED_COMPANY_ID },
});

// Attach Bearer token if the current FinReportAI session has one
invoiceFlowApi.interceptors.request.use((config) => {
  try {
    const raw = localStorage.getItem('sb-ftlycgfgbboxapxhlpad-auth-token');
    if (raw) {
      const parsed = JSON.parse(raw) as { access_token?: string };
      if (parsed?.access_token) {
        config.headers['Authorization'] = `Bearer ${parsed.access_token}`;
      }
    }
  } catch {
    // session token not available — send without auth
  }
  return config;
});

// ── AP KPI helpers ─────────────────────────────────────────────────────────────

export interface APKPIs {
  openInvoices:      number;
  overdueAmount:     number;
  thisMonthSpend:    number;
  duplicateAlerts:   number;
  avgProcessingDays: number;
  loading:           boolean;
  error:             string | null;
}

export const emptyAPKPIs: APKPIs = {
  openInvoices:      0,
  overdueAmount:     0,
  thisMonthSpend:    0,
  duplicateAlerts:   0,
  avgProcessingDays: 0,
  loading:           true,
  error:             null,
};

/**
 * Fetch AP KPIs directly from InvoiceFlow's Supabase.
 * - openInvoices:      count where status IN ('Processing','Queried','On Hold')
 * - overdueAmount:     sum total_amount where due_date < today AND status not Paid/Rejected
 * - thisMonthSpend:    sum total_amount where invoice_date >= first day of month
 * - duplicateAlerts:   count where risk_score = 'high' (InvoiceFlow uses risk_score for dupes)
 * - avgProcessingDays: avg days from invoice_date to approved_date (status=Approved)
 */
export async function fetchAPKPIs(companyId = SHARED_COMPANY_ID): Promise<APKPIs> {
  try {
    const today        = new Date().toISOString().split('T')[0];
    const firstOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
      .toISOString()
      .split('T')[0];

    // Run all 5 queries in parallel
    const [openRes, overdueRes, monthRes, dupeRes, processingRes] = await Promise.all([
      // 1. Open invoices
      invoiceFlowDb
        .from('invoices')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', companyId)
        .in('status', ['Processing', 'Queried', 'On Hold']),

      // 2. Overdue amount
      invoiceFlowDb
        .from('invoices')
        .select('total_amount')
        .eq('company_id', companyId)
        .lt('due_date', today)
        .not('status', 'in', '("Paid","Rejected")'),

      // 3. This month spend
      invoiceFlowDb
        .from('invoices')
        .select('total_amount')
        .eq('company_id', companyId)
        .gte('invoice_date', firstOfMonth),

      // 4. Duplicate / high-risk alerts
      invoiceFlowDb
        .from('invoices')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', companyId)
        .eq('risk_score', 'high'),

      // 5. Avg processing time (approved invoices with both dates)
      invoiceFlowDb
        .from('invoices')
        .select('invoice_date, approved_date')
        .eq('company_id', companyId)
        .eq('status', 'Approved')
        .not('approved_date', 'is', null)
        .limit(200),
    ]);

    const overdueAmount = (overdueRes.data ?? []).reduce(
      (sum, r) => sum + (Number(r.total_amount) || 0), 0
    );
    const thisMonthSpend = (monthRes.data ?? []).reduce(
      (sum, r) => sum + (Number(r.total_amount) || 0), 0
    );

    let avgProcessingDays = 0;
    const procRows = (processingRes.data ?? []).filter(
      (r) => r.invoice_date && r.approved_date
    );
    if (procRows.length > 0) {
      const totalDays = procRows.reduce((sum, r) => {
        const diff =
          (new Date(r.approved_date).getTime() - new Date(r.invoice_date).getTime()) /
          (1000 * 60 * 60 * 24);
        return sum + Math.max(0, diff);
      }, 0);
      avgProcessingDays = Math.round(totalDays / procRows.length);
    }

    return {
      openInvoices:      openRes.count     ?? 0,
      overdueAmount,
      thisMonthSpend,
      duplicateAlerts:   dupeRes.count     ?? 0,
      avgProcessingDays,
      loading:           false,
      error:             null,
    };
  } catch (err) {
    return {
      ...emptyAPKPIs,
      loading: false,
      error:   err instanceof Error ? err.message : 'Failed to load AP data',
    };
  }
}

// ── FastAPI convenience calls ──────────────────────────────────────────────────

/** GET /api/invoices — fetch invoice list from InvoiceFlow backend */
export async function getInvoices(params?: Record<string, string>) {
  const res = await invoiceFlowApi.get('/api/invoices', { params });
  return res.data;
}

/** GET /api/invoices/aging — AP aging buckets */
export async function getAPAging() {
  const res = await invoiceFlowApi.get('/api/invoices/aging');
  return res.data;
}

/** POST /api/tally/push — push data to Tally via InvoiceFlow backend */
export async function pushToTally(payload: Record<string, unknown>) {
  const res = await invoiceFlowApi.post('/api/tally/push', payload);
  return res.data;
}
