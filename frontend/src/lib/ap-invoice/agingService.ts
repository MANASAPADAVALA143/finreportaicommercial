import { supabase } from './supabase';

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

function isInvoiceUnpaid(payment_status: string | null | undefined, status: string | null | undefined): boolean {
  if (status === 'Paid') return false;
  return payment_status !== 'paid';
}

function isInvoicePaid(payment_status: string | null | undefined, status: string | null | undefined): boolean {
  return status === 'Paid' || payment_status === 'paid';
}

/** Aging bucket summary â€” current + three overdue bands */
export async function getAgingSummary(): Promise<AgingBucket[]> {
  const today = new Date().toISOString().split('T')[0];

  const { data, error } = await supabase
    .from('invoices')
    .select('total_amount, due_date, payment_status, status')
    .not('total_amount', 'is', null);

  if (error) throw error;
  const rows = (data ?? []).filter((r) => isInvoiceUnpaid(r.payment_status, r.status));

  const buckets = {
    current: { label: 'Current', key: 'current', count: 0, amount: 0 },
    days_1_30: { label: '1â€“30 days', key: '1_30', count: 0, amount: 0 },
    days_31_60: { label: '31â€“60 days', key: '31_60', count: 0, amount: 0 },
    over_60: { label: '60+ days', key: 'over_60', count: 0, amount: 0 },
  };

  for (const row of rows) {
    const amt = Number(row.total_amount ?? 0);
    if (!row.due_date) {
      buckets.current.amount += amt;
      buckets.current.count++;
      continue;
    }
    const daysOverdue = Math.floor(
      (new Date(today).getTime() - new Date(row.due_date).getTime()) / 86400000
    );
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

function bucketKeyForRow(due_date: string | null, today: string): string {
  if (!due_date) return 'current';
  const daysOverdue = Math.floor(
    (new Date(today).getTime() - new Date(due_date).getTime()) / 86400000
  );
  if (daysOverdue <= 0) return 'current';
  if (daysOverdue <= 30) return '1_30';
  if (daysOverdue <= 60) return '31_60';
  return 'over_60';
}

/** Unpaid invoices with aging for the detail table */
export async function getAgingInvoices(bucket?: string): Promise<AgingInvoice[]> {
  const today = new Date().toISOString().split('T')[0];

  const { data, error } = await supabase
    .from('invoices')
    .select('id, invoice_number, vendor_name, total_amount, invoice_date, due_date, payment_status, status')
    .order('due_date', { ascending: true, nullsFirst: false });

  if (error) throw error;

  const unpaid = (data ?? []).filter((r) => isInvoiceUnpaid(r.payment_status, r.status));

  return unpaid
    .map((row) => {
      const daysOverdue = row.due_date
        ? Math.floor(
            (new Date(today).getTime() - new Date(row.due_date).getTime()) / 86400000
          )
        : 0;
      const aging_bucket = bucketKeyForRow(row.due_date, today);
      return {
        id: row.id,
        invoice_number: row.invoice_number,
        vendor_name: row.vendor_name,
        amount: Number(row.total_amount ?? 0),
        invoice_date: row.invoice_date,
        due_date: row.due_date,
        payment_status: row.payment_status ?? null,
        days_overdue: Math.max(0, daysOverdue),
        aging_bucket,
      };
    })
    .filter((row) => !bucket || row.aging_bucket === bucket);
}

/** DPO â‰ˆ (outstanding / purchases in window) Ã— days in window */
export async function getDpoMetrics(periodDays = 90): Promise<DpoMetrics> {
  const since = new Date(Date.now() - periodDays * 86400000).toISOString().split('T')[0];

  const { data, error } = await supabase
    .from('invoices')
    .select('total_amount, invoice_date, due_date, payment_status, paid_at, status')
    .gte('invoice_date', since);

  if (error) throw error;
  const rows = data ?? [];

  const totalOutstanding = rows
    .filter((r) => isInvoiceUnpaid(r.payment_status, r.status))
    .reduce((s, r) => s + Number(r.total_amount ?? 0), 0);

  const totalOverdue = rows
    .filter((r) => r.payment_status === 'overdue' && isInvoiceUnpaid(r.payment_status, r.status))
    .reduce((s, r) => s + Number(r.total_amount ?? 0), 0);

  const totalPurchases = rows.reduce((s, r) => s + Number(r.total_amount ?? 0), 0);

  const dpo =
    totalPurchases > 0 ? Math.round((totalOutstanding / totalPurchases) * periodDays) : 0;

  const paidRows = rows.filter(
    (r) => isInvoicePaid(r.payment_status, r.status) && r.paid_at && r.invoice_date
  );
  const avgPaymentDays =
    paidRows.length > 0
      ? Math.round(
          paidRows.reduce((s, r) => {
            return (
              s +
              Math.floor(
                (new Date(r.paid_at!).getTime() - new Date(r.invoice_date!).getTime()) / 86400000
              )
            );
          }, 0) / paidRows.length
        )
      : 0;

  const onTimeRows = paidRows.filter(
    (r) => r.due_date && r.paid_at && new Date(r.paid_at) <= new Date(r.due_date)
  );
  const onTimeRate =
    paidRows.length > 0 ? Math.round((onTimeRows.length / paidRows.length) * 100) : 0;

  return {
    dpo,
    avg_payment_days: avgPaymentDays,
    total_outstanding: totalOutstanding,
    total_overdue: totalOverdue,
    on_time_payment_rate: onTimeRate,
  };
}

export async function getAgingByVendor(): Promise<
  { vendor: string; outstanding: number; overdue: number; current: number; count: number }[]
> {
  const { data, error } = await supabase
    .from('invoices')
    .select('vendor_name, total_amount, payment_status, due_date, status');

  if (error) throw error;
  const today = new Date().toISOString().split('T')[0];

  const byVendor: Record<
    string,
    { vendor: string; outstanding: number; overdue: number; current: number; count: number }
  > = {};

  for (const row of data ?? []) {
    if (!isInvoiceUnpaid(row.payment_status, row.status)) continue;
    const v = row.vendor_name ?? 'Unknown';
    const amt = Number(row.total_amount ?? 0);
    if (!byVendor[v]) {
      byVendor[v] = { vendor: v, outstanding: 0, overdue: 0, current: 0, count: 0 };
    }
    byVendor[v].outstanding += amt;
    byVendor[v].count++;
    const pastDue = row.due_date && new Date(row.due_date) < new Date(today);
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
  a.download = `ap-aging-${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

