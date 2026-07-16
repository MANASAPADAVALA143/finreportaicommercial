/**
 * Module 3 — Anomaly detection service (calls Python engine + persists to invoice_anomalies).
 */
import { supabase } from './supabase';
import type { InvoiceAnomaly } from './supabase';
import { requireCompanyId } from './companyService';
import { logApAudit } from './apAuditService';

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

const ANOMALY_API = '/api/ap/detect-anomalies';

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
  const amounts = history.map((h) => Number(h.total_amount ?? 0)).filter((a) => a > 0);
  const avg = amounts.length ? amounts.reduce((s, a) => s + a, 0) / amounts.length : 0;
  const std =
    amounts.length > 1
      ? Math.sqrt(amounts.reduce((s, a) => s + (a - avg) ** 2, 0) / (amounts.length - 1))
      : 1;
  const z = std > 0 ? (amount - avg) / std : 0;

  if (z > 2.5) {
    flags.push({
      anomaly_type: 'statistical',
      detection_method: 'zscore',
      severity: 'high',
      risk_score: 55,
      flag_code: 'AMOUNT_HIGH_ZSCORE',
      flag_reason: `Unusually high amount for this vendor (z=${z.toFixed(2)})`,
      flag_details: { z_score: z, vendor_avg: avg },
    });
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

  const overall = flags.length ? Math.max(...flags.map((f) => f.risk_score)) : 0;
  return {
    overall_risk_score: overall,
    flags,
    statistical_context:
      avg > 0
        ? `This vendor's avg invoice is AED ${avg.toLocaleString()}. This invoice is AED ${amount.toLocaleString()} (${z.toFixed(1)}σ).`
        : null,
  };
}

export async function persistAnomalies(
  invoiceId: string,
  companyId: string,
  result: AnomalyEngineResult,
  actor: string | null,
): Promise<InvoiceAnomaly[]> {
  if (!result.flags.length) return [];

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

  await supabase
    .from('invoices')
    .update({
      risk_score: result.overall_risk_score >= 60 ? 'high' : result.overall_risk_score >= 30 ? 'medium' : 'low',
      risk_flags: result.flags.map((f) => ({
        type: f.flag_code,
        severity: f.severity,
        message: f.flag_reason,
        explanation: JSON.stringify(f.flag_details ?? {}),
      })),
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
  if (!result.risk_flags?.length) return;
  try {
    await persistAnomalies(invoiceId, companyId, riskCheckToEngineResult(result), actor);
  } catch (e) {
    console.warn('[anomaly] persist to invoice_anomalies skipped:', e);
  }
}

/** Async hook — call after invoice save without blocking upload. */
export function detectAndPersistAnomaliesAsync(
  invoice: Record<string, unknown> & { id: string; company_id?: string },
  vendorHistory: Record<string, unknown>[],
  vendor: Record<string, unknown>,
  actor: string | null,
  approvalThreshold?: number,
): void {
  void (async () => {
    try {
      const companyId = invoice.company_id ?? (await requireCompanyId());
      const result = await runAnomalyEngine({
        invoice,
        vendor_history: vendorHistory,
        vendor,
        approval_threshold: approvalThreshold,
      });
      await persistAnomalies(invoice.id, companyId, result, actor);
    } catch (e) {
      console.warn('[anomaly] async detection failed:', e);
    }
  })();
}

export async function listInvoiceAnomalies(filters?: {
  status?: string;
  severity?: string;
  month?: string;
}): Promise<InvoiceAnomaly[]> {
  const companyId = await requireCompanyId();
  let q = supabase
    .from('invoice_anomalies')
    .select('*')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false });
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

  // Fallback: count flags stored on invoices this month (CSV path historically only wrote risk_flags)
  const companyId = await requireCompanyId().catch(() => null);
  let q = supabase
    .from('invoices')
    .select('risk_score, risk_flags')
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
    if (!flags.length) continue;
    total += flags.length;
    const score = String(inv.risk_score || '').toLowerCase();
    if (score === 'critical') critical += flags.length;
    else if (score === 'high') high += flags.length;
    else medium += flags.length;
    for (const f of flags) {
      const code =
        f && typeof f === 'object' && 'type' in f
          ? String((f as { type?: string }).type || 'FLAG')
          : 'FLAG';
      byCode[code] = (byCode[code] ?? 0) + 1;
    }
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
