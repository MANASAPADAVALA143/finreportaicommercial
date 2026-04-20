const API_BASE =
  (import.meta.env.VITE_API_URL && String(import.meta.env.VITE_API_URL).trim()) ||
  'http://localhost:8000';

export type BookTxn = {
  id: number;
  client_id: string;
  date: string | null;
  description: string;
  amount: number;
  type: string;
  category: string | null;
  confidence: number | null;
  flag_for_review: boolean;
  auto_approved: boolean;
  anomaly_flags: Array<{ type?: string; severity?: string; message?: string; action?: string }>;
  receipt_url: string | null;
  vendor_name: string | null;
  bank_account_id?: string | null;
};

async function parseJson<T>(r: Response): Promise<T> {
  if (!r.ok) {
    const t = await r.text();
    throw new Error(t || r.statusText);
  }
  return r.json() as Promise<T>;
}

export async function uploadTransactions(
  clientId: string,
  file: File,
  periodMonth?: number,
  periodYear?: number
): Promise<{ transactions: BookTxn[]; count: number }> {
  const fd = new FormData();
  fd.append('client_id', clientId);
  fd.append('file', file);
  if (periodMonth != null) fd.append('period_month', String(periodMonth));
  if (periodYear != null) fd.append('period_year', String(periodYear));
  const r = await fetch(`${API_BASE}/api/bookkeeping/upload-transactions`, { method: 'POST', body: fd });
  return parseJson(r);
}

export async function categorise(
  clientId: string,
  transactionIds?: number[],
  periodMonth?: number,
  periodYear?: number
): Promise<{ transactions: BookTxn[] }> {
  const r = await fetch(`${API_BASE}/api/bookkeeping/categorise`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      transaction_ids: transactionIds?.length ? transactionIds : null,
      period_month: periodMonth ?? null,
      period_year: periodYear ?? null,
    }),
  });
  return parseJson(r);
}

export async function detectAnomalies(
  clientId: string,
  transactionIds?: number[]
): Promise<{ transactions: BookTxn[]; anomaly_report: unknown }> {
  const r = await fetch(`${API_BASE}/api/bookkeeping/detect-anomalies`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, transaction_ids: transactionIds?.length ? transactionIds : null }),
  });
  return parseJson(r);
}

export async function reconcileBookkeeping(
  clientId: string,
  transactionIds?: number[]
): Promise<{ reconciliation_summary: unknown }> {
  const r = await fetch(`${API_BASE}/api/bookkeeping/reconcile`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, transaction_ids: transactionIds?.length ? transactionIds : null }),
  });
  return parseJson(r);
}

export async function learningFeedback(
  clientId: string,
  transactionId: number,
  correctCategory: string,
  vendorName?: string
): Promise<void> {
  const r = await fetch(`${API_BASE}/api/bookkeeping/learning-feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      transaction_id: transactionId,
      correct_category: correctCategory,
      vendor_name: vendorName ?? null,
    }),
  });
  await parseJson(r);
}

export async function getReviewQueue(clientId: string): Promise<unknown> {
  const r = await fetch(`${API_BASE}/api/bookkeeping/review-queue?client_id=${encodeURIComponent(clientId)}`);
  return parseJson(r);
}

export async function listTransactions(
  clientId: string,
  periodMonth?: number,
  periodYear?: number
): Promise<{ transactions: BookTxn[] }> {
  const q = new URLSearchParams({ client_id: clientId });
  if (periodMonth != null) q.set('period_month', String(periodMonth));
  if (periodYear != null) q.set('period_year', String(periodYear));
  const r = await fetch(`${API_BASE}/api/bookkeeping/transactions?${q}`);
  return parseJson(r);
}

export async function bulkApprove(clientId: string, transactionIds: number[]): Promise<{ approved_count: number }> {
  const r = await fetch(`${API_BASE}/api/bookkeeping/bulk-approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, transaction_ids: transactionIds }),
  });
  return parseJson(r);
}

export async function putClientProfile(
  clientId: string,
  body: { weekend_operations?: boolean; receipt_threshold?: number; chart_of_accounts?: string[] }
): Promise<void> {
  const r = await fetch(`${API_BASE}/api/bookkeeping/client-profile/${encodeURIComponent(clientId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  await parseJson(r);
}

export async function attachReceipt(transactionId: number, receiptUrl: string): Promise<void> {
  const r = await fetch(`${API_BASE}/api/bookkeeping/transactions/${transactionId}/receipt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ receipt_url: receiptUrl }),
  });
  await parseJson(r);
}

export async function verifyReceipt(transactionId: number, receiptText: string): Promise<{
  matches: boolean;
  confidence: number;
  reason: string;
}> {
  const r = await fetch(`${API_BASE}/api/bookkeeping/verify-receipt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transaction_id: transactionId, receipt_text }),
  });
  return parseJson(r);
}

export async function receiptReminder(clientId: string, transactionIds?: number[]): Promise<unknown> {
  const url = `${API_BASE}/api/bookkeeping/receipt-reminder?client_id=${encodeURIComponent(clientId)}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transaction_ids: transactionIds ?? null, channel: 'whatsapp' }),
  });
  return parseJson(r);
}

export async function reconSignOff(
  clientId: string,
  periodMonth: number,
  periodYear: number,
  signedBy: string,
  varianceAmount: number,
  notes?: string
): Promise<void> {
  const r = await fetch(`${API_BASE}/api/bookkeeping/recon-sign-off`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      period_month: periodMonth,
      period_year: periodYear,
      signed_by: signedBy,
      variance_amount: varianceAmount,
      notes: notes ?? null,
    }),
  });
  await parseJson(r);
}

export async function anomalyAction(
  clientId: string,
  transactionId: number,
  action: 'approve' | 'investigate' | 'escalate'
): Promise<{ transaction: BookTxn }> {
  const r = await fetch(`${API_BASE}/api/bookkeeping/anomaly-action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, transaction_id: transactionId, action }),
  });
  return parseJson(r);
}

export async function getAccuracy(clientId: string): Promise<
  Array<{
    month: number;
    year: number;
    accuracy_pct: number | null;
    total_transactions: number;
    auto_approved: number;
    staff_corrected: number;
  }>
> {
  const r = await fetch(`${API_BASE}/api/bookkeeping/accuracy/${encodeURIComponent(clientId)}`);
  return parseJson(r);
}

export async function getMonthlyReport(clientId: string, month: number, year: number): Promise<unknown> {
  const q = new URLSearchParams({
    client_id: clientId,
    month: String(month),
    year: String(year),
  });
  const r = await fetch(`${API_BASE}/api/bookkeeping/monthly-report?${q}`);
  return parseJson(r);
}

export function monthlyReportPdfUrl(clientId: string, month: number, year: number): string {
  const q = new URLSearchParams({
    client_id: clientId,
    month: String(month),
    year: String(year),
  });
  return `${API_BASE}/api/bookkeeping/monthly-report/pdf?${q}`;
}
