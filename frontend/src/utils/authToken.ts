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
    const parsed = JSON.parse(raw) as { access_token?: string };
    return parsed.access_token ?? null;
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
