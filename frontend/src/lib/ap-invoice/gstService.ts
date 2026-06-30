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
}> {
  const { start, end } = periodToDateRange(period);
  const { data, error } = await supabase
    .from('invoices')
    .select('gst_recon_status, gst_amount')
    .gte('invoice_date', start)
    .lte('invoice_date', end)
    .gt('gst_amount', 0);
  if (error) throw error;
  const rows = data ?? [];
  return {
    matched: rows.filter((r) => r.gst_recon_status === 'matched').length,
    mismatch: rows.filter((r) => r.gst_recon_status === 'mismatch').length,
    unmatched: rows.filter((r) => r.gst_recon_status === 'unmatched' || r.gst_recon_status == null).length,
    ignored: rows.filter((r) => r.gst_recon_status === 'ignored').length,
    total: rows.length,
  };
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