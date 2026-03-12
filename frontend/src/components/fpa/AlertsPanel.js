import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// FP&A Variance Analysis - Variance Alerts Panel Component
import { AlertTriangle, CheckCircle, AlertCircle } from 'lucide-react';
import { formatCurrency, formatPercentage } from '../../utils/varianceUtils';
export const AlertsPanel = ({ alerts, currency = "INR", onAlertClick }) => {
    // Group alerts by threshold
    const criticalAlerts = alerts.filter(a => a.threshold === "critical");
    const warningAlerts = alerts.filter(a => a.threshold === "warning");
    const onTargetAlerts = alerts.filter(a => a.threshold === "ok" && a.favorable);
    const AlertItem = ({ alert }) => {
        const getIcon = () => {
            if (alert.threshold === "critical")
                return _jsx(AlertCircle, { className: "w-5 h-5 text-red-600" });
            if (alert.threshold === "warning")
                return _jsx(AlertTriangle, { className: "w-5 h-5 text-amber-600" });
            return _jsx(CheckCircle, { className: "w-5 h-5 text-green-600" });
        };
        const getBgColor = () => {
            if (alert.threshold === "critical" && !alert.favorable)
                return "bg-red-50 border-red-200 hover:bg-red-100";
            if (alert.threshold === "warning" && !alert.favorable)
                return "bg-amber-50 border-amber-200 hover:bg-amber-100";
            if (alert.favorable)
                return "bg-green-50 border-green-200 hover:bg-green-100";
            return "bg-gray-50 border-gray-200 hover:bg-gray-100";
        };
        const getTextColor = () => {
            if (alert.threshold === "critical" && !alert.favorable)
                return "text-red-700";
            if (alert.threshold === "warning" && !alert.favorable)
                return "text-amber-700";
            if (alert.favorable)
                return "text-green-700";
            return "text-gray-700";
        };
        return (_jsx("div", { className: `p-3 rounded-lg border ${getBgColor()} cursor-pointer transition group`, onClick: () => onAlertClick?.(alert), children: _jsxs("div", { className: "flex items-start gap-3", children: [_jsx("div", { className: "mt-0.5", children: getIcon() }), _jsxs("div", { className: "flex-1 min-w-0", children: [_jsxs("div", { className: "flex items-center justify-between gap-2 mb-1", children: [_jsx("span", { className: `font-semibold text-sm ${getTextColor()} truncate`, children: alert.category }), _jsx("span", { className: `font-bold text-sm ${getTextColor()} whitespace-nowrap`, children: formatPercentage(alert.variancePct) })] }), _jsxs("p", { className: "text-xs text-gray-600 mb-1", children: [formatCurrency(Math.abs(alert.variance), currency), " ", alert.favorable ? 'under' : 'over', " budget"] }), alert.message && (_jsx("p", { className: "text-xs text-gray-500 italic", children: alert.message }))] })] }) }));
    };
    return (_jsxs("div", { className: "bg-white rounded-xl shadow-sm border border-gray-200 p-6 h-full overflow-y-auto", children: [_jsxs("div", { className: "flex items-center gap-3 mb-6", children: [_jsx("div", { className: "p-2 bg-amber-100 rounded-lg", children: _jsx(AlertTriangle, { className: "w-6 h-6 text-amber-600" }) }), _jsxs("div", { children: [_jsx("h3", { className: "text-lg font-bold text-gray-900", children: "Variance Alerts" }), _jsxs("p", { className: "text-sm text-gray-600", children: [alerts.length, " items requiring attention"] })] })] }), criticalAlerts.length > 0 && (_jsxs("div", { className: "mb-6", children: [_jsxs("div", { className: "flex items-center gap-2 mb-3", children: [_jsx(AlertCircle, { className: "w-5 h-5 text-red-600" }), _jsxs("h4", { className: "font-bold text-red-700 uppercase text-sm", children: ["Critical (", criticalAlerts.filter(a => !a.favorable).length, ")"] })] }), _jsx("div", { className: "space-y-2", children: criticalAlerts.filter(a => !a.favorable).map(alert => (_jsx(AlertItem, { alert: alert }, alert.id))) }), criticalAlerts.filter(a => !a.favorable).length === 0 && (_jsx("p", { className: "text-sm text-gray-500 italic", children: "No critical unfavorable variances" }))] })), warningAlerts.length > 0 && (_jsxs("div", { className: "mb-6", children: [_jsxs("div", { className: "flex items-center gap-2 mb-3", children: [_jsx(AlertTriangle, { className: "w-5 h-5 text-amber-600" }), _jsxs("h4", { className: "font-bold text-amber-700 uppercase text-sm", children: ["Warning (", warningAlerts.filter(a => !a.favorable).length, ")"] })] }), _jsx("div", { className: "space-y-2", children: warningAlerts.filter(a => !a.favorable).map(alert => (_jsx(AlertItem, { alert: alert }, alert.id))) }), warningAlerts.filter(a => !a.favorable).length === 0 && (_jsx("p", { className: "text-sm text-gray-500 italic", children: "No warning variances" }))] })), (criticalAlerts.filter(a => a.favorable).length > 0 ||
                warningAlerts.filter(a => a.favorable).length > 0 ||
                onTargetAlerts.length > 0) && (_jsxs("div", { className: "mb-6", children: [_jsxs("div", { className: "flex items-center gap-2 mb-3", children: [_jsx(CheckCircle, { className: "w-5 h-5 text-green-600" }), _jsx("h4", { className: "font-bold text-green-700 uppercase text-sm", children: "On Target / Favorable" })] }), _jsxs("div", { className: "space-y-2", children: [criticalAlerts.filter(a => a.favorable).map(alert => (_jsx(AlertItem, { alert: alert }, alert.id))), warningAlerts.filter(a => a.favorable).map(alert => (_jsx(AlertItem, { alert: alert }, alert.id))), onTargetAlerts.slice(0, 3).map(alert => (_jsx(AlertItem, { alert: alert }, alert.id)))] })] })), _jsx("div", { className: "pt-6 border-t border-gray-200", children: _jsxs("div", { className: "grid grid-cols-3 gap-4 text-center", children: [_jsxs("div", { children: [_jsx("div", { className: "text-2xl font-bold text-red-600", children: criticalAlerts.filter(a => !a.favorable).length }), _jsx("div", { className: "text-xs text-gray-600 mt-1", children: "Critical" })] }), _jsxs("div", { children: [_jsx("div", { className: "text-2xl font-bold text-amber-600", children: warningAlerts.filter(a => !a.favorable).length }), _jsx("div", { className: "text-xs text-gray-600 mt-1", children: "Warning" })] }), _jsxs("div", { children: [_jsx("div", { className: "text-2xl font-bold text-green-600", children: criticalAlerts.filter(a => a.favorable).length +
                                        warningAlerts.filter(a => a.favorable).length +
                                        onTargetAlerts.length }), _jsx("div", { className: "text-xs text-gray-600 mt-1", children: "Favorable" })] })] }) })] }));
};
