import { Outlet } from 'react-router-dom';

/**
 * Login temporarily disabled — reopen auth later by restoring session checks.
 * All app routes are reachable without a session for now.
 */
export default function PrivateRoute() {
  return <Outlet />;
}
