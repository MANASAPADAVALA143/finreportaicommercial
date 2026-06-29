import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

function parseJwtExp(token: string): number | null {
  try {
    const body = token.split('.')[1];
    const json = JSON.parse(atob(body.replace(/-/g, '+').replace(/_/g, '/')));
    return typeof json.exp === 'number' ? json.exp : null;
  } catch {
    return null;
  }
}

export default function PrivateRoute() {
  const { isAuthenticated, accessToken, bootstrapping } = useAuth();
  const location = useLocation();

  if (bootstrapping) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <p className="text-slate-400 text-sm">Loading session…</p>
      </div>
    );
  }

  if (!isAuthenticated || !accessToken) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  const exp = parseJwtExp(accessToken);
  if (exp && exp * 1000 < Date.now()) {
    return <Navigate to="/login" replace state={{ from: location.pathname, expired: true }} />;
  }

  return <Outlet />;
}
