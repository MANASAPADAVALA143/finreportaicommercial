import React, { useState } from 'react';
import { HireVsAutomateInputs } from '../../types/decisions';
import { generateDecisionRecommendation } from '../../services/decisionEngine';

interface HireVsAutomateProps {
  onSaveToAudit: (decision: any) => void;
}

const HireVsAutomate: React.FC<HireVsAutomateProps> = ({ onSaveToAudit }) => {
  const [inputs, setInputs] = useState<HireVsAutomateInputs>({
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

  const [results, setResults] = useState<any>(null);
  const [aiRecommendation, setAiRecommendation] = useState<any>(null);
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
    } catch (error) {
      console.error('Error getting AI recommendation:', error);
    }

    setLoading(false);
  };

  const formatCurrency = (amount: number) => {
    if (amount >= 10000000) return `₹${(amount / 10000000).toFixed(1)}Cr`;
    if (amount >= 100000) return `₹${(amount / 100000).toFixed(1)}L`;
    return `₹${amount.toLocaleString('en-IN')}`;
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Process Details</h3>

        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">Process</label>
            <input
              type="text"
              value={inputs.process}
              onChange={(e) => setInputs({ ...inputs, process: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Current team (people)</label>
            <input
              type="number"
              value={inputs.currentTeam}
              onChange={(e) => setInputs({ ...inputs, currentTeam: Number(e.target.value) })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Monthly volume</label>
            <input
              type="number"
              value={inputs.monthlyVolume}
              onChange={(e) => setInputs({ ...inputs, monthlyVolume: Number(e.target.value) })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Hours per unit</label>
            <input
              type="number"
              step="0.1"
              value={inputs.hoursPerUnit}
              onChange={(e) => setInputs({ ...inputs, hoursPerUnit: Number(e.target.value) })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Additional needed (people)</label>
            <input
              type="number"
              value={inputs.additionalNeeded}
              onChange={(e) => setInputs({ ...inputs, additionalNeeded: Number(e.target.value) })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Avg salary (₹/year)</label>
            <input
              type="number"
              value={inputs.avgSalary}
              onChange={(e) => setInputs({ ...inputs, avgSalary: Number(e.target.value) })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Automation tool/vendor</label>
            <input
              type="text"
              value={inputs.automationTool}
              onChange={(e) => setInputs({ ...inputs, automationTool: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Setup cost (₹)</label>
            <input
              type="number"
              value={inputs.setupCost}
              onChange={(e) => setInputs({ ...inputs, setupCost: Number(e.target.value) })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Monthly cost (₹)</label>
            <input
              type="number"
              value={inputs.monthlyCost}
              onChange={(e) => setInputs({ ...inputs, monthlyCost: Number(e.target.value) })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Automation % of volume</label>
            <input
              type="number"
              value={inputs.automationPercentage}
              onChange={(e) => setInputs({ ...inputs, automationPercentage: Number(e.target.value) })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500"
            />
          </div>
        </div>

        <button
          onClick={handleAnalyze}
          disabled={loading}
          className="mt-6 px-6 py-3 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors font-medium disabled:opacity-50"
        >
          {loading ? 'Analyzing...' : 'Analyze ▶'}
        </button>
      </div>

      {results && (
        <>
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Financial Analysis</h3>

            <div className="grid grid-cols-2 gap-6">
              <div className="space-y-3">
                <h4 className="font-semibold text-blue-600">HIRE: {inputs.additionalNeeded} people</h4>
                <p className="text-3xl font-bold text-gray-900">{formatCurrency(results.hireCost)}<span className="text-sm text-gray-600">/year</span></p>
                <p className="text-sm text-gray-600">Break-even: Never (recurring cost)</p>
              </div>

              <div className="space-y-3">
                <h4 className="font-semibold text-green-600">AUTOMATE</h4>
                <p className="text-lg text-gray-700">{formatCurrency(results.automationAnnualCost)} Year 1</p>
                <p className="text-lg text-gray-700">{formatCurrency(inputs.monthlyCost * 12)} Year 2+</p>
                <p className="text-sm font-medium text-green-600">Break-even: {results.breakeven} months</p>
              </div>
            </div>

            <div className="mt-6 pt-4 border-t border-gray-200 text-center">
              <p className="text-2xl font-bold text-green-600">
                5-year saving from automation: {formatCurrency(results.fiveYearSaving)}
              </p>
            </div>
          </div>

          {aiRecommendation && !(aiRecommendation.confidence === 0 && (aiRecommendation.recommendation?.startsWith('Unable to generate') || /security token|AI call failed|invalid.*token/i.test(aiRecommendation.recommendation || ''))) && (
            <div className="bg-gradient-to-r from-purple-50 to-indigo-50 rounded-lg border border-purple-200 p-6">
              <div className="flex items-start justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900">🤖 AI Recommendation (Amazon Nova)</h3>
                <div className="text-2xl font-bold text-purple-600">{aiRecommendation.confidence}%</div>
              </div>

              <div className="bg-white rounded-lg p-4">
                <div className="mb-3">
                  <span className={`px-3 py-1 rounded-full text-sm font-medium ${
                    aiRecommendation.outcome === 'automate' ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800'
                  }`}>
                    {aiRecommendation.outcome.toUpperCase()} ✅
                  </span>
                </div>
                <p className="text-gray-800 leading-relaxed whitespace-pre-wrap">
                  {aiRecommendation.recommendation}
                </p>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default HireVsAutomate;
