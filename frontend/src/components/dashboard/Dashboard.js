import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Link } from 'react-router-dom';
import { BarChart3, Zap, Target, Brain, LayoutGrid } from 'lucide-react';
import { useAgentActivity } from '../../context/AgentActivityContext';
const AGENT_DEFS = [
    { id: 'r2r', name: 'R2R Anomaly Agent', route: '/r2r-pattern', description: 'Analyses journal entries, detects fraud patterns, scores risk using Isolation Forest + Nova' },
    { id: 'ifrs', name: 'IFRS Reporting Agent', route: '/ifrs-generator', description: 'Maps trial balance to IFRS standards, generates 4 financial statements via Nova' },
    { id: 'fpa', name: 'FP&A Intelligence Agent', route: '/fpa', description: 'Runs variance analysis, forecasting, scenario planning powered by Nova' },
    { id: 'decision', name: 'CFO Decision Agent', route: '/cfo-decision', description: 'Analyses investment decisions, capital allocation, hire vs automate via Nova' },
    { id: 'voice', name: 'CFO Voice Agent', route: '/cfo', description: 'Answers financial questions by voice using Nova 2 Sonic speech-to-speech' },
];
export const Dashboard = () => {
    const { actions, activeAgents, markActive } = useAgentActivity();
    const modules = [
        {
            icon: _jsx(LayoutGrid, { className: "w-16 h-16 text-indigo-400" }),
            title: 'R2R Service 1',
            description: 'Close Tracker · TB Variance Analysis · Bank Reconciliation',
            link: '/r2r',
            bgColor: 'bg-indigo-500/10'
        },
        {
            icon: _jsx(LayoutGrid, { className: "w-16 h-16 text-indigo-400" }),
            title: 'R2R Pattern Engine',
            description: 'Upload journal entries for 7-model anomaly detection (Amount, Duplicate, User, Timing, Account, Vendor, Benford)',
            link: '/r2r-pattern',
            bgColor: 'bg-indigo-500/10'
        },
        {
            icon: _jsx(BarChart3, { className: "w-16 h-16 text-green-400" }),
            title: 'FP&A Suite',
            description: 'Comprehensive planning, budgeting, and forecasting',
            link: '/fpa',
            bgColor: 'bg-green-500/10'
        },
        {
            icon: _jsx(Target, { className: "w-16 h-16 text-purple-400" }),
            title: 'CFO Services',
            description: 'AI Assistant, Insights, Monitoring & Financial Health Dashboard',
            link: '/cfo',
            bgColor: 'bg-purple-500/10'
        },
        {
            icon: _jsx(Zap, { className: "w-16 h-16 text-orange-400" }),
            title: 'IFRS',
            description: 'IFRS Statement Generator - Convert Trial Balance to Financial Statements',
            link: '/ifrs-generator',
            bgColor: 'bg-orange-500/10',
            badge: 'New'
        },
        {
            icon: _jsx(Brain, { className: "w-16 h-16 text-amber-400" }),
            title: 'CFO Decision Intelligence',
            description: 'Investment ROI, Build vs Buy, Outsource vs Internal, Capital Allocation & Risk',
            link: '/cfo-decision',
            bgColor: 'bg-amber-500/10',
            badge: 'NEW'
        }
    ];
    return (_jsxs("div", { className: "min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900", children: [_jsxs("nav", { className: "bg-slate-900/50 backdrop-blur-sm border-b border-slate-700", children: [_jsx("div", { className: "container mx-auto px-6 py-4 flex justify-between items-center", children: _jsx("h1", { className: "text-2xl font-bold text-white", children: "FinReport AI" }) }), _jsx("p", { className: "container mx-auto px-6 pb-2 text-sm text-slate-400", children: "Open a section below and upload data there to use it. Each section uses only its own uploads." })] }), _jsx("div", { className: "border-b border-slate-700 bg-slate-800/30", children: _jsxs("div", { className: "container mx-auto px-6 py-4", children: [_jsxs("div", { className: "flex items-center gap-2 mb-2", children: [_jsx("span", { className: "text-lg font-semibold text-white", children: "\uD83E\uDD16 FinReportAI Agent Network" }), _jsxs("span", { className: "px-2 py-0.5 bg-green-500/20 text-green-400 text-sm font-medium rounded-full", children: ["\u25CF ", activeAgents.size, " Agents Active"] })] }), _jsx("div", { className: "flex flex-wrap gap-2", children: AGENT_DEFS.map((a) => (_jsxs(Link, { to: a.route, onClick: () => markActive(a.id), className: `inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${activeAgents.has(a.id)
                                    ? 'bg-green-500/20 text-green-400 border border-green-500/40 hover:bg-green-500/30'
                                    : 'bg-slate-700/50 text-slate-400 border border-slate-600 hover:bg-slate-700'}`, children: [_jsx("span", { className: `w-2 h-2 rounded-full ${activeAgents.has(a.id) ? 'bg-green-500' : 'bg-slate-500'}` }), a.name.replace(' Agent', ''), " \u2713"] }, a.id))) }), actions.length > 0 && (actions[0]?.agentId === 'r2r' ? (_jsxs(Link, { to: "/r2r-pattern", className: "mt-2 block text-xs text-slate-400 hover:text-slate-300 hover:underline", children: ["Last action: \"", actions[0]?.message, "\""] })) : (_jsxs("p", { className: "mt-2 text-xs text-slate-400", children: ["Last action: \"", actions[0]?.message, "\""] })))] }) }), _jsxs("div", { className: "container mx-auto px-6 py-16", children: [_jsxs("div", { className: "text-center mb-16", children: [_jsx("h1", { className: "text-5xl font-bold text-white mb-4", children: "FinReport AI" }), _jsx("p", { className: "text-xl text-gray-300", children: "Enterprise Financial Intelligence Platform powered by Amazon Nova" })] }), _jsx("div", { className: "grid md:grid-cols-2 gap-8 max-w-5xl mx-auto relative", children: modules.map((module, index) => (_jsxs(Link, { to: module.link, className: "bg-slate-800/40 backdrop-blur-sm rounded-2xl p-8 hover:bg-slate-800/60 transition-all duration-300 border border-slate-700 hover:border-slate-600 group relative", children: [module.badge && (_jsxs("span", { className: "absolute top-4 right-4 px-3 py-1 bg-amber-500 text-white text-xs font-bold rounded-full", children: [module.badge, " \u2B50"] })), _jsx("div", { className: `${module.bgColor} w-20 h-20 rounded-xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform`, children: module.icon }), _jsx("h3", { className: "text-2xl font-bold text-white mb-3", children: module.title }), _jsx("p", { className: "text-gray-300 leading-relaxed", children: module.description })] }, index))) }), _jsxs("div", { className: "mt-12 max-w-5xl mx-auto", children: [_jsx("h3", { className: "text-lg font-semibold text-white mb-3", children: "Agent Activity" }), _jsx("div", { className: "bg-slate-800/40 rounded-xl border border-slate-700 p-4 space-y-2", children: actions.slice(0, 5).map((a, i) => (_jsxs("div", { className: "flex items-start gap-2 text-sm", children: [_jsx("span", { className: "text-slate-500", children: "\uD83E\uDD16" }), _jsx("span", { className: "font-medium text-slate-300", children: a.agentName }), _jsx("span", { className: "text-slate-400", children: "\u2014" }), _jsxs("span", { className: "text-slate-300", children: ["\"", a.message, "\""] })] }, a.id || `action-${i}`))) })] }), _jsx("div", { className: "fixed bottom-4 right-4", children: _jsx("a", { href: "https://aws.amazon.com/bedrock/nova/", target: "_blank", rel: "noopener noreferrer", className: "inline-block px-3 py-1.5 bg-slate-700/80 hover:bg-slate-600 text-slate-300 text-xs font-medium rounded-lg border border-slate-600 transition-colors", children: "#AmazonNova" }) })] })] }));
};
