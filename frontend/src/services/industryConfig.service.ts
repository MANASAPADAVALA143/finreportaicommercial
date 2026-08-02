/** Industry-aware workspace config API client */

import { backendOrigin } from '../utils/backendOrigin';
import { getStoredAccessToken, workspaceHeaders } from '../utils/workspaceHeaders';

function companyId(): string {
  return localStorage.getItem('active_company_id') || localStorage.getItem('ap_company_id') || '';
}

function workspaceId(): string {
  return (
    localStorage.getItem('gnanova_workspace_id') ||
    localStorage.getItem('active_workspace_id') ||
    localStorage.getItem('tenantId') ||
    ''
  );
}

function hdrs(): Record<string, string> {
  const h = workspaceHeaders(getStoredAccessToken());
  const cid = companyId();
  if (cid) h['X-Company-Id'] = cid;
  return h;
}

async function parseError(res: Response): Promise<string> {
  try {
    const j = await res.json();
    return typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail ?? j);
  } catch {
    return await res.text();
  }
}

const BASE = () => `${backendOrigin()}/api/config`;

export type IndustryKey =
  | 'real_estate'
  | 'construction'
  | 'manufacturing'
  | 'healthcare'
  | 'retail'
  | 'ca_firm'
  | 'general'
  | string;

export type IndustryConfig = {
  industry: IndustryKey;
  industry_label: string;
  cost_center_label: string;
  cost_center_placeholder: string;
  ap_label: string;
  ar_label: string;
  sidebar_theme: string;
  show_ifrs15: boolean;
  show_ifrs16: boolean;
  show_rera: boolean;
  show_ejari: boolean;
  show_property_tagging: boolean;
  show_site_tagging: boolean;
  workspace_industry?: string | null;
  workspace_industry_label?: string | null;
};

export type CostCenter = {
  id: string;
  tenant_id: string;
  company_id: string;
  name: string;
  code: string;
  description?: string | null;
  is_active: boolean;
  created_at?: string | null;
  updated_at?: string | null;
};

export const DEFAULT_INDUSTRY_CONFIG: IndustryConfig = {
  industry: 'general',
  industry_label: 'General Business',
  cost_center_label: 'Cost Center',
  cost_center_placeholder: 'Select cost center...',
  ap_label: 'Vendor Payments',
  ar_label: 'Sales Invoices',
  sidebar_theme: 'general',
  show_ifrs15: false,
  show_ifrs16: false,
  show_rera: false,
  show_ejari: false,
  show_property_tagging: true,
  show_site_tagging: false,
};

export const INDUSTRY_CARDS: {
  key: IndustryKey;
  label: string;
  icon: string;
  description: string;
}[] = [
  { key: 'real_estate', label: 'Real Estate & Property', icon: '🏢', description: 'Properties, rent, RERA & leases' },
  { key: 'construction', label: 'Construction', icon: '🏗️', description: 'Sites, subcontractors, progress claims' },
  { key: 'manufacturing', label: 'Manufacturing', icon: '🏭', description: 'Plants, suppliers, customer invoices' },
  { key: 'healthcare', label: 'Healthcare', icon: '🏥', description: 'Branches, clinics, patient billing' },
  { key: 'retail', label: 'Retail', icon: '🛍️', description: 'Stores, suppliers, sales invoices' },
  { key: 'ca_firm', label: 'CA Firm / Accounting', icon: '📊', description: 'Clients, billing, IFRS modules' },
  { key: 'general', label: 'General Business', icon: '⚙️', description: 'Flexible cost centers for any industry' },
];

export function spendByTitle(costCenterLabel: string): string {
  return `Spend by ${costCenterLabel.split('/')[0].trim()}`;
}

/** Local preview labels before tenant save (mirrors industry_config seed). */
export const INDUSTRY_PREVIEW: Record<
  string,
  {
    costCenterLabel: string;
    apLabel: string;
    arLabel: string;
    showIfrs15: boolean;
    showIfrs16: boolean;
    showRera: boolean;
  }
> = {
  real_estate: {
    costCenterLabel: 'Property',
    apLabel: 'Vendor Payments',
    arLabel: 'Rent & Sales Invoices',
    showIfrs15: true,
    showIfrs16: true,
    showRera: true,
  },
  construction: {
    costCenterLabel: 'Site / Project',
    apLabel: 'Subcontractor Invoices',
    arLabel: 'Progress Claims',
    showIfrs15: false,
    showIfrs16: false,
    showRera: false,
  },
  manufacturing: {
    costCenterLabel: 'Plant / Division',
    apLabel: 'Supplier Invoices',
    arLabel: 'Customer Invoices',
    showIfrs15: false,
    showIfrs16: false,
    showRera: false,
  },
  healthcare: {
    costCenterLabel: 'Branch / Clinic',
    apLabel: 'Supplier Invoices',
    arLabel: 'Patient Billing',
    showIfrs15: false,
    showIfrs16: true,
    showRera: false,
  },
  retail: {
    costCenterLabel: 'Store / Outlet',
    apLabel: 'Supplier Invoices',
    arLabel: 'Sales Invoices',
    showIfrs15: false,
    showIfrs16: true,
    showRera: false,
  },
  ca_firm: {
    costCenterLabel: 'Client',
    apLabel: 'Vendor Invoices',
    arLabel: 'Client Billing',
    showIfrs15: true,
    showIfrs16: true,
    showRera: false,
  },
  general: {
    costCenterLabel: 'Cost Center',
    apLabel: 'Vendor Payments',
    arLabel: 'Sales Invoices',
    showIfrs15: false,
    showIfrs16: false,
    showRera: false,
  },
};

export function costCentersPageTitle(industry: IndustryKey, costCenterLabel: string): string {
  const map: Record<string, string> = {
    real_estate: 'Properties',
    construction: 'Sites & Projects',
    manufacturing: 'Plants & Divisions',
    healthcare: 'Branches & Clinics',
    retail: 'Stores & Outlets',
    ca_firm: 'Clients',
  };
  return map[industry] || `${costCenterLabel}s`;
}

export async function fetchIndustryCatalog(): Promise<IndustryConfig[]> {
  const res = await fetch(`${BASE()}/industries`, { headers: hdrs(), credentials: 'include' });
  if (!res.ok) throw new Error(await parseError(res));
  const data = await res.json();
  return data.items || [];
}

export async function fetchTenantIndustryConfig(): Promise<IndustryConfig> {
  const q = new URLSearchParams({ workspace_id: workspaceId() });
  const res = await fetch(`${BASE()}/industry?${q}`, { headers: hdrs(), credentials: 'include' });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function setTenantIndustry(industry: string): Promise<IndustryConfig> {
  const body = JSON.stringify({ industry, workspace_id: workspaceId() });
  // Prefer PATCH (IndustrySelector contract); fall back to POST for older backends
  let res = await fetch(`${BASE()}/industry`, {
    method: 'PATCH',
    headers: hdrs(),
    credentials: 'include',
    body,
  });
  if (res.status === 405 || res.status === 404) {
    res = await fetch(`${BASE()}/industry`, {
      method: 'POST',
      headers: hdrs(),
      credentials: 'include',
      body,
    });
  }
  // Backend not redeployed yet — apply seeded preview so UI is usable
  if (res.status === 404) {
    const key = industry.trim().toLowerCase().replace(/\s+/g, '_');
    const preview = INDUSTRY_PREVIEW[key] || INDUSTRY_PREVIEW.general;
    const card = INDUSTRY_CARDS.find((c) => c.key === key);
    return {
      ...DEFAULT_INDUSTRY_CONFIG,
      industry: key,
      industry_label: card?.label || DEFAULT_INDUSTRY_CONFIG.industry_label,
      cost_center_label: preview.costCenterLabel,
      cost_center_placeholder: `Select ${preview.costCenterLabel.split('/')[0].trim().toLowerCase()}...`,
      ap_label: preview.apLabel,
      ar_label: preview.arLabel,
      sidebar_theme: key,
      show_ifrs15: preview.showIfrs15,
      show_ifrs16: preview.showIfrs16,
      show_rera: preview.showRera,
      show_ejari: preview.showRera,
      show_property_tagging: true,
      show_site_tagging: key === 'construction',
      workspace_industry: key,
    };
  }
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function listCostCenters(activeOnly = true): Promise<CostCenter[]> {
  const q = new URLSearchParams({
    workspace_id: workspaceId(),
    company_id: companyId() || workspaceId(),
    active_only: String(activeOnly),
  });
  const res = await fetch(`${BASE()}/cost-centers?${q}`, { headers: hdrs(), credentials: 'include' });
  if (!res.ok) throw new Error(await parseError(res));
  const data = await res.json();
  return data.items || [];
}

export async function createCostCenter(input: {
  name: string;
  code?: string;
  description?: string;
  is_active?: boolean;
}): Promise<CostCenter> {
  const res = await fetch(`${BASE()}/cost-centers`, {
    method: 'POST',
    headers: hdrs(),
    credentials: 'include',
    body: JSON.stringify({
      ...input,
      workspace_id: workspaceId(),
      company_id: companyId() || workspaceId(),
    }),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function updateCostCenter(
  id: string,
  input: Partial<{ name: string; code: string; description: string; is_active: boolean }>,
): Promise<CostCenter> {
  const q = new URLSearchParams({ workspace_id: workspaceId() });
  const res = await fetch(`${BASE()}/cost-centers/${id}?${q}`, {
    method: 'PATCH',
    headers: hdrs(),
    credentials: 'include',
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function deleteCostCenter(id: string): Promise<void> {
  const q = new URLSearchParams({ workspace_id: workspaceId() });
  const res = await fetch(`${BASE()}/cost-centers/${id}?${q}`, {
    method: 'DELETE',
    headers: hdrs(),
    credentials: 'include',
  });
  if (!res.ok) throw new Error(await parseError(res));
}
