import type { ComponentType } from 'react';
import { NavLink, Outlet, Link } from 'react-router-dom';
import {
  Home, ClipboardList, FileText, DollarSign, Landmark, BarChart3,
  Search, AlertTriangle, Building2, Link2, ExternalLink,
} from 'lucide-react';
import { NAVY, SURFACE, BORDER, GOLD, MUTED } from './shared';

type NavItem = { to: string; label: string; icon: ComponentType<{ className?: string }>; end?: boolean };

const MAIN_NAV: NavItem[] = [
  { to: '/real-estate/dashboard', label: 'Dashboard', icon: Home, end: true },
  { to: '/real-estate/projects', label: 'Projects', icon: ClipboardList },
  { to: '/real-estate/bookings', label: 'Bookings', icon: FileText },
  { to: '/real-estate/payments', label: 'Payments', icon: DollarSign },
];

const COMPLIANCE_NAV: NavItem[] = [
  { to: '/real-estate/escrow', label: 'Escrow', icon: Landmark },
  { to: '/real-estate/qpr', label: 'QPR Reports', icon: BarChart3 },
  { to: '/real-estate/leakage', label: 'Revenue Leakage', icon: Search },
  { to: '/real-estate/risk-flags', label: 'Risk Flags', icon: AlertTriangle },
];

const IFRS_NAV: NavItem[] = [{ to: '/real-estate/ifrs16', label: 'IFRS 16 Leases', icon: Building2 }];

const SYSTEM_NAV: NavItem[] = [{ to: '/real-estate/webhooks', label: 'Webhooks', icon: Link2 }];

function NavSection({ title, items }: { title: string; items: NavItem[] }) {
  return (
    <>
      <div className="text-[10px] uppercase tracking-widest px-3 pt-4 pb-1" style={{ color: MUTED }}>
        {title}
      </div>
      {items.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) =>
            `flex items-center gap-2.5 px-3 py-2 mx-2 rounded-lg text-sm transition-colors ${
              isActive ? 'font-semibold' : 'hover:bg-white/5'
            }`
          }
          style={({ isActive }) => ({
            color: isActive ? GOLD : '#FFFFFF',
            background: isActive ? `${GOLD}1a` : 'transparent',
            border: isActive ? `1px solid ${GOLD}66` : '1px solid transparent',
          })}
        >
          <Icon className="w-4 h-4 shrink-0" />
          <span>{label}</span>
        </NavLink>
      ))}
    </>
  );
}

export default function RERALayout() {
  return (
    <div className="min-h-screen flex" style={{ background: NAVY, color: '#FFFFFF' }}>
      <aside className="w-64 shrink-0 border-r flex flex-col" style={{ borderColor: BORDER, background: SURFACE }}>
        <div className="px-4 py-5 border-b" style={{ borderColor: BORDER }}>
          <Link to="/real-estate/dashboard" className="text-sm font-bold tracking-wide">
            <span style={{ color: GOLD }}>REAL ESTATE</span> OS
          </Link>
        </div>
        <nav className="flex-1 overflow-y-auto pb-4">
          <NavSection title="Real Estate OS" items={MAIN_NAV} />
          <NavSection title="Compliance" items={COMPLIANCE_NAV} />
          <NavSection title="IFRS" items={IFRS_NAV} />
          <NavSection title="System" items={SYSTEM_NAV} />

          <div className="text-[10px] uppercase tracking-widest px-3 pt-4 pb-1" style={{ color: MUTED }}>
            Quick Links
          </div>
          <Link to="/ap-invoices" className="flex items-center gap-2.5 px-3 py-2 mx-2 rounded-lg text-sm hover:bg-white/5" style={{ color: MUTED }}>
            <ExternalLink className="w-4 h-4 shrink-0" /> AP InvoiceFlow
          </Link>
          <Link to="/gulftax" className="flex items-center gap-2.5 px-3 py-2 mx-2 rounded-lg text-sm hover:bg-white/5" style={{ color: MUTED }}>
            <ExternalLink className="w-4 h-4 shrink-0" /> GulfTax VAT
          </Link>
          <a
            href="https://ifrsai.onrender.com"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2.5 px-3 py-2 mx-2 rounded-lg text-sm hover:bg-white/5"
            style={{ color: MUTED }}
          >
            <ExternalLink className="w-4 h-4 shrink-0" /> IFRS.ai
          </a>
        </nav>
      </aside>
      <main className="flex-1 overflow-x-hidden p-6">
        <Outlet />
      </main>
    </div>
  );
}
