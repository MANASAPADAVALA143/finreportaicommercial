import React, { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  BarChart3,
  Zap,
  Target,
  Brain,
  LayoutGrid,
  FileSpreadsheet,
  ShieldCheck,
  Globe,
  IndianRupee,
  ShoppingCart,
  Shield,
  Receipt,
} from 'lucide-react';
import { useAgentActivity } from '../../context/AgentActivityContext';
import type { AgentId } from '../../context/AgentActivityContext';
import { useAuth } from '../../context/AuthContext';
import { useMarket } from '../../contexts/MarketContext';
import { isUaeFinanceSuiteOnly } from '../../config/productRole';

type DashboardModule = {
  icon: React.ReactNode;
  title: string;
  description: string;
  link: string;
  bgColor: string;
  badge?: string;
};

/** UAE dashboard: pin these modules first; all others keep their original relative order. */
const UAE_MODULE_PRIORITY: readonly string[] = [
  '/ap-invoices',
  '/gulftax',
  '/uae-full',
  '/fpa',
  '/ifrs-statement',
  '/cfo',
  '/r2r-pattern',
];

function sortModulesForUae(modules: DashboardModule[]): DashboardModule[] {
  const priorityIndex = new Map(UAE_MODULE_PRIORITY.map((link, i) => [link, i]));
  const originalIndex = new Map(modules.map((m, i) => [m.link, i]));
  return [...modules].sort((a, b) => {
    const pa = priorityIndex.get(a.link);
    const pb = priorityIndex.get(b.link);
    if (pa !== undefined && pb !== undefined) return pa - pb;
    if (pa !== undefined) return -1;
    if (pb !== undefined) return 1;
    return (originalIndex.get(a.link) ?? 0) - (originalIndex.get(b.link) ?? 0);
  });
}

const UAE_FINANCE_SUITE_MODULES: DashboardModule[] = [
  {
    icon: <ShoppingCart className="w-14 h-14 text-teal-400" />,
    title: 'AP InvoiceFlow',
    description: 'Upload invoices, approvals, VAT recon, Zoho/QBO integrations',
    link: '/ap-invoices',
    bgColor: 'bg-teal-500/10',
    badge: 'AP',
  },
  {
    icon: <Shield className="w-14 h-14 text-amber-400" />,
    title: 'UAE Tax (GulfTax)',
    description: 'VAT classifier, VAT return, corporate tax, FTA reports, reconciliation',
    link: '/gulftax',
    bgColor: 'bg-amber-500/10',
    badge: 'GulfTax',
  },
  {
    icon: <Receipt className="w-14 h-14 text-blue-400" />,
    title: 'E-Invoicing',
    description: 'PINT AE validation, XML generation, ASP submissions',
    link: '/gulftax/e-invoicing',
    bgColor: 'bg-blue-500/10',
    badge: 'Peppol',
  },
];

const AGENT_DEFS: { id: AgentId; name: string; route: string; description: string }[] = [
  { id: 'r2r', name: 'R2R Anomaly Agent', route: '/r2r-pattern', description: 'Analyses journal entries, detects fraud patterns, scores risk using Isolation Forest + LLM' },
  { id: 'ifrs', name: 'IFRS Reporting Agent', route: '/ifrs-statement', description: 'Uploads trial balance, runs GL→IFRS AI mapping, and supports mapping review workflow' },
  { id: 'fpa', name: 'FP&A Intelligence Agent', route: '/fpa', description: 'Runs variance analysis, forecasting, and scenario planning with AI' },
  { id: 'decision', name: 'CFO Decision Agent', route: '/cfo-decision', description: 'Analyses investment decisions, capital allocation, hire vs automate with AI' },
  { id: 'voice', name: 'CFO Voice Agent', route: '/cfo', description: 'Answers financial questions by voice via the CFO assistant' },
];

export const Dashboard: React.FC = () => {
  const nav = useNavigate();
  const { productRole } = useAuth();
  const { isUAE } = useMarket();
  const uaeOnly = isUaeFinanceSuiteOnly(productRole);
  const { actions, activeAgents, markActive } = useAgentActivity();

  useEffect(() => {
    if (uaeOnly) nav('/gulftax', { replace: true });
  }, [uaeOnly, nav]);

  const modules: DashboardModule[] = [
    {
      icon: <Brain className="w-16 h-16 text-violet-400" />,
      title: 'AGENTIC Command Center',
      description: 'CFO morning briefing, agent runs, validation audit trail, NEXUS-C chat',
      link: '/command-center',
      bgColor: 'bg-violet-500/10',
      badge: 'AGENTIC',
    },
    {
      icon: <LayoutGrid className="w-16 h-16 text-indigo-400" />,
      title: 'R2R Service 1',
      description: 'Close Tracker · TB Variance Analysis · Bank Reconciliation',
      link: '/r2r',
      bgColor: 'bg-indigo-500/10'
    },
    {
      icon: <LayoutGrid className="w-16 h-16 text-indigo-400" />,
      title: 'R2R Pattern Engine',
      description: 'Upload journal entries for 7-model anomaly detection (Amount, Duplicate, User, Timing, Account, Vendor, Benford)',
      link: '/r2r-pattern',
      bgColor: 'bg-indigo-500/10'
    },
    {
      icon: <FileSpreadsheet className="w-16 h-16 text-blue-400" />,
      title: 'Rev Rec Reconciliation',
      description: 'IFRS 15 month-end — deferred revenue roll-forward, three-way match, anomalies, RPO, commission, AI commentary, period close',
      link: '/r2r/rev-rec',
      bgColor: 'bg-blue-500/10',
      badge: 'IFRS 15',
    },
    {
      icon: <BarChart3 className="w-16 h-16 text-green-400" />,
      title: 'FP&A Suite',
      description: 'Comprehensive planning, budgeting, and forecasting',
      link: '/fpa',
      bgColor: 'bg-green-500/10'
    },
    {
      icon: <FileSpreadsheet className="w-16 h-16 text-emerald-400" />,
      title: 'Excel AI Suite',
      description: 'Upload Excel — AI-enhanced workbooks for variance, budget, forecast, KPI, board pack, and more',
      link: '/excel-suite',
      bgColor: 'bg-emerald-500/10',
      badge: 'New'
    },
    {
      icon: <Target className="w-16 h-16 text-purple-400" />,
      title: 'CFO Services',
      description: 'AI Assistant, Insights, Monitoring & Financial Health Dashboard',
      link: '/cfo',
      bgColor: 'bg-purple-500/10'
    },
    {
      icon: <Zap className="w-16 h-16 text-orange-400" />,
      title: 'IFRS Statement',
      description: 'Week 1: Upload trial balance, run GL AI mapping, and confirm/override mappings',
      link: '/ifrs-statement',
      bgColor: 'bg-orange-500/10',
      badge: 'New'
    },
    {
      icon: <Brain className="w-16 h-16 text-violet-400" />,
      title: 'AI IFRS Generator',
      description: 'AGENTIC: NEXUS pipeline — map, build, audit, fix, notes, narrative, pack (XLSX/DOCX/PDF)',
      link: '/ifrs/agentic',
      bgColor: 'bg-violet-500/10',
      badge: 'AGENTIC'
    },
    {
      icon: <LayoutGrid className="w-16 h-16 text-cyan-400" />,
      title: 'ERP — Tally',
      description: 'Connect Tally Prime / ERP 9, import trial balance, pre-map by ledger group, AI fills gaps',
      link: '/erp/tally',
      bgColor: 'bg-cyan-500/10',
      badge: 'New'
    },
    {
      icon: <Brain className="w-16 h-16 text-amber-400" />,
      title: 'CFO Decision Intelligence',
      description: 'Investment ROI, Build vs Buy, Outsource vs Internal, Capital Allocation & Risk',
      link: '/cfo-decision',
      bgColor: 'bg-amber-500/10',
      badge: 'NEW'
    },
    {
      icon: <Zap className="w-16 h-16 text-emerald-400" />,
      title: 'Bookkeeping Autopilot',
      description: 'Bank upload, rules + Claude categorisation, anomalies, receipts, GL reconcile, monthly PDF',
      link: '/bookkeeping',
      bgColor: 'bg-emerald-500/10',
      badge: 'New'
    },
    {
      icon: <ShieldCheck className="w-16 h-16 text-amber-400" />,
      title: 'Audit Intelligence',
      description: 'Evidence sampling, IFRS checks, controls testing, SOX, and AML monitoring — PDF reports & history',
      link: '/audit',
      bgColor: 'bg-amber-500/5',
      badge: 'New'
    },
    {
      icon: <Globe className="w-16 h-16 text-blue-400" />,
      title: '🇦🇪 UAE Accounting',
      description: 'Full UAE accounting suite — VAT 5%, CT 9% (MoF Decision 134), IFRS depreciation, bank recon (ENBD/FAB/ADCB), accruals, EOSB, period close, management accounts',
      link: '/uae-full',
      bgColor: 'bg-blue-500/10',
      badge: 'UAE'
    },
    {
      icon: <IndianRupee className="w-16 h-16 text-orange-400" />,
      title: '🇮🇳 India Accounting',
      description: 'Complete India accounting — GST (CGST/SGST/IGST), TDS (194A/C/H/I/J), GSTR-1/3B, Payroll (PF/ESI/PT/Gratuity), Ind AS 16 fixed assets, period close',
      link: '/india-full',
      bgColor: 'bg-orange-500/10',
      badge: 'India'
    },
  ];

  const displayModules = isUAE
    ? sortModulesForUae([...UAE_FINANCE_SUITE_MODULES, ...modules])
    : modules;

  if (uaeOnly) return null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900">
      {/* Top Navigation Bar */}
      <nav className="bg-slate-900/50 backdrop-blur-sm border-b border-slate-700">
        <div className="container mx-auto px-6 py-4 flex justify-between items-center">
          <h1 className="text-2xl font-bold text-white">FinReport AI</h1>
        </div>
        <p className="container mx-auto px-6 pb-2 text-sm text-slate-400">
          Open a section below and upload data there to use it. Each section uses only its own uploads.
        </p>
      </nav>

      {/* UAE Finance Suite — India view only (UAE merges these into the main grid below) */}
      {!isUAE && (
        <div className="border-b border-teal-800/40 bg-teal-950/30">
          <div className="container mx-auto px-6 py-8">
            <div className="text-center mb-6">
              <h2 className="text-2xl font-bold text-white">🇦🇪 UAE Finance Suite</h2>
              <p className="text-sm text-teal-200/80 mt-1">
                AP invoices, GulfTax VAT/CT, and Peppol e-invoicing for UAE entities
              </p>
            </div>
            <div className="grid md:grid-cols-3 gap-4 max-w-5xl mx-auto">
              {UAE_FINANCE_SUITE_MODULES.map((mod) => (
                <Link
                  key={mod.link}
                  to={mod.link}
                  className="bg-slate-800/50 rounded-xl p-5 border border-teal-700/40 hover:border-teal-500/60 hover:bg-slate-800/70 transition-all group"
                >
                  <span className="inline-block px-2 py-0.5 mb-3 text-[10px] font-bold rounded-full bg-teal-700/50 text-teal-200">
                    {mod.badge}
                  </span>
                  <div className={`${mod.bgColor} w-14 h-14 rounded-lg flex items-center justify-center mb-3 group-hover:scale-105 transition-transform`}>
                    {mod.icon}
                  </div>
                  <h3 className="text-lg font-semibold text-white mb-1">{mod.title}</h3>
                  <p className="text-sm text-slate-400 leading-snug">{mod.description}</p>
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Agent Network Header */}
      <div className="border-b border-slate-700 bg-slate-800/30">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-lg font-semibold text-white">🤖 FinReportAI Agent Network</span>
            <span className="px-2 py-0.5 bg-green-500/20 text-green-400 text-sm font-medium rounded-full">
              ● {activeAgents.size} Agents Active
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {AGENT_DEFS.map((a) => (
              <Link
                key={a.id}
                to={a.route}
                onClick={() => markActive(a.id)}
                className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  activeAgents.has(a.id)
                    ? 'bg-green-500/20 text-green-400 border border-green-500/40 hover:bg-green-500/30'
                    : 'bg-slate-700/50 text-slate-400 border border-slate-600 hover:bg-slate-700'
                }`}
              >
                <span className={`w-2 h-2 rounded-full ${activeAgents.has(a.id) ? 'bg-green-500' : 'bg-slate-500'}`} />
                {a.name.replace(' Agent', '')} ✓
              </Link>
            ))}
          </div>
          {actions.length > 0 && (
            actions[0]?.agentId === 'r2r' ? (
              <Link to="/r2r-pattern" className="mt-2 block text-xs text-slate-400 hover:text-slate-300 hover:underline">
                Last action: &quot;{actions[0]?.message}&quot;
              </Link>
            ) : (
              <p className="mt-2 text-xs text-slate-400">
                Last action: &quot;{actions[0]?.message}&quot;
              </p>
            )
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="container mx-auto px-6 py-16">
        {/* Header Section */}
        <div className="text-center mb-16">
          <h1 className="text-5xl font-bold text-white mb-4">
            FinReport AI
          </h1>
          <p className="text-xl text-gray-300">
            Enterprise Financial Intelligence Platform with AI-powered insights
          </p>
        </div>

        {/* Features Grid */}
        <div className="grid md:grid-cols-2 gap-8 max-w-5xl mx-auto relative">
          {displayModules.map((module) => (
            <Link
              key={module.link}
              to={module.link}
              className="bg-slate-800/40 backdrop-blur-sm rounded-2xl p-8 hover:bg-slate-800/60 transition-all duration-300 border border-slate-700 hover:border-slate-600 group relative"
            >
              {module.badge && (
                <span className={`absolute top-4 right-4 px-3 py-1 text-white text-xs font-bold rounded-full ${
                  module.badge === 'UAE'   ? 'bg-blue-600' :
                  module.badge === 'India' ? 'bg-orange-600' :
                  'bg-amber-500'
                }`}>
                  {module.badge === 'UAE' ? '🇦🇪 UAE' : module.badge === 'India' ? '🇮🇳 India' : `${module.badge} ⭐`}
                </span>
              )}
              <div className={`${module.bgColor} w-20 h-20 rounded-xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform`}>
                {module.icon}
              </div>
              <h3 className="text-2xl font-bold text-white mb-3">{module.title}</h3>
              <p className="text-gray-300 leading-relaxed">{module.description}</p>
            </Link>
          ))}
        </div>

        {/* Agent Handoff Log */}
        <div className="mt-12 max-w-5xl mx-auto">
          <h3 className="text-lg font-semibold text-white mb-3">Agent Activity</h3>
          <div className="bg-slate-800/40 rounded-xl border border-slate-700 p-4 space-y-2">
            {actions.slice(0, 5).map((a, i) => (
              <div key={a.id || `action-${i}`} className="flex items-start gap-2 text-sm">
                <span className="text-slate-500">🤖</span>
                <span className="font-medium text-slate-300">{a.agentName}</span>
                <span className="text-slate-400">—</span>
                <span className="text-slate-300">&quot;{a.message}&quot;</span>
              </div>
            ))}
          </div>
        </div>

        <div className="fixed bottom-4 right-4">
          <span className="inline-block px-3 py-1.5 bg-slate-700/80 text-slate-300 text-xs font-medium rounded-lg border border-slate-600">
            AI · Anthropic / Gemini
          </span>
        </div>
      </div>
    </div>
  );
};
