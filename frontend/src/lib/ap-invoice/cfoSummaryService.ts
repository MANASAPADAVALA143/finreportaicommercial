/**
 * CFO weekly WhatsApp summary.
 * Aggregates AP data for the past 7 days (or custom window) and sends a summary
 * via VITE_CFO_SUMMARY_WEBHOOK_URL (n8n â†’ Twilio WhatsApp / email).
 *
 * Summary payload: { period, total_invoices, total_amount, approved, pending, rejected,
 *   overdue_count, overdue_amount, top_vendors, currency }
 */
import { supabase } from './supabase';

export interface CfoSummaryPayload {
  period_label: string;
  period_start: string;
  period_end: string;
  total_invoices: number;
  total_amount: number;
  approved: number;
  pending_approval: number;
  rejected: number;
  paid: number;
  overdue_count: number;
  overdue_amount: number;
  top_vendors: Array<{ vendor_name: string; count: number; amount: number }>;
  currency: string;
  /** Phone numbers to send to (E.164) */
  recipients: string[];
}

export interface CfoSummaryResult {
  ok: boolean;
  message: string;
  payload?: CfoSummaryPayload;
}

/** Build summary for the past `days` days. Does not send. */
export async function buildCfoSummary(days = 7, recipients: string[] = []): Promise<CfoSummaryPayload> {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - days);

  const startIso = start.toISOString().slice(0, 10);
  const endIso = end.toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from('invoices')
    .select('status, total_amount, currency, due_date, vendor_name, payment_status, created_at')
    .gte('created_at', start.toISOString());

  if (error) throw new Error(error.message);

  const invoices = data ?? [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let totalAmount = 0;
  let approved = 0;
  let pendingApproval = 0;
  let rejected = 0;
  let paid = 0;
  let overdueCount = 0;
  let overdueAmount = 0;
  const vendorMap: Record<string, { count: number; amount: number }> = {};
  const currencies: string[] = [];

  for (const inv of invoices) {
    const amount = Number(inv.total_amount) || 0;
    totalAmount += amount;
    if (inv.status === 'Approved') approved++;
    else if (inv.status === 'Rejected') rejected++;
    else if (inv.status === 'Paid') paid++;
    else pendingApproval++;

    if (inv.payment_status !== 'paid' && inv.due_date) {
      const due = new Date(inv.due_date);
      due.setHours(0, 0, 0, 0);
      if (due < today) {
        overdueCount++;
        overdueAmount += amount;
      }
    }

    if (inv.vendor_name) {
      if (!vendorMap[inv.vendor_name]) vendorMap[inv.vendor_name] = { count: 0, amount: 0 };
      vendorMap[inv.vendor_name].count++;
      vendorMap[inv.vendor_name].amount += amount;
    }
    if (inv.currency) currencies.push(inv.currency);
  }

  const topVendors = Object.entries(vendorMap)
    .map(([vendor_name, v]) => ({ vendor_name, ...v }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5);

  const currency = currencies.length > 0
    ? (Object.entries(currencies.reduce((acc: Record<string, number>, c) => { acc[c] = (acc[c] || 0) + 1; return acc; }, {})).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'INR')
    : 'INR';

  return {
    period_label: `Last ${days} days (${startIso} â€“ ${endIso})`,
    period_start: startIso,
    period_end: endIso,
    total_invoices: invoices.length,
    total_amount: Math.round(totalAmount * 100) / 100,
    approved,
    pending_approval: pendingApproval,
    rejected,
    paid,
    overdue_count: overdueCount,
    overdue_amount: Math.round(overdueAmount * 100) / 100,
    top_vendors: topVendors,
    currency,
    recipients,
  };
}

/** Build + send to VITE_CFO_SUMMARY_WEBHOOK_URL. */
export async function sendCfoSummary(days = 7, recipients: string[] = []): Promise<CfoSummaryResult> {
  const webhookUrl = (import.meta.env.VITE_CFO_SUMMARY_WEBHOOK_URL as string | undefined)?.trim();
  const payload = await buildCfoSummary(days, recipients);

  if (!webhookUrl) {
    return {
      ok: true,
      message: `Summary built (no webhook set). ${payload.total_invoices} invoices, ${payload.currency} ${payload.total_amount.toLocaleString()}.`,
      payload,
    };
  }

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      return { ok: false, message: `Webhook returned HTTP ${res.status}`, payload };
    }
    return { ok: true, message: `CFO summary sent to ${recipients.length || 0} recipient(s).`, payload };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e), payload };
  }
}

