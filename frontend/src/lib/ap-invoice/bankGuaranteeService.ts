/**
 * Module 2 — Bank Guarantee tracker + expiry reminders.
 */
import { supabase } from './supabase';
import type { BankGuarantee } from './supabase';
import { getMyCompany, requireCompanyId } from './companyService';
import { logApAudit } from './apAuditService';

export type BgRow = BankGuarantee;

export type BgSummary = {
  totalActive: number;
  expiringIn30: number;
  expired: number;
  totalValueAed: number;
};

export function daysUntilExpiry(expiryDate: string): number {
  const exp = new Date(expiryDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  exp.setHours(0, 0, 0, 0);
  return Math.ceil((exp.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

export function expiryColorClass(days: number): string {
  if (days < 0) return 'text-red-400 bg-red-950/50 border-red-800';
  if (days <= 15) return 'text-red-400 bg-red-950/50 border-red-800';
  if (days <= 90) return 'text-yellow-400 bg-yellow-950/50 border-yellow-800';
  return 'text-emerald-400 bg-emerald-950/50 border-emerald-800';
}

async function attachVendorNames(rows: BgRow[]): Promise<BgRow[]> {
  const vendorIds = [...new Set(rows.map((r) => r.vendor_id).filter(Boolean))] as string[];
  if (!vendorIds.length) return rows;

  const { data: vendors, error } = await supabase
    .from('vendors')
    .select('id, name')
    .in('id', vendorIds);
  if (error) {
    console.warn('[bank_guarantees] vendor name lookup:', error.message);
    return rows;
  }

  const nameById = new Map((vendors ?? []).map((v) => [v.id, v.name as string]));
  return rows.map((row) => ({
    ...row,
    vendor_name: row.vendor_name ?? nameById.get(row.vendor_id ?? '') ?? null,
  }));
}

async function fetchBankGuaranteeRows(companyId?: string | null): Promise<BgRow[]> {
  let q = supabase.from('bank_guarantees').select('*').order('expiry_date', { ascending: true });
  if (companyId) q = q.eq('company_id', companyId);

  const { data, error } = await q;
  if (error) {
    console.error('[bank_guarantees] query error:', error.message, { companyId });
    throw error;
  }
  return attachVendorNames((data ?? []) as BgRow[]);
}

export async function listBankGuarantees(): Promise<BgRow[]> {
  const company = await getMyCompany();
  const companyId = company?.id ?? (await requireCompanyId().catch(() => null));

  console.info('[bank_guarantees] session company_id:', companyId ?? '(none)', company?.name ?? '');

  if (companyId) {
    const scoped = await fetchBankGuaranteeRows(companyId);
    if (scoped.length > 0) {
      console.info('[bank_guarantees] matched', scoped.length, 'row(s) for company_id', companyId);
      return scoped;
    }
    console.warn(
      '[bank_guarantees] 0 rows for company_id',
      companyId,
      '— RLS blocks other tenants; run BG-COPY-TO-SESSION-COMPANY.sql in Supabase',
    );
  }

  const all = await fetchBankGuaranteeRows(null);
  console.info('[bank_guarantees] unscoped query returned', all.length, 'row(s)');
  return all;
}

export async function getBgSummary(rows: BgRow[]): Promise<BgSummary> {
  const active = rows.filter((r) => r.status === 'active');
  const expired = rows.filter((r) => r.status === 'expired' || daysUntilExpiry(r.expiry_date) < 0);
  const expiringIn30 = active.filter((r) => {
    const d = daysUntilExpiry(r.expiry_date);
    return d >= 0 && d <= 30;
  });
  const totalValueAed = active.reduce((s, r) => s + Number(r.amount_aed ?? 0), 0);
  return {
    totalActive: active.length,
    expiringIn30: expiringIn30.length,
    expired: expired.length,
    totalValueAed,
  };
}

export async function createBankGuarantee(
  input: Omit<BankGuarantee, 'id' | 'created_at' | 'company_id'>,
  actor: string | null,
): Promise<BgRow> {
  const companyId = await requireCompanyId();
  const { data, error } = await supabase
    .from('bank_guarantees')
    .insert({ ...input, company_id: companyId })
    .select()
    .single();
  if (error) throw error;
  logApAudit({
    entity_type: 'bank_guarantee',
    entity_id: data.id,
    action: 'created',
    action_by: actor,
    new_values: input as Record<string, unknown>,
  });
  return data as BgRow;
}

export async function renewBankGuarantee(
  bgId: string,
  newExpiryDate: string,
  actor: string | null,
): Promise<void> {
  const { data, error } = await supabase
    .from('bank_guarantees')
    .update({
      expiry_date: newExpiryDate,
      status: 'active',
      reminder_sent_30d: false,
      reminder_sent_15d: false,
      reminder_sent_7d: false,
    })
    .eq('id', bgId)
    .select()
    .single();
  if (error) throw error;
  logApAudit({
    entity_type: 'bank_guarantee',
    entity_id: bgId,
    action: 'renewed',
    action_by: actor,
    new_values: { expiry_date: newExpiryDate, status: 'renewed' },
  });
  void data;
}

/** Daily cron logic — 30/15/7 day reminders + expiry-day critical alert. */
export async function processBgExpiryReminders(companyId: string): Promise<number> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const { data: bgs, error } = await supabase
    .from('bank_guarantees')
    .select('*')
    .eq('company_id', companyId)
    .eq('status', 'active');
  if (error) throw error;

  let processed = 0;
  for (const bg of bgs ?? []) {
    const days = daysUntilExpiry(bg.expiry_date);
    const patch: Record<string, unknown> = {};
    let alertTitle = '';
    let alertMsg = '';
    let priority = 'high';

    if (days === 0 && !bg.reminder_sent_7d) {
      patch.reminder_sent_7d = true;
      patch.reminder_sent_15d = true;
      patch.reminder_sent_30d = true;
      patch.status = 'expired';
      priority = 'critical';
      alertTitle = `BG EXPIRED TODAY: ${bg.bg_number}`;
      alertMsg = `Bank guarantee ${bg.bg_number} expired today. Legal exposure — renew immediately.`;
    } else if (days <= 7 && days > 0 && !bg.reminder_sent_7d) {
      patch.reminder_sent_7d = true;
      priority = 'critical';
      alertTitle = `BG expiring in ${days} days: ${bg.bg_number}`;
      alertMsg = `URGENT — BG ${bg.bg_number} expires ${bg.expiry_date}. Notify AP Manager, CFO, and CEO.`;
    } else if (days <= 15 && days > 7 && !bg.reminder_sent_15d) {
      patch.reminder_sent_15d = true;
      priority = 'high';
      alertTitle = `BG expiring in ${days} days: ${bg.bg_number}`;
      alertMsg = `BG ${bg.bg_number} expires ${bg.expiry_date}. AP Manager + CFO notified.`;
    } else if (days <= 30 && days > 15 && !bg.reminder_sent_30d) {
      patch.reminder_sent_30d = true;
      priority = 'medium';
      alertTitle = `BG expiring in ${days} days: ${bg.bg_number}`;
      alertMsg = `BG ${bg.bg_number} expires ${bg.expiry_date}. AP team + vendor reminder sent.`;
    }

    if (Object.keys(patch).length === 0) continue;

    await supabase.from('bank_guarantees').update(patch).eq('id', bg.id);

    if (alertTitle) {
      await supabase.from('ap_alerts').insert({
        company_id: companyId,
        alert_type: days === 0 ? 'BG_EXPIRED' : 'BG_EXPIRING',
        priority,
        vendor_id: bg.vendor_id,
        title: alertTitle,
        message: alertMsg,
        metadata: { bg_id: bg.id, bg_number: bg.bg_number, days_remaining: days, amount_aed: bg.amount_aed },
        status: 'open',
      });
    }
    if (patch.status === 'expired') {
      logApAudit({
        entity_type: 'bank_guarantee',
        entity_id: bg.id,
        action: 'expired',
        action_by: 'System',
        notes: alertMsg,
      });
    }
    processed++;
  }
  return processed;
}
