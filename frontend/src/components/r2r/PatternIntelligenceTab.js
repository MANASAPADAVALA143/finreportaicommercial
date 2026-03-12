import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React, { useState, useMemo } from 'react';
import { BarChart3, Shield, Users, Building2, Hash, X } from 'lucide-react';
import { analysePatterns, detectFraudPatterns, } from '../../services/patternAnalysis';
import FraudPatternAlerts from './FraudPatternAlerts';
import { callAI } from '../../services/aiProvider';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, } from 'recharts';
export const PatternIntelligenceTab = ({ uploadedEntries }) => {
    const [novaSummary, setNovaSummary] = useState(null);
    const [novaLoading, setNovaLoading] = useState(false);
    const [selectedEntry, setSelectedEntry] = useState(null);
    const [riskFilter, setRiskFilter] = useState('ALL');
    const [expandedEntry, setExpandedEntry] = useState(null);
    const result = useMemo(() => {
        if (!uploadedEntries || uploadedEntries.length === 0)
            return null;
        return analysePatterns(uploadedEntries);
    }, [uploadedEntries]);
    const fraudAlerts = useMemo(() => {
        if (!result)
            return [];
        return detectFraudPatterns(result.patternEntries, result.baseline, uploadedEntries);
    }, [result, uploadedEntries]);
    const handleNovaSummary = async () => {
        if (!result)
            return;
        setNovaLoading(true);
        try {
            const prompt = `You are a CFO fraud analyst. Summarize this journal entry pattern analysis in 3-4 sentences for a board brief.

Summary:
- Total entries: ${result.summary.totalEntries}
- High Risk: ${result.summary.highRisk}, Medium: ${result.summary.mediumRisk}, Low: ${result.summary.lowRisk}
- Top risky vendor: ${result.summary.topRiskyVendor}
- Top risky user: ${result.summary.topRiskyUser}
- Dominant risk model: ${result.summary.dominantRiskModel}
- Benford: ${result.benfordResult.isSuspicious ? 'SUSPICIOUS (possible digit manipulation)' : 'Normal'}
- Client weekend posting rate: ${(result.baseline.weekendRate * 100).toFixed(1)}%

Write a concise CFO-level summary with key risks and recommended actions.`;
            const text = await callAI(prompt);
            setNovaSummary(text);
        }
        catch (err) {
            const msg = err?.message ?? String(err);
            const isAuthError = /invalid|403|UnrecognizedClient|security token|credentials/i.test(msg);
            setNovaSummary(isAuthError
                ? 'Nova summary unavailable: AWS credentials are missing or invalid. Set VITE_AWS_ACCESS_KEY_ID and VITE_AWS_SECRET_ACCESS_KEY in .env (and VITE_AWS_REGION if needed), then restart the app.'
                : 'Unable to generate Nova summary. Review the metrics above.');
        }
        finally {
            setNovaLoading(false);
        }
    };
    if (!result) {
        return (_jsxs("div", { className: "bg-white rounded-2xl shadow-xl border border-gray-200 p-12 text-center", children: [_jsx(BarChart3, { className: "w-16 h-16 text-gray-400 mx-auto mb-4" }), _jsx("p", { className: "text-gray-600 text-lg", children: "Upload a journal entries file above to run pattern analysis" }), _jsx("p", { className: "text-sm text-gray-500 mt-2", children: "Supports CSV and Excel (JE_ID, Date, Account, debit, credit, Vendor/Customer, etc.)" })] }));
    }
    const s = result.summary;
    const getRiskColor = (level) => {
        if (level === 'HIGH')
            return 'bg-red-100 text-red-800 border-red-300';
        if (level === 'MEDIUM')
            return 'bg-yellow-100 text-yellow-800 border-yellow-300';
        return 'bg-green-100 text-green-800 border-green-300';
    };
    const benfordChartData = result.benfordResult.digits.map((d, i) => ({
        digit: d.toString(),
        expected: result.benfordResult.expectedPct[i],
        actual: result.benfordResult.actualPct[i],
    }));
    return (_jsxs("div", { className: "space-y-6", children: [_jsx(FraudPatternAlerts, { alerts: fraudAlerts }), _jsxs("div", { className: "grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4", children: [_jsxs("div", { className: "bg-white rounded-xl shadow border border-gray-200 p-4", children: [_jsx("p", { className: "text-xs text-gray-500 uppercase", children: "Total" }), _jsx("p", { className: "text-2xl font-bold text-gray-900", children: s.totalEntries })] }), _jsxs("div", { className: "bg-red-50 rounded-xl shadow border border-red-200 p-4", children: [_jsx("p", { className: "text-xs text-red-600 uppercase", children: "High Risk" }), _jsx("p", { className: "text-2xl font-bold text-red-600", children: s.highRisk })] }), _jsxs("div", { className: "bg-yellow-50 rounded-xl shadow border border-yellow-200 p-4", children: [_jsx("p", { className: "text-xs text-yellow-700 uppercase", children: "Medium" }), _jsx("p", { className: "text-2xl font-bold text-yellow-700", children: s.mediumRisk })] }), _jsxs("div", { className: "bg-green-50 rounded-xl shadow border border-green-200 p-4", children: [_jsx("p", { className: "text-xs text-green-700 uppercase", children: "Low" }), _jsx("p", { className: "text-2xl font-bold text-green-700", children: s.lowRisk })] }), _jsxs("div", { className: "bg-white rounded-xl shadow border border-gray-200 p-4", children: [_jsx("p", { className: "text-xs text-gray-500 uppercase", children: "Dominant Model" }), _jsx("p", { className: "text-lg font-bold text-purple-600 capitalize", children: s.dominantRiskModel })] }), _jsxs("div", { className: "bg-white rounded-xl shadow border border-gray-200 p-4", children: [_jsx("p", { className: "text-xs text-gray-500 uppercase", children: "Overall Score" }), _jsx("p", { className: "text-2xl font-bold text-gray-900", children: s.overallRiskScore })] })] }), _jsxs("div", { className: "grid grid-cols-1 md:grid-cols-3 gap-4", children: [_jsxs("div", { className: "bg-white rounded-xl shadow border border-gray-200 p-4", children: [_jsxs("div", { className: "flex items-center gap-2 text-sm text-gray-600 mb-2", children: [_jsx(Building2, { className: "w-4 h-4" }), " Top Risky Vendor"] }), _jsx("p", { className: "font-bold text-gray-900", children: s.topRiskyVendor })] }), _jsxs("div", { className: "bg-white rounded-xl shadow border border-gray-200 p-4", children: [_jsxs("div", { className: "flex items-center gap-2 text-sm text-gray-600 mb-2", children: [_jsx(Users, { className: "w-4 h-4" }), " Top Risky User"] }), _jsx("p", { className: "font-bold text-gray-900", children: s.topRiskyUser })] }), _jsxs("div", { className: "bg-white rounded-xl shadow border border-gray-200 p-4", children: [_jsxs("div", { className: "flex items-center gap-2 text-sm text-gray-600 mb-2", children: [_jsx(Hash, { className: "w-4 h-4" }), " Top Risky Account"] }), _jsx("p", { className: "font-bold text-gray-900", children: s.topRiskyAccount })] })] }), _jsxs("div", { className: "bg-white rounded-xl shadow border border-gray-200 p-6", children: [_jsxs("h3", { className: "text-lg font-bold text-gray-900 mb-2 flex items-center gap-2", children: [_jsx(BarChart3, { className: "w-5 h-5" }), " Benford's Law"] }), _jsx("p", { className: `text-sm mb-4 ${result.benfordResult.isSuspicious ? 'text-red-600 font-medium' : 'text-gray-600'}`, children: result.benfordResult.interpretation }), _jsx("div", { className: "h-48", children: _jsx(ResponsiveContainer, { width: "100%", height: "100%", children: _jsxs(BarChart, { data: benfordChartData, children: [_jsx(CartesianGrid, { strokeDasharray: "3 3", stroke: "#eee" }), _jsx(XAxis, { dataKey: "digit" }), _jsx(YAxis, {}), _jsx(Tooltip, {}), _jsx(Bar, { dataKey: "expected", name: "Expected %", fill: "#94a3b8", radius: [4, 4, 0, 0] }), _jsx(Bar, { dataKey: "actual", name: "Actual %", fill: "#3b82f6", radius: [4, 4, 0, 0], children: benfordChartData.map((_, i) => (_jsx(Cell, { fill: result.benfordResult.suspiciousDigits.includes(i + 1) ? '#ef4444' : '#3b82f6' }, i))) })] }) }) })] }), _jsxs("div", { className: "bg-gray-50 rounded-xl p-4", children: [_jsx("p", { className: "text-sm font-semibold text-gray-700 mb-2", children: "Model Weights" }), _jsx("div", { className: "flex flex-wrap gap-2", children: Object.entries(result.modelWeights).map(([k, v]) => (_jsxs("span", { className: "px-2 py-1 bg-white rounded text-xs font-medium border border-gray-200", children: [k, ": ", v, "%"] }, k))) })] }), _jsxs("div", { className: "bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl border border-blue-200 p-6", children: [_jsxs("div", { className: "flex items-center justify-between mb-3", children: [_jsxs("h3", { className: "text-lg font-bold text-gray-900 flex items-center gap-2", children: [_jsx(Shield, { className: "w-5 h-5 text-blue-600" }), " Nova AI Summary"] }), _jsx("button", { onClick: handleNovaSummary, disabled: novaLoading, className: "px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50", children: novaLoading ? 'Generating...' : 'Generate Summary' })] }), novaSummary && _jsx("p", { className: "text-gray-700 text-sm leading-relaxed", children: novaSummary })] }), _jsxs("div", { className: "mt-6", children: [_jsxs("div", { className: "flex items-center justify-between mb-4", children: [_jsxs("div", { children: [_jsx("h3", { className: "text-base font-bold text-gray-900", children: "Pattern Risk Entries" }), _jsx("p", { className: "text-xs text-gray-500 mt-0.5", children: "7-model client-specific detection \u00B7 sorted by risk score" })] }), _jsx("div", { className: "flex gap-1 bg-gray-100 rounded-lg p-1", children: ['ALL', 'HIGH', 'MEDIUM', 'LOW'].map((f) => (_jsx("button", { onClick: () => setRiskFilter(f), className: `px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${riskFilter === f
                                        ? f === 'HIGH'
                                            ? 'bg-red-600 text-white shadow'
                                            : f === 'MEDIUM'
                                                ? 'bg-amber-500 text-white shadow'
                                                : f === 'LOW'
                                                    ? 'bg-green-600 text-white shadow'
                                                    : 'bg-white text-gray-800 shadow'
                                        : 'text-gray-500 hover:text-gray-700'}`, children: f === 'ALL'
                                        ? `All (${result.patternEntries.length})`
                                        : `${f} (${result.patternEntries.filter((e) => e.riskLevel === f).length})` }, f))) })] }), _jsx("div", { className: "grid grid-cols-4 gap-3 mb-4", children: [
                            {
                                label: 'Amount Anomalies',
                                count: result.patternEntries.filter((e) => e.modelScores.amount >= 70).length,
                                color: 'border-red-200 bg-red-50',
                                textColor: 'text-red-700',
                                icon: '💰',
                            },
                            {
                                label: 'Duplicate Entries',
                                count: result.patternEntries.filter((e) => e.modelScores.duplicate >= 70).length,
                                color: 'border-orange-200 bg-orange-50',
                                textColor: 'text-orange-700',
                                icon: '🔁',
                            },
                            {
                                label: 'Behaviour Flags',
                                count: result.patternEntries.filter((e) => e.modelScores.user >= 40 || e.modelScores.timing >= 40).length,
                                color: 'border-amber-200 bg-amber-50',
                                textColor: 'text-amber-700',
                                icon: '👤',
                            },
                            {
                                label: 'Account Flags',
                                count: result.patternEntries.filter((e) => e.modelScores.account >= 40).length,
                                color: 'border-purple-200 bg-purple-50',
                                textColor: 'text-purple-700',
                                icon: '📒',
                            },
                        ].map((card) => (_jsxs("div", { className: `rounded-lg border ${card.color} p-3`, children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("span", { className: "text-lg", children: card.icon }), _jsx("span", { className: `text-2xl font-bold ${card.textColor}`, children: card.count })] }), _jsx("p", { className: `text-xs font-medium mt-1 ${card.textColor}`, children: card.label })] }, card.label))) }), _jsxs("div", { className: "rounded-xl border border-gray-200 overflow-hidden shadow-sm", children: [_jsx("div", { className: "overflow-x-auto max-h-[28rem]", children: _jsxs("table", { className: "w-full text-sm", children: [_jsx("thead", { children: _jsxs("tr", { className: "bg-slate-800 text-white", children: [_jsx("th", { className: "text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider w-24", children: "Entry" }), _jsx("th", { className: "text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider", children: "Vendor / Account" }), _jsx("th", { className: "text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider w-20", children: "Posted By" }), _jsx("th", { className: "text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider w-24", children: "Date" }), _jsx("th", { className: "text-right px-4 py-3 text-xs font-semibold uppercase tracking-wider w-32", children: "Amount" }), _jsx("th", { className: "text-center px-2 py-3 text-xs font-semibold uppercase tracking-wider w-16", title: "Amount Outlier Score", children: "Amt" }), _jsx("th", { className: "text-center px-2 py-3 text-xs font-semibold uppercase tracking-wider w-16", title: "Duplicate Score", children: "Dup" }), _jsx("th", { className: "text-center px-2 py-3 text-xs font-semibold uppercase tracking-wider w-16", title: "User Behaviour Score", children: "User" }), _jsx("th", { className: "text-center px-2 py-3 text-xs font-semibold uppercase tracking-wider w-16", title: "Timing Score", children: "Time" }), _jsx("th", { className: "text-center px-2 py-3 text-xs font-semibold uppercase tracking-wider w-16", title: "Account Score", children: "Acct" }), _jsx("th", { className: "text-center px-4 py-3 text-xs font-semibold uppercase tracking-wider w-28", children: "Risk Score" })] }) }), _jsx("tbody", { children: result.patternEntries
                                                .filter((e) => riskFilter === 'ALL' || e.riskLevel === riskFilter)
                                                .map((entry, i) => {
                                                const isHigh = entry.riskLevel === 'HIGH';
                                                const isMedium = entry.riskLevel === 'MEDIUM';
                                                const rowBg = i % 2 === 0 ? 'bg-white' : 'bg-gray-50';
                                                const leftBorderClass = isHigh
                                                    ? 'border-l-4 border-l-red-500'
                                                    : isMedium
                                                        ? 'border-l-4 border-l-amber-400'
                                                        : 'border-l-4 border-l-transparent';
                                                const scoreCell = (score, key) => {
                                                    if (score <= 0)
                                                        return (_jsx("td", { className: "text-center px-2 py-3", children: _jsx("span", { className: "text-gray-300 text-xs", children: "\u2014" }) }, key));
                                                    const style = score >= 70
                                                        ? 'bg-red-500 text-white'
                                                        : score >= 40
                                                            ? 'bg-gray-700 text-white'
                                                            : 'bg-gray-200 text-gray-600';
                                                    return (_jsx("td", { className: "text-center px-2 py-3", children: _jsx("span", { className: `inline-block px-2 py-0.5 rounded text-xs font-bold ${style}`, children: score }) }, key));
                                                };
                                                const badgeClass = isHigh
                                                    ? 'bg-red-100 text-red-700'
                                                    : isMedium
                                                        ? 'bg-gray-100 text-gray-600'
                                                        : 'bg-gray-100 text-gray-400';
                                                return (_jsxs(React.Fragment, { children: [_jsxs("tr", { className: `border-t border-gray-100 cursor-pointer transition-colors hover:bg-slate-50 ${rowBg} ${leftBorderClass}`, onClick: () => setExpandedEntry(expandedEntry === entry.entryId ? null : entry.entryId), children: [_jsx("td", { className: "px-4 py-3", children: _jsx("span", { className: "font-mono text-xs font-bold text-gray-800", children: entry.entryId }) }), _jsxs("td", { className: "px-4 py-3", children: [_jsx("p", { className: "font-medium text-gray-900 text-sm", children: entry.vendor }), _jsx("p", { className: "text-xs text-gray-400 mt-0.5", children: entry.account })] }), _jsx("td", { className: "px-4 py-3", children: _jsx("span", { className: "text-xs bg-gray-100 text-gray-700 px-2 py-0.5 rounded-full font-medium", children: entry.userId }) }), _jsxs("td", { className: "px-4 py-3", children: [_jsx("p", { className: "text-xs text-gray-700", children: entry.date
                                                                                ? new Date(entry.date).toLocaleDateString('en-IN', {
                                                                                    day: '2-digit',
                                                                                    month: 'short',
                                                                                    year: '2-digit',
                                                                                })
                                                                                : '—' }), entry.isWeekend && (_jsx("span", { className: "text-xs text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded font-medium block", children: "Wknd" })), entry.isMonthEnd && (_jsx("span", { className: "text-xs text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded font-medium block", children: "M-End" }))] }), _jsxs("td", { className: "px-4 py-3 text-right", children: [_jsxs("p", { className: "font-bold text-sm text-gray-900", children: ["\u20B9", entry.amount.toLocaleString('en-IN')] }), Math.abs(entry.zScoreAmount) > 1.5 && (_jsxs("p", { className: "text-xs text-gray-400", children: ["z=", entry.zScoreAmount > 0 ? '+' : '', entry.zScoreAmount, "\u03C3"] }))] }), scoreCell(entry.modelScores.amount, 'amt'), scoreCell(entry.modelScores.duplicate, 'dup'), scoreCell(entry.modelScores.user, 'user'), scoreCell(entry.modelScores.timing, 'time'), scoreCell(entry.modelScores.account, 'acct'), _jsx("td", { className: "px-4 py-3 text-center", children: _jsxs("div", { className: "flex flex-col items-center gap-1", children: [_jsx("div", { className: "w-16 h-2 bg-gray-200 rounded-full overflow-hidden", children: _jsx("div", { className: `h-full rounded-full transition-all ${isHigh
                                                                                        ? 'bg-red-500'
                                                                                        : isMedium
                                                                                            ? 'bg-amber-400'
                                                                                            : 'bg-green-400'}`, style: { width: `${entry.patternRiskScore}%` } }) }), _jsx("span", { className: "text-xs font-bold text-gray-700", children: entry.patternRiskScore }), _jsx("span", { className: `text-xs px-2 py-0.5 rounded-full font-semibold ${badgeClass}`, children: entry.riskLevel })] }) })] }), expandedEntry === entry.entryId && entry.patternFlags.length > 0 && (_jsx("tr", { className: "bg-white border-t border-dashed border-gray-100", children: _jsx("td", { colSpan: 11, className: "px-6 py-3", children: _jsx("div", { className: "flex flex-wrap gap-2", children: entry.patternFlags.map((flag, fi) => (_jsxs("span", { className: "inline-flex items-center gap-1 px-3 py-1 bg-white border border-gray-200 rounded-full text-xs text-gray-700 shadow-sm", children: [_jsx("span", { className: "text-red-500", children: "\u2691" }), flag] }, fi))) }) }) }))] }, entry.entryId));
                                            }) })] }) }), result.patternEntries.filter((e) => riskFilter === 'ALL' || e.riskLevel === riskFilter).length === 0 && (_jsx("div", { className: "py-12 text-center text-gray-400", children: _jsxs("p", { className: "text-sm", children: ["No ", riskFilter, " risk entries found"] }) }))] }), _jsxs("div", { className: "flex items-center gap-6 mt-3 px-1 flex-wrap", children: [_jsx("p", { className: "text-xs text-gray-400", children: "Column headers: Amt = Amount model \u00B7 Dup = Duplicate \u00B7 User = User behaviour \u00B7 Time = Timing \u00B7 Acct = Account" }), _jsx("p", { className: "text-xs text-gray-400", children: "Click any row to see detailed flags" })] })] }), selectedEntry && (_jsx("div", { className: "fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4", children: _jsxs("div", { className: "bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto", children: [_jsxs("div", { className: "p-6 border-b flex justify-between items-center", children: [_jsxs("h3", { className: "text-xl font-bold", children: ["Entry ", selectedEntry.entryId] }), _jsx("button", { onClick: () => setSelectedEntry(null), className: "p-2 hover:bg-gray-100 rounded", children: _jsx(X, { className: "w-5 h-5" }) })] }), _jsxs("div", { className: "p-6 space-y-4", children: [_jsxs("p", { children: [_jsx("strong", { children: "Vendor:" }), " ", selectedEntry.vendor] }), _jsxs("p", { children: [_jsx("strong", { children: "Amount:" }), " \u20B9", selectedEntry.amount.toLocaleString('en-IN')] }), _jsxs("p", { children: [_jsx("strong", { children: "Account:" }), " ", selectedEntry.account] }), _jsxs("p", { children: [_jsx("strong", { children: "Date:" }), " ", selectedEntry.date, " (", selectedEntry.dayOfWeek, ")"] }), _jsxs("p", { children: [_jsx("strong", { children: "Pattern Risk Score:" }), " ", selectedEntry.patternRiskScore] }), _jsxs("div", { children: [_jsx("p", { className: "font-semibold mb-2", children: "Flags:" }), _jsx("ul", { className: "list-disc list-inside text-sm text-gray-700 space-y-1", children: selectedEntry.patternFlags.length > 0
                                                ? selectedEntry.patternFlags.map((f, i) => _jsx("li", { children: f }, i))
                                                : _jsx("li", { children: "No specific flags" }) })] }), _jsxs("div", { children: [_jsx("p", { className: "font-semibold mb-2", children: "Model Scores:" }), _jsx("div", { className: "flex flex-wrap gap-2", children: Object.entries(selectedEntry.modelScores)
                                                .filter(([, v]) => v > 0)
                                                .map(([k, v]) => (_jsxs("span", { className: "px-2 py-1 bg-gray-100 rounded text-xs", children: [k, ": ", v] }, k))) })] })] })] }) }))] }));
};
