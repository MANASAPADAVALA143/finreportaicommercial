/**
 * UAE Accounting Overview — KPI Dashboard
 * Shows live metrics: Revenue, Expenses, AR Outstanding, Asset Count, etc.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Building2, BookOpen, TrendingUp, TrendingDown,
  FileText, Landmark, AlertCircle, CheckCircle2, ArrowRight, Tags,
} from 'lucide-react';
import * as svc from '../../services/uaeFullAccounting.service';
import type { DashboardKPIs, SetupContext } from '../../services/uaeFullAccounting.service';
import { useCompanySetupStatus } from '../../hooks/useCompanySetupStatus';
import { useCompany } from '../../context/CompanyContext';

const THIS_PERIOD = new Date().toISOString().slice(0, 7); // YYYY-MM

function fmt(n: number, currency = 'AED') {
  return currency + ' ' + n.toLocaleString('en-AE', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

export default function UAEAccountingOverview() {
  const navigate = useNavigate();
  const { setupRequired, loading: setupLoading } = useCompanySetupStatus();
  const { activeCompany } = useCompany();
  const [kpis, setKpis]     = useState<DashboardKPIs | null>(null);
  const [ctx, setCtx]       = useState<SetupContext | null>(null);
  const [period, setPeriod] = useState(THIS_PERIOD);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState('');

  useEffect(() => {
    svc.getSetupContext()
      .then(c => {
        setCtx(c);
        if (c.default_period) setPeriod(c.default_period);
      })
      .catch(() => null);
  }, [activeCompany?.id]);

  useEffect(() => {
    setLoading(true);
    svc.getDashboard(period)
      .then(setKpis)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [period, activeCompany?.id]);

  const currency = ctx?.company?.base_currency || activeCompany?.base_currency || 'AED';
  const companyName = ctx?.company?.company_name || activeCompany?.company_name;

  const tiles = kpis
    ? [
        { label: 'Revenue',       value: fmt(kpis.revenue, currency),       icon: TrendingUp,    color: 'text-green-400',  bg: 'bg-green-900/30' },
        { label: 'Expenses',      value: fmt(kpis.expenses, currency),      icon: TrendingDown,  color: 'text-red-400',    bg: 'bg-red-900/30' },
        { label: 'Net Profit',    value: fmt(kpis.net_profit, currency),    icon: Building2,     color: 'text-emerald-400',bg: 'bg-emerald-900/30' },
        { label: 'AR Outstanding',value: fmt(kpis.ar_outstanding, currency),icon: AlertCircle,   color: 'text-amber-400',  bg: 'bg-amber-900/30' },
        { label: 'Total Assets',  value: fmt(kpis.total_assets, currency),  icon: Landmark,      color: 'text-blue-400',   bg: 'bg-blue-900/30' },
        { label: 'GL Entries',    value: String(kpis.je_count),   icon: BookOpen,      color: 'text-purple-400', bg: 'bg-purple-900/30' },
        { label: 'Invoices',      value: String(kpis.invoice_count),icon: FileText,    color: 'text-cyan-400',   bg: 'bg-cyan-900/30' },
        { label: 'Active Assets', value: String(kpis.asset_count),icon: CheckCircle2,  color: 'text-teal-400',   bg: 'bg-teal-900/30' },
      ]
    : [];

  const modules = [
    { label: 'Chart of Accounts', path: '/uae-full/coa',         icon: BookOpen,   desc: 'View & manage 62-account UAE CoA' },
    { label: 'Journal Entries',   path: '/uae-full/journals',    icon: FileText,   desc: 'GL drill-down, double-entry ledger' },
    { label: 'Classify Accounts', path: '/uae-full/classify-accounts', icon: Tags, desc: 'AI BS/PL, Cash Flow & CIT classification' },
    { label: 'Sales Invoices',    path: '/uae-full/invoices',    icon: FileText,   desc: 'UAE VAT-compliant AR invoices' },
    { label: 'Bank Recon',        path: '/uae-full/bank-recon',  icon: Landmark,   desc: 'AI-assisted 3-step bank matching' },
    { label: 'Fixed Assets',      path: '/uae-full/fixed-assets',icon: Building2,  desc: 'IFRS + CT Ministerial Decision 134' },
    { label: 'Accruals',          path: '/uae-full/accruals',    icon: AlertCircle,desc: 'AI accrual suggestions + EOSB' },
    { label: 'Period-End Close',  path: '/uae-full/period-close',icon: CheckCircle2,desc: '13-item checklist + period lock' },
    { label: 'Management Accounts',path:'/uae-full/management',  icon: TrendingUp, desc: 'AI-generated CFO narrative pack' },
  ];

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* UAE Suite Banner */}
      <div className="bg-teal-900/20 border-b border-teal-800/30 px-6 py-3 flex items-center gap-3">
        <span className="text-lg">🇦🇪</span>
        <div>
          <span className="text-white font-medium text-sm">UAE Accounting Suite</span>
          {companyName && (
            <span className="text-teal-300 text-xs ml-3">{companyName}</span>
          )}
          <span className="text-teal-400 text-xs ml-3">VAT 5% · Corporate Tax 9% · IFRS · EOSB</span>
        </div>
      </div>
      {!setupLoading && setupRequired && (
        <div className="mx-6 mt-4 flex items-center justify-between gap-4 rounded-lg border border-amber-700/50 bg-amber-900/20 px-4 py-3">
          <div>
            <p className="text-sm font-medium text-amber-200">Complete company setup first</p>
            <p className="text-xs text-amber-400/80 mt-0.5">Configure your company profile, chart of accounts, and opening balances before using the UAE suite.</p>
          </div>
          <button
            type="button"
            onClick={() => navigate('/company-setup')}
            className="shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-sm font-medium"
          >
            Company Setup <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      )}
      <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">UAE Accounting Suite</h1>
          <p className="text-gray-400 text-sm mt-1">
            {companyName ? `${companyName} · ` : ''}
            {ctx?.has_opening_balance ? 'Opening balances loaded · ' : ''}
            {ctx?.coa_count ? `${ctx.coa_count} GL accounts · ` : ''}
            IFRS-aligned, UAE VAT & Corporate Tax ready
          </p>
        </div>
        <div className="flex items-center gap-2">
          {ctx?.periods && ctx.periods.length > 0 ? (
            <select
              value={period}
              onChange={e => setPeriod(e.target.value)}
              className="bg-gray-800 border border-gray-700 text-white px-3 py-2 rounded-lg text-sm"
            >
              {ctx.periods.map(p => (
                <option key={p.id} value={p.start_date.slice(0, 7)}>
                  {p.period_name} ({p.status})
                </option>
              ))}
            </select>
          ) : (
            <input
              type="month"
              value={period}
              onChange={e => setPeriod(e.target.value)}
              className="bg-gray-800 border border-gray-700 text-white px-3 py-2 rounded-lg text-sm"
            />
          )}
        </div>
      </div>

      {error && (
        <div className="bg-red-900/40 border border-red-700 rounded-lg p-4 mb-6 text-red-300">
          {error}
        </div>
      )}

      {/* KPI Grid */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="bg-gray-800/60 rounded-xl p-4 animate-pulse h-24" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {tiles.map(t => (
            <div key={t.label} className={`${t.bg} rounded-xl p-4 border border-gray-700/50`}>
              <div className="flex items-center gap-2 mb-2">
                <t.icon size={16} className={t.color} />
                <span className="text-xs text-gray-400">{t.label}</span>
              </div>
              <p className={`text-lg font-bold ${t.color}`}>{t.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Module Cards */}
      <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Modules</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {modules.map(m => (
          <button
            key={m.label}
            onClick={() => navigate(m.path)}
            className="bg-gray-800/60 hover:bg-gray-700/60 border border-gray-700 rounded-xl p-4 text-left transition-all group"
          >
            <m.icon size={20} className="text-green-400 mb-2 group-hover:scale-110 transition-transform" />
            <p className="text-sm font-semibold text-white">{m.label}</p>
            <p className="text-xs text-gray-500 mt-1">{m.desc}</p>
          </button>
        ))}
      </div>
      </div>{/* end p-6 */}
    </div>
  );
}
