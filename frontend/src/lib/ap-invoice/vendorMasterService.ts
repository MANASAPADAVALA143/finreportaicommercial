/**
 * Module 1 — Vendor master, bank change detection, payment freeze, alerts.
 */
import { supabase } from './supabase';
import type { ApAlert, Vendor, VendorHistory } from './supabase';
import { requireCompanyId } from './companyService';
import { logAction, getInvoiceflowWorkEmail } from './auditService';
import { logApAudit } from './apAuditService';
import { calculateVendorRisk } from './vendorRiskEngine';

export type VendorRow = Vendor;

export type VendorBankPatch = {
  bank_account_number?: string | null;
  bank_name?: string | null;
  bank_iban?: string | null;
  bank_swift?: string | null;
  change_reason?: string;
};

const BANK_FIELDS = ['bank_account_number', 'bank_name', 'bank_iban', 'bank_swift'] as const;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidVendorUuid(id: string): boolean {
  return UUID_RE.test(id);
}

function normBank(v: string | null | undefined): string {
  return (v ?? '').trim().replace(/\s+/g, '');
}

function bankFieldsChanged(prev: VendorRow, next: VendorBankPatch): string[] {
  const changed: string[] = [];
  for (const f of BANK_FIELDS) {
    const a = normBank(prev[f] as string | null);
    const b = normBank(next[f] as string | null | undefined);
    if (b !== undefined && b !== a) changed.push(f);
  }
  return changed;
}

const DEFAULT_VENDOR_RISK_SCORE = 25;
const DEFAULT_VENDOR_RISK_LEVEL = 'low' as const;

function normalizeVendorRow(v: VendorRow): VendorRow {
  const hasScore = v.risk_score != null && Number(v.risk_score) > 0;
  return {
    ...v,
    risk_score: hasScore ? Number(v.risk_score) : DEFAULT_VENDOR_RISK_SCORE,
    risk_level: (v.risk_level ?? DEFAULT_VENDOR_RISK_LEVEL) as VendorRow['risk_level'],
    risk_flags: v.risk_flags ?? [],
    total_invoices_amount: Number(v.total_invoices_amount ?? 0),
  };
}

export async function listVendorsForCompany(): Promise<VendorRow[]> {
  const companyId = await requireCompanyId();
  const { data, error } = await supabase
    .from('vendors')
    .select('*')
    .eq('company_id', companyId)
    .order('total_invoices_amount', { ascending: false, nullsFirst: false });

  let rows: VendorRow[] = [];
  if (error) {
    const { data: all, error: e2 } = await supabase.from('vendors').select('*');
    if (e2) throw e2;
    rows = ((all ?? []) as VendorRow[]).filter((v) => !v.company_id || v.company_id === companyId);
  } else {
    rows = (data ?? []) as VendorRow[];
  }

  const { data: invoiceVendors } = await supabase
    .from('invoices')
    .select('vendor_name, total_amount')
    .eq('company_id', companyId);

  const spendByName = new Map<string, number>();
  for (const inv of invoiceVendors ?? []) {
    const name = String(inv.vendor_name ?? '').trim();
    if (!name) continue;
    spendByName.set(name, (spendByName.get(name) ?? 0) + Number(inv.total_amount ?? 0));
  }

  const byName = new Map(rows.map((v) => [v.name.trim().toLowerCase(), v]));
  for (const [name, spend] of spendByName) {
    const key = name.toLowerCase();
    const existing = byName.get(key);
    if (existing) {
      if (!existing.total_invoices_amount || Number(existing.total_invoices_amount) < spend) {
        existing.total_invoices_amount = spend;
      }
    } else {
      const synthetic: VendorRow = {
        id: `invoice-only-${key.replace(/\s+/g, '-')}`,
        name,
        gstin: null,
        company_id: companyId,
        total_invoices_amount: spend,
        risk_score: DEFAULT_VENDOR_RISK_SCORE,
        risk_level: DEFAULT_VENDOR_RISK_LEVEL,
        risk_flags: [],
      };
      rows.push(synthetic);
      byName.set(key, synthetic);
    }
  }

  return rows
    .map(normalizeVendorRow)
    .sort((a, b) => Number(b.total_invoices_amount ?? 0) - Number(a.total_invoices_amount ?? 0));
}

export async function getVendorById(vendorId: string): Promise<VendorRow | null> {
  if (!isValidVendorUuid(vendorId)) return null;
  const { data, error } = await supabase.from('vendors').select('*').eq('id', vendorId).maybeSingle();
  if (error) throw error;
  return (data as VendorRow) ?? null;
}

/** Create vendors row when vendor only exists on invoices (no UUID yet). */
export async function ensureVendorRowByName(vendorName: string, gstin?: string | null): Promise<VendorRow> {
  const n = vendorName.trim();
  if (!n) throw new Error('Vendor name is required');

  const companyId = await requireCompanyId();

  const { data: byCompany } = await supabase
    .from('vendors')
    .select('*')
    .eq('company_id', companyId)
    .ilike('name', n)
    .maybeSingle();
  if (byCompany) return byCompany as VendorRow;

  const { data: byName } = await supabase.from('vendors').select('*').ilike('name', n).maybeSingle();
  if (byName) {
    const row = byName as VendorRow;
    if (!row.company_id) {
      await supabase.from('vendors').update({ company_id: companyId, updated_at: new Date().toISOString() }).eq('id', row.id);
    }
    return { ...row, company_id: row.company_id ?? companyId };
  }

  const { data: inserted, error } = await supabase
    .from('vendors')
    .insert({
      company_id: companyId,
      name: n,
      gstin: gstin?.trim() || null,
      vendor_since: new Date().toISOString().slice(0, 10),
      updated_at: new Date().toISOString(),
    })
    .select('*')
    .single();

  if (error) throw error;
  await syncVendorStatsFromInvoices(n);
  return inserted as VendorRow;
}

export async function getVendorHistory(vendorId: string): Promise<VendorHistory[]> {
  if (!isValidVendorUuid(vendorId)) return [];
  const { data, error } = await supabase
    .from('vendor_history')
    .select('*')
    .eq('vendor_id', vendorId)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) {
    console.warn('[vendorMasterService] vendor_history:', error.message);
    return [];
  }
  return (data ?? []) as VendorHistory[];
}

/** Recalculate vendor risk from invoice history — call after every invoice save. */
export async function recalcVendorRisk(vendorName: string): Promise<void> {
  return syncVendorStatsFromInvoices(vendorName);
}

/** Fire-and-forget vendor risk recalc (non-blocking). */
export function recalcVendorRiskAsync(vendorName: string): void {
  void syncVendorStatsFromInvoices(vendorName).catch((e) =>
    console.warn('[vendorMaster] recalcVendorRisk failed:', e),
  );
}

export async function syncVendorStatsFromInvoices(vendorName: string): Promise<void> {
  const name = vendorName.trim();
  if (!name) return;
  let companyId: string | null = null;
  try {
    companyId = await requireCompanyId();
  } catch {
    return;
  }

  const { data: invs } = await supabase
    .from('invoices')
    .select('total_amount, invoice_date, duplicate_flag, created_at')
    .eq('company_id', companyId)
    .ilike('vendor_name', name);

  const rows = invs ?? [];
  const total = rows.reduce((s, r) => s + Number(r.total_amount ?? 0), 0);
  const count = rows.length;
  const dupCount = rows.filter((r) => r.duplicate_flag === true).length;
  const dates = rows.map((r) => r.invoice_date).filter(Boolean) as string[];
  const lastDate = dates.sort().reverse()[0] ?? null;
  const amounts = rows.map((r) => Number(r.total_amount ?? 0)).filter((n) => n > 0);
  const latest = amounts.length ? Math.max(...amounts) : 0;

  const { data: vendor } = await supabase
    .from('vendors')
    .select('*')
    .eq('company_id', companyId)
    .ilike('name', name)
    .maybeSingle();

  const vRow = vendor as VendorRow | null;
  const risk = calculateVendorRisk({
    bank_last_changed_at: vRow?.bank_last_changed_at,
    bank_change_count: vRow?.bank_change_count,
    created_at: vRow?.created_at,
    vendor_since: vRow?.vendor_since,
    duplicate_invoice_count: dupCount,
    trn_verified: vRow?.trn_verified,
    gstin: vRow?.gstin,
    latest_invoice_amount: latest,
    recent_invoice_amounts: amounts.slice(0, 12),
    high_value_threshold: 50_000,
  });

  const patch = {
    total_invoices_count: count,
    total_invoices_amount: total,
    avg_invoice_amount: count > 0 ? total / count : 0,
    last_invoice_date: lastDate,
    duplicate_invoice_count: dupCount,
    risk_score: risk.risk_score,
    risk_level: risk.risk_level,
    risk_flags: risk.risk_flags,
    updated_at: new Date().toISOString(),
  };

  if (vRow?.id) {
    await supabase.from('vendors').update(patch).eq('id', vRow.id);
  }
}

async function freezeVendorPayments(vendorName: string, companyId: string): Promise<{ count: number; total: number }> {
  const { data: rows } = await supabase
    .from('invoices')
    .select('id, total_amount, payment_status, status')
    .eq('company_id', companyId)
    .ilike('vendor_name', vendorName.trim())
    .eq('status', 'Approved')
    .in('payment_status', ['unpaid', 'scheduled', 'pending', 'processing']);

  const toFreeze = rows ?? [];
  if (toFreeze.length === 0) return { count: 0, total: 0 };

  const ids = toFreeze.map((r) => r.id);
  await supabase
    .from('invoices')
    .update({ payment_status: 'frozen', updated_at: new Date().toISOString() })
    .in('id', ids);

  const actor = getInvoiceflowWorkEmail();
  for (const id of ids) {
    logApAudit({
      entity_type: 'payment',
      entity_id: id,
      action: 'frozen',
      action_by: actor,
      notes: `Payment frozen — vendor bank change (${vendorName})`,
    });
  }

  const total = toFreeze.reduce((s, r) => s + Number(r.total_amount ?? 0), 0);
  return { count: ids.length, total };
}

async function unfreezeVendorPayments(vendorName: string, companyId: string): Promise<number> {
  const { data: rows } = await supabase
    .from('invoices')
    .select('id')
    .eq('company_id', companyId)
    .ilike('vendor_name', vendorName.trim())
    .eq('payment_status', 'frozen');

  const ids = (rows ?? []).map((r) => r.id);
  if (!ids.length) return 0;

  await supabase
    .from('invoices')
    .update({ payment_status: 'unpaid', updated_at: new Date().toISOString() })
    .in('id', ids);

  const actor = getInvoiceflowWorkEmail();
  for (const id of ids) {
    logApAudit({
      entity_type: 'payment',
      entity_id: id,
      action: 'unfrozen',
      action_by: actor,
      notes: `Payment unfrozen — bank change approved (${vendorName})`,
    });
  }

  return ids.length;
}

async function createBankChangeAlert(params: {
  companyId: string;
  vendor: VendorRow;
  frozenCount: number;
  frozenTotal: number;
  changedFields: string[];
}): Promise<void> {
  const { companyId, vendor, frozenCount, frozenTotal, changedFields } = params;
  const msg = `${vendor.name} changed bank details (${changedFields.join(', ')}). ${frozenCount} pending payment(s) totalling ${frozenTotal.toLocaleString()} are FROZEN. Verify change directly with vendor before releasing.`;

  const { error } = await supabase.from('ap_alerts').insert({
    company_id: companyId,
    alert_type: 'VENDOR_BANK_CHANGE',
    priority: 'critical',
    vendor_id: vendor.id,
    vendor_name: vendor.name,
    title: 'Vendor bank details changed',
    message: msg,
    metadata: { frozen_count: frozenCount, frozen_total: frozenTotal, fields: changedFields },
    status: 'open',
    requires_dual_approval: true,
  });

  if (error) console.warn('[vendorMasterService] ap_alerts insert:', error.message);

  const webhook = (import.meta.env.VITE_VENDOR_BANK_ALERT_WEBHOOK_URL as string | undefined)?.trim();
  if (webhook) {
    void fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'VENDOR_BANK_CHANGE',
        vendor_name: vendor.name,
        message: msg,
        frozen_count: frozenCount,
        frozen_total: frozenTotal,
      }),
    }).catch(() => null);
  }
}

/** Update bank fields — freezes payments + creates alert when bank data changes. */
export async function updateVendorBankDetails(
  vendorId: string,
  patch: VendorBankPatch,
  changedBy?: string,
  vendorNameHint?: string
): Promise<{ bankChanged: boolean; alertCreated: boolean }> {
  const companyId = await requireCompanyId();

  let resolvedId = vendorId;
  if (!isValidVendorUuid(resolvedId)) {
    const row = await ensureVendorRowByName(vendorNameHint ?? vendorId);
    resolvedId = row.id;
  }

  const vendor = await getVendorById(resolvedId);
  if (!vendor) throw new Error('Vendor not found — refresh the page and try again.');

  const changedFields = bankFieldsChanged(vendor, patch);
  const bankChanged = changedFields.length > 0;
  const actor = changedBy ?? getInvoiceflowWorkEmail() ?? 'system';

  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  for (const f of BANK_FIELDS) {
    if (patch[f] !== undefined) updates[f] = patch[f]?.trim() || null;
  }

  if (bankChanged) {
    updates.bank_last_changed_at = new Date().toISOString();
    updates.bank_change_count = Number(vendor.bank_change_count ?? 0) + 1;
    updates.bank_verification_status = 'pending_verification';
  }

  const risk = calculateVendorRisk({
    ...vendor,
    bank_last_changed_at: (updates.bank_last_changed_at as string) ?? vendor.bank_last_changed_at,
    bank_change_count: (updates.bank_change_count as number) ?? vendor.bank_change_count,
    duplicate_invoice_count: vendor.duplicate_invoice_count,
    trn_verified: vendor.trn_verified,
    gstin: vendor.gstin,
    high_value_threshold: 50_000,
  });
  updates.risk_score = risk.risk_score;
  updates.risk_level = risk.risk_level;
  updates.risk_flags = risk.risk_flags;

  const { error: upErr } = await supabase.from('vendors').update(updates).eq('id', resolvedId);
  if (upErr) throw upErr;

  if (bankChanged) {
    for (const field of changedFields) {
      const { error: histErr } = await supabase.from('vendor_history').insert({
        vendor_id: resolvedId,
        company_id: companyId,
        changed_by: actor,
        change_type: 'bank_change',
        field_changed: field,
        old_value: String(vendor[field as keyof VendorRow] ?? ''),
        new_value: String(patch[field as keyof VendorBankPatch] ?? ''),
        change_reason: patch.change_reason ?? null,
        requires_approval: true,
      });
      if (histErr) throw new Error(histErr.message);
    }

    const { count, total } = await freezeVendorPayments(vendor.name, companyId);
    await createBankChangeAlert({ companyId, vendor: { ...vendor, ...updates } as VendorRow, frozenCount: count, frozenTotal: total, changedFields });

    logAction('vendor.bank_changed', 'vendor', resolvedId, actor, {
      fields: changedFields,
      frozen_payments: count,
    });
    logApAudit({
      entity_type: 'vendor',
      entity_id: resolvedId,
      action: 'bank_changed',
      action_by: actor,
      action_by_role: 'AP Clerk',
      old_values: Object.fromEntries(changedFields.map((f) => [f, (vendor as Record<string, unknown>)[f]])),
      new_values: Object.fromEntries(changedFields.map((f) => [f, (updates as Record<string, unknown>)[f]])),
      notes: 'Bank change detected — payments frozen pending dual approval',
    });

    return { bankChanged: true, alertCreated: true };
  }

  return { bankChanged: false, alertCreated: false };
}

export async function listOpenApAlerts(): Promise<ApAlert[]> {
  let companyId: string | null = null;
  try {
    companyId = await requireCompanyId();
  } catch {
    return [];
  }
  const { data, error } = await supabase
    .from('ap_alerts')
    .select('*')
    .eq('company_id', companyId)
    .eq('status', 'open')
    .order('created_at', { ascending: false });
  if (error) {
    console.warn('[vendorMasterService] ap_alerts:', error.message);
    return [];
  }
  return (data ?? []) as ApAlert[];
}

export async function approveBankChangeAlert(
  alertId: string,
  role: 'ap' | 'cfo',
  approverEmail: string
): Promise<void> {
  const { data: alert, error } = await supabase.from('ap_alerts').select('*').eq('id', alertId).single();
  if (error || !alert) throw new Error('Alert not found');

  const patch: Record<string, unknown> = {};
  if (role === 'ap') patch.approved_by_ap = approverEmail;
  else patch.approved_by_cfo = approverEmail;

  const ap = role === 'ap' ? approverEmail : (alert as ApAlert).approved_by_ap;
  const cfo = role === 'cfo' ? approverEmail : (alert as ApAlert).approved_by_cfo;

  if (ap && cfo) {
    patch.status = 'resolved';
    patch.resolved_by = `${ap}; ${cfo}`;
    patch.resolved_at = new Date().toISOString();

    const vendorId = (alert as ApAlert).vendor_id;
    const vendorName = (alert as ApAlert).vendor_name;
    if (vendorId) {
      await supabase
        .from('vendors')
        .update({
          bank_verification_status: 'verified',
          updated_at: new Date().toISOString(),
        })
        .eq('id', vendorId);
    }
    if (vendorName) {
      const companyId = await requireCompanyId();
      await unfreezeVendorPayments(vendorName, companyId);
    }
  }

  await supabase.from('ap_alerts').update(patch).eq('id', alertId);
}

export async function rejectBankChangeAlert(alertId: string, revertedBy: string): Promise<void> {
  const { data: alert } = await supabase.from('ap_alerts').select('*').eq('id', alertId).single();
  if (!alert) throw new Error('Alert not found');

  const vendorId = (alert as ApAlert).vendor_id;
  if (vendorId) {
    const history = await getVendorHistory(vendorId);
    const lastBank = history.find((h) => h.change_type === 'bank_change' && h.field_changed);
    if (lastBank?.field_changed && lastBank.old_value != null) {
      await supabase
        .from('vendors')
        .update({
          [lastBank.field_changed]: lastBank.old_value || null,
          bank_verification_status: 'flagged',
          updated_at: new Date().toISOString(),
        })
        .eq('id', vendorId);
    }
  }

  await supabase
    .from('ap_alerts')
    .update({
      status: 'dismissed',
      resolved_by: revertedBy,
      resolved_at: new Date().toISOString(),
    })
    .eq('id', alertId);
}
