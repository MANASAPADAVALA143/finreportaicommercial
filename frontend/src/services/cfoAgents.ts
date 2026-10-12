/**
 * CFO Command Center — trigger agents and manage alerts (scoped to the active workspace by the server).
 */
import { workspaceHeaders } from '../utils/workspaceHeaders';

export function getCfoApiBase(): string {
  return (import.meta.env.VITE_API_URL && String(import.meta.env.VITE_API_URL).trim()) || 'http://localhost:8000';
}

export function getCfoTenantId(): string {
  try {
    const v = localStorage.getItem('cfo_tenant_id');
    if (v && String(v).trim()) return String(v).trim();
  } catch {
    /* ignore */
  }
  return 'default';
}

export async function postCfoAgentRun(
  agent: string,
  context: Record<string, unknown>,
  _tenantId?: string
): Promise<{ cfo_run_id: string; id: number; agent: string; status: string }> {
  const r = await fetch(`${getCfoApiBase()}/api/agents/run/${encodeURIComponent(agent)}`, {
    method: 'POST',
    headers: workspaceHeaders(null),
    credentials: 'include',
    body: JSON.stringify({ context }),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function dismissCfoAlert(alertId: number, _tenantId?: string): Promise<void> {
  const r = await fetch(`${getCfoApiBase()}/api/agents/alerts/${alertId}/dismiss`, {
    method: 'PATCH',
    headers: workspaceHeaders(null),
    credentials: 'include',
  });
  if (!r.ok) throw new Error(await r.text());
}

export type CompletedAgentItem = {
  agent: string;
  run_id: string;
  completed_at: string | null;
  checks_passed: number;
  checks_total: number;
  all_checks_passed: boolean;
  row_count: number;
  audit?: { items?: Array<{ label: string; ok: boolean }> } | null;
};

export async function fetchCompletedAgents(
  hours = 24,
  _tenantId?: string
): Promise<{ window_hours: number; completed: CompletedAgentItem[] }> {
  const r = await fetch(`${getCfoApiBase()}/api/agents/completed?hours=${hours}`, {
    headers: workspaceHeaders(null),
    credentials: 'include',
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
