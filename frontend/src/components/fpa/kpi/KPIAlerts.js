import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { AlertCircle, AlertTriangle, TrendingUp } from 'lucide-react';
const KPIAlerts = ({ alerts }) => {
    const criticalAlerts = alerts.filter(a => a.severity === 'critical');
    const warningAlerts = alerts.filter(a => a.severity === 'warning');
    const infoAlerts = alerts.filter(a => a.severity === 'info');
    const getSeverityIcon = (severity) => {
        switch (severity) {
            case 'critical':
                return _jsx(AlertCircle, { className: "text-red-600", size: 20 });
            case 'warning':
                return _jsx(AlertTriangle, { className: "text-amber-600", size: 20 });
            case 'info':
                return _jsx(TrendingUp, { className: "text-green-600", size: 20 });
        }
    };
    const getSeverityBg = (severity) => {
        switch (severity) {
            case 'critical':
                return 'bg-red-50 border-red-200';
            case 'warning':
                return 'bg-amber-50 border-amber-200';
            case 'info':
                return 'bg-green-50 border-green-200';
        }
    };
    const getSeverityTextColor = (severity) => {
        switch (severity) {
            case 'critical':
                return 'text-red-900';
            case 'warning':
                return 'text-amber-900';
            case 'info':
                return 'text-green-900';
        }
    };
    return (_jsxs("div", { className: "bg-white rounded-xl border-2 border-gray-200 p-6 shadow-sm", children: [_jsxs("div", { className: "flex items-center justify-between mb-6", children: [_jsx("h3", { className: "text-lg font-semibold text-gray-900", children: "KPI Alerts" }), _jsxs("div", { className: "flex items-center gap-4 text-sm", children: [_jsxs("div", { className: "flex items-center gap-1", children: [_jsx("div", { className: "w-3 h-3 rounded-full bg-red-500" }), _jsxs("span", { className: "text-gray-600", children: [criticalAlerts.length, " Critical"] })] }), _jsxs("div", { className: "flex items-center gap-1", children: [_jsx("div", { className: "w-3 h-3 rounded-full bg-amber-500" }), _jsxs("span", { className: "text-gray-600", children: [warningAlerts.length, " Warning"] })] }), _jsxs("div", { className: "flex items-center gap-1", children: [_jsx("div", { className: "w-3 h-3 rounded-full bg-green-500" }), _jsxs("span", { className: "text-gray-600", children: [infoAlerts.length, " On Track"] })] })] })] }), _jsxs("div", { className: "space-y-6", children: [criticalAlerts.length > 0 && (_jsxs("div", { children: [_jsxs("div", { className: "flex items-center gap-2 mb-3", children: [_jsx(AlertCircle, { className: "text-red-600", size: 20 }), _jsx("h4", { className: "font-bold text-red-900", children: "CRITICAL ALERTS" })] }), _jsx("div", { className: "space-y-2", children: criticalAlerts.map(alert => (_jsx("div", { className: `p-4 rounded-lg border-2 ${getSeverityBg(alert.severity)} transition-all hover:shadow-md`, children: _jsx("div", { className: "flex items-start justify-between", children: _jsxs("div", { className: "flex-1", children: [_jsxs("div", { className: "flex items-center gap-2 mb-1", children: [getSeverityIcon(alert.severity), _jsx("span", { className: `font-semibold ${getSeverityTextColor(alert.severity)}`, children: alert.title })] }), _jsx("p", { className: `text-sm ${getSeverityTextColor(alert.severity)} mb-2`, children: alert.message }), alert.action && (_jsxs("div", { className: "flex items-center gap-2 text-xs text-gray-600 bg-white px-3 py-1.5 rounded-md border border-gray-200", children: [_jsx("span", { className: "font-semibold", children: "Action:" }), _jsx("span", { children: alert.action })] }))] }) }) }, alert.id))) })] })), warningAlerts.length > 0 && (_jsxs("div", { children: [_jsxs("div", { className: "flex items-center gap-2 mb-3", children: [_jsx(AlertTriangle, { className: "text-amber-600", size: 20 }), _jsx("h4", { className: "font-bold text-amber-900", children: "WARNING ALERTS" })] }), _jsx("div", { className: "space-y-2", children: warningAlerts.map(alert => (_jsx("div", { className: `p-4 rounded-lg border-2 ${getSeverityBg(alert.severity)} transition-all hover:shadow-md`, children: _jsx("div", { className: "flex items-start justify-between", children: _jsxs("div", { className: "flex-1", children: [_jsxs("div", { className: "flex items-center gap-2 mb-1", children: [getSeverityIcon(alert.severity), _jsx("span", { className: `font-semibold ${getSeverityTextColor(alert.severity)}`, children: alert.title })] }), _jsx("p", { className: `text-sm ${getSeverityTextColor(alert.severity)} mb-2`, children: alert.message }), alert.action && (_jsxs("div", { className: "flex items-center gap-2 text-xs text-gray-600 bg-white px-3 py-1.5 rounded-md border border-gray-200", children: [_jsx("span", { className: "font-semibold", children: "Action:" }), _jsx("span", { children: alert.action })] }))] }) }) }, alert.id))) })] })), infoAlerts.length > 0 && (_jsxs("div", { children: [_jsxs("div", { className: "flex items-center gap-2 mb-3", children: [_jsx(TrendingUp, { className: "text-green-600", size: 20 }), _jsx("h4", { className: "font-bold text-green-900", children: "ON TRACK" })] }), _jsx("div", { className: "space-y-2", children: infoAlerts.map(alert => (_jsx("div", { className: `p-4 rounded-lg border-2 ${getSeverityBg(alert.severity)} transition-all hover:shadow-md`, children: _jsx("div", { className: "flex items-start justify-between", children: _jsxs("div", { className: "flex-1", children: [_jsxs("div", { className: "flex items-center gap-2 mb-1", children: [getSeverityIcon(alert.severity), _jsx("span", { className: `font-semibold ${getSeverityTextColor(alert.severity)}`, children: alert.title })] }), _jsx("p", { className: `text-sm ${getSeverityTextColor(alert.severity)}`, children: alert.message }), alert.action && (_jsxs("div", { className: "flex items-center gap-2 text-xs text-gray-600 bg-white px-3 py-1.5 rounded-md border border-gray-200 mt-2", children: [_jsx("span", { className: "font-semibold", children: "Recommendation:" }), _jsx("span", { children: alert.action })] }))] }) }) }, alert.id))) })] }))] }), _jsx("div", { className: "mt-6 pt-4 border-t border-gray-200", children: _jsxs("div", { className: "flex items-center justify-between text-sm", children: [_jsxs("span", { className: "text-gray-600", children: [alerts.length, " total alerts \u2022 ", criticalAlerts.length, " need immediate action"] }), _jsx("button", { className: "text-blue-600 hover:text-blue-700 font-medium", children: "View All \u2192" })] }) })] }));
};
export default KPIAlerts;
