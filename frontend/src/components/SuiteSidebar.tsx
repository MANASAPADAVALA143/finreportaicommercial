import { Link, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import {
  Activity, BarChart2, BookOpen, Bot, Brain, Building, Building2,
  Calculator, Calendar, Clock, Coins, FileText, GitMerge, LayoutDashboard,
  Landmark, Lock, MessageSquare, Percent, Plug, Receipt, ShoppingCart,
  Shield, Sliders, Table, TrendingUp, Users, ArrowRight, Presentation,
  Banknote, ShieldCheck, ShieldX, Upload, Layers,
} from 'lucide-react';
import { useSuite } from '../context/SuiteContext';
import { useCompany } from '../context/CompanyContext';
import { useAuth } from '../context/AuthContext';
import { SuiteSwitcher } from './SuiteSwitcher';
import { INDIA_NAV, UAE_NAV, FPA_NAV, UAE_FINANCE_SUITE_NAV, UAE_SUITE_NAV, isSection, type NavEntry, type NavLeaf } from '../config/suiteNavigation';
import { isUaeFinanceSuiteOnly, isUaeSuite, filterNavByRole } from '../config/productRole';
import { ErrorBoundary } from '../ErrorBoundary';

// ── Icon registry (lucide icons keyed by our string names) ───────────────────
const ICONS: Record<string, React.ElementType> = {
  'activity':        Activity,
  'arrow-right':     ArrowRight,
  'banknote':        Banknote,
  'bar-chart-2':     BarChart2,
  'book':            BookOpen,
  'bot':             Bot,
  'brain':           Brain,
  'building':        Building,
  'building-2':      Building2,
  'calculator':      Calculator,
  'calendar':        Calendar,
  'clock':           Clock,
  'coins':           Coins,
  'file-text':       FileText,
  'git-merge':       GitMerge,
  'landmark':        Landmark,
  'layers':          Layers,
  'layout-dashboard':LayoutDashboard,
  'lock':            Lock,
  'message-square':  MessageSquare,
  'percent':         Percent,
  'plug':            Plug,
  'presentation':    Presentation,
  'receipt':         Receipt,
  'shield':          Shield,
  'shopping-cart':   ShoppingCart,
  'sliders':         Sliders,
  'table':           Table,
  'trending-up':     TrendingUp,
  'users':           Users,
};

// ── GulfTax status widget (UAE suite only) ────────────────────────────────────

const GULFTAX_API = (import.meta.env.VITE_API_URL || 'http://127.0.0.1:8001');

type GulfTaxStatus = { online: boolean; status_code?: number; url?: string; error?: string };

function GulfTaxWidget() {
  const [status, setStatus]   = useState<GulfTaxStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const poll = () => {
    // GulfTax is now embedded — call the built-in status endpoint
    fetch(`/api/gulftax/status`)
      .then(r => r.json())
      .then((d: GulfTaxStatus) => setStatus(d))
      .catch(() => setStatus({ online: false, error: 'Backend offline' }))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    poll();
    const t = setInterval(poll, 30_000); // re-check every 30 s
    return () => clearInterval(t);
  }, []);

  const online = status?.online ?? false;

  return (
    <div className="mx-3 mb-2 rounded-lg border border-white/8 bg-white/[0.03] p-2.5">
      {/* Header row */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          {online
            ? <ShieldCheck className="w-3.5 h-3.5 text-teal-400" />
            : <ShieldX    className="w-3.5 h-3.5 text-red-400" />}
          <span className="text-[11px] font-semibold text-gray-300">GulfTax AI</span>
        </div>
        <span className={`flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full
          ${loading ? 'text-gray-500 bg-gray-700/40'
          : online  ? 'text-teal-300 bg-teal-900/40'
          :           'text-red-300 bg-red-900/40'}`}>
          {!loading && (
            <span className={`w-1.5 h-1.5 rounded-full ${online ? 'bg-teal-400 animate-pulse' : 'bg-red-500'}`} />
          )}
          {loading ? 'Checking…' : online ? 'Online' : 'Offline'}
        </span>
      </div>

      {/* Sub-label */}
      <p className="text-[10px] text-gray-500 mb-2 leading-tight">
        {online
          ? 'UAE VAT classification active. Invoices auto-classified on upload.'
          : 'UAE VAT classifier — restart FinReportAI backend to activate.'}
      </p>

      {/* Quick stats row */}
      {online && (
        <div className="flex gap-1 mb-2">
          {[
            { label: 'VAT 5%',   color: 'text-teal-400' },
            { label: 'Art. 54',  color: 'text-amber-400' },
            { label: 'TRN Check',color: 'text-blue-400' },
          ].map(b => (
            <span key={b.label} className={`text-[9px] ${b.color} bg-gray-800/60 px-1.5 py-0.5 rounded`}>
              {b.label}
            </span>
          ))}
        </div>
      )}

      {/* Upload link */}
      <Link
        to="/gulftax"
        className="block text-[10px] text-amber-400/80 hover:text-amber-300 mb-1.5"
      >
        Open GulfTax →
      </Link>
      <Link
        to="/ap-invoices/upload"
        className="flex items-center gap-1.5 text-[11px] text-teal-400 hover:text-teal-300 transition-colors mt-1"
      >
        <Upload className="w-3 h-3" />
        Upload & Classify Invoice
      </Link>
    </div>
  );
}


const SUITE_COLOR: Record<string, string> = {
  india: '#FF9933',
  uae:   '#0D9488',
  fpa:   '#7C3AED',
};

const BADGE_COLOR: Record<string, string> = {
  AI:      'bg-purple-700/40 text-purple-300',
  AP:      'bg-blue-700/40 text-blue-300',
  IFRS:    'bg-amber-700/40 text-amber-300',
  VAT:     'bg-teal-700/40 text-teal-300',
  CT:      'bg-orange-700/40 text-orange-300',
  ERP:     'bg-gray-600/40 text-gray-300',
  AGENTIC: 'bg-purple-800/40 text-purple-200',
  NEW:     'bg-green-700/40 text-green-300',
  Soon:    'bg-gray-600/40 text-gray-300',
  Group:   'bg-indigo-700/40 text-indigo-300',
};

function NavItem({ item, accentColor }: { item: NavLeaf; accentColor: string }) {
  const location = useLocation();
  const isActive =
    location.pathname === item.path ||
    (item.path !== '/' && item.path.length > 1 && location.pathname.startsWith(item.path));

  const Icon = item.icon ? ICONS[item.icon] : null;

  return (
    <Link
      to={item.path}
      className={`
        flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-all
        ${isActive
          ? 'text-white font-medium'
          : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'}
      `}
      style={
        isActive
          ? { backgroundColor: accentColor + '22', borderLeft: `2px solid ${accentColor}` }
          : { borderLeft: '2px solid transparent' }
      }
    >
      {Icon && <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />}
      <span className="flex-1 truncate text-[13px]">{item.label}</span>
      {item.badge && (
        <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold shrink-0 ${BADGE_COLOR[item.badge] || BADGE_COLOR.NEW}`}>
          {item.badge}
        </span>
      )}
    </Link>
  );
}

function renderNav(nav: NavEntry[], accentColor: string) {
  return nav.map((entry, idx) => {
    if (isSection(entry)) {
      return (
        <div key={idx} className="mt-3">
          <p className="px-3 py-1 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
            {entry.section}
          </p>
          {entry.items.map((item, si) => (
            <NavItem key={si} item={item} accentColor={accentColor} />
          ))}
        </div>
      );
    }
    return <NavItem key={idx} item={entry} accentColor={accentColor} />;
  });
}

export function SuiteSidebar() {
  const { activeSuite } = useSuite();
  const { companiesList } = useCompany();
  const { productRole, user } = useAuth();
  const uaeOnly = isUaeFinanceSuiteOnly(productRole);
  const uaeSuite = isUaeSuite(productRole);
  const accentColor = SUITE_COLOR[activeSuite];

  const uaeNav = uaeOnly
    ? UAE_FINANCE_SUITE_NAV
    : uaeSuite
      ? UAE_SUITE_NAV
      : companiesList.length >= 2
      ? [
          ...UAE_NAV.slice(0, 3),
          { label: 'Group Consolidation', path: '/consolidation', icon: 'layers', badge: 'Group' },
          ...UAE_NAV.slice(3),
        ]
      : UAE_NAV;

  const navItems = filterNavByRole(
    uaeOnly || uaeSuite
      ? uaeNav
      : activeSuite === 'india'
        ? INDIA_NAV
        : activeSuite === 'uae'
          ? uaeNav
          : FPA_NAV,
    productRole,
    user?.role,
  );

  return (
    <div
      className="flex flex-col h-full border-r border-white/10 w-60 shrink-0"
      style={{ background: '#0F1629' }}
    >
      {/* App header */}
      <div className="px-4 py-4 border-b border-white/10 shrink-0">
        <div className="text-white font-semibold text-sm">Gnanova Finance OS</div>
        <div className="text-gray-500 text-xs mt-0.5">AI-native Finance Platform</div>
      </div>

      {/* Suite switcher — hidden for uae_client and uae_suite */}
      {!uaeOnly && !uaeSuite && (
        <div className="shrink-0">
          <SuiteSwitcher />
        </div>
      )}

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-2 px-2 space-y-0.5">
        {renderNav(navItems, accentColor)}
      </nav>

      {/* GulfTax AI widget — UAE suite only */}
      {activeSuite === 'uae' && !uaeOnly && !uaeSuite && (
        <div className="shrink-0">
          <ErrorBoundary>
            <GulfTaxWidget />
          </ErrorBoundary>
        </div>
      )}

      {/* Shared AI services panel */}
      {!uaeOnly && !uaeSuite && (
      <div className="shrink-0 px-3 pb-2">
        <div className="rounded-lg bg-white/[0.03] border border-white/8 p-2.5">
          <div className="text-[10px] text-gray-500 mb-2 font-medium uppercase tracking-wider">
            Shared AI Services
          </div>
          <div className="grid grid-cols-2 gap-1">
            {[
              { label: 'R2R Engine',   path: '/r2r/pattern' },
              { label: 'Bank Recon',   path: '/ca-firm/bank-recon' },
              { label: 'Document AI',  path: '/ca-firm/bank-processor' },
              { label: 'NEXUS-C',      path: '/cfo' },
            ].map(s => (
              <Link
                key={s.label}
                to={s.path}
                className="text-[11px] text-gray-400 hover:text-gray-200 px-2 py-1.5 rounded hover:bg-white/5 truncate transition-colors"
              >
                {s.label}
              </Link>
            ))}
          </div>
        </div>
      </div>
      )}

      {/* NEXUS-C footer */}
      {!uaeOnly && !uaeSuite && (
      <div className="px-4 py-3 border-t border-white/10 shrink-0">
        <div className="text-[10px] text-gray-500 mb-1">NEXUS-C Agentic Layer</div>
        <Link
          to="/cfo"
          className="flex items-center gap-1.5 text-[11px] text-purple-400 hover:text-purple-300 transition-colors"
        >
          <Bot className="w-3.5 h-3.5" />
          Open Command Center
        </Link>
      </div>
      )}
    </div>
  );
}
