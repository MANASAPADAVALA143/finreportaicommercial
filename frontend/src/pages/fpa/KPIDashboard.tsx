import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, RefreshCw, Download, FileText, Activity, AlertTriangle, Sun, TrendingDown, AlertCircle, Info, ArrowRight, TrendingUp } from 'lucide-react';
import KPICard from '../../components/fpa/kpi/KPICard';
import KPISpeedometer from '../../components/fpa/kpi/KPISpeedometer';
import AIInsights from '../../components/fpa/kpi/AIInsights';
import KPIAlerts from '../../components/fpa/kpi/KPIAlerts';
import { loadFPAActual, loadFPABudget, checkDataAvailability, getMissingDataMessage, calculateRealKPIs } from '../../utils/fpaDataLoader';
import { useCompany } from '../../context/CompanyContext';
import PeriodSelector from '../../components/PeriodSelector';
import { fetchGLSummary, glSummaryToKPIs, getCurrentPeriod } from '../../services/glSummary.service';
import { getDSOMetrics } from '../../services/arService';

// ── AI Morning Brief ──────────────────────────────────────────────────────────

function buildRealAlerts() {
  try {
    const actual  = JSON.parse(localStorage.getItem('fpa_actual')  || '{}');
    const budget  = JSON.parse(localStorage.getItem('fpa_budget')  || '{}');
    const cur = (localStorage.getItem('fpa_currency') || 'AED').toUpperCase();
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
  const displayItems = realAlerts ?? [];
  const critCount = displayItems.filter(i => i.level === 'CRITICAL').length;
  const warnCount = displayItems.filter(i => i.level === 'WARNING').length;
  const currency = (localStorage.getItem('fpa_currency') || 'AED').toUpperCase();

  return (
    <div className="max-w-[1800px] mx-auto mb-6">
      <div className="bg-gradient-to-r from-slate-900 via-blue-950 to-slate-900 rounded-xl shadow-lg p-6 text-white">
        <div className="flex items-start justify-between mb-5">
          <div className="flex items-center gap-3">
            <Sun className="w-8 h-8 text-yellow-400" />
            <div>
              <h2 className="text-xl font-bold">{greeting}. Here is your AI Morning Brief.</h2>
              <p className="text-slate-400 text-sm mt-0.5">{today} · {currency}</p>
            </div>
          </div>
          {displayItems.length > 0 && (
            <div className="flex gap-3 text-sm">
              <span className="bg-red-900/50 border border-red-700 text-red-300 px-3 py-1 rounded-full font-semibold">{critCount} Critical</span>
              <span className="bg-amber-900/50 border border-amber-700 text-amber-300 px-3 py-1 rounded-full font-semibold">{warnCount} Warning</span>
            </div>
          )}
        </div>

        {displayItems.length === 0 ? (
          <div className="text-center py-8 text-slate-400 text-sm">
            No alerts — post journal entries to generate insights
          </div>
        ) : (
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
        )}

        {/* Live metrics strip — only when real data exists */}
        {displayItems.length > 0 && (
          <div className="mt-4 pt-4 border-t border-white/10 flex flex-wrap gap-4 text-xs text-slate-400">
            {(() => {
              try {
                const a = JSON.parse(localStorage.getItem('fpa_actual') || '{}');
                const b = JSON.parse(localStorage.getItem('fpa_budget') || '{}');
                const cur = localStorage.getItem('fpa_currency') || 'AED';
                const rev = a.totalRevenue || 0;
                const exp = a.totalExpenses || 0;
                const budRev = b.totalRevenue || rev;
                const gm = rev > 0 ? ((rev - (a.costOfGoodsSold || exp * 0.35)) / rev * 100).toFixed(1) : '—';
                const ebitdaPct = rev > 0 ? ((rev - exp) / rev * 100).toFixed(1) : '—';
                const revVar = budRev > 0 ? ((rev - budRev) / budRev * 100).toFixed(1) : '—';
                return [
                  { label: 'Revenue vs Budget', value: `${revVar}%`, ok: Number(revVar) >= 0 },
                  { label: 'Gross Margin', value: `${gm}% YTD`, ok: Number(gm) > 0 },
                  { label: 'EBITDA Margin', value: `${ebitdaPct}%`, ok: Number(ebitdaPct) > 0 },
                  { label: 'Currency', value: cur, ok: true },
                ];
              } catch {
                return [];
              }
            })().map(b => (
              <div key={b.label} className="flex items-center gap-1.5">
                <span className={`w-1.5 h-1.5 rounded-full ${b.ok ? 'bg-green-400' : 'bg-amber-400'}`} />
                <span className="font-medium text-slate-300">{b.label}:</span>
                <span>{b.value}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const KPIDashboard: React.FC = () => {
  const navigate = useNavigate();
  const { activeCompanyId } = useCompany();
  const workspaceId = localStorage.getItem('gnanova_workspace_id');
  
  const dataCheck = checkDataAvailability(['fpa_actual', 'fpa_budget']);
  const [actualData, setActualData] = useState<any>(null);
  const [budgetData, setBudgetData] = useState<any>(null);
  const [realKPIs, setRealKPIs] = useState<any>(null);
  const [glSource, setGlSource] = useState(false);
  const [periodRange, setPeriodRange] = useState(getCurrentPeriod);
  const [dsoKpi, setDsoKpi] = useState<{ value: number; benchmark: number; label: string } | null>(null);

  const loadGlKpis = async (start: string, end: string) => {
    if (!activeCompanyId) return;
    try {
      const [summary, dso] = await Promise.all([
        fetchGLSummary(activeCompanyId, workspaceId, start, end),
        getDSOMetrics(activeCompanyId, start, end).catch(() => null),
      ]);
      if (summary.has_data) {
        setRealKPIs(glSummaryToKPIs(summary));
        setGlSource(true);
      }
      if (dso) {
        setDsoKpi({
          value: dso.dso_current,
          benchmark: dso.industry_benchmark,
          label: dso.dso_vs_benchmark_label,
        });
      }
    } catch { /* ignore */ }
  };

  useEffect(() => {
    if (dataCheck.available) {
      const actual = loadFPAActual();
      const budget = loadFPABudget();
      setActualData(actual);
      setBudgetData(budget);
      if (actual && budget) {
        setRealKPIs(calculateRealKPIs(actual, budget));
        setGlSource(false);
      }
    } else {
      void loadGlKpis(periodRange.start, periodRange.end);
    }
  }, [dataCheck.available, activeCompanyId, periodRange]);
  
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

      {glSource && (
        <div className="max-w-[1800px] mx-auto mb-4 px-2">
          <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-2 text-sm text-green-800 flex items-center justify-between">
            <span>Source: UAE GL — live journal entry actuals</span>
            <PeriodSelector workspaceId={workspaceId} onPeriodChange={(s, e) => setPeriodRange({ start: s, end: e })} />
          </div>
        </div>
      )}

      {/* Data Missing Warning Banner */}
      {!dataCheck.available && !glSource && (
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
                <span><span className="font-semibold text-gray-900">Currency:</span> {(localStorage.getItem('fpa_currency') || 'AED').toUpperCase()}</span>
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
              <div key={kpi.id}>
                <KPICard kpi={kpi} delay={idx * 0.1} />
                {kpi.source === 'UAE GL' && <p className="text-xs text-green-700 mt-1 text-center">Source: UAE GL</p>}
              </div>
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
          {dsoKpi && (
            <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
              <p className="text-sm text-gray-500 mb-1">DSO (Days Sales Outstanding)</p>
              <p className={`text-3xl font-bold ${dsoKpi.value > dsoKpi.benchmark ? 'text-red-600' : 'text-green-600'}`}>
                {dsoKpi.value} days
              </p>
              <p className="text-xs text-gray-500 mt-2">UAE benchmark: {dsoKpi.benchmark} days · {dsoKpi.label}</p>
              <p className="text-xs text-green-700 mt-1">Source: UAE AR live</p>
            </div>
          )}
          {realKPIs && realKPIs.efficiencyKPIs ? (
            realKPIs.efficiencyKPIs.map((kpi: any, idx: number) => (
              <KPICard key={kpi.id} kpi={kpi} delay={idx * 0.1} />
            ))
          ) : !dsoKpi ? (
            <div className="col-span-4 text-center py-8 bg-white rounded-xl border border-gray-200">
              <p className="text-gray-500">Upload data or select a company to see efficiency KPIs</p>
            </div>
          ) : null}
        </div>
      </div>

      {/* Speedometer Gauges Section */}
      <div className="max-w-[1800px] mx-auto mb-6">
        <h2 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
          <div className="w-1 h-6 bg-indigo-600 rounded-full"></div>
          Margin Performance Gauges
        </h2>
        {realKPIs?.profitabilityKPIs ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <KPISpeedometer
              title="Gross Margin"
              value={realKPIs.profitabilityKPIs.find((k: { id: string }) => k.id === 'gross-margin')?.value ?? 0}
              target={realKPIs.profitabilityKPIs.find((k: { id: string }) => k.id === 'gross-margin')?.target ?? 0}
              unit="%"
            />
            <KPISpeedometer
              title="EBITDA Margin"
              value={
                actualData?.totalRevenue > 0
                  ? ((actualData.totalRevenue - (actualData.totalExpenses || 0)) / actualData.totalRevenue) * 100
                  : 0
              }
              target={
                budgetData?.totalRevenue > 0
                  ? ((budgetData.totalRevenue - (budgetData.totalExpenses || 0)) / budgetData.totalRevenue) * 100
                  : 0
              }
              unit="%"
            />
            <KPISpeedometer
              title="Net Profit Margin"
              value={realKPIs.profitabilityKPIs.find((k: { id: string }) => k.id === 'net-margin')?.value ?? 0}
              target={realKPIs.profitabilityKPIs.find((k: { id: string }) => k.id === 'net-margin')?.target ?? 0}
              unit="%"
            />
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '40px', border: '1px dashed #CBD5E1', borderRadius: '8px' }}>
            <p style={{ color: '#64748B' }}>Connect your accounting data to see live KPIs</p>
          </div>
        )}
      </div>

      {/* Trend Charts Section */}
      {realKPIs && (
        <div className="max-w-[1800px] mx-auto mb-6">
          <h2 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
            <div className="w-1 h-6 bg-cyan-600 rounded-full"></div>
            12-Month Performance Trends
          </h2>
          <div className="text-center py-12 bg-white rounded-xl border border-dashed border-gray-300">
            <p className="text-gray-500">Upload monthly actuals to see performance trends</p>
          </div>
        </div>
      )}

      {/* Heatmap Section */}
      {realKPIs && (
        <div className="max-w-[1800px] mx-auto mb-6">
          <div className="text-center py-12 bg-white rounded-xl border border-dashed border-gray-300">
            <p className="text-gray-500">Upload data across periods to see KPI heatmap</p>
          </div>
        </div>
      )}

      {/* AI Insights & Alerts Section */}
      <div className="max-w-[1800px] mx-auto mb-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <AIInsights kpis={realKPIs?.allKPIs || []} />
          {realKPIs ? (
            <KPIAlerts alerts={[]} />
          ) : (
            <div className="bg-white rounded-xl border border-dashed border-gray-300 p-8 text-center">
              <p className="text-gray-500">No alerts — connect accounting data to generate KPI alerts</p>
            </div>
          )}
        </div>
      </div>

      {/* Summary Footer */}
      <div className="max-w-[1800px] mx-auto">
        <div className="bg-gradient-to-r from-blue-600 to-purple-600 rounded-xl shadow-lg p-6 text-white">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-bold mb-2">Dashboard Summary</h3>
              <p className="text-blue-100 text-sm">
                Monitoring {realKPIs?.allKPIs?.length || 0} key performance indicators
                {realKPIs ? '' : ' — upload actual and budget data to begin'}
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
