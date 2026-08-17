/**
 * RERA OS API client — wraps all /api/rera/* endpoints.
 * Uses the same auth convention as the rest of the main app (Bearer token +
 * X-Workspace-ID), not the AP InvoiceFlow Supabase pattern.
 */
import { joinApiUrl } from '../utils/backendOrigin';
import { workspaceHeaders } from '../utils/workspaceHeaders';

async function get<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
  let url = joinApiUrl(path);
  if (params) {
    const q = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
    });
    const qs = q.toString();
    if (qs) url += `?${qs}`;
  }
  const res = await fetch(url, { headers: workspaceHeaders() });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(joinApiUrl(path), {
    method: 'POST',
    headers: workspaceHeaders(),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function put<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(joinApiUrl(path), {
    method: 'PUT',
    headers: workspaceHeaders(),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function downloadBlob(path: string, params: Record<string, string | number | undefined> | undefined, filename: string): Promise<void> {
  let url = joinApiUrl(path);
  if (params) {
    const q = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== '') q.set(k, String(v)); });
    const qs = q.toString();
    if (qs) url += `?${qs}`;
  }
  const res = await fetch(url, { headers: workspaceHeaders() });
  if (!res.ok) throw new Error(await res.text());
  const blob = await res.blob();
  const objUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objUrl);
}

// ── Types (mirror backend/app/modules/rera/router.py response shapes exactly) ─

export interface RERAProject {
  id: string; workspace_id: string; name: string; rera_number: string;
  location: string | null; total_units: number | null;
  total_project_cost: number; total_collections_target: number;
  escrow_percentage: number; construction_progress: number; utilization_percentage: number;
  escrow_balance: number; withdrawn: number; total_collected: number;
  start_date: string | null; completion_date: string | null; status: string;
  developer_pan: string | null; promoter_din: string | null; gstin: string | null;
  trn_number: string | null; qpr_deadline: string | null; currency: string;
  created_at: string | null;
}

export interface RERABooking {
  id: string; project_id: string; unit_number: string | null;
  customer_name: string | null; customer_email: string | null; customer_phone: string | null;
  total_value: number; booking_date: string | null;
  payment_schedule: { milestone: string; amount: number; due_date?: string }[];
  status: string; oqood_status: string; spa_id: string | null; created_at: string | null;
}

export interface RERAPayment {
  id: string; project_id: string; booking_id: string; installment_number: number | null;
  gross_amount: number; gst_amount: number; vat_amount: number; tds_amount: number;
  net_amount: number; escrow_split: number; payment_date: string | null;
  payment_mode: string; status: string;
}

export interface RERAEscrowTransaction {
  id: string; project_id: string; type: 'deposit' | 'withdrawal'; amount: number;
  transaction_date: string | null; purpose: string | null; approved_by: string | null;
  reference_no: string | null;
}

export interface RERAQPRRecord {
  id: string; project_id: string; quarter: string; total_collections: number;
  escrow_deposited: number; withdrawals: number; construction_progress: number;
  utilization: number; status: string; generated_at: string | null;
}

export interface RERALeakageItem {
  spa_id: string; project_id: string; booking_id: string; milestone: string;
  triggered_at: string; amount_at_risk: number; window_days: number; reason: string;
}

export interface RERALeakageScan {
  flagged_count: number; total_at_risk: number; window_days: number; items: RERALeakageItem[];
}

export interface RERARiskFlag {
  id: string; project_id: string; severity: 'high' | 'medium' | 'low'; category: string;
  title: string; description: string | null; resolved: boolean; created_at: string | null;
}

export interface RERAWebhookEvent {
  id: string; idempotency_key: string; spa_id: string; event_type: string | null;
  event_timestamp: string | null; received_at: string | null; source: string;
  data: Record<string, unknown> | null; is_dlq: boolean; dlq_reason: string | null;
}

export interface RERACfoDashboard {
  kpis: {
    total_escrow_balance: number; total_collected: number; total_withdrawn: number;
    avg_utilization: number; avg_progress: number; active_projects: number; open_risk_flags: number;
  };
  alerts: { type: string; project_id: string; project_name: string; [k: string]: unknown }[];
  chart_escrow_vs_withdrawal: { project: string; escrow_balance: number; withdrawn: number }[];
  chart_progress_vs_utilization: { project: string; construction_progress: number; utilization: number }[];
}

// ── Projects ─────────────────────────────────────────────────────────────────

export const listProjects = () => get<{ projects: RERAProject[]; count: number }>('/api/rera/projects');
export const getProject = (id: string) => get<RERAProject>(`/api/rera/projects/${id}`);
export const createProject = (body: Partial<RERAProject> & { name: string; rera_number: string }) =>
  post<RERAProject>('/api/rera/projects', body);
export const updateProject = (id: string, body: Partial<RERAProject>) =>
  put<RERAProject>(`/api/rera/projects/${id}`, body);

// ── Bookings ─────────────────────────────────────────────────────────────────

export const listBookings = (projectId: string) =>
  get<{ bookings: RERABooking[]; count: number }>('/api/rera/bookings', { project_id: projectId });
export const createBooking = (body: {
  project_id: string; unit_number?: string; customer_name?: string; customer_email?: string;
  customer_phone?: string; total_value?: number; booking_date?: string;
  payment_schedule?: { milestone: string; amount: number; due_date?: string }[]; spa_id?: string;
}) => post<RERABooking>('/api/rera/bookings', body);

// ── Payments ─────────────────────────────────────────────────────────────────

export const listPayments = (projectId: string) =>
  get<{ payments: RERAPayment[]; count: number }>('/api/rera/payments', { project_id: projectId });
export const createPayment = (body: {
  project_id: string; booking_id: string; installment_number?: number; gross_amount: number;
  is_commercial?: boolean; payment_date?: string; payment_mode?: string;
}) => post<RERAPayment>('/api/rera/payments', body);

// ── Escrow ───────────────────────────────────────────────────────────────────

export const listEscrowTransactions = (projectId: string) =>
  get<{ transactions: RERAEscrowTransaction[]; count: number }>('/api/rera/escrow/transactions', { project_id: projectId });
export const withdrawEscrow = (body: {
  project_id: string; amount: number; purpose: string; approved_by: string;
  reference_no?: string; transaction_date?: string;
}) => post<RERAEscrowTransaction>('/api/rera/escrow/withdraw', body);

// ── QPR ──────────────────────────────────────────────────────────────────────

export const listQpr = (projectId: string) =>
  get<{ records: RERAQPRRecord[]; count: number }>('/api/rera/qpr', { project_id: projectId });
export const generateQpr = (projectId: string) =>
  post<RERAQPRRecord>(`/api/rera/qpr/generate/${projectId}`);
export const downloadQprExport = (projectId: string, format: 'pdf' | 'csv', filename: string) =>
  downloadBlob(`/api/rera/qpr/export/${projectId}`, { format }, filename);

// ── Leakage ──────────────────────────────────────────────────────────────────

export const scanLeakage = (windowDays = 14, spaId?: string) =>
  get<RERALeakageScan>('/api/rera/leakage/scan', { window_days: windowDays, spa_id: spaId });
export const downloadLeakageCsv = (windowDays = 14) =>
  downloadBlob('/api/rera/leakage/scan.csv', { window_days: windowDays }, 'rera_leakage_scan.csv');

// ── IFRS 16 ──────────────────────────────────────────────────────────────────

export const ifrs16Status = () => get<{ available: boolean; source: string }>('/api/rera/ifrs16/status');
export const ifrs16Leases = () => get<{ spa_ids: string[]; source: string }>('/api/rera/ifrs16/leases');
export const ifrs16LeaseDetail = (spaId: string, ibr = 0.065) =>
  get<{ spa_id: string; source: string; schedule: Record<string, unknown> }>(`/api/rera/ifrs16/leases/${spaId}`, { ibr });

// ── Webhooks ─────────────────────────────────────────────────────────────────

export const listWebhookEvents = (spaId?: string) =>
  get<{ events: RERAWebhookEvent[]; count: number }>('/api/rera/webhooks/events', { spa_id: spaId });
export const listDlqEvents = () => get<{ events: RERAWebhookEvent[]; count: number }>('/api/rera/webhooks/dlq');
export const replayDlqEvent = (eventId: string) =>
  post<RERAWebhookEvent>('/api/rera/webhooks/dlq/replay', { event_id: eventId });

// ── Dashboard ────────────────────────────────────────────────────────────────

export const getCfoDashboard = () => get<RERACfoDashboard>('/api/rera/dashboard/cfo');

// ── Risk Flags ───────────────────────────────────────────────────────────────

export const listRiskFlags = (projectId?: string, resolved?: boolean) =>
  get<{ risk_flags: RERARiskFlag[]; count: number }>('/api/rera/risk-flags', {
    project_id: projectId,
    resolved: resolved === undefined ? undefined : String(resolved),
  });
export const resolveRiskFlag = (id: string) => put<RERARiskFlag>(`/api/rera/risk-flags/${id}/resolve`);
