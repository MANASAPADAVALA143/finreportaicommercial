import React, { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Download,
  Sparkles,
  TrendingUp,
  DollarSign,
  Wallet,
  FileSpreadsheet,
  Edit2,
  Check,
  X,
  AlertCircle
} from 'lucide-react';
import { Scenario } from '../../types/forecast';
import ScenarioToggle from '../../components/fpa/forecast/ScenarioToggle';
import {
  revenueForecastData,
  expenseForecastData,
  headcountForecastData,
  cashFlowForecastData,
  cashFlowAlerts,
  arSchedule,
  apSchedule,
  scenarioMultipliers
} from '../../data/forecastMockData';
import { loadFPAActual, loadFPABudget, loadFPAForecast, checkDataAvailability, generateForecastFromReal } from '../../utils/fpaDataLoader';
import {
  ComposedChart,
  Bar,
  Line,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine
} from 'recharts';
import { callAI } from '../../services/aiProvider';
import * as XLSX from 'xlsx';

const ForecastingEngine: React.FC = () => {
  const navigate = useNavigate();
  
  // Check data availability
  const dataCheck = checkDataAvailability(['fpa_actual', 'fpa_budget']);
  const [actualData, setActualData] = useState<any>(null);
  const [budgetData, setBudgetData] = useState<any>(null);
  const [forecastMonthlyData, setForecastMonthlyData] = useState<any>(null);
  const [realForecastData, setRealForecastData] = useState<any>(null);

  useEffect(() => {
    const actual = loadFPAActual();
    const budget = loadFPABudget();
    const monthly = loadFPAForecast();
    setActualData(actual);
    setBudgetData(budget);
    setForecastMonthlyData(monthly);
    
    // Generate forecast from real data
    if (actual && budget) {
      const generated = generateForecastFromReal(actual, budget, monthly);
      setRealForecastData(generated);
    }
  }, []);
  
  const [activeTab, setActiveTab] = useState<'revenue' | 'expense' | 'cashflow'>('revenue');
  const [scenario, setScenario] = useState<Scenario>('base');
  const [forecastPeriod, setForecastPeriod] = useState('FY2026');
  const [method, setMethod] = useState('AI-Assisted');
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiInsights, setAiInsights] = useState<string | null>(null);

  // Apply scenario multipliers to data
  const multiplier = scenarioMultipliers[scenario];
  
  // Use real forecast data if available, otherwise use mock
  const baseRevenueData = realForecastData?.revenue || revenueForecastData;
  const baseExpenseData = realForecastData?.expenses || expenseForecastData;
  
  const adjustedRevenueData = useMemo(() => {
    return baseRevenueData.map((row: any) => ({
      ...row,
      forecast: row.isActual ? row.forecast : Math.round(row.forecast * multiplier.revenue),
      variance_vs_budget: row.isActual ? row.variance_vs_budget : ((row.forecast * multiplier.revenue - row.budget) / row.budget * 100)
    }));
  }, [scenario, multiplier, baseRevenueData]);

  const adjustedExpenseData = useMemo(() => {
    return baseExpenseData.map((row: any) => ({
      ...row,
      fy26: Math.round(row.fy26 * multiplier.expenses),
      variance: Math.round(row.fy26 * multiplier.expenses - row.budget),
      variancePct: ((row.fy26 * multiplier.expenses - row.budget) / row.budget * 100)
    }));
  }, [scenario, multiplier, baseExpenseData]);

  const formatCurrency = (value: number): string => {
    const crore = value / 10000000;
    const lakh = value / 100000;
    if (Math.abs(crore) >= 1) return `₹${crore.toFixed(2)}Cr`;
    return `₹${lakh.toFixed(2)}L`;
  };

  const generateAIForecast = async () => {
    setAiGenerating(true);
    try {
      const prompt = `You are a financial forecasting expert. Provide insights for the ${scenario} case scenario.

Current scenario: ${scenario.toUpperCase()} CASE
- Revenue multiplier: ${(multiplier.revenue * 100).toFixed(0)}%
- Expense multiplier: ${(multiplier.expenses * 100).toFixed(0)}%

KEY METRICS:
- FY2026 Revenue Forecast: ${formatCurrency(adjustedRevenueData.reduce((sum, row) => sum + row.forecast, 0))}
- FY2026 Expense Forecast: ${formatCurrency(adjustedExpenseData.reduce((sum, row) => sum + row.fy26, 0))}
- 13-Week Cash: Opens ₹2.5Cr, closes ₹3.4Cr

Provide brief insights (max 150 words):
1. Key assumptions for this scenario
2. Main risks to watch
3. One action recommendation`;

      const response = await callAI(prompt);
      setAiInsights(response);
    } catch (error: any) {
      alert('❌ Failed to generate forecast: ' + error.message);
    } finally {
      setAiGenerating(false);
    }
  };

  const handleExport = () => {
    try {
      const workbook = XLSX.utils.book_new();
      
      // Revenue sheet
      const revenueSheet = XLSX.utils.json_to_sheet(adjustedRevenueData.map(row => ({
        Month: row.month,
        'Actual/Forecast': formatCurrency(row.actual || row.forecast),
        Budget: formatCurrency(row.budget),
        'Last Year': formatCurrency(row.lastYear),
        'vs Budget %': row.variance_vs_budget.toFixed(1) + '%',
        'vs LY %': row.variance_vs_ly.toFixed(1) + '%',
        Confidence: row.confidence ? row.confidence + '%' : 'N/A'
      })));
      XLSX.utils.book_append_sheet(workbook, revenueSheet, 'Revenue Forecast');

      // Expense sheet
      const expenseSheet = XLSX.utils.json_to_sheet(adjustedExpenseData.map(row => ({
        Department: row.department,
        'Oct 25': formatCurrency(row.oct),
        'Nov 25': formatCurrency(row.nov),
        'Dec 25': formatCurrency(row.dec),
        'Q1 FY26': formatCurrency(row.q1),
        'Q2 FY26': formatCurrency(row.q2),
        'FY26 Total': formatCurrency(row.fy26),
        Budget: formatCurrency(row.budget),
        'Variance %': row.variancePct.toFixed(1) + '%'
      })));
      XLSX.utils.book_append_sheet(workbook, expenseSheet, 'Expense Forecast');

      // Cash flow sheet
      const cashSheet = XLSX.utils.json_to_sheet(cashFlowForecastData.map(row => ({
        Week: row.weekLabel,
        Opening: formatCurrency(row.openingBalance),
        Inflows: formatCurrency(row.inflows.total),
        Outflows: formatCurrency(row.outflows.total),
        'Net CF': formatCurrency(row.netCashFlow),
        Closing: formatCurrency(row.closingBalance),
        Status: row.belowBuffer ? '🔴 Alert' : '🟢 OK'
      })));
      XLSX.utils.book_append_sheet(workbook, cashSheet, '13-Week Cash Flow');

      XLSX.writeFile(workbook, `Forecast_${scenario}_${new Date().toISOString().split('T')[0]}.xlsx`);
      alert('✅ Forecast exported to Excel successfully!');
    } catch (error: any) {
      alert('❌ Failed to export: ' + error.message);
    }
  };

  const totalRevenueForecast = adjustedRevenueData.reduce((sum, row) => sum + row.forecast, 0);
  const totalExpenseForecast = adjustedExpenseData.reduce((sum, row) => sum + row.fy26, 0);
  const netProfitForecast = totalRevenueForecast - totalExpenseForecast;
  const netMargin = totalRevenueForecast > 0 ? (netProfitForecast / totalRevenueForecast) * 100 : 0;
  if (netMargin > 50) {
    console.warn('Net margin unrealistic:', netMargin.toFixed(1) + '% — check expense data scaling (e.g. Lakhs vs Crores)');
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-slate-50 p-6">
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
                  <TrendingUp size={32} className="text-blue-600" />
                  <div>
                    <h1 className="text-3xl font-bold text-gray-900">🔮 Forecasting Engine</h1>
                    <p className="text-gray-600 mt-1">Revenue · Expenses · Cash Flow</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={generateAIForecast}
                disabled={aiGenerating}
                className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg hover:from-purple-700 hover:to-blue-700 transition-colors disabled:opacity-50"
              >
                <Sparkles size={18} />
                {aiGenerating ? 'Generating...' : 'AI Forecast'}
              </button>
              <button
                onClick={handleExport}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                <Download size={18} />
                Export
              </button>
            </div>
          </div>

          {/* Controls */}
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-gray-700">Forecast Period:</span>
              <select
                value={forecastPeriod}
                onChange={(e) => setForecastPeriod(e.target.value)}
                className="px-3 py-1.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-gray-700"
              >
                <option>FY2026</option>
                <option>FY2027</option>
                <option>Q1 FY26</option>
                <option>Q2 FY26</option>
              </select>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-gray-700">Method:</span>
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value)}
                className="px-3 py-1.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-gray-700"
              >
                <option>AI-Assisted</option>
                <option>Trend-Based</option>
                <option>Manual Entry</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Scenario Toggle */}
      <div className="max-w-[1800px] mx-auto mb-6">
        <ScenarioToggle scenario={scenario} onScenarioChange={setScenario} />
      </div>

      {/* Summary Cards */}
      <div className="max-w-[1800px] mx-auto mb-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="text-blue-600" size={20} />
              <span className="text-sm font-medium text-gray-600">FY2026 Revenue Forecast</span>
            </div>
            <div className="text-3xl font-bold text-gray-900 mb-1">
              {formatCurrency(totalRevenueForecast)}
            </div>
            <div className="text-sm text-gray-500">
              vs FY2025: +27.3% YoY
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <div className="flex items-center gap-2 mb-2">
              <DollarSign className="text-red-600" size={20} />
              <span className="text-sm font-medium text-gray-600">FY2026 Expense Forecast</span>
            </div>
            <div className="text-3xl font-bold text-gray-900 mb-1">
              {formatCurrency(totalExpenseForecast)}
            </div>
            <div className="text-sm text-gray-500">
              vs FY2025: +24.5% YoY
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <div className="flex items-center gap-2 mb-2">
              <Wallet className="text-green-600" size={20} />
              <span className="text-sm font-medium text-gray-600">Net Profit Forecast</span>
            </div>
            <div className="text-3xl font-bold text-gray-900 mb-1">
              {formatCurrency(netProfitForecast)}
            </div>
            <div className="text-sm text-gray-500">
              Margin: {((netProfitForecast / totalRevenueForecast) * 100).toFixed(1)}%
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <div className="flex items-center gap-2 mb-2">
              <Wallet className="text-purple-600" size={20} />
              <span className="text-sm font-medium text-gray-600">Week 13 Cash</span>
            </div>
            <div className="text-3xl font-bold text-gray-900 mb-1">
              ₹3.4Cr
            </div>
            <div className="text-sm text-green-600">
              +₹0.9Cr from today
            </div>
          </div>
        </div>
      </div>

      {/* AI Insights */}
      {aiInsights && (
        <div className="max-w-[1800px] mx-auto mb-6">
          <div className="bg-gradient-to-br from-purple-50 to-blue-50 rounded-xl border-2 border-purple-200 p-6">
            <div className="flex items-center gap-2 mb-3">
              <Sparkles className="text-purple-600" size={20} />
              <h3 className="font-bold text-gray-900">AI Forecast Insights ({scenario.toUpperCase()} Case)</h3>
            </div>
            <p className="text-sm text-gray-700 whitespace-pre-line">{aiInsights}</p>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="max-w-[1800px] mx-auto mb-6">
        <div className="flex items-center gap-2 border-b border-gray-200">
          <button
            onClick={() => setActiveTab('revenue')}
            className={`px-6 py-3 font-semibold transition-colors ${
              activeTab === 'revenue'
                ? 'text-blue-600 border-b-2 border-blue-600'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Revenue Forecast
          </button>
          <button
            onClick={() => setActiveTab('expense')}
            className={`px-6 py-3 font-semibold transition-colors ${
              activeTab === 'expense'
                ? 'text-blue-600 border-b-2 border-blue-600'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Expense Forecast
          </button>
          <button
            onClick={() => setActiveTab('cashflow')}
            className={`px-6 py-3 font-semibold transition-colors ${
              activeTab === 'cashflow'
                ? 'text-blue-600 border-b-2 border-blue-600'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            13-Week Cash Flow
          </button>
        </div>
      </div>

      {/* Tab Content */}
      <div className="max-w-[1800px] mx-auto">
        {/* Revenue Tab */}
        {activeTab === 'revenue' && (
          <div className="space-y-6">
            {/* Revenue Table */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <h3 className="text-lg font-bold text-gray-900 mb-4">Monthly Revenue Forecast</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="py-3 px-4 text-left font-semibold text-gray-700">Month</th>
                      <th className="py-3 px-4 text-right font-semibold text-gray-700">Actual/Forecast</th>
                      <th className="py-3 px-4 text-right font-semibold text-gray-700">Budget</th>
                      <th className="py-3 px-4 text-right font-semibold text-gray-700">Last Year</th>
                      <th className="py-3 px-4 text-right font-semibold text-gray-700">vs Budget</th>
                      <th className="py-3 px-4 text-right font-semibold text-gray-700">vs LY</th>
                      <th className="py-3 px-4 text-center font-semibold text-gray-700">Confidence</th>
                      <th className="py-3 px-4 text-center font-semibold text-gray-700">Method</th>
                    </tr>
                  </thead>
                  <tbody>
                    {adjustedRevenueData.map((row, idx) => (
                      <tr key={idx} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="py-3 px-4 font-medium text-gray-900">{row.month}</td>
                        <td className="py-3 px-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <span>{formatCurrency(row.actual || row.forecast)}</span>
                            <span className={`text-xs px-2 py-0.5 rounded ${
                              row.isActual ? 'bg-gray-100 text-gray-700' : 'bg-blue-100 text-blue-700'
                            }`}>
                              {row.isActual ? 'A' : 'F'}
                            </span>
                          </div>
                        </td>
                        <td className="py-3 px-4 text-right text-gray-600">{formatCurrency(row.budget)}</td>
                        <td className="py-3 px-4 text-right text-gray-600">{formatCurrency(row.lastYear)}</td>
                        <td className={`py-3 px-4 text-right font-semibold ${
                          row.variance_vs_budget >= 0 ? 'text-green-600' : 'text-red-600'
                        }`}>
                          {row.variance_vs_budget > 0 ? '+' : ''}{row.variance_vs_budget.toFixed(1)}%
                        </td>
                        <td className={`py-3 px-4 text-right font-semibold ${
                          row.variance_vs_ly >= 0 ? 'text-green-600' : 'text-red-600'
                        }`}>
                          {row.variance_vs_ly > 0 ? '+' : ''}{row.variance_vs_ly.toFixed(1)}%
                        </td>
                        <td className="py-3 px-4 text-center">
                          {row.confidence ? (
                            <div className="flex items-center justify-center gap-1">
                              <span className={`w-2 h-2 rounded-full ${
                                row.confidence >= 85 ? 'bg-green-500' : row.confidence >= 70 ? 'bg-amber-500' : 'bg-red-500'
                              }`}></span>
                              <span>{row.confidence}%</span>
                            </div>
                          ) : '—'}
                        </td>
                        <td className="py-3 px-4 text-center text-gray-600">
                          {row.method ? (typeof row.method === 'string' ? row.method.replace('_', ' ') : row.method) : 'AI Forecast'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Revenue Chart */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <h3 className="text-lg font-bold text-gray-900 mb-4">Revenue Forecast Chart</h3>
              <ResponsiveContainer width="100%" height={350}>
                <ComposedChart data={adjustedRevenueData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                  <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                  <YAxis tickFormatter={(val) => `₹${(val / 10000000).toFixed(0)}Cr`} tick={{ fontSize: 12 }} />
                  <Tooltip
                    formatter={(value: any) => formatCurrency(value)}
                    contentStyle={{ backgroundColor: '#fff', border: '1px solid #E5E7EB', borderRadius: '8px' }}
                  />
                  <Legend />
                  <ReferenceLine x="Nov 25" stroke="#EF4444" strokeDasharray="3 3" label="Today" />
                  <Bar dataKey="forecast" name="Forecast" fill="#3B82F6" />
                  <Line type="monotone" dataKey="budget" name="Budget" stroke="#F59E0B" strokeWidth={2} strokeDasharray="5 5" />
                  <Line type="monotone" dataKey="lastYear" name="Last Year" stroke="#9CA3AF" strokeWidth={2} strokeDasharray="3 3" />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Expense Tab */}
        {activeTab === 'expense' && (
          <div className="space-y-6">
            {/* Expense Table */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <h3 className="text-lg font-bold text-gray-900 mb-4">Expense Forecast by Department</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="py-3 px-4 text-left font-semibold text-gray-700">Department</th>
                      <th className="py-3 px-4 text-right font-semibold text-gray-700">Oct (A)</th>
                      <th className="py-3 px-4 text-right font-semibold text-gray-700">Nov (F)</th>
                      <th className="py-3 px-4 text-right font-semibold text-gray-700">Dec (F)</th>
                      <th className="py-3 px-4 text-right font-semibold text-gray-700">Q1 (F)</th>
                      <th className="py-3 px-4 text-right font-semibold text-gray-700">Q2 (F)</th>
                      <th className="py-3 px-4 text-right font-semibold text-gray-700">FY26 (F)</th>
                      <th className="py-3 px-4 text-right font-semibold text-gray-700">Budget</th>
                      <th className="py-3 px-4 text-right font-semibold text-gray-700">Var %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {adjustedExpenseData.map((row, idx) => (
                      <tr key={idx} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="py-3 px-4 font-medium text-gray-900">{row.department}</td>
                        <td className="py-3 px-4 text-right text-gray-600">{formatCurrency(row.oct)}</td>
                        <td className="py-3 px-4 text-right text-gray-600">{formatCurrency(row.nov)}</td>
                        <td className="py-3 px-4 text-right text-gray-600">{formatCurrency(row.dec)}</td>
                        <td className="py-3 px-4 text-right text-gray-600">{formatCurrency(row.q1 * multiplier.expenses)}</td>
                        <td className="py-3 px-4 text-right text-gray-600">{formatCurrency(row.q2 * multiplier.expenses)}</td>
                        <td className="py-3 px-4 text-right font-semibold text-gray-900">{formatCurrency(row.fy26)}</td>
                        <td className="py-3 px-4 text-right text-gray-600">{formatCurrency(row.budget)}</td>
                        <td className={`py-3 px-4 text-right font-semibold ${
                          row.variancePct > 0 ? 'text-green-600' : 'text-red-600'
                        }`}>
                          {row.variancePct > 0 ? '+' : ''}{row.variancePct.toFixed(1)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Headcount Forecast */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <h3 className="text-lg font-bold text-gray-900 mb-4">Headcount Forecast</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="py-3 px-4 text-left font-semibold text-gray-700">Department</th>
                      <th className="py-3 px-4 text-right font-semibold text-gray-700">Current</th>
                      <th className="py-3 px-4 text-right font-semibold text-gray-700">+New Hires</th>
                      <th className="py-3 px-4 text-right font-semibold text-gray-700">-Attrition</th>
                      <th className="py-3 px-4 text-right font-semibold text-gray-700">Q1 End</th>
                      <th className="py-3 px-4 text-right font-semibold text-gray-700">Q2 End</th>
                      <th className="py-3 px-4 text-right font-semibold text-gray-700">FY26 End</th>
                    </tr>
                  </thead>
                  <tbody>
                    {headcountForecastData.map((row, idx) => (
                      <tr key={idx} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="py-3 px-4 font-medium text-gray-900">{row.department}</td>
                        <td className="py-3 px-4 text-right text-gray-600">{row.current}</td>
                        <td className="py-3 px-4 text-right text-green-600">+{row.newHires}</td>
                        <td className="py-3 px-4 text-right text-red-600">-{row.attrition}</td>
                        <td className="py-3 px-4 text-right font-semibold text-gray-900">{row.q1End}</td>
                        <td className="py-3 px-4 text-right font-semibold text-gray-900">{row.q2End}</td>
                        <td className="py-3 px-4 text-right font-bold text-blue-600">{row.fy26End}</td>
                      </tr>
                    ))}
                    <tr className="bg-blue-50 font-bold">
                      <td className="py-3 px-4 text-gray-900">Total</td>
                      <td className="py-3 px-4 text-right text-gray-900">
                        {headcountForecastData.reduce((sum, row) => sum + row.current, 0)}
                      </td>
                      <td className="py-3 px-4 text-right text-green-600">
                        +{headcountForecastData.reduce((sum, row) => sum + row.newHires, 0)}
                      </td>
                      <td className="py-3 px-4 text-right text-red-600">
                        -{headcountForecastData.reduce((sum, row) => sum + row.attrition, 0)}
                      </td>
                      <td className="py-3 px-4 text-right text-gray-900">
                        {headcountForecastData.reduce((sum, row) => sum + row.q1End, 0)}
                      </td>
                      <td className="py-3 px-4 text-right text-gray-900">
                        {headcountForecastData.reduce((sum, row) => sum + row.q2End, 0)}
                      </td>
                      <td className="py-3 px-4 text-right text-blue-600">
                        {headcountForecastData.reduce((sum, row) => sum + row.fy26End, 0)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Cash Flow Tab */}
        {activeTab === 'cashflow' && (
          <div className="space-y-6">
            {/* Cash Flow Alerts */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {cashFlowAlerts.filter(alert => alert.severity === 'critical' || alert.severity === 'warning').slice(0, 3).map(alert => (
                <div
                  key={alert.week}
                  className={`p-4 rounded-lg border-2 ${
                    alert.severity === 'critical'
                      ? 'border-red-200 bg-red-50'
                      : 'border-amber-200 bg-amber-50'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <AlertCircle className={alert.severity === 'critical' ? 'text-red-600' : 'text-amber-600'} size={20} />
                    <span className="font-bold text-gray-900">{alert.weekLabel}</span>
                  </div>
                  <p className="text-sm text-gray-700 mb-2">{alert.message}</p>
                  {alert.action && (
                    <div className="text-xs text-gray-600 bg-white px-2 py-1 rounded border border-gray-200">
                      <span className="font-semibold">Action:</span> {alert.action}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Cash Flow Table */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <h3 className="text-lg font-bold text-gray-900 mb-4">13-Week Rolling Cash Flow</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="py-3 px-4 text-left font-semibold text-gray-700">Week</th>
                      <th className="py-3 px-4 text-right font-semibold text-gray-700">Opening</th>
                      <th className="py-3 px-4 text-right font-semibold text-gray-700">Inflows</th>
                      <th className="py-3 px-4 text-right font-semibold text-gray-700">Outflows</th>
                      <th className="py-3 px-4 text-right font-semibold text-gray-700">Net CF</th>
                      <th className="py-3 px-4 text-right font-semibold text-gray-700">Closing</th>
                      <th className="py-3 px-4 text-center font-semibold text-gray-700">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cashFlowForecastData.map((row, idx) => (
                      <tr key={idx} className={`border-b border-gray-100 ${row.belowBuffer ? 'bg-red-50' : 'hover:bg-gray-50'}`}>
                        <td className="py-3 px-4 font-medium text-gray-900">{row.weekLabel}</td>
                        <td className="py-3 px-4 text-right text-gray-600">{formatCurrency(row.openingBalance)}</td>
                        <td className="py-3 px-4 text-right text-green-600">{formatCurrency(row.inflows.total)}</td>
                        <td className="py-3 px-4 text-right text-red-600">{formatCurrency(row.outflows.total)}</td>
                        <td className={`py-3 px-4 text-right font-semibold ${
                          row.netCashFlow >= 0 ? 'text-green-600' : 'text-red-600'
                        }`}>
                          {row.netCashFlow >= 0 ? '+' : ''}{formatCurrency(row.netCashFlow)}
                        </td>
                        <td className="py-3 px-4 text-right font-bold text-gray-900">{formatCurrency(row.closingBalance)}</td>
                        <td className="py-3 px-4 text-center text-2xl">
                          {row.belowBuffer ? '🔴' : '🟢'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Cash Flow Chart */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <h3 className="text-lg font-bold text-gray-900 mb-4">Cash Flow Waterfall</h3>
              <ResponsiveContainer width="100%" height={350}>
                <ComposedChart data={cashFlowForecastData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                  <XAxis dataKey="weekLabel" tick={{ fontSize: 11 }} angle={-45} textAnchor="end" height={80} />
                  <YAxis tickFormatter={(val) => `₹${(val / 10000000).toFixed(1)}Cr`} tick={{ fontSize: 12 }} />
                  <Tooltip
                    formatter={(value: any) => formatCurrency(value)}
                    contentStyle={{ backgroundColor: '#fff', border: '1px solid #E5E7EB', borderRadius: '8px' }}
                  />
                  <Legend />
                  <ReferenceLine y={1000000} stroke="#EF4444" strokeDasharray="5 5" label="Min Buffer" />
                  <Area
                    type="monotone"
                    dataKey="closingBalance"
                    name="Closing Balance"
                    fill="#3B82F6"
                    stroke="#3B82F6"
                    fillOpacity={0.3}
                  />
                  <Bar dataKey="inflows.total" name="Inflows" fill="#10B981" />
                  <Bar dataKey="outflows.total" name="Outflows" fill="#EF4444" />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            {/* AR/AP Schedule */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                <h3 className="text-lg font-bold text-gray-900 mb-4">AR Collections Schedule</h3>
                <div className="space-y-3">
                  <div className="flex justify-between items-center py-2 border-b border-gray-200">
                    <span className="text-sm text-gray-600">Overdue (&gt;60 days)</span>
                    <span className="font-bold text-red-600">{formatCurrency(arSchedule.overdue)}</span>
                  </div>
                  <div className="flex justify-between items-center py-2 border-b border-gray-200">
                    <span className="text-sm text-gray-600">Due this week</span>
                    <span className="font-bold text-gray-900">{formatCurrency(arSchedule.dueThisWeek)}</span>
                  </div>
                  <div className="flex justify-between items-center py-2 border-b border-gray-200">
                    <span className="text-sm text-gray-600">Due next 2 weeks</span>
                    <span className="font-bold text-gray-900">{formatCurrency(arSchedule.dueNext2Weeks)}</span>
                  </div>
                  <div className="flex justify-between items-center py-2">
                    <span className="text-sm text-gray-600">Due this month</span>
                    <span className="font-bold text-blue-600">{formatCurrency(arSchedule.dueThisMonth)}</span>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                <h3 className="text-lg font-bold text-gray-900 mb-4">AP Payments Schedule</h3>
                <div className="space-y-3">
                  <div className="flex justify-between items-center py-2 border-b border-gray-200">
                    <span className="text-sm text-gray-600">Due this week</span>
                    <span className="font-bold text-gray-900">{formatCurrency(apSchedule.dueThisWeek)}</span>
                  </div>
                  <div className="flex justify-between items-center py-2 border-b border-gray-200">
                    <span className="text-sm text-gray-600">Due next 2 weeks</span>
                    <span className="font-bold text-gray-900">{formatCurrency(apSchedule.dueNext2Weeks)}</span>
                  </div>
                  <div className="flex justify-between items-center py-2 border-b border-gray-200">
                    <span className="text-sm text-gray-600">Payroll (Week 4)</span>
                    <span className="font-bold text-red-600">₹3.2Cr</span>
                  </div>
                  <div className="flex justify-between items-center py-2">
                    <span className="text-sm text-gray-600">Tax payment (Week 6)</span>
                    <span className="font-bold text-red-600">₹1.7Cr</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ForecastingEngine;
