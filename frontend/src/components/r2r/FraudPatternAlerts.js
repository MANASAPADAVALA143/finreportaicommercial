import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
const CATEGORY_ICON = {
    user: '👤',
    vendor: '🏢',
    account: '📒',
    timing: '🕐',
    benford: '📊',
};
const CATEGORY_LABEL = {
    user: 'User Pattern',
    vendor: 'Vendor Pattern',
    account: 'Account Pattern',
    timing: 'Timing Pattern',
    benford: "Benford's Law",
};
const SEVERITY_STYLE = {
    CRITICAL: {
        border: 'border-red-200',
        bg: 'bg-red-50',
        badgeBg: 'bg-red-600 text-white',
        textColor: 'text-red-900',
        leftBar: 'bg-red-500',
    },
    HIGH: {
        border: 'border-orange-200',
        bg: 'bg-orange-50',
        badgeBg: 'bg-orange-500 text-white',
        textColor: 'text-orange-900',
        leftBar: 'bg-orange-400',
    },
    MEDIUM: {
        border: 'border-amber-200',
        bg: 'bg-amber-50',
        badgeBg: 'bg-amber-400 text-white',
        textColor: 'text-amber-900',
        leftBar: 'bg-amber-400',
    },
};
const FraudPatternAlerts = ({ alerts }) => {
    const [expanded, setExpanded] = useState(null);
    const [showAll, setShowAll] = useState(false);
    if (!alerts || alerts.length === 0) {
        return (_jsxs("div", { className: "mb-6 rounded-xl border border-green-200 bg-green-50 px-5 py-4 flex items-center gap-3", children: [_jsx("span", { className: "text-2xl", children: "\u2705" }), _jsxs("div", { children: [_jsx("p", { className: "font-semibold text-green-800 text-sm", children: "No Cross-Entry Fraud Patterns Detected" }), _jsx("p", { className: "text-green-600 text-xs mt-0.5", children: "No suspicious patterns found across entries. Individual entry anomalies may still appear in the table below." })] })] }));
    }
    const criticalCount = alerts.filter((a) => a.severity === 'CRITICAL').length;
    const highCount = alerts.filter((a) => a.severity === 'HIGH').length;
    const displayAlerts = showAll ? alerts : alerts.slice(0, 5);
    return (_jsxs("div", { className: "mb-8", children: [_jsxs("div", { className: "flex items-center justify-between mb-3", children: [_jsxs("div", { className: "flex items-center gap-3 flex-wrap", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx("span", { className: "text-xl", children: "\u26A0\uFE0F" }), _jsx("h3", { className: "text-base font-bold text-gray-900", children: "Fraud Pattern Alerts" })] }), criticalCount > 0 && (_jsxs("span", { className: "px-2 py-0.5 bg-red-600 text-white rounded-full text-xs font-bold tracking-wide", children: [criticalCount, " CRITICAL"] })), highCount > 0 && (_jsxs("span", { className: "px-2 py-0.5 bg-orange-500 text-white rounded-full text-xs font-bold", children: [highCount, " HIGH"] })), _jsxs("span", { className: "px-2 py-0.5 bg-gray-200 text-gray-600 rounded-full text-xs font-medium", children: [alerts.length, " patterns detected"] })] }), _jsx("p", { className: "text-xs text-gray-400 hidden sm:block", children: "Cross-entry analysis" })] }), _jsx("div", { className: "space-y-2", children: displayAlerts.map((alert) => {
                    const s = SEVERITY_STYLE[alert.severity];
                    const isExpanded = expanded === alert.id;
                    return (_jsxs("div", { className: `rounded-lg border ${s.border} ${s.bg} overflow-hidden transition-all duration-150`, children: [_jsxs("button", { className: "w-full text-left flex items-stretch", onClick: () => setExpanded(isExpanded ? null : alert.id), children: [_jsx("div", { className: `w-1 flex-shrink-0 ${s.leftBar}` }), _jsx("div", { className: "flex-1 px-4 py-3", children: _jsxs("div", { className: "flex items-start justify-between gap-2", children: [_jsxs("div", { className: "flex items-start gap-2 flex-1 min-w-0", children: [_jsx("span", { className: "text-base flex-shrink-0 mt-0.5", children: CATEGORY_ICON[alert.category] }), _jsxs("div", { className: "flex-1 min-w-0", children: [_jsxs("div", { className: "flex items-center gap-2 flex-wrap mb-0.5", children: [_jsx("span", { className: "text-xs font-semibold text-gray-500 uppercase tracking-wide", children: CATEGORY_LABEL[alert.category] }), _jsx("span", { className: `px-2 py-0.5 rounded-full text-xs font-bold ${s.badgeBg}`, children: alert.severity })] }), _jsx("p", { className: `text-sm font-semibold ${s.textColor}`, children: alert.detail }), _jsx("p", { className: "text-xs text-gray-600 mt-0.5", children: alert.insight })] })] }), _jsxs("div", { className: "flex-shrink-0 flex flex-col items-end gap-1", children: [_jsxs("span", { className: "text-xs font-bold text-gray-700 whitespace-nowrap", children: ["\u20B9", Math.round(alert.totalAmount).toLocaleString('en-IN')] }), _jsxs("span", { className: "text-xs text-gray-400", children: [alert.entryCount, " entr", alert.entryCount > 1 ? 'ies' : 'y'] }), _jsx("span", { className: "text-xs text-blue-500", children: isExpanded ? '▲ less' : '▼ more' })] })] }) })] }), isExpanded && (_jsx("div", { className: "px-4 pb-4 ml-1 border-t border-gray-200 mt-0 bg-white bg-opacity-60", children: _jsxs("div", { className: "pt-3 space-y-3", children: [_jsxs("div", { className: "flex gap-2", children: [_jsx("span", { className: "text-sm flex-shrink-0", children: "\uD83C\uDFAF" }), _jsxs("div", { children: [_jsx("p", { className: "text-xs font-semibold text-gray-700 uppercase tracking-wide mb-0.5", children: "Recommended Action" }), _jsx("p", { className: "text-sm text-gray-800", children: alert.recommendation })] })] }), alert.entryIds.filter(Boolean).length > 0 && (_jsxs("div", { className: "flex gap-2", children: [_jsx("span", { className: "text-sm flex-shrink-0", children: "\uD83D\uDD0D" }), _jsxs("div", { children: [_jsx("p", { className: "text-xs font-semibold text-gray-700 uppercase tracking-wide mb-1", children: "Affected Entries" }), _jsxs("div", { className: "flex flex-wrap gap-1", children: [alert.entryIds
                                                                    .filter(Boolean)
                                                                    .slice(0, 12)
                                                                    .map((id) => (_jsx("span", { className: "px-2 py-0.5 bg-gray-100 border border-gray-200 rounded text-xs font-mono text-gray-700", children: id }, id))), alert.entryIds.length > 12 && (_jsxs("span", { className: "px-2 py-0.5 text-xs text-gray-400", children: ["+", alert.entryIds.length - 12, " more"] }))] })] })] }))] }) }))] }, alert.id));
                }) }), alerts.length > 5 && (_jsx("button", { onClick: () => setShowAll(!showAll), className: "mt-3 w-full py-2 border border-gray-200 rounded-lg text-sm text-gray-500 hover:text-gray-700 hover:border-gray-300 transition-colors", children: showAll ? '▲ Show fewer alerts' : `▼ Show all ${alerts.length} alerts` }))] }));
};
export default FraudPatternAlerts;
