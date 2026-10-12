/** Deployment-wide AP settings via the backend — app_settings is service-role only. */
import { joinApiUrl } from '../../utils/backendOrigin';
import { getStoredAccessToken, workspaceHeaders } from '../../utils/workspaceHeaders';

async function failure(res: Response): Promise<Error> {
  const body = (await res.json().catch(() => ({}))) as { detail?: unknown };
  return new Error(typeof body.detail === 'string' ? body.detail : `HTTP ${res.status}`);
}

export async function getSharedSettings(keys: string[]): Promise<Record<string, string>> {
  const q = new URLSearchParams({ keys: keys.join(',') });
  const res = await fetch(joinApiUrl(`/api/ap/shared-settings?${q}`), {
    headers: workspaceHeaders(getStoredAccessToken()),
  });
  if (!res.ok) throw await failure(res);
  return (await res.json()) as Record<string, string>;
}

/** Platform admins only. Blank secrets keep the stored value. */
export async function saveSharedSettings(settings: Record<string, string>): Promise<void> {
  const res = await fetch(joinApiUrl('/api/ap/shared-settings'), {
    method: 'PUT',
    headers: workspaceHeaders(getStoredAccessToken()),
    body: JSON.stringify({ settings }),
  });
  if (!res.ok) throw await failure(res);
}

export async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(joinApiUrl(path), {
    ...init,
    headers: workspaceHeaders(getStoredAccessToken()),
  });
  if (!res.ok) throw await failure(res);
  return (await res.json()) as T;
}
