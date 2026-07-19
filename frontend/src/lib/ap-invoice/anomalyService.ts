import { supabase } from './supabase';
import type { InvoiceAnomaly } from './supabase';
import { requireCompanyId } from './companyService';
import { logApAudit } from './apAuditService';
import { joinApiUrl } from '@/utils/backendOrigin';
import { detectAnomalies } from '@/utils/anomalyDetection';

export type AnomalyEngineFlag = {
  anomaly_type: string;
  detection_method: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  risk_score: number;
  flag_code: string;
  flag_reason: string;
  flag_details?: Record<string, unknown>;
};

export type AnomalyEngineResult = {
  overall_risk_score: number;
  flags: AnomalyEngineFlag[];
  vendor_stats?: Record<string, number>;
  statistical_context?: string | null;
};

const ANOMALY_API = joinApiUrl('/api/ap/detect-anomalies');

export async function runAnomalyEngine(payload: {
  invoice: Record<string, unknown>;
  vendor_history: Record<string, unknown>[];
  vendor?: Record<string, unknown>;
  approval_threshold?: number;
}): Promise<AnomalyEngineResult> {
  try {
    const resp = await fetch(ANOMALY_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (resp.ok) return (await resp.json()) as AnomalyEngineResult;
  } catch {
    /* fall through to client-side rules */
  }
  return runClientAnomalyFallback(payload);
}

/** Lightweight fallback when Python API unavailable. */
function runClientAnomalyFallback(payload: {
  invoice: Record<string, unknown>;
  vendor_history: Record<string, unknown>[];
  vendor?: Record<string, unknown>;
  approval_threshold?: number;
}): AnomalyEngineResult {
  const threshold = payload.approval_threshold ?? 10_000;
  const amount = Number(payload.invoice.total_amount ?? 0);
  const flags: AnomalyEngineFlag[] = [];
  const history = payload.vendor_history ?? [];
  const vendorName = String(payload.invoice.vendor_name ?? '').trim().toLowerCase();
  const sameVendor = history.filter(
    (h) => String(h.vendor_name ?? '').trim().toLowerCase() === vendorName && vendorName,
  );
  const amounts = sameVendor.map((h) => Number(h.total_amount ?? 0)).filter((a) => a > 0);
  const avg = amounts.length ? amounts.reduce((s, a) => s + a, 0) / amounts.length : 0;
  const rawStd =
    amounts.length > 1
      ? Math.sqrt(amounts.reduce((s, a) => s + (a - avg) ** 2, 0) / (amounts.length - 1))
      : 0;
  const stdFloor = Math.max(Math.abs(avg) * 0.05, 1);
  const std = Math.max(rawStd, stdFloor);
  const sampleN = amounts.length;
  const MIN_ZSCORE_HISTORY = 5;
  const AMOUNT_AVG_MULTIPLE = 3;

  if (sampleN >= MIN_ZSCORE_HISTORY && avg > 0) {
    const z = (amount - avg) / std;
    if (z > 2.5) {
      flags.push({
        anomaly_type: 'statistical',
        detection_method: 'zscore',
        severity: 'high',
        risk_score: Math.min(100, 40 + Math.min(Math.abs(z), 6) * 10),
        flag_code: 'AMOUNT_HIGH_ZSCORE',
        flag_reason: `Unusually high amount for this vendor (z=${z.toFixed(2)})`,
        flag_details: { z_score: z, vendor_avg: avg, vendor_std: std, sample_count: sampleN },
      });
    }
  } else if (sampleN >= 1 && avg > 0) {
    const ratio = amount / avg;
    if (ratio >= AMOUNT_AVG_MULTIPLE) {
      flags.push({
        anomaly_type: 'statistical',
        detection_method: 'amount_multiple',
        severity: 'medium',
        risk_score: 40,
        flag_code: 'AMOUNT_HIGH_VS_AVG',
        flag_reason: `Amount is ${ratio.toFixed(1)}× vendor average (only ${sampleN} prior invoice${sampleN !== 1 ? 's' : ''} — z-score skipped)`,
        flag_details: {
          amount_vs_avg_ratio: ratio,
          vendor_avg: avg,
          sample_count: sampleN,
          threshold_multiple: AMOUNT_AVG_MULTIPLE,
        },
      });
    }
  }
  if (amount >= threshold * 0.95 && amount < threshold) {
    flags.push({
      anomaly_type: 'rule_based',
      detection_method: 'just_below_threshold',
      severity: 'high',
      risk_score: 65,
      flag_code: 'JUST_BELOW_THRESHOLD',
      flag_reason: 'Amount just below approval threshold — review required',
      flag_details: { amount, threshold },
    });
  }
  const vendorAge = Number(payload.vendor?.vendor_age_days ?? 999);
  if (vendorAge < 60 && amount > 100_000) {
    flags.push({
      anomaly_type: 'rule_based',
      detection_method: 'new_vendor_high_amount',
      severity: 'critical',
      risk_score: 85,
      flag_code: 'NEW_VENDOR_HIGH_AMOUNT',
      flag_reason: 'New vendor, high value — enhanced due diligence required',
      flag_details: { vendor_age_days: vendorAge, amount },
    });
  }
  if (payload.vendor?.flag_ghost_vendor || payload.vendor?.placeholder_trn) {
    flags.push({
      anomaly_type: 'rule_based',
      detection_method: 'ghost_vendor',
      severity: 'critical',
      risk_score: 90,
      flag_code: 'GHOST_VENDOR',
      flag_reason: 'Vendor not found in Vendor Master (or placeholder TRN) — treat as ghost vendor',
      flag_details: {
        in_vendor_master: payload.vendor?.in_vendor_master,
        placeholder_trn: payload.vendor?.placeholder_trn,
      },
    });
  }
  if (payload.vendor?.trn_mismatch) {
    flags.push({
      anomaly_type: 'rule_based',
      detection_method: 'vendor_identity_mismatch',
      severity: 'critical',
      risk_score: 88,
      flag_code: 'VENDOR_IDENTITY_MISMATCH',
      flag_reason: 'Invoice TRN does not match Vendor Master TRN for this vendor',
      flag_details: {
        invoice_trn: payload.invoice.vendor_trn || payload.invoice.gstin,
        master_trn: payload.vendor?.master_trn,
      },
    });
  }
  const invDate = String(payload.invoice.invoice_date || '');
  const poDate = String(payload.invoice.po_date || payload.vendor?.po_date || '');
  if (invDate && poDate && invDate < poDate) {
    flags.push({
      anomaly_type: 'rule_based',
      detection_method: 'invoice_before_po',
      severity: 'high',
      risk_score: 80,
      flag_code: 'INVOICE_BEFORE_PO',
      flag_reason: `Invoice date ${invDate} is before PO date ${poDate} — possible backdating`,
      flag_details: { invoice_date: invDate, po_date: poDate },
    });
  }

  const overall = flags.length ? Math.max(...flags.map((f) => f.risk_score)) : 0;
  let statistical_context: string | null = null;
  if (avg > 0) {
    const ratio = amount / avg;
    if (sampleN >= MIN_ZSCORE_HISTORY) {
      const z = (amount - avg) / std;
      statistical_context = `This vendor's avg invoice is AED ${avg.toLocaleString()} (n=${sampleN}). This invoice is AED ${amount.toLocaleString()} (${z.toFixed(1)}σ, ${ratio.toFixed(1)}× avg).`;
    } else {
      statistical_context = `This vendor's avg invoice is AED ${avg.toLocaleString()} (only ${sampleN} prior invoice${sampleN !== 1 ? 's' : ''}). This invoice is AED ${amount.toLocaleString()} (${ratio.toFixed(1)}× avg) — z-score not applied.`;
    }
  }
  return {
    overall_risk_score: overall,
    flags,
    statistical_context,
  };
}

function normalizeTrn(raw: string | null | undefined): string {
  return String(raw || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function isPlaceholderTrn(raw: string | null | undefined): boolean {
  const t = normalizeTrn(raw);
  if (!t || t.length < 5) return true;
  if (/^0+$/.test(t.replace(/^\d/, ''))) return true; // mostly zeros
  if (/1000{5,}0/.test(t) || /1111111/.test(t) || /0000000/.test(t)) return true;
  if (t === '10000000000' || t.includes('0000000')) return true;
  return false;
}

function riskLevelFromScore(score: number): string {
  if (score >= 60) return 'High';
  if (score >= 30) return 'Medium';
  return 'Low';
}

export async function persistAnomalies(
  invoiceId: string,
  companyId: string,
  result: AnomalyEngineResult,
  actor: string | null,
): Promise<InvoiceAnomaly[]> {
  if (!result.flags.length) {
    // Still write a computed low score so risk_score is not a stale default
    await supabase
      .from('invoices')
      .update({
        risk_score: Number(result.overall_risk_score) || 0,
        risk_level: riskLevelFromScore(Number(result.overall_risk_score) || 0),
        risk_flags: [],
        updated_at: new Date().toISOString(),
      })
      .eq('id', invoiceId);
    return [];
  }

  // Replace prior open flags from this pipeline so re-scans don't duplicate
  await supabase
    .from('invoice_anomalies')
    .delete()
    .eq('invoice_id', invoiceId)
    .eq('status', 'open');

  const rows = result.flags.map((f) => ({
    invoice_id: invoiceId,
    company_id: companyId,
    anomaly_type: f.anomaly_type,
    detection_method: f.detection_method,
    severity: f.severity,
    risk_score: f.risk_score,
    flag_code: f.flag_code,
    flag_reason: f.flag_reason,
    flag_details: f.flag_details ?? {},
    status: 'open' as const,
  }));

  const { data, error } = await supabase.from('invoice_anomalies').insert(rows).select();
  if (error) throw error;

  for (const f of result.flags) {
    logApAudit({
      entity_type: 'anomaly',
      entity_id: invoiceId,
      action: 'flagged',
      action_by: actor,
      new_values: { flag_code: f.flag_code, severity: f.severity, reason: f.flag_reason },
    });
  }

  const overall = Number(result.overall_risk_score) || Math.max(...result.flags.map((f) => f.risk_score));
  await supabase
    .from('invoices')
    .update({
      risk_score: overall,
      risk_level: riskLevelFromScore(overall),
      risk_flags: result.flags.map((f) => ({
        type: f.flag_code,
        severity: f.severity,
        message: f.flag_reason,
        explanation: JSON.stringify(f.flag_details ?? {}),
      })),
      updated_at: new Date().toISOString(),
    })
    .eq('id', invoiceId);

  return (data ?? []) as InvoiceAnomaly[];
}

/**
 * Map client-side detectAnomalies() output (CSV/PDF upload path) into
 * AnomalyEngineResult so we can insert rows into invoice_anomalies.
 */
export function riskCheckToEngineResult(result: {
  risk_score: string;
  risk_flags: Array<{
    type?: string;
    severity?: string;
    message?: string;
    explanation?: string;
  }>;
}): AnomalyEngineResult {
  const scoreMap: Record<string, number> = { low: 25, medium: 50, high: 75, critical: 90 };
  const flags: AnomalyEngineFlag[] = (result.risk_flags || []).map((f) => {
    const sevRaw = String(f.severity || 'medium').toLowerCase();
    const severity = (
      sevRaw === 'critical' || sevRaw === 'high' || sevRaw === 'low' ? sevRaw : 'medium'
    ) as AnomalyEngineFlag['severity'];
    return {
      anomaly_type: 'rule_based',
      detection_method: 'upload_detectAnomalies',
      severity,
      risk_score: scoreMap[severity] ?? 50,
      flag_code: String(f.type || 'UNKNOWN').slice(0, 64),
      flag_reason: String(f.message || 'Anomaly detected'),
      flag_details: f.explanation ? { explanation: f.explanation } : {},
    };
  });
  return {
    overall_risk_score: scoreMap[String(result.risk_score || '').toLowerCase()] ?? (flags.length ? 50 : 0),
    flags,
  };
}

/** Persist detectAnomalies() flags to invoice_anomalies (no-op if table missing). */
export async function persistUploadAnomalies(
  invoiceId: string,
  companyId: string,
  result: {
    risk_score: string;
    risk_flags: Array<{
      type?: string;
      severity?: string;
      message?: string;
      explanation?: string;
    }>;
  },
  actor: string | null,
): Promise<void> {
  try {
    await persistAnomalies(invoiceId, companyId, riskCheckToEngineResult(result), actor);
  } catch (e) {
    console.warn('[anomaly] persist to invoice_anomalies skipped:', e);
  }
}

/**
 * Full AP anomaly pipeline for one invoice:
 * client rules + vendor-master identity + PO/GRN sequence + Python engine (or fallback).
 * Always writes numeric risk_score and invoice_anomalies rows when flags exist.
 */
export async function scanInvoiceAnomalies(
  invoice: {
    id: string;
    company_id: string;
    invoice_number: string;
    invoice_date: string;
    due_date?: string | null;
    vendor_name: string;
    vendor_email?: string | null;
    vendor_trn?: string | null;
    gstin?: string | null;
    total_amount: number;
    po_number?: string | null;
    po_id?: string | null;
    notes?: string | null;
    description?: string | null;
    created_at?: string | null;
  },
  actor: string | null = 'system-anomaly-scan',
): Promise<AnomalyEngineResult> {
  const companyId = invoice.company_id;
  const vendorName = String(invoice.vendor_name || '').trim();
  const invoiceTrn = String(invoice.vendor_trn || invoice.gstin || '').trim();

  const { data: historyRows } = await supabase
    .from('invoices')
    .select('id,invoice_number,vendor_name,total_amount,invoice_date,due_date,vendor_email,vendor_trn,gstin,status')
    .eq('company_id', companyId)
    .neq('id', invoice.id)
    .limit(500);

  const history = historyRows ?? [];

  // --- Vendor master lookup ---
  let master: Record<string, unknown> | null = null;
  let companyVendorCount = 0;
  {
    const { count } = await supabase
      .from('vendors')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId);
    companyVendorCount = count ?? 0;

    if (vendorName) {
      const { data: exact } = await supabase
        .from('vendors')
        .select('*')
        .eq('company_id', companyId)
        .ilike('name', vendorName)
        .limit(1);
      master = (exact?.[0] as Record<string, unknown>) ?? null;
      if (!master) {
        const { data: fuzzy } = await supabase
          .from('vendors')
          .select('*')
          .eq('company_id', companyId)
          .ilike('name', `%${vendorName.split(/\s+/)[0] || vendorName}%`)
          .limit(5);
        const hit = (fuzzy ?? []).find(
          (v) =>
            String(v.name || '')
              .toLowerCase()
              .includes(vendorName.toLowerCase()) ||
            vendorName.toLowerCase().includes(String(v.name || '').toLowerCase()),
        );
        master = (hit as Record<string, unknown>) ?? null;
      }
    }
  }

  // Consensus TRN from prior invoices for this vendor (when master empty / incomplete)
  const priorSameVendor = history.filter(
    (h) => String(h.vendor_name || '').toLowerCase() === vendorName.toLowerCase(),
  );
  const trnCounts = new Map<string, number>();
  for (const h of priorSameVendor) {
    const t = normalizeTrn(h.vendor_trn || h.gstin);
    if (t && !isPlaceholderTrn(t)) trnCounts.set(t, (trnCounts.get(t) || 0) + 1);
  }
  let consensusTrn = '';
  let bestN = 0;
  for (const [t, n] of trnCounts) {
    if (n > bestN) {
      bestN = n;
      consensusTrn = t;
    }
  }

  const masterTrn = normalizeTrn(
    (master?.gstin as string) || (master?.tax_id as string) || (master?.trn as string) || consensusTrn,
  );
  const invTrnNorm = normalizeTrn(invoiceTrn);
  const placeholder = isPlaceholderTrn(invoiceTrn);
  const inMaster = !!master;
  // Ghost when: not in master (and company has a vendor list), OR placeholder TRN
  const ghost =
    (companyVendorCount > 0 && !inMaster) ||
    placeholder;

  const trnMismatch =
    !!invTrnNorm &&
    !!masterTrn &&
    invTrnNorm !== masterTrn &&
    !placeholder;

  // --- PO / GRN dates for backdating ---
  let poDate: string | null = null;
  let grnDate: string | null = null;
  const poNum = String(invoice.po_number || '').trim();
  let poId = invoice.po_id || null;
  if (poNum || poId) {
    let poQ = supabase.from('purchase_orders').select('id,po_date,po_number').eq('company_id', companyId);
    if (poId) poQ = poQ.eq('id', poId);
    else poQ = poQ.ilike('po_number', poNum);
    const { data: pos } = await poQ.limit(1);
    if (pos?.[0]) {
      poId = pos[0].id;
      poDate = pos[0].po_date ?? null;
    }
  }
  if (poId) {
    const { data: grns } = await supabase
      .from('goods_receipts')
      .select('received_date')
      .eq('po_id', poId)
      .order('received_date', { ascending: true })
      .limit(1);
    grnDate = grns?.[0]?.received_date ?? null;
  }

  const vendorAgeDays = master?.vendor_since
    ? Math.max(
        0,
        Math.floor(
          (Date.now() - new Date(String(master.vendor_since)).getTime()) / 86_400_000,
        ),
      )
    : priorSameVendor.length
      ? 120
      : 0;

  const vendorCtx: Record<string, unknown> = {
    vendor_age_days: vendorAgeDays,
    in_vendor_master: inMaster,
    flag_ghost_vendor: ghost,
    placeholder_trn: placeholder,
    trn_mismatch: trnMismatch,
    master_trn: masterTrn || null,
    po_date: poDate,
    grn_date: grnDate,
  };

  const engineInvoice: Record<string, unknown> = {
    id: invoice.id,
    invoice_number: invoice.invoice_number,
    invoice_date: invoice.invoice_date,
    due_date: invoice.due_date,
    vendor_name: vendorName,
    vendor_trn: invoiceTrn,
    gstin: invoice.gstin,
    total_amount: invoice.total_amount,
    notes: invoice.notes,
    description: invoice.description,
    created_at: invoice.created_at,
    po_date: poDate,
    grn_date: grnDate,
  };

  // Client lightweight rules (duplicate / overdue / etc.)
  const client = await detectAnomalies(
    {
      invoice_number: invoice.invoice_number,
      invoice_date: invoice.invoice_date,
      due_date: invoice.due_date || invoice.invoice_date,
      vendor_name: vendorName,
      vendor_email: invoice.vendor_email ?? null,
      total_amount: Number(invoice.total_amount),
      company_id: companyId,
    },
    history.map((h) => ({
      invoice_number: String(h.invoice_number),
      vendor_name: String(h.vendor_name),
      total_amount: Number(h.total_amount),
      invoice_date: String(h.invoice_date),
      due_date: String(h.due_date || h.invoice_date),
      vendor_email: (h.vendor_email as string | null) ?? null,
    })),
  );

  const engine = await runAnomalyEngine({
    invoice: engineInvoice,
    vendor_history: history as Record<string, unknown>[],
    vendor: vendorCtx,
    approval_threshold: 10_000,
  });

  // Merge client + engine flags (dedupe by flag_code)
  const merged = new Map<string, AnomalyEngineFlag>();
  for (const f of riskCheckToEngineResult(client).flags) merged.set(f.flag_code, f);
  for (const f of engine.flags) merged.set(f.flag_code, f);

  // Ensure identity flags even if Python API was unreachable (client fallback may omit them)
  if (ghost && !merged.has('GHOST_VENDOR')) {
    merged.set('GHOST_VENDOR', {
      anomaly_type: 'rule_based',
      detection_method: 'ghost_vendor',
      severity: 'critical',
      risk_score: 90,
      flag_code: 'GHOST_VENDOR',
      flag_reason: 'Vendor not found in Vendor Master (or placeholder TRN) — treat as ghost vendor',
      flag_details: { vendor_name: vendorName, placeholder_trn: placeholder, in_vendor_master: inMaster },
    });
  }
  if (trnMismatch && !merged.has('VENDOR_IDENTITY_MISMATCH')) {
    merged.set('VENDOR_IDENTITY_MISMATCH', {
      anomaly_type: 'rule_based',
      detection_method: 'vendor_identity_mismatch',
      severity: 'critical',
      risk_score: 88,
      flag_code: 'VENDOR_IDENTITY_MISMATCH',
      flag_reason: 'Invoice TRN does not match Vendor Master / historical TRN for this vendor',
      flag_details: { invoice_trn: invoiceTrn, master_trn: masterTrn },
    });
  }
  if (poDate && invoice.invoice_date && invoice.invoice_date < poDate && !merged.has('INVOICE_BEFORE_PO')) {
    merged.set('INVOICE_BEFORE_PO', {
      anomaly_type: 'rule_based',
      detection_method: 'invoice_before_po',
      severity: 'high',
      risk_score: 80,
      flag_code: 'INVOICE_BEFORE_PO',
      flag_reason: `Invoice date ${invoice.invoice_date} is before PO date ${poDate} — possible backdating`,
      flag_details: { invoice_date: invoice.invoice_date, po_date: poDate },
    });
  }

  const flags = [...merged.values()];
  const overall = flags.length ? Math.max(...flags.map((f) => f.risk_score)) : 0;
  const result: AnomalyEngineResult = {
    overall_risk_score: overall,
    flags,
    statistical_context: engine.statistical_context,
  };

  await persistAnomalies(invoice.id, companyId, result, actor);
  return result;
}

/** Batch rescan — used after bulk import and for remediating existing invoices. */
export async function scanInvoicesAnomaliesBatch(
  invoiceIds: string[],
  actor: string | null = 'system-anomaly-scan',
  onProgress?: (done: number, total: number, detail: string) => void,
): Promise<{ scanned: number; flagged: number }> {
  let scanned = 0;
  let flagged = 0;
  for (let i = 0; i < invoiceIds.length; i++) {
    const id = invoiceIds[i];
    const { data: inv, error } = await supabase.from('invoices').select('*').eq('id', id).maybeSingle();
    if (error || !inv) continue;
    onProgress?.(i + 1, invoiceIds.length, `Scanning ${inv.invoice_number}…`);
    try {
      const r = await scanInvoiceAnomalies(
        {
          id: inv.id,
          company_id: inv.company_id,
          invoice_number: inv.invoice_number,
          invoice_date: inv.invoice_date,
          due_date: inv.due_date,
          vendor_name: inv.vendor_name,
          vendor_email: inv.vendor_email,
          vendor_trn: inv.vendor_trn,
          gstin: inv.gstin,
          total_amount: Number(inv.total_amount),
          po_number: inv.po_number,
          po_id: inv.po_id,
          notes: inv.notes,
          description: inv.description,
          created_at: inv.created_at,
        },
        actor,
      );
      scanned++;
      if (r.flags.length) flagged++;
    } catch (e) {
      console.warn('[anomaly] scan failed', inv.invoice_number, e);
    }
  }
  return { scanned, flagged };
}

/** Async hook — call after invoice save without blocking upload. */
export function detectAndPersistAnomaliesAsync(
  invoice: Record<string, unknown> & { id: string; company_id?: string },
  _vendorHistory: Record<string, unknown>[],
  _vendor: Record<string, unknown>,
  actor: string | null,
  _approvalThreshold?: number,
): void {
  void (async () => {
    try {
      const companyId = (invoice.company_id as string) ?? (await requireCompanyId());
      await scanInvoiceAnomalies(
        {
          id: invoice.id,
          company_id: companyId,
          invoice_number: String(invoice.invoice_number || ''),
          invoice_date: String(invoice.invoice_date || ''),
          due_date: (invoice.due_date as string) || null,
          vendor_name: String(invoice.vendor_name || ''),
          vendor_email: (invoice.vendor_email as string) || null,
          vendor_trn: (invoice.vendor_trn as string) || null,
          gstin: (invoice.gstin as string) || null,
          total_amount: Number(invoice.total_amount || 0),
          po_number: (invoice.po_number as string) || null,
          po_id: (invoice.po_id as string) || null,
          notes: (invoice.notes as string) || null,
          description: (invoice.description as string) || null,
          created_at: (invoice.created_at as string) || null,
        },
        actor,
      );
    } catch (e) {
      console.warn('[anomaly] async detection failed:', e);
    }
  })();
}

export async function listInvoiceAnomalies(filters?: {
  status?: string;
  severity?: string;
  month?: string;
  /** When set, use this company instead of requireCompanyId() (avoids drift vs invoice list). */
  companyId?: string | null;
}): Promise<InvoiceAnomaly[]> {
  let companyId = filters?.companyId ?? null;
  if (!companyId) {
    try {
      companyId = await requireCompanyId();
    } catch {
      companyId = null;
    }
  }
  let q = supabase
    .from('invoice_anomalies')
    .select('*')
    .order('created_at', { ascending: false });
  if (companyId) q = q.eq('company_id', companyId);
  if (filters?.status) q = q.eq('status', filters.status);
  if (filters?.severity) q = q.eq('severity', filters.severity);
  if (filters?.month) {
    q = q.gte('created_at', `${filters.month}-01`).lt('created_at', `${filters.month}-32`);
  }
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as InvoiceAnomaly[];
}

export async function getAnomaliesForInvoice(invoiceId: string): Promise<InvoiceAnomaly[]> {
  const { data, error } = await supabase
    .from('invoice_anomalies')
    .select('*')
    .eq('invoice_id', invoiceId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as InvoiceAnomaly[];
}

export async function resolveAnomaly(
  anomalyId: string,
  status: 'resolved' | 'false_positive' | 'investigating',
  actor: string,
  notes?: string,
): Promise<void> {
  await supabase
    .from('invoice_anomalies')
    .update({
      status,
      resolved_by: actor,
      resolved_at: status === 'investigating' ? null : new Date().toISOString(),
      resolution_notes: notes ?? null,
    })
    .eq('id', anomalyId);

  logApAudit({
    entity_type: 'anomaly',
    entity_id: anomalyId,
    action: status === 'false_positive' ? 'false_positive' : status === 'investigating' ? 'investigating' : 'resolved',
    action_by: actor,
    notes,
  });
}

/** Escalate open anomaly to CFO via Action Queue alert. */
export async function escalateAnomalyToCFO(params: {
  invoiceId: string;
  invoiceNumber: string;
  vendorName: string;
  flagReason: string;
  actor: string;
  companyId: string;
}): Promise<void> {
  const { invoiceId, invoiceNumber, vendorName, flagReason, actor, companyId } = params;
  await supabase.from('ap_alerts').insert({
    company_id: companyId,
    alert_type: 'ANOMALY_ESCALATION',
    priority: 'critical',
    title: `CFO review: ${invoiceNumber}`,
    message: `${vendorName} — ${flagReason}. Escalated by ${actor}.`,
    metadata: { invoice_id: invoiceId, escalated_by: actor },
    status: 'open',
  });
  logApAudit({
    entity_type: 'anomaly',
    entity_id: invoiceId,
    action: 'escalated_to_cfo',
    action_by: actor,
    notes: flagReason,
  });
}

export async function getAnomalyDashboardStats(): Promise<{
  totalThisMonth: number;
  critical: number;
  high: number;
  medium: number;
  byType: { name: string; value: number }[];
  byVendor: { name: string; count: number }[];
}> {
  const month = new Date().toISOString().slice(0, 7);
  try {
    const anomalies = await listInvoiceAnomalies({ month });
    if (anomalies.length > 0) {
      const byCode: Record<string, number> = {};
      for (const a of anomalies) {
        byCode[a.flag_code ?? 'OTHER'] = (byCode[a.flag_code ?? 'OTHER'] ?? 0) + 1;
      }
      return {
        totalThisMonth: anomalies.length,
        critical: anomalies.filter((a) => a.severity === 'critical').length,
        high: anomalies.filter((a) => a.severity === 'high').length,
        medium: anomalies.filter((a) => a.severity === 'medium').length,
        byType: Object.entries(byCode).map(([name, value]) => ({ name, value })),
        byVendor: [],
      };
    }
  } catch {
    /* table missing or RLS — fall through to invoices.risk_flags */
  }

  // Fallback: count flags / numeric risk on invoices this month
  const companyId = await requireCompanyId().catch(() => null);
  let q = supabase
    .from('invoices')
    .select('risk_score, risk_level, risk_flags')
    .gte('created_at', `${month}-01`)
    .lt('created_at', `${month}-32`);
  if (companyId) q = q.eq('company_id', companyId);
  const { data } = await q;
  let total = 0;
  let critical = 0;
  let high = 0;
  let medium = 0;
  const byCode: Record<string, number> = {};
  for (const inv of data ?? []) {
    const flags = Array.isArray(inv.risk_flags) ? inv.risk_flags : [];
    const scoreNum = typeof inv.risk_score === 'number' ? inv.risk_score : Number(inv.risk_score);
    const tier = String(inv.risk_level || '').toLowerCase();
    const flagN = flags.length || (Number.isFinite(scoreNum) && scoreNum >= 30 ? 1 : 0);
    if (!flagN) continue;
    total += flags.length || 1;
    if (tier === 'critical' || scoreNum >= 85) critical += flags.length || 1;
    else if (tier === 'high' || scoreNum >= 60) high += flags.length || 1;
    else medium += flags.length || 1;
    for (const f of flags) {
      const code =
        f && typeof f === 'object' && 'type' in f
          ? String((f as { type?: string }).type || 'FLAG')
          : 'FLAG';
      byCode[code] = (byCode[code] ?? 0) + 1;
    }
    if (!flags.length) byCode['RISK_SCORE'] = (byCode['RISK_SCORE'] ?? 0) + 1;
  }
  return {
    totalThisMonth: total,
    critical,
    high,
    medium,
    byType: Object.entries(byCode).map(([name, value]) => ({ name, value })),
    byVendor: [],
  };
}
