import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { backendOrigin } from '../utils/backendOrigin';

type Role = 'super_admin' | 'cfo' | 'finance_manager' | 'accountant' | 'auditor';

interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  company_id: string;
  company_name?: string | null;
  permissions: string[];
  is_active: boolean;
}

interface AuthContextValue {
  user: AuthUser | null;
  isAuthenticated: boolean;
  accessToken: string | null;
  login: (email: string, password: string) => Promise<void>;
  register: (payload: { company_name: string; name: string; email: string; password: string }) => Promise<void>;
  logout: () => Promise<void>;
  hasPermission: (module: string) => boolean;
  authFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const REFRESH_KEY = 'finreport_refresh_token';

const roleMap: Record<Role, Set<string>> = {
  super_admin: new Set(['*']),
  cfo: new Set(['dashboard', 'r2r', 'fpa', 'ifrs', 'earnings', 'close', 'gl_recon', 'model_builder', 'approve']),
  finance_manager: new Set(['r2r', 'fpa', 'ifrs', 'earnings', 'close', 'gl_recon', 'model_builder']),
  accountant: new Set(['upload', 'analysis', 'view']),
  auditor: new Set(['read_only', 'audit_trail']),
};

function parseJwt(token: string): { exp?: number } {
  try {
    const body = token.split('.')[1];
    const json = JSON.parse(atob(body.replace(/-/g, '+').replace(/_/g, '/')));
    return json;
  } catch {
    return {};
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const base = backendOrigin();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const refreshTimer = useRef<number | null>(null);

  const clearTimer = () => {
    if (refreshTimer.current) {
      window.clearTimeout(refreshTimer.current);
      refreshTimer.current = null;
    }
  };

  const scheduleRefresh = useCallback((token: string) => {
    clearTimer();
    const exp = parseJwt(token).exp;
    if (!exp || !base) return;
    const dueMs = exp * 1000 - Date.now() - 30 * 60 * 1000;
    const wait = Math.max(5_000, dueMs);
    refreshTimer.current = window.setTimeout(async () => {
      try {
        const rt = sessionStorage.getItem(REFRESH_KEY);
        const r = await fetch(`${base}/api/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ refresh_token: rt || undefined }),
        });
        if (!r.ok) throw new Error('refresh failed');
        const j = await r.json();
        if (j.access_token) {
          setAccessToken(j.access_token);
          if (j.refresh_token) sessionStorage.setItem(REFRESH_KEY, j.refresh_token);
          scheduleRefresh(j.access_token);
        }
      } catch {
        sessionStorage.removeItem(REFRESH_KEY);
        setAccessToken(null);
        setUser(null);
        window.location.href = '/login';
      }
    }, wait);
  }, [base]);

  const login = useCallback(async (email: string, password: string) => {
    if (!base) throw new Error('VITE_API_URL missing');
    const r = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, password }),
    });
    if (!r.ok) throw new Error(await r.text());
    const j = await r.json();
    setUser(j.user);
    setAccessToken(j.access_token);
    if (j.refresh_token) sessionStorage.setItem(REFRESH_KEY, j.refresh_token);
    scheduleRefresh(j.access_token);
  }, [base, scheduleRefresh]);

  const register = useCallback(async (payload: { company_name: string; name: string; email: string; password: string }) => {
    if (!base) throw new Error('VITE_API_URL missing');
    const r = await fetch(`${base}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload),
    });
    if (!r.ok) throw new Error(await r.text());
    const j = await r.json();
    setUser(j.user);
    setAccessToken(j.access_token);
    if (j.refresh_token) sessionStorage.setItem(REFRESH_KEY, j.refresh_token);
    scheduleRefresh(j.access_token);
  }, [base, scheduleRefresh]);

  const logout = useCallback(async () => {
    clearTimer();
    if (base) {
      const rt = sessionStorage.getItem(REFRESH_KEY);
      await fetch(`${base}/api/auth/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ refresh_token: rt || undefined }),
      });
    }
    sessionStorage.removeItem(REFRESH_KEY);
    setAccessToken(null);
    setUser(null);
  }, [base]);

  const hasPermission = useCallback((module: string) => {
    if (!user) return false;
    const granted = roleMap[user.role] ?? new Set<string>();
    return granted.has('*') || granted.has(module);
  }, [user]);

  const authFetch = useCallback(async (input: RequestInfo | URL, init?: RequestInit) => {
    const target =
      typeof input === 'string' && input.startsWith('/') && base ? `${base}${input}` : input;
    const headers = new Headers(init?.headers || {});
    if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
    const response = await fetch(target, { ...init, headers, credentials: 'include' });
    if (response.status === 401) {
      try {
        if (!base) throw new Error('missing base');
        const rt = sessionStorage.getItem(REFRESH_KEY);
        const rr = await fetch(`${base}/api/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ refresh_token: rt || undefined }),
        });
        if (!rr.ok) throw new Error('refresh failed');
        const j = await rr.json();
        const token = j.access_token as string | undefined;
        if (!token) throw new Error('missing access token');
        setAccessToken(token);
        if (j.refresh_token) sessionStorage.setItem(REFRESH_KEY, j.refresh_token);
        scheduleRefresh(token);
        const retryHeaders = new Headers(init?.headers || {});
        retryHeaders.set('Authorization', `Bearer ${token}`);
        return fetch(target, { ...init, headers: retryHeaders, credentials: 'include' });
      } catch {
        sessionStorage.removeItem(REFRESH_KEY);
        setUser(null);
        setAccessToken(null);
        window.location.href = '/login';
      }
    }
    return response;
  }, [accessToken, base, scheduleRefresh]);

  useEffect(() => () => clearTimer(), []);

  const value = useMemo<AuthContextValue>(() => ({
    user,
    isAuthenticated: !!user && !!accessToken,
    accessToken,
    login,
    register,
    logout,
    hasPermission,
    authFetch,
  }), [user, accessToken, login, register, logout, hasPermission, authFetch]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
