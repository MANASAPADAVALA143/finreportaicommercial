import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// FP&A Variance Analysis - AI Commentary Component (AWS Nova Powered)
import { useState } from 'react';
import { Sparkles, Copy, RefreshCw, Download, Edit2, Check, X } from 'lucide-react';
import { callAI } from '../../services/aiProvider';
import { formatCurrency, formatPercentage } from '../../utils/varianceUtils';
export const AICommentary = ({ varianceData, period, entityName, currency = "INR" }) => {
    const [commentary, setCommentary] = useState('');
    const [isGenerating, setIsGenerating] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [editedCommentary, setEditedCommentary] = useState('');
    const [copied, setCopied] = useState(false);
    const generateCommentary = async () => {
        setIsGenerating(true);
        try {
            // Find critical variances
            const criticalVariances = varianceData
                .filter(r => r.threshold === "critical" && !r.isHeader)
                .map(r => `${r.category}: ${formatPercentage(r.variancePct)} ${r.favorable ? 'favorable' : 'unfavorable'}`);
            // Get key metrics
            const revenue = varianceData.find(r => r.id === "revenue");
            const netProfit = varianceData.find(r => r.id === "net-profit");
            const adminExpenses = varianceData.find(r => r.id === "admin-expenses");
            const exportSales = varianceData.find(r => r.id === "export-sales");
            const costOfSales = varianceData.find(r => r.id === "cost-of-sales");
            const prompt = `You are a CFO-level financial analyst writing a professional variance commentary for the board pack.

COMPANY: ${entityName}
PERIOD: ${period}
CURRENCY: ${currency}

KEY VARIANCES:
${criticalVariances.join("\n")}

DETAILED METRICS:
- Revenue: Actual ${revenue ? formatCurrency(revenue.actual, currency) : 'N/A'} vs Budget ${revenue ? formatCurrency(revenue.budget, currency) : 'N/A'} (${revenue ? formatPercentage(revenue.variancePct) : 'N/A'} ${revenue?.favorable ? 'favorable' : 'unfavorable'})
- Net Profit: Actual ${netProfit ? formatCurrency(netProfit.actual, currency) : 'N/A'} vs Budget ${netProfit ? formatCurrency(netProfit.budget, currency) : 'N/A'} (${netProfit ? formatPercentage(netProfit.variancePct) : 'N/A'} ${netProfit?.favorable ? 'favorable' : 'unfavorable'})
- Admin Expenses: ${adminExpenses ? formatPercentage(adminExpenses.variancePct) : 'N/A'} over budget (critical)
- Export Sales: ${exportSales ? formatPercentage(exportSales.variancePct) : 'N/A'} below target
- Cost of Sales: ${costOfSales ? formatPercentage(costOfSales.variancePct) : 'N/A'} over budget

Write a professional CFO-level variance commentary with these sections:

1. EXECUTIVE SUMMARY (2-3 sentences summarizing overall performance)

2. REVENUE ANALYSIS (2-3 sentences explaining the revenue variance and its drivers)

3. COST & EXPENSE ANALYSIS (2-3 sentences on cost overruns and expense management)

4. KEY RISKS (3 specific bullet points identifying critical risks)

5. MANAGEMENT ACTIONS (3 specific bullet points on corrective actions being taken)

6. OUTLOOK (1-2 sentences on forward-looking expectations)

Use professional CFO language. Be specific with numbers and percentages. Format with clear section headers. Do not use markdown formatting - use plain text with section headers in ALL CAPS followed by a colon.`;
            const result = await callAI(prompt);
            setCommentary(result);
            setEditedCommentary(result);
        }
        catch (error) {
            alert('Failed to generate commentary: ' + error.message);
        }
        finally {
            setIsGenerating(false);
        }
    };
    const handleCopy = () => {
        navigator.clipboard.writeText(isEditing ? editedCommentary : commentary);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };
    const handleSaveEdit = () => {
        setCommentary(editedCommentary);
        setIsEditing(false);
    };
    const handleCancelEdit = () => {
        setEditedCommentary(commentary);
        setIsEditing(false);
    };
    const handleDownload = () => {
        const blob = new Blob([commentary], { type: 'text/plain' });
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `variance-commentary-${period}.txt`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.URL.revokeObjectURL(url);
    };
    return (_jsxs("div", { className: "bg-white rounded-xl shadow-sm border border-gray-200 p-6", children: [_jsxs("div", { className: "flex items-center justify-between mb-6", children: [_jsxs("div", { className: "flex items-center gap-3", children: [_jsx("div", { className: "p-2 bg-purple-100 rounded-lg", children: _jsx(Sparkles, { className: "w-6 h-6 text-purple-600" }) }), _jsxs("div", { children: [_jsx("h3", { className: "text-lg font-bold text-gray-900", children: "AI-Powered Variance Commentary" }), _jsx("p", { className: "text-sm text-gray-600", children: "Professional board-level analysis by AWS Nova" })] })] }), commentary && !isEditing && (_jsxs("div", { className: "flex items-center gap-2", children: [_jsxs("button", { onClick: handleCopy, className: "px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition flex items-center gap-2 text-sm font-medium", children: [copied ? _jsx(Check, { className: "w-4 h-4" }) : _jsx(Copy, { className: "w-4 h-4" }), copied ? 'Copied!' : 'Copy'] }), _jsxs("button", { onClick: () => setIsEditing(true), className: "px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition flex items-center gap-2 text-sm font-medium", children: [_jsx(Edit2, { className: "w-4 h-4" }), "Edit"] }), _jsxs("button", { onClick: handleDownload, className: "px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition flex items-center gap-2 text-sm font-medium", children: [_jsx(Download, { className: "w-4 h-4" }), "Download"] }), _jsxs("button", { onClick: generateCommentary, disabled: isGenerating, className: "px-3 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition flex items-center gap-2 text-sm font-medium disabled:opacity-50", children: [_jsx(RefreshCw, { className: `w-4 h-4 ${isGenerating ? 'animate-spin' : ''}` }), "Regenerate"] })] }))] }), !commentary ? (_jsxs("div", { className: "text-center py-12", children: [_jsx("div", { className: "mb-4", children: _jsx(Sparkles, { className: "w-16 h-16 text-purple-300 mx-auto" }) }), _jsx("p", { className: "text-gray-600 mb-6", children: "Generate AI-powered variance commentary for your board pack" }), _jsxs("button", { onClick: generateCommentary, disabled: isGenerating, className: "px-6 py-3 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white rounded-lg font-semibold transition flex items-center gap-2 mx-auto disabled:opacity-50", children: [_jsx(Sparkles, { className: `w-5 h-5 ${isGenerating ? 'animate-pulse' : ''}` }), isGenerating ? 'Generating Commentary...' : 'Generate AI Commentary'] })] })) : isEditing ? (_jsxs("div", { children: [_jsx("textarea", { value: editedCommentary, onChange: (e) => setEditedCommentary(e.target.value), className: "w-full h-96 p-4 border border-gray-300 rounded-lg font-mono text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent", placeholder: "Edit commentary..." }), _jsxs("div", { className: "flex items-center justify-end gap-2 mt-4", children: [_jsxs("button", { onClick: handleCancelEdit, className: "px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition flex items-center gap-2", children: [_jsx(X, { className: "w-4 h-4" }), "Cancel"] }), _jsxs("button", { onClick: handleSaveEdit, className: "px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition flex items-center gap-2", children: [_jsx(Check, { className: "w-4 h-4" }), "Save Changes"] })] })] })) : (_jsx("div", { className: "bg-gray-50 rounded-lg p-6 border border-gray-200", children: _jsx("pre", { className: "whitespace-pre-wrap font-sans text-sm text-gray-800 leading-relaxed", children: commentary }) }))] }));
};
