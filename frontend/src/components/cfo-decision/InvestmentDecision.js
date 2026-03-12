import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState } from 'react';
import { AlertCircle, CheckCircle, AlertTriangle } from 'lucide-react';
import { calculateInvestmentMetrics, generateDecisionRecommendation } from '../../services/decisionEngine';
import { compareProjectsData } from '../../data/decisionMockData';
import { loadCFODecisionData } from '../../services/cfoDecisionDataService';
const InvestmentDecision = ({ onSaveToAudit }) => {
    const uploadedData = loadCFODecisionData();
    const firstProject = uploadedData?.investment?.[0];
    const [inputs, setInputs] = useState(firstProject ? {
        projectName: firstProject.projectName,
        investment: firstProject.investment,
        annualReturns: firstProject.yearlyRevenue - firstProject.yearlyCost,
        projectLife: firstProject.projectYears,
        riskLevel: 'medium',
        discountRate: firstProject.discountRate,
        strategicValue: 'medium',
        cashPosition: firstProject.investment * 1.5
    } : {
        projectName: 'New ERP System',
        investment: 20000000,
        annualReturns: 5000000,
        projectLife: 5,
        riskLevel: 'medium',
        discountRate: 12,
        strategicValue: 'medium',
        cashPosition: 25000000
    });
    const [metrics, setMetrics] = useState(null);
    const [aiRecommendation, setAiRecommendation] = useState(null);
    const [loading, setLoading] = useState(false);
    const [cfoDecision, setCfoDecision] = useState('');
    const [cfoNotes, setCfoNotes] = useState('');
    const handleCalculate = async () => {
        setLoading(true);
        // Calculate metrics
        const calculated = calculateInvestmentMetrics(inputs.investment, inputs.annualReturns, inputs.projectLife, inputs.discountRate);
        setMetrics(calculated);
        // Get AI recommendation
        try {
            const recommendation = await generateDecisionRecommendation('investment', {
                ...calculated,
                investment: inputs.investment,
                hurdleRate: inputs.discountRate,
                risk: inputs.riskLevel,
                cashPosition: inputs.cashPosition
            });
            setAiRecommendation(recommendation);
        }
        catch (error) {
            console.error('Error getting AI recommendation:', error);
        }
        setLoading(false);
    };
    const handleSave = () => {
        if (!metrics || !aiRecommendation)
            return;
        const decision = {
            id: `inv-${Date.now()}`,
            type: 'investment',
            title: `${inputs.projectName} - ₹${(inputs.investment / 10000000).toFixed(1)}Cr`,
            date: new Date().toISOString().split('T')[0],
            inputs,
            results: {
                primaryMetric: metrics.npv,
                secondaryMetrics: {
                    irr: metrics.irr,
                    payback: metrics.payback,
                    roi: metrics.roi
                },
                riskScore: metrics.riskScore,
                recommendation: aiRecommendation.outcome
            },
            aiRecommendation: aiRecommendation.recommendation,
            aiOutcome: aiRecommendation.outcome,
            confidence: aiRecommendation.confidence,
            confidenceFactors: aiRecommendation.confidenceFactors,
            cfoOverride: cfoDecision,
            cfoNotes,
            savedToAuditTrail: true
        };
        onSaveToAudit(decision);
        alert('Decision saved to audit trail!');
    };
    const formatCurrency = (amount) => {
        if (amount >= 10000000)
            return `₹${(amount / 10000000).toFixed(2)}Cr`;
        if (amount >= 100000)
            return `₹${(amount / 100000).toFixed(1)}L`;
        return `₹${amount.toLocaleString('en-IN')}`;
    };
    const getMetricStatus = (metric, value) => {
        switch (metric) {
            case 'npv':
                return value > 0 ? 'positive' : 'negative';
            case 'irr':
                return value > inputs.discountRate ? 'positive' : 'negative';
            case 'payback':
                return value < 3 ? 'positive' : value < 5 ? 'neutral' : 'negative';
            case 'roi':
                return value > 20 ? 'positive' : value > 10 ? 'neutral' : 'negative';
            default:
                return 'neutral';
        }
    };
    const getStatusIcon = (status) => {
        switch (status) {
            case 'positive':
                return _jsx(CheckCircle, { className: "w-5 h-5 text-green-600" });
            case 'negative':
                return _jsx(AlertCircle, { className: "w-5 h-5 text-red-600" });
            default:
                return _jsx(AlertTriangle, { className: "w-5 h-5 text-yellow-600" });
        }
    };
    const getStatusText = (status) => {
        switch (status) {
            case 'positive':
                return 'text-green-600';
            case 'negative':
                return 'text-red-600';
            default:
                return 'text-yellow-600';
        }
    };
    return (_jsxs("div", { className: "space-y-6", children: [uploadedData && uploadedData.investment.length > 0 && (_jsx("div", { className: "bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200 rounded-lg p-4", children: _jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("div", { className: "flex items-center gap-3", children: [_jsx(CheckCircle, { className: "w-5 h-5 text-green-600" }), _jsxs("div", { children: [_jsxs("p", { className: "font-semibold text-green-900", children: ["\u2705 ", uploadedData.investment.length, " Investment Project", uploadedData.investment.length > 1 ? 's' : '', " Loaded"] }), _jsx("p", { className: "text-sm text-green-700", children: "Select a project from your uploaded data or enter manually below" })] })] }), uploadedData.investment.length > 1 && (_jsx("select", { onChange: (e) => {
                                const project = uploadedData.investment[Number(e.target.value)];
                                if (project) {
                                    setInputs({
                                        projectName: project.projectName,
                                        investment: project.investment,
                                        annualReturns: project.yearlyRevenue - project.yearlyCost,
                                        projectLife: project.projectYears,
                                        riskLevel: 'medium',
                                        discountRate: project.discountRate,
                                        strategicValue: 'medium',
                                        cashPosition: project.investment * 1.5
                                    });
                                }
                            }, className: "px-3 py-2 border border-green-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-green-500", children: uploadedData.investment.map((project, idx) => (_jsxs("option", { value: idx, children: [project.projectName, " - \u20B9", (project.investment / 10000000).toFixed(1), "Cr"] }, idx))) }))] }) })), _jsxs("div", { className: "bg-white rounded-lg border border-gray-200 p-6", children: [_jsx("h3", { className: "text-lg font-semibold text-gray-900 mb-4", children: "Investment Details" }), _jsxs("div", { className: "grid grid-cols-2 gap-4", children: [_jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-1", children: "Project Name" }), _jsx("input", { type: "text", value: inputs.projectName, onChange: (e) => setInputs({ ...inputs, projectName: e.target.value }), className: "w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-1", children: "Total Investment (\u20B9)" }), _jsx("input", { type: "number", value: inputs.investment, onChange: (e) => setInputs({ ...inputs, investment: Number(e.target.value) }), className: "w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-1", children: "Annual Returns (\u20B9)" }), _jsx("input", { type: "number", value: inputs.annualReturns, onChange: (e) => setInputs({ ...inputs, annualReturns: Number(e.target.value) }), className: "w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-1", children: "Project Life (years)" }), _jsx("input", { type: "number", value: inputs.projectLife, onChange: (e) => setInputs({ ...inputs, projectLife: Number(e.target.value) }), className: "w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-2", children: "Risk Level" }), _jsx("div", { className: "flex gap-4", children: ['low', 'medium', 'high'].map((level) => (_jsxs("label", { className: "flex items-center gap-2 cursor-pointer", children: [_jsx("input", { type: "radio", name: "riskLevel", value: level, checked: inputs.riskLevel === level, onChange: (e) => setInputs({ ...inputs, riskLevel: e.target.value }), className: "text-amber-600 focus:ring-amber-500" }), _jsx("span", { className: "text-sm text-gray-700 capitalize", children: level })] }, level))) })] }), _jsxs("div", { children: [_jsxs("label", { className: "block text-sm font-medium text-gray-700 mb-1", children: ["Discount Rate (%) ", _jsx("span", { className: "text-gray-500 text-xs", children: "\u2190 auto from WACC" })] }), _jsx("input", { type: "number", value: inputs.discountRate, onChange: (e) => setInputs({ ...inputs, discountRate: Number(e.target.value) }), className: "w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-2", children: "Strategic Value" }), _jsx("div", { className: "flex gap-4", children: ['low', 'medium', 'high'].map((level) => (_jsxs("label", { className: "flex items-center gap-2 cursor-pointer", children: [_jsx("input", { type: "radio", name: "strategicValue", value: level, checked: inputs.strategicValue === level, onChange: (e) => setInputs({ ...inputs, strategicValue: e.target.value }), className: "text-amber-600 focus:ring-amber-500" }), _jsx("span", { className: "text-sm text-gray-700 capitalize", children: level })] }, level))) })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-1", children: "Current Cash Position (\u20B9)" }), _jsx("input", { type: "number", value: inputs.cashPosition, onChange: (e) => setInputs({ ...inputs, cashPosition: Number(e.target.value) }), className: "w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent" })] })] }), _jsx("button", { onClick: handleCalculate, disabled: loading, className: "mt-6 px-6 py-3 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2", children: loading ? 'Calculating...' : 'Calculate & Decide ▶' })] }), metrics && (_jsxs(_Fragment, { children: [_jsxs("div", { className: "bg-white rounded-lg border border-gray-200 p-6", children: [_jsx("h3", { className: "text-lg font-semibold text-gray-900 mb-4", children: "Financial Metrics" }), _jsxs("div", { className: "grid grid-cols-4 gap-6", children: [_jsxs("div", { className: "space-y-1", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("span", { className: "text-sm font-medium text-gray-700", children: "NPV" }), getStatusIcon(getMetricStatus('npv', metrics.npv))] }), _jsx("div", { className: `text-2xl font-bold ${getStatusText(getMetricStatus('npv', metrics.npv))}`, children: formatCurrency(metrics.npv) }), _jsx("p", { className: "text-xs text-gray-600", children: metrics.npv > 0 ? 'Positive' : 'Negative' })] }), _jsxs("div", { className: "space-y-1", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("span", { className: "text-sm font-medium text-gray-700", children: "IRR" }), getStatusIcon(getMetricStatus('irr', metrics.irr))] }), _jsxs("div", { className: `text-2xl font-bold ${getStatusText(getMetricStatus('irr', metrics.irr))}`, children: [metrics.irr, "%"] }), _jsxs("p", { className: "text-xs text-gray-600", children: [metrics.irr > inputs.discountRate ? 'Above hurdle' : 'Below hurdle', " (", inputs.discountRate, "%)"] })] }), _jsxs("div", { className: "space-y-1", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("span", { className: "text-sm font-medium text-gray-700", children: "Payback" }), getStatusIcon(getMetricStatus('payback', metrics.payback))] }), _jsxs("div", { className: `text-2xl font-bold ${getStatusText(getMetricStatus('payback', metrics.payback))}`, children: [metrics.payback, " yrs"] }), _jsx("p", { className: "text-xs text-gray-600", children: metrics.payback < 3 ? 'Excellent' : metrics.payback < 5 ? 'Borderline' : 'Long' })] }), _jsxs("div", { className: "space-y-1", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("span", { className: "text-sm font-medium text-gray-700", children: "ROI" }), getStatusIcon(getMetricStatus('roi', metrics.roi))] }), _jsxs("div", { className: `text-2xl font-bold ${getStatusText(getMetricStatus('roi', metrics.roi))}`, children: [metrics.roi, "%"] }), _jsx("p", { className: "text-xs text-gray-600", children: metrics.roi > 20 ? 'Good return' : 'Moderate return' })] })] }), _jsx("div", { className: "mt-4 pt-4 border-t border-gray-200", children: _jsxs("div", { className: "flex items-center justify-between", children: [_jsx("span", { className: "text-sm font-medium text-gray-700", children: "Risk Score" }), _jsxs("span", { className: `text-lg font-bold ${metrics.riskScore > 7 ? 'text-red-600' : metrics.riskScore > 5 ? 'text-yellow-600' : 'text-green-600'}`, children: [metrics.riskScore, "/10"] })] }) })] }), aiRecommendation && (_jsxs("div", { className: "bg-gradient-to-r from-purple-50 to-indigo-50 rounded-lg border border-purple-200 p-6", children: [_jsxs("div", { className: "flex items-start justify-between mb-4", children: [_jsxs("div", { children: [_jsx("h3", { className: "text-lg font-semibold text-gray-900 flex items-center gap-2", children: "\uD83E\uDD16 AI Recommendation (Amazon Nova)" }), _jsx("p", { className: "text-sm text-gray-600 mt-1", children: "Powered by AWS Bedrock" })] }), _jsxs("div", { className: "text-right", children: [_jsxs("div", { className: "text-2xl font-bold text-purple-600", children: [aiRecommendation.confidence, "%"] }), _jsx("div", { className: "text-xs text-gray-600", children: "Confidence" })] })] }), _jsxs("div", { className: "bg-white rounded-lg p-4 mb-4", children: [_jsx("div", { className: "flex items-center gap-2 mb-3", children: _jsxs("span", { className: `px-3 py-1 rounded-full text-sm font-medium ${aiRecommendation.outcome === 'approve' ? 'bg-green-100 text-green-800' :
                                                aiRecommendation.outcome === 'conditional' ? 'bg-yellow-100 text-yellow-800' :
                                                    'bg-red-100 text-red-800'}`, children: [aiRecommendation.outcome.toUpperCase(), aiRecommendation.outcome === 'approve' && ' ✅', aiRecommendation.outcome === 'conditional' && ' ⚠️', aiRecommendation.outcome === 'reject' && ' ❌'] }) }), _jsx("p", { className: "text-gray-800 leading-relaxed whitespace-pre-wrap", children: aiRecommendation.recommendation })] }), aiRecommendation.confidenceFactors && aiRecommendation.confidenceFactors.length > 0 && (_jsxs("div", { className: "space-y-2", children: [_jsx("h4", { className: "text-sm font-semibold text-gray-900", children: "Confidence Factors:" }), aiRecommendation.confidenceFactors.map((factor, idx) => (_jsxs("div", { className: "flex items-start gap-2 text-sm", children: [factor.status === 'positive' && _jsx(CheckCircle, { className: "w-4 h-4 text-green-600 mt-0.5" }), factor.status === 'negative' && _jsx(AlertCircle, { className: "w-4 h-4 text-red-600 mt-0.5" }), factor.status === 'neutral' && _jsx(AlertTriangle, { className: "w-4 h-4 text-yellow-600 mt-0.5" }), _jsxs("div", { children: [_jsx("span", { className: "font-medium text-gray-900", children: factor.factor }), _jsxs("span", { className: "text-gray-600", children: [" (", factor.impact, " confidence)"] }), _jsx("p", { className: "text-gray-600", children: factor.detail })] })] }, idx)))] }))] })), _jsxs("div", { className: "bg-white rounded-lg border border-gray-200 p-6", children: [_jsx("h3", { className: "text-lg font-semibold text-gray-900 mb-4", children: "CFO Decision" }), _jsxs("div", { className: "space-y-4", children: [_jsxs("div", { className: "flex gap-3", children: [_jsx("button", { onClick: () => setCfoDecision('approve'), className: `flex-1 px-6 py-3 rounded-lg font-medium transition-colors ${cfoDecision === 'approve'
                                                    ? 'bg-green-600 text-white'
                                                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`, children: "Approve \u2705" }), _jsx("button", { onClick: () => setCfoDecision('reject'), className: `flex-1 px-6 py-3 rounded-lg font-medium transition-colors ${cfoDecision === 'reject'
                                                    ? 'bg-red-600 text-white'
                                                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`, children: "Reject \u274C" }), _jsx("button", { onClick: () => setCfoDecision('conditional'), className: `flex-1 px-6 py-3 rounded-lg font-medium transition-colors ${cfoDecision === 'conditional'
                                                    ? 'bg-yellow-600 text-white'
                                                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`, children: "Hold \u23F8\uFE0F" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-1", children: "CFO Notes (optional)" }), _jsx("textarea", { value: cfoNotes, onChange: (e) => setCfoNotes(e.target.value), placeholder: "Add notes before saving...", rows: 3, className: "w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent" })] }), _jsx("button", { onClick: handleSave, disabled: !cfoDecision, className: "w-full px-6 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2", children: "Save to Audit Trail \uD83D\uDCCB" })] })] })] })), _jsxs("div", { className: "bg-white rounded-lg border border-gray-200 p-6", children: [_jsx("h3", { className: "text-lg font-semibold text-gray-900 mb-4", children: "Compare Multiple Projects" }), _jsx("div", { className: "overflow-x-auto", children: _jsxs("table", { className: "w-full", children: [_jsx("thead", { children: _jsxs("tr", { className: "border-b border-gray-200", children: [_jsx("th", { className: "text-left py-3 px-4 text-sm font-medium text-gray-700", children: "Project" }), _jsx("th", { className: "text-right py-3 px-4 text-sm font-medium text-gray-700", children: "Investment" }), _jsx("th", { className: "text-right py-3 px-4 text-sm font-medium text-gray-700", children: "NPV" }), _jsx("th", { className: "text-right py-3 px-4 text-sm font-medium text-gray-700", children: "IRR" }), _jsx("th", { className: "text-right py-3 px-4 text-sm font-medium text-gray-700", children: "Payback" }), _jsx("th", { className: "text-right py-3 px-4 text-sm font-medium text-gray-700", children: "Score" }), _jsx("th", { className: "text-center py-3 px-4 text-sm font-medium text-gray-700", children: "Decision" })] }) }), _jsx("tbody", { children: compareProjectsData.map((project, idx) => (_jsxs("tr", { className: "border-b border-gray-100 hover:bg-gray-50", children: [_jsx("td", { className: "py-3 px-4 text-sm font-medium text-gray-900", children: project.name }), _jsx("td", { className: "py-3 px-4 text-sm text-right text-gray-700", children: formatCurrency(project.investment) }), _jsx("td", { className: `py-3 px-4 text-sm text-right font-medium ${project.npv > 0 ? 'text-green-600' : 'text-red-600'}`, children: formatCurrency(project.npv) }), _jsxs("td", { className: "py-3 px-4 text-sm text-right text-gray-700", children: [project.irr, "%"] }), _jsxs("td", { className: "py-3 px-4 text-sm text-right text-gray-700", children: [project.payback, "y"] }), _jsx("td", { className: "py-3 px-4 text-sm text-right font-medium text-gray-900", children: project.score }), _jsx("td", { className: "py-3 px-4 text-center", children: project.decision === 'approve' ? (_jsx("span", { className: "text-green-600 font-medium", children: "\u2705" })) : (_jsx("span", { className: "text-red-600 font-medium", children: "\u274C" })) })] }, idx))) })] }) }), _jsx("div", { className: "mt-4 pt-4 border-t border-gray-200", children: _jsx("p", { className: "text-sm font-medium text-purple-600", children: "\uD83E\uDD16 AI RANKING: Sales Expansion > AI Platform > ERP System > New Office" }) })] })] }));
};
export default InvestmentDecision;
