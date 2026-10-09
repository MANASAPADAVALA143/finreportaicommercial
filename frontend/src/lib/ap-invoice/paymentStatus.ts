import type { Invoice } from './supabase';

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

export type CashFlowWeek = { label: string; start: string; end: string; unpaid: number; scheduled: number };

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Next ~30 days grouped by week — unpaid vs scheduled by effective pay date. */
export function buildCashFlowWeeks(
  rows: Pick<Invoice, 'due_date' | 'scheduled_payment_date' | 'total_amount' | 'payment_status' | 'status'>[],
  now: Date = new Date(),
): CashFlowWeek[] {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const weeks = [0, 7, 14, 21].map((offset) => {
    const start = new Date(today);
    start.setDate(start.getDate() + offset);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    return {
      label: offset === 0 ? 'This week' : `Week ${offset / 7 + 1}`,
      start: isoDay(start),
      end: isoDay(end),
    };
  });

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
    return { ...week, unpaid, scheduled };
  });
}
