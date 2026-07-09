import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useWorkspace } from '../context/WorkspaceContext';
import { isWorkspaceOptionalPath, noWorkspaceFallback } from '../config/productRole';

export default function WorkspaceGuard() {
  const { isAuthenticated, productRole } = useAuth();
  const { workspaces, loading } = useWorkspace();
  const location = useLocation();

  if (!isAuthenticated) {
    return <Outlet />;
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <p className="text-slate-400 text-sm">Loading workspace…</p>
      </div>
    );
  }

  if (workspaces.length === 0 && !isWorkspaceOptionalPath(location.pathname)) {
    return (
      <Navigate
        to={noWorkspaceFallback(productRole)}
        replace
        state={{ from: location.pathname }}
      />
    );
  }

  return <Outlet />;
}
