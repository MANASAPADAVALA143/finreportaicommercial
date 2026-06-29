import { backendOrigin } from '../utils/backendOrigin';
import { getStoredWorkspaceId } from './workspaceService';

const BASE = `${backendOrigin()}/api/ifrs9`;

function hdrs(companyId?: string | null): Record<string, string> {
  const ws = getStoredWorkspaceId();
  const h: Record<string, string> = { 'Content-Type': 'application/json', 'X-Workspace-ID': ws, 'X-Tenant-ID': ws };
  if (companyId) h['X-Company-ID'] = companyId;
  return h;
}

export interface ECLAsset {
  asset_name: string;
  counterparty?: string;
  exposure_aed: number;
  days_past_due?: number;
  credit_rating?: string;
  has_significant_increase_in_credit_risk?: boolean;
  stage?: number;
  ecl_recognised_aed?: number;
}

export async function fetchIFRS9Dashboard(companyId: string | null) {
  const q = companyId ? `?company_id=${companyId}` : '';
  const res = await fetch(`${BASE}/dashboard-summary${q}`, { headers: hdrs(companyId) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function stageIFRS9Assets(assets: ECLAsset[], companyId: string | null, assetClass = 'trade_receivables') {
  const res = await fetch(`${BASE}/stage-assets`, {
    method: 'POST', headers: hdrs(companyId),
    body: JSON.stringify({ company_id: companyId, assets, asset_class: assetClass }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function calculateIFRS9ECL(assets: ECLAsset[], companyId: string | null, assetClass = 'trade_receivables') {
  const res = await fetch(`${BASE}/calculate-ecl`, {
    method: 'POST', headers: hdrs(companyId),
    body: JSON.stringify({ company_id: companyId, assets, asset_class: assetClass, calculation_date: new Date().toISOString().slice(0, 10) }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function saveIFRS9Portfolio(body: Record<string, unknown>, companyId: string | null) {
  const res = await fetch(`${BASE}/save-portfolio`, {
    method: 'POST', headers: hdrs(companyId), body: JSON.stringify({ company_id: companyId, ...body }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function postIFRS9ProvisionJE(portfolioId: string, periodDate: string, companyId: string | null, movement = 0) {
  const res = await fetch(`${BASE}/post-provision-je`, {
    method: 'POST', headers: hdrs(companyId),
    body: JSON.stringify({ company_id: companyId, portfolio_id: portfolioId, period_date: periodDate, ecl_movement_aed: movement }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function fetchIFRS9Portfolios(companyId: string | null) {
  const q = companyId ? `?company_id=${companyId}` : '';
  const res = await fetch(`${BASE}/portfolios${q}`, { headers: hdrs(companyId) });
  if (!res.ok) throw new Error(await res.text());
  const d = await res.json();
  return d.portfolios ?? [];
}
