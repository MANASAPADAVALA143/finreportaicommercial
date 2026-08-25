import { backendOrigin } from '../utils/backendOrigin';
import { workspaceHeaders } from '../services/workspaceService';

export interface ApCompany {
  id: string;
  name: string;
  slug: string;
  market: string;
  accounting_standard: string;
}

export async function listApCompanies(accessToken: string | null): Promise<ApCompany[]> {
  const base = backendOrigin();
  if (!base || !accessToken) return [];

  const res = await fetch(`${base}/api/ap/companies`, {
    headers: workspaceHeaders(accessToken),
    credentials: 'include',
  });
  if (!res.ok) return [];

  const body = (await res.json()) as { companies?: ApCompany[] };
  return body.companies ?? [];
}
