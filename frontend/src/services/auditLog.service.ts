/** Workspace audit log — GET /api/audit/log */

import { backendOrigin } from '../utils/backendOrigin';

export interface AuditLogEntry {
  id: string;
  workspace_id: string;
  company_id?: string | null;
  action: string;
  entity_type: string;
  entity_id?: string | null;
  user_email?: string | null;
  details?: Record<string, unknown>;
  created_at: string;
}

export interface AuditLogFilters {
  workspace_id?: string;
  company_id?: string;
  from_date?: string;
  to_date?: string;
  action?: string;
  page?: number;
  page_size?: number;
}

function hdrs(): Record<string, string> {
  const wsId = localStorage.getItem('gnanova_workspace_id') ?? localStorage.getItem('tenantId');
  return {
    'Content-Type': 'application/json',
    'X-Workspace-ID': wsId,
    'X-Tenant-ID': wsId,
  };
}

export async function fetchAuditLog(filters: AuditLogFilters = {}): Promise<{
  entries: AuditLogEntry[];
  total: number;
}> {
  const params = new URLSearchParams();
  const wsId = filters.workspace_id ?? localStorage.getItem('gnanova_workspace_id');
  params.set('workspace_id', wsId);
  const cid = filters.company_id ?? localStorage.getItem('active_company_id');
  if (cid) params.set('company_id', cid);
  if (filters.from_date) params.set('from_date', filters.from_date);
  if (filters.to_date) params.set('to_date', filters.to_date);
  if (filters.action) params.set('action', filters.action);
  params.set('page', String(filters.page ?? 0));
  params.set('page_size', String(filters.page_size ?? 50));

  const res = await fetch(`${backendOrigin()}/api/audit/log?${params}`, { headers: hdrs() });
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  return { entries: data.entries ?? [], total: data.total ?? 0 };
}

export function exportAuditCsv(entries: AuditLogEntry[]): void {
  const header = ['Date', 'User', 'Action', 'Entity Type', 'Entity ID', 'Details'];
  const rows = entries.map(e => [
    e.created_at,
    e.user_email ?? '',
    e.action,
    e.entity_type,
    e.entity_id ?? '',
    JSON.stringify(e.details ?? {}),
  ]);
  const csv = [header, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
