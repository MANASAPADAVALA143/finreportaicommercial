import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { AlertCircle, AlertTriangle, Info, ArrowRight } from 'lucide-react';
const MorningBrief = ({ items, onActionClick }) => {
    const getUrgencyConfig = (urgency) => {
        switch (urgency) {
            case 'critical':
                return {
                    icon: AlertCircle,
                    color: 'text-red-600',
                    bgColor: 'bg-red-50',
                    borderColor: 'border-l-red-500'
                };
            case 'warning':
                return {
                    icon: AlertTriangle,
                    color: 'text-yellow-600',
                    bgColor: 'bg-yellow-50',
                    borderColor: 'border-l-yellow-500'
                };
            default:
                return {
                    icon: Info,
                    color: 'text-blue-600',
                    bgColor: 'bg-blue-50',
                    borderColor: 'border-l-blue-500'
                };
        }
    };
    const criticalCount = items.filter(item => item.urgency === 'critical').length;
    const warningCount = items.filter(item => item.urgency === 'warning').length;
    const resolvedCount = items.filter(item => item.urgency === 'info').length;
    return (_jsxs("div", { className: "bg-gradient-to-r from-amber-50 to-orange-50 rounded-lg p-6 border border-amber-200 mb-6", children: [_jsxs("div", { className: "flex items-center justify-between mb-4", children: [_jsxs("div", { children: [_jsxs("h3", { className: "text-lg font-semibold text-gray-900 flex items-center gap-2", children: ["\uD83C\uDF05 Morning Brief", _jsx("span", { className: "text-sm font-normal text-gray-600", children: new Date().toLocaleDateString('en-IN', { weekday: 'long', month: 'short', day: 'numeric' }) })] }), _jsx("p", { className: "text-sm text-gray-600 mt-1", children: "AI-generated alerts requiring your attention" })] }), _jsxs("div", { className: "flex items-center gap-4 text-sm", children: [criticalCount + warningCount > 0 && (_jsxs("span", { className: "text-red-600 font-medium", children: ["\uD83D\uDD34 ", criticalCount + warningCount, " decision", criticalCount + warningCount > 1 ? 's' : '', " need attention"] })), resolvedCount > 0 && (_jsxs("span", { className: "text-green-600 font-medium", children: ["\u2705 ", resolvedCount, " resolved"] }))] })] }), _jsx("div", { className: "space-y-3", children: items.map((item, index) => {
                    const config = getUrgencyConfig(item.urgency);
                    const Icon = config.icon;
                    return (_jsx("div", { className: `${config.bgColor} ${config.borderColor} border-l-4 rounded-r-lg p-4`, children: _jsxs("div", { className: "flex items-start gap-3", children: [_jsx(Icon, { className: `${config.color} w-5 h-5 mt-0.5 flex-shrink-0` }), _jsx("div", { className: "flex-1 min-w-0", children: _jsxs("div", { className: "flex items-start justify-between gap-4", children: [_jsxs("div", { className: "flex-1", children: [_jsx("h4", { className: "font-semibold text-gray-900 text-sm mb-1", children: item.title }), _jsxs("p", { className: "text-sm text-gray-700 mb-2", children: [_jsx("span", { className: "font-medium", children: "Decision:" }), " ", item.decision] }), _jsxs("p", { className: "text-sm text-gray-600", children: [_jsx("span", { className: "font-medium", children: "Impact:" }), " ", item.impact] })] }), item.action && (_jsxs("button", { onClick: () => onActionClick(item.action), className: "flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors text-sm font-medium text-gray-700 whitespace-nowrap", children: ["Take Action", _jsx(ArrowRight, { className: "w-4 h-4" })] }))] }) })] }) }, index));
                }) })] }));
};
export default MorningBrief;
