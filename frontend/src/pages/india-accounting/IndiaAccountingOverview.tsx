/**
 * India Accounting Overview — Dashboard
 * GST · TDS · Payroll · Ind AS · GSTR filings
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { IndianRupee, FileText, Users, Landmark, TrendingUp, BookOpen, Receipt, Calculator, Lock, BarChart2, RefreshCw } from 'lucide-react';
import * as svc from '../../services/indiaAccounting.service';
import type { IndiaDashboard } from '../../services/indiaAccounting.service';

const THIS_PERIOD = new Date().toISOString().slice(0, 7);

const MODULES = [
  { label: 'Chart of Accounts', path: '/india-full/coa',        icon: BookOpen,      color: 'text-blue-400',   bg: 'bg-blue-900/20',   border: 'border-blue-800/40' },
  { label: 'Journal Entries',   path: '/india-full/journals',   icon: FileText,      color: 'text-emerald-400',bg: 'bg-emerald-900/20',border: 'border-emerald-800/40' },
  { label: 'Sales Invoices',    path: '/india-full/sales',      icon: Receipt,       color: 'text-yellow-400', bg: 'bg-yellow-900/20', border: 'border-yellow-800/40' },
  { label: 'Purchase Invoices', path: '/india-full/purchases',  icon: IndianRupee,   color: 'text-orange-400', bg: 'bg-orange-900/20', border: 'border-orange-800/40' },
  { label: 'TDS Management',    path: '/india-full/tds',        icon: Calculator,    color: 'text-red-400',    bg: 'bg-red-900/20',    border: 'border-red-800/40' },
  { label: 'GST Returns',       path: '/india-full/gst',        icon: Landmark,      color: 'text-purple-400', bg: 'bg-purple-900/20', border: 'border-purple-800/40' },
  { label: 'Payroll',           path: '/india-full/payroll',    icon: Users,         color: 'text-cyan-400',   bg: 'bg-cyan-900/20',   border: 'border-cyan-800/40' },
  { label: 'Fixed Assets',      path: '/india-full/assets',     icon: TrendingUp,    color: 'text-pink-400',   bg: 'bg-pink-900/20',   border: 'border-pink-800/40' },
  { label: 'Period-End Close',  path: '/india-full/close',      icon: Lock,          color: 'text-amber-400',  bg: 'bg-amber-900/20',  border: 'border-amber-800/40' },
  { label: 'Management Accts',  path: '/india-full/management', icon: BarChart2,     color: 'text-indigo-400', bg: 'bg-indigo-900/20', border: 'border-indigo-800/40' },
];

export default function IndiaAccountingOverview() {
  const navigate = useNavigate();
  const [kpis, setKpis] = useState<IndiaDashboard | null>(null);
  const [period, setPeriod] = useState(THIS_PERIOD);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = () => {
    setLoading(true);
    svc.getIndiaDashboard(period)
      .then(setKpis)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, [period]);

  const fmt = (v?: number) => `₹${(v ?? 0).toLocaleString('en-IN')}`;

  const KPI_CARDS = kpis ? [
    { label: 'Revenue',          value: fmt(kpis.revenue),             color: 'text-emerald-400' },
    { label: 'AR Outstanding',   value: fmt(kpis.ar_outstanding),       color: 'text-yellow-400' },
    { label: 'Payroll Cost',     value: fmt(kpis.payroll_cost),         color: 'text-cyan-400' },
    { label: 'GST Payable',      value: fmt(kpis.gst_payable),          color: 'text-purple-400' },
    { label: 'TDS Deducted',     value: fmt(kpis.tds_deducted),         color: 'text-red-400' },
    { label: 'TDS Pending Deposit', value: fmt(kpis.tds_pending_deposit), color: 'text-amber-400' },
  ] : [];

  const STAT_CARDS = kpis ? [
    { label: 'CoA Accounts',  value: kpis.coa_count },
    { label: 'Journal Entries', value: kpis.je_count },
    { label: 'Active Assets',   value: kpis.asset_count },
    { label: 'Employees',       value: kpis.employee_count },
    { label: 'Customers',       value: kpis.customer_count },
    { label: 'Vendors',         value: kpis.vendor_count },
  ] : [];

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* India Suite Banner */}
      <div className="bg-orange-900/20 border-b border-orange-800/30 px-6 py-3 flex items-center gap-3">
        <span className="text-lg">🇮🇳</span>
        <div>
          <span className="text-white font-medium text-sm">India Accounting Suite</span>
          <span className="text-orange-400 text-xs ml-3">GST · TDS · Payroll · Ind AS 16 · GSTR-1/3B</span>
        </div>
      </div>
      <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <IndianRupee size={24} className="text-orange-400" /> India Accounting Suite
          </h1>
          <p className="text-gray-400 text-sm mt-1">GST · TDS · Payroll · Ind AS 16 · GSTR-1/3B</p>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="month" value={period}
            onChange={e => setPeriod(e.target.value)}
            className="bg-gray-800 border border-gray-700 text-white px-3 py-2 rounded-lg text-sm"
          />
          <button onClick={load} className="p-2 bg-gray-700 hover:bg-gray-600 rounded-lg">
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {error && <div className="bg-red-900/40 border border-red-700 text-red-300 rounded-lg p-3 mb-4 text-sm">{error}</div>}

      {/* Compliance badge */}
      <div className="bg-orange-900/20 border border-orange-800/40 rounded-xl p-4 mb-6 flex flex-wrap gap-4">
        {[
          { label: 'GST Rate',    value: '5% / 12% / 18% / 28%' },
          { label: 'Corp Tax',    value: '25% (domestic companies)' },
          { label: 'PF Employee', value: '12% of basic' },
          { label: 'ESI',         value: '0.75% emp + 3.25% er' },
          { label: 'Gratuity',    value: '4.81% of basic' },
          { label: 'TDS 194J',    value: '10% professional fees' },
        ].map(b => (
          <div key={b.label} className="bg-gray-900/60 rounded-lg px-3 py-2">
            <p className="text-xs text-gray-500">{b.label}</p>
            <p className="text-sm font-bold text-orange-400">{b.value}</p>
          </div>
        ))}
      </div>

      {/* KPI Cards */}
      {loading ? (
        <div className="grid grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="bg-gray-800/60 border border-gray-700 rounded-xl p-4 animate-pulse">
              <div className="h-3 bg-gray-700 rounded mb-2" />
              <div className="h-5 bg-gray-700 rounded" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-4 mb-6">
          {KPI_CARDS.map(k => (
            <div key={k.label} className="bg-gray-800/60 border border-gray-700 rounded-xl p-4">
              <p className="text-xs text-gray-400">{k.label}</p>
              <p className={`text-sm font-bold mt-1 ${k.color}`}>{k.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Stat counts */}
      <div className="grid grid-cols-3 lg:grid-cols-6 gap-3 mb-8">
        {STAT_CARDS.map(s => (
          <div key={s.label} className="bg-gray-800/40 border border-gray-700/50 rounded-xl p-3 text-center">
            <p className="text-lg font-bold text-white">{s.value}</p>
            <p className="text-xs text-gray-500 mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Module grid */}
      <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Modules</h2>
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {MODULES.map(m => (
          <button
            key={m.label}
            onClick={() => navigate(m.path)}
            className={`${m.bg} border ${m.border} rounded-xl p-4 text-left hover:opacity-80 transition-opacity`}
          >
            <m.icon size={20} className={`${m.color} mb-3`} />
            <p className="text-sm font-medium text-white">{m.label}</p>
          </button>
        ))}
      </div>
      </div>{/* end p-6 */}
    </div>
  );
}
