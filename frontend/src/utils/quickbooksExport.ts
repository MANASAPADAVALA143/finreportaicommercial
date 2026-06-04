/**
 * QuickBooks integration â€” IIF format (Desktop) and Online API
 */

export function generateQBIIF(invoices: Array<Record<string, unknown>>): string {
  const lines = [
    '!TRNS\tTRNSTYPE\tDATE\tACCNT\tNAME\tAMOUNT\tDOCNUM\tMEMO',
    '!SPL\tTRNSTYPE\tDATE\tACCNT\tNAME\tAMOUNT\tDOCNUM\tMEMO',
    '!ENDTRNS',
  ];

  invoices.forEach((inv) => {
    const date = String(inv.invoice_date || '');
    const amount = Number(inv.total_amount ?? 0);
    const gl = (inv.gl_account_name as string) || 'Accounts Payable';

    lines.push(
      [
        'TRNS',
        'BILL',
        date,
        'Accounts Payable',
        inv.vendor_name,
        `-${amount.toFixed(2)}`,
        inv.invoice_number,
        (inv.description as string) || (inv.ifrs_category as string) || '',
      ].join('\t')
    );

    lines.push(
      [
        'SPL',
        'BILL',
        date,
        gl,
        inv.vendor_name,
        amount.toFixed(2),
        inv.invoice_number,
        (inv.ifrs_category as string) || '',
      ].join('\t')
    );

    lines.push('ENDTRNS');
  });

  return lines.join('\n');
}

export function downloadQBIIF(invoices: Array<Record<string, unknown>>): void {
  const content = generateQBIIF(invoices);
  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `quickbooks_${new Date().toISOString().split('T')[0]}.iif`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function pushToQBOnline(
  invoice: Record<string, unknown>,
  accessToken: string,
  realmId: string
): Promise<unknown> {
  const baseUrl = 'https://quickbooks.api.intuit.com';

  const bill = {
    VendorRef: { name: invoice.vendor_name },
    TxnDate: invoice.invoice_date,
    DueDate: invoice.due_date,
    DocNumber: invoice.invoice_number,
    PrivateNote: `IFRS: ${invoice.ifrs_category} | GL: ${invoice.gl_account}`,
    Line: [
      {
        Amount: Number(invoice.subtotal_amount ?? invoice.total_amount),
        DetailType: 'AccountBasedExpenseLineDetail',
        Description: (invoice.description as string) || (invoice.ifrs_category as string),
        AccountBasedExpenseLineDetail: {
          AccountRef: { name: (invoice.gl_account_name as string) || 'Expenses' },
        },
      },
    ],
    TotalAmt: Number(invoice.total_amount),
  };

  const res = await fetch(`${baseUrl}/v3/company/${realmId}/bill`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(bill),
  });

  if (!res.ok) {
    const err = (await res.json()) as { Fault?: { Error?: Array<{ Message?: string }> } };
    throw new Error(
      err.Fault?.Error?.[0]?.Message || 'QuickBooks sync failed'
    );
  }
  return res.json();
}

