import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// FP&A Suite - Landing Page with Sub-Module Cards
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useState } from 'react';
import { BarChart3, TrendingUp, Target, Layers, Activity, FileText, ArrowLeft, CheckCircle, Clock, Upload, Brain } from 'lucide-react';
import { MultiUploadModal } from '../../components/fpa/MultiUploadModal';
export const FPASuite = () => {
    const navigate = useNavigate();
    const [showUploadModal, setShowUploadModal] = useState(false);
    const modules = [
        {
            id: 'variance',
            title: 'Variance Analysis',
            description: 'Budget vs Actual performance with AI-powered commentary',
            icon: BarChart3,
            route: '/fpa/variance',
            available: true,
            color: 'from-blue-500 to-blue-600',
            bgColor: 'bg-blue-50',
            iconColor: 'text-blue-600'
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
        }
    ];
    const handleModuleClick = (module) => {
        if (module.available) {
            navigate(module.route);
        }
    };
    return (_jsxs("div", { className: "min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-slate-50", children: [_jsx(MultiUploadModal, { isOpen: showUploadModal, onClose: () => setShowUploadModal(false) }), _jsx("div", { className: "bg-white border-b border-gray-200 shadow-sm", children: _jsxs("div", { className: "max-w-7xl mx-auto px-6 py-6", children: [_jsxs("div", { className: "flex items-center justify-between mb-4", children: [_jsxs("div", { className: "flex items-center gap-4", children: [_jsx("button", { onClick: () => navigate('/dashboard'), className: "p-2 hover:bg-gray-100 rounded-lg transition", children: _jsx(ArrowLeft, { className: "w-5 h-5 text-gray-600" }) }), _jsxs("div", { children: [_jsx("h1", { className: "text-3xl font-bold text-gray-900", children: "FP&A Suite" }), _jsx("p", { className: "text-gray-600 mt-1", children: "Financial Planning & Analysis Tools" })] })] }), _jsxs("button", { onClick: () => setShowUploadModal(true), className: "flex items-center gap-2 px-4 py-2 rounded-lg transition-colors shadow-sm bg-blue-600 text-white hover:bg-blue-700", children: [_jsx(Upload, { className: "w-4 h-4" }), _jsx("span", { children: "Upload Data" })] })] }), _jsx("div", { className: "bg-gradient-to-r from-blue-50 to-purple-50 border border-blue-200 rounded-lg p-4 mt-4", children: _jsxs("p", { className: "text-sm text-blue-900", children: [_jsx("strong", { children: "\uD83D\uDCA1 Upload Once, Use Everywhere:" }), " Upload your trial balance here and all 7 modules below will automatically use your real data."] }) }), _jsxs("div", { className: "flex items-center gap-6 text-sm mt-4", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx(CheckCircle, { className: "w-4 h-4 text-green-600" }), _jsxs("span", { className: "text-gray-700", children: [_jsx("span", { className: "font-semibold", children: "7" }), " modules active"] })] }), _jsxs("div", { className: "flex items-center gap-2", children: [_jsx(Clock, { className: "w-4 h-4 text-gray-400" }), _jsxs("span", { className: "text-gray-700", children: [_jsx("span", { className: "font-semibold", children: "FP&A Suite Complete!" }), " \uD83C\uDF89"] })] })] })] }) }), _jsxs("div", { className: "max-w-7xl mx-auto px-6 py-8", children: [_jsx("div", { className: "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6", children: modules.map((module, index) => {
                            const Icon = module.icon;
                            return (_jsxs(motion.div, { initial: { opacity: 0, y: 20 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.4, delay: index * 0.1 }, onClick: () => handleModuleClick(module), className: `relative group ${module.available
                                    ? 'cursor-pointer hover:shadow-xl hover:scale-105'
                                    : 'cursor-not-allowed opacity-75'} transition-all duration-300`, children: [_jsxs("div", { className: "bg-white rounded-xl border-2 border-gray-200 overflow-hidden h-full", children: [_jsx("div", { className: `h-2 bg-gradient-to-r ${module.color}` }), _jsxs("div", { className: "p-6", children: [_jsxs("div", { className: "flex items-start justify-between mb-4", children: [_jsx("div", { className: `p-3 rounded-lg ${module.bgColor}`, children: _jsx(Icon, { className: `w-8 h-8 ${module.iconColor}` }) }), module.available ? (_jsxs("div", { className: "flex flex-col items-end gap-1", children: [_jsx("span", { className: "px-3 py-1 bg-green-100 text-green-700 text-xs font-semibold rounded-full", children: "\u2713 Active" }), module.badge && (_jsx("span", { className: "px-2 py-0.5 bg-amber-100 text-amber-700 text-xs font-bold rounded-full", children: module.badge }))] })) : (_jsx("span", { className: "px-3 py-1 bg-amber-100 text-amber-700 text-xs font-semibold rounded-full", children: "Coming Soon" }))] }), _jsx("h3", { className: "text-xl font-bold text-gray-900 mb-2", children: module.title }), _jsx("p", { className: "text-sm text-gray-600 leading-relaxed", children: module.description }), module.available && (_jsx("div", { className: "mt-6 pt-4 border-t border-gray-100", children: _jsxs("div", { className: "flex items-center justify-between", children: [_jsx("span", { className: "text-sm font-medium text-blue-600 group-hover:text-blue-700", children: "Open Module \u2192" }), _jsx("div", { className: "w-8 h-8 rounded-full bg-blue-100 group-hover:bg-blue-200 transition flex items-center justify-center", children: _jsx(ArrowLeft, { className: "w-4 h-4 text-blue-600 transform rotate-180" }) })] }) })), !module.available && (_jsx("div", { className: "mt-6 pt-4 border-t border-gray-100", children: _jsx("div", { className: "text-xs text-gray-500 italic", children: "Module under development" }) }))] })] }), module.available && (_jsx("div", { className: "absolute inset-0 bg-gradient-to-br from-blue-500/5 to-blue-600/5 opacity-0 group-hover:opacity-100 transition-opacity duration-300 rounded-xl pointer-events-none" }))] }, module.id));
                        }) }), _jsx("div", { className: "mt-12 bg-white rounded-xl border border-gray-200 p-6", children: _jsxs("div", { className: "flex items-start gap-4", children: [_jsx("div", { className: "p-3 bg-blue-100 rounded-lg", children: _jsx(Activity, { className: "w-6 h-6 text-blue-600" }) }), _jsxs("div", { children: [_jsx("h3", { className: "font-bold text-gray-900 mb-2", children: "About FP&A Suite" }), _jsxs("p", { className: "text-sm text-gray-600 leading-relaxed", children: ["The FP&A Suite is your comprehensive financial planning and analysis toolkit. Active modules: ", _jsx("span", { className: "font-semibold", children: "Variance Analysis" }), " (budget vs actual),", _jsx("span", { className: "font-semibold", children: " Budget Management" }), " (annual planning),", _jsx("span", { className: "font-semibold", children: " KPI Dashboard" }), " (CFO morning view),", _jsx("span", { className: "font-semibold", children: " Forecasting Engine" }), " (revenue/expense/cash), and", _jsx("span", { className: "font-semibold", children: " Scenario Planning" }), " (what-if analysis). Management reporting coming soon."] })] })] }) })] })] }));
};
