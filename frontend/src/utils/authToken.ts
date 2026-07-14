/** In-memory token mirror — AuthContext updates this on every session change. */
let memoryAccessToken: string | null = null;

export function setMemoryAccessToken(token: string | null): void {
  memoryAccessToken = token;
}

function supabaseAccessToken(): string | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const key = Object.keys(localStorage).find(
      (k) => k.startsWith('sb-') && k.endsWith('-auth-token'),
    );
    if (!key) return null;
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      access_token?: string;
      session?: { access_token?: string };
      currentSession?: { access_token?: string };
    };
    return (
      parsed.access_token
      ?? parsed.session?.access_token
      ?? parsed.currentSession?.access_token
      ?? null
    );
  } catch {
    return null;
  }
}

/** JWT for ProductRoleMiddleware — memory first, then persisted stores. */
export function getStoredAccessToken(): string | null {
  if (memoryAccessToken) return memoryAccessToken;
  return (
    localStorage.getItem('token')
    ?? localStorage.getItem('accessToken')
    ?? localStorage.getItem('access_token')
    ?? supabaseAccessToken()
  );
}

const REFRESH_KEY = 'finreport_refresh_token';

/** Wipe all client-side auth state (RBAC + Supabase). */
export function clearAllAuthStorage(): void {
  memoryAccessToken = null;
  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.removeItem(REFRESH_KEY);
  }
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  localStorage.removeItem('accessToken');
  localStorage.removeItem('access_token');
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith('sb-') && key.endsWith('-auth-token')) {
      localStorage.removeItem(key);
    }
  }
}
