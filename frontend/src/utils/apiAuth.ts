/**
 * Attach the login token to every browser call to the FinReportAI API that doesn't set one itself,
 * so the backend auth gate (AUTH_GATE_MODE=enforce) can reject anonymous requests.
 * Only the Authorization header is added: workspace/tenant headers change which data many routes
 * read, so callers keep choosing those explicitly. Third-party URLs (Supabase etc.) are untouched.
 */
import axios, { type AxiosInstance, type InternalAxiosRequestConfig } from 'axios';
import { getStoredAccessToken } from './authToken';
import { backendOrigin } from './backendOrigin';

export function isApiUrl(url: string): boolean {
  if (url.startsWith('/api/')) return true;
  const origin = backendOrigin();
  if (!origin) return false;
  try {
    return new URL(url, window.location.href).origin === new URL(origin).origin;
  } catch {
    return false;
  }
}

export function addApiAuth(instance: AxiosInstance): void {
  instance.interceptors.request.use((config: InternalAxiosRequestConfig) => {
    const token = getStoredAccessToken();
    if (token && !config.headers.has('Authorization') && isApiUrl(instance.getUri(config))) {
      config.headers.set('Authorization', `Bearer ${token}`);
    }
    return config;
  });
}

/** Plain links and window.open can't carry the token, so API files are fetched and saved as a blob. */
export async function downloadApiFile(url: string, fallbackName: string, headers?: HeadersInit): Promise<void> {
  const res = await fetch(url, { headers, credentials: 'include' });
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const name = /filename\*?="?([^";]+)"?/.exec(res.headers.get('content-disposition') || '')?.[1];
  const href = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = href;
  a.download = name || fallbackName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 60_000);
}

let installed = false;

export function installApiAuth(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  addApiAuth(axios);

  const originalFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const token = getStoredAccessToken();
    if (!token || !isApiUrl(url)) return originalFetch(input, init);
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    if (headers.has('Authorization')) return originalFetch(input, init);
    headers.set('Authorization', `Bearer ${token}`);
    return originalFetch(input, { ...init, headers });
  };
}
