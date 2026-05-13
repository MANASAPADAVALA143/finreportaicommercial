// FP&A Suite - Landing Page with Sub-Module Cards
import { useNavigate, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useState } from 'react';
import {
  BarChart3,
  TrendingUp,
  Target,
  Layers,
  Activity,
  FileText,
  ArrowLeft,
  CheckCircle,
  Clock,
  Upload,
  Download,
  Brain,
  Grid3x3,
} from 'lucide-react';
import { MultiUploadModal } from '../../components/fpa/MultiUploadModal';
import { backendOrigin } from '../../utils/backendOrigin';

export const FPASuite = () => {
  const navigate = useNavigate();
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [exportingWorkbook, setExportingWorkbook] = useState(false);
  const fmt = (v: number | null | undefined) => (v == null || Number.isNaN(Number(v))) ? "—" : `₹${(Number(v)/100000).toFixed(2)}L`;

  const parseStored = (key: string) => {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  };

  const buildExportPayload = () => {
    const actual = parseStored('fpa_actual') || parseStored('fpa_actual_tb') || {};
    const budget = parseStored('fpa_budget') || parseStored('fpa_budget_tb') || {};
    const forecast = parseStored('fpa_forecast') || parseStored('fpa_forecast_data') || {};
    const scenarios = parseStored('fpa_scenarios') || {};

    const revenue = Number(actual.totalRevenue || 0);
    const cogs = Number(actual.costOfGoodsSold || 0);
    const opex = Number(actual.totalOperatingExpenses || 0);
    const cash = Number(actual.cashAndEquivalents || 0);
    const budgetRevenue = Number(budget.totalRevenue || 0);
    const budgetOpex = Number(budget.totalOperatingExpenses || 0);

    const seasonal = [0.85,0.88,1.05,0.92,0.98,1.02,0.96,1.08,1.12,1.18,1.22,1.15];
    const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const baseMonthlyRevenue = revenue > 0 ? revenue / 12 : 0;
    const baseMonthlyCost = (cogs + opex) > 0 ? (cogs + opex) / 12 : 0;
    const monthlyActuals = monthNames.map((month, idx) => {
      const revFactor = seasonal[idx];
      const costFactor = seasonal[seasonal.length - 1 - idx];
      return {
        month,
        revenue: Math.round(baseMonthlyRevenue * revFactor),
        costs: Math.round(baseMonthlyCost * costFactor),
      };
    });

    const segmentVariancePct = [
      { account: 'Product Sales', variancePct: 74.2 },
      { account: 'Services', variancePct: 34.1 },
      { account: 'SaaS', variancePct: 58.7 },
      { account: 'Consulting', variancePct: 28.9 },
      { account: 'Other', variancePct: 18.3 },
    ];
    const segmentBudgetBase = (budgetRevenue || revenue) > 0 ? (budgetRevenue || revenue) / segmentVariancePct.length : 0;
    const segmentRows = segmentVariancePct.map((s) => {
      const segBudget = Math.round(segmentBudgetBase);
      const segActual = Math.round(segBudget * (1 + s.variancePct / 100));
      return { account: s.account, budget: segBudget, actual: segActual };
    });

    return {
      company: 'FPA Suite',
      period: 'Current Period',
      currency: 'USD',
      variance: {
        rows: [
          ...segmentRows,
          { account: 'Operating Expenses', budget: budgetOpex || opex, actual: opex },
        ],
      },
      budget: {
        departments: [
          { name: 'Operations', budget: budgetOpex || opex, spent: opex },
          { name: 'Sales', budget: Math.round((budgetRevenue || revenue) * 0.25), spent: Math.round(revenue * 0.22) },
        ],
      },
      kpi: {
        actuals: { revenue, cogs, opex, cash },
      },
      forecast: {
        monthly_actuals: Array.isArray(forecast.months) && forecast.months.length >= 2
          ? forecast.months.slice(0, 6).map((m: string, i: number) => ({
              month: m,
              revenue: Number(forecast.domesticRevenue?.[i] || 0) + Number(forecast.exportRevenue?.[i] || 0) + Number(forecast.serviceRevenue?.[i] || 0),
              costs: Math.round((cogs + opex) / 12),
            }))
          : monthlyActuals,
      },
      scenarios: {
        base: { revenue, cogs, opex },
        adjustments: {
          optimistic_rev_pct: 8,
          pessimistic_rev_pct: -8,
          scenarios_count: Array.isArray(scenarios.scenarios) ? scenarios.scenarios.length : 0,
        },
      },
      reports: {
        variance_summary: `Revenue ${fmt(revenue)} vs budget ${fmt((budgetRevenue || revenue))}.`,
        kpi_summary: `Cash ${fmt(cash)} and opex ${fmt(opex)}.`,
        forecast_summary: 'Generated from FP&A suite upload data.',
        cash_position: cash > 0 ? 'Positive' : 'Constrained',
      },
    };
  };

  const handleExportExcelAddinWorkbook = async () => {
    if (exportingWorkbook) return;
    const base = backendOrigin();
    if (!base) {
      alert('Backend API URL not configured. Set VITE_API_URL and restart frontend.');
      return;
    }

    setExportingWorkbook(true);
    try {
      const payload = buildExportPayload();
      const response = await fetch(`${base}/api/excel-addin/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        throw new Error(`Export failed: ${response.status}`);
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'finreportai_output.xlsx';
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Export failed.');
    } finally {
      setExportingWorkbook(false);
    }
  };

  const modules = [
    {
      id: 'variance',
      title: 'Variance Analysis',
      description: 'Budget vs Actual — AI-powered variance intelligence',
      icon: BarChart3,
      route: '/dashboard/fpa/variance-analysis',
      available: true,
      color: 'from-blue-500 to-blue-600',
      bgColor: 'bg-blue-50',
      iconColor: 'text-blue-600',
      badge: 'NEW'
    },
    {
      id: 'budget',
      title: 'Budget Management',
      description: 'Create, manage, and track annual budgets across departments',
      icon: Target,
      route: '/fpa/budget',
      available: true,
      color: 'from-green-500 to-green-600',
      bgColor: 'bg-green-50',
      iconColor: 'text-green-600'
    },
    {
      id: 'forecast',
      title: 'Forecasting',
      description: 'Rolling forecasts and predictive analytics powered by AI',
      icon: TrendingUp,
      route: '/fpa/forecast',
      available: true,
      color: 'from-purple-500 to-purple-600',
      bgColor: 'bg-purple-50',
      iconColor: 'text-purple-600'
    },
    {
      id: 'scenarios',
      title: 'Scenario Planning',
      description: 'What-if analysis and sensitivity modeling for strategic decisions',
      icon: Layers,
      route: '/fpa/scenarios',
      available: true,
      color: 'from-orange-500 to-orange-600',
      bgColor: 'bg-orange-50',
      iconColor: 'text-orange-600'
    },
    {
      id: 'kpi',
      title: 'KPI Dashboard',
      description: 'Real-time KPI tracking with automated alerts and insights',
      icon: Activity,
      route: '/fpa/kpi',
      available: true,
      color: 'from-cyan-500 to-cyan-600',
      bgColor: 'bg-cyan-50',
      iconColor: 'text-cyan-600'
    },
    {
      id: 'reports',
      title: 'Management Reports',
      description: 'Automated board packs and executive reports generation',
      icon: FileText,
      route: '/fpa/reports',
      available: true,
      color: 'from-indigo-500 to-indigo-600',
      bgColor: 'bg-indigo-50',
      iconColor: 'text-indigo-600'
    },
    {
      id: 'decision',
      title: 'CFO Decision Intelligence',
      description: 'Investment ROI, Build vs Buy, Outsource vs Internal, Capital Allocation & Risk',
      icon: Brain,
      route: '/cfo-decision',
      available: true,
      color: 'from-amber-500 to-orange-600',
      bgColor: 'bg-amber-50',
      iconColor: 'text-amber-600',
      badge: 'NEW ⭐'
    },
    {
      id: 'pvm',
      title: 'PVM Analysis',
      description: 'Price · Volume · Mix bridge with AI commentary',
      icon: BarChart3,
      route: '/fpa/pvm',
      available: true,
      color: 'from-sky-500 to-cyan-600',
      bgColor: 'bg-sky-50',
      iconColor: 'text-sky-700',
      badge: 'NEW',
    },
    {
      id: 'three-statement',
      title: '3-Statement Model',
      description: 'P&L, balance sheet, and cash flow projections',
      icon: Layers,
      route: '/fpa/three-statement',
      available: true,
      color: 'from-indigo-500 to-violet-600',
      bgColor: 'bg-indigo-50',
      iconColor: 'text-indigo-700',
      badge: 'NEW',
    },
    {
      id: 'monte-carlo',
      title: 'Monte Carlo',
      description: 'Cash path simulation with percentile bands',
      icon: Activity,
      route: '/fpa/monte-carlo',
      available: true,
      color: 'from-rose-500 to-orange-600',
      bgColor: 'bg-rose-50',
      iconColor: 'text-rose-700',
      badge: 'NEW',
    },
    {
      id: 'arr',
      title: 'ARR Dashboard',
      description: 'SaaS metrics: NRR, Rule of 40, CAC payback',
      icon: TrendingUp,
      route: '/fpa/arr-dashboard',
      available: true,
      color: 'from-emerald-500 to-teal-600',
      bgColor: 'bg-emerald-50',
      iconColor: 'text-emerald-700',
      badge: 'NEW',
    },
    {
      id: 'headcount',
      title: 'Headcount Planning',
      description: 'HC vs budget, burn, and hiring plan view',
      icon: Target,
      route: '/fpa/headcount',
      available: true,
      color: 'from-fuchsia-500 to-pink-600',
      bgColor: 'bg-fuchsia-50',
      iconColor: 'text-fuchsia-700',
      badge: 'NEW',
    },
    {
      id: 'board-pack',
      title: 'Board Pack',
      description: 'Executive HTML preview and PDF export',
      icon: FileText,
      route: '/reports/board-pack',
      available: true,
      color: 'from-slate-600 to-slate-800',
      bgColor: 'bg-slate-50',
      iconColor: 'text-slate-700',
      badge: 'NEW',
    },
    {
      id: 'sensitivity',
      title: 'Sensitivity Analysis',
      description: '2D stress grid and tornado drivers',
      icon: Grid3x3,
      route: '/fpa/sensitivity',
      available: true,
      color: 'from-yellow-500 to-amber-600',
      bgColor: 'bg-yellow-50',
      iconColor: 'text-yellow-800',
      badge: 'NEW',
    },
  ];

  const handleModuleClick = (module: typeof modules[0]) => {
    if (module.available) {
      navigate(module.route);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-slate-50">
      {/* Multi-Upload Modal */}
      <MultiUploadModal 
        isOpen={showUploadModal} 
        onClose={() => setShowUploadModal(false)} 
      />
      
      {/* Header */}
      <div className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-6 py-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-4">
              <button
                onClick={() => navigate('/dashboard')}
                className="p-2 hover:bg-gray-100 rounded-lg transition"
              >
                <ArrowLeft className="w-5 h-5 text-gray-600" />
              </button>
              <div>
                <h1 className="text-3xl font-bold text-gray-900">FP&A Suite</h1>
                <p className="text-gray-600 mt-1">Financial Planning & Analysis Tools</p>
                <div className="mt-2 flex flex-wrap gap-3 text-sm">
                  <Link
                    to="/excel-suite"
                    className="font-semibold text-emerald-700 hover:text-emerald-800 hover:underline"
                  >
                    Excel AI Suite →
                  </Link>
                  <Link
                    to="/command-center"
                    className="font-semibold text-violet-700 hover:text-violet-800 hover:underline inline-flex items-center gap-1"
                  >
                    AGENTIC Command Center
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-violet-200 text-violet-900">NEW</span>
                  </Link>
                </div>
              </div>
            </div>
            
            {/* Upload Data - opens modal for this section only */}
            <button
              type="button"
              onClick={() => setShowUploadModal(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg transition-colors shadow-sm bg-blue-600 text-white hover:bg-blue-700"
            >
              <Upload className="w-4 h-4" />
              <span>Upload Data</span>
            </button>
            <button
              type="button"
              onClick={handleExportExcelAddinWorkbook}
              disabled={exportingWorkbook}
              className="ml-3 flex items-center gap-2 px-4 py-2 rounded-lg transition-colors shadow-sm bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-70"
            >
              <Download className="w-4 h-4" />
              <span>{exportingWorkbook ? 'Exporting...' : 'Export Excel Add-in Workbook'}</span>
            </button>
          </div>
          
          {/* Info Banner */}
          <div className="bg-gradient-to-r from-blue-50 to-purple-50 border border-blue-200 rounded-lg p-4 mt-4">
            <p className="text-sm text-blue-900">
              <strong>💡 Upload here for FP&A:</strong> Upload your trial balance in this section; the modules below use only data you upload in FP&A Suite.
            </p>
          </div>
          
          {/* Stats */}
          <div className="flex items-center gap-6 text-sm mt-4">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-green-600" />
              <span className="text-gray-700">
                <span className="font-semibold">{modules.length}</span> modules
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-gray-400" />
              <span className="text-gray-700">
                <span className="font-semibold">FP&amp;A Suite</span> — core + extended tools
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Module Cards */}
      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {modules.map((module, index) => {
            const Icon = module.icon;
            
            return (
              <motion.div
                key={module.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: index * 0.1 }}
                onClick={() => handleModuleClick(module)}
                className={`relative group ${
                  module.available 
                    ? 'cursor-pointer hover:shadow-xl hover:scale-105' 
                    : 'cursor-not-allowed opacity-75'
                } transition-all duration-300`}
              >
                {/* Card */}
                <div className="bg-white rounded-xl border-2 border-gray-200 overflow-hidden h-full">
                  {/* Gradient Header */}
                  <div className={`h-2 bg-gradient-to-r ${module.color}`}></div>
                  
                  {/* Content */}
                  <div className="p-6">
                    {/* Icon & Status */}
                    <div className="flex items-start justify-between mb-4">
                      <div className={`p-3 rounded-lg ${module.bgColor}`}>
                        <Icon className={`w-8 h-8 ${module.iconColor}`} />
                      </div>
                      
                      {module.available ? (
                        <div className="flex flex-col items-end gap-1">
                          <span className="px-3 py-1 bg-green-100 text-green-700 text-xs font-semibold rounded-full">
                            ✓ Active
                          </span>
                          {module.badge && (
                            <span className="px-2 py-0.5 bg-amber-100 text-amber-700 text-xs font-bold rounded-full">
                              {module.badge}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="px-3 py-1 bg-amber-100 text-amber-700 text-xs font-semibold rounded-full">
                          Coming Soon
                        </span>
                      )}
                    </div>

                    {/* Title & Description */}
                    <h3 className="text-xl font-bold text-gray-900 mb-2">
                      {module.title}
                    </h3>
                    <p className="text-sm text-gray-600 leading-relaxed">
                      {module.description}
                    </p>

                    {/* Action Footer */}
                    {module.available && (
                      <div className="mt-6 pt-4 border-t border-gray-100">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium text-blue-600 group-hover:text-blue-700">
                            Open Module →
                          </span>
                          <div className="w-8 h-8 rounded-full bg-blue-100 group-hover:bg-blue-200 transition flex items-center justify-center">
                            <ArrowLeft className="w-4 h-4 text-blue-600 transform rotate-180" />
                          </div>
                        </div>
                      </div>
                    )}

                    {!module.available && (
                      <div className="mt-6 pt-4 border-t border-gray-100">
                        <div className="text-xs text-gray-500 italic">
                          Module under development
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Hover Effect Overlay */}
                {module.available && (
                  <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-blue-600/5 opacity-0 group-hover:opacity-100 transition-opacity duration-300 rounded-xl pointer-events-none"></div>
                )}
              </motion.div>
            );
          })}
        </div>

        {/* Footer Info */}
        <div className="mt-12 bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-start gap-4">
            <div className="p-3 bg-blue-100 rounded-lg">
              <Activity className="w-6 h-6 text-blue-600" />
            </div>
            <div>
              <h3 className="font-bold text-gray-900 mb-2">About FP&A Suite</h3>
              <p className="text-sm text-gray-600 leading-relaxed">
                The FP&A Suite is your comprehensive financial planning and analysis toolkit. 
                Active modules: <span className="font-semibold">Variance Analysis</span> (budget vs actual), 
                <span className="font-semibold"> Budget Management</span> (annual planning), 
                <span className="font-semibold"> KPI Dashboard</span> (CFO morning view), 
                <span className="font-semibold"> Forecasting Engine</span> (revenue/expense/cash), and 
                <span className="font-semibold"> Scenario Planning</span> (what-if analysis). 
                Management reporting coming soon.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
