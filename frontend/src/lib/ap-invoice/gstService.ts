import { supabase } from './supabase';
import { requireCompanyId } from './companyService';
import type { Gstr2bEntry, Invoice } from './supabase';
import { logAction, getInvoiceflowWorkEmail } from './auditService';

export function periodToDateRange(period: string): { start: string; end: string } {
  const [y, m] = period.split('-').map((x) => parseInt(x, 10));
  if (!y || !m) {
    const d = new Date();
    const yy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return periodToDateRange(`${yy}-${mm}`);
  }
  const last = new Date(y, m, 0).getDate();
  return {
    start: `${period}-01`,
    end: `${period}-${String(last).padStart(2, '0')}`,
  };
}

function parseGstDate(dt: string): string | null {
  if (!dt || typeof dt !== 'string') return null;
  const parts = dt.split('-');
  if (parts.length === 3 && parts[0].length === 2 && parts[2].length === 4) {
    return `${parts[2]}-${parts[1]}-${parts[0]}`;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(dt)) return dt.slice(0, 10);
  return dt;
}

export type Gstr2bInsertRow = Omit<Gstr2bEntry, 'id' | 'total_gst' | 'matched_invoice_id' | 'created_at'>;

/** Parse GSTR-2B JSON — unknown shape returns []. */
export function parseGstr2bJson(raw: unknown, companyGstin: string, period: string): Gstr2bInsertRow[] {
  const entries: Gstr2bInsertRow[] = [];

  try {
    const root = raw as Record<string, unknown>;
    const docDetails = (root?.data as Record<string, unknown> | undefined)?.docDetails ?? root?.docDetails;
    if (Array.isArray(docDetails)) {
      for (const supplier of docDetails as Array<Record<string, unknown>>) {
        const invoices = (supplier.invoices as Array<Record<string, unknown>> | undefined) ?? [];
        for (const inv of invoices) {
          entries.push({
            company_gstin: companyGstin,
            supplier_gstin: (supplier.ctin as string) ?? null,
            supplier_name: ((supplier.tradeName ?? supplier.legalName) as string) ?? null,
            invoice_number: (inv.inum as string) ?? null,
            invoice_date: inv.dt ? parseGstDate(String(inv.dt)) : null,
            taxable_value: Number(inv.val ?? 0),
            igst: Number(inv.itxamt ?? 0),
            cgst: Number(inv.ctxamt ?? 0),
            sgst: Number(inv.stxamt ?? 0),
            filing_period: period,
          });
        }
      }
    }

    if (entries.length === 0 && Array.isArray(raw)) {
      for (const row of raw as Array<Record<string, unknown>>) {
        entries.push({
          company_gstin: companyGstin,
          supplier_gstin: (row.supplier_gstin ?? row.GSTIN) as string | null,
          supplier_name: (row.supplier_name ?? row.TradeName) as string | null,
          invoice_number: (row.invoice_number ?? row.InvoiceNo) as string | null,
          invoice_date: (row.invoice_date as string) ?? null,
          taxable_value: Number(row.taxable_value ?? row.TaxableValue ?? 0),
          igst: Number(row.igst ?? row.IGST ?? 0),
          cgst: Number(row.cgst ?? row.CGST ?? 0),
          sgst: Number(row.sgst ?? row.SGST ?? 0),
          filing_period: period,
        });
      }
    }

    // b2b-style: data.docdata.b2b[] or data.b2b[].inv[] (portal JSON uses idt + itms[].itm_det)
    if (entries.length === 0 && root?.data && typeof root.data === 'object') {
      const dataObj = root.data as Record<string, unknown>;
      const doc = dataObj.docdata as Record<string, unknown> | undefined;
      const b2b = (Array.isArray(doc?.b2b) ? doc.b2b : dataObj.b2b) as unknown;
      if (Array.isArray(b2b)) {
        for (const bucket of b2b as Array<Record<string, unknown>>) {
          const invList = (bucket.inv as Array<Record<string, unknown>> | undefined) ?? [];
          for (const inv of invList) {
            const itms = inv.itms as Array<Record<string, unknown>> | undefined;
            const det =
              Array.isArray(itms) && itms.length > 0
                ? ((itms[0]?.itm_det as Record<string, unknown> | undefined) ?? undefined)
                : undefined;
            const txFromLine = det != null ? Number(det.txval ?? NaN) : NaN;
            const igFromLine = det != null ? Number(det.iamt ?? 0) : 0;
            const cgFromLine = det != null ? Number(det.camt ?? 0) : 0;
            const sgFromLine = det != null ? Number(det.samt ?? 0) : 0;
            const dateRaw = inv.idt ?? inv.dt;
            entries.push({
              company_gstin: companyGstin,
              supplier_gstin: (bucket.ctin as string) ?? null,
              supplier_name: (bucket.cname as string) ?? ((bucket.tradeName ?? bucket.legalName) as string) ?? null,
              invoice_number: (inv.inum as string) ?? null,
              invoice_date: dateRaw ? parseGstDate(String(dateRaw)) : null,
              taxable_value: Number.isFinite(txFromLine) ? txFromLine : Number(inv.val ?? 0),
              igst: igFromLine || Number(inv.itx ?? inv.iamt ?? 0),
              cgst: cgFromLine || Number(inv.camt ?? inv.ctxamt ?? 0),
              sgst: sgFromLine || Number(inv.samt ?? inv.stxamt ?? 0),
              filing_period: period,
            });
          }
        }
      }
    }
  } catch {
    return [];
  }

  return entries;
}

export async function uploadGstr2bEntries(
  rows: Gstr2bInsertRow[],
  period: string,
  companyGstin: string
): Promise<{ count: number }> {
  const company_id = await requireCompanyId();
  const { error: delErr } = await supabase
    .from('gstr2b_entries')
    .delete()
    .eq('filing_period', period)
    .eq('company_gstin', companyGstin)
    .eq('company_id', company_id);
  if (delErr) throw delErr;

  if (rows.length === 0) return { count: 0 };
  const { error } = await supabase.from('gstr2b_entries').insert(rows.map((r) => ({ ...r, company_id })));
  if (error) throw error;
  logAction('gst.gstr2b_uploaded', 'gstr2b', null, getInvoiceflowWorkEmail(), {
    count: rows.length,
    period,
  });
  return { count: rows.length };
}

export async function runGstReconciliation(
  period: string,
  companyGstin: string
): Promise<{ matched: number; mismatch: number; unmatched: number; period: string }> {
  const { data, error } = await supabase.rpc('reconcile_gst_period', {
    p_period: period,
    p_company_gstin: companyGstin.trim(),
  });
  if (error) throw error;
  const o = (data as Record<string, number | string>) || {};
  const result = {
    matched: Number(o.matched ?? 0),
    mismatch: Number(o.mismatch ?? 0),
    unmatched: Number(o.unmatched ?? 0),
    period: String(o.period ?? period),
  };
  logAction('gst.reconciled', 'gstr2b', null, getInvoiceflowWorkEmail(), { ...result });
  return result;
}

/** Invoices in period with GST amount — all recon statuses (for GST Recon table). */
export async function getGstReconInvoices(period: string): Promise<Invoice[]> {
  const { start, end } = periodToDateRange(period);
  const { data, error } = await supabase
    .from('invoices')
    .select('*')
    .gte('invoice_date', start)
    .lte('invoice_date', end)
    .gt('gst_amount', 0)
    .order('invoice_date', { ascending: false });
  if (error) throw error;
  return (data || []) as Invoice[];
}

export async function ignoreGstMismatch(invoiceId: string): Promise<void> {
  const { error } = await supabase.from('invoices').update({ gst_recon_status: 'ignored' }).eq('id', invoiceId);
  if (error) throw error;
}

export async function getGstReconSummary(period: string): Promise<{
  matched: number;
  mismatch: number;
  unmatched: number;
  ignored: number;
  total: number;
  missing_gstin: number;
  itc_eligible: number;
  itc_blocked: number;
  tds_payable: number;
}> {
  const { start, end } = periodToDateRange(period);
  const { data, error } = await supabase
    .from('invoices')
    .select(
      'gst_recon_status, gst_amount, gstin, reverse_charge, hsn_sac_code, ifrs_category, description, tds_amount'
    )
    .gte('invoice_date', start)
    .lte('invoice_date', end);
  if (error) throw error;
  const rows = data ?? [];
  const withTax = rows.filter((r) => Number(r.gst_amount || 0) > 0);
  let itcEligible = 0;
  let itcBlocked = 0;
  let tdsPayable = 0;
  let missingGstin = 0;
  for (const r of rows) {
    const gst = Number(r.gst_amount || 0);
    tdsPayable += Number(r.tds_amount || 0);
    if (!String(r.gstin || '').trim() && gst > 0) missingGstin += 1;
    if (gst <= 0) continue;
    if (isItcBlocked(r)) itcBlocked += gst;
    else itcEligible += gst;
  }
  return {
    matched: withTax.filter((r) => r.gst_recon_status === 'matched').length,
    mismatch: withTax.filter((r) => r.gst_recon_status === 'mismatch').length,
    unmatched: withTax.filter((r) => r.gst_recon_status === 'unmatched' || r.gst_recon_status == null).length,
    ignored: withTax.filter((r) => r.gst_recon_status === 'ignored').length,
    total: withTax.length,
    missing_gstin: missingGstin,
    itc_eligible: Math.round(itcEligible * 100) / 100,
    itc_blocked: Math.round(itcBlocked * 100) / 100,
    tds_payable: Math.round(tdsPayable * 100) / 100,
  };
}

/** Sec 17(5) heuristic — motor vehicles, entertainment, food & beverages, personal. */
function isItcBlocked(inv: {
  reverse_charge?: boolean | null;
  hsn_sac_code?: string | null;
  ifrs_category?: string | null;
  description?: string | null;
}): boolean {
  const text = `${inv.ifrs_category || ''} ${inv.description || ''} ${inv.hsn_sac_code || ''}`.toLowerCase();
  const blockedHints = [
    'motor vehicle',
    'car ',
    'entertainment',
    'food',
    'beverage',
    'restaurant',
    'club',
    'personal',
    'sec 17',
  ];
  return blockedHints.some((h) => text.includes(h));
}

export async function fetchGstr2bByMatchedInvoice(invoiceId: string): Promise<Gstr2bEntry | null> {
  const { data, error } = await supabase.from('gstr2b_entries').select('*').eq('matched_invoice_id', invoiceId).maybeSingle();
  if (error) throw error;
  return (data as Gstr2bEntry) ?? null;
}

export async function fetchGstr2bBySupplierAndInvoice(
  companyGstin: string,
  period: string,
  supplierGstin: string | null | undefined,
  invoiceNumber: string | null | undefined
): Promise<Gstr2bEntry | null> {
  if (!supplierGstin?.trim() || !invoiceNumber?.trim()) return null;
  const { data, error } = await supabase
    .from('gstr2b_entries')
    .select('*')
    .eq('company_gstin', companyGstin.trim())
    .eq('filing_period', period)
    .eq('invoice_number', invoiceNumber.trim())
    .ilike('supplier_gstin', supplierGstin.trim())
    .maybeSingle();
  if (error) return null;
  return (data as Gstr2bEntry) ?? null;
}

/** Upsert vendor by normalized name; returns row. */
export async function upsertVendorGstin(name: string, gstin: string | null): Promise<void> {
  const n = name.trim();
  if (!n) return;
  const { data: existing } = await supabase.from('vendors').select('id').ilike('name', n).maybeSingle();
  if (existing?.id) {
    const { error } = await supabase
      .from('vendors')
      .update({ gstin: gstin?.trim() || null, updated_at: new Date().toISOString() })
      .eq('id', existing.id);
    if (error) throw error;
  } else {
    const company_id = await requireCompanyId();
    const { error } = await supabase.from('vendors').insert({
      company_id,
      name: n,
      gstin: gstin?.trim() || null,
      updated_at: new Date().toISOString(),
    });
    if (error) throw error;
  }
}

/** Copy vendor GSTIN onto invoices with same vendor name where invoice.gstin is empty. */
export async function applyVendorGstinToInvoicesForName(vendorName: string): Promise<void> {
  const n = vendorName.trim();
  if (!n) return;
  const { data: v } = await supabase.from('vendors').select('gstin').ilike('name', n).maybeSingle();
  const g = v?.gstin?.trim();
  if (!g) return;
  const { data: rows } = await supabase.from('invoices').select('id').ilike('vendor_name', n).is('gstin', null);
  if (!rows?.length) return;
  await supabase
    .from('invoices')
    .update({ gstin: g })
    .in(
      'id',
      rows.map((r) => r.id)
    );
}

export async function updateInvoiceGstFields(
  invoiceId: string,
  patch: Partial<Pick<Invoice, 'gstin' | 'gst_amount' | 'cgst' | 'sgst' | 'igst'>>
): Promise<void> {
  const { error } = await supabase
    .from('invoices')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', invoiceId);
  if (error) throw error;
}

export async function listVendorsFromTable(): Promise<
  Array<{
    id: string;
    name: string;
    gstin: string | null;
    updated_at: string;
    risk_level?: string | null;
    risk_score?: number | null;
    bank_verification_status?: string | null;
  }>
> {
  const { data, error } = await supabase
    .from('vendors')
    .select('id, name, gstin, updated_at, risk_level, risk_score, bank_verification_status')
    .order('name', { ascending: true });
  if (error) throw error;
  return (data || []) as Array<{
    id: string;
    name: string;
    gstin: string | null;
    updated_at: string;
    risk_level?: string | null;
    risk_score?: number | null;
    bank_verification_status?: string | null;
  }>;
}

// ── Demo GST invoices (AP InvoiceFlow "Invoice List") ─────────────────────
//
// The India Accounting module's own Purchase/Sales Invoices pages have
// their own demo seed (POST /api/india/demo/seed, FastAPI backend). This
// seeds the SAME five vendors/amounts/GSTINs directly into AP InvoiceFlow's
// `invoices` table (Supabase) so this list also shows GST-flavored records
// during the demo — these are two genuinely separate data stores, so each
// needs its own seed.

const DEMO_GST_VENDORS = [
  { name: 'Tata Consultancy Services Ltd', gstin: '27AAACT2727Q1ZW', hsn: '998314', desc: 'IT Consulting Services' },
  { name: 'Reliance Industries Ltd',        gstin: '27AAACR5055K1Z4', hsn: '271000', desc: 'Petroleum Products Supply' },
  { name: 'Infosys Ltd',                    gstin: '29AABCI1681B1ZN', hsn: '998313', desc: 'Software Development Services' },
  { name: 'Amazon India',                   gstin: '29AAGCS8989F1Z9', hsn: '996111', desc: 'Cloud Hosting & Marketplace' },
  { name: 'HDFC Bank Ltd',                  gstin: '27AAACH2702H1ZC', hsn: '997120', desc: 'Banking & Processing Fees' },
];

const DEMO_GST_AMOUNTS: Array<{ supply: 'intra' | 'inter'; taxable: number; cgst: number; sgst: number; igst: number }> = [
  { supply: 'intra', taxable: 100000, cgst: 9000, sgst: 9000, igst: 0 },
  { supply: 'inter', taxable: 200000, cgst: 0,    sgst: 0,    igst: 36000 },
  { supply: 'intra', taxable: 50000,  cgst: 4500, sgst: 4500, igst: 0 },
  { supply: 'inter', taxable: 40000,  cgst: 0,    sgst: 0,    igst: 7200 },
  { supply: 'intra', taxable: 20000,  cgst: 1800, sgst: 1800, igst: 0 },
];

/** Seed 5 GST purchase invoices into AP InvoiceFlow's own invoice list (idempotent). */
export async function seedDemoGstInvoices(): Promise<{ seeded: number; message: string }> {
  const company_id = await requireCompanyId();

  const { count: existing } = await supabase
    .from('invoices')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', company_id)
    .like('invoice_number', 'GST-INV-%');
  if ((existing ?? 0) >= DEMO_GST_VENDORS.length) {
    return { seeded: 0, message: 'GST demo invoices already present' };
  }

  const today = new Date();
  const yyyymm = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}`;
  const rows = DEMO_GST_VENDORS.map((v, i) => {
    const amt = DEMO_GST_AMOUNTS[i];
    const totalGst = amt.cgst + amt.sgst + amt.igst;
    const total = amt.taxable + totalGst;
    const invDate = new Date(today);
    invDate.setDate(Math.max(1, invDate.getDate() - (i * 5 + 3)));
    const dueDate = new Date(invDate);
    dueDate.setDate(dueDate.getDate() + 30);

    return {
      invoice_number: `GST-INV-${yyyymm}-${String(i + 1).padStart(3, '0')}`,
      invoice_date: invDate.toISOString().slice(0, 10),
      due_date: dueDate.toISOString().slice(0, 10),
      vendor_name: v.name,
      vendor_email: null,
      vendor_phone: null,
      vendor_address: null,
      total_amount: total,
      currency: 'INR',
      gstin: v.gstin,
      vendor_gstin: v.gstin,
      cgst_amount: amt.cgst,
      sgst_amount: amt.sgst,
      igst_amount: amt.igst,
      tax_type: 'GST' as const,
      tax_amount: totalGst,
      subtotal_amount: amt.taxable,
      taxable_amount: amt.taxable,
      hsn_sac: v.hsn,
      description: v.desc,
      ifrs_category: 'operating_expense',
      status: 'Approved' as const,
      source: 'manual' as const,
      invoice_type: 'purchase' as const,
      payment_received: false,
      company_id,
      file_type: 'seed-demo',
      file_url: null,
      updated_at: new Date().toISOString(),
    };
  });

  const { error } = await supabase.from('invoices').insert(rows);
  if (error) throw error;

  logAction('invoice.created', 'invoices', null, getInvoiceflowWorkEmail(), { seeded_gst_demo: true, count: rows.length });
  return { seeded: rows.length, message: `Seeded ${rows.length} GST demo invoices` };
}