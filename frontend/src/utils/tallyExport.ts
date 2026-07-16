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

export type TallyVersion = 'standard' | 'edit_log';

export interface TallySettings {
  url: string; // http://localhost:9000
  company: string; // exact company name in Tally
  version: TallyVersion;
}

function num(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/** Build CGST/SGST/IGST (+ optional TDS) ledger lines for India invoices. */
function buildIndiaTaxLedgers(inv: Record<string, unknown>): string {
  const cgst = num(inv.cgst_amount ?? inv.cgst);
  const sgst = num(inv.sgst_amount ?? inv.sgst);
  const igst = num(inv.igst_amount ?? inv.igst);
  const tds = num(inv.tds_amount);
  const taxType = String(inv.tax_type || '').toUpperCase();
  const taxRate = num(inv.tax_rate ?? 18);
  const taxFallback = num(inv.tax_amount ?? inv.gst_amount);

  const parts: string[] = [];

  if (cgst > 0) {
    parts.push(`
      <ALLLEDGERENTRIES.LIST>
        <LEDGERNAME>CGST Input @ ${(taxRate / 2 || 9)}%</LEDGERNAME>
        <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
        <AMOUNT>-${cgst.toFixed(2)}</AMOUNT>
      </ALLLEDGERENTRIES.LIST>`);
  }
  if (sgst > 0) {
    parts.push(`
      <ALLLEDGERENTRIES.LIST>
        <LEDGERNAME>SGST Input @ ${(taxRate / 2 || 9)}%</LEDGERNAME>
        <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
        <AMOUNT>-${sgst.toFixed(2)}</AMOUNT>
      </ALLLEDGERENTRIES.LIST>`);
  }
  if (igst > 0) {
    parts.push(`
      <ALLLEDGERENTRIES.LIST>
        <LEDGERNAME>IGST Input @ ${taxRate || 18}%</LEDGERNAME>
        <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
        <AMOUNT>-${igst.toFixed(2)}</AMOUNT>
      </ALLLEDGERENTRIES.LIST>`);
  }

  // Fallback single GST ledger when split amounts missing
  if (!parts.length && taxFallback > 0) {
    const ledger =
      taxType.includes('CGST') || taxType.includes('SGST')
        ? `GST Input @ ${taxRate}%`
        : `${taxType || 'IGST'} @ ${taxRate}%`;
    parts.push(`
      <ALLLEDGERENTRIES.LIST>
        <LEDGERNAME>${escapeTallyXml(ledger)}</LEDGERNAME>
        <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
        <AMOUNT>-${taxFallback.toFixed(2)}</AMOUNT>
      </ALLLEDGERENTRIES.LIST>`);
  }

  if (tds > 0) {
    const section = String(inv.tds_section || '194C').trim() || '194C';
    parts.push(`
      <ALLLEDGERENTRIES.LIST>
        <LEDGERNAME>TDS Payable u/s ${escapeTallyXml(section)}</LEDGERNAME>
        <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
        <AMOUNT>${tds.toFixed(2)}</AMOUNT>
      </ALLLEDGERENTRIES.LIST>`);
  }

  return parts.join('');
}

function buildNarration(inv: Record<string, unknown>): string {
  const base = String(inv.description || inv.ifrs_category || '').trim();
  const gstin = String(inv.gstin || '').trim();
  const hsn = String(inv.hsn_sac_code || '').trim();
  const bits = [base];
  if (gstin) bits.push(`GSTIN: ${gstin}`);
  if (hsn) bits.push(`HSN/SAC: ${hsn}`);
  if (inv.reverse_charge === true) bits.push('RCM');
  return bits.filter(Boolean).join(' | ');
}

function vendorCreditAmount(inv: Record<string, unknown>): number {
  const total = num(inv.total_amount);
  const tds = num(inv.tds_amount);
  // Net payable to vendor after TDS deduction
  return Math.max(0, total - tds);
}

// ── Build one Purchase Voucher per invoice ──────────────────
function buildVoucher(inv: Record<string, unknown>, settings: TallySettings): string {
  const date = String(inv.invoice_date || '').replace(/-/g, '');
  const subtotal = num(inv.subtotal_amount ?? inv.total_amount);
  const glName =
    String(inv.gl_account_name || inv.gl_name || 'Purchase Accounts').trim() || 'Purchase Accounts';
  const narration = buildNarration(inv);
  const taxLedgers = buildIndiaTaxLedgers(inv);
  const vendorAmt = vendorCreditAmount(inv);

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

      ${taxLedgers}

      <ALLLEDGERENTRIES.LIST>
        <LEDGERNAME>${escapeTallyXml(inv.vendor_name)}</LEDGERNAME>
        <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
        <AMOUNT>${vendorAmt.toFixed(2)}</AMOUNT>
      </ALLLEDGERENTRIES.LIST>
    </VOUCHER>
  </TALLYMESSAGE>`;
}

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
    downloadTallyXML(invoices, settings);
    return {
      success: true,
      message:
        'TallyPrime not reachable — XML file downloaded instead. Import via: TallyPrime → Gateway → Import Data → Vouchers',
      imported: 0,
    };
  }
}
