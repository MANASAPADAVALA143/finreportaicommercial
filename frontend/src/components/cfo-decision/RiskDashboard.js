import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { TrendingUp, TrendingDown, Minus, AlertCircle } from 'lucide-react';
import { riskData } from '../../data/decisionMockData';
const RiskDashboard = () => {
    const getRiskColor = (status) => {
        switch (status) {
            case 'high': return 'text-red-600 bg-red-50 border-red-200';
            case 'medium': return 'text-yellow-600 bg-yellow-50 border-yellow-200';
            default: return 'text-green-600 bg-green-50 border-green-200';
        }
    };
    const getTrendIcon = (trend) => {
        switch (trend) {
            case 'improving': return _jsx(TrendingDown, { className: "w-4 h-4 text-green-600" });
            case 'worsening': return _jsx(TrendingUp, { className: "w-4 h-4 text-red-600" });
            default: return _jsx(Minus, { className: "w-4 h-4 text-gray-600" });
        }
    };
    const getStatusEmoji = (status) => {
        switch (status) {
            case 'high': return '🔴';
            case 'medium': return '🟡';
            default: return '🟢';
        }
    };
    const risks = [
        { name: 'Liquidity', icon: '💧', ...riskData.liquidity },
        { name: 'Credit', icon: '💳', ...riskData.credit },
        { name: 'Operational', icon: '⚙️', ...riskData.operational },
        { name: 'Market', icon: '📈', ...riskData.market },
        { name: 'Compliance', icon: '📋', ...riskData.compliance },
        { name: 'FX', icon: '💱', ...riskData.fx },
        { name: 'Concentration', icon: '🏢', ...riskData.concentration }
    ];
    const overallStatus = riskData.overall > 7 ? 'high' : riskData.overall > 5 ? 'medium' : 'low';
    return (_jsxs("div", { className: "space-y-6", children: [_jsx("div", { className: "bg-gradient-to-r from-red-50 to-orange-50 rounded-lg border-2 border-red-200 p-6", children: _jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("div", { children: [_jsx("h3", { className: "text-2xl font-bold text-gray-900 mb-1", children: "Overall Risk Score" }), _jsxs("p", { className: "text-sm text-gray-600", children: [getStatusEmoji(overallStatus), " MEDIUM-HIGH", ' ', _jsx("span", { className: "text-red-600 font-medium", children: "\u2191 Deteriorating" })] })] }), _jsx("div", { className: "text-right", children: _jsxs("div", { className: "text-5xl font-bold text-red-600", children: [riskData.overall.toFixed(1), _jsx("span", { className: "text-2xl text-gray-600", children: "/10" })] }) })] }) }), _jsxs("div", { className: "bg-white rounded-lg border border-gray-200", children: [_jsx("div", { className: "px-6 py-4 border-b border-gray-200", children: _jsx("h3", { className: "text-lg font-semibold text-gray-900", children: "Risk Categories" }) }), _jsx("div", { className: "divide-y divide-gray-100", children: risks.map((risk, idx) => (_jsx("div", { className: "px-6 py-4 hover:bg-gray-50 transition-colors", children: _jsxs("div", { className: "flex items-center gap-4", children: [_jsx("div", { className: "text-3xl", children: risk.icon }), _jsxs("div", { className: "flex-1 min-w-0", children: [_jsx("h4", { className: "font-semibold text-gray-900 mb-1", children: risk.name }), _jsx("p", { className: "text-sm text-gray-600", children: risk.action })] }), _jsxs("div", { className: "flex items-center gap-4", children: [_jsx("div", { className: "text-right", children: _jsxs("div", { className: "text-2xl font-bold text-gray-900", children: [risk.score.toFixed(1), "/10"] }) }), _jsx("div", { className: "flex items-center gap-2", children: getTrendIcon(risk.trend) }), _jsx("div", { children: _jsxs("span", { className: `px-3 py-1.5 rounded-full text-sm font-medium border ${getRiskColor(risk.status)}`, children: [getStatusEmoji(risk.status), " ", risk.status.toUpperCase()] }) }), _jsxs("div", { className: "w-24", children: [risk.status === 'high' && (_jsx("span", { className: "text-sm font-medium text-red-600", children: "URGENT" })), risk.status === 'medium' && (_jsx("span", { className: "text-sm font-medium text-yellow-600", children: "Watch" })), risk.status === 'low' && (_jsx("span", { className: "text-sm font-medium text-green-600", children: "OK" }))] })] })] }) }, idx))) })] }), _jsxs("div", { className: "bg-gradient-to-r from-purple-50 to-indigo-50 rounded-lg border border-purple-200 p-6", children: [_jsx("h3", { className: "text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2", children: "\uD83E\uDD16 AI Risk Actions (Amazon Nova)" }), _jsxs("div", { className: "space-y-3", children: [risks
                                .filter(r => r.status === 'high')
                                .map((risk, idx) => (_jsxs("div", { className: "flex items-start gap-3", children: [_jsx(AlertCircle, { className: "w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" }), _jsxs("div", { children: [_jsxs("span", { className: "font-semibold text-red-600", children: [risk.name, ":"] }), _jsx("span", { className: "text-gray-800 ml-2", children: risk.action })] })] }, idx))), risks
                                .filter(r => r.status === 'medium')
                                .map((risk, idx) => (_jsxs("div", { className: "flex items-start gap-3", children: [_jsx(AlertCircle, { className: "w-5 h-5 text-yellow-600 mt-0.5 flex-shrink-0" }), _jsxs("div", { children: [_jsxs("span", { className: "font-semibold text-yellow-600", children: [risk.name, ":"] }), _jsx("span", { className: "text-gray-800 ml-2", children: risk.action })] })] }, idx)))] }), _jsxs("div", { className: "mt-6 pt-4 border-t border-purple-200 flex gap-3", children: [_jsx("button", { className: "px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors font-medium", children: "Export Risk Report" }), _jsx("button", { className: "px-4 py-2 bg-white border border-purple-300 text-purple-700 rounded-lg hover:bg-purple-50 transition-colors font-medium", children: "Add to Board Pack" }), _jsx("button", { className: "px-4 py-2 bg-white border border-purple-300 text-purple-700 rounded-lg hover:bg-purple-50 transition-colors font-medium", children: "Set Alerts" })] })] })] }));
};
export default RiskDashboard;
