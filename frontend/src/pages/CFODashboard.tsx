// CFO Dashboard - Strategic Command Center
import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import axios from 'axios';
import {
  TrendingUp, TrendingDown, DollarSign, AlertCircle, Download,
  RefreshCw, ArrowLeft, Target, BarChart3,
  Activity, Bell, CheckCircle, Zap, FileText, Clock,
  Settings, MessageSquare, X, Upload
} from 'lucide-react';
import {
  AreaChart, Area, BarChart, Bar, PieChart as RechartsPie,
  Pie, Cell, RadarChart, Radar, PolarGrid, PolarAngleAxis,
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer
} from 'recharts';
import { useNavigate } from 'react-router-dom';

interface DashboardData {
  healthScore: {
    overall: number;
    trend: number;
    breakdown: {
      liquidity: number;
      profitability: number;
      efficiency: number;
      stability: number;
    };
  };
  cash: {
    current: number;
    trend: number;
    runway: number;
    history: number[];
  };
  revenue: {
    monthly: number;
    arr: number;
    growth: number;
    history: number[];
  };
  expenses: {
    monthly: number;
    trend: number;
    categories: Array<{
      name: string;
      value: number;
      percentage: number;
    }>;
  };
  insights: Array<{
    icon: string;
    text: string;
    severity: string;
  }>;
  alerts: Array<{
    severity: string;
    message: string;
    time: string;
    action: string;
  }>;
  recentActivity: Array<{
    icon: string;
    action: string;
    time: string;
  }>;
  recommendations: Array<{
    priority: string;
    text: string;
    impact: string;
  }>;
  ratios: {
    currentRatio: number;
    quickRatio: number;
    debtToEquity: number;
    roe: number;
    operatingMargin: number;
  };
}

// Mock Data
const mockCFOData: DashboardData = {
  healthScore: {
    overall: 69,
    trend: 2.5,
    breakdown: {
      liquidity: 66,
      profitability: 68,
      efficiency: 62,
      stability: 71
    }
  },
  cash: {
    current: 562000,
    trend: 6.8,
    runway: 18.5,
    history: [520000, 535000, 548000, 562000, 575000, 580000, 562000]
  },
  revenue: {
    monthly: 328000,
    arr: 3936000,
    growth: 25,
    history: [245000, 268000, 291000, 308000, 315000, 328000]
  },
  expenses: {
    monthly: 234000,
    trend: 8.2,
    categories: [
      { name: 'Operations', value: 105000, percentage: 45 },
      { name: 'Marketing', value: 58000, percentage: 25 },
      { name: 'Sales', value: 47000, percentage: 20 },
      { name: 'R&D', value: 24000, percentage: 10 }
    ]
  },
  insights: [
    { icon: '💰', text: 'Cash runway trending down - consider cost optimization', severity: 'warning' },
    { icon: '📊', text: 'AR aging increased 8 days - follow up with top 3 customers', severity: 'medium' },
    { icon: '📈', text: 'Marketing ROI at 340% - recommend budget increase', severity: 'info' },
    { icon: '📦', text: 'Inventory turnover slowing - review stock levels', severity: 'medium' }
  ],
  alerts: [
    { severity: 'critical', message: 'Cash forecast shows potential shortfall in Week 11', time: '2 hours ago', action: 'Review' },
    { severity: 'warning', message: 'Customer XYZ payment overdue by 15 days', time: '5 hours ago', action: 'Follow up' },
    { severity: 'info', message: 'Monthly financial close completed', time: '1 day ago', action: 'View' }
  ],
  recentActivity: [
    { icon: '📄', action: 'Board report generated', time: '2 hours ago' },
    { icon: '💰', action: 'Cash flow forecast updated', time: '5 hours ago' },
    { icon: '📊', action: 'P&L analysis completed', time: '1 day ago' },
    { icon: '🔍', action: 'Fraud detection scan finished', time: '1 day ago' },
    { icon: '📈', action: 'Q4 variance report created', time: '2 days ago' }
  ],
  recommendations: [
    { priority: 'high', text: 'Reduce marketing spend by 15% to extend runway', impact: '+2.5 months runway' },
    { priority: 'medium', text: 'Negotiate payment terms with top 3 vendors', impact: '$50K cash flow improvement' },
    { priority: 'low', text: 'Review SaaS subscriptions for optimization', impact: '$5K/month savings' }
  ],
  ratios: {
    currentRatio: 2.4,
    quickRatio: 1.8,
    debtToEquity: 0.3,
    roe: 18,
    operatingMargin: 28.7
  }
};

export const CFODashboard = () => {
  const navigate = useNavigate();
  const [timeRange, setTimeRange] = useState<'week' | 'month' | 'quarter' | 'year'>('month');
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<DashboardData>(mockCFOData);
  const [showChatBot, setShowChatBot] = useState(false);

  useEffect(() => {
    fetchDashboardData();
  }, [timeRange]);

  const fetchDashboardData = async () => {
    setLoading(true);
    try {
      const response = await axios.get(
        `http://localhost:8000/api/cfo/dashboard?time_range=${timeRange}`
      );
      setData(response.data);
    } catch (error) {
      console.error('Failed to fetch dashboard data:', error);
      // Use mock data as fallback
      setData(mockCFOData);
    } finally {
      setLoading(false);
    }
  };

  const handleExport = async (format: 'pdf' | 'excel' | 'csv') => {
    try {
      // Use query parameters instead of request body
      const response = await axios.post(
        `http://localhost:8000/api/cfo/export?format=${format}&time_range=${timeRange}`,
        {},
        { responseType: 'blob' }
      );
      
      // Determine file extension
      const extension = format === 'excel' ? 'xlsx' : format === 'pdf' ? 'txt' : 'csv';
      
      // Create download link
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `cfo-dashboard-${new Date().toISOString().split('T')[0]}.${extension}`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      
      // Clean up
      window.URL.revokeObjectURL(url);
      
      console.log(`✅ Successfully exported dashboard as ${format}`);
    } catch (error) {
      console.error('Export failed:', error);
      alert(`Export failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  if (loading && !data) {
    return <LoadingSkeleton />;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-slate-50 pb-12">
      {/* HEADER */}
      <div className="bg-white border-b border-gray-200 shadow-sm sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            {/* Left: Back + Title */}
            <div className="flex items-center gap-4">
              <button
                onClick={() => navigate('/dashboard')}
                className="p-2 hover:bg-gray-100 rounded-lg transition"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">
                  CFO Dashboard - Strategic Command Center
                </h1>
                <p className="text-sm text-gray-600">
                  AI-powered insights by Amazon Nova
                </p>
              </div>
            </div>

            {/* Right: Actions */}
            <div className="flex items-center gap-3">
              {/* Time Range Selector */}
              <div className="flex bg-gray-100 rounded-lg p-1">
                {(['week', 'month', 'quarter', 'year'] as const).map((range) => (
                  <button
                    key={range}
                    onClick={() => setTimeRange(range)}
                    className={`px-4 py-1.5 rounded-md text-sm font-medium transition ${
                      timeRange === range
                        ? 'bg-white text-blue-600 shadow'
                        : 'text-gray-600 hover:text-gray-900'
                    }`}
                  >
                    {range.charAt(0).toUpperCase() + range.slice(1)}
                  </button>
                ))}
              </div>

              {/* Go to Dashboard (each section has its own upload) */}
              <button
                onClick={() => navigate('/dashboard')}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
              >
                <Upload className="w-4 h-4" />
                <span>Go to sections</span>
              </button>

              {/* Export Dropdown */}
              <div className="relative group">
                <button className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">
                  <Download className="w-4 h-4" />
                  <span>Export</span>
                </button>
                <div className="absolute right-0 mt-2 w-40 bg-white border border-gray-200 rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition">
                  <button onClick={() => handleExport('pdf')} className="w-full px-4 py-2 text-left hover:bg-gray-50">PDF Report</button>
                  <button onClick={() => handleExport('excel')} className="w-full px-4 py-2 text-left hover:bg-gray-50">Excel Data</button>
                  <button onClick={() => handleExport('csv')} className="w-full px-4 py-2 text-left hover:bg-gray-50">CSV Export</button>
                </div>
              </div>

              {/* Refresh */}
              <button
                onClick={fetchDashboardData}
                className="p-2 hover:bg-gray-100 rounded-lg transition"
                disabled={loading}
              >
                <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
              </button>

              {/* Settings */}
              <button className="p-2 hover:bg-gray-100 rounded-lg transition">
                <Settings className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* KPI CARDS */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          {/* Card 1: Financial Health Score */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="bg-white rounded-2xl shadow-xl border border-gray-100 p-6 hover:shadow-2xl transition-all"
          >
            <div className="flex items-center justify-between mb-4">
              <div className="text-sm text-gray-600">Financial Health</div>
              <Target className="w-5 h-5 text-blue-500" />
            </div>
            <div className="flex items-center gap-4">
              {/* Circular Progress */}
              <div className="relative w-20 h-20">
                <svg className="transform -rotate-90 w-20 h-20">
                  <circle
                    cx="40"
                    cy="40"
                    r="36"
                    stroke="#E5E7EB"
                    strokeWidth="8"
                    fill="none"
                  />
                  <circle
                    cx="40"
                    cy="40"
                    r="36"
                    stroke={
                      (data?.healthScore.overall || 0) >= 80 ? '#10B981' :
                      (data?.healthScore.overall || 0) >= 60 ? '#F59E0B' : '#EF4444'
                    }
                    strokeWidth="8"
                    fill="none"
                    strokeDasharray={`${(data?.healthScore.overall || 0) * 2.26} 226`}
                    strokeLinecap="round"
                  />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-xl font-bold">{data?.healthScore.overall}</span>
                </div>
              </div>
              <div>
                <div className="text-3xl font-bold text-gray-900">
                  {data?.healthScore.overall}/100
                </div>
                <div className="flex items-center text-sm text-green-600 mt-1">
                  <TrendingUp className="w-4 h-4 mr-1" />
                  +{data?.healthScore.trend}% vs last month
                </div>
              </div>
            </div>
            {/* Mini Breakdown */}
            <div className="mt-4 pt-4 border-t border-gray-100 grid grid-cols-2 gap-2 text-xs">
              <div>
                <span className="text-gray-500">Liquidity:</span>
                <span className="ml-1 font-semibold">{data?.healthScore.breakdown.liquidity}</span>
              </div>
              <div>
                <span className="text-gray-500">Profit:</span>
                <span className="ml-1 font-semibold">{data?.healthScore.breakdown.profitability}</span>
              </div>
              <div>
                <span className="text-gray-500">Efficiency:</span>
                <span className="ml-1 font-semibold">{data?.healthScore.breakdown.efficiency}</span>
              </div>
              <div>
                <span className="text-gray-500">Stability:</span>
                <span className="ml-1 font-semibold">{data?.healthScore.breakdown.stability}</span>
              </div>
            </div>
          </motion.div>

          {/* Card 2: Cash Position */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="bg-white rounded-2xl shadow-xl border border-gray-100 p-6 hover:shadow-2xl transition-all"
          >
            <div className="flex items-center justify-between mb-4">
              <div className="text-sm text-gray-600">Cash Position</div>
              <DollarSign className="w-5 h-5 text-green-500" />
            </div>
            <div className="text-3xl font-bold text-gray-900 mb-2">
              ${(data?.cash.current || 0).toLocaleString()}
            </div>
            <div className="flex items-center text-sm text-green-600 mb-4">
              <TrendingUp className="w-4 h-4 mr-1" />
              +{data?.cash.trend}% vs last week
            </div>
            {/* Mini Sparkline */}
            <ResponsiveContainer width="100%" height={50}>
              <AreaChart data={(data?.cash.history || []).map((val) => ({ value: val }))}>
                <Area type="monotone" dataKey="value" stroke="#10B981" fill="#10B981" fillOpacity={0.2} />
              </AreaChart>
            </ResponsiveContainer>
            <div className="mt-3 text-sm text-gray-600">
              Runway: <span className="font-semibold text-gray-900">{data?.cash.runway} months</span>
              {(data?.cash.runway || 0) < 12 && (
                <span className="ml-2 text-amber-600">⚠️ Low</span>
              )}
            </div>
          </motion.div>

          {/* Card 3: Burn Rate */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="bg-white rounded-2xl shadow-xl border border-gray-100 p-6 hover:shadow-2xl transition-all"
          >
            <div className="flex items-center justify-between mb-4">
              <div className="text-sm text-gray-600">Monthly Burn Rate</div>
              <Activity className="w-5 h-5 text-red-500" />
            </div>
            <div className="text-3xl font-bold text-gray-900 mb-2">
              ${(data?.expenses.monthly || 0).toLocaleString()}/mo
            </div>
            <div className="flex items-center text-sm text-red-600 mb-4">
              <TrendingDown className="w-4 h-4 mr-1" />
              +{data?.expenses.trend}% vs last month
            </div>
            <div className="text-sm text-gray-600">
              Runway: <span className="font-semibold text-gray-900">{data?.cash.runway} months</span>
            </div>
          </motion.div>

          {/* Card 4: ARR */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="bg-white rounded-2xl shadow-xl border border-gray-100 p-6 hover:shadow-2xl transition-all"
          >
            <div className="flex items-center justify-between mb-4">
              <div className="text-sm text-gray-600">Annual Run Rate</div>
              <TrendingUp className="w-5 h-5 text-blue-500" />
            </div>
            <div className="text-3xl font-bold text-gray-900 mb-2">
              ${((data?.revenue.arr || 0) / 1000000).toFixed(1)}M
            </div>
            <div className="flex items-center text-sm text-blue-600 mb-4">
              <TrendingUp className="w-4 h-4 mr-1" />
              +{data?.revenue.growth}% YoY
            </div>
            <ResponsiveContainer width="100%" height={50}>
              <LineChart data={(data?.revenue.history || []).map((val) => ({ value: val }))}>
                <Line type="monotone" dataKey="value" stroke="#3B82F6" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </motion.div>
        </div>

        {/* THREE COLUMN LAYOUT */}
        <div className="grid grid-cols-1 lg:grid-cols-10 gap-6 mb-8">
          {/* LEFT COLUMN (40%) */}
          <div className="lg:col-span-4 space-y-6">
            {/* Key Metrics Card */}
            <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-6">
              <h3 className="text-lg font-bold text-gray-900 mb-4">Key Metrics</h3>
              <div className="space-y-4">
                {[
                  { label: 'Revenue', value: data?.revenue.monthly, trend: 12.5, color: 'blue' },
                  { label: 'Expenses', value: data?.expenses.monthly, trend: 8.2, color: 'red' },
                  { label: 'Net Profit', value: (data?.revenue.monthly || 0) - (data?.expenses.monthly || 0), trend: 25.3, color: 'green' },
                  { label: 'Operating Margin', value: (((data?.revenue.monthly || 0) - (data?.expenses.monthly || 0)) / (data?.revenue.monthly || 1) * 100), trend: 3.2, color: 'purple', isPercentage: true }
                ].map((metric, idx) => (
                  <div key={idx} className="flex items-center justify-between">
                    <div>
                      <div className="text-sm text-gray-600">{metric.label}</div>
                      <div className="text-xl font-bold text-gray-900">
                        {metric.isPercentage ? `${(metric.value || 0).toFixed(1)}%` : `$${(metric.value || 0).toLocaleString()}`}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="text-sm text-green-600 flex items-center">
                        <TrendingUp className="w-3 h-3 mr-1" />
                        {metric.trend}%
                      </div>
                      <ResponsiveContainer width={60} height={30}>
                        <LineChart data={[{v:1},{v:2},{v:1.5},{v:3},{v:2.5},{v:4}]}>
                          <Line type="monotone" dataKey="v" stroke="#3B82F6" strokeWidth={2} dot={false} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* AI Insights Card */}
            <div className="bg-gradient-to-br from-blue-50 to-purple-50 rounded-2xl shadow-xl border border-blue-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-gray-900">Nova AI Insights</h3>
                <div className="px-3 py-1 bg-blue-500 text-white text-xs font-semibold rounded-full">
                  Amazon Nova
                </div>
              </div>
              <div className="space-y-3">
                {data?.insights.map((insight, idx) => (
                  <div key={idx} className="flex items-start gap-3 p-3 bg-white rounded-lg">
                    <span className="text-2xl">{insight.icon}</span>
                    <div className="flex-1">
                      <p className="text-sm text-gray-800">{insight.text}</p>
                      <span className={`text-xs px-2 py-0.5 rounded-full mt-1 inline-block ${
                        insight.severity === 'warning' ? 'bg-amber-100 text-amber-800' :
                        insight.severity === 'critical' ? 'bg-red-100 text-red-800' :
                        'bg-blue-100 text-blue-800'
                      }`}>
                        {insight.severity}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
              <button className="w-full mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition">
                View Full Analysis
              </button>
            </div>
          </div>

          {/* MIDDLE COLUMN (30%) */}
          <div className="lg:col-span-3 space-y-6">
            {/* Quick Actions */}
            <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-6">
              <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
                <Zap className="w-5 h-5 text-yellow-500" />
                Quick Actions
              </h3>
              <div className="space-y-2">
                {[
                  { icon: <BarChart3 className="w-4 h-4" />, text: 'Generate Q1 Forecast' },
                  { icon: <Activity className="w-4 h-4" />, text: 'Run Cash Flow Analysis' },
                  { icon: <Target className="w-4 h-4" />, text: 'Investment Review' },
                  { icon: <AlertCircle className="w-4 h-4" />, text: 'Risk Assessment' },
                  { icon: <CheckCircle className="w-4 h-4" />, text: 'Compliance Check' },
                  { icon: <FileText className="w-4 h-4" />, text: 'Board Report Generator' }
                ].map((action, idx) => (
                  <button key={idx} className="w-full flex items-center gap-3 p-3 bg-gray-50 hover:bg-gray-100 rounded-lg transition text-left">
                    <div className="text-blue-600">{action.icon}</div>
                    <span className="text-sm font-medium text-gray-700">{action.text}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Alerts */}
            <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-6">
              <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
                <Bell className="w-5 h-5 text-red-500" />
                Alerts & Notifications
              </h3>
              <div className="space-y-3">
                {data?.alerts.map((alert, idx) => (
                  <div key={idx} className={`p-3 rounded-lg border-l-4 ${
                    alert.severity === 'critical' ? 'bg-red-50 border-red-500' :
                    alert.severity === 'warning' ? 'bg-yellow-50 border-yellow-500' :
                    'bg-blue-50 border-blue-500'
                  }`}>
                    <div className="flex items-start justify-between mb-1">
                      <span className="text-2xl">{
                        alert.severity === 'critical' ? '🔴' :
                        alert.severity === 'warning' ? '🟡' : '🟢'
                      }</span>
                      <span className="text-xs text-gray-500">{alert.time}</span>
                    </div>
                    <p className="text-sm text-gray-800 mb-2">{alert.message}</p>
                    <button className="text-xs text-blue-600 hover:underline">
                      {alert.action} →
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* RIGHT COLUMN (30%) */}
          <div className="lg:col-span-3 space-y-6">
            {/* Recent Activity */}
            <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-6">
              <h3 className="text-lg font-bold text-gray-900 mb-4">Recent Activity</h3>
              <div className="space-y-3">
                {data?.recentActivity.map((activity, idx) => (
                  <div key={idx} className="flex items-start gap-3 pb-3 border-b border-gray-100 last:border-0">
                    <span className="text-xl">{activity.icon}</span>
                    <div className="flex-1">
                      <p className="text-sm text-gray-800">{activity.action}</p>
                      <p className="text-xs text-gray-500 mt-1">{activity.time}</p>
                    </div>
                  </div>
                ))}
              </div>
              <button className="text-sm text-blue-600 hover:underline mt-3">
                View All Activity →
              </button>
            </div>

            {/* Upcoming Tasks */}
            <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-6">
              <h3 className="text-lg font-bold text-gray-900 mb-4">Upcoming Tasks</h3>
              <div className="space-y-3">
                {[
                  { task: 'Review Q4 financials', due: 'Today', priority: 'high' },
                  { task: 'Approve vendor payments', due: 'Tomorrow', priority: 'medium' },
                  { task: 'Board presentation prep', due: 'Feb 20', priority: 'high' },
                  { task: 'Annual audit kickoff', due: 'Feb 25', priority: 'low' }
                ].map((item, idx) => (
                  <div key={idx} className="flex items-start gap-3">
                    <input type="checkbox" className="mt-1" />
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-800">{item.task}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <Clock className="w-3 h-3 text-gray-400" />
                        <span className="text-xs text-gray-500">{item.due}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          item.priority === 'high' ? 'bg-red-100 text-red-700' :
                          item.priority === 'medium' ? 'bg-yellow-100 text-yellow-700' :
                          'bg-gray-100 text-gray-700'
                        }`}>
                          {item.priority}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* CHARTS SECTION */}
        <div className="space-y-6 mb-8">
          {/* Row 1: 2 Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Revenue vs Expenses */}
            <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-6">
              <h3 className="text-lg font-bold text-gray-900 mb-4">Revenue vs Expenses</h3>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={[
                  { month: 'Jan', revenue: 245000, expenses: 180000 },
                  { month: 'Feb', revenue: 268000, expenses: 195000 },
                  { month: 'Mar', revenue: 291000, expenses: 210000 },
                  { month: 'Apr', revenue: 308000, expenses: 220000 },
                  { month: 'May', revenue: 315000, expenses: 225000 },
                  { month: 'Jun', revenue: 328000, expenses: 234000 }
                ]}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="month" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="revenue" fill="#3B82F6" name="Revenue" />
                  <Bar dataKey="expenses" fill="#EF4444" name="Expenses" />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Cash Flow Trend */}
            <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-6">
              <h3 className="text-lg font-bold text-gray-900 mb-4">Cash Flow Trend (13 Weeks)</h3>
              <ResponsiveContainer width="100%" height={300}>
                <AreaChart data={Array.from({length: 13}, (_, i) => ({
                  week: `W${i+1}`,
                  operating: 30000 + Math.random() * 20000,
                  investing: -10000 - Math.random() * 5000,
                  financing: 5000 + Math.random() * 3000
                }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="week" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Area type="monotone" dataKey="operating" stackId="1" stroke="#10B981" fill="#10B981" fillOpacity={0.6} name="Operating" />
                  <Area type="monotone" dataKey="investing" stackId="1" stroke="#EF4444" fill="#EF4444" fillOpacity={0.6} name="Investing" />
                  <Area type="monotone" dataKey="financing" stackId="1" stroke="#8B5CF6" fill="#8B5CF6" fillOpacity={0.6} name="Financing" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Row 2: 3 Charts */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {/* Expense by Category */}
            <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-6">
              <h3 className="text-lg font-bold text-gray-900 mb-4">Expense by Category</h3>
              <ResponsiveContainer width="100%" height={250}>
                <RechartsPie>
                  <Pie
                    data={data?.expenses.categories}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={80}
                    label
                  >
                    {data?.expenses.categories.map((_, index) => (
                      <Cell key={`cell-${index}`} fill={['#3B82F6', '#10B981', '#F59E0B', '#8B5CF6'][index % 4]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </RechartsPie>
              </ResponsiveContainer>
            </div>

            {/* Department Budget */}
            <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-6">
              <h3 className="text-lg font-bold text-gray-900 mb-4">Budget Utilization</h3>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart
                  data={[
                    { dept: 'Finance', spent: 85, budget: 100 },
                    { dept: 'Marketing', spent: 92, budget: 100 },
                    { dept: 'Sales', spent: 78, budget: 100 },
                    { dept: 'Operations', spent: 105, budget: 100 },
                    { dept: 'IT', spent: 88, budget: 100 }
                  ]}
                  layout="vertical"
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis type="number" />
                  <YAxis dataKey="dept" type="category" />
                  <Tooltip />
                  <Bar dataKey="spent" fill="#3B82F6" name="Spent %" />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Performance Radar */}
            <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-6">
              <h3 className="text-lg font-bold text-gray-900 mb-4">Performance Dimensions</h3>
              <ResponsiveContainer width="100%" height={250}>
                <RadarChart data={[
                  { dimension: 'Revenue', current: 85, target: 90 },
                  { dimension: 'Profit', current: 78, target: 85 },
                  { dimension: 'Cash', current: 92, target: 95 },
                  { dimension: 'Customer', current: 88, target: 90 },
                  { dimension: 'Team', current: 82, target: 85 },
                  { dimension: 'Market', current: 75, target: 80 }
                ]}>
                  <PolarGrid />
                  <PolarAngleAxis dataKey="dimension" />
                  <Radar name="Current" dataKey="current" stroke="#3B82F6" fill="#3B82F6" fillOpacity={0.6} />
                  <Radar name="Target" dataKey="target" stroke="#10B981" fill="#10B981" fillOpacity={0.3} />
                  <Legend />
                </RadarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* BOTTOM SECTION */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Strategic Recommendations */}
          <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-6">
            <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
              🎯 Strategic Recommendations
            </h3>
            <div className="space-y-4">
              {data?.recommendations.map((rec, idx) => (
                <div key={idx} className="p-4 bg-gradient-to-r from-blue-50 to-purple-50 rounded-lg border border-blue-200">
                  <div className="flex items-start justify-between mb-2">
                    <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
                      rec.priority === 'high' ? 'bg-red-100 text-red-800' :
                      rec.priority === 'medium' ? 'bg-yellow-100 text-yellow-800' :
                      'bg-green-100 text-green-800'
                    }`}>
                      {rec.priority.toUpperCase()} PRIORITY
                    </span>
                  </div>
                  <p className="text-sm text-gray-800 mb-2">{rec.text}</p>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-blue-600 font-medium">💡 Impact: {rec.impact}</span>
                    <button className="text-xs text-blue-600 hover:underline">View Details →</button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Financial Ratios */}
          <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-6">
            <h3 className="text-lg font-bold text-gray-900 mb-4">Financial Ratios</h3>
            <div className="grid grid-cols-2 gap-4">
              {[
                { label: 'Current Ratio', value: data?.ratios.currentRatio, tooltip: 'Current Assets / Current Liabilities', target: 2.0 },
                { label: 'Quick Ratio', value: data?.ratios.quickRatio, tooltip: '(Current Assets - Inventory) / Current Liabilities', target: 1.5 },
                { label: 'Debt-to-Equity', value: data?.ratios.debtToEquity, tooltip: 'Total Debt / Total Equity', target: 0.5 },
                { label: 'ROE', value: data?.ratios.roe, tooltip: 'Net Income / Shareholders Equity', target: 15, isPercentage: true },
                { label: 'Operating Margin', value: data?.ratios.operatingMargin, tooltip: 'Operating Income / Revenue', target: 25, isPercentage: true }
              ].map((ratio, idx) => (
                <div key={idx} className="p-4 bg-gray-50 rounded-lg group relative">
                  <div className="text-xs text-gray-600 mb-1">{ratio.label}</div>
                  <div className="text-2xl font-bold text-gray-900">
                    {ratio.isPercentage ? `${ratio.value}%` : ratio.value?.toFixed(1)}
                  </div>
                  <div className="flex items-center text-xs text-green-600 mt-1">
                    <TrendingUp className="w-3 h-3 mr-1" />
                    {ratio.isPercentage 
                      ? `Target: ${ratio.target}%`
                      : `Target: ${ratio.target}`
                    }
                  </div>
                  {/* Tooltip */}
                  <div className="absolute bottom-full left-0 mb-2 px-3 py-2 bg-gray-900 text-white text-xs rounded-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition w-48 z-10">
                    {ratio.tooltip}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* FLOATING CHAT BUTTON */}
      <button
        onClick={() => setShowChatBot(!showChatBot)}
        className="fixed bottom-6 right-6 w-14 h-14 bg-gradient-to-r from-blue-600 to-purple-600 rounded-full shadow-2xl flex items-center justify-center hover:scale-110 transition-transform z-50"
      >
        <MessageSquare className="w-6 h-6 text-white" />
      </button>

      {/* CHAT MODAL (if open) */}
      {showChatBot && (
        <div className="fixed bottom-24 right-6 w-96 h-[500px] bg-white rounded-2xl shadow-2xl border border-gray-200 z-50">
          <div className="p-4 border-b border-gray-200 flex items-center justify-between">
            <div>
              <h3 className="font-bold text-gray-900">Ask CFO AI</h3>
              <p className="text-xs text-gray-600">Powered by Amazon Nova</p>
            </div>
            <button onClick={() => setShowChatBot(false)}>
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="p-4 h-[calc(100%-120px)] overflow-y-auto">
            <p className="text-sm text-gray-500 text-center mt-20">Start a conversation...</p>
          </div>
          <div className="p-4 border-t border-gray-200">
            <input
              type="text"
              placeholder="Ask anything about your financials..."
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
      )}
    </div>
  );
};

// Loading Skeleton Component
const LoadingSkeleton = () => {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-slate-50 p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="h-16 bg-gray-200 rounded-lg animate-pulse"></div>
        <div className="grid grid-cols-4 gap-6">
          {[1,2,3,4].map(i => (
            <div key={i} className="h-40 bg-gray-200 rounded-2xl animate-pulse"></div>
          ))}
        </div>
      </div>
    </div>
  );
};
