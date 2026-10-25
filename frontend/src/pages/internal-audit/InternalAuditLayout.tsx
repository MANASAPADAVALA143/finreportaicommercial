import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { AlertTriangle, Briefcase, Clock, FileSearch, Globe, History, LayoutDashboard, Shield } from 'lucide-react';
import { useCompany } from '../../context/CompanyContext';

const tabs = [
  { label: 'Committee Dashboard', path: '/internal-audit/dashboard', icon: LayoutDashboard },
  { label: 'Audit Universe & Plan', path: '/internal-audit/universe', icon: Globe },
  { label: 'Engagements', path: '/internal-audit/engagements', icon: Briefcase },
  { label: 'Findings & CAPA', path: '/internal-audit/findings', icon: AlertTriangle },
  { label: 'Overdue Follow-up', path: '/internal-audit/overdue', icon: Clock },
  { label: 'Historical Baseline', path: '/internal-audit/baseline', icon: History },
  { label: 'JE Review', path: '/internal-audit/je-review', icon: FileSearch },
  { label: 'Audit Intelligence (AI)', path: '/audit', icon: Shield },
];

export default function InternalAuditLayout() {
  const { pathname } = useLocation();
  const { activeCompanyId, activeCompany, loading } = useCompany();

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b border-border bg-card px-6 py-4">
        <div className="flex items-center gap-3 mb-4">
          <div className="h-8 w-8 rounded-lg bg-blue-600/15 flex items-center justify-center">
            <Shield className="h-4 w-4 text-blue-600" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-foreground">Internal Audit</h1>
            <p className="text-xs text-muted-foreground">
              IIA-aligned audit lifecycle — plan · execute · report · follow up
              {activeCompany?.company_name ? ` · ${activeCompany.company_name}` : ''}
            </p>
          </div>
        </div>
        <nav className="flex gap-1 flex-wrap">
          {tabs.map(({ label, path, icon: Icon }) => (
            <NavLink
              key={path}
              to={path}
              end={path === '/audit'}
              className={({ isActive }) => {
                const active = isActive || (path === '/internal-audit/dashboard' && pathname === '/internal-audit');
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
        {activeCompanyId ? (
          <Outlet />
        ) : (
          <div className="rounded-xl border-2 border-dashed border-border py-16 text-center text-sm text-muted-foreground">
            {loading ? 'Loading companies…' : 'Select a company in the top banner to work on its internal audit.'}
          </div>
        )}
      </div>
    </div>
  );
}
