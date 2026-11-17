import { backendOrigin } from '../utils/backendOrigin';
import { workspaceHeaders } from './workspaceService';

export interface Money {
  value: number | null;
  currency: string | null;
  available: boolean;
  reason: string | null;
  method: string;
}

export interface Health {
  status: 'Healthy' | 'Watch' | 'Incomplete' | string;
  rules: string[];
}

export interface Figures {
  revenue: Money;
  gross_profit: Money;
  ebitda: Money;
  net_profit: Money;
  total_assets: Money;
  total_liabilities: Money;
  net_assets: Money;
  gl_cash: Money;
}

export interface GroupEntity {
  company_id: string;
  company_name: string;
  parent_company_id: string | null;
  base_currency: string | null;
  translated: boolean;
  posted_journal_count: number;
  ownership: { ownership_percent: number | null; source: string; assumption: string | null };
  fx: { average_rate: number | null; closing_rate: number | null; source: string | null; fx_rate_id: number | null } | null;
  local: Figures;
  reporting: Figures;
  health: Health;
}

export interface GroupAlert {
  severity: string;
  title: string;
  detail: string | null;
  href: string;
  source: string;
}

export interface GroupInsight {
  title: string;
  detail: string;
  figures: Array<Money & { label?: string }>;
  action: string;
  href: string;
}

export interface GroupPosition {
  workspace_id: string;
  period: string;
  reporting_currency: string | null;
  company_ids: string[];
  status: string;
  kpis: {
    group_revenue: Money;
    ebitda: Money;
    net_profit: Money;
    total_assets: Money;
    total_liabilities: Money;
    gl_cash: Money;
    bank_cash: Money;
    net_debt: Money;
    working_capital: Money;
    cash_runway: Money;
    nci_net_profit: Money;
    nci_net_assets: Money;
  };
  entities: GroupEntity[];
  bank_accounts: Array<{ company_id: string | null; reporting_amount: number | null; last_reconciled_balance: number | null; currency: string | null }>;
  intercompany: Array<{ reference: string; status: string | null; difference: number | null; seller_name: string | null; buyer_name: string | null }>;
  limitations: string[];
  methodology: { rates?: Array<Record<string, unknown>>; fx_policy?: string; bridge?: Record<string, unknown> };
  bridge: {
    reconciled: boolean;
    revenue: {
      entity_reporting_sum: number | null;
      eliminations: number | null;
      group_consolidated: number | null;
      difference: number | null;
      currency: string | null;
      method: string;
    };
  };
  alerts: GroupAlert[];
  insights: GroupInsight[];
  snapshot_id: string | null;
}

export interface SeriesPoint {
  period: string;
  status: string;
  reporting_currency: string | null;
  revenue: Money;
  ebitda: Money;
  net_profit: Money;
  margin_pct: { value: number | null; available: boolean; reason: string | null; method: string };
  budget: Money;
}

export interface GroupSeries {
  reporting_currency: string | null;
  currency_basis: string;
  actuals_only: boolean;
  points: SeriesPoint[];
}

export interface GroupEntityOption {
  company_id: string;
  company_name: string;
  base_currency: string | null;
  status: string;
}

function qs(params: Record<string, string | string[] | undefined>) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (!value) return;
    if (Array.isArray(value)) value.forEach((item) => search.append(key, item));
    else search.set(key, value);
  });
  const text = search.toString();
  return text ? `?${text}` : '';
}

async function api<T>(path: string, token: string | null): Promise<T> {
  const res = await fetch(`${backendOrigin()}${path}`, {
    headers: workspaceHeaders(token),
    credentials: 'include',
  });
  if (!res.ok) {
    let detail = await res.text();
    try {
      const body = JSON.parse(detail) as { detail?: string };
      detail = body.detail || detail;
    } catch {
      /* keep text */
    }
    throw new Error(detail || `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export function listGroupEntities(token: string | null) {
  return api<GroupEntityOption[]>('/api/group-intelligence/entities', token);
}

export function getGroupPosition(token: string | null, period: string, reportingCurrency: string, companyIds: string[]) {
  return api<GroupPosition>(
    `/api/group-intelligence/position${qs({
      period,
      reporting_currency: reportingCurrency || undefined,
      company_ids: companyIds.length ? companyIds : undefined,
    })}`,
    token,
  );
}

export function getGroupSeries(token: string | null, start: string, end: string, reportingCurrency: string, companyIds: string[]) {
  return api<GroupSeries>(
    `/api/group-intelligence/series${qs({
      start,
      end,
      reporting_currency: reportingCurrency || undefined,
      company_ids: companyIds.length ? companyIds : undefined,
    })}`,
    token,
  );
}

export function showMoney(money: Money | undefined): string {
  if (!money || !money.available || money.value == null) return 'Unavailable';
  if (!money.currency) return money.value.toLocaleString();
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency: money.currency, maximumFractionDigits: 2 }).format(money.value);
  } catch {
    return `${money.value.toLocaleString()} ${money.currency}`;
  }
}

export function shiftMonth(period: string, delta: number): string {
  const [year, month] = period.split('-').map(Number);
  const index = year * 12 + (month - 1) + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}
