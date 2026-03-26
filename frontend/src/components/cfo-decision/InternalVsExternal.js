import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState } from 'react';
import { CheckCircle, XCircle, AlertTriangle } from 'lucide-react';
import { generateDecisionRecommendation } from '../../services/decisionEngine';
const InternalVsExternal = ({ onSaveToAudit }) => {
    const [inputs, setInputs] = useState({
        functionName: 'Month-End Financial Close',
        category: 'Finance',
        currentTeam: 5,
        costPerPerson: 800000,
        currentTime: 5,
        errorRate: 2.3,
        teamUtilization: 85,
        trainingCost: 200000,
        vendorName: 'EXL / WNS / Genpact',
        vendorMonthlyCost: 400000,
        vendorSLA: 3,
        vendorErrorRate: 0.5,
        transitionTime: 3,
        exitClause: '6 months notice'
    });
    const [results, setResults] = useState(null);
    const [aiRecommendation, setAiRecommendation] = useState(null);
    const [loading, setLoading] = useState(false);
    const [cfoDecision, setCfoDecision] = useState('');
    const [cfoNotes, setCfoNotes] = useState('');
    const commonTemplates = [
        { name: 'AP Processing', category: 'Finance', team: 3, cost: 600000 },
        { name: 'Payroll', category: 'HR', team: 2, cost: 700000 },
        { name: 'IT Support', category: 'IT', team: 5, cost: 900000 },
        { name: 'Tax Filing', category: 'Finance', team: 2, cost: 1200000 },
        { name: 'Internal Audit', category: 'Finance', team: 4, cost: 1500000 },
        { name: 'Treasury', category: 'Finance', team: 3, cost: 1000000 },
        { name: 'Legal', category: 'Legal', team: 3, cost: 1500000 }
    ];
    const loadTemplate = (template) => {
        setInputs({
            ...inputs,
            functionName: template.name,
            category: template.category,
            currentTeam: template.team,
            costPerPerson: template.cost
        });
    };
    const handleAnalyze = async () => {
        setLoading(true);
        const internalCost = inputs.currentTeam * inputs.costPerPerson + inputs.trainingCost;
        const externalCost = inputs.vendorMonthlyCost * 12;
        const internalScore = calculateInternalScore();
        const externalScore = calculateExternalScore();
        const calculated = {
            internalCost,
            externalCost,
            costDifference: externalCost - internalCost,
            internalScore,
            externalScore
        };
        setResults(calculated);
        // Get AI recommendation
        try {
            const recommendation = await generateDecisionRecommendation('internal_vs_external', {
                function: inputs.functionName,
                internalCost,
                externalCost,
                internalErrorRate: inputs.errorRate,
                externalErrorRate: inputs.vendorErrorRate,
                internalDays: inputs.currentTime,
                externalDays: inputs.vendorSLA,
                knowledgeRisk: inputs.teamUtilization > 80 ? 'high' : 'medium'
            });
            setAiRecommendation(recommendation);
        }
        catch (error) {
            console.error('Error getting AI recommendation:', error);
        }
        setLoading(false);
    };
    const calculateInternalScore = () => {
        let score = 50;
        const internalCost = inputs.currentTeam * inputs.costPerPerson;
        const externalCost = inputs.vendorMonthlyCost * 12;
        if (internalCost < externalCost)
            score += 15;
        if (inputs.currentTime <= inputs.vendorSLA)
            score += 10;
        if (inputs.errorRate <= inputs.vendorErrorRate)
            score += 10;
        score += 15; // control advantage
        score += 10; // knowledge retention
        return Math.min(100, score);
    };
    const calculateExternalScore = () => {
        let score = 50;
        const externalCost = inputs.vendorMonthlyCost * 12;
        const internalCost = inputs.currentTeam * inputs.costPerPerson;
        if (externalCost < internalCost)
            score += 10;
        if (inputs.vendorSLA < inputs.currentTime)
            score += 15;
        if (inputs.vendorErrorRate < inputs.errorRate)
            score += 15;
        score += 10; // scalability
        score += 8; // reduce burden
        return Math.min(100, score);
    };
    const formatCurrency = (amount) => {
        if (amount >= 10000000)
            return `₹${(amount / 10000000).toFixed(1)}Cr`;
        if (amount >= 100000)
            return `₹${(amount / 100000).toFixed(1)}L`;
        return `₹${amount.toLocaleString('en-IN')}`;
    };
    const handleSave = () => {
        if (!results || !aiRecommendation)
            return;
        const decision = {
            id: `ive-${Date.now()}`,
            type: 'internal_vs_external',
            title: `${inputs.functionName} - Outsource Decision`,
            date: new Date().toISOString().split('T')[0],
            inputs,
            results: {
                primaryMetric: results.costDifference,
                secondaryMetrics: {
                    internalCost: results.internalCost,
                    externalCost: results.externalCost,
                    internalScore: results.internalScore,
                    externalScore: results.externalScore
                },
                riskScore: 0,
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
    return (_jsxs("div", { className: "space-y-6", children: [_jsxs("div", { className: "bg-gradient-to-r from-blue-50 to-cyan-50 rounded-lg border border-blue-200 p-4", children: [_jsx("h4", { className: "text-sm font-semibold text-gray-900 mb-3", children: "Quick Templates (common outsource decisions):" }), _jsx("div", { className: "flex flex-wrap gap-2", children: commonTemplates.map((template, idx) => (_jsx("button", { onClick: () => loadTemplate(template), className: "px-3 py-1.5 bg-white border border-blue-300 rounded-lg hover:bg-blue-50 transition-colors text-sm font-medium text-gray-700", children: template.name }, idx))) })] }), _jsxs("div", { className: "bg-white rounded-lg border border-gray-200 p-6", children: [_jsxs("div", { className: "grid grid-cols-2 gap-4 mb-6", children: [_jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-1", children: "Function" }), _jsx("input", { type: "text", value: inputs.functionName, onChange: (e) => setInputs({ ...inputs, functionName: e.target.value }), className: "w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-1", children: "Category" }), _jsxs("select", { value: inputs.category, onChange: (e) => setInputs({ ...inputs, category: e.target.value }), className: "w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent", children: [_jsx("option", { children: "Finance" }), _jsx("option", { children: "HR" }), _jsx("option", { children: "IT" }), _jsx("option", { children: "Legal" }), _jsx("option", { children: "Operations" })] })] })] }), _jsxs("div", { className: "grid grid-cols-2 gap-6", children: [_jsxs("div", { className: "space-y-4", children: [_jsx("h4", { className: "font-semibold text-gray-900 border-b pb-2", children: "\uD83C\uDFE2 INTERNAL OPTION" }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-1", children: "Current team (people)" }), _jsx("input", { type: "number", value: inputs.currentTeam, onChange: (e) => setInputs({ ...inputs, currentTeam: Number(e.target.value) }), className: "w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-1", children: "Avg cost/person (\u20B9/year)" }), _jsx("input", { type: "number", value: inputs.costPerPerson, onChange: (e) => setInputs({ ...inputs, costPerPerson: Number(e.target.value) }), className: "w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-1", children: "Current time (days for close cycle)" }), _jsx("input", { type: "number", value: inputs.currentTime, onChange: (e) => setInputs({ ...inputs, currentTime: Number(e.target.value) }), className: "w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-1", children: "Error rate (%)" }), _jsx("input", { type: "number", step: "0.1", value: inputs.errorRate, onChange: (e) => setInputs({ ...inputs, errorRate: Number(e.target.value) }), className: "w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-1", children: "Team utilization (%)" }), _jsx("input", { type: "number", value: inputs.teamUtilization, onChange: (e) => setInputs({ ...inputs, teamUtilization: Number(e.target.value) }), className: "w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-1", children: "Training cost (\u20B9/year)" }), _jsx("input", { type: "number", value: inputs.trainingCost, onChange: (e) => setInputs({ ...inputs, trainingCost: Number(e.target.value) }), className: "w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent" })] })] }), _jsxs("div", { className: "space-y-4", children: [_jsx("h4", { className: "font-semibold text-gray-900 border-b pb-2", children: "\uD83C\uDF10 EXTERNAL / OUTSOURCE" }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-1", children: "Vendor" }), _jsx("input", { type: "text", value: inputs.vendorName, onChange: (e) => setInputs({ ...inputs, vendorName: e.target.value }), className: "w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-1", children: "Monthly cost (\u20B9)" }), _jsx("input", { type: "number", value: inputs.vendorMonthlyCost, onChange: (e) => setInputs({ ...inputs, vendorMonthlyCost: Number(e.target.value) }), className: "w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-1", children: "SLA committed (days)" }), _jsx("input", { type: "number", value: inputs.vendorSLA, onChange: (e) => setInputs({ ...inputs, vendorSLA: Number(e.target.value) }), className: "w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-1", children: "Error rate SLA (%)" }), _jsx("input", { type: "number", step: "0.1", value: inputs.vendorErrorRate, onChange: (e) => setInputs({ ...inputs, vendorErrorRate: Number(e.target.value) }), className: "w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-1", children: "Transition time (months)" }), _jsx("input", { type: "number", value: inputs.transitionTime, onChange: (e) => setInputs({ ...inputs, transitionTime: Number(e.target.value) }), className: "w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-1", children: "Exit clause" }), _jsx("input", { type: "text", value: inputs.exitClause, onChange: (e) => setInputs({ ...inputs, exitClause: e.target.value }), className: "w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent" })] })] })] }), _jsx("button", { onClick: handleAnalyze, disabled: loading, className: "mt-6 px-6 py-3 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed", children: loading ? 'Analyzing...' : 'Analyze Decision ▶' })] }), results && (_jsxs(_Fragment, { children: [_jsxs("div", { className: "bg-white rounded-lg border border-gray-200 p-6", children: [_jsx("h3", { className: "text-lg font-semibold text-gray-900 mb-4", children: "Cost Analysis" }), _jsxs("div", { className: "grid grid-cols-2 gap-6", children: [_jsxs("div", { children: [_jsx("h4", { className: "font-semibold text-blue-600 mb-3", children: "INTERNAL:" }), _jsxs("div", { className: "space-y-2 text-sm", children: [_jsxs("div", { className: "flex justify-between", children: [_jsx("span", { className: "text-gray-600", children: "Team cost:" }), _jsxs("span", { className: "font-medium", children: [formatCurrency(inputs.currentTeam * inputs.costPerPerson), "/year"] })] }), _jsxs("div", { className: "flex justify-between", children: [_jsx("span", { className: "text-gray-600", children: "Training:" }), _jsxs("span", { className: "font-medium", children: [formatCurrency(inputs.trainingCost), "/year"] })] }), _jsxs("div", { className: "flex justify-between", children: [_jsx("span", { className: "text-gray-600", children: "Tools:" }), _jsx("span", { className: "font-medium", children: "\u20B93L/year" })] }), _jsxs("div", { className: "flex justify-between", children: [_jsx("span", { className: "text-gray-600", children: "Management:" }), _jsx("span", { className: "font-medium", children: "\u20B95L/year" })] }), _jsxs("div", { className: "flex justify-between pt-2 border-t border-gray-200 font-semibold", children: [_jsx("span", { children: "Total:" }), _jsxs("span", { className: "text-blue-600 text-lg", children: [formatCurrency(results.internalCost), "/year"] })] })] })] }), _jsxs("div", { children: [_jsx("h4", { className: "font-semibold text-green-600 mb-3", children: "EXTERNAL:" }), _jsxs("div", { className: "space-y-2 text-sm", children: [_jsxs("div", { className: "flex justify-between", children: [_jsx("span", { className: "text-gray-600", children: "Monthly:" }), _jsxs("span", { className: "font-medium", children: [formatCurrency(inputs.vendorMonthlyCost * 12), "/year"] })] }), _jsxs("div", { className: "flex justify-between", children: [_jsx("span", { className: "text-gray-600", children: "Setup:" }), _jsx("span", { className: "font-medium", children: "\u20B95L one-time" })] }), _jsxs("div", { className: "flex justify-between pt-2 border-t border-gray-200 font-semibold", children: [_jsx("span", { children: "Total:" }), _jsxs("span", { className: "text-green-600 text-lg", children: [formatCurrency(results.externalCost), "/year"] })] }), _jsx("div", { className: "pt-2 border-t border-gray-200 text-xs text-gray-600", children: results.costDifference > 0 ? (_jsxs("span", { className: "text-red-600", children: ["+", ((results.costDifference / results.internalCost) * 100).toFixed(0), "% more expensive"] })) : (_jsxs("span", { className: "text-green-600", children: [((Math.abs(results.costDifference) / results.externalCost) * 100).toFixed(0), "% cheaper"] })) })] })] })] })] }), _jsxs("div", { className: "bg-white rounded-lg border border-gray-200 p-6", children: [_jsx("h3", { className: "text-lg font-semibold text-gray-900 mb-4", children: "Quality Scorecard" }), _jsx("div", { className: "space-y-3", children: [
                                    {
                                        name: 'Cost',
                                        internal: formatCurrency(results.internalCost),
                                        external: formatCurrency(results.externalCost),
                                        internalBetter: results.internalCost < results.externalCost
                                    },
                                    {
                                        name: 'Close cycle',
                                        internal: `${inputs.currentTime} days`,
                                        external: `${inputs.vendorSLA} days`,
                                        internalBetter: inputs.currentTime <= inputs.vendorSLA
                                    },
                                    {
                                        name: 'Error rate',
                                        internal: `${inputs.errorRate}%`,
                                        external: `<${inputs.vendorErrorRate}%`,
                                        internalBetter: inputs.errorRate <= inputs.vendorErrorRate
                                    },
                                    { name: 'Scalability', internal: 'Limited', external: 'Flexible', internalBetter: false },
                                    { name: 'Control', internal: 'Full', external: 'Partial', internalBetter: true },
                                    { name: 'Knowledge retention', internal: 'High', external: 'Risk of loss', internalBetter: true },
                                    { name: 'Regulatory compliance', internal: 'Direct', external: 'Vendor managed', internalBetter: true },
                                    { name: 'Team morale impact', internal: 'None', external: 'Job concerns', internalBetter: true }
                                ].map((item, idx) => (_jsxs("div", { className: "grid grid-cols-3 gap-4 py-2 border-b border-gray-100 last:border-0", children: [_jsx("div", { className: "text-sm font-medium text-gray-700", children: item.name }), _jsxs("div", { className: "flex items-center gap-2", children: [item.internalBetter ? _jsx(CheckCircle, { className: "w-4 h-4 text-green-600" }) :
                                                    item.internal === 'Limited' ? _jsx(AlertTriangle, { className: "w-4 h-4 text-yellow-600" }) :
                                                        _jsx(XCircle, { className: "w-4 h-4 text-red-600" }), _jsx("span", { className: "text-sm text-gray-900", children: item.internal })] }), _jsxs("div", { className: "flex items-center gap-2", children: [!item.internalBetter ? _jsx(CheckCircle, { className: "w-4 h-4 text-green-600" }) :
                                                    item.external.includes('Risk') || item.external.includes('concerns') ? _jsx(XCircle, { className: "w-4 h-4 text-red-600" }) :
                                                        _jsx(AlertTriangle, { className: "w-4 h-4 text-yellow-600" }), _jsx("span", { className: "text-sm text-gray-900", children: item.external })] })] }, idx))) }), _jsxs("div", { className: "mt-4 pt-4 border-t border-gray-200 flex items-center justify-between", children: [_jsxs("div", { children: [_jsx("span", { className: "text-sm font-medium text-gray-700", children: "INTERNAL SCORE:" }), _jsxs("span", { className: "ml-2 text-2xl font-bold text-blue-600", children: [results.internalScore, "/100"] })] }), _jsxs("div", { children: [_jsx("span", { className: "text-sm font-medium text-gray-700", children: "EXTERNAL SCORE:" }), _jsxs("span", { className: "ml-2 text-2xl font-bold text-green-600", children: [results.externalScore, "/100"] })] })] })] }), aiRecommendation && !(aiRecommendation.confidence === 0 && (aiRecommendation.recommendation?.startsWith('Unable to generate') || /security token|AI call failed|invalid.*token/i.test(aiRecommendation.recommendation || ''))) && (_jsxs("div", { className: "bg-gradient-to-r from-purple-50 to-indigo-50 rounded-lg border border-purple-200 p-6", children: [_jsxs("div", { className: "flex items-start justify-between mb-4", children: [_jsxs("div", { children: [_jsx("h3", { className: "text-lg font-semibold text-gray-900", children: "\uD83E\uDD16 AI Recommendation" }), _jsx("p", { className: "text-sm text-gray-600 mt-1", children: "Powered by AWS Bedrock" })] }), _jsxs("div", { className: "text-right", children: [_jsxs("div", { className: "text-2xl font-bold text-purple-600", children: [aiRecommendation.confidence, "%"] }), _jsx("div", { className: "text-xs text-gray-600", children: "Confidence" })] })] }), _jsxs("div", { className: "bg-white rounded-lg p-4", children: [_jsx("div", { className: "flex items-center gap-2 mb-3", children: _jsxs("span", { className: `px-3 py-1 rounded-full text-sm font-medium ${aiRecommendation.outcome === 'internal' ? 'bg-blue-100 text-blue-800' :
                                                aiRecommendation.outcome === 'external' ? 'bg-green-100 text-green-800' :
                                                    'bg-purple-100 text-purple-800'}`, children: [aiRecommendation.outcome.toUpperCase(), " \u2705"] }) }), _jsx("p", { className: "text-gray-800 leading-relaxed whitespace-pre-wrap", children: aiRecommendation.recommendation })] })] })), _jsxs("div", { className: "bg-white rounded-lg border border-gray-200 p-6", children: [_jsx("h3", { className: "text-lg font-semibold text-gray-900 mb-4", children: "CFO Decision" }), _jsxs("div", { className: "space-y-4", children: [_jsxs("div", { className: "flex gap-3", children: [_jsx("button", { onClick: () => setCfoDecision('internal'), className: `flex-1 px-6 py-3 rounded-lg font-medium transition-colors ${cfoDecision === 'internal' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`, children: "Go Internal" }), _jsx("button", { onClick: () => setCfoDecision('external'), className: `flex-1 px-6 py-3 rounded-lg font-medium transition-colors ${cfoDecision === 'external' ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`, children: "Outsource" }), _jsx("button", { onClick: () => setCfoDecision('hybrid'), className: `flex-1 px-6 py-3 rounded-lg font-medium transition-colors ${cfoDecision === 'hybrid' ? 'bg-purple-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`, children: "Hybrid Model \u2705" }), _jsx("button", { onClick: () => setCfoDecision('review'), className: `flex-1 px-6 py-3 rounded-lg font-medium transition-colors ${cfoDecision === 'review' ? 'bg-yellow-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`, children: "Hold" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-1", children: "CFO Notes (optional)" }), _jsx("textarea", { value: cfoNotes, onChange: (e) => setCfoNotes(e.target.value), placeholder: "Add notes before saving...", rows: 3, className: "w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent" })] }), _jsx("button", { onClick: handleSave, disabled: !cfoDecision, className: "w-full px-6 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed", children: "Save to Audit Trail \uD83D\uDCCB" })] })] })] }))] }));
};
export default InternalVsExternal;
