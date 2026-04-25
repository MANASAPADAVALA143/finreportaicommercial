/**
 * CFO Command Center — trigger agents and manage alerts (X-Tenant-ID scoped).
 */

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
  tenantId?: string
): Promise<{ cfo_run_id: string; id: number; agent: string; status: string }> {
  const tid = tenantId ?? getCfoTenantId();
  const r = await fetch(`${getCfoApiBase()}/api/agents/run/${encodeURIComponent(agent)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tid },
    body: JSON.stringify({ context }),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function dismissCfoAlert(alertId: number, tenantId?: string): Promise<void> {
  const tid = tenantId ?? getCfoTenantId();
  const r = await fetch(`${getCfoApiBase()}/api/agents/alerts/${alertId}/dismiss`, {
    method: 'PATCH',
    headers: { 'X-Tenant-ID': tid },
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
  tenantId?: string
): Promise<{ window_hours: number; completed: CompletedAgentItem[] }> {
  const tid = tenantId ?? getCfoTenantId();
  const r = await fetch(`${getCfoApiBase()}/api/agents/completed?hours=${hours}`, {
    headers: { 'X-Tenant-ID': tid },
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
