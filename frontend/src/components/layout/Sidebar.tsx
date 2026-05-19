/**
 * Sidebar.tsx
 * ──────────────────────────────────────────────────────────────────────────────
 * Config-driven sidebar. Navigation items come from productConfig.ts which
 * reads VITE_PRODUCT to determine which product is active:
 *
 *   VITE_PRODUCT=invoiceflow  → AP Automation sidebar
 *   VITE_PRODUCT=finreportai  → R2R + FP&A + CFO sidebar
 *   VITE_PRODUCT=combined     → Full Gnanova Finance OS sidebar (default)
 *
 * To add a new nav item: edit src/config/productConfig.ts only.
 * This component never needs to change for new pages.
 */

import { NavLink, useLocation } from 'react-router-dom';
import {
  Activity,
  BarChart2,
  BookOpen,
  ExternalLink as ExternalLinkIcon,
  Building2,
  CalendarDays,
  Calendar,
  CheckCircle,
  Clock,
  CreditCard,
  FileText,
  GitMerge,
  History,
  Landmark,
  Layers,
  LayoutDashboard,
  LineChart,
  Package,
  PieChart,
  Plug,
  Receipt,
  RefreshCcw,
  ShieldAlert,
  ShoppingCart,
  TableProperties,
  TrendingUp,
  Upload,
  Users,
} from 'lucide-react';

import { useAuth } from '../../context/AuthContext';
import { currentSections, currentBranding, type NavItem } from '../../config/productConfig';

// ── Icon map ──────────────────────────────────────────────────────────────────

const ICON_MAP: Record<string, React.ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }>> = {
  Activity,
  BarChart2,
  ExternalLink: ExternalLinkIcon,
  BookOpen,
  Building2,
  CalendarDays,
  Calendar,
  CheckCircle,
  Clock,
  CreditCard,
  FileText,
  GitMerge,
  History,
  Landmark,
  Layers,
  LayoutDashboard,
  LineChart,
  Package,
  PieChart,
  Plug,
  Receipt,
  RefreshCcw,
  ShieldAlert,
  ShoppingCart,
  TableProperties,
  TrendingUp,
  Upload,
  Users,
};

// ── Style constants ────────────────────────────────────────────────────────────

const linkBase   = 'flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors border border-transparent';
const linkIdle   = 'text-slate-300 hover:bg-slate-800/80 hover:text-white';
const linkActive = 'bg-blue-600 text-white border-blue-500 shadow-sm';

// ── NavItem component ──────────────────────────────────────────────────────────

function SidebarLink({ item }: { item: NavItem }) {
  const { pathname } = useLocation();
  const { hasPermission } = useAuth();

  // Permission gate
  if (item.permission && !hasPermission(item.permission) && !hasPermission('*')) {
    return null;
  }

  const Icon = ICON_MAP[item.icon] ?? BarChart2;

  // External links (cross-app navigation to InvoiceFlow etc.) — open in new tab
  if (item.external) {
    return (
      <a
        href={item.path}
        target="_blank"
        rel="noopener noreferrer"
        className={`${linkBase} ${linkIdle} justify-between`}
      >
        <span className="flex items-center gap-2">
          <Icon className="w-4 h-4 shrink-0" aria-hidden />
          {item.label}
        </span>
        <ExternalLink className="w-3 h-3 shrink-0 opacity-50" aria-hidden />
      </a>
    );
  }

  const isActive = pathname === item.path || pathname.startsWith(item.path + '/');

  return (
    <NavLink
      to={item.path}
      className={() => `${linkBase} ${isActive ? linkActive : linkIdle}`}
      end
    >
      <Icon className="w-4 h-4 shrink-0" aria-hidden />
      {item.label}
    </NavLink>
  );
}

// ── Main Sidebar ───────────────────────────────────────────────────────────────

export default function Sidebar() {
  const { user, logout } = useAuth();

  const role = user?.role ?? 'accountant';
  const roleBadge =
    role === 'super_admin'    ? 'bg-purple-700'
    : role === 'cfo'          ? 'bg-blue-700'
    : role === 'finance_manager' ? 'bg-teal-700'
    : role === 'auditor'      ? 'bg-orange-700'
    : 'bg-green-700';

  return (
    <aside className="w-56 shrink-0 border-r border-slate-700 bg-slate-900 flex flex-col min-h-screen py-6 px-3">

      {/* Brand header */}
      <div className="px-2 mb-4">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          {currentBranding.tagline}
        </p>
        <p className="text-sm font-bold text-white">{currentBranding.name}</p>
      </div>

      {/* Dynamic nav sections */}
      <div className="flex flex-col gap-4 flex-1 overflow-y-auto">
        {currentSections.map((section, si) => (
          <div key={si}>
            {si > 0 && <div className="border-t border-slate-800 mb-3" />}
            <p className={`text-[10px] font-semibold uppercase tracking-wider mb-1 px-2 ${section.headingColor ?? 'text-slate-500'}`}>
              {section.heading}
            </p>
            <nav className="flex flex-col gap-0.5">
              {section.items.map((item) => (
                <SidebarLink key={item.path} item={item} />
              ))}
            </nav>
          </div>
        ))}

        {/* Super-admin always gets User Management regardless of product */}
        {role === 'super_admin' && (
          <div>
            <div className="border-t border-slate-800 mb-3" />
            <p className="text-[10px] font-semibold uppercase tracking-wider mb-1 px-2 text-slate-500">Admin</p>
            <nav className="flex flex-col gap-0.5">
              <SidebarLink item={{ label: 'User Management', path: '/users', icon: 'Users' }} />
            </nav>
          </div>
        )}
      </div>

      {/* User footer */}
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
