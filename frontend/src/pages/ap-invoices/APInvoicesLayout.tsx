/**
 * APInvoicesLayout.tsx
 * AP InvoiceFlow embedded inside FinReportAI â€” dark design, live data from InvoiceFlow Supabase.
 * Full sidebar matching standalone InvoiceFlow app.
 */
import type React from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { MarketProvider, useMarket } from '../../contexts/MarketContext';
import {
  LayoutDashboard,
  FileText,
  Upload,
  CheckCircle,
  Users,
  ShoppingCart,
  Package,
  ListTodo,
  TrendingUp,
  Landmark,
  Receipt,
  CalendarDays,
  BookOpen,
  Link2,
  Settings,
} from 'lucide-react';

type NavItem = { to: string; label: string; icon: React.ElementType; end?: boolean };
type NavSection = { label: string | null; items: NavItem[] };

const NAV_SECTIONS: NavSection[] = [
  {
    label: null,
    items: [
      { to: '/ap-invoices',              label: 'CFO Dashboard',       icon: LayoutDashboard, end: true },
      { to: '/ap-invoices/action-queue', label: "Today's Action Queue", icon: ListTodo },
    ],
  },
  {
    label: 'Invoices',
    items: [
      { to: '/ap-invoices/list',         label: 'Invoice List',        icon: FileText },
      { to: '/ap-invoices/upload',       label: 'Upload Invoice',      icon: Upload },
      { to: '/ap-invoices/approvals',    label: 'My Approvals',        icon: CheckCircle },
    ],
  },
  {
    label: 'Procurement',
    items: [
      { to: '/ap-invoices/po',           label: 'Purchase Orders',     icon: ShoppingCart },
      { to: '/ap-invoices/grn',          label: 'Goods Receipts',      icon: Package },
      { to: '/ap-invoices/vendors',      label: 'Vendors',             icon: Users },
    ],
  },
  {
    label: 'Analytics',
    items: [
      { to: '/ap-invoices/aging',        label: 'AP Aging',            icon: TrendingUp },
      { to: '/ap-invoices/bank-recon',   label: 'Bank Recon',          icon: Landmark },
      { to: '/ap-invoices/gst-recon',    label: 'GST Recon',           icon: Receipt },
      { to: '/ap-invoices/calendar',     label: 'Calendar',            icon: CalendarDays },
      { to: '/ap-invoices/gl-accounts',  label: 'GL Accounts',         icon: BookOpen },
    ],
  },
  {
    label: 'Setup',
    items: [
      { to: '/ap-invoices/integrations', label: 'Integrations',        icon: Link2 },
      { to: '/ap-invoices/settings',     label: 'Settings',            icon: Settings },
    ],
  },
];

const linkBase   = 'flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors';
const linkIdle   = 'text-slate-400 hover:bg-slate-800 hover:text-white';
const linkActive = 'bg-blue-700/80 text-white';

function MarketToggle() {
  const { market, setMarket, isUAE } = useMarket();
  return (
    <div className="flex items-center gap-1 bg-slate-800 rounded-full p-0.5 mt-2">
      <button
        onClick={() => setMarket('uae')}
        className={`flex-1 text-[10px] font-semibold px-2 py-1 rounded-full transition-all ${
          isUAE ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
        }`}
      >
        🇦🇪 UAE
      </button>
      <button
        onClick={() => setMarket('india')}
        className={`flex-1 text-[10px] font-semibold px-2 py-1 rounded-full transition-all ${
          !isUAE ? 'bg-orange-600 text-white' : 'text-slate-400 hover:text-white'
        }`}
      >
        🇮🇳 India
      </button>
    </div>
  );
}

function APInvoicesLayoutInner() {
  const { isUAE } = useMarket();
  return (
    <div className="flex min-h-screen w-full bg-gray-950 text-gray-100">
      {/* Left sub-nav */}
      <aside className="w-56 shrink-0 border-r border-slate-800 bg-slate-900 flex flex-col overflow-y-auto">
        {/* Brand */}
        <div className="px-4 py-5 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white font-bold text-sm">ðŸ“„</div>
            <div>
              <p className="text-sm font-bold text-white leading-tight">InvoiceFlow</p>
              <p className="text-[10px] text-slate-500">AP Processing</p>
            </div>
          </div>
          <span className="inline-flex items-center gap-1 mt-2 text-[10px] px-2 py-0.5 rounded-full bg-green-900 text-green-300 border border-green-800 font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            Live Â· InvoiceFlow
          </span>
          <MarketToggle />
        </div>

        {/* Nav */}
        <nav className="flex-1 px-2 py-3 space-y-4">
          {NAV_SECTIONS.map((section, si) => (
            <div key={si}>
              {section.label && (
                <p className="px-3 mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
                  {section.label}
                </p>
              )}
              <div className="flex flex-col gap-0.5">
                {section.items.map(({ to, label, icon: Icon, end }) => (
                  <NavLink
                    key={to}
                    to={to}
                    end={end ?? false}
                    className={({ isActive }) => `${linkBase} ${isActive ? linkActive : linkIdle}`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span className="truncate">{label}</span>
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-slate-800">
          <a
            href="https://apinvoiceflow.vercel.app"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] text-slate-500 hover:text-blue-400 flex items-center gap-1 transition-colors"
          >
            â†— Open full InvoiceFlow app
          </a>
        </div>
      </aside>

      {/* Page content */}
      <div className="flex-1 min-w-0 overflow-y-auto">
        <Outlet />
      </div>
    </div>
  );
}

export default function APInvoicesLayout() {
  return (
    <MarketProvider>
      <APInvoicesLayoutInner />
    </MarketProvider>
  );
}

