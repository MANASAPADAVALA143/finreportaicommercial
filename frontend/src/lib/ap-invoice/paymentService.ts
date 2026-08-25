import { supabase } from './supabase';
import type { Invoice, PaymentBatch } from './supabase';
import { logAction, getInvoiceflowWorkEmail } from './auditService';
import { getMyCompany, requireCompanyId } from './companyService';
import { notifyVendorStatusByInvoiceId } from './whatsappService';

/**
 * Normalize legacy / mixed-case payment_status for queue, calendar, and cash-flow logic.
 * Values like `pending` (pre-migration) must behave as `unpaid` so overdue worklists populate.
 */
export function normalizedOpenPaymentStatus(inv: Invoice): 'unpaid' | 'overdue' | 'scheduled' | 'paid' {
  if (inv.status === 'Paid') return 'paid';
  const raw = String(inv.payment_status ?? 'unpaid').trim().toLowerCase();
  if (!raw || ['pending', 'open', 'draft', 'processing'].includes(raw)) return 'unpaid';
  if (['paid', 'complete', 'completed'].includes(raw)) return 'paid';
  if (raw === 'scheduled') return 'scheduled';
  if (raw === 'overdue') return 'overdue';
  if (raw === 'frozen') return 'unpaid';
  return 'unpaid';
}

/** Open AP balance — includes pending, overdue, processing, scheduled, frozen, null. */
export function isInvoiceOpenForPayment(inv: {
  status?: string | null;
  payment_status?: string | null;
}): boolean {
  if (inv.status === 'Paid' || inv.status === 'Rejected') return false;
  const ps = String(inv.payment_status ?? '').trim().toLowerCase();
  if (ps === 'paid' || ps === 'cancelled') return false;
  // pending, overdue, processing, unpaid, scheduled, frozen, null → open
  return true;
}

/** Past due on calendar date — due_date < today, still open for payment. */
export function isInvoiceOverdueByDate(
  inv: { status?: string | null; payment_status?: string | null; due_date?: string | null },
  today?: string,
): boolean {
  if (!isInvoiceOpenForPayment(inv)) return false;
  const t = today ?? new Date().toISOString().split('T')[0];
  const due = inv.due_date?.slice(0, 10);
  return !!due && due < t;
}

export function effectivePaymentDate(inv: Invoice): string | null {
  const ps = normalizedOpenPaymentStatus(inv);
  if (ps === 'paid') return null;
  if (ps === 'scheduled' && inv.scheduled_payment_date) {
    return inv.scheduled_payment_date.slice(0, 10);
  }
  return inv.due_date ? inv.due_date.slice(0, 10) : null;
}

/** Mark selected invoices as scheduled for a given payment date */
export async function schedulePayments(invoiceIds: string[], paymentDate: string) {
  if (!invoiceIds.length) return;
  const { error } = await supabase
    .from('invoices')
    .update({
      payment_status: 'scheduled',
      scheduled_payment_date: paymentDate,
    })
    .in('id', invoiceIds);
  if (error) throw error;
  logAction('payment.scheduled', 'invoice', null, getInvoiceflowWorkEmail(), {
    invoiceIds,
    paymentDate,
  });
}

/** Mark invoices as paid (updates workflow status + payment fields) */
export async function markAsPaid(invoiceIds: string[], paymentReference: string) {
  if (!invoiceIds.length) return;

  const { error } = await supabase
    .from('invoices')
    .update({
      payment_status: 'paid',
      payment_reference: paymentReference,
      paid_at: new Date().toISOString(),
      status: 'Paid',
    })
    .in('id', invoiceIds);
  if (error) throw error;
  logAction('payment.marked_paid', 'invoice', null, getInvoiceflowWorkEmail(), {
    invoiceIds,
    paymentReference,
  });

  for (const id of invoiceIds) {
    void notifyVendorStatusByInvoiceId(id, 'Paid');
  }
}

/** Invoices in the payment queue: unpaid / overdue / scheduled, not fully paid in workflow */
export async function getPaymentQueue(days = 30) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const end = new Date(today.getTime() + days * 86400000);
  const endStr = end.toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from('invoices')
    .select('*')
    .neq('status', 'Paid')
    .order('due_date', { ascending: true });

  if (error) throw error;
  const rows = (data || []) as Invoice[];

  return rows.filter((inv) => {
    const ps = normalizedOpenPaymentStatus(inv);
    if (ps === 'paid') return false;
    const eff = effectivePaymentDate(inv);
    if (!eff) return false;
    const d = new Date(eff + 'T12:00:00');
    if (d < today) return true;
    return eff <= endStr;
  });
}

/** Invoices with a date falling in [start, end] on due_date or scheduled_payment_date */
export async function getCalendarInvoices(start: string, end: string) {
  const { data, error } = await supabase.from('invoices').select('*').order('due_date', { ascending: true });
  if (error) throw error;
  const rows = (data || []) as Invoice[];
  return rows.filter((inv) => {
    const due = inv.due_date?.slice(0, 10);
    const sched = inv.scheduled_payment_date?.slice(0, 10);
    const inRange = (d: string | null | undefined) =>
      !!d && d >= start && d <= end;
    return inRange(due) || inRange(sched);
  });
}

/** Create a payment batch from selected invoices */
export async function createPaymentBatch(
  invoiceIds: string[],
  batchDate: string,
  createdBy: string,
  notes?: string
): Promise<PaymentBatch> {
  if (!invoiceIds.length) {
    throw new Error('No invoices selected for batch');
  }
  const { data: invs, error: selErr } = await supabase
    .from('invoices')
    .select('total_amount')
    .in('id', invoiceIds);
  if (selErr) throw selErr;
  const total = (invs ?? []).reduce((sum, i) => sum + Number((i as { total_amount?: number }).total_amount ?? 0), 0);

  const company_id = await requireCompanyId();
  const { data, error } = await supabase
    .from('payment_batches')
    .insert({
      company_id,
      batch_date: batchDate,
      invoice_ids: invoiceIds,
      total_amount: total,
      created_by: createdBy || null,
      notes: notes ?? null,
      status: 'draft',
    })
    .select()
    .single();
  if (error) throw error;
  const batch = data as PaymentBatch;
  logAction('payment.batch_exported', 'payment_batch', batch.id, createdBy || getInvoiceflowWorkEmail(), {
    invoiceCount: invoiceIds.length,
    totalAmount: total,
  });
  return batch;
}

export async function listPaymentBatches(): Promise<PaymentBatch[]> {
  const { data, error } = await supabase
    .from('payment_batches')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []) as PaymentBatch[];
}

export async function updatePaymentBatchStatus(id: string, status: PaymentBatch['status']) {
  const { error } = await supabase.from('payment_batches').update({ status }).eq('id', id);
  if (error) throw error;
}

export async function fetchInvoicesByIds(ids: string[]): Promise<Invoice[]> {
  if (!ids.length) return [];
  const { data, error } = await supabase.from('invoices').select('*').in('id', ids);
  if (error) throw error;
  return (data || []) as Invoice[];
}

const CLOSED_PAYMENT_STATUSES = new Set(['paid', 'cancelled', 'frozen']);

function shouldMarkOverdue(
  inv: Pick<Invoice, 'status' | 'payment_status' | 'due_date'>,
  today: string,
): boolean {
  if (!isInvoiceOverdueByDate(inv, today)) return false;
  const ps = String(inv.payment_status ?? 'unpaid').trim().toLowerCase();
  return !CLOSED_PAYMENT_STATUSES.has(ps);
}

/** Mark overdue invoices (call on aging / calendar page load). */
export async function markOverdueInvoices(): Promise<number> {
  const today = new Date().toISOString().split('T')[0];
  const company_id = (await getMyCompany())?.id;

  const { data, error } = await supabase.rpc('mark_overdue_invoices');
  if (!error && data != null) {
    const rpcCount = typeof data === 'number' ? data : Number(data) || 0;
    if (rpcCount > 0) return rpcCount;
  } else if (error) {
    console.warn('mark_overdue_invoices RPC:', error.message);
  }

  let selectQ = supabase
    .from('invoices')
    .select('id, status, payment_status, due_date')
    .neq('status', 'Paid')
    .lt('due_date', today);
  if (company_id) selectQ = selectQ.eq('company_id', company_id);

  const { data: candidates, error: selErr } = await selectQ;
  if (selErr) {
    console.warn('markOverdueInvoices select:', selErr.message);
    return 0;
  }

  const ids = (candidates ?? [])
    .filter((row) => shouldMarkOverdue(row as Invoice, today))
    .map((row) => row.id);
  if (!ids.length) return 0;

  let updateQ = supabase.from('invoices').update({ payment_status: 'overdue' }).in('id', ids);
  if (company_id) updateQ = updateQ.eq('company_id', company_id);

  const { data: updated, error: updErr } = await updateQ.select('id');
  if (updErr) {
    console.warn('markOverdueInvoices update:', updErr.message);
    return 0;
  }
  return updated?.length ?? 0;
}

/** Cash flow for next ~30 days — grouped by week (unpaid vs scheduled by effective pay date) */
export async function getCashFlowForecast() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const weeks = [0, 7, 14, 21].map((offset) => {
    const start = new Date(today);
    start.setDate(start.getDate() + offset);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    return {
      label: offset === 0 ? 'This week' : `Week ${offset / 7 + 1}`,
      start: start.toISOString().slice(0, 10),
      end: end.toISOString().slice(0, 10),
    };
  });

  const { data: all, error } = await supabase
    .from('invoices')
    .select('due_date, scheduled_payment_date, total_amount, payment_status, status');
  if (error) throw error;
  const rows = (all || []) as Pick<
    Invoice,
    'due_date' | 'scheduled_payment_date' | 'total_amount' | 'payment_status' | 'status'
  >[];

  return weeks.map((week) => {
    let unpaid = 0;
    let scheduled = 0;
    for (const r of rows) {
      const inv = r as Invoice;
      const ps = normalizedOpenPaymentStatus(inv);
      if (ps === 'paid') continue;
      const eff = effectivePaymentDate(inv);
      if (!eff || eff < week.start || eff > week.end) continue;
      const amt = Number(r.total_amount ?? 0);
      if (ps === 'scheduled') scheduled += amt;
      else unpaid += amt;
    }
    return { label: week.label, unpaid, scheduled };
  });
}
