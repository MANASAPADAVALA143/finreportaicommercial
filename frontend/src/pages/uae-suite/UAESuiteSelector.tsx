/**
 * Legacy route — redirects to the main FinReport card dashboard.
 * UAE Suite, UAE Accounting, and FP&A are separate sections on /dashboard.
 */
import { Navigate } from 'react-router-dom';

export default function UAESuiteSelector() {
  return <Navigate to="/dashboard" replace />;
}
