/**
 * APInvoicesLayout.tsx
 * AP InvoiceFlow embedded inside FinReportAI â€” dark design, live data from InvoiceFlow Supabase.
 * Full sidebar matching standalone InvoiceFlow app.
 */
import type React from 'react';
import { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useMarket } from '../../contexts/MarketContext';
import { MarketToggle } from '../../components/MarketToggle';
import { useAuth } from '../../context/AuthContext';
import {
  ensureApCompanySynced,
  getApCompanySyncStatus,
  setApSyncAccessToken,
  type ApCompanySyncStatus,
} from '../../lib/ap-invoice/workspaceCompanySync';
import { getStoredWorkspaceId } from '../../services/workspaceService';
import {
  LayoutDashboard, FileText, Upload, CheckCircle, Users,
  ShoppingCart, Package, ListTodo, TrendingUp, Landmark,
  Receipt, CalendarDays, BookOpen, Link2, Settings,
  BarChart3, Mail, AlertTriangle, ClipboardList, Building,
  Database, CreditCard, Shield, MessageSquare, FileDown,
} from 'lucide-react';

type NavItem = { to: string; label: string; icon: React.ElementType; end?: boolean };
type NavSection = { label: string | null; items: NavItem[] };

function useNavSections(isUAE: boolean): NavSection[] {
  return [
    {
      label: null,
      items: [
        { to: '/ap-invoices',              label: 'Dashboard',            icon: LayoutDashboard, end: true },
        { to: '/ap-invoices/cfo',          label: 'CFO Dashboard',        icon: BarChart3 },
        { to: '/ap-invoices/action-queue', label: "Action Queue",         icon: ListTodo },
      ],
    },
    {
      label: 'Invoices',
      items: [
        { to: '/ap-invoices/list',         label: 'Invoice List',         icon: FileText },
        { to: '/ap-invoices/upload',       label: 'Upload Invoice',       icon: Upload },
        { to: '/ap-invoices/approvals',    label: 'My Approvals',         icon: CheckCircle },
        { to: '/ap-invoices/email-invoices', label: 'Email Invoices',     icon: Mail },
        { to: '/ap-invoices/vendor-portal', label: 'Vendor Portal',       icon: Building },
      ],
    },
    {
      label: 'Procurement',
      items: [
        { to: '/ap-invoices/po',           label: 'Purchase Orders',      icon: ShoppingCart },
        { to: '/ap-invoices/grn',          label: 'Goods Receipts',       icon: Package },
        { to: '/ap-invoices/vendors',      label: 'Vendors',              icon: Users },
        { to: '/ap-invoices/bank-guarantees', label: 'Bank Guarantees',  icon: Shield },
        { to: '/ap-invoices/vendor-risk',  label: 'Vendor Risk',        icon: AlertTriangle },
      ],
    },
    {
      label: 'Analytics & Recon',
      items: [
        { to: '/ap-invoices/aging',        label: 'AP Aging',             icon: TrendingUp },
        { to: '/ap-invoices/bank-recon',   label: 'Bank Recon',           icon: Landmark },
        { to: '/ap-invoices/gst-recon',    label: isUAE ? 'VAT Recon' : 'GST Recon', icon: Receipt },
        { to: '/ap-invoices/calendar',     label: 'Payment Calendar',     icon: CalendarDays },
        { to: '/ap-invoices/gl-accounts',  label: 'GL Accounts',          icon: BookOpen },
        { to: '/ap-invoices/payment-log',  label: 'Payment Log',          icon: CreditCard },
      ],
    },
    {
      label: 'AI & Compliance',
      items: [
        { to: '/ap-invoices/anomaly',      label: 'Anomaly Intelligence',  icon: AlertTriangle },
        { to: '/ap-invoices/chat',         label: 'AP AI Chat',            icon: MessageSquare },
        { to: '/ap-invoices/month-end',    label: 'Month-End Close',       icon: ClipboardList },
        { to: '/ap-invoices/audit-log',    label: 'Audit Log',             icon: Shield },
        { to: '/ap-invoices/audit-trail',  label: 'Audit Trail Export',    icon: FileDown },
        { to: '/ap-invoices/training',     label: 'AI Training Data',      icon: Database },
      ],
    },
    {
      label: 'Setup',
      items: [
        { to: '/ap-invoices/company-config', label: 'Company Config',     icon: Building },
        { to: '/ap-invoices/onboarding',     label: 'Onboarding',         icon: ClipboardList },
        { to: '/ap-invoices/admin/clients',  label: 'Admin Clients',      icon: Users },
        { to: '/ap-invoices/integrations',   label: 'Integrations',       icon: Link2 },
        { to: '/ap-invoices/settings',       label: 'Settings',           icon: Settings },
      ],
    },
  ];
}

const linkBase   = 'flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors';
const linkIdle   = 'text-slate-300 hover:bg-slate-800 hover:text-white';
const linkActive = 'bg-blue-700/80 text-white';

function MarketToggleSidebar() {
  return (
    <div className="mt-2">
      <MarketToggle />
    </div>
  );
}

function ApWorkspaceSync() {
  const { accessToken } = useAuth();
  const [syncStatus, setSyncStatus] = useState<ApCompanySyncStatus>(() => getApCompanySyncStatus().status);
  const [syncDetail, setSyncDetail] = useState(() => getApCompanySyncStatus().detail);

  useEffect(() => {
    const onStatus = (e: Event) => {
      const detail = (e as CustomEvent<{ status: ApCompanySyncStatus; detail: string }>).detail;
      if (!detail) return;
      setSyncStatus(detail.status);
      setSyncDetail(detail.detail || '');
    };
    window.addEventListener('ap-company-sync-status', onStatus);
    return () => window.removeEventListener('ap-company-sync-status', onStatus);
  }, []);

  useEffect(() => {
    setApSyncAccessToken(accessToken);
    if (!getStoredWorkspaceId() || !accessToken) return;
    // Do not clearCompanyCache here — that forces re-resolution and re-sync on every token tick.
    void ensureApCompanySynced(accessToken);
  }, [accessToken]);

  if (syncStatus !== 'pending' && syncStatus !== 'error') return null;

  return (
    <div
      className="pointer-events-none absolute top-2 right-2 z-20 max-w-xs rounded-md border border-amber-700/60 bg-amber-950/90 px-2.5 py-1.5 text-[11px] text-amber-100 shadow"
      role="status"
    >
      {syncDetail || (syncStatus === 'pending' ? 'Company sync pending' : 'Company sync error')}
    </div>
  );
}

function APInvoicesLayoutInner() {
  const { isUAE } = useMarket();
  return (
    /* 36px = GnanovaBanner height; min-h-0 lets flex children scroll */
    <div className="relative flex h-[calc(100vh-36px)] w-full bg-gray-950 text-gray-100 overflow-hidden">
      <ApWorkspaceSync />
      {/* Left sub-nav — header/footer fixed, nav scrolls */}
      <aside className="w-56 shrink-0 border-r border-slate-800 bg-slate-900 flex flex-col h-full min-h-0 overflow-hidden">
        {/* Brand — pinned top */}
        <div className="shrink-0 px-4 py-4 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white font-bold text-sm">
              <FileText className="w-4 h-4" />
            </div>
            <div>
              <p className="text-sm font-bold text-white leading-tight">InvoiceFlow</p>
              <p className="text-[10px] text-slate-500">AP Processing</p>
            </div>
          </div>
          <span className="inline-flex items-center gap-1 mt-2 text-[10px] px-2 py-0.5 rounded-full bg-green-900 text-green-300 border border-green-800 font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            Live · InvoiceFlow
          </span>
          <MarketToggleSidebar />
        </div>

        {/* Nav — scrollable */}
        <nav className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-2 py-3 space-y-4 sidebar-scroll">
          {useNavSections(isUAE).map((section, si) => (
            <div key={si}>
              {section.label && (
                <p className="px-3 mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
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

        {/* Footer — pinned bottom */}
        <div className="shrink-0 px-4 py-3 border-t border-slate-800">
          <a
            href="https://apinvoiceflow.vercel.app"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] text-slate-500 hover:text-blue-400 flex items-center gap-1 transition-colors"
          >
            ↗ Open full InvoiceFlow app
          </a>
        </div>
      </aside>

      {/* Page content — light canvas for readable cards & text */}
      <div className="flex-1 min-w-0 min-h-0 overflow-y-auto bg-slate-100">
        <div className="p-6 min-h-full">
          <Outlet />
        </div>
      </div>
    </div>
  );
}

export default function APInvoicesLayout() {
  return <APInvoicesLayoutInner />;
}

