import { Link, useLocation, useNavigate } from 'react-router-dom';
import { cn } from '@/lib/ap-invoice/utils';
import {
  LayoutDashboard,
  Upload,
  FileText,
  Settings,
  Menu,
  X,
  LogOut,
  Landmark,
  Zap,
  FileSpreadsheet,
  Receipt,
  Home,
  Calendar as CalendarIcon,
  Building2,
  ShoppingCart,
  ClipboardList,
  BookOpen,
  Mail,
  MessageCircle,
  UserCheck,
  Shield,
  BarChart3,
  ChevronDown,
  SlidersHorizontal,
  Wallet,
  Star,
  CheckSquare,
  ListTodo,
  Brain,
  ShieldCheck,
  Scale,
} from 'lucide-react';
import { useEffect, useState, type ComponentType } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  clearCompanyCache,
  getMyCompany,
  getMyCompanyMemberRole,
  canViewPaymentLog,
  isSuperAdmin,
  listMyCompanies,
  type CompanyWithStats,
  switchActiveCompany,
  type Company,
} from '@/lib/ap-invoice/companyService';
import { signOut } from '@/lib/ap-invoice/authService';
import { clearInsightCache, countCriticalStrategicInsights } from '@/lib/ap-invoice/strategicAdvisorService';
import { useMarket } from '@/contexts/MarketContext';

type NavItem = {
  name: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
  /** Shown only to finance_manager, admin, owner, super_admin */
  financeOnly?: boolean;
};

const navigation: NavItem[] = [
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { name: "Today's Action Queue", href: '/action-queue', icon: ListTodo },
  { name: 'Upload Invoice', href: '/upload', icon: Upload },
  { name: 'Invoice List', href: '/invoices', icon: FileText },
  { name: 'My Approvals', href: '/approvals', icon: UserCheck },
  { name: 'Settings', href: '/settings', icon: Settings },
  { name: 'Purchase Orders', href: '/purchase-orders', icon: ShoppingCart },
  { name: 'Goods Receipts', href: '/goods-receipts', icon: ClipboardList },
  { name: 'GL Accounts', href: '/gl-accounts', icon: BookOpen },
  { name: 'Bank Recon', href: '/bank-recon', icon: Landmark },
  { name: 'AP Aging', href: '/reports/aging', icon: BarChart3 },
  { name: 'GST Recon', href: '/gst-recon', icon: Receipt },
  { name: 'Calendar', href: '/calendar', icon: CalendarIcon },
  { name: 'Payment Log', href: '/payment-log', icon: Wallet, financeOnly: true },
  { name: 'Vendors', href: '/vendors', icon: Building2 },
  { name: 'Bank Guarantees', href: '/ap-invoices/bank-guarantees', icon: ShieldCheck },
  { name: 'Vendor Risk', href: '/ap-invoices/vendor-risk', icon: Scale },
  { name: 'Audit Trail', href: '/ap-invoices/audit-trail', icon: Shield },
  { name: 'Email Invoices', href: '/email-invoices', icon: Mail },
  { name: 'AP AI Chat', href: '/chat', icon: MessageCircle },
  { name: 'Audit log', href: '/audit-log', icon: Shield },
  { name: 'Month-End Close', href: '/month-end', icon: CheckSquare },
  { name: '🧠 Training Data', href: '/training', icon: Brain },
  { name: '⚡ Anomaly Intelligence', href: '/anomaly-intelligence', icon: Brain },
];

const caFirmNav: NavItem[] = [
  { name: 'CA Firm Hub', href: '/ca-firm', icon: LayoutDashboard },
  { name: 'Bank Processor', href: '/ca-firm/bank-processor', icon: Landmark },
  { name: 'Tally Auto-Posting', href: '/ca-firm/tally-posting', icon: Zap },
  { name: 'TB → Financials', href: '/ca-firm/tb-financials', icon: FileSpreadsheet },
  { name: 'Client Reports', href: '/ca-firm/client-reports', icon: Receipt },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { market, setMarket, isUAE } = useMarket();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [tenant, setTenant] = useState<Company | null>(null);
  const [tenants, setTenants] = useState<CompanyWithStats[]>([]);
  const [showAdmin, setShowAdmin] = useState(false);
  const [showPaymentLogNav, setShowPaymentLogNav] = useState(false);
  const [cfoCriticalCount, setCfoCriticalCount] = useState(0);

  useEffect(() => {
    void (async () => {
      clearCompanyCache();
      const cur = await getMyCompany();
      setTenant(cur);
      const list = await listMyCompanies();
      setTenants(list);
      setShowAdmin(await isSuperAdmin());
      const role = await getMyCompanyMemberRole();
      setShowPaymentLogNav(canViewPaymentLog(role));
      try {
        clearInsightCache();
        const n = await countCriticalStrategicInsights();
        setCfoCriticalCount(n);
      } catch {
        setCfoCriticalCount(0);
      }
    })();
  }, [location.pathname]);

  const handleLogout = async () => {
    try {
      await signOut();
    } catch {
      // ignore — navigate regardless
    }
    clearCompanyCache();
    navigate('/login', { replace: true });
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Gnanova Finance OS cross-app banner */}
      <div
        style={{
          height: 36,
          background: '#0f2d5e',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 20px',
          fontFamily: 'system-ui, sans-serif',
          fontSize: 13,
          color: '#e2e8f0',
          position: 'sticky',
          top: 0,
          zIndex: 9999,
        }}
      >
        <span style={{ fontWeight: 600, letterSpacing: '0.02em' }}>Gnanova Finance OS</span>
        <a
          href="https://gnanova-finreportai.vercel.app"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: '#93c5fd', textDecoration: 'none', fontWeight: 500 }}
        >
          📊 FinReportAI →
        </a>
      </div>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-gray-600 bg-opacity-75 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar — top:36px accounts for the 36px Gnanova banner */}
      <div
        style={{ top: 36 }}
        className={cn(
          'fixed bottom-0 left-0 z-50 w-64 transform bg-white shadow-lg transition-transform duration-300 ease-in-out lg:translate-x-0',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="flex h-full flex-col">
          {/* Logo */}
          <div className="flex h-16 items-center justify-between border-b border-gray-200 px-6">
            <div className="flex items-center gap-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-600">
                <FileText className="h-6 w-6 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-gray-900">InvoiceFlow</h1>
                <p className="text-xs text-gray-500">AP Processing</p>
              </div>
            </div>
            <button
              onClick={() => setSidebarOpen(false)}
              className="lg:hidden"
            >
              <X className="h-6 w-6 text-gray-500" />
            </button>
          </div>

          {/* Navigation — scrollable */}
          <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4 scrollbar-thin">
            <Link
              to="/cfo-dashboard"
              onClick={() => setSidebarOpen(false)}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors ring-1 ring-amber-400/60 bg-amber-50/90 text-amber-950 hover:bg-amber-100',
                location.pathname === '/cfo-dashboard' ? 'ring-2 ring-amber-500 bg-amber-100' : ''
              )}
            >
              <Star className="h-5 w-5 shrink-0 text-amber-600" />
              <span className="flex-1">CFO Dashboard</span>
              {cfoCriticalCount > 0 ? (
                <span className="rounded-full bg-red-600 px-2 py-0.5 text-[11px] font-medium leading-none text-white">
                  {cfoCriticalCount > 99 ? '99+' : cfoCriticalCount}
                </span>
              ) : null}
            </Link>
            {navigation.map((item) => {
              if (item.financeOnly && !showPaymentLogNav) return null;
              const isActive = location.pathname === item.href;
              return (
                <Link
                  key={item.name}
                  to={item.href}
                  onClick={() => setSidebarOpen(false)}
                  className={cn(
                    'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-blue-50 text-blue-700'
                      : 'text-gray-700 hover:bg-gray-100 hover:text-gray-900'
                  )}
                >
                  <item.icon className="h-5 w-5" />
                  {item.name === 'GST Recon' ? (isUAE ? 'VAT Recon' : 'GST Recon') : item.name}
                </Link>
              );
            })}
            <Link
              to="/company/config"
              onClick={() => setSidebarOpen(false)}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                location.pathname === '/company/config'
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-gray-700 hover:bg-gray-100 hover:text-gray-900'
              )}
            >
              <SlidersHorizontal className="h-5 w-5" />
              Company config
            </Link>
            {showAdmin && (
              <Link
                to="/admin/clients"
                onClick={() => setSidebarOpen(false)}
                className={cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                  location.pathname === '/admin/clients'
                    ? 'bg-blue-50 text-blue-700'
                    : 'text-gray-700 hover:bg-gray-100 hover:text-gray-900'
                )}
              >
                <Shield className="h-5 w-5" />
                Admin — Clients
              </Link>
            )}
          </nav>

          {/* CA Firm Tools section */}
          <div className="mt-2 px-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 px-3 pt-3 pb-1">CA Firm Tools</p>
            <nav className="space-y-0.5">
              {caFirmNav.map((item) => {
                const active = location.pathname === item.href || location.pathname.startsWith(item.href + '/');
                return (
                  <Link
                    key={item.href}
                    to={item.href}
                    onClick={() => setSidebarOpen(false)}
                    className={cn(
                      'flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                      active
                        ? 'bg-amber-100 text-amber-800'
                        : 'text-gray-700 hover:bg-gray-100 hover:text-gray-900'
                    )}
                  >
                    <item.icon className="h-4 w-4 shrink-0" />
                    {item.name}
                  </Link>
                );
              })}
            </nav>
          </div>

          {/* Footer */}
          <div className="shrink-0 border-t border-gray-200 p-4 space-y-3">
            <Link
              to="/"
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
            >
              <Home className="h-4 w-4" />
              Back to Home
            </Link>
            <Button
              onClick={handleLogout}
              variant="outline"
              className="w-full justify-start text-gray-700"
              size="sm"
            >
              <LogOut className="mr-2 h-4 w-4" />
              Logout
            </Button>
            <p className="text-xs text-gray-500 text-center pt-2">
              © 2024 InvoiceFlow
            </p>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="lg:pl-64">
        {/* Mobile header */}
        <div className="sticky top-9 z-10 flex h-16 items-center gap-3 border-b border-gray-200 bg-white px-4 lg:hidden">
          <button
            onClick={() => setSidebarOpen(true)}
            className="text-gray-500"
          >
            <Menu className="h-6 w-6" />
          </button>
          <h1 className="flex-1 text-lg font-semibold text-gray-900">InvoiceFlow</h1>
          <div className="flex shrink-0 items-center gap-0.5 rounded-lg border p-0.5">
            <button
              type="button"
              onClick={() => void setMarket('india')}
              className={cn(
                'rounded-md px-2 py-1 text-[10px] font-semibold transition-colors',
                market === 'india' ? 'bg-[#1D9E75] text-white' : 'text-gray-600',
              )}
            >
              🇮🇳
            </button>
            <button
              type="button"
              onClick={() => void setMarket('uae')}
              className={cn(
                'rounded-md px-2 py-1 text-[10px] font-semibold transition-colors',
                market === 'uae' ? 'bg-[#378ADD] text-white' : 'text-gray-600',
              )}
            >
              🇦🇪
            </button>
          </div>
        </div>

        {/* Desktop header */}
        <div className="sticky top-9 z-10 hidden h-16 items-center justify-between border-b border-gray-200 bg-white px-8 lg:flex">
          <div className="flex items-center gap-4">
            <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2 text-gray-800">
                <Building2 className="h-4 w-4" />
                <span className="max-w-[200px] truncate">{tenant?.name ?? 'Company'}</span>
                <ChevronDown className="h-4 w-4 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuLabel>Switch workspace</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {tenants.length === 0 && (
                <DropdownMenuItem disabled>No companies found</DropdownMenuItem>
              )}
              {tenants.map((c) => (
                <DropdownMenuItem
                  key={c.id}
                  onClick={() => {
                    void (async () => {
                      try {
                        await switchActiveCompany(c.id);
                        clearCompanyCache();
                        window.location.reload();
                      } catch {
                        setTenant(c);
                      }
                    })();
                  }}
                >
                  <span className="flex w-full items-center justify-between gap-3">
                    <span className="truncate">{c.name}</span>
                    <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">
                      {c.invoice_count ?? 0} inv{c.id === tenant?.id ? ' ✓' : ''}
                    </span>
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <div className="flex items-center gap-1 rounded-lg border p-0.5">
            <button
              type="button"
              onClick={() => void setMarket('india')}
              title="India mode — GST, GSTIN, INR"
              className={cn(
                'rounded-md px-3 py-1.5 text-xs font-semibold transition-colors',
                market === 'india' ? 'bg-[#1D9E75] text-white' : 'text-gray-600 hover:bg-gray-50',
              )}
            >
              🇮🇳 India
            </button>
            <button
              type="button"
              onClick={() => void setMarket('uae')}
              title="UAE mode — VAT, TRN, AED"
              className={cn(
                'rounded-md px-3 py-1.5 text-xs font-semibold transition-colors',
                market === 'uae' ? 'bg-[#378ADD] text-white' : 'text-gray-600 hover:bg-gray-50',
              )}
            >
              🇦🇪 UAE
            </button>
          </div>
          </div>
          <Button
            onClick={handleLogout}
            variant="outline"
            size="sm"
            className="text-gray-700"
          >
            <LogOut className="mr-2 h-4 w-4" />
            Logout
          </Button>
        </div>

        {/* Page content */}
        <main className="p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
