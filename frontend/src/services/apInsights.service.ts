import { workspaceHeaders } from '@/services/workspaceService';

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

const EMPTY_SUMMARY: APSummary = {
  total_billed: 0,
  total_paid: 0,
  open_balance: 0,
  overdue_amount: 0,
  dpo: 0,
  payment_rate_pct: 0,
};

export async function generateAPInsights(
  workspaceId: string,
  companyId: string | null,
): Promise<APInsightsResponse> {
  if (!companyId) {
    return { insights: [], summary: EMPTY_SUMMARY, empty: true, message: 'Select a company to see insights.' };
  }
  const res = await fetch(`${API_BASE}/api/ap/generate-insights`, {
    method: 'POST',
    headers: workspaceHeaders(null),
    credentials: 'include',
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
