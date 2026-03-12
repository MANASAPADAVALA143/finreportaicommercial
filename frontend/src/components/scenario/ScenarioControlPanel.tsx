import React from 'react';
import { RotateCcw } from 'lucide-react';
import type { ScenarioType, ScenarioAssumptions } from '../../types/scenarioEngine';
import { DEFAULT_ASSUMPTIONS } from '../../types/scenarioEngine';

const SCENARIO_CONFIG: Record<ScenarioType, { label: string; border: string }> = {
  base: { label: 'Base Case', border: 'border-blue-500' },
  growth: { label: 'Growth Case', border: 'border-emerald-500' },
  conservative: { label: 'Conservative', border: 'border-amber-500' },
  stress: { label: 'Stress Test', border: 'border-red-500' },
};

const SLIDER_CONFIG = [
  {
    group: 'REVENUE DRIVERS',
    sliders: [
      { key: 'revenueGrowthRate' as const, label: 'Revenue Growth', min: -20, max: 50, step: 0.5, unit: '%' },
      { key: 'newClientGrowth' as const, label: 'New Client Growth', min: -20, max: 60, step: 1, unit: '%' },
      { key: 'avgRevenuePerClient' as const, label: 'Avg Revenue/Client', min: 3, max: 20, step: 0.5, unit: '₹L' },
      { key: 'churnRate' as const, label: 'Churn Rate', min: 0, max: 20, step: 0.5, unit: '%' },
      { key: 'priceIncrease' as const, label: 'Price Increase', min: -10, max: 20, step: 0.5, unit: '%' },
    ],
  },
  {
    group: 'COST DRIVERS',
    sliders: [
      { key: 'cogsPercent' as const, label: 'COGS % of Revenue', min: 20, max: 60, step: 0.5, unit: '%' },
      { key: 'headcountGrowth' as const, label: 'Headcount Growth', min: -10, max: 50, step: 1, unit: '%' },
      { key: 'marketingSpend' as const, label: 'Marketing Spend', min: 1, max: 50, step: 0.5, unit: '₹L' },
      { key: 'rdInvestment' as const, label: 'R&D Investment', min: 1, max: 30, step: 0.5, unit: '₹L' },
      { key: 'overheadGrowth' as const, label: 'Overhead Growth', min: 0, max: 25, step: 0.5, unit: '%' },
    ],
  },
  {
    group: 'OPERATIONAL LEVERS',
    sliders: [
      { key: 'dso' as const, label: 'DSO', min: 15, max: 90, step: 1, unit: 'days' },
      { key: 'dpo' as const, label: 'DPO', min: 15, max: 90, step: 1, unit: 'days' },
      { key: 'capex' as const, label: 'Capex', min: 0, max: 100, step: 1, unit: '₹L' },
    ],
  },
];

interface ScenarioControlPanelProps {
  scenarioType: ScenarioType;
  assumptions: ScenarioAssumptions;
  onScenarioChange: (t: ScenarioType) => void;
  onAssumptionsChange: (a: ScenarioAssumptions) => void;
  onSaveSnapshot?: () => void;
}

export const ScenarioControlPanel: React.FC<ScenarioControlPanelProps> = ({
  scenarioType,
  assumptions,
  onScenarioChange,
  onAssumptionsChange,
  onSaveSnapshot,
}) => {
  const handleSliderChange = (key: keyof ScenarioAssumptions, value: number) => {
    onAssumptionsChange({ ...assumptions, [key]: value });
  };

  const handleReset = (key: keyof ScenarioAssumptions) => {
    onAssumptionsChange({ ...assumptions, [key]: DEFAULT_ASSUMPTIONS[scenarioType][key] });
  };

  return (
    <div className="w-[280px] flex-shrink-0 flex flex-col bg-[#0D1426] border-r border-[#1E2D45] h-full overflow-y-auto">
      <div className="p-4 border-b border-[#1E2D45]">
        <h3 className="text-xs font-semibold text-[#94A3B8] uppercase tracking-wider mb-3">
          Scenario Controls
        </h3>
        <div className="grid grid-cols-2 gap-2">
          {(Object.keys(SCENARIO_CONFIG) as ScenarioType[]).map((t) => (
            <button
              key={t}
              onClick={() => onScenarioChange(t)}
              className={`px-3 py-2 rounded-lg text-xs font-medium transition-all border ${
                scenarioType === t ? SCENARIO_CONFIG[t].border + ' bg-[#1E2D45] text-white' : 'border-[#1E2D45] text-[#94A3B8] hover:bg-[#111827]'
              }`}
            >
              {SCENARIO_CONFIG[t].label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {SLIDER_CONFIG.map((group) => (
          <div key={group.group}>
            <h4 className="text-[10px] font-semibold text-[#64748B] uppercase tracking-wider mb-3">
              {group.group}
            </h4>
            <div className="space-y-3">
              {group.sliders.map((s) => {
                const val = assumptions[s.key];
                return (
                  <div key={s.key} className="space-y-1">
                    <div className="flex items-center justify-between">
                      <label className="text-xs text-[#94A3B8]">{s.label}</label>
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          value={val}
                          onChange={(e) => {
                            const v = parseFloat(e.target.value);
                            if (!isNaN(v)) handleSliderChange(s.key, v);
                          }}
                          className="w-14 h-6 text-xs bg-[#111827] border border-[#1E2D45] rounded text-right text-[#F1F5F9] px-1"
                          step={s.step}
                        />
                        <span className="text-[10px] text-[#64748B]">{s.unit}</span>
                        <button
                          onClick={() => handleReset(s.key)}
                          className="p-0.5 text-[#64748B] hover:text-[#94A3B8]"
                          title="Reset to default"
                        >
                          <RotateCcw className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                    <input
                      type="range"
                      min={s.min}
                      max={s.max}
                      step={s.step}
                      value={val}
                      onChange={(e) => handleSliderChange(s.key, parseFloat(e.target.value))}
                      className="w-full h-2 rounded-lg appearance-none cursor-pointer accent-[#3B82F6]"
                    />
                    <div className="flex justify-between text-[9px] text-[#64748B]">
                      <span>{s.min}{s.unit}</span>
                      <span>{s.max}{s.unit}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="p-4 border-t border-[#1E2D45] space-y-2">
        <button
          onClick={() => onAssumptionsChange(DEFAULT_ASSUMPTIONS[scenarioType])}
          className="w-full py-2 px-3 text-xs font-medium rounded-lg border border-[#1E2D45] text-[#94A3B8] hover:bg-[#111827]"
        >
          Reset to Defaults
        </button>
        {onSaveSnapshot && (
          <button
            onClick={onSaveSnapshot}
            className="w-full py-2 px-3 text-xs font-medium rounded-lg bg-[#3B82F6] text-white hover:bg-[#2563EB]"
          >
            Save Scenario Snapshot
          </button>
        )}
      </div>
    </div>
  );
};
