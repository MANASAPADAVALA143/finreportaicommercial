import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Link } from 'react-router-dom';

export function getCurrentFirmId(): string {
  if (typeof window === 'undefined') return '';
  return (
    localStorage.getItem('active_company_id') ||
    localStorage.getItem('ap_company_id') ||
    ''
  );
}

export function SidebarLayout({
  children,
  pageTitle,
  pageSubtitle,
}: {
  children: ReactNode;
  pageTitle?: string;
  pageSubtitle?: string;
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-violet-400">IFRS 15</p>
          <h1 className="text-2xl font-bold text-white">{pageTitle}</h1>
          {pageSubtitle ? <p className="mt-1 text-sm text-gray-400">{pageSubtitle}</p> : null}
        </div>
        <div className="flex flex-wrap gap-3 text-xs">
          <Link to="/r2r/rev-rec" className="text-violet-300 hover:underline">Rev Rec</Link>
          <Link to="/r2r/rev-rec/contracts" className="text-violet-300 hover:underline">Contracts</Link>
          <Link to="/r2r/rev-rec/billing-recon" className="text-violet-300 hover:underline">Billing Recon</Link>
          <Link to="/r2r/rev-rec/modifications" className="text-violet-300 hover:underline">Modifications</Link>
          <Link to="/r2r/rev-rec/rpo" className="text-violet-300 hover:underline">RPO</Link>
        </div>
      </div>
      <div className="rounded-xl border border-gray-700 bg-white p-4 text-slate-800">{children}</div>
    </div>
  );
}

export function Ifrs15WorkspaceShell({
  children,
  kpiItems,
}: {
  children: ReactNode;
  activeNavId?: string;
  kpiItems?: Array<{ label: string; value: ReactNode; accent?: string }>;
}) {
  return (
    <div>
      {kpiItems?.length ? (
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          {kpiItems.map((k) => (
            <div key={k.label} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="text-xs text-slate-500">{k.label}</div>
              <div className="text-sm font-semibold text-slate-900">{k.value}</div>
            </div>
          ))}
        </div>
      ) : null}
      {children}
    </div>
  );
}

export function Button({
  children,
  className = '',
  variant,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string; children?: ReactNode }) {
  const outline = variant === 'outline' || variant === 'secondary';
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-1 rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${
        outline ? 'border border-slate-300 bg-white text-slate-800' : 'bg-orange-500 text-white'
      } ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
