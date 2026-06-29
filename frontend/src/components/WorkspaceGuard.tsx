import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useWorkspace } from '../context/WorkspaceContext';

const SETUP_PATHS = new Set([
  '/company-setup',
  '/workspaces',
  '/workspaces/create',
  '/unauthorized',
]);

export default function WorkspaceGuard() {
  const { isAuthenticated } = useAuth();
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

  const onSetupPath = SETUP_PATHS.has(location.pathname)
    || location.pathname.startsWith('/workspaces/');

  if (!onSetupPath && workspaces.length === 0) {
    return <Navigate to="/company-setup" replace state={{ from: location.pathname }} />;
  }

  return <Outlet />;
}
