import { supabase } from './supabase';
import { getMyCompany } from './companyService';
import { isInvoiceOpenForPayment, isInvoiceOverdueByDate } from './paymentService';

export interface AgingBucket {
  label: string;
  key: string;
  invoice_count: number;
  total_amount: number;
  color: string;
}

export interface AgingInvoice {
  id: string;
  invoice_number: string | null;
  vendor_name: string | null;
  amount: number;
  invoice_date: string | null;
  due_date: string | null;
  payment_status: string | null;
  days_overdue: number;
  aging_bucket: string;
}

export interface DpoMetrics {
  dpo: number;
  avg_payment_days: number;
  total_outstanding: number;
  total_overdue: number;
  on_time_payment_rate: number;
}

function todayIso(): string {
  return new Date().toISOString().split('T')[0];
}

function daysOverdueFromDueDate(due_date: string | null | undefined, today: string): number {
  if (!due_date) return 0;
  return Math.floor((new Date(today).getTime() - new Date(due_date).getTime()) / 86400000);
}

function bucketKeyForRow(due_date: string | null, today: string): string {
  const daysOverdue = daysOverdueFromDueDate(due_date, today);
  if (daysOverdue <= 0) return 'current';
  if (daysOverdue <= 30) return '1_30';
  if (daysOverdue <= 60) return '31_60';
  return 'over_60';
}

type AgingRow = {
  id?: string;
  invoice_number?: string | null;
  vendor_name?: string | null;
  total_amount?: number | null;
  invoice_date?: string | null;
  due_date?: string | null;
  payment_status?: string | null;
  status?: string | null;
};

/**
 * Open AP for aging: NOT paid/cancelled, has due_date, bucketed by calendar — not payment_status=overdue.
 * Includes pending, overdue, processing, scheduled, frozen, null.
 */
async function fetchOpenInvoices(select: string): Promise<AgingRow[]> {
  const company = await getMyCompany();
  const companyId = company?.id ?? null;

  let q = supabase
    .from('invoices')
    .select(select)
    .neq('status', 'Paid')
    .not('due_date', 'is', null)
    .not('payment_status', 'in', '(paid,cancelled)')
    .order('due_date', { ascending: true });

  if (companyId) q = q.eq('company_id', companyId);

  const { data, error } = await q;
  if (error) {
    console.error('[ap_aging] query error:', error.message, { companyId });
    throw error;
  }

  const rows = ((data ?? []) as AgingRow[]).filter((row) => isInvoiceOpenForPayment(row));
  const sum = rows.reduce((s, r) => s + Number(r.total_amount ?? 0), 0);
  console.info('[ap_aging] company_id:', companyId, 'rows:', rows.length, 'total AED:', sum);
  return rows;
}

/** Aging bucket summary — current + three overdue bands */
export async function getAgingSummary(): Promise<AgingBucket[]> {
  const today = todayIso();
  const rows = await fetchOpenInvoices('total_amount, due_date, payment_status, status');

  const buckets = {
    current: { label: 'Current', key: 'current', count: 0, amount: 0 },
    days_1_30: { label: '1–30 days', key: '1_30', count: 0, amount: 0 },
    days_31_60: { label: '31–60 days', key: '31_60', count: 0, amount: 0 },
    over_60: { label: '60+ days', key: 'over_60', count: 0, amount: 0 },
  };

  for (const row of rows) {
    const amt = Number(row.total_amount ?? 0);
    const daysOverdue = daysOverdueFromDueDate(row.due_date ?? null, today);
    if (daysOverdue <= 0) {
      buckets.current.amount += amt;
      buckets.current.count++;
    } else if (daysOverdue <= 30) {
      buckets.days_1_30.amount += amt;
      buckets.days_1_30.count++;
    } else if (daysOverdue <= 60) {
      buckets.days_31_60.amount += amt;
      buckets.days_31_60.count++;
    } else {
      buckets.over_60.amount += amt;
      buckets.over_60.count++;
    }
  }

  return [
    {
      ...buckets.current,
      invoice_count: buckets.current.count,
      total_amount: buckets.current.amount,
      color: '#1D9E75',
    },
    {
      ...buckets.days_1_30,
      invoice_count: buckets.days_1_30.count,
      total_amount: buckets.days_1_30.amount,
      color: '#EF9F27',
    },
    {
      ...buckets.days_31_60,
      invoice_count: buckets.days_31_60.count,
      total_amount: buckets.days_31_60.amount,
      color: '#D85A30',
    },
    {
      ...buckets.over_60,
      invoice_count: buckets.over_60.count,
      total_amount: buckets.over_60.amount,
      color: '#E24B4A',
    },
  ];
}

/** Unpaid invoices with aging for the detail table */
export async function getAgingInvoices(bucket?: string): Promise<AgingInvoice[]> {
  const today = todayIso();
  const rows = await fetchOpenInvoices(
    'id, invoice_number, vendor_name, total_amount, invoice_date, due_date, payment_status, status',
  );

  return rows
    .map((row) => {
      const daysOverdue = daysOverdueFromDueDate(row.due_date ?? null, today);
      const aging_bucket = bucketKeyForRow(row.due_date ?? null, today);
      return {
        id: row.id!,
        invoice_number: row.invoice_number ?? null,
        vendor_name: row.vendor_name ?? null,
        amount: Number(row.total_amount ?? 0),
        invoice_date: row.invoice_date ?? null,
        due_date: row.due_date ?? null,
        payment_status: row.payment_status ?? null,
        days_overdue: Math.max(0, daysOverdue),
        aging_bucket,
      };
    })
    .filter((row) => !bucket || row.aging_bucket === bucket);
}

type PaidRow = AgingRow & {
  paid_at?: string | null;
  payment_date?: string | null;
  paid_date?: string | null;
};

function resolvePaidDate(row: PaidRow): string | null {
  // paid_at is canonical; payment_date is the legacy/date column on AP invoices.
  const raw = row.paid_at ?? row.payment_date ?? row.paid_date;
  return raw ? String(raw).slice(0, 10) : null;
}

/** DPO from paid invoice cycle times; on-time rate from paid vs due_date. */
export async function getDpoMetrics(periodDays = 90): Promise<DpoMetrics> {
  const since = new Date(Date.now() - periodDays * 86400000).toISOString().split('T')[0];
  const today = todayIso();
  const company = await getMyCompany();
  const companyId = company?.id ?? null;

  const paidSelect =
    'total_amount, invoice_date, due_date, payment_status, status, paid_at, payment_date';

  let paidQ = supabase
    .from('invoices')
    .select(paidSelect)
    .or('status.eq.Paid,status.eq.paid,status.eq.PAID')
    .not('paid_at', 'is', null);

  if (companyId) paidQ = paidQ.eq('company_id', companyId);

  const paidQueryLog =
    `invoices?select=${encodeURIComponent(paidSelect)}` +
    `&or=(status.eq.Paid,status.eq.paid,status.eq.PAID)` +
    `&paid_at=not.is.null` +
    (companyId ? `&company_id=eq.${companyId}` : '');
  console.info('[ap_aging] paid invoice query (PostgREST):', paidQueryLog);

  const [openRows, { data: paidRowsRaw, error: paidErr }] = await Promise.all([
    fetchOpenInvoices('total_amount, due_date, payment_status, status'),
    paidQ,
  ]);

  if (paidErr) {
    console.error('[ap_aging] paid invoice query error:', paidErr.message, paidQueryLog);
    throw paidErr;
  }

  const allPaidRows = (paidRowsRaw ?? []) as PaidRow[];
  const paidInPeriod = allPaidRows.filter((row) => {
    const pd = resolvePaidDate(row);
    return pd != null && pd >= since;
  });
  const paidRows = paidInPeriod.length > 0 ? paidInPeriod : allPaidRows;

  console.info('[ap_aging] paid invoice rows', {
    companyId,
    since,
    allPaid: allPaidRows.length,
    inPeriod: paidInPeriod.length,
    usedForDpo: paidRows.length,
  });

  const totalOutstanding = openRows.reduce((s, r) => s + Number(r.total_amount ?? 0), 0);
  const totalOverdue = openRows
    .filter((r) => isInvoiceOverdueByDate(r, today))
    .reduce((s, r) => s + Number(r.total_amount ?? 0), 0);

  const paymentDays: number[] = [];
  let onTime = 0;
  let onTimeDenominator = 0;

  for (const row of paidRows) {
    const invDate = row.invoice_date;
    const paidDate = resolvePaidDate(row);
    if (!invDate || !paidDate) continue;

    const days = Math.max(
      0,
      Math.floor(
        (new Date(paidDate).getTime() - new Date(String(invDate).slice(0, 10)).getTime()) /
          86400000,
      ),
    );
    paymentDays.push(days);

    if (row.due_date) {
      onTimeDenominator += 1;
      if (paidDate <= String(row.due_date).slice(0, 10)) {
        onTime += 1;
      }
    }
  }

  const avgPaymentDays =
    paymentDays.length > 0
      ? Math.round(paymentDays.reduce((a, b) => a + b, 0) / paymentDays.length)
      : 0;

  const onTimePaymentRate =
    onTimeDenominator > 0 ? Math.round((onTime / onTimeDenominator) * 100) : 0;

  const dpo = avgPaymentDays;

  console.info('[ap_aging] DPO metrics', {
    companyId,
    totalOutstanding,
    totalOverdue,
    dpo,
    avgPaymentDays,
    onTimePaymentRate,
    paidCount: paidRows.length,
    paymentDaysSample: paymentDays.slice(0, 5),
    openCount: openRows.length,
  });

  return {
    dpo,
    avg_payment_days: avgPaymentDays,
    total_outstanding: totalOutstanding,
    total_overdue: totalOverdue,
    on_time_payment_rate: onTimePaymentRate,
  };
}

export async function getAgingByVendor(): Promise<
  { vendor: string; outstanding: number; overdue: number; current: number; count: number }[]
> {
  const today = todayIso();
  const rows = await fetchOpenInvoices('vendor_name, total_amount, payment_status, due_date, status');

  const byVendor: Record<
    string,
    { vendor: string; outstanding: number; overdue: number; current: number; count: number }
  > = {};

  for (const row of rows) {
    const v = row.vendor_name ?? 'Unknown';
    const amt = Number(row.total_amount ?? 0);
    if (!byVendor[v]) {
      byVendor[v] = { vendor: v, outstanding: 0, overdue: 0, current: 0, count: 0 };
    }
    byVendor[v].outstanding += amt;
    byVendor[v].count++;
    const pastDue = isInvoiceOverdueByDate(row, today);
    if (pastDue) byVendor[v].overdue += amt;
    else byVendor[v].current += amt;
  }

  return Object.values(byVendor)
    .sort((a, b) => b.outstanding - a.outstanding)
    .slice(0, 10);
}

export function exportAgingCsv(invoices: AgingInvoice[]) {
  const headers = [
    'Invoice #',
    'Vendor',
    'Amount',
    'Invoice Date',
    'Due Date',
    'Days Overdue',
    'Bucket',
    'Status',
  ];
  const rows = invoices.map((i) => [
    i.invoice_number ?? '',
    i.vendor_name ?? '',
    i.amount,
    i.invoice_date ?? '',
    i.due_date ?? '',
    i.days_overdue,
    i.aging_bucket,
    i.payment_status ?? '',
  ]);
  const csv = [headers, ...rows]
    .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ap-aging-${todayIso()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
