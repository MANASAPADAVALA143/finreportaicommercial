import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { Sparkles, RefreshCw, Copy, Download } from 'lucide-react';
import { callAI } from '../../../services/aiProvider';
const AIInsights = ({ kpis }) => {
    const [insights, setInsights] = useState(null);
    const [loading, setLoading] = useState(false);
    const generateInsights = async () => {
        setLoading(true);
        try {
            const criticalKPIs = kpis.filter(k => k.status === 'critical');
            const goodKPIs = kpis.filter(k => k.status === 'excellent' || k.status === 'good');
            const prompt = `You are a CFO advisor. Analyze these KPIs and provide actionable insights for the CFO morning briefing.

CRITICAL KPIs (needs immediate attention):
${criticalKPIs.map(k => `- ${k.title}: ${k.formattedValue} vs target ${k.unit === 'currency' ? '₹' + (k.target / 10000000).toFixed(2) + 'Cr' : k.target.toFixed(1) + (k.unit === 'percentage' ? '%' : k.unit === 'days' ? ' days' : 'x')} (${k.changePercent > 0 ? '+' : ''}${k.changePercent.toFixed(1)}%)`).join('\n')}

PERFORMING WELL:
${goodKPIs.slice(0, 3).map(k => `- ${k.title}: ${k.formattedValue}`).join('\n')}

KEY METRICS:
- Revenue: ₹33Cr vs ₹35Cr budget (-5.7%)
- Gross Margin: 43.9% vs 51.4% target (-7.5pp)
- Net Profit: ₹5.1Cr vs ₹8.1Cr budget (-37%)
- Cash Conversion Cycle: 66 days vs 45 day target
- DSO: 46 days (customers paying late)

Provide:
1. TOP 3 URGENT ACTIONS (what CFO must do TODAY)
2. POSITIVE HIGHLIGHTS (what is working well)
3. 30-DAY OUTLOOK (what to watch next month)
4. ONE KEY RISK (biggest financial risk right now)

Be specific, use numbers, CFO tone, max 200 words total.`;
            const aiResponse = await callAI(prompt);
            setInsights(aiResponse);
        }
        catch (error) {
            alert('❌ Failed to generate AI insights: ' + error.message);
        }
        finally {
            setLoading(false);
        }
    };
    const copyToClipboard = () => {
        if (insights) {
            navigator.clipboard.writeText(insights);
            alert('✅ Insights copied to clipboard!');
        }
    };
    const downloadInsights = () => {
        if (insights) {
            const blob = new Blob([insights], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `KPI_Insights_${new Date().toISOString().split('T')[0]}.txt`;
            a.click();
            URL.revokeObjectURL(url);
        }
    };
    const formatInsights = (text) => {
        // Split by sections
        const sections = text.split(/(\d\.|TOP|POSITIVE|30-DAY|ONE KEY)/);
        return sections.map((section, idx) => {
            if (section.includes('TOP 3') || section.includes('URGENT')) {
                return _jsx("div", { className: "mb-4", children: _jsx("h4", { className: "font-bold text-red-600 mb-2", children: "\uD83D\uDEA8 TOP 3 URGENT ACTIONS" }) }, idx);
            }
            else if (section.includes('POSITIVE')) {
                return _jsx("div", { className: "mb-4", children: _jsx("h4", { className: "font-bold text-green-600 mb-2", children: "\u2705 POSITIVE HIGHLIGHTS" }) }, idx);
            }
            else if (section.includes('30-DAY')) {
                return _jsx("div", { className: "mb-4", children: _jsx("h4", { className: "font-bold text-blue-600 mb-2", children: "\uD83D\uDCC5 30-DAY OUTLOOK" }) }, idx);
            }
            else if (section.includes('KEY RISK')) {
                return _jsx("div", { className: "mb-4", children: _jsx("h4", { className: "font-bold text-amber-600 mb-2", children: "\u26A0\uFE0F KEY RISK" }) }, idx);
            }
            return _jsx("p", { className: "text-gray-700 whitespace-pre-line mb-2", children: section }, idx);
        });
    };
    return (_jsxs("div", { className: "bg-gradient-to-br from-purple-50 to-blue-50 rounded-xl border-2 border-purple-200 p-6 shadow-lg", children: [_jsxs("div", { className: "flex items-center justify-between mb-4", children: [_jsxs("div", { className: "flex items-center gap-3", children: [_jsx("div", { className: "p-2 bg-purple-600 rounded-lg", children: _jsx(Sparkles, { className: "text-white", size: 24 }) }), _jsxs("div", { children: [_jsx("h3", { className: "text-lg font-bold text-gray-900", children: "AI CFO Insights" }), _jsx("p", { className: "text-sm text-gray-600", children: "Powered by AWS Nova" })] })] }), !loading && !insights && (_jsxs("button", { onClick: generateInsights, className: "flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg hover:from-purple-700 hover:to-blue-700 transition-all shadow-md hover:shadow-lg transform hover:scale-105", children: [_jsx(Sparkles, { size: 18 }), "Generate Insights"] })), insights && (_jsxs("div", { className: "flex items-center gap-2", children: [_jsx("button", { onClick: copyToClipboard, className: "p-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors", title: "Copy to clipboard", children: _jsx(Copy, { size: 18, className: "text-gray-600" }) }), _jsx("button", { onClick: downloadInsights, className: "p-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors", title: "Download as text", children: _jsx(Download, { size: 18, className: "text-gray-600" }) }), _jsxs("button", { onClick: generateInsights, disabled: loading, className: "flex items-center gap-2 px-3 py-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50", children: [_jsx(RefreshCw, { size: 18, className: `text-gray-600 ${loading ? 'animate-spin' : ''}` }), _jsx("span", { className: "text-sm", children: "Regenerate" })] })] }))] }), loading && (_jsxs("div", { className: "flex flex-col items-center justify-center py-12", children: [_jsx("div", { className: "animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600 mb-4" }), _jsx("p", { className: "text-gray-600", children: "Analyzing KPIs with AI..." })] })), !loading && !insights && (_jsxs("div", { className: "bg-white rounded-lg p-6 text-center", children: [_jsx("p", { className: "text-gray-600 mb-4", children: "Click \"Generate Insights\" to get AI-powered analysis of your KPIs with actionable recommendations." }), _jsxs("div", { className: "grid grid-cols-2 gap-4 text-sm text-left", children: [_jsxs("div", { className: "bg-purple-50 p-3 rounded-lg", children: [_jsx("div", { className: "font-semibold text-purple-900 mb-1", children: "\uD83D\uDCCA What you'll get:" }), _jsxs("ul", { className: "text-gray-700 space-y-1 text-xs", children: [_jsx("li", { children: "\u2022 Urgent action items" }), _jsx("li", { children: "\u2022 Performance highlights" }), _jsx("li", { children: "\u2022 Future outlook" }), _jsx("li", { children: "\u2022 Risk assessment" })] })] }), _jsxs("div", { className: "bg-blue-50 p-3 rounded-lg", children: [_jsx("div", { className: "font-semibold text-blue-900 mb-1", children: "\uD83E\uDD16 AI analyzes:" }), _jsxs("ul", { className: "text-gray-700 space-y-1 text-xs", children: [_jsxs("li", { children: ["\u2022 ", kpis.filter(k => k.status === 'critical').length, " critical KPIs"] }), _jsxs("li", { children: ["\u2022 ", kpis.filter(k => k.status === 'warning').length, " warning KPIs"] }), _jsxs("li", { children: ["\u2022 ", kpis.filter(k => k.status === 'excellent' || k.status === 'good').length, " performing well"] }), _jsx("li", { children: "\u2022 Historical trends" })] })] })] })] })), !loading && insights && (_jsx("div", { className: "bg-white rounded-lg p-6 shadow-sm", children: _jsx("div", { className: "prose prose-sm max-w-none", children: formatInsights(insights) }) }))] }));
};
export default AIInsights;
