import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { TrendingUp, Minus, ArrowUp, ArrowDown, DollarSign, Percent, Users, Repeat, Wallet, PieChart, Zap, Scale, Clock, Calendar, Package, RefreshCw, Activity } from 'lucide-react';
import { LineChart, Line, ResponsiveContainer } from 'recharts';
const iconMap = {
    TrendingUp: _jsx(TrendingUp, { size: 24 }),
    DollarSign: _jsx(DollarSign, { size: 24 }),
    Percent: _jsx(Percent, { size: 24 }),
    Users: _jsx(Users, { size: 24 }),
    Repeat: _jsx(Repeat, { size: 24 }),
    Wallet: _jsx(Wallet, { size: 24 }),
    PieChart: _jsx(PieChart, { size: 24 }),
    Zap: _jsx(Zap, { size: 24 }),
    Scale: _jsx(Scale, { size: 24 }),
    Clock: _jsx(Clock, { size: 24 }),
    Calendar: _jsx(Calendar, { size: 24 }),
    Package: _jsx(Package, { size: 24 }),
    RefreshCw: _jsx(RefreshCw, { size: 24 }),
    Activity: _jsx(Activity, { size: 24 })
};
const KPICard = ({ kpi, delay = 0 }) => {
    const [displayValue, setDisplayValue] = useState(0);
    // Animated number count-up effect
    useEffect(() => {
        const duration = 1000;
        const steps = 60;
        const increment = kpi.value / steps;
        let current = 0;
        const timer = setInterval(() => {
            current += increment;
            if (current >= kpi.value) {
                setDisplayValue(kpi.value);
                clearInterval(timer);
            }
            else {
                setDisplayValue(current);
            }
        }, duration / steps);
        return () => clearInterval(timer);
    }, [kpi.value]);
    const getStatusColor = () => {
        switch (kpi.status) {
            case 'excellent':
                return 'from-emerald-500 to-emerald-600';
            case 'good':
                return 'from-blue-500 to-blue-600';
            case 'warning':
                return 'from-amber-500 to-amber-600';
            case 'critical':
                return 'from-red-500 to-red-600';
            default:
                return 'from-gray-500 to-gray-600';
        }
    };
    const getStatusBg = () => {
        switch (kpi.status) {
            case 'excellent':
                return 'bg-emerald-50';
            case 'good':
                return 'bg-blue-50';
            case 'warning':
                return 'bg-amber-50';
            case 'critical':
                return 'bg-red-50';
            default:
                return 'bg-gray-50';
        }
    };
    const getStatusTextColor = () => {
        switch (kpi.status) {
            case 'excellent':
                return 'text-emerald-700';
            case 'good':
                return 'text-blue-700';
            case 'warning':
                return 'text-amber-700';
            case 'critical':
                return 'text-red-700';
            default:
                return 'text-gray-700';
        }
    };
    const formatValue = (value) => {
        if (kpi.unit === 'currency') {
            const crore = value / 10000000;
            const lakh = value / 100000;
            if (Math.abs(crore) >= 1)
                return `₹${crore.toFixed(2)}Cr`;
            return `₹${lakh.toFixed(2)}L`;
        }
        else if (kpi.unit === 'percentage') {
            return `${value.toFixed(1)}%`;
        }
        else if (kpi.unit === 'days') {
            return `${Math.round(value)} days`;
        }
        else if (kpi.unit === 'ratio') {
            return `${value.toFixed(1)}x`;
        }
        return value.toFixed(0);
    };
    const getTrendIcon = () => {
        if (kpi.trend === 'up') {
            return kpi.trendFavorable ? (_jsx(ArrowUp, { className: "text-green-600", size: 20 })) : (_jsx(ArrowUp, { className: "text-red-600", size: 20 }));
        }
        else if (kpi.trend === 'down') {
            return kpi.trendFavorable ? (_jsx(ArrowDown, { className: "text-green-600", size: 20 })) : (_jsx(ArrowDown, { className: "text-red-600", size: 20 }));
        }
        return _jsx(Minus, { className: "text-gray-500", size: 20 });
    };
    const sparklineChartData = kpi.sparklineData.map((val, idx) => ({ value: val }));
    return (_jsx(motion.div, { initial: { opacity: 0, y: 20 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.4, delay }, className: "group relative", children: _jsxs("div", { className: `bg-white rounded-xl border-2 border-gray-200 hover:border-blue-400 transition-all duration-300 overflow-hidden shadow-sm hover:shadow-lg`, children: [_jsx("div", { className: `h-1.5 bg-gradient-to-r ${getStatusColor()}` }), _jsxs("div", { className: "p-6", children: [_jsxs("div", { className: "flex items-start justify-between mb-4", children: [_jsx("div", { className: `p-3 rounded-lg ${getStatusBg()}`, children: _jsx("div", { className: getStatusTextColor(), children: iconMap[kpi.icon] || _jsx(Activity, { size: 24 }) }) }), _jsxs("div", { className: "flex items-center gap-2", children: [getTrendIcon(), _jsxs("span", { className: `text-sm font-semibold ${kpi.trendFavorable ? 'text-green-600' : 'text-red-600'}`, children: [kpi.changePercent > 0 ? '+' : '', kpi.changePercent.toFixed(1), "%"] })] })] }), _jsx("h3", { className: "text-sm font-medium text-gray-600 mb-2", children: kpi.title }), _jsx("div", { className: "text-3xl font-bold text-gray-900 mb-1", children: formatValue(displayValue) }), kpi.subLabel && (_jsx("div", { className: "text-xs text-gray-500 mb-2", children: kpi.subLabel })), _jsxs("div", { className: "text-xs text-gray-500 mb-3", children: ["Target: ", formatValue(kpi.target)] }), _jsx("div", { className: "h-12 -mx-2", children: _jsx(ResponsiveContainer, { width: "100%", height: "100%", children: _jsx(LineChart, { data: sparklineChartData, children: _jsx(Line, { type: "monotone", dataKey: "value", stroke: kpi.trendFavorable ? '#10B981' : '#EF4444', strokeWidth: 2, dot: false }) }) }) }), _jsx("div", { className: "mt-2 text-xs text-gray-500 italic", children: kpi.tooltip })] })] }) }));
};
export default KPICard;
