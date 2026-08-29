/**
 * Generate a clean tax invoice PDF from raw invoice data.
 * Opens a print-ready HTML page and triggers browser print dialog.
 */
import type { Invoice } from './supabase';

function fmt(amount: number | null | undefined, currency = 'AED'): string {
  if (amount == null) return '—';
  return `${currency} ${Number(amount).toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    return d;
  }
}

export function generateInvoicePdf(invoice: Invoice, companyName = ''): void {
  const cur = invoice.currency || 'AED';
  const subtotal = invoice.subtotal_amount ?? invoice.total_amount;
  const vatAmt = invoice.vat_amount ?? invoice.tax_amount ?? 0;
  const vatRate = invoice.vat_rate ?? invoice.tax_rate ?? 0;
  const total = invoice.total_amount;
  const isUAE = cur === 'AED' || !!invoice.vendor_trn;

  const vatRow = vatAmt
    ? `<tr><td colspan="3" style="text-align:right;padding:6px 12px;font-size:13px;color:#555">VAT (${vatRate}%):</td><td style="text-align:right;padding:6px 12px;font-size:13px;font-weight:600">${fmt(vatAmt, cur)}</td></tr>`
    : '';

  const poRow = invoice.po_number
    ? `<tr><td style="color:#666;padding:3px 0">PO Number</td><td style="font-weight:600">${invoice.po_number}</td></tr>`
    : '';

  const trnRow = invoice.vendor_trn
    ? `<p style="margin:2px 0;font-size:12px;color:#888">TRN: ${invoice.vendor_trn}</p>`
    : '';

  const glRow = invoice.gl_code || invoice.gl_account_name
    ? `<tr><td style="color:#666;padding:3px 0">GL Account</td><td style="font-weight:600">${[invoice.gl_code, invoice.gl_account_name].filter(Boolean).join(' — ')}</td></tr>`
    : '';

  const costCenterRow = invoice.cost_center
    ? `<tr><td style="color:#666;padding:3px 0">Cost Center</td><td style="font-weight:600">${invoice.cost_center}</td></tr>`
    : '';

  const vatTreatmentBadge = invoice.vat_treatment && isUAE
    ? `<div style="background:#e6f4ea;border:1px solid #b7dfbf;border-radius:6px;padding:8px 14px;margin-bottom:18px;font-size:12px;color:#1a6630">
        <strong>VAT Treatment:</strong> ${invoice.vat_treatment.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
        ${vatRate ? `&nbsp;(${vatRate}%)` : ''}
       </div>`
    : '';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>Invoice — ${invoice.invoice_number}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; font-size: 13px; color: #1a1a1a; background: #fff; padding: 32px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 28px; }
  .vendor-block h2 { font-size: 20px; font-weight: 700; color: #0f2d5e; }
  .vendor-block p { font-size: 12px; color: #555; margin-top: 3px; }
  .title-block { text-align: right; }
  .title-block h1 { font-size: 28px; font-weight: 800; color: #0f2d5e; letter-spacing: 1px; }
  .title-block p { font-size: 12px; color: #666; margin-top: 4px; }
  .divider { border: none; border-top: 2px solid #0f2d5e; margin: 16px 0; }
  .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 24px; }
  .meta-box { background: #f7f9fc; border-radius: 8px; padding: 14px 18px; }
  .meta-box h3 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.8px; color: #888; margin-bottom: 8px; }
  .meta-box table { width: 100%; border-collapse: collapse; }
  .meta-box td { padding: 3px 0; font-size: 13px; vertical-align: top; }
  .meta-box td:first-child { width: 45%; }
  table.items { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
  table.items thead tr { background: #0f2d5e; color: #fff; }
  table.items thead th { padding: 10px 12px; text-align: left; font-size: 12px; font-weight: 600; }
  table.items thead th:last-child { text-align: right; }
  table.items tbody tr:nth-child(even) { background: #f7f9fc; }
  table.items tbody td { padding: 10px 12px; font-size: 13px; border-bottom: 1px solid #e5e9f0; }
  table.items tbody td:last-child { text-align: right; font-weight: 600; }
  .totals { width: 340px; margin-left: auto; border: 1px solid #e0e5ef; border-radius: 8px; overflow: hidden; }
  .totals table { width: 100%; border-collapse: collapse; }
  .totals table tr td { padding: 8px 14px; font-size: 13px; }
  .totals table tr:last-child { background: #0f2d5e; color: #fff; }
  .totals table tr:last-child td { font-size: 15px; font-weight: 700; padding: 12px 14px; }
  .footer { margin-top: 36px; border-top: 1px solid #e0e5ef; padding-top: 14px; font-size: 11px; color: #999; text-align: center; }
  @media print { body { padding: 16px; } }
</style>
</head>
<body>

<div class="header">
  <div class="vendor-block">
    <h2>${invoice.vendor_name || '—'}</h2>
    ${invoice.vendor_address ? `<p>${invoice.vendor_address}</p>` : ''}
    ${trnRow}
    ${invoice.vendor_email ? `<p style="margin:2px 0;font-size:12px;color:#888">${invoice.vendor_email}</p>` : ''}
  </div>
  <div class="title-block">
    <h1>TAX INVOICE</h1>
    ${companyName ? `<p style="font-size:14px;font-weight:600;color:#0f2d5e;margin-top:4px">${companyName}</p>` : ''}
  </div>
</div>

<hr class="divider"/>

<div class="meta">
  <div class="meta-box">
    <h3>Invoice Details</h3>
    <table>
      <tr><td style="color:#666">Invoice No</td><td style="font-weight:700;color:#0f2d5e">${invoice.invoice_number}</td></tr>
      <tr><td style="color:#666">Invoice Date</td><td style="font-weight:600">${fmtDate(invoice.invoice_date)}</td></tr>
      <tr><td style="color:#666">Due Date</td><td style="font-weight:600">${fmtDate(invoice.due_date)}</td></tr>
      <tr><td style="color:#666">Currency</td><td style="font-weight:600">${cur}</td></tr>
      ${poRow}
    </table>
  </div>
  <div class="meta-box">
    <h3>Account Information</h3>
    <table>
      <tr><td style="color:#666">Status</td><td style="font-weight:600">${invoice.status || '—'}</td></tr>
      ${glRow}
      ${costCenterRow}
      ${invoice.department ? `<tr><td style="color:#666;padding:3px 0">Department</td><td style="font-weight:600">${invoice.department}</td></tr>` : ''}
      ${invoice.property_ref ? `<tr><td style="color:#666;padding:3px 0">Property</td><td style="font-weight:600">${invoice.property_ref}</td></tr>` : ''}
    </table>
  </div>
</div>

${vatTreatmentBadge}

<table class="items">
  <thead>
    <tr>
      <th style="width:50%">Description</th>
      <th>Date</th>
      <th>Tax Type</th>
      <th>Amount (${cur})</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>${invoice.vendor_name} — Invoice ${invoice.invoice_number}</td>
      <td>${fmtDate(invoice.invoice_date)}</td>
      <td>${invoice.vat_treatment ? invoice.vat_treatment.replace(/_/g, ' ') : (invoice.tax_type || 'Standard')}</td>
      <td>${fmt(subtotal, cur)}</td>
    </tr>
  </tbody>
</table>

<div class="totals">
  <table>
    <tr>
      <td style="text-align:right;color:#555">Subtotal (Net):</td>
      <td style="text-align:right;font-weight:600">${fmt(subtotal, cur)}</td>
    </tr>
    ${vatRow}
    <tr>
      <td style="text-align:right">TOTAL:</td>
      <td style="text-align:right">${fmt(total, cur)}</td>
    </tr>
  </table>
</div>

<div class="footer">
  Generated by FinReportAI &nbsp;|&nbsp; ${new Date().toLocaleString()} &nbsp;|&nbsp; Invoice #${invoice.invoice_number}
</div>

<script>window.onload = function(){ window.print(); }</script>
</body>
</html>`;

  const w = window.open('', '_blank');
  if (w) {
    w.document.write(html);
    w.document.close();
  }
}
