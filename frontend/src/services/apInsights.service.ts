const API_BASE = (import.meta as any).env?.VITE_API_URL ?? 'http://localhost:8000';

export interface InsightCard {
  id: string;
  title: string;
  priority: 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
  icon: 'alert' | 'vendor' | 'recon' | 'aging';
  amount_at_risk: number;
  actions: string[];
}

export interface APSummary {
  total_billed: number;
  total_paid: number;
  open_balance: number;
  overdue_amount: number;
  dpo: number;
  payment_rate_pct: number;
}

export interface APInsightsResponse {
  insights: InsightCard[];
  summary: APSummary;
  empty?: boolean;
  message?: string;
  generated_at?: string;
}

function hdrs(): Record<string, string> {
  const wsId =
    localStorage.getItem('gnanova_workspace_id') ??
    localStorage.getItem('active_workspace_id') ??
    localStorage.getItem('tenantId') ??
    '';
  return {
    'Content-Type': 'application/json',
    'X-Workspace-ID': wsId,
    'X-Tenant-ID': wsId,
  };
}

export async function generateAPInsights(
  workspaceId: string,
  companyId: string | null,
): Promise<APInsightsResponse> {
  const res = await fetch(`${API_BASE}/api/ap/generate-insights`, {
    method: 'POST',
    headers: hdrs(),
    body: JSON.stringify({
      workspace_id: workspaceId,
      company_id: companyId,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Insights failed (${res.status})`);
  }
  return res.json();
}
