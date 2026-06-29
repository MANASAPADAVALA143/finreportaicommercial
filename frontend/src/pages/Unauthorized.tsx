import { Link, useLocation } from 'react-router-dom';
import { ShieldX } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { homePathForRole } from '../config/productRole';

export default function Unauthorized() {
  const { user, productRole } = useAuth();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;
  const home = homePathForRole(productRole, user?.role);

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
      <div className="max-w-md w-full text-center space-y-6">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-red-900/30 border border-red-700/40">
          <ShieldX className="w-8 h-8 text-red-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white">Access denied</h1>
          <p className="text-slate-400 text-sm mt-3 leading-relaxed">
            You don&apos;t have access to this module.
            Contact your administrator to upgrade your plan.
          </p>
          {from && (
            <p className="text-xs text-slate-500 mt-2">
              Requested: <span className="text-slate-400">{from}</span>
            </p>
          )}
        </div>
        <Link
          to={home}
          className="inline-block px-5 py-2.5 rounded-lg bg-teal-700 hover:bg-teal-600 text-white text-sm font-medium transition-colors"
        >
          Go to Dashboard
        </Link>
      </div>
    </div>
  );
}
