/** Revenue leakage rollup from three-way match exceptions (presentation layer only). */

export interface ThreeWayMatchItem {
  contract_id: string;
  customer?: string;
  billing_amount?: number | null;
  gl_amount?: number | null;
  schedule_amount?: number | null;
  status: string;
  difference?: number;
}

export interface LeakageItem {
  contract_id: string;
  customer: string;
  status: string;
  leakage_amount: number;
  billing_amount: number | null;
  gl_amount: number | null;
  schedule_amount: number | null;
  difference?: number;
}

export interface LeakageSummary {
  period: string;
  leakage_total: number;
  leakage_pct: number;
  expected_revenue_total: number;
  item_count: number;
  items: LeakageItem[];
  prior_period?: string | null;
  prior_leakage_total?: number | null;
  trend_amount?: number | null;
  trend_direction?: 'increase' | 'decrease' | 'flat' | 'none' | null;
  saved_at?: string | null;
}

export function expectedRevenueAmount(item: ThreeWayMatchItem): number {
  if (item.schedule_amount != null) return Number(item.schedule_amount);
  if (item.gl_amount != null) return Number(item.gl_amount);
  return 0;
}

export function isLeakageException(item: ThreeWayMatchItem): boolean {
  const status = item.status;
  const diff = Number(item.difference ?? 0);
  if (status === 'missing_billing') return true;
  if (status === 'billing_gl_diff' && diff < 0) return true;
  return false;
}

export function leakageAmountForItem(item: ThreeWayMatchItem): number {
  const status = item.status;
  const diff = Number(item.difference ?? 0);
  if (status === 'missing_billing') return Math.abs(diff);
  if (status === 'billing_gl_diff' && diff < 0) return Math.abs(diff);
  return 0;
}

export function computeLeakageSummary(items: ThreeWayMatchItem[], period: string): LeakageSummary {
  const leakageItems: LeakageItem[] = [];
  let expectedTotal = 0;

  for (const raw of items) {
    expectedTotal += expectedRevenueAmount(raw);
    if (!isLeakageException(raw)) continue;
    const amt = leakageAmountForItem(raw);
    if (amt <= 0) continue;
    leakageItems.push({
      contract_id: String(raw.contract_id),
      customer: String(raw.customer || 'Unknown'),
      status: raw.status,
      leakage_amount: Math.round(amt * 100) / 100,
      billing_amount: raw.billing_amount ?? null,
      gl_amount: raw.gl_amount ?? null,
      schedule_amount: raw.schedule_amount ?? null,
      difference: raw.difference,
    });
  }

  const leakageTotal = Math.round(leakageItems.reduce((s, i) => s + i.leakage_amount, 0) * 100) / 100;
  const leakagePct = expectedTotal
    ? Math.round((leakageTotal / expectedTotal) * 10000) / 100
    : 0;

  return {
    period,
    leakage_total: leakageTotal,
    leakage_pct: leakagePct,
    expected_revenue_total: Math.round(expectedTotal * 100) / 100,
    item_count: leakageItems.length,
    items: leakageItems,
    prior_period: null,
    prior_leakage_total: null,
    trend_amount: null,
    trend_direction: null,
  };
}

export function leakageStatusLabel(status: string): string {
  const m: Record<string, string> = {
    missing_billing: 'Missing Billing',
    billing_gl_diff: 'Billing ≠ GL (under-billed)',
  };
  return m[status] || status.replace(/_/g, ' ');
}

export function formatTrend(summary: LeakageSummary): string | null {
  const dir = summary.trend_direction;
  if (!dir || dir === 'none') return null;
  if (dir === 'flat') return 'Flat vs prior period';
  const amt = Math.abs(Number(summary.trend_amount ?? 0));
  const arrow = dir === 'increase' ? '↑' : '↓';
  return `${arrow} $${amt.toLocaleString(undefined, { maximumFractionDigits: 0 })} vs prior`;
}
