import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { Brain, ArrowLeft, Upload } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import MorningBrief from '../components/cfo-decision/MorningBrief';
import InvestmentDecision from '../components/cfo-decision/InvestmentDecision';
import BuildVsBuy from '../components/cfo-decision/BuildVsBuy';
import InternalVsExternal from '../components/cfo-decision/InternalVsExternal';
import HireVsAutomate from '../components/cfo-decision/HireVsAutomate';
import RiskDashboard from '../components/cfo-decision/RiskDashboard';
import DecisionAuditTrail from '../components/cfo-decision/DecisionAuditTrail';
import CFODecisionUploadModal from '../components/cfo-decision/CFODecisionUploadModal';
import { morningBriefData } from '../data/decisionMockData';
import { loadCFODecisionData } from '../services/cfoDecisionDataService';
const CFODecisionIntelligence = () => {
    const navigate = useNavigate();
    const [activeTab, setActiveTab] = useState('investment');
    const [savedDecisions, setSavedDecisions] = useState([]);
    const [showMorningBrief, setShowMorningBrief] = useState(true);
    const [showUploadModal, setShowUploadModal] = useState(false);
    const [uploadedData, setUploadedData] = useState(loadCFODecisionData());
    const tabs = [
        { id: 'investment', name: 'Investment Decision', icon: '💰' },
        { id: 'build_vs_buy', name: 'Build vs Buy', icon: '🏗️', badge: 'NEW' },
        { id: 'internal_vs_external', name: 'Internal vs External', icon: '🔄', badge: 'NEW' },
        { id: 'hire_vs_automate', name: 'Hire vs Automate', icon: '👥' },
        { id: 'cost_cut', name: 'Cost Cut vs Invest', icon: '✂️' },
        { id: 'capital', name: 'Capital Allocation', icon: '🏢' },
        { id: 'risk', name: 'Risk Dashboard', icon: '⚠️' },
        { id: 'audit', name: 'Decision Audit Trail', icon: '📋', badge: 'UNIQUE' }
    ];
    const handleSaveToAudit = (decision) => {
        const auditEntry = {
            id: decision.id,
            date: decision.date,
            type: decision.type,
            title: decision.title,
            aiOutcome: decision.aiOutcome,
            cfoOutcome: decision.cfoOverride || decision.aiOutcome,
            tracked: false,
            confidence: decision.confidence
        };
        setSavedDecisions(prev => [auditEntry, ...prev]);
    };
    const handleMorningBriefAction = (actionType) => {
        setActiveTab(actionType);
        setShowMorningBrief(false);
    };
    const criticalCount = morningBriefData.filter(item => item.urgency === 'critical' || item.urgency === 'warning').length;
    const resolvedCount = morningBriefData.filter(item => item.urgency === 'info').length;
    return (_jsxs("div", { className: "min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-6", children: [_jsxs("div", { className: "max-w-7xl mx-auto", children: [_jsxs("div", { className: "bg-gradient-to-r from-amber-500 to-orange-600 rounded-xl shadow-lg p-6 mb-6 text-white", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("div", { className: "flex items-center gap-4", children: [_jsx("button", { onClick: () => navigate('/fpa'), className: "p-2 hover:bg-white/20 rounded-lg transition-colors", children: _jsx(ArrowLeft, { className: "w-6 h-6" }) }), _jsxs("div", { className: "flex items-center gap-3", children: [_jsx("div", { className: "w-14 h-14 bg-white/20 rounded-xl flex items-center justify-center backdrop-blur-sm", children: _jsx(Brain, { className: "w-8 h-8" }) }), _jsxs("div", { children: [_jsx("h1", { className: "text-3xl font-bold", children: "CFO Decision Intelligence" }), _jsx("p", { className: "text-amber-50 text-sm", children: "Strategic decisions powered by Amazon Nova AI" })] })] })] }), _jsxs("div", { className: "flex items-center gap-3", children: [_jsxs("button", { onClick: () => setShowUploadModal(true), className: "px-4 py-2 bg-white text-amber-600 hover:bg-amber-50 rounded-lg transition-colors font-medium flex items-center gap-2 shadow-sm", children: [_jsx(Upload, { className: "w-4 h-4" }), _jsx("span", { children: "Upload Data" })] }), _jsxs("button", { onClick: () => setShowMorningBrief(!showMorningBrief), className: "px-4 py-2 bg-white/20 hover:bg-white/30 rounded-lg transition-colors backdrop-blur-sm flex items-center gap-2", children: [_jsx("span", { children: "\uD83C\uDF05" }), _jsx("span", { className: "font-medium", children: "Morning Brief" }), criticalCount > 0 && (_jsx("span", { className: "px-2 py-0.5 bg-red-500 text-white text-xs font-bold rounded-full", children: criticalCount }))] }), _jsxs("button", { onClick: () => setActiveTab('audit'), className: "px-4 py-2 bg-white/20 hover:bg-white/30 rounded-lg transition-colors backdrop-blur-sm flex items-center gap-2", children: [_jsx("span", { children: "\uD83D\uDCCB" }), _jsx("span", { className: "font-medium", children: "Decision Log" })] })] })] }), _jsxs("div", { className: "mt-4 pt-4 border-t border-white/20 flex items-center gap-6 text-sm", children: [criticalCount > 0 && (_jsxs("div", { className: "flex items-center gap-2", children: [_jsx("span", { className: "w-2 h-2 bg-red-400 rounded-full animate-pulse" }), _jsxs("span", { className: "text-white/90", children: [criticalCount, " decision", criticalCount > 1 ? 's' : '', " need attention today"] })] })), resolvedCount > 0 && (_jsxs("div", { className: "flex items-center gap-2", children: [_jsx("span", { children: "\u2705" }), _jsxs("span", { className: "text-white/90", children: [resolvedCount, " resolved automatically"] })] })), _jsxs("div", { className: "flex items-center gap-2", children: [_jsx("span", { children: "\uD83E\uDD16" }), _jsxs("span", { className: "text-white/90", children: ["78% AI accuracy \u2022 ", savedDecisions.length + 6, " total decisions"] })] })] })] }), showMorningBrief && (_jsx(MorningBrief, { items: morningBriefData, onActionClick: handleMorningBriefAction })), _jsx("div", { className: "bg-white rounded-lg shadow-sm border border-gray-200 mb-6", children: _jsx("div", { className: "flex overflow-x-auto", children: tabs.map((tab) => (_jsxs("button", { onClick: () => setActiveTab(tab.id), className: `flex items-center gap-2 px-6 py-4 font-medium transition-all whitespace-nowrap border-b-2 ${activeTab === tab.id
                                    ? 'border-amber-600 text-amber-600 bg-amber-50'
                                    : 'border-transparent text-gray-600 hover:text-gray-900 hover:bg-gray-50'}`, children: [_jsx("span", { className: "text-xl", children: tab.icon }), _jsx("span", { children: tab.name }), tab.badge && (_jsx("span", { className: `px-2 py-0.5 text-xs font-bold rounded-full ${tab.badge === 'NEW' ? 'bg-green-100 text-green-700' : 'bg-purple-100 text-purple-700'}`, children: tab.badge }))] }, tab.id))) }) }), _jsxs("div", { className: "transition-all duration-300", children: [activeTab === 'investment' && (_jsx(InvestmentDecision, { onSaveToAudit: handleSaveToAudit })), activeTab === 'build_vs_buy' && (_jsx(BuildVsBuy, { onSaveToAudit: handleSaveToAudit })), activeTab === 'internal_vs_external' && (_jsx(InternalVsExternal, { onSaveToAudit: handleSaveToAudit })), activeTab === 'hire_vs_automate' && (_jsx(HireVsAutomate, { onSaveToAudit: handleSaveToAudit })), activeTab === 'cost_cut' && (_jsxs("div", { className: "bg-white rounded-lg border border-gray-200 p-8 text-center", children: [_jsx("div", { className: "text-6xl mb-4", children: "\u2702\uFE0F" }), _jsx("h3", { className: "text-2xl font-bold text-gray-900 mb-2", children: "Cost Cut vs Invest Analyzer" }), _jsx("p", { className: "text-gray-600 mb-4", children: "Limited budget \u2014 where to cut and where to invest?" }), _jsx("p", { className: "text-sm text-gray-500", children: "This module helps you balance cost savings with growth investments by analyzing your expense categories and recommending optimal allocation." })] })), activeTab === 'capital' && (_jsxs("div", { className: "bg-white rounded-lg border border-gray-200 p-8 text-center", children: [_jsx("div", { className: "text-6xl mb-4", children: "\uD83C\uDFE2" }), _jsx("h3", { className: "text-2xl font-bold text-gray-900 mb-2", children: "Capital Allocation Advisor" }), _jsx("p", { className: "text-gray-600 mb-4", children: "How to deploy available capital for maximum return?" }), _jsx("p", { className: "text-sm text-gray-500", children: "This module optimizes your capital allocation across product development, market expansion, debt repayment, M&A, and cash reserves based on your risk appetite." })] })), activeTab === 'risk' && _jsx(RiskDashboard, {}), activeTab === 'audit' && (_jsx(DecisionAuditTrail, { savedDecisions: savedDecisions }))] })] }), showUploadModal && (_jsx(CFODecisionUploadModal, { onClose: () => setShowUploadModal(false), onUploadSuccess: () => {
                    setUploadedData(loadCFODecisionData());
                } }))] }));
};
export default CFODecisionIntelligence;
