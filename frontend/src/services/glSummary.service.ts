/** UAE GL summary for FP&A — GET /api/integration/gl-summary */

import { backendOrigin } from '../utils/backendOrigin';

export interface GLSummary {
  has_data: boolean;
  je_count: number;
  currency: string;
  period: { start: string; end: string };
  revenue: number;
  cogs: number;
  gross_profit: number;
  opex: number;
  ebitda: number;
  other_income: number;
  net_profit: number;
  gross_margin: number;
  ebitda_margin: number;
  net_margin: number;
  assets: number;
  liabilities: number;
  equity: number;
  cash: number;
  trade_receivables: number;
  trade_payables: number;
}

function hdrs(): Record<string, string> {
  const wsId = localStorage.getItem('gnanova_workspace_id') ?? localStorage.getItem('tenantId');
  return {
    'Content-Type': 'application/json',
    'X-Workspace-ID': wsId,
    'X-Tenant-ID': wsId,
  };
}

export async function fetchGLSummary(
  companyId: string,
  workspaceId: string,
  periodStart: string,
  periodEnd: string,
): Promise<GLSummary> {
  const params = new URLSearchParams({
    company_id: companyId,
    workspace_id: workspaceId,
    period_start: periodStart,
    period_end: periodEnd,
  });
  const base = import.meta.env.VITE_API_URL?.trim() || backendOrigin();
  const res = await fetch(`${base}/api/integration/gl-summary?${params}`, { headers: hdrs() });
  if (!res.ok) throw new Error('GL summary failed');
  return res.json();
}

export function getCurrentPeriod(): { start: string; end: string } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return {
    start: start.toISOString().split('T')[0],
    end: end.toISOString().split('T')[0],
  };
}

/** Map GL summary to variance analysis rows (budget = prior month proxy at 95%/105%). */
export function glSummaryToVarianceRows(summary: GLSummary) {
  const mk = (category: string, actual: number, accountType: 'income' | 'expense', budgetFactor: number) => {
    const budget = actual * budgetFactor;
    const variance = actual - budget;
    const variancePct = budget !== 0 ? (variance / budget) * 100 : 0;
    return {
      id: `gl-${category.toLowerCase().replace(/\s+/g, '-')}`,
      category,
      isHeader: false,
      actual,
      budget,
      variance,
      variancePct,
      favorable: accountType === 'income' ? variance >= 0 : variance <= 0,
      ytdActual: actual,
      ytdBudget: budget,
      ytdVariance: variance,
      ytdVariancePct: variancePct,
      priorYear: 0,
      priorYearVariancePct: 0,
      hasChildren: false,
      isExpanded: false,
      threshold: 'ok' as const,
      level: 0,
      department: 'All Depts',
      owner: 'CFO',
      trend: [],
      accountType,
    };
  };
  return [
    mk('Revenue', summary.revenue, 'income', 0.95),
    mk('Cost of Goods Sold', summary.cogs, 'expense', 1.05),
    mk('Operating Expenses', summary.opex, 'expense', 1.05),
    mk('Gross Profit', summary.gross_profit, 'income', 0.95),
    mk('EBITDA', summary.ebitda, 'income', 0.95),
    mk('Net Profit', summary.net_profit, 'income', 0.95),
  ];
}

/** Build KPI dashboard objects from GL summary. */
export function glSummaryToKPIs(summary: GLSummary) {
  const fmt = (n: number) => n;
  return {
    revenueKPIs: [{
      id: 'total-revenue',
      name: 'Total Revenue',
      value: fmt(summary.revenue),
      target: summary.revenue * 0.95,
      variance: 5,
      status: 'good' as const,
      trend: 'up' as const,
      unit: 'currency' as const,
      source: 'UAE GL',
    }],
    profitabilityKPIs: [
      {
        id: 'gross-margin',
        name: 'Gross Margin %',
        value: summary.gross_margin,
        target: summary.gross_margin,
        variance: 0,
        status: 'good' as const,
        trend: 'up' as const,
        unit: 'percentage' as const,
        source: 'UAE GL',
      },
      {
        id: 'ebitda-margin',
        name: 'EBITDA Margin %',
        value: summary.ebitda_margin,
        target: summary.ebitda_margin,
        variance: 0,
        status: 'good' as const,
        trend: 'up' as const,
        unit: 'percentage' as const,
        source: 'UAE GL',
      },
      {
        id: 'net-profit',
        name: 'Net Profit',
        value: fmt(summary.net_profit),
        target: summary.net_profit,
        variance: 0,
        status: 'good' as const,
        trend: 'up' as const,
        unit: 'currency' as const,
        source: 'UAE GL',
      },
    ],
    liquidityKPIs: [{
      id: 'cash',
      name: 'Cash Balance',
      value: fmt(summary.cash),
      target: summary.cash,
      variance: 0,
      status: 'good' as const,
      trend: 'up' as const,
      unit: 'currency' as const,
      source: 'UAE GL',
    }],
    efficiencyKPIs: [],
  };
}
