import { supabase } from './supabase';
import type { AuditLogEntry } from './supabase';
import { getMyCompany } from './companyService';

export type AuditAction =
  | 'invoice.created'
  | 'invoice.updated'
  | 'invoice.deleted'
  | 'invoice.uploaded'
  | 'approval.submitted'
  | 'approval.approved'
  | 'approval.rejected'
  | 'payment.scheduled'
  | 'payment.marked_paid'
  | 'payment.batch_exported'
  | 'duplicate.cleared'
  | 'gst.reconciled'
  | 'gst.gstr2b_uploaded'
  | 'vendor.created'
  | 'vendor.updated'
  | 'invoice.matched'
  | 'tally.sync'
  | 'tally.bulk_sync';

export function getInvoiceflowWorkEmail(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem('invoiceflow_work_email');
  } catch {
    return null;
  }
}

/** Fire-and-forget; never throws to callers. */
export function logAction(
  action: AuditAction,
  entityType: string,
  entityId: string | null,
  performedBy: string | null,
  metadata: Record<string, unknown> = {}
): void {
  void (async () => {
    try {
      const co = await getMyCompany();
      if (!co?.id) return;
      const { error } = await supabase.from('audit_log').insert({
        company_id: co.id,
        entity_type: entityType,
        entity_id: entityId,
        action,
        performed_by: performedBy,
        metadata,
      });
      if (error) console.warn('[audit] insert failed:', action, error.message);
    } catch (e) {
      console.warn('[audit] failed to log:', action, e);
    }
  })();
}

export type AuditEntityCategory = 'all' | 'invoice' | 'approval' | 'payment' | 'gst' | 'vendor';

export async function getAuditLog({
  entityType,
  entityId,
  performedBy,
  from,
  to,
  page = 0,
  pageSize = 50,
  entityCategory = 'all',
}: {
  entityType?: string;
  entityId?: string;
  performedBy?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
  entityCategory?: AuditEntityCategory;
}) {
  let query = supabase
    .from('audit_log')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(page * pageSize, (page + 1) * pageSize - 1);

  if (entityCategory && entityCategory !== 'all') {
    if (entityCategory === 'vendor') {
      query = query.eq('entity_type', 'vendor');
    } else if (entityCategory === 'invoice') {
      query = query.like('action', 'invoice.%');
    } else if (entityCategory === 'approval') {
      query = query.like('action', 'approval.%');
    } else if (entityCategory === 'payment') {
      query = query.like('action', 'payment.%');
    } else if (entityCategory === 'gst') {
      query = query.like('action', 'gst.%');
    }
  }

  if (entityType) query = query.eq('entity_type', entityType);
  if (entityId) query = query.eq('entity_id', entityId);
  if (performedBy?.trim()) query = query.ilike('performed_by', `%${performedBy.trim()}%`);
  if (from) query = query.gte('created_at', from);
  if (to) {
    const end = to.length <= 10 ? `${to}T23:59:59.999Z` : to;
    query = query.lte('created_at', end);
  }

  const { data, error, count } = await query;
  if (error) throw error;
  return { entries: (data ?? []) as AuditLogEntry[], total: count ?? 0 };
}

export async function fetchAuditLogForExport(params: {
  entityCategory?: AuditEntityCategory;
  entityType?: string;
  entityId?: string;
  performedBy?: string;
  from?: string;
  to?: string;
  maxRows?: number;
}): Promise<AuditLogEntry[]> {
  const maxRows = params.maxRows ?? 5000;
  const pageSize = 500;
  const all: AuditLogEntry[] = [];
  for (let page = 0; page * pageSize < maxRows; page++) {
    const { entries, total } = await getAuditLog({
      ...params,
      page,
      pageSize,
      entityCategory: params.entityCategory ?? 'all',
    });
    all.push(...entries);
    if (entries.length < pageSize || all.length >= total || all.length >= maxRows) break;
  }
  return all;
}

export function exportAuditLogCsv(entries: AuditLogEntry[]) {
  const headers = ['Timestamp', 'Action', 'Entity Type', 'Entity ID', 'Performed By', 'Details'];
  const rows = entries.map((e) => [
    new Date(e.created_at).toLocaleString(),
    e.action,
    e.entity_type,
    e.entity_id ?? '',
    e.performed_by ?? '',
    JSON.stringify(e.metadata ?? {}),
  ]);

  const csv = [headers, ...rows]
    .map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
    .join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `audit-log-${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
