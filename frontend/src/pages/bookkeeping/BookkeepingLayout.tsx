import React from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { ArrowLeft, Bot, FileUp, LayoutDashboard, Receipt, Scale, ShieldAlert, TrendingUp } from 'lucide-react';

const nav: { to: string; label: string; icon: React.ReactNode }[] = [
  { to: '/bookkeeping/upload', label: 'Upload & Process', icon: <FileUp className="w-4 h-4" /> },
  { to: '/bookkeeping/review', label: 'Transaction Review', icon: <LayoutDashboard className="w-4 h-4" /> },
  { to: '/bookkeeping/anomalies', label: 'Anomaly Report', icon: <ShieldAlert className="w-4 h-4" /> },
  { to: '/bookkeeping/missing-receipts', label: 'Missing Receipts', icon: <Receipt className="w-4 h-4" /> },
  { to: '/bookkeeping/reconciliation', label: 'Reconciliation', icon: <Scale className="w-4 h-4" /> },
  { to: '/bookkeeping/monthly', label: 'Monthly Report', icon: <TrendingUp className="w-4 h-4" /> },
];

export const BookkeepingLayout: React.FC = () => {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-slate-100 flex">
      <aside className="w-64 border-r border-slate-700/80 bg-slate-900/90 backdrop-blur flex flex-col shrink-0">
        <div className="p-4 border-b border-slate-700">
          <button
            type="button"
            onClick={() => navigate('/dashboard')}
            className="flex items-center gap-2 text-sm text-slate-400 hover:text-white mb-4"
          >
            <ArrowLeft className="w-4 h-4" />
            Dashboard
          </button>
          <div className="flex items-center gap-2 text-white font-semibold">
            <Bot className="w-6 h-6 text-emerald-400" />
            Bookkeeping Autopilot
          </div>
          <p className="text-xs text-slate-500 mt-1">Rules + Claude · anomalies · recon loop</p>
        </div>
        <nav className="p-2 flex-1 space-y-0.5">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                }`
              }
            >
              {item.icon}
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <main className="flex-1 overflow-auto p-6 lg:p-10">
        <Outlet />
      </main>
    </div>
  );
};
