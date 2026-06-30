import { Link, Outlet, useLocation } from 'react-router-dom';

const TABS = [
  { label: 'Calculator', path: '/ifrs/16' },
  { label: 'Lease Register', path: '/ifrs/16/leases' },
  { label: 'IBR Tool', path: '/ifrs/16/ibr-tool' },
  { label: 'CPI Remeasure', path: '/ifrs/16/remeasure' },
  { label: 'Audit Report', path: '/ifrs/16/audit' },
] as const;

export default function IFRS16Layout() {
  const { pathname } = useLocation();

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col">
      <div className="border-b border-gray-800 bg-gray-900/80 sticky top-0 z-10">
        <div className="px-6 py-3 flex items-center gap-4 flex-wrap">
          <div>
            <p className="text-[10px] text-teal-400 uppercase tracking-widest">IFRS Suite</p>
            <h1 className="text-lg font-semibold text-white">IFRS 16 — Lease Accounting</h1>
          </div>
          <nav className="flex flex-wrap gap-1 ml-auto">
            {TABS.map((tab) => {
              const active =
                tab.path === '/ifrs/16'
                  ? pathname === '/ifrs/16'
                  : pathname.startsWith(tab.path);
              return (
                <Link
                  key={tab.path}
                  to={tab.path}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    active
                      ? 'bg-teal-700/40 text-teal-200 border border-teal-600/50'
                      : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
                  }`}
                >
                  {tab.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </div>
      <Outlet />
    </div>
  );
}
