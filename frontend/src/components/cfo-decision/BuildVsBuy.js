import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState } from 'react';
import { CheckCircle, XCircle, AlertTriangle } from 'lucide-react';
import { calculateBuildVsBuyMetrics, generateDecisionRecommendation } from '../../services/decisionEngine';
const BuildVsBuy = ({ onSaveToAudit }) => {
    const [inputs, setInputs] = useState({
        requirement: 'FP&A Planning Software',
        coreRequirement: 'Budget, Forecast, Reporting',
        buildCost: 5000000,
        buildTimeline: 12,
        buildTeam: 5,
        buildMaintenance: 1500000,
        buildCustomization: 'full',
        vendorName: 'Anaplan / Workday / Other',
        buyCost: 8000000,
        buyImplementation: 3000000,
        buyTimeline: 3,
        buyCustomization: 'partial',
        vendorLockIn: 'high'
    });
    const [results, setResults] = useState(null);
    const [aiRecommendation, setAiRecommendation] = useState(null);
    const [loading, setLoading] = useState(false);
    const [cfoDecision, setCfoDecision] = useState('');
    const [cfoNotes, setCfoNotes] = useState('');
    const handleAnalyze = async () => {
        setLoading(true);
        const buildData = {
            buildCost: inputs.buildCost,
            buildMaintenance: inputs.buildMaintenance,
            teamCost: inputs.buildTeam * 1200000, // avg ₹12L per dev
            opportunityCost: inputs.buildTimeline > 6 ? 3000000 : 0,
            buildTimeline: inputs.buildTimeline,
            customization: inputs.buildCustomization
        };
        const buyData = {
            buyCost: inputs.buyCost,
            buyImplementation: inputs.buyImplementation,
            customizationCost: 2000000,
            supportCost: 2500000,
            buyTimeline: inputs.buyTimeline,
            vendorLockIn: inputs.vendorLockIn
        };
        const metrics = calculateBuildVsBuyMetrics(buildData, buyData, 5);
        setResults(metrics);
        // Get AI recommendation
        try {
            const recommendation = await generateDecisionRecommendation('build_vs_buy', {
                buildCost: inputs.buildCost,
                buildMaintenance: inputs.buildMaintenance,
                buildTotal: metrics.buildTotal,
                buySetup: inputs.buyImplementation,
                buyCost: inputs.buyCost,
                buyTotal: metrics.buyTotal,
                customizationNeed: inputs.buildCustomization,
                teamCapability: 'medium',
                timeSensitivity: inputs.buyTimeline < 6 ? 'high' : 'medium'
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
    const handleSave = () => {
        if (!results || !aiRecommendation)
            return;
        const decision = {
            id: `bvb-${Date.now()}`,
            type: 'build_vs_buy',
            title: `${inputs.requirement} - Build vs Buy`,
            date: new Date().toISOString().split('T')[0],
            inputs,
            results: {
                primaryMetric: results.savings,
                secondaryMetrics: {
                    buildTotal: results.buildTotal,
                    buyTotal: results.buyTotal,
                    buildScore: results.buildScore,
                    buyScore: results.buyScore
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
    return (_jsxs("div", { className: "space-y-6", children: [_jsxs("div", { className: "bg-white rounded-lg border border-gray-200 p-6", children: [_jsx("h3", { className: "text-lg font-semibold text-gray-900 mb-4", children: "Requirements" }), _jsxs("div", { className: "grid grid-cols-2 gap-4 mb-6", children: [_jsxs("div", { className: "col-span-2", children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-1", children: "What we need" }), _jsx("input", { type: "text", value: inputs.requirement, onChange: (e) => setInputs({ ...inputs, requirement: e.target.value }), className: "w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent" })] }), _jsxs("div", { className: "col-span-2", children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-1", children: "Core requirement" }), _jsx("input", { type: "text", value: inputs.coreRequirement, onChange: (e) => setInputs({ ...inputs, coreRequirement: e.target.value }), className: "w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent" })] })] }), _jsxs("div", { className: "grid grid-cols-2 gap-6", children: [_jsxs("div", { className: "space-y-4", children: [_jsx("h4", { className: "font-semibold text-gray-900 border-b pb-2", children: "\uD83C\uDFD7\uFE0F BUILD OPTION" }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-1", children: "Development cost (\u20B9)" }), _jsx("input", { type: "number", value: inputs.buildCost, onChange: (e) => setInputs({ ...inputs, buildCost: Number(e.target.value) }), className: "w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-1", children: "Build timeline (months)" }), _jsx("input", { type: "number", value: inputs.buildTimeline, onChange: (e) => setInputs({ ...inputs, buildTimeline: Number(e.target.value) }), className: "w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-1", children: "Team needed (developers)" }), _jsx("input", { type: "number", value: inputs.buildTeam, onChange: (e) => setInputs({ ...inputs, buildTeam: Number(e.target.value) }), className: "w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-1", children: "Annual maintenance (\u20B9)" }), _jsx("input", { type: "number", value: inputs.buildMaintenance, onChange: (e) => setInputs({ ...inputs, buildMaintenance: Number(e.target.value) }), className: "w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-2", children: "Customization" }), _jsx("div", { className: "space-y-2", children: ['full', 'partial', 'none'].map((level) => (_jsxs("label", { className: "flex items-center gap-2 cursor-pointer", children: [_jsx("input", { type: "radio", name: "buildCustomization", value: level, checked: inputs.buildCustomization === level, onChange: (e) => setInputs({ ...inputs, buildCustomization: e.target.value }), className: "text-amber-600 focus:ring-amber-500" }), _jsx("span", { className: "text-sm text-gray-700 capitalize", children: level })] }, level))) })] })] }), _jsxs("div", { className: "space-y-4", children: [_jsx("h4", { className: "font-semibold text-gray-900 border-b pb-2", children: "\uD83D\uDCB0 BUY OPTION" }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-1", children: "Vendor name" }), _jsx("input", { type: "text", value: inputs.vendorName, onChange: (e) => setInputs({ ...inputs, vendorName: e.target.value }), className: "w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-1", children: "License cost (\u20B9/year)" }), _jsx("input", { type: "number", value: inputs.buyCost, onChange: (e) => setInputs({ ...inputs, buyCost: Number(e.target.value) }), className: "w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-1", children: "Implementation (\u20B9, one-time)" }), _jsx("input", { type: "number", value: inputs.buyImplementation, onChange: (e) => setInputs({ ...inputs, buyImplementation: Number(e.target.value) }), className: "w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-1", children: "Go-live (months)" }), _jsx("input", { type: "number", value: inputs.buyTimeline, onChange: (e) => setInputs({ ...inputs, buyTimeline: Number(e.target.value) }), className: "w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-2", children: "Customization" }), _jsx("div", { className: "space-y-2", children: ['full', 'partial', 'none'].map((level) => (_jsxs("label", { className: "flex items-center gap-2 cursor-pointer", children: [_jsx("input", { type: "radio", name: "buyCustomization", value: level, checked: inputs.buyCustomization === level, onChange: (e) => setInputs({ ...inputs, buyCustomization: e.target.value }), className: "text-amber-600 focus:ring-amber-500" }), _jsx("span", { className: "text-sm text-gray-700 capitalize", children: level })] }, level))) })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-2", children: "Vendor lock-in" }), _jsx("div", { className: "space-y-2", children: ['high', 'medium', 'low'].map((level) => (_jsxs("label", { className: "flex items-center gap-2 cursor-pointer", children: [_jsx("input", { type: "radio", name: "vendorLockIn", value: level, checked: inputs.vendorLockIn === level, onChange: (e) => setInputs({ ...inputs, vendorLockIn: e.target.value }), className: "text-amber-600 focus:ring-amber-500" }), _jsx("span", { className: "text-sm text-gray-700 capitalize", children: level })] }, level))) })] })] })] }), _jsx("button", { onClick: handleAnalyze, disabled: loading, className: "mt-6 px-6 py-3 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed", children: loading ? 'Analyzing...' : 'Analyze Decision ▶' })] }), results && (_jsxs(_Fragment, { children: [_jsxs("div", { className: "bg-white rounded-lg border border-gray-200 p-6", children: [_jsx("h3", { className: "text-lg font-semibold text-gray-900 mb-4", children: "5-Year Cost Comparison" }), _jsxs("div", { className: "grid grid-cols-2 gap-6", children: [_jsxs("div", { className: "space-y-3", children: [_jsx("h4", { className: "font-semibold text-blue-600", children: "BUILD:" }), _jsxs("div", { className: "space-y-2 text-sm", children: [_jsxs("div", { className: "flex justify-between", children: [_jsx("span", { className: "text-gray-600", children: "Development:" }), _jsx("span", { className: "font-medium", children: formatCurrency(inputs.buildCost) })] }), _jsxs("div", { className: "flex justify-between", children: [_jsx("span", { className: "text-gray-600", children: "Maintenance (5yr):" }), _jsx("span", { className: "font-medium", children: formatCurrency(inputs.buildMaintenance * 5) })] }), _jsxs("div", { className: "flex justify-between", children: [_jsx("span", { className: "text-gray-600", children: "Team cost (5yr):" }), _jsx("span", { className: "font-medium", children: formatCurrency(inputs.buildTeam * 1200000 * 5) })] }), _jsxs("div", { className: "flex justify-between", children: [_jsx("span", { className: "text-gray-600", children: "Opportunity:" }), _jsx("span", { className: "font-medium", children: formatCurrency(inputs.buildTimeline > 6 ? 3000000 : 0) })] }), _jsxs("div", { className: "flex justify-between pt-2 border-t border-gray-200", children: [_jsx("span", { className: "font-semibold text-gray-900", children: "TOTAL:" }), _jsx("span", { className: "font-bold text-blue-600 text-lg", children: formatCurrency(results.buildTotal) })] })] })] }), _jsxs("div", { className: "space-y-3", children: [_jsx("h4", { className: "font-semibold text-green-600", children: "BUY:" }), _jsxs("div", { className: "space-y-2 text-sm", children: [_jsxs("div", { className: "flex justify-between", children: [_jsx("span", { className: "text-gray-600", children: "License (5yr):" }), _jsx("span", { className: "font-medium", children: formatCurrency(inputs.buyCost * 5) })] }), _jsxs("div", { className: "flex justify-between", children: [_jsx("span", { className: "text-gray-600", children: "Implementation:" }), _jsx("span", { className: "font-medium", children: formatCurrency(inputs.buyImplementation) })] }), _jsxs("div", { className: "flex justify-between", children: [_jsx("span", { className: "text-gray-600", children: "Customization:" }), _jsx("span", { className: "font-medium", children: formatCurrency(2000000) })] }), _jsxs("div", { className: "flex justify-between", children: [_jsx("span", { className: "text-gray-600", children: "Support:" }), _jsx("span", { className: "font-medium", children: formatCurrency(2500000) })] }), _jsxs("div", { className: "flex justify-between pt-2 border-t border-gray-200", children: [_jsx("span", { className: "font-semibold text-gray-900", children: "TOTAL:" }), _jsx("span", { className: "font-bold text-green-600 text-lg", children: formatCurrency(results.buyTotal) })] })] })] })] }), _jsx("div", { className: "mt-4 pt-4 border-t border-gray-200", children: _jsxs("p", { className: `text-center text-lg font-semibold ${results.savings > 0 ? 'text-green-600' : 'text-red-600'}`, children: [results.savings > 0 ? 'BUILD CHEAPER' : 'BUY CHEAPER', " BY ", formatCurrency(Math.abs(results.savings)), " over 5 years"] }) })] }), _jsxs("div", { className: "bg-white rounded-lg border border-gray-200 p-6", children: [_jsx("h3", { className: "text-lg font-semibold text-gray-900 mb-4", children: "Scorecard" }), _jsx("div", { className: "space-y-3", children: [
                                    { name: 'Cost (5yr)', build: formatCurrency(results.buildTotal), buy: formatCurrency(results.buyTotal), buildBetter: results.buildTotal < results.buyTotal },
                                    { name: 'Time to value', build: `${inputs.buildTimeline} mo`, buy: `${inputs.buyTimeline} mo`, buildBetter: inputs.buildTimeline <= inputs.buyTimeline },
                                    { name: 'Customization', build: inputs.buildCustomization, buy: inputs.buyCustomization, buildBetter: inputs.buildCustomization === 'full' },
                                    { name: 'Vendor risk', build: 'None', buy: inputs.vendorLockIn, buildBetter: true },
                                    { name: 'Scalability', build: 'High', buy: 'Limited', buildBetter: true },
                                    { name: 'IP ownership', build: 'Yes', buy: 'No', buildBetter: true },
                                    { name: 'Maintenance burden', build: 'High', buy: 'Vendor', buildBetter: false },
                                    { name: 'Integration', build: 'Custom', buy: 'Standard API', buildBetter: true }
                                ].map((item, idx) => (_jsxs("div", { className: "grid grid-cols-3 gap-4 py-2 border-b border-gray-100 last:border-0", children: [_jsx("div", { className: "text-sm font-medium text-gray-700", children: item.name }), _jsxs("div", { className: "flex items-center gap-2", children: [item.buildBetter ? _jsx(CheckCircle, { className: "w-4 h-4 text-green-600" }) : _jsx(XCircle, { className: "w-4 h-4 text-red-600" }), _jsx("span", { className: "text-sm text-gray-900", children: item.build })] }), _jsxs("div", { className: "flex items-center gap-2", children: [!item.buildBetter ? _jsx(CheckCircle, { className: "w-4 h-4 text-green-600" }) :
                                                    item.buy === 'Limited' || item.buy === 'No' || item.buy === 'high' ? _jsx(AlertTriangle, { className: "w-4 h-4 text-yellow-600" }) :
                                                        _jsx(XCircle, { className: "w-4 h-4 text-red-600" }), _jsx("span", { className: "text-sm text-gray-900 capitalize", children: item.buy })] })] }, idx))) }), _jsxs("div", { className: "mt-4 pt-4 border-t border-gray-200 flex items-center justify-between", children: [_jsxs("div", { children: [_jsx("span", { className: "text-sm font-medium text-gray-700", children: "BUILD SCORE:" }), _jsxs("span", { className: "ml-2 text-2xl font-bold text-blue-600", children: [results.buildScore, "/100"] })] }), _jsxs("div", { children: [_jsx("span", { className: "text-sm font-medium text-gray-700", children: "BUY SCORE:" }), _jsxs("span", { className: "ml-2 text-2xl font-bold text-green-600", children: [results.buyScore, "/100"] })] })] })] }), aiRecommendation && !(aiRecommendation.confidence === 0 && (aiRecommendation.recommendation?.startsWith('Unable to generate') || /security token|AI call failed|invalid.*token/i.test(aiRecommendation.recommendation || ''))) && (_jsxs("div", { className: "bg-gradient-to-r from-purple-50 to-indigo-50 rounded-lg border border-purple-200 p-6", children: [_jsxs("div", { className: "flex items-start justify-between mb-4", children: [_jsxs("div", { children: [_jsx("h3", { className: "text-lg font-semibold text-gray-900", children: "\uD83E\uDD16 AI Recommendation" }), _jsx("p", { className: "text-sm text-gray-600 mt-1", children: "Powered by AWS Bedrock" })] }), _jsxs("div", { className: "text-right", children: [_jsxs("div", { className: "text-2xl font-bold text-purple-600", children: [aiRecommendation.confidence, "%"] }), _jsx("div", { className: "text-xs text-gray-600", children: "Confidence" })] })] }), _jsxs("div", { className: "bg-white rounded-lg p-4", children: [_jsxs("div", { className: "flex items-center gap-2 mb-3", children: [_jsxs("span", { className: `px-3 py-1 rounded-full text-sm font-medium ${aiRecommendation.outcome === 'build' ? 'bg-blue-100 text-blue-800' :
                                                    aiRecommendation.outcome === 'buy' ? 'bg-green-100 text-green-800' :
                                                        'bg-purple-100 text-purple-800'}`, children: [aiRecommendation.outcome.toUpperCase(), " \u2705"] }), _jsxs("span", { className: "text-sm text-gray-600", children: ["(Confidence: ", aiRecommendation.confidence, "%)"] })] }), _jsx("p", { className: "text-gray-800 leading-relaxed whitespace-pre-wrap", children: aiRecommendation.recommendation })] })] })), _jsxs("div", { className: "bg-white rounded-lg border border-gray-200 p-6", children: [_jsx("h3", { className: "text-lg font-semibold text-gray-900 mb-4", children: "CFO Decision" }), _jsxs("div", { className: "space-y-4", children: [_jsxs("div", { className: "flex gap-3", children: [_jsx("button", { onClick: () => setCfoDecision('build'), className: `flex-1 px-6 py-3 rounded-lg font-medium transition-colors ${cfoDecision === 'build' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`, children: "Approve Build" }), _jsx("button", { onClick: () => setCfoDecision('buy'), className: `flex-1 px-6 py-3 rounded-lg font-medium transition-colors ${cfoDecision === 'buy' ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`, children: "Approve Buy" }), _jsx("button", { onClick: () => setCfoDecision('hybrid'), className: `flex-1 px-6 py-3 rounded-lg font-medium transition-colors ${cfoDecision === 'hybrid' ? 'bg-purple-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`, children: "Hybrid Model" }), _jsx("button", { onClick: () => setCfoDecision('review'), className: `flex-1 px-6 py-3 rounded-lg font-medium transition-colors ${cfoDecision === 'review' ? 'bg-yellow-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`, children: "Request POC" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-1", children: "CFO Notes (optional)" }), _jsx("textarea", { value: cfoNotes, onChange: (e) => setCfoNotes(e.target.value), placeholder: "Add notes before saving...", rows: 3, className: "w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent" })] }), _jsx("button", { onClick: handleSave, disabled: !cfoDecision, className: "w-full px-6 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed", children: "Save to Audit Trail \uD83D\uDCCB" })] })] })] }))] }));
};
export default BuildVsBuy;
