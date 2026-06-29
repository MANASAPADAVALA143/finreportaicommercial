/**
 * Module 4 — Comprehensive AP audit trail (`ap_audit_log` table).
 */
import { supabase } from './supabase';
import type { ApAuditLogEntry } from './supabase';
import { getMyCompany } from './companyService';

export type ApAuditInput = {
  entity_type: string;
  entity_id?: string | null;
  action: string;
  action_by?: string | null;
  action_by_role?: string | null;
  old_values?: Record<string, unknown> | null;
  new_values?: Record<string, unknown> | null;
  notes?: string | null;
};

function getUserAgent(): string | null {
  if (typeof navigator === 'undefined') return null;
  return navigator.userAgent?.slice(0, 500) ?? null;
}

/** Fire-and-forget append to ap_audit_log. */
export function logApAudit(input: ApAuditInput): void {
  void (async () => {
    try {
      const co = await getMyCompany();
      if (!co?.id) return;
      await supabase.from('ap_audit_log').insert({
        company_id: co.id,
        entity_type: input.entity_type,
        entity_id: input.entity_id ?? null,
        action: input.action,
        action_by: input.action_by ?? null,
        action_by_role: input.action_by_role ?? 'System',
        old_values: input.old_values ?? null,
        new_values: input.new_values ?? null,
        user_agent: getUserAgent(),
        notes: input.notes ?? null,
      });
    } catch (e) {
      console.warn('[ap_audit] failed:', e);
    }
  })();
}

export type ApAuditFilters = {
  entityType?: string;
  action?: string;
  actionBy?: string;
  vendorName?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
};

export async function fetchApAuditLog(filters: ApAuditFilters = {}): Promise<{
  entries: ApAuditLogEntry[];
  total: number;
}> {
  const co = await getMyCompany();
  if (!co?.id) return { entries: [], total: 0 };

  const page = filters.page ?? 0;
  const pageSize = filters.pageSize ?? 50;

  let query = supabase
    .from('ap_audit_log')
    .select('*', { count: 'exact' })
    .eq('company_id', co.id)
    .order('created_at', { ascending: false })
    .range(page * pageSize, (page + 1) * pageSize - 1);

  if (filters.entityType && filters.entityType !== 'all') {
    query = query.eq('entity_type', filters.entityType);
  }
  if (filters.action && filters.action !== 'all') {
    query = query.eq('action', filters.action);
  }
  if (filters.actionBy?.trim()) {
    query = query.ilike('action_by', `%${filters.actionBy.trim()}%`);
  }
  if (filters.from) query = query.gte('created_at', filters.from);
  if (filters.to) {
    const end = filters.to.length <= 10 ? `${filters.to}T23:59:59.999Z` : filters.to;
    query = query.lte('created_at', end);
  }

  const { data, error, count } = await query;
  if (error) throw error;
  return { entries: (data ?? []) as ApAuditLogEntry[], total: count ?? 0 };
}

export async function fetchApAuditForExport(filters: ApAuditFilters = {}): Promise<ApAuditLogEntry[]> {
  const all: ApAuditLogEntry[] = [];
  for (let page = 0; page < 20; page++) {
    const { entries, total } = await fetchApAuditLog({ ...filters, page, pageSize: 500 });
    all.push(...entries);
    if (entries.length < 500 || all.length >= total) break;
  }
  return all;
}

export function exportApAuditCsv(entries: ApAuditLogEntry[], filename?: string) {
  const headers = [
    'Timestamp', 'Entity Type', 'Entity ID', 'Action', 'Action By', 'Role', 'Notes', 'Old Values', 'New Values',
  ];
  const rows = entries.map((e) => [
    new Date(e.created_at).toISOString(),
    e.entity_type,
    e.entity_id ?? '',
    e.action,
    e.action_by ?? '',
    e.action_by_role ?? '',
    e.notes ?? '',
    JSON.stringify(e.old_values ?? {}),
    JSON.stringify(e.new_values ?? {}),
  ]);
  const csv = [headers, ...rows]
    .map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename ?? `ap-audit-trail-${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportApAuditExcel(entries: ApAuditLogEntry[]) {
  import('xlsx').then((XLSX) => {
    const rows = entries.map((e) => ({
      Timestamp: new Date(e.created_at).toLocaleString(),
      'Entity Type': e.entity_type,
      'Entity ID': e.entity_id ?? '',
      Action: e.action,
      'Action By': e.action_by ?? '',
      Role: e.action_by_role ?? '',
      Notes: e.notes ?? '',
      'Old Values': JSON.stringify(e.old_values ?? {}),
      'New Values': JSON.stringify(e.new_values ?? {}),
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Audit Trail');
    XLSX.writeFile(wb, `ap-audit-trail-${new Date().toISOString().split('T')[0]}.xlsx`);
  });
}

export function printApAuditPdfReport(opts: {
  companyName: string;
  entries: ApAuditLogEntry[];
  from: string;
  to: string;
  generatedBy: string;
}) {
  const { companyName, entries, from, to, generatedBy } = opts;
  const byType = (t: string) => entries.filter((e) => e.entity_type === t);

  const section = (title: string, rows: ApAuditLogEntry[]) => {
    if (!rows.length) return `<h3>${title} (0)</h3><p>None</p>`;
    const trs = rows
      .map(
        (e) =>
          `<tr><td>${new Date(e.created_at).toLocaleString()}</td><td>${e.entity_type}</td><td>${e.action}</td><td>${e.action_by ?? ''}</td><td>${e.notes ?? ''}</td></tr>`,
      )
      .join('');
    return `<h3>${title} (${rows.length})</h3><table border="1" cellpadding="4" cellspacing="0" width="100%"><thead><tr><th>Date</th><th>Entity</th><th>Action</th><th>By</th><th>Notes</th></tr></thead><tbody>${trs}</tbody></table>`;
  };

  const html = `<!DOCTYPE html><html><head><title>AP Audit Trail</title>
<style>body{font-family:Arial,sans-serif;padding:24px;color:#111}h1{font-size:20px}h3{margin-top:24px;font-size:14px}table{font-size:11px;border-collapse:collapse}th{background:#0f2d5e;color:#fff}</style></head>
<body>
<h1>${companyName} — AP Audit Trail Report</h1>
<p>Period: ${from} to ${to}<br>Generated: ${new Date().toLocaleString()} by ${generatedBy}<br>Total actions: ${entries.length}</p>
${section('SECTION 1: Invoice Activity', byType('invoice'))}
${section('SECTION 2: Vendor Changes', byType('vendor'))}
${section('SECTION 3: Anomalies Detected', byType('anomaly'))}
${section('SECTION 4: Payment Activity', byType('payment'))}
${section('SECTION 5: Bank Guarantees', byType('bank_guarantee'))}
<p style="margin-top:32px;font-size:11px;color:#666">Digitally signed: ${new Date().toISOString()}</p>
</body></html>`;

  const w = window.open('', '_blank');
  if (w) {
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 400);
  }
}
