import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { RotateCcw } from 'lucide-react';
import { DEFAULT_ASSUMPTIONS } from '../../types/scenarioEngine';
const SCENARIO_CONFIG = {
    base: { label: 'Base Case', border: 'border-blue-500' },
    growth: { label: 'Growth Case', border: 'border-emerald-500' },
    conservative: { label: 'Conservative', border: 'border-amber-500' },
    stress: { label: 'Stress Test', border: 'border-red-500' },
};
const SLIDER_CONFIG = [
    {
        group: 'REVENUE DRIVERS',
        sliders: [
            { key: 'revenueGrowthRate', label: 'Revenue Growth', min: -20, max: 50, step: 0.5, unit: '%' },
            { key: 'newClientGrowth', label: 'New Client Growth', min: -20, max: 60, step: 1, unit: '%' },
            { key: 'avgRevenuePerClient', label: 'Avg Revenue/Client', min: 3, max: 20, step: 0.5, unit: '₹L' },
            { key: 'churnRate', label: 'Churn Rate', min: 0, max: 20, step: 0.5, unit: '%' },
            { key: 'priceIncrease', label: 'Price Increase', min: -10, max: 20, step: 0.5, unit: '%' },
        ],
    },
    {
        group: 'COST DRIVERS',
        sliders: [
            { key: 'cogsPercent', label: 'COGS % of Revenue', min: 20, max: 60, step: 0.5, unit: '%' },
            { key: 'headcountGrowth', label: 'Headcount Growth', min: -10, max: 50, step: 1, unit: '%' },
            { key: 'marketingSpend', label: 'Marketing Spend', min: 1, max: 50, step: 0.5, unit: '₹L' },
            { key: 'rdInvestment', label: 'R&D Investment', min: 1, max: 30, step: 0.5, unit: '₹L' },
            { key: 'overheadGrowth', label: 'Overhead Growth', min: 0, max: 25, step: 0.5, unit: '%' },
        ],
    },
    {
        group: 'OPERATIONAL LEVERS',
        sliders: [
            { key: 'dso', label: 'DSO', min: 15, max: 90, step: 1, unit: 'days' },
            { key: 'dpo', label: 'DPO', min: 15, max: 90, step: 1, unit: 'days' },
            { key: 'capex', label: 'Capex', min: 0, max: 100, step: 1, unit: '₹L' },
        ],
    },
];
export const ScenarioControlPanel = ({ scenarioType, assumptions, onScenarioChange, onAssumptionsChange, onSaveSnapshot, }) => {
    const handleSliderChange = (key, value) => {
        onAssumptionsChange({ ...assumptions, [key]: value });
    };
    const handleReset = (key) => {
        onAssumptionsChange({ ...assumptions, [key]: DEFAULT_ASSUMPTIONS[scenarioType][key] });
    };
    return (_jsxs("div", { className: "w-[280px] flex-shrink-0 flex flex-col bg-[#0D1426] border-r border-[#1E2D45] h-full overflow-y-auto", children: [_jsxs("div", { className: "p-4 border-b border-[#1E2D45]", children: [_jsx("h3", { className: "text-xs font-semibold text-[#94A3B8] uppercase tracking-wider mb-3", children: "Scenario Controls" }), _jsx("div", { className: "grid grid-cols-2 gap-2", children: Object.keys(SCENARIO_CONFIG).map((t) => (_jsx("button", { onClick: () => onScenarioChange(t), className: `px-3 py-2 rounded-lg text-xs font-medium transition-all border ${scenarioType === t ? SCENARIO_CONFIG[t].border + ' bg-[#1E2D45] text-white' : 'border-[#1E2D45] text-[#94A3B8] hover:bg-[#111827]'}`, children: SCENARIO_CONFIG[t].label }, t))) })] }), _jsx("div", { className: "flex-1 overflow-y-auto p-4 space-y-6", children: SLIDER_CONFIG.map((group) => (_jsxs("div", { children: [_jsx("h4", { className: "text-[10px] font-semibold text-[#64748B] uppercase tracking-wider mb-3", children: group.group }), _jsx("div", { className: "space-y-3", children: group.sliders.map((s) => {
                                const val = assumptions[s.key];
                                return (_jsxs("div", { className: "space-y-1", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("label", { className: "text-xs text-[#94A3B8]", children: s.label }), _jsxs("div", { className: "flex items-center gap-1", children: [_jsx("input", { type: "number", value: val, onChange: (e) => {
                                                                const v = parseFloat(e.target.value);
                                                                if (!isNaN(v))
                                                                    handleSliderChange(s.key, v);
                                                            }, className: "w-14 h-6 text-xs bg-[#111827] border border-[#1E2D45] rounded text-right text-[#F1F5F9] px-1", step: s.step }), _jsx("span", { className: "text-[10px] text-[#64748B]", children: s.unit }), _jsx("button", { onClick: () => handleReset(s.key), className: "p-0.5 text-[#64748B] hover:text-[#94A3B8]", title: "Reset to default", children: _jsx(RotateCcw, { className: "w-3 h-3" }) })] })] }), _jsx("input", { type: "range", min: s.min, max: s.max, step: s.step, value: val, onChange: (e) => handleSliderChange(s.key, parseFloat(e.target.value)), className: "w-full h-2 rounded-lg appearance-none cursor-pointer accent-[#3B82F6]" }), _jsxs("div", { className: "flex justify-between text-[9px] text-[#64748B]", children: [_jsxs("span", { children: [s.min, s.unit] }), _jsxs("span", { children: [s.max, s.unit] })] })] }, s.key));
                            }) })] }, group.group))) }), _jsxs("div", { className: "p-4 border-t border-[#1E2D45] space-y-2", children: [_jsx("button", { onClick: () => onAssumptionsChange(DEFAULT_ASSUMPTIONS[scenarioType]), className: "w-full py-2 px-3 text-xs font-medium rounded-lg border border-[#1E2D45] text-[#94A3B8] hover:bg-[#111827]", children: "Reset to Defaults" }), onSaveSnapshot && (_jsx("button", { onClick: onSaveSnapshot, className: "w-full py-2 px-3 text-xs font-medium rounded-lg bg-[#3B82F6] text-white hover:bg-[#2563EB]", children: "Save Scenario Snapshot" }))] })] }));
};
