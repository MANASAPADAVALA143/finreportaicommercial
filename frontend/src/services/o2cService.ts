/** O2C summary — GET /api/o2c/summary */

import { backendOrigin } from '../utils/backendOrigin';

const BASE = `${backendOrigin()}/api/o2c`;

function hdrs(): Record<string, string> {
  const wsId = localStorage.getItem('gnanova_workspace_id') ?? localStorage.getItem('tenantId');
  return {
    'Content-Type': 'application/json',
    'X-Workspace-ID': wsId,
    'X-Tenant-ID': wsId,
  };
}

export interface O2CSummary {
  kpis: {
    dso_current: number;
    dso_vs_benchmark: number;
    dso_vs_benchmark_label: string;
    industry_benchmark: number;
    collections_efficiency_pct: number;
    portfolio_risk_score: number;
    expected_cash_30_days: number;
    total_overdue_aed: number;
    total_outstanding_aed: number;
  };
  pipeline: {
    stages: Array<{ stage: string; count: number; value_aed: number }>;
    won_this_month_count: number;
    won_this_month_revenue_aed: number;
  };
  ar_status: {
    by_status: Array<{ status: string; count: number; amount_aed: number }>;
    aging_buckets: Array<{ bucket: string; amount_aed: number }>;
  };
  credit_risk: {
    distribution: { low: number; medium: number; high: number; critical: number };
    top_risk_customers: Array<{
      customer_name: string;
      credit_score: number;
      risk_category: string;
      total_outstanding_aed: number;
    }>;
  };
  cash_forecast: {
    next_30_days: number;
    next_60_days: number;
    next_90_days: number;
    chart: Array<{ period: string; amount: number }>;
  };
  collections_activity: {
    recent_dunning: Array<{ invoice_number: string; customer: string; level: number; sent_at: string | null }>;
    payments_this_week: Array<{ invoice_number: string; customer: string; amount: number; paid_date: string }>;
    payments_this_week_total: number;
  };
  currency: string;
  generated_at: string;
}

export async function fetchO2CSummary(companyId: string): Promise<O2CSummary> {
  const wsId = localStorage.getItem('gnanova_workspace_id');
  const q = new URLSearchParams({ company_id: companyId, workspace_id: wsId }).toString();
  const res = await fetch(`${BASE}/summary?${q}`, { headers: hdrs() });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
