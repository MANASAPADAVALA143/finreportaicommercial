import { NavLink, useLocation } from 'react-router-dom';
import { BarChart2, BookOpen, Calendar, GitMerge, History, LineChart, TrendingUp, Users } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

const r2rLinkBase =
  'flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors border border-transparent';
const r2rIdle = 'text-slate-300 hover:bg-slate-800/80 hover:text-white';
const r2rActive = 'bg-blue-600 text-white border-blue-500 shadow-sm';

export default function Sidebar() {
  const { pathname } = useLocation();
  const { user, hasPermission, logout } = useAuth();
  const patternActive = pathname === '/r2r/pattern' || pathname === '/r2r-pattern';
  const learningActive = pathname === '/r2r/learning';
  const historyActive = pathname === '/r2r/history';
  const revRecActive = pathname === '/r2r/rev-rec';
  const monthEndActive = pathname === '/close';
  const earningsActive = pathname === '/earnings';
  const glReconActive = pathname === '/recon/gl';
  const modelBuilderActive = pathname === '/model';
  const usersActive = pathname === '/users';

  const role = user?.role ?? 'accountant';
  const roleBadge =
    role === 'super_admin'
      ? 'bg-purple-700'
      : role === 'cfo'
      ? 'bg-blue-700'
      : role === 'finance_manager'
      ? 'bg-teal-700'
      : role === 'auditor'
      ? 'bg-orange-700'
      : 'bg-green-700';

  return (
    <aside className="w-56 shrink-0 border-r border-slate-700 bg-slate-900 flex flex-col min-h-screen py-6 px-3">
      <div className="px-2 mb-4">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">FinReport AI</p>
        <p className="text-sm font-bold text-white">R2R</p>
      </div>
      <nav className="flex flex-col gap-0.5" aria-label="Record to Report">
        <NavLink
          to="/r2r/pattern"
          className={() => `${r2rLinkBase} ${patternActive ? r2rActive : r2rIdle}`}
          end
        >
          <BarChart2 className="w-4 h-4 shrink-0" aria-hidden />
          Pattern Analysis
        </NavLink>
        <NavLink
          to="/r2r/learning"
          className={() => `${r2rLinkBase} ${learningActive ? r2rActive : r2rIdle}`}
          end
        >
          <BookOpen className="w-4 h-4 shrink-0" aria-hidden />
          Learning
        </NavLink>
        <NavLink
          to="/r2r/history"
          className={() => `${r2rLinkBase} ${historyActive ? r2rActive : r2rIdle}`}
          end
        >
          <History className="w-4 h-4 shrink-0" aria-hidden />
          History
        </NavLink>
        <NavLink
          to="/r2r/rev-rec"
          className={() => `${r2rLinkBase} ${revRecActive ? r2rActive : r2rIdle}`}
          end
        >
          <LineChart className="w-4 h-4 shrink-0" aria-hidden />
          Rev Rec Reconciliation
        </NavLink>
        {hasPermission('close') || hasPermission('*') ? (
          <NavLink
            to="/close"
            className={() => `${r2rLinkBase} ${monthEndActive ? r2rActive : r2rIdle}`}
            end
          >
            <Calendar className="w-4 h-4 shrink-0" aria-hidden />
            Month-End Close
          </NavLink>
        ) : null}
        {hasPermission('gl_recon') || hasPermission('*') ? (
          <NavLink
            to="/recon/gl"
            className={() => `${r2rLinkBase} ${glReconActive ? r2rActive : r2rIdle}`}
            end
          >
            <GitMerge className="w-4 h-4 shrink-0" aria-hidden />
            GL Reconciler
          </NavLink>
        ) : null}
      </nav>
      <div className="mt-6 px-2 border-t border-slate-800 pt-4">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-2">FP&amp;A</p>
        {hasPermission('earnings') || hasPermission('*') ? (
          <NavLink
            to="/earnings"
            className={() => `${r2rLinkBase} ${earningsActive ? r2rActive : r2rIdle}`}
            end
          >
            <TrendingUp className="w-4 h-4 shrink-0" aria-hidden />
            Earnings Reviewer
          </NavLink>
        ) : null}
        {hasPermission('model_builder') || hasPermission('*') ? (
          <NavLink
            to="/model"
            className={() => `${r2rLinkBase} ${modelBuilderActive ? r2rActive : r2rIdle}`}
            end
          >
            <BarChart2 className="w-4 h-4 shrink-0" aria-hidden />
            Model Builder
          </NavLink>
        ) : null}
        {role === 'super_admin' ? (
          <NavLink
            to="/users"
            className={() => `${r2rLinkBase} ${usersActive ? r2rActive : r2rIdle}`}
            end
          >
            <Users className="w-4 h-4 shrink-0" aria-hidden />
            User Management
          </NavLink>
        ) : null}
      </div>
      <div className="mt-auto px-2 pt-4 border-t border-slate-800">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-8 h-8 rounded-full bg-slate-700 text-slate-100 text-xs flex items-center justify-center">
            {(user?.name || 'U').slice(0, 2).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="text-sm text-white truncate">{user?.name || 'User'}</p>
            <span className={`inline-block text-[10px] px-2 py-0.5 rounded ${roleBadge} text-white`}>
              {role.replace('_', ' ').toUpperCase()}
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void logout()}
          className="w-full rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm py-2"
        >
          Sign Out
        </button>
      </div>
    </aside>
  );
}
