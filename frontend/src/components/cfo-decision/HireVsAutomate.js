import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState } from 'react';
import { generateDecisionRecommendation } from '../../services/decisionEngine';
const HireVsAutomate = ({ onSaveToAudit }) => {
    const [inputs, setInputs] = useState({
        process: 'Invoice Processing',
        currentTeam: 3,
        monthlyVolume: 500,
        hoursPerUnit: 0.5,
        additionalNeeded: 2,
        avgSalary: 600000,
        automationTool: 'FinReportAI AP Module',
        setupCost: 800000,
        monthlyCost: 25000,
        automationPercentage: 80
    });
    const [results, setResults] = useState(null);
    const [aiRecommendation, setAiRecommendation] = useState(null);
    const [loading, setLoading] = useState(false);
    const handleAnalyze = async () => {
        setLoading(true);
        const hireCost = inputs.additionalNeeded * inputs.avgSalary;
        const automationAnnualCost = inputs.setupCost + (inputs.monthlyCost * 12);
        const breakeven = Math.ceil(inputs.setupCost / ((hireCost - (inputs.monthlyCost * 12)) / 12));
        const fiveYearSaving = (hireCost * 5) - (inputs.setupCost + (inputs.monthlyCost * 12 * 5));
        const calculated = {
            hireCost,
            automationAnnualCost,
            breakeven,
            fiveYearSaving
        };
        setResults(calculated);
        try {
            const recommendation = await generateDecisionRecommendation('hire_vs_automate', {
                process: inputs.process,
                hireCost,
                hires: inputs.additionalNeeded,
                setupCost: inputs.setupCost,
                monthlyCost: inputs.monthlyCost,
                automationPct: inputs.automationPercentage,
                breakeven,
                fiveYearSaving
            });
            setAiRecommendation(recommendation);
        }
        catch (error) {
            console.error('Error getting AI recommendation:', error);
        }
        setLoading(false);
    };
    const formatCurrency = (amount) => {
        if (amount >= 10000000)
            return `₹${(amount / 10000000).toFixed(1)}Cr`;
        if (amount >= 100000)
            return `₹${(amount / 100000).toFixed(1)}L`;
        return `₹${amount.toLocaleString('en-IN')}`;
    };
    return (_jsxs("div", { className: "space-y-6", children: [_jsxs("div", { className: "bg-white rounded-lg border border-gray-200 p-6", children: [_jsx("h3", { className: "text-lg font-semibold text-gray-900 mb-4", children: "Process Details" }), _jsxs("div", { className: "grid grid-cols-2 gap-4", children: [_jsxs("div", { className: "col-span-2", children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-1", children: "Process" }), _jsx("input", { type: "text", value: inputs.process, onChange: (e) => setInputs({ ...inputs, process: e.target.value }), className: "w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-1", children: "Current team (people)" }), _jsx("input", { type: "number", value: inputs.currentTeam, onChange: (e) => setInputs({ ...inputs, currentTeam: Number(e.target.value) }), className: "w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-1", children: "Monthly volume" }), _jsx("input", { type: "number", value: inputs.monthlyVolume, onChange: (e) => setInputs({ ...inputs, monthlyVolume: Number(e.target.value) }), className: "w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-1", children: "Hours per unit" }), _jsx("input", { type: "number", step: "0.1", value: inputs.hoursPerUnit, onChange: (e) => setInputs({ ...inputs, hoursPerUnit: Number(e.target.value) }), className: "w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-1", children: "Additional needed (people)" }), _jsx("input", { type: "number", value: inputs.additionalNeeded, onChange: (e) => setInputs({ ...inputs, additionalNeeded: Number(e.target.value) }), className: "w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-1", children: "Avg salary (\u20B9/year)" }), _jsx("input", { type: "number", value: inputs.avgSalary, onChange: (e) => setInputs({ ...inputs, avgSalary: Number(e.target.value) }), className: "w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-1", children: "Automation tool/vendor" }), _jsx("input", { type: "text", value: inputs.automationTool, onChange: (e) => setInputs({ ...inputs, automationTool: e.target.value }), className: "w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-1", children: "Setup cost (\u20B9)" }), _jsx("input", { type: "number", value: inputs.setupCost, onChange: (e) => setInputs({ ...inputs, setupCost: Number(e.target.value) }), className: "w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-1", children: "Monthly cost (\u20B9)" }), _jsx("input", { type: "number", value: inputs.monthlyCost, onChange: (e) => setInputs({ ...inputs, monthlyCost: Number(e.target.value) }), className: "w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-1", children: "Automation % of volume" }), _jsx("input", { type: "number", value: inputs.automationPercentage, onChange: (e) => setInputs({ ...inputs, automationPercentage: Number(e.target.value) }), className: "w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500" })] })] }), _jsx("button", { onClick: handleAnalyze, disabled: loading, className: "mt-6 px-6 py-3 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors font-medium disabled:opacity-50", children: loading ? 'Analyzing...' : 'Analyze ▶' })] }), results && (_jsxs(_Fragment, { children: [_jsxs("div", { className: "bg-white rounded-lg border border-gray-200 p-6", children: [_jsx("h3", { className: "text-lg font-semibold text-gray-900 mb-4", children: "Financial Analysis" }), _jsxs("div", { className: "grid grid-cols-2 gap-6", children: [_jsxs("div", { className: "space-y-3", children: [_jsxs("h4", { className: "font-semibold text-blue-600", children: ["HIRE: ", inputs.additionalNeeded, " people"] }), _jsxs("p", { className: "text-3xl font-bold text-gray-900", children: [formatCurrency(results.hireCost), _jsx("span", { className: "text-sm text-gray-600", children: "/year" })] }), _jsx("p", { className: "text-sm text-gray-600", children: "Break-even: Never (recurring cost)" })] }), _jsxs("div", { className: "space-y-3", children: [_jsx("h4", { className: "font-semibold text-green-600", children: "AUTOMATE" }), _jsxs("p", { className: "text-lg text-gray-700", children: [formatCurrency(results.automationAnnualCost), " Year 1"] }), _jsxs("p", { className: "text-lg text-gray-700", children: [formatCurrency(inputs.monthlyCost * 12), " Year 2+"] }), _jsxs("p", { className: "text-sm font-medium text-green-600", children: ["Break-even: ", results.breakeven, " months"] })] })] }), _jsx("div", { className: "mt-6 pt-4 border-t border-gray-200 text-center", children: _jsxs("p", { className: "text-2xl font-bold text-green-600", children: ["5-year saving from automation: ", formatCurrency(results.fiveYearSaving)] }) })] }), aiRecommendation && !(aiRecommendation.confidence === 0 && (aiRecommendation.recommendation?.startsWith('Unable to generate') || /security token|AI call failed|invalid.*token/i.test(aiRecommendation.recommendation || ''))) && (_jsxs("div", { className: "bg-gradient-to-r from-purple-50 to-indigo-50 rounded-lg border border-purple-200 p-6", children: [_jsxs("div", { className: "flex items-start justify-between mb-4", children: [_jsx("h3", { className: "text-lg font-semibold text-gray-900", children: "\uD83E\uDD16 AI Recommendation (Amazon Nova)" }), _jsxs("div", { className: "text-2xl font-bold text-purple-600", children: [aiRecommendation.confidence, "%"] })] }), _jsxs("div", { className: "bg-white rounded-lg p-4", children: [_jsx("div", { className: "mb-3", children: _jsxs("span", { className: `px-3 py-1 rounded-full text-sm font-medium ${aiRecommendation.outcome === 'automate' ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800'}`, children: [aiRecommendation.outcome.toUpperCase(), " \u2705"] }) }), _jsx("p", { className: "text-gray-800 leading-relaxed whitespace-pre-wrap", children: aiRecommendation.recommendation })] })] }))] }))] }));
};
export default HireVsAutomate;
