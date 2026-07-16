import { supabase } from '@/lib/ap-invoice/supabase';
import type { ApprovalRule, Invoice, InvoiceApprovalRow } from '@/lib/ap-invoice/supabase';
import { notifyApprovalEvent } from '@/lib/ap-invoice/approvalNotifications';
import { logAction } from '@/lib/ap-invoice/auditService';
import { recalcVendorRiskAsync } from '@/lib/ap-invoice/vendorMasterService';
import { requireCompanyId } from '@/lib/ap-invoice/companyService';
import { notifyApproverViaWhatsApp, notifyVendorStatusByInvoiceId } from '@/lib/ap-invoice/whatsappService';
import type { ApproveAndPostResult } from '@/lib/ap-invoice/glPostService';

export type ChainApprovalStatus = 'not_required' | 'pending' | 'approved' | 'rejected';
export type ApprovalRowStatus = 'pending' | 'approved' | 'rejected';

function normEmail(s: string) {
  return s.trim().toLowerCase();
}

export function emailsMatch(a: string, b: string) {
  return normEmail(a) === normEmail(b);
}

/** Pick the most specific rule: highest min_amount that still matches amount & department. */
export function pickApprovalRule(
  rules: ApprovalRule[],
  amount: number,
  department: string | null | undefined
): ApprovalRule | null {
  const dept = department?.trim() || null;
  const candidates = rules.filter((r) => {
    if (Number(amount) < Number(r.min_amount)) return false;
    if (r.max_amount != null && Number(amount) > Number(r.max_amount)) return false;
    if (r.department && r.department.trim()) {
      if (!dept || r.department.trim().toLowerCase() !== dept.toLowerCase()) return false;
    }
    return true;
  });
  if (candidates.length === 0) return null;
  return [...candidates].sort((a, b) => Number(b.min_amount) - Number(a.min_amount))[0];
}

function approverList(rule: ApprovalRule): string[] {
  const n = Math.min(Math.max(1, rule.required_approvers), rule.approver_emails.length);
  return rule.approver_emails.slice(0, n).map((e) => e.trim()).filter(Boolean);
}

export async function fetchApprovalRules(): Promise<ApprovalRule[]> {
  const { data, error } = await supabase.from('approval_rules').select('*').order('min_amount', { ascending: true });
  if (error) throw error;
  return (data || []) as ApprovalRule[];
}

export async function fetchInvoiceApprovalRows(invoiceId: string): Promise<InvoiceApprovalRow[]> {
  const { data, error } = await supabase
    .from('invoice_approvals')
    .select('*')
    .eq('invoice_id', invoiceId)
    .order('step_index', { ascending: true });
  if (error) throw error;
  return (data || []) as InvoiceApprovalRow[];
}

export async function submitInvoiceForApproval(
  invoice: Invoice,
  submitterEmail: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (invoice.status !== 'Processing') {
    return { ok: false, message: 'Only invoices in Processing status can be submitted for approval.' };
  }
  const chainStatus = invoice.approval_status ?? 'not_required';
  if (chainStatus !== 'not_required') {
    return { ok: false, message: 'This invoice is already in an approval workflow.' };
  }

  const rules = await fetchApprovalRules();
  const rule = pickApprovalRule(rules, Number(invoice.total_amount), invoice.department);
  if (!rule) {
    return { ok: false, message: 'No approval rule matches this amount / department.' };
  }
  const chain = approverList(rule);
  if (chain.length === 0) {
    return { ok: false, message: 'Rule has no approver emails configured.' };
  }

  const { error: delErr } = await supabase.from('invoice_approvals').delete().eq('invoice_id', invoice.id);
  if (delErr) return { ok: false, message: delErr.message };

  const { data: insData, error: insErr } = await supabase
    .from('invoice_approvals')
    .insert({ invoice_id: invoice.id, step_index: 0, approver_email: chain[0], status: 'pending' })
    .select('id')
    .single();
  if (insErr) return { ok: false, message: insErr.message };
  const approvalRowId: string = (insData as { id: string }).id;

  const { error: upErr } = await supabase
    .from('invoices')
    .update({
      approval_status: 'pending',
      current_approver_index: 0,
      approval_rule_id: rule.id,
      approval_chain_emails: chain,
      approval_total_steps: chain.length,
      submitted_for_approval_at: new Date().toISOString(),
      approval_submitted_by: submitterEmail.trim(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', invoice.id);
  if (upErr) return { ok: false, message: upErr.message };

  await supabase.from('audit_logs').insert({
    invoice_id: invoice.id,
    action: 'Submitted for approval',
    field_changed: 'approval_status',
    old_value: 'not_required',
    new_value: 'pending',
    user_name: submitterEmail.trim(),
  });

  void notifyApprovalEvent({
    type: 'approver_assigned',
    invoice_id: invoice.id,
    invoice_number: invoice.invoice_number,
    approver_email: chain[0]!,
    step_index: 0,
    total_steps: chain.length,
  });

  // WhatsApp one-tap — use approver's phone from the rule (index matches approver_emails)
  const approverPhone = rule.approver_phones?.[0] ?? null;
  void notifyApproverViaWhatsApp(
    approvalRowId,
    chain[0]!,
    approverPhone,
    invoice.invoice_number,
    invoice.vendor_name,
    Number(invoice.total_amount),
    invoice.currency
  );

  logAction('approval.submitted', 'invoice', invoice.id, submitterEmail.trim(), {
    steps: chain.length,
  });

  return { ok: true };
}

export async function processApprovalAction(
  approvalRowId: string,
  actorEmail: string,
  action: 'approved' | 'rejected',
  comment?: string | null
): Promise<
  | { ok: true; fully_approved?: boolean; gl_post?: ApproveAndPostResult }
  | { ok: false; message: string }
> {
  const { data: row, error: rowErr } = await supabase
    .from('invoice_approvals')
    .select('*')
    .eq('id', approvalRowId)
    .single();
  if (rowErr || !row) return { ok: false, message: rowErr?.message || 'Approval row not found' };

  const ar = row as InvoiceApprovalRow;
  if (ar.status !== 'pending') {
    return { ok: false, message: 'This approval step is no longer pending.' };
  }
  if (!emailsMatch(ar.approver_email, actorEmail)) {
    return { ok: false, message: 'You are not the assigned approver for this step.' };
  }

  const { data: inv, error: invErr } = await supabase.from('invoices').select('*').eq('id', ar.invoice_id).single();
  if (invErr || !inv) return { ok: false, message: 'Invoice not found' };
  const invoice = inv as Invoice;

  let resolvedChain: string[] = Array.isArray(invoice.approval_chain_emails) ? [...invoice.approval_chain_emails] : [];
  if (resolvedChain.length === 0 && invoice.approval_rule_id) {
    const { data: ruleRow } = await supabase.from('approval_rules').select('*').eq('id', invoice.approval_rule_id).maybeSingle();
    const rule = ruleRow as ApprovalRule | null;
    if (rule) resolvedChain = approverList(rule);
  }
  const totalSteps =
    typeof invoice.approval_total_steps === 'number' && invoice.approval_total_steps > 0
      ? invoice.approval_total_steps
      : resolvedChain.length;

  const now = new Date().toISOString();

  if (action === 'rejected') {
    const { error: u1 } = await supabase
      .from('invoice_approvals')
      .update({
        status: 'rejected',
        comment: comment?.trim() || null,
        actioned_at: now,
      })
      .eq('id', approvalRowId);
    if (u1) return { ok: false, message: u1.message };

    const { error: u2 } = await supabase
      .from('invoices')
      .update({
        approval_status: 'rejected',
        status: 'Rejected',
        rejection_reason: comment?.trim() || 'Rejected in approval chain',
        updated_at: now,
      })
      .eq('id', invoice.id);
    if (u2) return { ok: false, message: u2.message };

    await supabase.from('audit_logs').insert({
      invoice_id: invoice.id,
      action: 'Approval rejected',
      field_changed: 'approval_status',
      old_value: 'pending',
      new_value: 'rejected',
      user_name: actorEmail.trim(),
    });

    logAction('approval.rejected', 'invoice', invoice.id, actorEmail.trim(), {
      comment: comment?.trim() ?? null,
    });
    recalcVendorRiskAsync(invoice.vendor_name);

    if (invoice.approval_submitted_by) {
      void notifyApprovalEvent({
        type: 'submitter_notified',
        invoice_id: invoice.id,
        invoice_number: invoice.invoice_number,
        submitter_email: invoice.approval_submitted_by,
        outcome: 'rejected',
        comment: comment?.trim() || undefined,
      });
    }
    return { ok: true };
  }

  const { error: u1 } = await supabase
    .from('invoice_approvals')
    .update({
      status: 'approved',
      comment: comment?.trim() || null,
      actioned_at: now,
    })
    .eq('id', approvalRowId);
  if (u1) return { ok: false, message: u1.message };

  const nextIndex = ar.step_index + 1;
  if (resolvedChain.length > 0 && nextIndex < totalSteps && nextIndex < resolvedChain.length) {
    const nextEmail = resolvedChain[nextIndex];
    if (!nextEmail) return { ok: false, message: 'Missing next approver on chain.' };
    const { error: ins } = await supabase.from('invoice_approvals').insert({
      invoice_id: invoice.id,
      step_index: nextIndex,
      approver_email: nextEmail,
      status: 'pending',
    });
    if (ins) return { ok: false, message: ins.message };

    const { error: u2 } = await supabase
      .from('invoices')
      .update({
        current_approver_index: nextIndex,
        updated_at: now,
      })
      .eq('id', invoice.id);
    if (u2) return { ok: false, message: u2.message };

    await supabase.from('audit_logs').insert({
      invoice_id: invoice.id,
      action: 'Approval step approved',
      field_changed: 'current_approver_index',
      old_value: String(ar.step_index),
      new_value: String(nextIndex),
      user_name: actorEmail.trim(),
    });

    logAction('approval.approved', 'invoice', invoice.id, actorEmail.trim(), {
      step: ar.step_index,
      advanced_to: nextIndex,
    });
    recalcVendorRiskAsync(invoice.vendor_name);

    void notifyApprovalEvent({
      type: 'approver_assigned',
      invoice_id: invoice.id,
      invoice_number: invoice.invoice_number,
      approver_email: nextEmail,
      step_index: nextIndex,
      total_steps: totalSteps,
    });
    return { ok: true };
  }

  const { data: authData } = await supabase.auth.getUser();
  const approverUserId = authData.user?.id ?? null;

  const { error: fin } = await supabase
    .from('invoices')
    .update({
      approval_status: 'approved',
      status: 'Approved',
      approved_by: approverUserId,
      approved_at: now,
      updated_at: now,
    })
    .eq('id', invoice.id);
  if (fin) return { ok: false, message: fin.message };

  await supabase.from('audit_logs').insert({
    invoice_id: invoice.id,
    action: 'Fully approved',
    field_changed: 'status',
    old_value: invoice.status,
    new_value: 'Approved',
    user_name: actorEmail.trim(),
  });

  logAction('approval.approved', 'invoice', invoice.id, actorEmail.trim(), { step: ar.step_index });
  recalcVendorRiskAsync(invoice.vendor_name);

  if (invoice.approval_submitted_by) {
    void notifyApprovalEvent({
      type: 'submitter_notified',
      invoice_id: invoice.id,
      invoice_number: invoice.invoice_number,
      submitter_email: invoice.approval_submitted_by,
      outcome: 'approved',
    });
  }

  // Post to UAE GL + GulfTax (idempotent — shared with all approval paths)
  let gl_post: ApproveAndPostResult | undefined;
  try {
    const cid = invoice.company_id || (await requireCompanyId());
    const { postApprovedInvoiceToGL } = await import('./glPostService');
    gl_post = await postApprovedInvoiceToGL(invoice, cid);
  } catch (e) {
    console.warn('[AP] GL/GulfTax post after full approval failed:', e);
  }

  void notifyVendorStatusByInvoiceId(invoice.id, 'Approved');

  return { ok: true, fully_approved: true, gl_post };
}

async function loadInvoicesByIds(ids: string[]): Promise<Map<string, Invoice>> {
  const uniq = [...new Set(ids)].filter(Boolean);
  const map = new Map<string, Invoice>();
  if (uniq.length === 0) return map;
  const { data, error } = await supabase.from('invoices').select('*').in('id', uniq);
  if (error) throw error;
  for (const row of data || []) {
    map.set((row as Invoice).id, row as Invoice);
  }
  return map;
}

export async function fetchPendingApprovalsForEmail(email: string): Promise<
  Array<{
    approval: InvoiceApprovalRow;
    invoice: Invoice;
  }>
> {
  const e = normEmail(email);
  const { data, error } = await supabase.from('invoice_approvals').select('*').eq('status', 'pending');
  if (error) throw error;
  const rows = (data || []) as InvoiceApprovalRow[];
  const mine = rows.filter((r) => normEmail(r.approver_email) === e);
  const invMap = await loadInvoicesByIds(mine.map((r) => r.invoice_id));
  return mine
    .map((r) => {
      const invoice = invMap.get(r.invoice_id);
      if (!invoice) return null;
      return { approval: r, invoice };
    })
    .filter((x): x is { approval: InvoiceApprovalRow; invoice: Invoice } => x != null);
}

export async function fetchMyApprovalHistory(
  email: string,
  status: 'approved' | 'rejected'
): Promise<Array<{ approval: InvoiceApprovalRow; invoice: Invoice }>> {
  const e = normEmail(email);
  const { data, error } = await supabase.from('invoice_approvals').select('*').eq('status', status);
  if (error) throw error;
  const rows = (data || []) as InvoiceApprovalRow[];
  const mine = rows.filter((r) => normEmail(r.approver_email) === e);
  const invMap = await loadInvoicesByIds(mine.map((r) => r.invoice_id));
  return mine
    .map((r) => {
      const invoice = invMap.get(r.invoice_id);
      if (!invoice) return null;
      return { approval: r, invoice };
    })
    .filter((x): x is { approval: InvoiceApprovalRow; invoice: Invoice } => x != null);
}

export async function saveApprovalRule(rule: Partial<ApprovalRule> & { min_amount: number; required_approvers: number; approver_emails: string[] }) {
  const company_id = await requireCompanyId();
  const fields = {
    min_amount: rule.min_amount,
    max_amount: rule.max_amount ?? null,
    required_approvers: rule.required_approvers,
    approver_emails: rule.approver_emails,
    approver_phones: rule.approver_phones?.length ? rule.approver_phones : null,
    department: rule.department?.trim() || null,
  };
  if (rule.id) {
    const { error } = await supabase.from('approval_rules').update(fields).eq('id', rule.id);
    if (error) throw error;
  } else {
    const { error } = await supabase.from('approval_rules').insert({ ...fields, company_id });
    if (error) throw error;
  }
}

export async function deleteApprovalRule(id: string) {
  const { error } = await supabase.from('approval_rules').delete().eq('id', id);
  if (error) throw error;
}
