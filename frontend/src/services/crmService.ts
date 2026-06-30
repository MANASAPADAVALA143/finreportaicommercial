/** CRM API — /api/crm */

import { backendOrigin } from '../utils/backendOrigin';

const BASE = `${backendOrigin()}/api/crm`;

function hdrs(): Record<string, string> {
  const wsId = localStorage.getItem('gnanova_workspace_id') ?? localStorage.getItem('tenantId');
  return {
    'Content-Type': 'application/json',
    'X-Workspace-ID': wsId,
    'X-Tenant-ID': wsId,
  };
}

function params(extra: Record<string, string> = {}): string {
  const cid = localStorage.getItem('active_company_id');
  const wsId = localStorage.getItem('gnanova_workspace_id');
  const p = new URLSearchParams({ workspace_id: wsId, ...(cid ? { company_id: cid } : {}), ...extra });
  return p.toString();
}

async function get<T>(path: string, extra: Record<string, string> = {}): Promise<T> {
  const q = params(extra);
  const res = await fetch(`${BASE}${path}?${q}`, { headers: hdrs() });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const wsId = localStorage.getItem('gnanova_workspace_id');
  const cid = localStorage.getItem('active_company_id');
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: hdrs(),
    body: JSON.stringify({ workspace_id: wsId, company_id: cid, ...body as object }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function patch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'PATCH',
    headers: hdrs(),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export interface CRMContact {
  id: string;
  name: string;
  company_name?: string | null;
  email?: string | null;
  phone?: string | null;
  contact_type: string;
  source?: string | null;
  assigned_to?: string | null;
  notes?: string | null;
  credit_score?: number | null;
  risk_category?: string | null;
  credit_limit_aed?: number | null;
  created_at?: string | null;
}

export interface CreditScoreResult {
  contact_id: string;
  customer_name: string;
  credit_score: number;
  risk_category: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  risk_color: string;
  factors: {
    payment_history_score: number;
    overdue_score: number;
    dunning_score: number;
    history_score: number;
  };
  recommended_credit_limit_aed: number;
  total_outstanding_aed: number;
  overdue_amount_aed: number;
  avg_days_late: number;
  invoice_count: number;
  last_calculated_at: string;
  recommendation?: string;
}

export interface CreditRiskSummary {
  customers: CreditScoreResult[];
  summary: {
    total_customers: number;
    low_risk_count: number;
    medium_risk_count: number;
    high_risk_count: number;
    critical_risk_count: number;
    total_outstanding_aed: number;
    total_overdue_aed: number;
    portfolio_risk_score: number;
  };
}

export interface CRMDeal {
  id: string;
  deal_name: string;
  contact_id?: string | null;
  contact_name?: string | null;
  company_name?: string | null;
  value_aed: number;
  currency: string;
  stage: string;
  expected_close_date?: string | null;
  probability_pct: number;
  notes?: string | null;
  ar_invoice_id?: string | null;
}

export interface CRMActivity {
  id: string;
  deal_id?: string | null;
  contact_id?: string | null;
  activity_type: string;
  subject: string;
  notes?: string | null;
  due_date?: string | null;
  completed: boolean;
  created_by?: string | null;
  created_at?: string | null;
}

export interface CRMQuote {
  id: string;
  quote_number: string;
  deal_id?: string | null;
  contact_id?: string | null;
  line_items: Array<{ description: string; qty: number; unit_price: number; vat_rate: number }>;
  subtotal: number;
  vat_amount: number;
  total_aed: number;
  status: string;
  valid_until?: string | null;
  ar_invoice_id?: string | null;
}

export const CRM_STAGES = ['New', 'Qualified', 'Proposal', 'Negotiation', 'Won', 'Lost'] as const;

export function fetchCRMDashboard() {
  return get<{
    total_leads: number;
    total_deals: number;
    open_deals: number;
    pipeline_value_aed: number;
    deals_won_this_month: number;
    deals_won_value_aed: number;
    revenue_from_crm_this_month: number;
    overdue_activities_count: number;
  }>('/dashboard');
}

export function fetchPipeline() {
  return get<{ stages: Record<string, { stage: string; deal_count: number; total_value_aed: number; deals: CRMDeal[] }>; pipeline_value_aed: number }>('/pipeline');
}

export function listContacts(search?: string, type?: string) {
  const extra: Record<string, string> = {};
  if (search) extra.search = search;
  if (type) extra.type = type;
  return get<{ contacts: CRMContact[] }>('/contacts', extra);
}

export function createContact(data: Partial<CRMContact>) {
  return post<CRMContact>('/contacts', data);
}

export function listDeals(stage?: string) {
  return get<{ deals: CRMDeal[] }>('/deals', stage ? { stage } : {});
}

export function createDeal(data: Partial<CRMDeal> & { deal_name: string }) {
  return post<CRMDeal>('/deals', data);
}

export function updateDealStage(dealId: string, stage: string) {
  return patch<CRMDeal>(`/deals/${dealId}`, { stage });
}

export function listActivities(dealId?: string, contactId?: string) {
  const extra: Record<string, string> = {};
  if (dealId) extra.deal_id = dealId;
  if (contactId) extra.contact_id = contactId;
  return get<{ activities: CRMActivity[] }>('/activities', extra);
}

export function createActivity(data: { subject: string; activity_type?: string; deal_id?: string; contact_id?: string; due_date?: string; notes?: string }) {
  return post<CRMActivity>('/activities', data);
}

export function listQuotes() {
  return get<{ quotes: CRMQuote[] }>('/quotes');
}

export function createQuote(line_items: CRMQuote['line_items'], deal_id?: string, contact_id?: string) {
  return post<CRMQuote>('/quotes', { line_items, deal_id, contact_id });
}

export function convertQuoteToInvoice(quoteId: string) {
  return post<{ invoice_id: string; invoice_number: string; total: number }>(`/quotes/${quoteId}/convert-to-invoice`, {});
}

export function fetchCreditRiskSummary() {
  return get<CreditRiskSummary>('/credit-risk-summary');
}

export function recalculateAllCreditRisk() {
  return post<CreditRiskSummary>('/credit-risk/recalculate-all', {});
}

export function scoreContactCredit(contactId: string) {
  return post<CreditScoreResult>(`/contacts/${contactId}/credit-score`, {});
}
