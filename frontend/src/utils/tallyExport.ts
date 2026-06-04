/**
 * TallyPrime Rel 7.0 Integration
 * Supports: Standard + Edit Log versions
 * XML format: TDL-based voucher import
 * Port: 9000 (enable in TallyPrime → F12 → Configure)
 */

export type TallyVersion = 'standard' | 'edit_log';

/** Escape XML special characters so Tally accepts any vendor/GL name containing & < > " ' */
function escapeTallyXml(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export interface TallySettings {
  url: string; // http://localhost:9000
  company: string; // exact company name in Tally
  version: TallyVersion;
}

// ── Build one Purchase Voucher per invoice ──────────────────
function buildVoucher(inv: Record<string, unknown>, settings: TallySettings): string {
  const date = String(inv.invoice_date || '').replace(/-/g, '');
  const subtotal = Number(inv.subtotal_amount ?? inv.total_amount ?? 0);
  const tax = Number(inv.tax_amount ?? 0);
  const total = Number(inv.total_amount ?? 0);
  const taxType = (inv.tax_type as string) || 'IGST';
  const taxRate = Number(inv.tax_rate ?? 18);
  const glName = (inv.gl_account_name as string) || 'Purchase Accounts';
  const narration = (inv.description as string) || (inv.ifrs_category as string) || '';

  // Edit Log version adds GUID for audit trail
  const guidAttr = settings.version === 'edit_log' ? `GUID="${crypto.randomUUID()}"` : '';

  return `
  <TALLYMESSAGE xmlns:UDF="TallyUDF">
    <VOUCHER VCHTYPE="Purchase" ACTION="Create" ${guidAttr}>
      <DATE>${date}</DATE>
      <VOUCHERNUMBER>${escapeTallyXml(inv.invoice_number)}</VOUCHERNUMBER>
      <REFERENCE>${escapeTallyXml(inv.po_number || '')}</REFERENCE>
      <PARTYLEDGERNAME>${escapeTallyXml(inv.vendor_name)}</PARTYLEDGERNAME>
      <NARRATION>${escapeTallyXml(narration)}</NARRATION>
      <PERSISTEDVIEW>Invoice Voucher View</PERSISTEDVIEW>

      ${settings.version === 'edit_log' ? `
      <AUDITDETAILS.LIST>
        <AUDITDATE>${date}</AUDITDATE>
        <AUDITTIME>${new Date().toTimeString().split(' ')[0]}</AUDITTIME>
        <AUDITUSER>InvoiceFlow</AUDITUSER>
        <AUDITACTION>Invoice imported from InvoiceFlow AP</AUDITACTION>
      </AUDITDETAILS.LIST>` : ''}

      <ALLLEDGERENTRIES.LIST>
        <LEDGERNAME>${escapeTallyXml(glName)}</LEDGERNAME>
        <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
        <AMOUNT>-${subtotal.toFixed(2)}</AMOUNT>
        <VATEXPAMOUNT>-${subtotal.toFixed(2)}</VATEXPAMOUNT>
      </ALLLEDGERENTRIES.LIST>

      ${tax > 0 ? `
      <ALLLEDGERENTRIES.LIST>
        <LEDGERNAME>${escapeTallyXml(taxType)} @ ${taxRate}%</LEDGERNAME>
        <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
        <AMOUNT>-${tax.toFixed(2)}</AMOUNT>
      </ALLLEDGERENTRIES.LIST>` : ''}

      <ALLLEDGERENTRIES.LIST>
        <LEDGERNAME>${escapeTallyXml(inv.vendor_name)}</LEDGERNAME>
        <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
        <AMOUNT>${total.toFixed(2)}</AMOUNT>
      </ALLLEDGERENTRIES.LIST>
    </VOUCHER>
  </TALLYMESSAGE>`;
}

// ── Generate full XML envelope ──────────────────────────────
export function generateTallyXML(
  invoices: Array<Record<string, unknown>>,
  settings: TallySettings
): string {
  const vouchers = invoices.map((inv) => buildVoucher(inv, settings)).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
  <ENVELOPE>
    <HEADER>
      <TALLYREQUEST>Import Data</TALLYREQUEST>
    </HEADER>
    <BODY>
      <IMPORTDATA>
        <REQUESTDESC>
          <REPORTNAME>Vouchers</REPORTNAME>
          <STATICVARIABLES>
            <SVCURRENTCOMPANY>${escapeTallyXml(settings.company)}</SVCURRENTCOMPANY>
            <SVExportFormat>$$SysName:XML</SVExportFormat>
          </STATICVARIABLES>
        </REQUESTDESC>
        <REQUESTDATA>
          ${vouchers}
        </REQUESTDATA>
      </IMPORTDATA>
    </BODY>
  </ENVELOPE>`;
}

// ── Download XML file (always works) ───────────────────────
export function downloadTallyXML(
  invoices: Array<Record<string, unknown>>,
  settings: TallySettings
): void {
  const xml = generateTallyXML(invoices, settings);
  const blob = new Blob([xml], { type: 'text/xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `tallyprime_${new Date().toISOString().split('T')[0]}.xml`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Push directly to TallyPrime HTTP server ─────────────────
// Requires: TallyPrime → F12 → Configure → Enable HTTP → Port 9000
export async function pushToTallyPrime(
  invoices: Array<Record<string, unknown>>,
  settings: TallySettings
): Promise<{ success: boolean; message: string; imported: number }> {
  try {
    const xml = generateTallyXML(invoices, settings);
    const res = await fetch(settings.url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml;charset=utf-8' },
      body: xml,
    });
    const text = await res.text();

    // Parse TallyPrime 7.0 response
    const created = text.match(/CREATED[^>]*>(\d+)/)?.[1] || '0';
    const altered = text.match(/ALTERED[^>]*>(\d+)/)?.[1] || '0';
    const errors = text.match(/LASTSTATUS[^>]*>([^<]+)/)?.[1] || '';
    const hasError =
      text.includes('LINEERROR') || text.includes('Error') || errors === '1';

    if (hasError) {
      const errMsg =
        text.match(/LINEERROR[^>]*>([^<]+)/)?.[1] || 'Tally rejected the voucher';
      return { success: false, message: errMsg, imported: 0 };
    }

    const count = parseInt(created, 10) + parseInt(altered, 10);
    return {
      success: true,
      message: `${count} voucher(s) imported into TallyPrime`,
      imported: count,
    };
  } catch {
    // Network error — TallyPrime not running or wrong port
    // Fall back to file download
    downloadTallyXML(invoices, settings);
    return {
      success: true,
      message:
        'TallyPrime not reachable — XML file downloaded instead. Import via: TallyPrime → Gateway → Import Data → Vouchers',
      imported: 0,
    };
  }
}
