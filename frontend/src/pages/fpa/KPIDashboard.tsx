import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, RefreshCw, Download, FileText, Activity, AlertTriangle, Sun, TrendingDown, AlertCircle, Info, ArrowRight, TrendingUp } from 'lucide-react';
import KPICard from '../../components/fpa/kpi/KPICard';
import KPISpeedometer from '../../components/fpa/kpi/KPISpeedometer';
import MonthlyTrendChart from '../../components/fpa/kpi/MonthlyTrendChart';
import KPIHeatmap from '../../components/fpa/kpi/KPIHeatmap';
import AIInsights from '../../components/fpa/kpi/AIInsights';
import KPIAlerts from '../../components/fpa/kpi/KPIAlerts';
import {
  kpiAlerts,
  monthlyTrendData,
  heatmapData
} from '../../data/kpiMockData';
import { loadFPAActual, loadFPABudget, checkDataAvailability, getMissingDataMessage, calculateRealKPIs } from '../../utils/fpaDataLoader';

// ── AI Morning Brief ──────────────────────────────────────────────────────────

const MORNING_BRIEF_ITEMS = [
  {
    level: 'CRITICAL' as const,
    icon: TrendingDown,
    color: 'text-red-600',
    bg: 'bg-red-50',
    border: 'border-red-200',
    badge: 'bg-red-100 text-red-700',
    title: 'Software Revenue AED 250K below Oct budget',
    body: 'Root cause: ADNOC Digital contract delayed to November. Probability of closing Nov: 80%.',
    action: 'Update Nov forecast upward. Chase ADNOC Digital for signed PO.',
    owner: 'Sarah Johnson (Sales) · Due 15 Nov',
  },
  {
    level: 'WARNING' as const,
    icon: AlertCircle,
    color: 'text-amber-600',
    bg: 'bg-amber-50',
    border: 'border-amber-200',
    badge: 'bg-amber-100 text-amber-700',
    title: 'Cash drops below AED 4M projected in Week 4 Nov',
    body: 'WPS salary run + Q4 VAT payment land same week. Current Week 4 Nov forecast: AED 3.8M.',
    action: 'Chase Emirates NBD invoice AED 780K (62 days outstanding). Draw credit line if needed.',
    owner: 'CFO · Due 10 Nov',
  },
  {
    level: 'INFO' as const,
    icon: Info,
    color: 'text-blue-600',
    bg: 'bg-blue-50',
    border: 'border-blue-200',
    badge: 'bg-blue-100 text-blue-700',
    title: 'EBITDA margin recovered to 14.6% — best since June 2025',
    body: 'Driven by Sales & Marketing underspend (AED 40K favorable) and Support & Maintenance revenue outperformance.',
    action: 'No action required. Note in board pack as positive trend.',
    owner: 'CFO · Board pack due 25 Nov',
  },
];

function buildRealAlerts() {
  try {
    const actual  = JSON.parse(localStorage.getItem('fpa_actual')  || '{}');
    const budget  = JSON.parse(localStorage.getItem('fpa_budget')  || '{}');
    const cur = (localStorage.getItem('fpa_currency') || 'AED').toUpperCase();
    const sym = cur === 'INR' ? '₹' : 'AED ';
    const fmt = (n: number) => cur === 'INR'
      ? `₹${(n/10000000).toFixed(1)} Cr`
      : `AED ${(n/1000000).toFixed(1)}M`;

    if (!actual.totalRevenue) return null; // no real data

    const rev     = actual.totalRevenue    || 0;
    const exp     = actual.totalExpenses   || 0;
    const budRev  = budget.totalRevenue    || rev;
    const budExp  = budget.totalExpenses   || exp;
    const cash    = actual.cashAndEquivalents || actual.opening_cash || 0;
    const monthlyBurn = exp > 0 ? exp / 10 : 1; // YTD 10 months
    const runway  = cash > 0 && monthlyBurn > 0 ? (cash / monthlyBurn) : 0;

    const revVarPct = budRev > 0 ? ((rev - budRev) / budRev * 100) : 0;
    const expVarPct = budExp > 0 ? ((exp - budExp) / budExp * 100) : 0;
    const ebitdaMargin = rev > 0 ? ((rev - exp) / rev * 100) : 0;

    const alerts = [];

    if (revVarPct < -10) {
      alerts.push({
        level: 'CRITICAL' as const, icon: TrendingDown, color: 'text-red-600', bg: 'bg-red-50', border: 'border-red-200', badge: 'bg-red-100 text-red-700',
        title: `Revenue ${fmt(Math.abs(rev - budRev))} below YTD budget (${revVarPct.toFixed(1)}%)`,
        body: `Actual revenue ${fmt(rev)} vs budget ${fmt(budRev)}. Review sales pipeline for delayed contracts.`,
        action: 'Update forecast, chase delayed contracts, notify CFO.',
        owner: 'Sales Director · Immediate',
      });
    } else if (revVarPct < -5) {
      alerts.push({
        level: 'WARNING' as const, icon: AlertCircle, color: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-200', badge: 'bg-amber-100 text-amber-700',
        title: `Revenue ${fmt(Math.abs(rev - budRev))} below YTD budget (${revVarPct.toFixed(1)}%)`,
        body: `Monitor closely. Actual ${fmt(rev)} vs budget ${fmt(budRev)}.`,
        action: 'Review pipeline and update rolling forecast.',
        owner: 'CFO · This week',
      });
    }

    if (expVarPct > 5) {
      alerts.push({
        level: expVarPct > 10 ? 'CRITICAL' as const : 'WARNING' as const,
        icon: expVarPct > 10 ? TrendingDown : AlertCircle,
        color: expVarPct > 10 ? 'text-red-600' : 'text-amber-600',
        bg: expVarPct > 10 ? 'bg-red-50' : 'bg-amber-50',
        border: expVarPct > 10 ? 'border-red-200' : 'border-amber-200',
        badge: expVarPct > 10 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700',
        title: `Costs ${expVarPct.toFixed(1)}% over YTD budget — ${fmt(exp - budExp)} overrun`,
        body: `Actual expenses ${fmt(exp)} vs budget ${fmt(budExp)}. Review discretionary spend.`,
        action: 'Freeze non-essential spend. CFO review required for any purchase > budget.',
        owner: 'COO · This week',
      });
    }

    if (runway > 0 && runway < 4) {
      alerts.push({
        level: runway < 2 ? 'CRITICAL' as const : 'WARNING' as const,
        icon: runway < 2 ? TrendingDown : AlertCircle,
        color: runway < 2 ? 'text-red-600' : 'text-amber-600',
        bg: runway < 2 ? 'bg-red-50' : 'bg-amber-50',
        border: runway < 2 ? 'border-red-200' : 'border-amber-200',
        badge: runway < 2 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700',
        title: `Cash runway ${runway.toFixed(1)} months at current burn rate`,
        body: `Opening cash ${fmt(cash)}. Monthly burn rate ${fmt(monthlyBurn)}. Minimum safe cash = 2 months.`,
        action: runway < 2 ? 'Draw credit line immediately.' : 'Chase outstanding receivables. Review payment terms.',
        owner: 'CFO · Urgent',
      });
    }

    if (ebitdaMargin > 0) {
      alerts.push({
        level: 'INFO' as const, icon: Info, color: 'text-blue-600', bg: 'bg-blue-50', border: 'border-blue-200', badge: 'bg-blue-100 text-blue-700',
        title: `EBITDA margin ${ebitdaMargin.toFixed(1)}% — Net profit ${fmt(rev - exp)}`,
        body: `Revenue ${fmt(rev)}, Expenses ${fmt(exp)}. ${ebitdaMargin > 15 ? 'Strong margin performance.' : 'Margin below 15% target.'}`,
        action: ebitdaMargin < 10 ? 'Pricing review required. Consider cost optimisation plan.' : 'Maintain current trajectory.',
        owner: 'CFO · Board pack',
      });
    }

    return alerts.length > 0 ? alerts : null;
  } catch (_e) { return null; }
}

function MorningBrief() {
  const today = new Date().toLocaleDateString('en-AE', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const realAlerts = buildRealAlerts();
  const displayItems = realAlerts || MORNING_BRIEF_ITEMS;
  const critCount = displayItems.filter(i => i.level === 'CRITICAL').length;
  const warnCount = displayItems.filter(i => i.level === 'WARNING').length;
  const hasRealData = realAlerts !== null;

  return (
    <div className="max-w-[1800px] mx-auto mb-6">
      <div className="bg-gradient-to-r from-slate-900 via-blue-950 to-slate-900 rounded-xl shadow-lg p-6 text-white">
        <div className="flex items-start justify-between mb-5">
          <div className="flex items-center gap-3">
            <Sun className="w-8 h-8 text-yellow-400" />
            <div>
              <h2 className="text-xl font-bold">{greeting}. Here is your AI Morning Brief.</h2>
              <p className="text-slate-400 text-sm mt-0.5">{today} · Al Futtaim Digital Services LLC · AED</p>
            </div>
          </div>
          <div className="flex gap-3 text-sm">
            <span className="bg-red-900/50 border border-red-700 text-red-300 px-3 py-1 rounded-full font-semibold">{critCount} Critical</span>
            <span className="bg-amber-900/50 border border-amber-700 text-amber-300 px-3 py-1 rounded-full font-semibold">{warnCount} Warning</span>
          </div>
        </div>

        {!hasRealData && (
          <div className="mb-3 px-3 py-2 bg-amber-900/30 border border-amber-700/40 rounded-lg text-xs text-amber-300">
            ⚠️ Showing sample alerts — upload master data from FP&A Suite homepage to see real alerts
          </div>
        )}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {displayItems.map((item, i) => {
            const Icon = item.icon;
            return (
              <div key={i} className="bg-white/5 border border-white/10 rounded-xl p-4 hover:bg-white/10 transition-colors">
                <div className="flex items-center gap-2 mb-2">
                  <Icon className={`w-4 h-4 ${item.color.replace('text-', 'text-')}`} />
                  <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${item.badge}`}>{item.level}</span>
                </div>
                <p className="font-semibold text-white text-sm mb-1">{i + 1}. {item.title}</p>
                <p className="text-slate-400 text-xs leading-relaxed mb-2">{item.body}</p>
                <div className="flex items-start gap-1.5 mt-2 pt-2 border-t border-white/10">
                  <ArrowRight className="w-3.5 h-3.5 text-blue-400 mt-0.5 shrink-0" />
                  <p className="text-xs text-blue-300">{item.action}</p>
                </div>
                <p className="text-[11px] text-slate-500 mt-1">{item.owner}</p>
              </div>
            );
          })}
        </div>

        {/* UAE Compliance strip */}
        <div className="mt-4 pt-4 border-t border-white/10 flex flex-wrap gap-4 text-xs text-slate-400">
          {(() => {
            try {
              const a = JSON.parse(localStorage.getItem('fpa_actual') || '{}');
              const b = JSON.parse(localStorage.getItem('fpa_budget') || '{}');
              const cur = localStorage.getItem('fpa_currency') || 'AED';
              const rev = a.totalRevenue || 0; const exp = a.totalExpenses || 0;
              const budRev = b.totalRevenue || rev;
              const gm = rev > 0 ? ((rev - (exp * 0.35)) / rev * 100).toFixed(1) : '—';
              const ebitdaPct = rev > 0 ? ((rev - exp) / rev * 100).toFixed(1) : '—';
              const revVar = budRev > 0 ? ((rev - budRev) / budRev * 100).toFixed(1) : '—';
              return [
                { label: 'Revenue vs Budget', value: `${revVar}%`, ok: Number(revVar) >= 0 },
                { label: 'Gross Margin', value: `${gm}% YTD`, ok: Number(gm) > 50 },
                { label: 'EBITDA Margin', value: `${ebitdaPct}%`, ok: Number(ebitdaPct) > 10 },
                { label: 'Currency', value: cur, ok: true },
                { label: 'Data Status', value: rev > 0 ? '✅ Live data' : '⚠️ Sample data', ok: rev > 0 },
              ];
            } catch { return [
              { label: 'VAT Filing', value: '31 Jan 2026', ok: true },
              { label: 'Q4 VAT Payable', value: 'AED 385K est.', ok: true },
              { label: 'Gross Margin', value: '73.9%', ok: false },
            ]; }
          })().map(b => (
            <div key={b.label} className="flex items-center gap-1.5">
              <span className={`w-1.5 h-1.5 rounded-full ${b.ok ? 'bg-green-400' : 'bg-amber-400'}`} />
              <span className="font-medium text-slate-300">{b.label}:</span>
              <span>{b.value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const KPIDashboard: React.FC = () => {
  const navigate = useNavigate();
  
  // Check data availability
  const dataCheck = checkDataAvailability(['fpa_actual', 'fpa_budget']);
  const [actualData, setActualData] = useState<any>(null);
  const [budgetData, setBudgetData] = useState<any>(null);
  const [realKPIs, setRealKPIs] = useState<any>(null);

  useEffect(() => {
    if (dataCheck.available) {
      const actual = loadFPAActual();
      const budget = loadFPABudget();
      setActualData(actual);
      setBudgetData(budget);
      
      // Calculate real KPIs from uploaded data
      if (actual && budget) {
        const calculated = calculateRealKPIs(actual, budget);
        setRealKPIs(calculated);
      }
    }
  }, [dataCheck.available]);
  
  const [period, setPeriod] = useState('Oct 2025');
  const [view, setView] = useState('Monthly');
  const [lastUpdated] = useState(new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }));
  const [showExportMenu, setShowExportMenu] = useState(false);

  const handleRefresh = () => {
    window.location.reload();
  };

  const handleExportPDF = () => {
    alert('📄 Exporting KPI Dashboard to PDF... (Coming soon)');
    setShowExportMenu(false);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-slate-50 p-6">
      {/* AI Morning Brief */}
      <MorningBrief />

      {/* Data Missing Warning Banner */}
      {!dataCheck.available && (
        <div className="bg-yellow-50 border-b-2 border-yellow-400 px-6 py-4 rounded-lg mb-6">
          <div className="max-w-[1800px] mx-auto flex items-center gap-3">
            <AlertTriangle className="w-6 h-6 text-yellow-600 flex-shrink-0" />
            <div className="flex-1">
              <p className="font-semibold text-yellow-900">
                ⚠️ {getMissingDataMessage(dataCheck.missing)}
              </p>
              <p className="text-sm text-yellow-700 mt-1">
                KPI Dashboard requires both Actual and Budget data.
              </p>
            </div>
            <button
              onClick={() => navigate('/fpa')}
              className="px-4 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 transition-colors font-medium"
            >
              Upload Data
            </button>
          </div>
        </div>
      )}
      
      {/* Header */}
      <div className="max-w-[1800px] mx-auto mb-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-4">
              <button
                onClick={() => navigate('/fpa')}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <ArrowLeft size={24} className="text-gray-700" />
              </button>
              <div>
                <div className="flex items-center gap-3">
                  <Activity size={32} className="text-blue-600" />
                  <div>
                    <h1 className="text-3xl font-bold text-gray-900">CFO KPI Dashboard</h1>
                    <p className="text-gray-600 mt-1">Financial Performance at a Glance</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="text-right mr-4">
                <div className="text-sm text-gray-600">Last updated</div>
                <div className="text-lg font-semibold text-gray-900">{lastUpdated}</div>
              </div>
              <button
                onClick={handleRefresh}
                className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
              >
                <RefreshCw size={18} />
                Refresh
              </button>
              <div className="relative">
                <button
                  onClick={() => setShowExportMenu(!showExportMenu)}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  <Download size={18} />
                  Export
                </button>
                {showExportMenu && (
                  <div className="absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-lg border border-gray-200 z-10">
                    <button
                      onClick={handleExportPDF}
                      className="w-full px-4 py-2 text-left hover:bg-gray-50 flex items-center gap-2 text-gray-700 rounded-lg"
                    >
                      <FileText size={16} className="text-red-600" />
                      PDF Report
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Controls */}
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-gray-700">Period:</span>
              <select
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                className="px-3 py-1.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-gray-700"
              >
                <option>Oct 2025</option>
                <option>Sep 2025</option>
                <option>Aug 2025</option>
                <option>Q3 2025</option>
                <option>YTD 2025</option>
              </select>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-gray-700">View:</span>
              <select
                value={view}
                onChange={(e) => setView(e.target.value)}
                className="px-3 py-1.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-gray-700"
              >
                <option>Monthly</option>
                <option>Quarterly</option>
                <option>YTD</option>
                <option>Annual</option>
              </select>
            </div>

            <div className="border-l border-gray-300 pl-6 ml-auto">
              <div className="flex items-center gap-4 text-sm text-gray-600">
                <span><span className="font-semibold text-gray-900">Company:</span> Al Futtaim Digital Services LLC</span>
                <span><span className="font-semibold text-gray-900">Currency:</span> AED</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Revenue KPIs Section */}
      <div className="max-w-[1800px] mx-auto mb-6">
        <h2 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
          <div className="w-1 h-6 bg-blue-600 rounded-full"></div>
          Revenue Metrics
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {realKPIs && realKPIs.revenueKPIs ? (
            realKPIs.revenueKPIs.map((kpi: any, idx: number) => (
              <KPICard key={kpi.id} kpi={kpi} delay={idx * 0.1} />
            ))
          ) : (
            <div className="col-span-4 text-center py-8 bg-white rounded-xl border border-gray-200">
              <p className="text-gray-500">Upload data to see revenue KPIs</p>
            </div>
          )}
        </div>
      </div>

      {/* Profitability KPIs Section */}
      <div className="max-w-[1800px] mx-auto mb-6">
        <h2 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
          <div className="w-1 h-6 bg-green-600 rounded-full"></div>
          Profitability Metrics
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {realKPIs && realKPIs.profitabilityKPIs ? (
            realKPIs.profitabilityKPIs.map((kpi: any, idx: number) => (
              <KPICard key={kpi.id} kpi={kpi} delay={idx * 0.1} />
            ))
          ) : (
            <div className="col-span-4 text-center py-8 bg-white rounded-xl border border-gray-200">
              <p className="text-gray-500">Upload data to see profitability KPIs</p>
            </div>
          )}
        </div>
      </div>

      {/* Liquidity KPIs Section */}
      <div className="max-w-[1800px] mx-auto mb-6">
        <h2 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
          <div className="w-1 h-6 bg-purple-600 rounded-full"></div>
          Liquidity & Cash Metrics
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {realKPIs && realKPIs.liquidityKPIs ? (
            realKPIs.liquidityKPIs.map((kpi: any, idx: number) => (
              <KPICard key={kpi.id} kpi={kpi} delay={idx * 0.1} />
            ))
          ) : (
            <div className="col-span-4 text-center py-8 bg-white rounded-xl border border-gray-200">
              <p className="text-gray-500">Upload data to see liquidity KPIs</p>
            </div>
          )}
        </div>
      </div>

      {/* Efficiency KPIs Section */}
      <div className="max-w-[1800px] mx-auto mb-6">
        <h2 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
          <div className="w-1 h-6 bg-amber-600 rounded-full"></div>
          Working Capital Efficiency
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {realKPIs && realKPIs.efficiencyKPIs ? (
            realKPIs.efficiencyKPIs.map((kpi: any, idx: number) => (
              <KPICard key={kpi.id} kpi={kpi} delay={idx * 0.1} />
            ))
          ) : (
            <div className="col-span-4 text-center py-8 bg-white rounded-xl border border-gray-200">
              <p className="text-gray-500">Upload data to see efficiency KPIs</p>
            </div>
          )}
        </div>
      </div>

      {/* Speedometer Gauges Section */}
      <div className="max-w-[1800px] mx-auto mb-6">
        <h2 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
          <div className="w-1 h-6 bg-indigo-600 rounded-full"></div>
          Margin Performance Gauges
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <KPISpeedometer
            title="Gross Margin"
            value={43.9}
            target={51.4}
            unit="%"
          />
          <KPISpeedometer
            title="EBITDA Margin"
            value={26.2}
            target={25.7}
            unit="%"
          />
          <KPISpeedometer
            title="Net Profit Margin"
            value={15.5}
            target={23.1}
            unit="%"
          />
        </div>
      </div>

      {/* Trend Charts Section */}
      <div className="max-w-[1800px] mx-auto mb-6">
        <h2 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
          <div className="w-1 h-6 bg-cyan-600 rounded-full"></div>
          12-Month Performance Trends
        </h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <MonthlyTrendChart data={monthlyTrendData} type="revenue" />
          <MonthlyTrendChart data={monthlyTrendData} type="margins" />
        </div>
      </div>

      {/* Heatmap Section */}
      <div className="max-w-[1800px] mx-auto mb-6">
        <KPIHeatmap data={heatmapData} />
      </div>

      {/* AI Insights & Alerts Section */}
      <div className="max-w-[1800px] mx-auto mb-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <AIInsights kpis={realKPIs?.allKPIs || []} />
          <KPIAlerts alerts={kpiAlerts} />
        </div>
      </div>

      {/* Summary Footer */}
      <div className="max-w-[1800px] mx-auto">
        <div className="bg-gradient-to-r from-blue-600 to-purple-600 rounded-xl shadow-lg p-6 text-white">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-bold mb-2">Dashboard Summary</h3>
              <p className="text-blue-100 text-sm">
                Monitoring {realKPIs?.allKPIs?.length || 0} key performance indicators • 
                {kpiAlerts.filter(a => a.severity === 'critical').length} critical alerts • 
                {kpiAlerts.filter(a => a.severity === 'warning').length} warnings
              </p>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-right">
                <div className="text-2xl font-bold">{(realKPIs?.allKPIs || []).filter((k: any) => k.status === 'excellent' || k.status === 'good').length}</div>
                <div className="text-sm text-blue-100">On Target</div>
              </div>
              <div className="text-right">
                <div className="text-2xl font-bold">{(realKPIs?.allKPIs || []).filter((k: any) => k.status === 'warning').length}</div>
                <div className="text-sm text-blue-100">Warning</div>
              </div>
              <div className="text-right">
                <div className="text-2xl font-bold">{(realKPIs?.allKPIs || []).filter((k: any) => k.status === 'critical').length}</div>
                <div className="text-sm text-blue-100">Critical</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default KPIDashboard;
