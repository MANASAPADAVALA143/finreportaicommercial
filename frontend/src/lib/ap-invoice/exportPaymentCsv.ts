import type { Invoice } from './supabase';

export function exportPaymentBatchCsv(invoices: Invoice[], batchDate: string) {
  const headers = [
    'Invoice Number',
    'Vendor Name',
    'Amount',
    'Currency',
    'Due Date',
    'Scheduled Payment Date',
    'Payment Reference',
    'GSTIN',
    'Status',
  ];

  const rows = invoices.map((inv) => [
    inv.invoice_number ?? '',
    inv.vendor_name ?? '',
    inv.total_amount ?? 0,
    inv.currency ?? 'INR',
    inv.due_date ?? '',
    inv.scheduled_payment_date ?? batchDate,
    inv.payment_reference ?? '',
    inv.gstin ?? '',
    inv.payment_status ?? '',
  ]);

  const csv = [headers, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `payment-batch-${batchDate}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
