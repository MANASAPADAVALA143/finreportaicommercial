import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

interface Props {
  children: JSX.Element;
  roles?: Array<'super_admin' | 'cfo' | 'finance_manager' | 'accountant' | 'auditor'>;
}

export default function PrivateRoute({ children, roles: _roles }: Props) {
  // TEMP: Auth bypassed for local demo — remove this line and uncomment below when auth is ready
  return children;

  /* --- Uncomment when auth is re-enabled ---
  const { isAuthenticated, user } = useAuth();
  const location = useLocation();

  if (!isAuthenticated || !user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (_roles && _roles.length > 0 && !_roles.includes(user.role)) {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
  --- */
}
