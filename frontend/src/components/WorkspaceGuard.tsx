import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useWorkspace } from '../context/WorkspaceContext';
import { isWorkspaceOptionalPath, noWorkspaceFallback } from '../config/productRole';
import { getStoredWorkspaceId } from '../services/workspaceService';

export default function WorkspaceGuard() {
  const { isAuthenticated, productRole } = useAuth();
  const { workspaces, loading } = useWorkspace();
  const location = useLocation();
  const storedWorkspaceId = getStoredWorkspaceId();

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

  // If we already have a stored workspace id, avoid a false redirect during
  // cold-start hydration and let pages resolve context first.
  if (workspaces.length === 0 && !storedWorkspaceId && !isWorkspaceOptionalPath(location.pathname)) {
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
