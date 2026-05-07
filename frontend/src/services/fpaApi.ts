/**
 * Shared JSON POST helper for FPA and report routes (FastAPI `/api/fpa/*`, `/api/reports/*`).
 */

import { backendOrigin } from '../utils/backendOrigin';

function fpaApiBase(): string {
  let base = backendOrigin();
  if (typeof window !== 'undefined') {
    const h = window.location.hostname;
    if (
      (h === 'localhost' || h === '127.0.0.1') &&
      (base === '' || /localhost:8000|127\.0\.0\.1:8000/.test(base))
    ) {
      base = '';
    }
  }
  return base.replace(/\/$/, '');
}

/** Default model id for optional CFO commentary calls (Monte Carlo, etc.). */
export const CFO_ANALYSIS_MODEL = 'claude-sonnet-4-20250514';

export async function postFpaJson<T>(path: string, body: unknown): Promise<T> {
  const base = fpaApiBase();
  const p = path.startsWith('/') ? path : `/${path}`;
  const url = `${base}${p}`;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('access_token') : null;
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    const raw = await res.text();
    try {
      const data = JSON.parse(raw) as { detail?: string };
      if (typeof data.detail === 'string' && data.detail.trim()) msg = data.detail;
    } catch {
      if (raw.trim()) msg = raw.slice(0, 500);
    }
    throw new Error(msg);
  }

  return res.json() as Promise<T>;
}
