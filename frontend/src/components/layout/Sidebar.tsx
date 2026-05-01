import { NavLink, useLocation } from 'react-router-dom';
import { BarChart2, BookOpen, History, LineChart } from 'lucide-react';

const r2rLinkBase =
  'flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors border border-transparent';
const r2rIdle = 'text-slate-300 hover:bg-slate-800/80 hover:text-white';
const r2rActive = 'bg-blue-600 text-white border-blue-500 shadow-sm';

export default function Sidebar() {
  const { pathname } = useLocation();
  const patternActive = pathname === '/r2r/pattern' || pathname === '/r2r-pattern';
  const learningActive = pathname === '/r2r/learning';
  const historyActive = pathname === '/r2r/history';
  const revRecActive = pathname === '/r2r/rev-rec';

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
      </nav>
    </aside>
  );
}
