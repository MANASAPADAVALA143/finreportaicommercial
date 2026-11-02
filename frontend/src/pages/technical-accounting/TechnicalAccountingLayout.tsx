import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { BookMarked, LayoutDashboard } from 'lucide-react';
import { TA_MODULES, TA_OVERVIEW, TA_ROOT } from './modules';

const tabs = [
  { label: 'Overview', path: TA_OVERVIEW, icon: LayoutDashboard },
  ...TA_MODULES.map(({ label, path, icon }) => ({ label, path, icon })),
];

export default function TechnicalAccountingLayout() {
  const { pathname } = useLocation();

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b border-border bg-card px-6 py-4">
        <div className="flex items-center gap-3 mb-4">
          <div className="h-8 w-8 rounded-lg bg-blue-600/15 flex items-center justify-center">
            <BookMarked className="h-4 w-4 text-blue-600" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-foreground">Technical Accounting AI</h1>
            <p className="text-xs text-muted-foreground">
              IFRS, Ind AS and US GAAP research, analysis and documentation
            </p>
          </div>
        </div>
        <nav className="flex gap-1 flex-wrap">
          {tabs.map(({ label, path, icon: Icon }) => (
            <NavLink
              key={path}
              to={path}
              className={({ isActive }) => {
                const active = isActive || (path === TA_OVERVIEW && (pathname === TA_ROOT || pathname === `${TA_ROOT}/`));
                return `flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  active ? 'bg-blue-600 text-white' : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                }`;
              }}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </NavLink>
          ))}
        </nav>
      </div>
      <div className="p-6">
        <Outlet />
      </div>
    </div>
  );
}
