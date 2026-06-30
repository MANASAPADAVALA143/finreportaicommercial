/**
 * UAE FTA VAT Return (Form 201) reconciliation — match AP invoices to boxes 1–11.
 * Box definitions align with GulfTax calculate_vat_return_boxes (FTA Form 201).
 */
import { supabase } from './supabase';
import { requireCompanyId } from './companyService';
import type { Invoice } from './supabase';
import { logAction, getInvoiceflowWorkEmail } from './auditService';

export type FtaVatBox = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11;

/** FTA VAT 201 box labels (matches backend vat_return.py). */
export const FTA_BOX_LABELS: Record<FtaVatBox, string> = {
  1: 'Box 1 — Standard rated supplies',
  2: 'Box 2 — VAT on supplies (5%)',
  3: 'Box 3 — Zero rated supplies',
  4: 'Box 4 — Exempt supplies',
  5: 'Box 5 — Total taxable supplies',
  6: 'Box 6 — Taxable expenses',
  7: 'Box 7 — VAT on expenses (5%)',
  8: 'Box 8 — VAT payable / refundable',
  9: 'Box 9 — Standard rated purchases',
  10: 'Box 10 — Zero rated purchases',
  11: 'Box 11 — Exempt purchases',
};

export interface FtaBoxTotal {
  box: FtaVatBox;
  taxable_value: number;
  vat_amount: number;
}

export interface FtaPurchaseLine {
  supplier_trn: string | null;
  supplier_name: string | null;
  invoice_number: string;
  invoice_date: string | null;
  taxable_value: number;
  vat_amount: number;
  box: FtaVatBox;
}

export interface FtaReturnSnapshot {
  quarter: string;
  company_trn: string;
  box_totals: FtaBoxTotal[];
  purchase_lines: FtaPurchaseLine[];
  uploaded_at: string;
}

export interface BoxReconSummary {
  box: FtaVatBox;
  label: string;
  books_taxable: number;
  books_vat: number;
  fta_taxable: number;
  fta_vat: number;
  variance_vat: number;
  matched: boolean;
}

const STORAGE_PREFIX = 'fta_vat_return_';
const VAT_TOLERANCE = 0.05;

export function uaeQuarterToDateRange(quarter: string): { start: string; end: string } {
  const m = /^Q([1-4])-(\d{4})$/.exec(quarter.trim());
  if (!m) {
    const d = new Date();
    const q = Math.floor(d.getMonth() / 3) + 1;
    return uaeQuarterToDateRange(`Q${q}-${d.getFullYear()}`);
  }
  const qn = Number(m[1]);
  const year = Number(m[2]);
  const startMonth = (qn - 1) * 3 + 1;
  const endMonth = startMonth + 2;
  const lastDay = new Date(year, endMonth, 0).getDate();
  return {
    start: `${year}-${String(startMonth).padStart(2, '0')}-01`,
    end: `${year}-${String(endMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
  };
}

function storageKey(quarter: string, trn: string): string {
  return `${STORAGE_PREFIX}${trn.trim()}_${quarter}`;
}

export function loadFtaReturn(quarter: string, companyTrn: string): FtaReturnSnapshot | null {
  try {
    const raw = localStorage.getItem(storageKey(quarter, companyTrn));
    if (!raw) return null;
    return JSON.parse(raw) as FtaReturnSnapshot;
  } catch {
    return null;
  }
}

export function saveFtaReturn(snapshot: FtaReturnSnapshot): void {
  localStorage.setItem(storageKey(snapshot.quarter, snapshot.company_trn), JSON.stringify(snapshot));
}

function invoiceVat(inv: Invoice): number {
  return Number(inv.vat_amount ?? inv.gst_amount ?? 0);
}

function invoiceTrn(inv: Invoice): string {
  return normTrn(inv.vendor_trn ?? inv.gstin);
}

function invoiceNet(inv: Invoice): number {
  const total = Number(inv.total_amount ?? 0);
  const vat = invoiceVat(inv);
  if (total > 0 && vat > 0) return total - vat;
  return Number(inv.subtotal_amount ?? inv.total_amount ?? 0) - vat;
}

function normTreatment(inv: Invoice): string {
  return String(inv.vat_treatment ?? 'standard_rated').toLowerCase().replace(/\s+/g, '_');
}

function isPurchase(inv: Invoice): boolean {
  const t = String(inv.invoice_type ?? 'purchase').toLowerCase();
  return t !== 'sale' && t !== 'sales' && t !== 'credit_note_sale';
}

/** Classify invoice to primary FTA VAT 201 box for display / line matching. */
export function classifyInvoiceToBox(inv: Invoice): FtaVatBox {
  const treatment = normTreatment(inv);
  const purchase = isPurchase(inv);

  if (purchase) {
    if (treatment.includes('reverse') || treatment === 'ae') return 6;
    if (treatment.includes('import')) return 6;
    if (treatment.includes('zero') || treatment === 'z') return 10;
    if (treatment.includes('exempt') || treatment === 'e') return 11;
    return 9;
  }

  if (treatment.includes('zero') || treatment === 'z') return 3;
  if (treatment.includes('exempt') || treatment === 'e') return 4;
  if (treatment.includes('reverse') || treatment === 'ae') return 6;
  return 1;
}

/** Aggregate books-side box totals from invoices (FTA Form 201 logic). */
export function aggregateBooksBoxes(invoices: Invoice[]): Map<FtaVatBox, { taxable: number; vat: number }> {
  const byBox = new Map<FtaVatBox, { taxable: number; vat: number }>();

  const add = (box: FtaVatBox, taxable: number, vat: number) => {
    const cur = byBox.get(box) ?? { taxable: 0, vat: 0 };
    cur.taxable += taxable;
    cur.vat += vat;
    byBox.set(box, cur);
  };

  for (const inv of invoices) {
    if (inv.gst_recon_status === 'ignored') continue;
    const net = invoiceNet(inv);
    const vat = invoiceVat(inv);
    const treatment = normTreatment(inv);
    const purchase = isPurchase(inv);

    if (purchase) {
      if (treatment.includes('reverse') || treatment === 'ae') {
        add(6, net, 0);
        add(7, 0, vat > 0 ? vat : net * 0.05);
      } else if (treatment.includes('import')) {
        add(6, net, 0);
        add(7, 0, vat > 0 ? vat : net * 0.05);
      } else if (treatment.includes('zero') || treatment === 'z') {
        add(10, net, 0);
      } else if (treatment.includes('exempt') || treatment === 'e') {
        add(11, net, 0);
      } else {
        add(9, net, 0);
        add(6, net, 0);
        add(7, 0, vat);
      }
    } else {
      if (treatment.includes('zero') || treatment === 'z') {
        add(3, net, 0);
      } else if (treatment.includes('exempt') || treatment === 'e') {
        add(4, net, 0);
      } else {
        add(1, net, 0);
        add(2, 0, vat);
      }
    }
  }

  const b1 = byBox.get(1)?.taxable ?? 0;
  const b3 = byBox.get(3)?.taxable ?? 0;
  const b4 = byBox.get(4)?.taxable ?? 0;
  add(5, b1 + b3 + b4, 0);

  const b2 = byBox.get(2)?.vat ?? 0;
  const b7 = byBox.get(7)?.vat ?? 0;
  add(8, 0, b2 - b7);

  return byBox;
}

function normTrn(t: string | null | undefined): string {
  return (t ?? '').replace(/\D/g, '');
}

function normInvNo(n: string | null | undefined): string {
  return (n ?? '').trim().toUpperCase().replace(/\s+/g, '');
}

/** Parse FTA VAT return CSV: box,taxable,vat OR detail lines with headers. */
export function parseFtaVatReturnCsv(text: string, quarter: string, companyTrn: string): FtaReturnSnapshot {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const boxTotals: FtaBoxTotal[] = [];
  const purchaseLines: FtaPurchaseLine[] = [];

  const header = lines[0]?.toLowerCase() ?? '';
  const isDetail = header.includes('invoice') || header.includes('supplier');

  for (let i = isDetail ? 1 : 0; i < lines.length; i++) {
    const cols = lines[i].split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
    if (cols.length < 2) continue;

    if (isDetail) {
      const [
        supplierTrn,
        supplierName,
        invoiceNumber,
        invoiceDate,
        taxable,
        vat,
        boxStr,
      ] = cols.length >= 7
        ? cols
        : ['', '', cols[0], cols[1], cols[2], cols[3], cols[4] ?? '9'];
      const box = Math.min(11, Math.max(1, Number(boxStr) || 9)) as FtaVatBox;
      if (!invoiceNumber) continue;
      purchaseLines.push({
        supplier_trn: supplierTrn || null,
        supplier_name: supplierName || null,
        invoice_number: invoiceNumber,
        invoice_date: invoiceDate || null,
        taxable_value: Number(taxable) || 0,
        vat_amount: Number(vat) || 0,
        box,
      });
    } else {
      const box = Math.min(11, Math.max(1, Number(cols[0]) || 0)) as FtaVatBox;
      if (!box) continue;
      boxTotals.push({
        box,
        taxable_value: Number(cols[1]) || 0,
        vat_amount: Number(cols[2] ?? cols[1]) || 0,
      });
    }
  }

  if (purchaseLines.length > 0 && boxTotals.length === 0) {
    for (let b = 1; b <= 11; b++) {
      const box = b as FtaVatBox;
      const rows = purchaseLines.filter((r) => r.box === box);
      if (rows.length === 0) continue;
      boxTotals.push({
        box,
        taxable_value: rows.reduce((s, r) => s + r.taxable_value, 0),
        vat_amount: rows.reduce((s, r) => s + r.vat_amount, 0),
      });
    }
  }

  return {
    quarter,
    company_trn: companyTrn.trim(),
    box_totals: boxTotals,
    purchase_lines: purchaseLines,
    uploaded_at: new Date().toISOString(),
  };
}

export async function uploadFtaReturn(snapshot: FtaReturnSnapshot): Promise<{ count: number }> {
  saveFtaReturn(snapshot);
  logAction('vat.fta_return_uploaded', 'fta_vat', null, getInvoiceflowWorkEmail(), {
    quarter: snapshot.quarter,
    boxes: snapshot.box_totals.length,
    lines: snapshot.purchase_lines.length,
  });
  return { count: snapshot.box_totals.length + snapshot.purchase_lines.length };
}

function findFtaLine(fta: FtaReturnSnapshot | null, inv: Invoice): FtaPurchaseLine | null {
  if (!fta?.purchase_lines.length) return null;
  const trn = invoiceTrn(inv);
  const num = normInvNo(inv.invoice_number);

  const exact = fta.purchase_lines.find(
    (l) =>
      normInvNo(l.invoice_number) === num &&
      (!trn || !l.supplier_trn || normTrn(l.supplier_trn) === trn)
  );
  if (exact) return exact;

  const vatBooks = invoiceVat(inv);
  const invDate = inv.invoice_date?.slice(0, 10);
  return (
    fta.purchase_lines.find((l) => {
      if (normInvNo(l.invoice_number) !== num) return false;
      if (Math.abs(vatBooks - l.vat_amount) > VAT_TOLERANCE) return false;
      if (invDate && l.invoice_date) {
        const d1 = new Date(invDate).getTime();
        const d2 = new Date(l.invoice_date).getTime();
        if (Math.abs(d1 - d2) > 3 * 86400000) return false;
      }
      return true;
    }) ?? null
  );
}

export async function runUaeVatReconciliation(
  quarter: string,
  companyTrn: string
): Promise<{ matched: number; mismatch: number; unmatched: number; period: string }> {
  const fta = loadFtaReturn(quarter, companyTrn);
  if (!fta?.box_totals.length && !fta?.purchase_lines.length) {
    throw new Error('Upload FTA VAT 201 return (box totals or purchase lines) before reconciling');
  }

  const { start, end } = uaeQuarterToDateRange(quarter);
  const company_id = await requireCompanyId();

  const { data: invoices, error } = await supabase
    .from('invoices')
    .select('*')
    .eq('company_id', company_id)
    .gte('invoice_date', start)
    .lte('invoice_date', end);
  if (error) throw error;

  let matched = 0;
  let mismatch = 0;
  let unmatched = 0;

  const relevant = ((invoices ?? []) as Invoice[]).filter(
    (inv) => invoiceVat(inv) > 0 || inv.vat_treatment || Number(inv.total_amount ?? 0) > 0
  );

  for (const inv of relevant) {
    const vatBooks = invoiceVat(inv);
    const ftaLine = findFtaLine(fta, inv);
    let status: Invoice['gst_recon_status'] = 'unmatched';

    if (ftaLine) {
      status = Math.abs(vatBooks - ftaLine.vat_amount) <= VAT_TOLERANCE ? 'matched' : 'mismatch';
    } else if (!fta.purchase_lines.length) {
      const box = classifyInvoiceToBox(inv);
      const declared = fta.box_totals.find((b) => b.box === box);
      if (declared && vatBooks > 0 && declared.vat_amount > 0) {
        const booksAgg = aggregateBooksBoxes(relevant);
        const booksVat = booksAgg.get(box)?.vat ?? vatBooks;
        status = Math.abs(booksVat - declared.vat_amount) <= VAT_TOLERANCE ? 'matched' : 'mismatch';
      }
    }

    if (status === 'matched') matched++;
    else if (status === 'mismatch') mismatch++;
    else unmatched++;

    await supabase
      .from('invoices')
      .update({ gst_recon_status: status, updated_at: new Date().toISOString() })
      .eq('id', inv.id);
  }

  const result = { matched, mismatch, unmatched, period: quarter };
  logAction('vat.reconciled', 'fta_vat', null, getInvoiceflowWorkEmail(), result);
  return result;
}

export async function getUaeVatReconInvoices(quarter: string): Promise<Invoice[]> {
  const { start, end } = uaeQuarterToDateRange(quarter);
  const company_id = await requireCompanyId();
  const { data, error } = await supabase
    .from('invoices')
    .select('*')
    .eq('company_id', company_id)
    .gte('invoice_date', start)
    .lte('invoice_date', end)
    .order('invoice_date', { ascending: false });
  if (error) throw error;
  return ((data ?? []) as Invoice[]).filter(
    (inv) => invoiceVat(inv) > 0 || inv.vat_treatment || Number(inv.total_amount ?? 0) > 0
  );
}

export async function getUaeVatReconSummary(quarter: string): Promise<{
  matched: number;
  mismatch: number;
  unmatched: number;
  ignored: number;
  total: number;
}> {
  const rows = await getUaeVatReconInvoices(quarter);
  return {
    matched: rows.filter((r) => r.gst_recon_status === 'matched').length,
    mismatch: rows.filter((r) => r.gst_recon_status === 'mismatch').length,
    unmatched: rows.filter((r) => r.gst_recon_status === 'unmatched' || r.gst_recon_status == null).length,
    ignored: rows.filter((r) => r.gst_recon_status === 'ignored').length,
    total: rows.length,
  };
}

export async function ignoreUaeVatMismatch(invoiceId: string): Promise<void> {
  const { error } = await supabase
    .from('invoices')
    .update({ gst_recon_status: 'ignored', updated_at: new Date().toISOString() })
    .eq('id', invoiceId);
  if (error) throw error;
}

export function computeBoxSummaries(
  quarter: string,
  companyTrn: string,
  invoices: Invoice[]
): BoxReconSummary[] {
  const fta = loadFtaReturn(quarter, companyTrn);
  const byBox = aggregateBooksBoxes(invoices);

  const boxes: FtaVatBox[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  return boxes.map((box) => {
    const books = byBox.get(box) ?? { taxable: 0, vat: 0 };
    const ftaBox = fta?.box_totals.find((b) => b.box === box);
    const ftaVat = ftaBox?.vat_amount ?? 0;
    const ftaTaxable = ftaBox?.taxable_value ?? 0;
    const variance = books.vat - ftaVat;
    const varianceTaxable = books.taxable - ftaTaxable;
    const hasFta = Boolean(fta?.box_totals.length);
    const vatMatch = Math.abs(variance) <= VAT_TOLERANCE || (books.vat === 0 && ftaVat === 0);
    const taxableMatch =
      Math.abs(varianceTaxable) <= VAT_TOLERANCE || (books.taxable === 0 && ftaTaxable === 0);
    return {
      box,
      label: FTA_BOX_LABELS[box],
      books_taxable: books.taxable,
      books_vat: books.vat,
      fta_taxable: ftaTaxable,
      fta_vat: ftaVat,
      variance_vat: variance,
      matched: hasFta ? vatMatch && taxableMatch : false,
    };
  });
}
