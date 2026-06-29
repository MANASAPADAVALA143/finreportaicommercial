import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { backendOrigin } from '../utils/backendOrigin';
import { loginRedirectFor, normalizeProductRole, type ProductRole } from '../config/productRole';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import type { Session } from '@supabase/supabase-js';

type Role = 'super_admin' | 'cfo' | 'finance_manager' | 'accountant' | 'auditor';

interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  product_role: ProductRole;
  company_id: string;
  company_name?: string | null;
  permissions: string[];
  is_active: boolean;
}

interface AuthContextValue {
  user: AuthUser | null;
  isAuthenticated: boolean;
  accessToken: string | null;
  bootstrapping: boolean;
  productRole: ProductRole;
  loginRedirect: string;
  login: (email: string, password: string) => Promise<AuthUser>;
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

function userFromSupabaseSession(session: Session): AuthUser {
  const meta = session.user.user_metadata ?? {};
  const appMeta = session.user.app_metadata ?? {};
  const internalRole = (meta.role || appMeta.role || 'accountant') as Role;
  return {
    id: session.user.id,
    name: String(meta.full_name || meta.name || session.user.email?.split('@')[0] || 'User'),
    email: session.user.email ?? '',
    role: internalRole,
    product_role: normalizeProductRole(meta.product_role || appMeta.product_role),
    company_id: String(meta.company_id || ''),
    company_name: meta.company ?? null,
    permissions: internalRole === 'super_admin' ? ['*'] : [],
    is_active: true,
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const base = backendOrigin();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [bootstrapping, setBootstrapping] = useState(true);
  const refreshTimer = useRef<number | null>(null);

  const clearTimer = () => {
    if (refreshTimer.current) {
      window.clearTimeout(refreshTimer.current);
      refreshTimer.current = null;
    }
  };

  const applySession = useCallback((session: Session | null) => {
    if (!session?.access_token) {
      setUser(null);
      setAccessToken(null);
      return;
    }
    setAccessToken(session.access_token);
    setUser(userFromSupabaseSession(session));
  }, []);

  const scheduleRefresh = useCallback((token: string) => {
    if (isSupabaseConfigured) return;
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

  const loginWithRbac = useCallback(async (email: string, password: string) => {
    if (!base) throw new Error('VITE_API_URL missing');
    const r = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, password }),
    });
    if (!r.ok) throw new Error(await r.text());
    const j = await r.json();
    const loggedIn = {
      ...j.user,
      product_role: normalizeProductRole(j.user?.product_role),
    } as AuthUser;
    setUser(loggedIn);
    setAccessToken(j.access_token);
    if (j.refresh_token) sessionStorage.setItem(REFRESH_KEY, j.refresh_token);
    scheduleRefresh(j.access_token);
    return loggedIn;
  }, [base, scheduleRefresh]);

  const login = useCallback(async (email: string, password: string) => {
    if (isSupabaseConfigured) {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw new Error(error.message);
      if (!data.session) throw new Error('No session returned');
      applySession(data.session);
      return userFromSupabaseSession(data.session);
    }
    return loginWithRbac(email, password);
  }, [applySession, loginWithRbac]);

  const register = useCallback(async (payload: { company_name: string; name: string; email: string; password: string }) => {
    if (isSupabaseConfigured) {
      const { data, error } = await supabase.auth.signUp({
        email: payload.email,
        password: payload.password,
        options: {
          data: {
            full_name: payload.name,
            company: payload.company_name,
            role: 'accountant',
            product_role: 'full_access',
          },
        },
      });
      if (error) throw new Error(error.message);
      if (!data.session) throw new Error('Check your email to confirm registration');
      applySession(data.session);
      return;
    }

    if (!base) throw new Error('VITE_API_URL missing');
    const r = await fetch(`${base}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload),
    });
    if (!r.ok) throw new Error(await r.text());
    const j = await r.json();
    setUser({
      ...j.user,
      product_role: normalizeProductRole(j.user?.product_role),
    });
    setAccessToken(j.access_token);
    if (j.refresh_token) sessionStorage.setItem(REFRESH_KEY, j.refresh_token);
    scheduleRefresh(j.access_token);
  }, [base, applySession, scheduleRefresh]);

  const logout = useCallback(async () => {
    clearTimer();
    if (isSupabaseConfigured) {
      await supabase.auth.signOut();
    } else if (base) {
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
    let token = accessToken;
    if (isSupabaseConfigured) {
      const { data } = await supabase.auth.getSession();
      token = data.session?.access_token ?? token;
      if (data.session?.access_token && data.session.access_token !== accessToken) {
        setAccessToken(data.session.access_token);
      }
    }

    const target =
      typeof input === 'string' && input.startsWith('/') && base ? `${base}${input}` : input;
    const headers = new Headers(init?.headers || {});
    if (token) headers.set('Authorization', `Bearer ${token}`);
    const response = await fetch(target, { ...init, headers, credentials: 'include' });

    if (response.status === 401 && !isSupabaseConfigured) {
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
        const newToken = j.access_token as string | undefined;
        if (!newToken) throw new Error('missing access token');
        setAccessToken(newToken);
        if (j.refresh_token) sessionStorage.setItem(REFRESH_KEY, j.refresh_token);
        scheduleRefresh(newToken);
        const retryHeaders = new Headers(init?.headers || {});
        retryHeaders.set('Authorization', `Bearer ${newToken}`);
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

  useEffect(() => {
    let cancelled = false;

    const finish = () => {
      if (!cancelled) setBootstrapping(false);
    };

    if (isSupabaseConfigured) {
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (!cancelled) applySession(session);
        finish();
      });
      const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
        if (!cancelled) applySession(session);
      });
      return () => {
        cancelled = true;
        subscription.unsubscribe();
      };
    }

    const restore = async () => {
      const rt = sessionStorage.getItem(REFRESH_KEY);
      if (!rt || !base) {
        finish();
        return;
      }
      try {
        const r = await fetch(`${base}/api/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ refresh_token: rt }),
        });
        if (!r.ok) throw new Error('refresh failed');
        const j = await r.json();
        const token = j.access_token as string | undefined;
        if (!token) throw new Error('missing access token');
        const me = await fetch(`${base}/api/auth/me`, {
          headers: { Authorization: `Bearer ${token}` },
          credentials: 'include',
        });
        if (!me.ok) throw new Error('me failed');
        const meJson = (await me.json()) as AuthUser;
        const restoredUser = {
          ...meJson,
          product_role: normalizeProductRole(meJson.product_role),
        };
        if (!cancelled) {
          setAccessToken(token);
          setUser(restoredUser);
          scheduleRefresh(token);
        }
      } catch {
        sessionStorage.removeItem(REFRESH_KEY);
      } finally {
        finish();
      }
    };
    void restore();
    return () => {
      cancelled = true;
    };
  }, [base, applySession, scheduleRefresh]);

  const productRole = normalizeProductRole(user?.product_role);
  const loginRedirect = loginRedirectFor(productRole);

  const value = useMemo<AuthContextValue>(() => ({
    user,
    isAuthenticated: !!user && !!accessToken,
    accessToken,
    bootstrapping,
    productRole,
    loginRedirect,
    login,
    register,
    logout,
    hasPermission,
    authFetch,
  }), [user, accessToken, bootstrapping, productRole, loginRedirect, login, register, logout, hasPermission, authFetch]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
