import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { canAccessPath } from '../config/productRole';

export default function RoleRoute() {
  const { user, productRole } = useAuth();
  const location = useLocation();

  if (!canAccessPath(productRole, location.pathname, user?.role)) {
    return <Navigate to="/unauthorized" replace state={{ from: location.pathname }} />;
  }

  return <Outlet />;
}
