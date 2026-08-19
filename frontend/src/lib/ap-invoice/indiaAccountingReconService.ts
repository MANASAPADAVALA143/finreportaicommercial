/**
 * GST Reconciliation — India Accounting module source
 * ====================================================
 * The GST Recon page (GstRecon.tsx) historically read invoices from the
 * AP InvoiceFlow Supabase `invoices` table via gstService.ts. Purchase
 * invoices created in the India Accounting module (IndiaPurchaseInvoices.tsx)
 * live in a separate store — the FastAPI `india_purchase_invoices` table —
 * so they never appeared here.
 *
 * This adapter reads from the India Accounting backend (via
 * indiaAccounting.service.ts) and matches against the same Supabase
 * `gstr2b_entries` table used by the GSTR-2B upload flow, producing the
 * same Invoice-shaped rows GstRecon.tsx already knows how to render.
 */
import type { Invoice } from './supabase';
import { supabase } from './supabase';
import * as indiaSvc from '../../services/indiaAccounting.service';
import type { DemoInvoiceDetail } from '../../services/indiaAccounting.service';
import { uploadGstr2bEntries, type Gstr2bInsertRow } from './gstService';

type ReconStatus = 'matched' | 'mismatch' | 'unmatched' | 'ignored';

// In-memory ignore-list (India Accounting purchase invoices have no
// gst_recon_status column on the backend model — this mirrors that state
// for the current session only, same as other client-only demo affordances).
const ignoredIds = new Set<string>();

const AMOUNT_TOLERANCE = 1.0; // ₹1 tolerance for matching

function periodToRange(period: string): { start: string; end: string } {
  const [y, m] = period.split('-').map((x) => parseInt(x, 10));
  const last = new Date(y, m, 0).getDate();
  return { start: `${period}-01`, end: `${period}-${String(last).padStart(2, '0')}` };
}

interface IndiaReconRow {
  id: string;
  invoice_number: string;
  invoice_date: string;
  vendor_name: string;
  vendor_gstin: string;
  gst_amount: number;
  status: ReconStatus;
}

async function buildReconRows(period: string, companyGstin: string): Promise<IndiaReconRow[]> {
  const [invRes, vendorRes] = await Promise.all([
    indiaSvc.listPurchaseInvoices({ status: 'posted' }),
    indiaSvc.listIndiaVendors(),
  ]);

  const vendorById = new Map(vendorRes.vendors.map((v) => [v.id, v]));
  const invoicesInPeriod = invRes.invoices.filter((inv) => inv.invoice_date?.slice(0, 7) === period);

  if (invoicesInPeriod.length === 0) return [];

  const { data: gstr2bRows, error } = await supabase
    .from('gstr2b_entries')
    .select('*')
    .eq('filing_period', period)
    .eq('company_gstin', companyGstin.trim());
  if (error) throw error;

  const gstr2bBySupplierInvoice = new Map<string, { taxable_value: number; igst: number; cgst: number; sgst: number }>();
  for (const row of gstr2bRows ?? []) {
    const key = `${(row.supplier_gstin || '').trim().toUpperCase()}::${(row.invoice_number || '').trim().toUpperCase()}`;
    gstr2bBySupplierInvoice.set(key, {
      taxable_value: Number(row.taxable_value || 0),
      igst: Number(row.igst || 0),
      cgst: Number(row.cgst || 0),
      sgst: Number(row.sgst || 0),
    });
  }

  return invoicesInPeriod.map((inv) => {
    const vendor = vendorById.get(inv.vendor_id);
    const vendorGstin = (vendor?.gstin || '').trim().toUpperCase();
    const key = `${vendorGstin}::${inv.invoice_number.trim().toUpperCase()}`;
    const gstr2b = gstr2bBySupplierInvoice.get(key);

    const gstAmount = inv.cgst_amount + inv.sgst_amount + inv.igst_amount;
    let status: ReconStatus;

    if (ignoredIds.has(inv.id)) {
      status = 'ignored';
    } else if (!gstr2b) {
      status = 'unmatched';
    } else {
      const gstr2bTax = gstr2b.igst + gstr2b.cgst + gstr2b.sgst;
      const taxableMatch = Math.abs(gstr2b.taxable_value - inv.subtotal) <= AMOUNT_TOLERANCE;
      const taxMatch = Math.abs(gstr2bTax - gstAmount) <= AMOUNT_TOLERANCE;
      status = taxableMatch && taxMatch ? 'matched' : 'mismatch';
    }

    return {
      id: inv.id,
      invoice_number: inv.invoice_number,
      invoice_date: inv.invoice_date,
      vendor_name: vendor?.name ?? '(unknown vendor)',
      vendor_gstin: vendor?.gstin ?? '',
      gst_amount: gstAmount,
      status,
    };
  });
}

/** Invoice-shaped rows for GstRecon.tsx table — India Accounting source. */
export async function getIndiaAccountingReconInvoices(period: string, companyGstin: string): Promise<Invoice[]> {
  const rows = await buildReconRows(period, companyGstin);
  // Only the fields GstRecon.tsx actually reads are populated with real data;
  // the rest of the Invoice shape is stubbed since this table doesn't carry
  // the AP-invoice-specific metadata (approvals, matching, GL codes, etc).
  return rows.map((r) => ({
    id: r.id,
    invoice_number: r.invoice_number,
    invoice_date: r.invoice_date,
    vendor_name: r.vendor_name,
    gstin: r.vendor_gstin,
    gst_amount: r.gst_amount,
    gst_recon_status: r.status,
    currency: 'INR',
    _source: 'india_accounting',
  }) as unknown as Invoice);
}

export async function getIndiaAccountingReconSummary(period: string, companyGstin: string) {
  const rows = await buildReconRows(period, companyGstin);
  const missingGstin = rows.filter((r) => !r.vendor_gstin).length;
  return {
    matched: rows.filter((r) => r.status === 'matched').length,
    mismatch: rows.filter((r) => r.status === 'mismatch').length,
    unmatched: rows.filter((r) => r.status === 'unmatched').length,
    ignored: rows.filter((r) => r.status === 'ignored').length,
    total: rows.length,
    missing_gstin: missingGstin,
    itc_eligible: 0,
    itc_blocked: 0,
    tds_payable: 0,
  };
}

export async function runIndiaAccountingReconciliation(
  period: string,
  companyGstin: string
): Promise<{ matched: number; mismatch: number; unmatched: number; period: string }> {
  const rows = await buildReconRows(period, companyGstin);
  return {
    matched: rows.filter((r) => r.status === 'matched').length,
    mismatch: rows.filter((r) => r.status === 'mismatch').length,
    unmatched: rows.filter((r) => r.status === 'unmatched').length,
    period,
  };
}

export async function ignoreIndiaAccountingMismatch(invoiceId: string): Promise<void> {
  ignoredIds.add(invoiceId);
}

// ── Demo GSTR-2B seed ──────────────────────────────────────────────────────

/**
 * Seed a matching GSTR-2B dataset for the demo purchase invoices —
 * 3 exact matches, 1 deliberate mismatch, 1 left absent (unmatched).
 * Mirrors the invoices created by POST /api/india/demo/seed.
 */
export async function seedDemoGstr2bEntries(
  period: string,
  companyGstin: string,
  demoInvoices: DemoInvoiceDetail[]
): Promise<{ count: number }> {
  if (demoInvoices.length < 4) return { count: 0 };

  // demoInvoices order: [0]=TCS intra, [1]=Reliance inter, [2]=Infosys intra,
  // [3]=Amazon inter, [4]=HDFC intra (per DEMO_INVOICES in the backend seed).
  const [tcs, reliance, infosys /* , amazon left unmatched */, , hdfc] = demoInvoices;

  const exactMatch = (inv: DemoInvoiceDetail): Gstr2bInsertRow => ({
    company_gstin: companyGstin,
    supplier_gstin: inv.vendor_gstin,
    supplier_name: inv.vendor_name,
    invoice_number: inv.invoice_number,
    invoice_date: `${period}-01`,
    taxable_value: inv.subtotal,
    igst: inv.igst_amount,
    cgst: inv.cgst_amount,
    sgst: inv.sgst_amount,
    filing_period: period,
  });

  const rows: Gstr2bInsertRow[] = [
    exactMatch(tcs),
    exactMatch(infosys),
    exactMatch(hdfc),
    // Reliance: deliberate mismatch — supplier under-reported taxable value in 2B
    {
      ...exactMatch(reliance),
      taxable_value: reliance.subtotal - 5000, // ₹5,000 short → flags as mismatch
    },
    // Amazon intentionally omitted → shows as "unmatched"
  ];

  return uploadGstr2bEntries(rows, period, companyGstin);
}
