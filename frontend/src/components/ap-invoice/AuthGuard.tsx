/**
 * AuthGuard â€” wraps protected routes.
 * If no active Supabase session, redirects to /login and preserves the intended path.
 * Shows a loading spinner while the session check is in flight (avoids flash-of-login).
 */
import { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { getSession, onAuthStateChange } from '../../lib/ap-invoice/authService';
import type { AuthSession } from '../../lib/ap-invoice/authService';

interface AuthGuardProps {
  children: React.ReactNode;
}

export function AuthGuard({ children }: AuthGuardProps) {
  const location = useLocation();
  const [session, setSession] = useState<AuthSession | null | undefined>(undefined);

  useEffect(() => {
    // Initial session check
    getSession().then(setSession).catch(() => setSession(null));
    // Subscribe to changes (login from another tab, token refresh, logout)
    const unsubscribe = onAuthStateChange(setSession);
    return unsubscribe;
  }, []);

  if (session === undefined) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="h-7 w-7 animate-spin rounded-full border-4 border-blue-200 border-t-[#1a56db]" />
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }

  return <>{children}</>;
}

