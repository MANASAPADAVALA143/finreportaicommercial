/**
 * Xero accounting integration — CSV import and API
 */

export function generateXeroCSV(invoices: Array<Record<string, unknown>>): string {
  const headers = [
    'ContactName',
    'EmailAddress',
    'POAddressLine1',
    'DueDate',
    'InvoiceNumber',
    'Reference',
    'Description',
    'Quantity',
    'UnitAmount',
    'Discount',
    'AccountCode',
    'TaxType',
    'TaxAmount',
    'Currency',
  ];

  const rows = invoices.map((inv) => [
    inv.vendor_name || '',
    inv.vendor_email || '',
    inv.vendor_address || '',
    inv.due_date || '',
    inv.invoice_number || '',
    inv.po_number || '',
    (inv.description as string) || (inv.ifrs_category as string) || '',
    '1',
    Number(inv.subtotal_amount ?? inv.total_amount ?? 0).toFixed(2),
    '0',
    (inv.gl_account as string) || '200',
    inv.tax_type === 'GST' ? 'INPUT' : 'NONE',
    Number(inv.tax_amount ?? 0).toFixed(2),
    (inv.currency as string) || 'INR',
  ]);

  return [headers, ...rows]
    .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))
    .join('\n');
}

export function downloadXeroCSV(invoices: Array<Record<string, unknown>>): void {
  const content = generateXeroCSV(invoices);
  const blob = new Blob([content], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `xero_bills_${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function pushToXeroAPI(
  invoice: Record<string, unknown>,
  accessToken: string,
  tenantId: string
): Promise<unknown> {
  const xeroInvoice = {
    Type: 'ACCPAY',
    Contact: { Name: invoice.vendor_name },
    Date: invoice.invoice_date,
    DueDate: invoice.due_date,
    InvoiceNumber: invoice.invoice_number,
    Reference: (invoice.po_number as string) || '',
    Status: 'AUTHORISED',
    CurrencyCode: (invoice.currency as string) || 'INR',
    LineItems: [
      {
        Description: (invoice.description as string) || (invoice.ifrs_category as string) || '',
        Quantity: 1,
        UnitAmount: Number(invoice.subtotal_amount ?? invoice.total_amount),
        AccountCode: (invoice.gl_account as string) || '200',
        TaxType: invoice.tax_type ? 'INPUT' : 'NONE',
        TaxAmount: Number(invoice.tax_amount ?? 0),
      },
    ],
  };

  const res = await fetch('https://api.xero.com/api.xro/2.0/Invoices', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'xero-tenant-id': tenantId,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ Invoices: [xeroInvoice] }),
  });

  if (!res.ok) {
    const err = (await res.json()) as {
      Elements?: Array<{ ValidationErrors?: Array<{ Message?: string }> }>;
    };
    throw new Error(
      err.Elements?.[0]?.ValidationErrors?.[0]?.Message || 'Xero sync failed'
    );
  }
  return res.json();
}
