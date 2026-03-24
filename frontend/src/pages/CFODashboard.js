import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// CFO Dashboard - Strategic Command Center
import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import axios from 'axios';
import { TrendingUp, TrendingDown, DollarSign, AlertCircle, Download, RefreshCw, ArrowLeft, Target, BarChart3, Activity, Bell, CheckCircle, Zap, FileText, Clock, Settings, MessageSquare, X, Upload } from 'lucide-react';
import { AreaChart, Area, BarChart, Bar, PieChart as RechartsPie, Pie, Cell, RadarChart, Radar, PolarGrid, PolarAngleAxis, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { useNavigate } from 'react-router-dom';
// Mock Data
const mockCFOData = {
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
    const [timeRange, setTimeRange] = useState('month');
    const [loading, setLoading] = useState(false);
    const [data, setData] = useState(mockCFOData);
    const [showChatBot, setShowChatBot] = useState(false);
    useEffect(() => {
        fetchDashboardData();
    }, [timeRange]);
    const fetchDashboardData = async () => {
        setLoading(true);
        try {
            const response = await axios.get(`http://localhost:8000/api/cfo/dashboard?time_range=${timeRange}`);
            setData(response.data);
        }
        catch (error) {
            console.error('Failed to fetch dashboard data:', error);
            // Use mock data as fallback
            setData(mockCFOData);
        }
        finally {
            setLoading(false);
        }
    };
    const handleExport = async (format) => {
        try {
            // Use query parameters instead of request body
            const response = await axios.post(`http://localhost:8000/api/cfo/export?format=${format}&time_range=${timeRange}`, {}, { responseType: 'blob' });
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
        }
        catch (error) {
            console.error('Export failed:', error);
            alert(`Export failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    };
    if (loading && !data) {
        return _jsx(LoadingSkeleton, {});
    }
    return (_jsxs("div", { className: "min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-slate-50 pb-12", children: [_jsx("div", { className: "bg-white border-b border-gray-200 shadow-sm sticky top-0 z-40", children: _jsx("div", { className: "max-w-7xl mx-auto px-6 py-4", children: _jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("div", { className: "flex items-center gap-4", children: [_jsx("button", { onClick: () => navigate('/dashboard'), className: "p-2 hover:bg-gray-100 rounded-lg transition", children: _jsx(ArrowLeft, { className: "w-5 h-5" }) }), _jsxs("div", { children: [_jsx("h1", { className: "text-2xl font-bold text-gray-900", children: "CFO Dashboard - Strategic Command Center" }), _jsx("p", { className: "text-sm text-gray-600", children: "AI-powered insights by Amazon Nova" })] })] }), _jsxs("div", { className: "flex items-center gap-3", children: [_jsx("div", { className: "flex bg-gray-100 rounded-lg p-1", children: ['week', 'month', 'quarter', 'year'].map((range) => (_jsx("button", { onClick: () => setTimeRange(range), className: `px-4 py-1.5 rounded-md text-sm font-medium transition ${timeRange === range
                                                ? 'bg-white text-blue-600 shadow'
                                                : 'text-gray-600 hover:text-gray-900'}`, children: range.charAt(0).toUpperCase() + range.slice(1) }, range))) }), _jsxs("button", { onClick: () => navigate('/dashboard'), className: "flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition", children: [_jsx(Upload, { className: "w-4 h-4" }), _jsx("span", { children: "Go to sections" })] }), _jsxs("div", { className: "relative group", children: [_jsxs("button", { className: "flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50", children: [_jsx(Download, { className: "w-4 h-4" }), _jsx("span", { children: "Export" })] }), _jsxs("div", { className: "absolute right-0 mt-2 w-40 bg-white border border-gray-200 rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition", children: [_jsx("button", { onClick: () => handleExport('pdf'), className: "w-full px-4 py-2 text-left hover:bg-gray-50", children: "PDF Report" }), _jsx("button", { onClick: () => handleExport('excel'), className: "w-full px-4 py-2 text-left hover:bg-gray-50", children: "Excel Data" }), _jsx("button", { onClick: () => handleExport('csv'), className: "w-full px-4 py-2 text-left hover:bg-gray-50", children: "CSV Export" })] })] }), _jsx("button", { onClick: fetchDashboardData, className: "p-2 hover:bg-gray-100 rounded-lg transition", disabled: loading, children: _jsx(RefreshCw, { className: `w-5 h-5 ${loading ? 'animate-spin' : ''}` }) }), _jsx("button", { className: "p-2 hover:bg-gray-100 rounded-lg transition", children: _jsx(Settings, { className: "w-5 h-5" }) })] })] }) }) }), _jsxs("div", { className: "max-w-7xl mx-auto px-6 py-8", children: [_jsxs("div", { className: "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8", children: [_jsxs(motion.div, { initial: { opacity: 0, y: 20 }, animate: { opacity: 1, y: 0 }, transition: { delay: 0.1 }, className: "bg-white rounded-2xl shadow-xl border border-gray-100 p-6 hover:shadow-2xl transition-all", children: [_jsxs("div", { className: "flex items-center justify-between mb-4", children: [_jsx("div", { className: "text-sm text-gray-600", children: "Financial Health" }), _jsx(Target, { className: "w-5 h-5 text-blue-500" })] }), _jsxs("div", { className: "flex items-center gap-4", children: [_jsxs("div", { className: "relative w-20 h-20", children: [_jsxs("svg", { className: "transform -rotate-90 w-20 h-20", children: [_jsx("circle", { cx: "40", cy: "40", r: "36", stroke: "#E5E7EB", strokeWidth: "8", fill: "none" }), _jsx("circle", { cx: "40", cy: "40", r: "36", stroke: (data?.healthScore.overall || 0) >= 80 ? '#10B981' :
                                                                    (data?.healthScore.overall || 0) >= 60 ? '#F59E0B' : '#EF4444', strokeWidth: "8", fill: "none", strokeDasharray: `${(data?.healthScore.overall || 0) * 2.26} 226`, strokeLinecap: "round" })] }), _jsx("div", { className: "absolute inset-0 flex items-center justify-center", children: _jsx("span", { className: "text-xl font-bold", children: data?.healthScore.overall }) })] }), _jsxs("div", { children: [_jsxs("div", { className: "text-3xl font-bold text-gray-900", children: [data?.healthScore.overall, "/100"] }), _jsxs("div", { className: "flex items-center text-sm text-green-600 mt-1", children: [_jsx(TrendingUp, { className: "w-4 h-4 mr-1" }), "+", data?.healthScore.trend, "% vs last month"] })] })] }), _jsxs("div", { className: "mt-4 pt-4 border-t border-gray-100 grid grid-cols-2 gap-2 text-xs", children: [_jsxs("div", { children: [_jsx("span", { className: "text-gray-500", children: "Liquidity:" }), _jsx("span", { className: "ml-1 font-semibold", children: data?.healthScore.breakdown.liquidity })] }), _jsxs("div", { children: [_jsx("span", { className: "text-gray-500", children: "Profit:" }), _jsx("span", { className: "ml-1 font-semibold", children: data?.healthScore.breakdown.profitability })] }), _jsxs("div", { children: [_jsx("span", { className: "text-gray-500", children: "Efficiency:" }), _jsx("span", { className: "ml-1 font-semibold", children: data?.healthScore.breakdown.efficiency })] }), _jsxs("div", { children: [_jsx("span", { className: "text-gray-500", children: "Stability:" }), _jsx("span", { className: "ml-1 font-semibold", children: data?.healthScore.breakdown.stability })] })] })] }), _jsxs(motion.div, { initial: { opacity: 0, y: 20 }, animate: { opacity: 1, y: 0 }, transition: { delay: 0.2 }, className: "bg-white rounded-2xl shadow-xl border border-gray-100 p-6 hover:shadow-2xl transition-all", children: [_jsxs("div", { className: "flex items-center justify-between mb-4", children: [_jsx("div", { className: "text-sm text-gray-600", children: "Cash Position" }), _jsx(DollarSign, { className: "w-5 h-5 text-green-500" })] }), _jsxs("div", { className: "text-3xl font-bold text-gray-900 mb-2", children: ["$", (data?.cash.current || 0).toLocaleString()] }), _jsxs("div", { className: "flex items-center text-sm text-green-600 mb-4", children: [_jsx(TrendingUp, { className: "w-4 h-4 mr-1" }), "+", data?.cash.trend, "% vs last week"] }), _jsx(ResponsiveContainer, { width: "100%", height: 50, children: _jsx(AreaChart, { data: (data?.cash.history || []).map((val) => ({ value: val })), children: _jsx(Area, { type: "monotone", dataKey: "value", stroke: "#10B981", fill: "#10B981", fillOpacity: 0.2 }) }) }), _jsxs("div", { className: "mt-3 text-sm text-gray-600", children: ["Runway: ", _jsxs("span", { className: "font-semibold text-gray-900", children: [data?.cash.runway, " months"] }), (data?.cash.runway || 0) < 12 && (_jsx("span", { className: "ml-2 text-amber-600", children: "\u26A0\uFE0F Low" }))] })] }), _jsxs(motion.div, { initial: { opacity: 0, y: 20 }, animate: { opacity: 1, y: 0 }, transition: { delay: 0.3 }, className: "bg-white rounded-2xl shadow-xl border border-gray-100 p-6 hover:shadow-2xl transition-all", children: [_jsxs("div", { className: "flex items-center justify-between mb-4", children: [_jsx("div", { className: "text-sm text-gray-600", children: "Monthly Burn Rate" }), _jsx(Activity, { className: "w-5 h-5 text-red-500" })] }), _jsxs("div", { className: "text-3xl font-bold text-gray-900 mb-2", children: ["$", (data?.expenses.monthly || 0).toLocaleString(), "/mo"] }), _jsxs("div", { className: "flex items-center text-sm text-red-600 mb-4", children: [_jsx(TrendingDown, { className: "w-4 h-4 mr-1" }), "+", data?.expenses.trend, "% vs last month"] }), _jsxs("div", { className: "text-sm text-gray-600", children: ["Runway: ", _jsxs("span", { className: "font-semibold text-gray-900", children: [data?.cash.runway, " months"] })] })] }), _jsxs(motion.div, { initial: { opacity: 0, y: 20 }, animate: { opacity: 1, y: 0 }, transition: { delay: 0.4 }, className: "bg-white rounded-2xl shadow-xl border border-gray-100 p-6 hover:shadow-2xl transition-all", children: [_jsxs("div", { className: "flex items-center justify-between mb-4", children: [_jsx("div", { className: "text-sm text-gray-600", children: "Annual Run Rate" }), _jsx(TrendingUp, { className: "w-5 h-5 text-blue-500" })] }), _jsxs("div", { className: "text-3xl font-bold text-gray-900 mb-2", children: ["$", ((data?.revenue.arr || 0) / 1000000).toFixed(1), "M"] }), _jsxs("div", { className: "flex items-center text-sm text-blue-600 mb-4", children: [_jsx(TrendingUp, { className: "w-4 h-4 mr-1" }), "+", data?.revenue.growth, "% YoY"] }), _jsx(ResponsiveContainer, { width: "100%", height: 50, children: _jsx(LineChart, { data: (data?.revenue.history || []).map((val) => ({ value: val })), children: _jsx(Line, { type: "monotone", dataKey: "value", stroke: "#3B82F6", strokeWidth: 2, dot: false }) }) })] })] }), _jsxs("div", { className: "grid grid-cols-1 lg:grid-cols-10 gap-6 mb-8", children: [_jsxs("div", { className: "lg:col-span-4 space-y-6", children: [_jsxs("div", { className: "bg-white rounded-2xl shadow-xl border border-gray-100 p-6", children: [_jsx("h3", { className: "text-lg font-bold text-gray-900 mb-4", children: "Key Metrics" }), _jsx("div", { className: "space-y-4", children: [
                                                    { label: 'Revenue', value: data?.revenue.monthly, trend: 12.5, color: 'blue' },
                                                    { label: 'Expenses', value: data?.expenses.monthly, trend: 8.2, color: 'red' },
                                                    { label: 'Net Profit', value: (data?.revenue.monthly || 0) - (data?.expenses.monthly || 0), trend: 25.3, color: 'green' },
                                                    { label: 'Operating Margin', value: (((data?.revenue.monthly || 0) - (data?.expenses.monthly || 0)) / (data?.revenue.monthly || 1) * 100), trend: 3.2, color: 'purple', isPercentage: true }
                                                ].map((metric, idx) => (_jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("div", { children: [_jsx("div", { className: "text-sm text-gray-600", children: metric.label }), _jsx("div", { className: "text-xl font-bold text-gray-900", children: metric.isPercentage ? `${(metric.value || 0).toFixed(1)}%` : `$${(metric.value || 0).toLocaleString()}` })] }), _jsxs("div", { className: "flex items-center gap-2", children: [_jsxs("div", { className: "text-sm text-green-600 flex items-center", children: [_jsx(TrendingUp, { className: "w-3 h-3 mr-1" }), metric.trend, "%"] }), _jsx(ResponsiveContainer, { width: 60, height: 30, children: _jsx(LineChart, { data: [{ v: 1 }, { v: 2 }, { v: 1.5 }, { v: 3 }, { v: 2.5 }, { v: 4 }], children: _jsx(Line, { type: "monotone", dataKey: "v", stroke: "#3B82F6", strokeWidth: 2, dot: false }) }) })] })] }, idx))) })] }), _jsxs("div", { className: "bg-gradient-to-br from-blue-50 to-purple-50 rounded-2xl shadow-xl border border-blue-200 p-6", children: [_jsxs("div", { className: "flex items-center justify-between mb-4", children: [_jsx("h3", { className: "text-lg font-bold text-gray-900", children: "Nova AI Insights" }), _jsx("div", { className: "px-3 py-1 bg-blue-500 text-white text-xs font-semibold rounded-full", children: "Amazon Nova" })] }), _jsx("div", { className: "space-y-3", children: data?.insights.map((insight, idx) => (_jsxs("div", { className: "flex items-start gap-3 p-3 bg-white rounded-lg", children: [_jsx("span", { className: "text-2xl", children: insight.icon }), _jsxs("div", { className: "flex-1", children: [_jsx("p", { className: "text-sm text-gray-800", children: insight.text }), _jsx("span", { className: `text-xs px-2 py-0.5 rounded-full mt-1 inline-block ${insight.severity === 'warning' ? 'bg-amber-100 text-amber-800' :
                                                                        insight.severity === 'critical' ? 'bg-red-100 text-red-800' :
                                                                            'bg-blue-100 text-blue-800'}`, children: insight.severity })] })] }, idx))) }), _jsx("button", { className: "w-full mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition", children: "View Full Analysis" })] })] }), _jsxs("div", { className: "lg:col-span-3 space-y-6", children: [_jsxs("div", { className: "bg-white rounded-2xl shadow-xl border border-gray-100 p-6", children: [_jsxs("h3", { className: "text-lg font-bold text-gray-900 mb-4 flex items-center gap-2", children: [_jsx(Zap, { className: "w-5 h-5 text-yellow-500" }), "Quick Actions"] }), _jsx("div", { className: "space-y-2", children: [
                                                    { icon: _jsx(BarChart3, { className: "w-4 h-4" }), text: 'Generate Q1 Forecast' },
                                                    { icon: _jsx(Activity, { className: "w-4 h-4" }), text: 'Run Cash Flow Analysis' },
                                                    { icon: _jsx(Target, { className: "w-4 h-4" }), text: 'Investment Review' },
                                                    { icon: _jsx(AlertCircle, { className: "w-4 h-4" }), text: 'Risk Assessment' },
                                                    { icon: _jsx(CheckCircle, { className: "w-4 h-4" }), text: 'Compliance Check' },
                                                    { icon: _jsx(FileText, { className: "w-4 h-4" }), text: 'Board Report Generator' }
                                                ].map((action, idx) => (_jsxs("button", { className: "w-full flex items-center gap-3 p-3 bg-gray-50 hover:bg-gray-100 rounded-lg transition text-left", children: [_jsx("div", { className: "text-blue-600", children: action.icon }), _jsx("span", { className: "text-sm font-medium text-gray-700", children: action.text })] }, idx))) })] }), _jsxs("div", { className: "bg-white rounded-2xl shadow-xl border border-gray-100 p-6", children: [_jsxs("h3", { className: "text-lg font-bold text-gray-900 mb-4 flex items-center gap-2", children: [_jsx(Bell, { className: "w-5 h-5 text-red-500" }), "Alerts & Notifications"] }), _jsx("div", { className: "space-y-3", children: data?.alerts.map((alert, idx) => (_jsxs("div", { className: `p-3 rounded-lg border-l-4 ${alert.severity === 'critical' ? 'bg-red-50 border-red-500' :
                                                        alert.severity === 'warning' ? 'bg-yellow-50 border-yellow-500' :
                                                            'bg-blue-50 border-blue-500'}`, children: [_jsxs("div", { className: "flex items-start justify-between mb-1", children: [_jsx("span", { className: "text-2xl", children: alert.severity === 'critical' ? '🔴' :
                                                                        alert.severity === 'warning' ? '🟡' : '🟢' }), _jsx("span", { className: "text-xs text-gray-500", children: alert.time })] }), _jsx("p", { className: "text-sm text-gray-800 mb-2", children: alert.message }), _jsxs("button", { className: "text-xs text-blue-600 hover:underline", children: [alert.action, " \u2192"] })] }, idx))) })] })] }), _jsxs("div", { className: "lg:col-span-3 space-y-6", children: [_jsxs("div", { className: "bg-white rounded-2xl shadow-xl border border-gray-100 p-6", children: [_jsx("h3", { className: "text-lg font-bold text-gray-900 mb-4", children: "Recent Activity" }), _jsx("div", { className: "space-y-3", children: data?.recentActivity.map((activity, idx) => (_jsxs("div", { className: "flex items-start gap-3 pb-3 border-b border-gray-100 last:border-0", children: [_jsx("span", { className: "text-xl", children: activity.icon }), _jsxs("div", { className: "flex-1", children: [_jsx("p", { className: "text-sm text-gray-800", children: activity.action }), _jsx("p", { className: "text-xs text-gray-500 mt-1", children: activity.time })] })] }, idx))) }), _jsx("button", { className: "text-sm text-blue-600 hover:underline mt-3", children: "View All Activity \u2192" })] }), _jsxs("div", { className: "bg-white rounded-2xl shadow-xl border border-gray-100 p-6", children: [_jsx("h3", { className: "text-lg font-bold text-gray-900 mb-4", children: "Upcoming Tasks" }), _jsx("div", { className: "space-y-3", children: [
                                                    { task: 'Review Q4 financials', due: 'Today', priority: 'high' },
                                                    { task: 'Approve vendor payments', due: 'Tomorrow', priority: 'medium' },
                                                    { task: 'Board presentation prep', due: 'Feb 20', priority: 'high' },
                                                    { task: 'Annual audit kickoff', due: 'Feb 25', priority: 'low' }
                                                ].map((item, idx) => (_jsxs("div", { className: "flex items-start gap-3", children: [_jsx("input", { type: "checkbox", className: "mt-1" }), _jsxs("div", { className: "flex-1", children: [_jsx("p", { className: "text-sm font-medium text-gray-800", children: item.task }), _jsxs("div", { className: "flex items-center gap-2 mt-1", children: [_jsx(Clock, { className: "w-3 h-3 text-gray-400" }), _jsx("span", { className: "text-xs text-gray-500", children: item.due }), _jsx("span", { className: `text-xs px-2 py-0.5 rounded-full ${item.priority === 'high' ? 'bg-red-100 text-red-700' :
                                                                                item.priority === 'medium' ? 'bg-yellow-100 text-yellow-700' :
                                                                                    'bg-gray-100 text-gray-700'}`, children: item.priority })] })] })] }, idx))) })] })] })] }), _jsxs("div", { className: "space-y-6 mb-8", children: [_jsxs("div", { className: "grid grid-cols-1 lg:grid-cols-2 gap-6", children: [_jsxs("div", { className: "bg-white rounded-2xl shadow-xl border border-gray-100 p-6", children: [_jsx("h3", { className: "text-lg font-bold text-gray-900 mb-4", children: "Revenue vs Expenses" }), _jsx(ResponsiveContainer, { width: "100%", height: 300, children: _jsxs(BarChart, { data: [
                                                        { month: 'Jan', revenue: 245000, expenses: 180000 },
                                                        { month: 'Feb', revenue: 268000, expenses: 195000 },
                                                        { month: 'Mar', revenue: 291000, expenses: 210000 },
                                                        { month: 'Apr', revenue: 308000, expenses: 220000 },
                                                        { month: 'May', revenue: 315000, expenses: 225000 },
                                                        { month: 'Jun', revenue: 328000, expenses: 234000 }
                                                    ], children: [_jsx(CartesianGrid, { strokeDasharray: "3 3", stroke: "#f0f0f0" }), _jsx(XAxis, { dataKey: "month" }), _jsx(YAxis, {}), _jsx(Tooltip, {}), _jsx(Legend, {}), _jsx(Bar, { dataKey: "revenue", fill: "#3B82F6", name: "Revenue" }), _jsx(Bar, { dataKey: "expenses", fill: "#EF4444", name: "Expenses" })] }) })] }), _jsxs("div", { className: "bg-white rounded-2xl shadow-xl border border-gray-100 p-6", children: [_jsx("h3", { className: "text-lg font-bold text-gray-900 mb-4", children: "Cash Flow Trend (13 Weeks)" }), _jsx(ResponsiveContainer, { width: "100%", height: 300, children: _jsxs(AreaChart, { data: Array.from({ length: 13 }, (_, i) => ({
                                                        week: `W${i + 1}`,
                                                        operating: 30000 + Math.random() * 20000,
                                                        investing: -10000 - Math.random() * 5000,
                                                        financing: 5000 + Math.random() * 3000
                                                    })), children: [_jsx(CartesianGrid, { strokeDasharray: "3 3", stroke: "#f0f0f0" }), _jsx(XAxis, { dataKey: "week" }), _jsx(YAxis, {}), _jsx(Tooltip, {}), _jsx(Legend, {}), _jsx(Area, { type: "monotone", dataKey: "operating", stackId: "1", stroke: "#10B981", fill: "#10B981", fillOpacity: 0.6, name: "Operating" }), _jsx(Area, { type: "monotone", dataKey: "investing", stackId: "1", stroke: "#EF4444", fill: "#EF4444", fillOpacity: 0.6, name: "Investing" }), _jsx(Area, { type: "monotone", dataKey: "financing", stackId: "1", stroke: "#8B5CF6", fill: "#8B5CF6", fillOpacity: 0.6, name: "Financing" })] }) })] })] }), _jsxs("div", { className: "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6", children: [_jsxs("div", { className: "bg-white rounded-2xl shadow-xl border border-gray-100 p-6", children: [_jsx("h3", { className: "text-lg font-bold text-gray-900 mb-4", children: "Expense by Category" }), _jsx(ResponsiveContainer, { width: "100%", height: 250, children: _jsxs(RechartsPie, { children: [_jsx(Pie, { data: data?.expenses.categories, dataKey: "value", nameKey: "name", cx: "50%", cy: "50%", innerRadius: 60, outerRadius: 80, label: true, children: data?.expenses.categories.map((_, index) => (_jsx(Cell, { fill: ['#3B82F6', '#10B981', '#F59E0B', '#8B5CF6'][index % 4] }, `cell-${index}`))) }), _jsx(Tooltip, {})] }) })] }), _jsxs("div", { className: "bg-white rounded-2xl shadow-xl border border-gray-100 p-6", children: [_jsx("h3", { className: "text-lg font-bold text-gray-900 mb-4", children: "Budget Utilization" }), _jsx(ResponsiveContainer, { width: "100%", height: 250, children: _jsxs(BarChart, { data: [
                                                        { dept: 'Finance', spent: 85, budget: 100 },
                                                        { dept: 'Marketing', spent: 92, budget: 100 },
                                                        { dept: 'Sales', spent: 78, budget: 100 },
                                                        { dept: 'Operations', spent: 105, budget: 100 },
                                                        { dept: 'IT', spent: 88, budget: 100 }
                                                    ], layout: "vertical", children: [_jsx(CartesianGrid, { strokeDasharray: "3 3", stroke: "#f0f0f0" }), _jsx(XAxis, { type: "number" }), _jsx(YAxis, { dataKey: "dept", type: "category" }), _jsx(Tooltip, {}), _jsx(Bar, { dataKey: "spent", fill: "#3B82F6", name: "Spent %" })] }) })] }), _jsxs("div", { className: "bg-white rounded-2xl shadow-xl border border-gray-100 p-6", children: [_jsx("h3", { className: "text-lg font-bold text-gray-900 mb-4", children: "Performance Dimensions" }), _jsx(ResponsiveContainer, { width: "100%", height: 250, children: _jsxs(RadarChart, { data: [
                                                        { dimension: 'Revenue', current: 85, target: 90 },
                                                        { dimension: 'Profit', current: 78, target: 85 },
                                                        { dimension: 'Cash', current: 92, target: 95 },
                                                        { dimension: 'Customer', current: 88, target: 90 },
                                                        { dimension: 'Team', current: 82, target: 85 },
                                                        { dimension: 'Market', current: 75, target: 80 }
                                                    ], children: [_jsx(PolarGrid, {}), _jsx(PolarAngleAxis, { dataKey: "dimension" }), _jsx(Radar, { name: "Current", dataKey: "current", stroke: "#3B82F6", fill: "#3B82F6", fillOpacity: 0.6 }), _jsx(Radar, { name: "Target", dataKey: "target", stroke: "#10B981", fill: "#10B981", fillOpacity: 0.3 }), _jsx(Legend, {})] }) })] })] })] }), _jsxs("div", { className: "grid grid-cols-1 lg:grid-cols-2 gap-6", children: [_jsxs("div", { className: "bg-white rounded-2xl shadow-xl border border-gray-100 p-6", children: [_jsx("h3", { className: "text-lg font-bold text-gray-900 mb-4 flex items-center gap-2", children: "\uD83C\uDFAF Strategic Recommendations" }), _jsx("div", { className: "space-y-4", children: data?.recommendations.map((rec, idx) => (_jsxs("div", { className: "p-4 bg-gradient-to-r from-blue-50 to-purple-50 rounded-lg border border-blue-200", children: [_jsx("div", { className: "flex items-start justify-between mb-2", children: _jsxs("span", { className: `px-3 py-1 rounded-full text-xs font-semibold ${rec.priority === 'high' ? 'bg-red-100 text-red-800' :
                                                            rec.priority === 'medium' ? 'bg-yellow-100 text-yellow-800' :
                                                                'bg-green-100 text-green-800'}`, children: [rec.priority.toUpperCase(), " PRIORITY"] }) }), _jsx("p", { className: "text-sm text-gray-800 mb-2", children: rec.text }), _jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("span", { className: "text-xs text-blue-600 font-medium", children: ["\uD83D\uDCA1 Impact: ", rec.impact] }), _jsx("button", { className: "text-xs text-blue-600 hover:underline", children: "View Details \u2192" })] })] }, idx))) })] }), _jsxs("div", { className: "bg-white rounded-2xl shadow-xl border border-gray-100 p-6", children: [_jsx("h3", { className: "text-lg font-bold text-gray-900 mb-4", children: "Financial Ratios" }), _jsx("div", { className: "grid grid-cols-2 gap-4", children: [
                                            { label: 'Current Ratio', value: data?.ratios.currentRatio, tooltip: 'Current Assets / Current Liabilities', target: 2.0 },
                                            { label: 'Quick Ratio', value: data?.ratios.quickRatio, tooltip: '(Current Assets - Inventory) / Current Liabilities', target: 1.5 },
                                            { label: 'Debt-to-Equity', value: data?.ratios.debtToEquity, tooltip: 'Total Debt / Total Equity', target: 0.5 },
                                            { label: 'ROE', value: data?.ratios.roe, tooltip: 'Net Income / Shareholders Equity', target: 15, isPercentage: true },
                                            { label: 'Operating Margin', value: data?.ratios.operatingMargin, tooltip: 'Operating Income / Revenue', target: 25, isPercentage: true }
                                        ].map((ratio, idx) => (_jsxs("div", { className: "p-4 bg-gray-50 rounded-lg group relative", children: [_jsx("div", { className: "text-xs text-gray-600 mb-1", children: ratio.label }), _jsx("div", { className: "text-2xl font-bold text-gray-900", children: ratio.isPercentage ? `${ratio.value}%` : ratio.value?.toFixed(1) }), _jsxs("div", { className: "flex items-center text-xs text-green-600 mt-1", children: [_jsx(TrendingUp, { className: "w-3 h-3 mr-1" }), ratio.isPercentage
                                                            ? `Target: ${ratio.target}%`
                                                            : `Target: ${ratio.target}`] }), _jsx("div", { className: "absolute bottom-full left-0 mb-2 px-3 py-2 bg-gray-900 text-white text-xs rounded-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition w-48 z-10", children: ratio.tooltip })] }, idx))) })] })] })] }), _jsx("button", { onClick: () => setShowChatBot(!showChatBot), className: "fixed bottom-6 right-6 w-14 h-14 bg-gradient-to-r from-blue-600 to-purple-600 rounded-full shadow-2xl flex items-center justify-center hover:scale-110 transition-transform z-50", children: _jsx(MessageSquare, { className: "w-6 h-6 text-white" }) }), showChatBot && (_jsxs("div", { className: "fixed bottom-24 right-6 w-96 h-[500px] bg-white rounded-2xl shadow-2xl border border-gray-200 z-50", children: [_jsxs("div", { className: "p-4 border-b border-gray-200 flex items-center justify-between", children: [_jsxs("div", { children: [_jsx("h3", { className: "font-bold text-gray-900", children: "Ask CFO AI" }), _jsx("p", { className: "text-xs text-gray-600", children: "Powered by Amazon Nova" })] }), _jsx("button", { onClick: () => setShowChatBot(false), children: _jsx(X, { className: "w-5 h-5" }) })] }), _jsx("div", { className: "p-4 h-[calc(100%-120px)] overflow-y-auto", children: _jsx("p", { className: "text-sm text-gray-500 text-center mt-20", children: "Start a conversation..." }) }), _jsx("div", { className: "p-4 border-t border-gray-200", children: _jsx("input", { type: "text", placeholder: "Ask anything about your financials...", className: "w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" }) })] }))] }));
};
// Loading Skeleton Component
const LoadingSkeleton = () => {
    return (_jsx("div", { className: "min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-slate-50 p-8", children: _jsxs("div", { className: "max-w-7xl mx-auto space-y-6", children: [_jsx("div", { className: "h-16 bg-gray-200 rounded-lg animate-pulse" }), _jsx("div", { className: "grid grid-cols-4 gap-6", children: [1, 2, 3, 4].map(i => (_jsx("div", { className: "h-40 bg-gray-200 rounded-2xl animate-pulse" }, i))) })] }) }));
};
