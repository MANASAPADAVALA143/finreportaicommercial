import React, { useState } from 'react';
import { CheckCircle, XCircle, AlertTriangle } from 'lucide-react';
import { InternalVsExternalInputs } from '../../types/decisions';
import { generateDecisionRecommendation } from '../../services/decisionEngine';

interface InternalVsExternalProps {
  onSaveToAudit: (decision: any) => void;
}

const InternalVsExternal: React.FC<InternalVsExternalProps> = ({ onSaveToAudit }) => {
  const [inputs, setInputs] = useState<InternalVsExternalInputs>({
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

  const [results, setResults] = useState<any>(null);
  const [aiRecommendation, setAiRecommendation] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [cfoDecision, setCfoDecision] = useState<string>('');
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

  const loadTemplate = (template: any) => {
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
    } catch (error) {
      console.error('Error getting AI recommendation:', error);
    }

    setLoading(false);
  };

  const calculateInternalScore = (): number => {
    let score = 50;

    const internalCost = inputs.currentTeam * inputs.costPerPerson;
    const externalCost = inputs.vendorMonthlyCost * 12;
    if (internalCost < externalCost) score += 15;

    if (inputs.currentTime <= inputs.vendorSLA) score += 10;
    if (inputs.errorRate <= inputs.vendorErrorRate) score += 10;

    score += 15; // control advantage
    score += 10; // knowledge retention

    return Math.min(100, score);
  };

  const calculateExternalScore = (): number => {
    let score = 50;

    const externalCost = inputs.vendorMonthlyCost * 12;
    const internalCost = inputs.currentTeam * inputs.costPerPerson;
    if (externalCost < internalCost) score += 10;

    if (inputs.vendorSLA < inputs.currentTime) score += 15;
    if (inputs.vendorErrorRate < inputs.errorRate) score += 15;

    score += 10; // scalability
    score += 8; // reduce burden

    return Math.min(100, score);
  };

  const formatCurrency = (amount: number) => {
    if (amount >= 10000000) return `₹${(amount / 10000000).toFixed(1)}Cr`;
    if (amount >= 100000) return `₹${(amount / 100000).toFixed(1)}L`;
    return `₹${amount.toLocaleString('en-IN')}`;
  };

  const handleSave = () => {
    if (!results || !aiRecommendation) return;

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

  return (
    <div className="space-y-6">
      {/* Quick Templates */}
      <div className="bg-gradient-to-r from-blue-50 to-cyan-50 rounded-lg border border-blue-200 p-4">
        <h4 className="text-sm font-semibold text-gray-900 mb-3">
          Quick Templates (common outsource decisions):
        </h4>
        <div className="flex flex-wrap gap-2">
          {commonTemplates.map((template, idx) => (
            <button
              key={idx}
              onClick={() => loadTemplate(template)}
              className="px-3 py-1.5 bg-white border border-blue-300 rounded-lg hover:bg-blue-50 transition-colors text-sm font-medium text-gray-700"
            >
              {template.name}
            </button>
          ))}
        </div>
      </div>

      {/* Input Form */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <div className="grid grid-cols-2 gap-4 mb-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Function
            </label>
            <input
              type="text"
              value={inputs.functionName}
              onChange={(e) => setInputs({ ...inputs, functionName: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Category
            </label>
            <select
              value={inputs.category}
              onChange={(e) => setInputs({ ...inputs, category: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
            >
              <option>Finance</option>
              <option>HR</option>
              <option>IT</option>
              <option>Legal</option>
              <option>Operations</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-6">
          {/* INTERNAL OPTION */}
          <div className="space-y-4">
            <h4 className="font-semibold text-gray-900 border-b pb-2">🏢 INTERNAL OPTION</h4>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Current team (people)
              </label>
              <input
                type="number"
                value={inputs.currentTeam}
                onChange={(e) => setInputs({ ...inputs, currentTeam: Number(e.target.value) })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Avg cost/person (₹/year)
              </label>
              <input
                type="number"
                value={inputs.costPerPerson}
                onChange={(e) => setInputs({ ...inputs, costPerPerson: Number(e.target.value) })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Current time (days for close cycle)
              </label>
              <input
                type="number"
                value={inputs.currentTime}
                onChange={(e) => setInputs({ ...inputs, currentTime: Number(e.target.value) })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Error rate (%)
              </label>
              <input
                type="number"
                step="0.1"
                value={inputs.errorRate}
                onChange={(e) => setInputs({ ...inputs, errorRate: Number(e.target.value) })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Team utilization (%)
              </label>
              <input
                type="number"
                value={inputs.teamUtilization}
                onChange={(e) => setInputs({ ...inputs, teamUtilization: Number(e.target.value) })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Training cost (₹/year)
              </label>
              <input
                type="number"
                value={inputs.trainingCost}
                onChange={(e) => setInputs({ ...inputs, trainingCost: Number(e.target.value) })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
              />
            </div>
          </div>

          {/* EXTERNAL / OUTSOURCE */}
          <div className="space-y-4">
            <h4 className="font-semibold text-gray-900 border-b pb-2">🌐 EXTERNAL / OUTSOURCE</h4>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Vendor
              </label>
              <input
                type="text"
                value={inputs.vendorName}
                onChange={(e) => setInputs({ ...inputs, vendorName: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Monthly cost (₹)
              </label>
              <input
                type="number"
                value={inputs.vendorMonthlyCost}
                onChange={(e) => setInputs({ ...inputs, vendorMonthlyCost: Number(e.target.value) })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                SLA committed (days)
              </label>
              <input
                type="number"
                value={inputs.vendorSLA}
                onChange={(e) => setInputs({ ...inputs, vendorSLA: Number(e.target.value) })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Error rate SLA (%)
              </label>
              <input
                type="number"
                step="0.1"
                value={inputs.vendorErrorRate}
                onChange={(e) => setInputs({ ...inputs, vendorErrorRate: Number(e.target.value) })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Transition time (months)
              </label>
              <input
                type="number"
                value={inputs.transitionTime}
                onChange={(e) => setInputs({ ...inputs, transitionTime: Number(e.target.value) })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Exit clause
              </label>
              <input
                type="text"
                value={inputs.exitClause}
                onChange={(e) => setInputs({ ...inputs, exitClause: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
              />
            </div>
          </div>
        </div>

        <button
          onClick={handleAnalyze}
          disabled={loading}
          className="mt-6 px-6 py-3 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? 'Analyzing...' : 'Analyze Decision ▶'}
        </button>
      </div>

      {/* Results */}
      {results && (
        <>
          {/* Cost Analysis */}
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Cost Analysis</h3>

            <div className="grid grid-cols-2 gap-6">
              <div>
                <h4 className="font-semibold text-blue-600 mb-3">INTERNAL:</h4>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Team cost:</span>
                    <span className="font-medium">{formatCurrency(inputs.currentTeam * inputs.costPerPerson)}/year</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Training:</span>
                    <span className="font-medium">{formatCurrency(inputs.trainingCost)}/year</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Tools:</span>
                    <span className="font-medium">₹3L/year</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Management:</span>
                    <span className="font-medium">₹5L/year</span>
                  </div>
                  <div className="flex justify-between pt-2 border-t border-gray-200 font-semibold">
                    <span>Total:</span>
                    <span className="text-blue-600 text-lg">{formatCurrency(results.internalCost)}/year</span>
                  </div>
                </div>
              </div>

              <div>
                <h4 className="font-semibold text-green-600 mb-3">EXTERNAL:</h4>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Monthly:</span>
                    <span className="font-medium">{formatCurrency(inputs.vendorMonthlyCost * 12)}/year</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Setup:</span>
                    <span className="font-medium">₹5L one-time</span>
                  </div>
                  <div className="flex justify-between pt-2 border-t border-gray-200 font-semibold">
                    <span>Total:</span>
                    <span className="text-green-600 text-lg">{formatCurrency(results.externalCost)}/year</span>
                  </div>
                  <div className="pt-2 border-t border-gray-200 text-xs text-gray-600">
                    {results.costDifference > 0 ? (
                      <span className="text-red-600">+{((results.costDifference / results.internalCost) * 100).toFixed(0)}% more expensive</span>
                    ) : (
                      <span className="text-green-600">{((Math.abs(results.costDifference) / results.externalCost) * 100).toFixed(0)}% cheaper</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Quality Scorecard */}
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Quality Scorecard</h3>

            <div className="space-y-3">
              {[
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
              ].map((item, idx) => (
                <div key={idx} className="grid grid-cols-3 gap-4 py-2 border-b border-gray-100 last:border-0">
                  <div className="text-sm font-medium text-gray-700">{item.name}</div>
                  <div className="flex items-center gap-2">
                    {item.internalBetter ? <CheckCircle className="w-4 h-4 text-green-600" /> : 
                     item.internal === 'Limited' ? <AlertTriangle className="w-4 h-4 text-yellow-600" /> :
                     <XCircle className="w-4 h-4 text-red-600" />}
                    <span className="text-sm text-gray-900">{item.internal}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {!item.internalBetter ? <CheckCircle className="w-4 h-4 text-green-600" /> : 
                     item.external.includes('Risk') || item.external.includes('concerns') ? <XCircle className="w-4 h-4 text-red-600" /> :
                     <AlertTriangle className="w-4 h-4 text-yellow-600" />}
                    <span className="text-sm text-gray-900">{item.external}</span>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4 pt-4 border-t border-gray-200 flex items-center justify-between">
              <div>
                <span className="text-sm font-medium text-gray-700">INTERNAL SCORE:</span>
                <span className="ml-2 text-2xl font-bold text-blue-600">{results.internalScore}/100</span>
              </div>
              <div>
                <span className="text-sm font-medium text-gray-700">EXTERNAL SCORE:</span>
                <span className="ml-2 text-2xl font-bold text-green-600">{results.externalScore}/100</span>
              </div>
            </div>
          </div>

          {/* AI Recommendation - hidden when Nova/credentials error */}
          {aiRecommendation && !(aiRecommendation.confidence === 0 && (aiRecommendation.recommendation?.startsWith('Unable to generate') || /security token|AI call failed|invalid.*token/i.test(aiRecommendation.recommendation || ''))) && (
            <div className="bg-gradient-to-r from-purple-50 to-indigo-50 rounded-lg border border-purple-200 p-6">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">🤖 AI Recommendation</h3>
                  <p className="text-sm text-gray-600 mt-1">Powered by AI (backend Claude)</p>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-bold text-purple-600">{aiRecommendation.confidence}%</div>
                  <div className="text-xs text-gray-600">Confidence</div>
                </div>
              </div>

              <div className="bg-white rounded-lg p-4">
                <div className="flex items-center gap-2 mb-3">
                  <span className={`px-3 py-1 rounded-full text-sm font-medium ${
                    aiRecommendation.outcome === 'internal' ? 'bg-blue-100 text-blue-800' :
                    aiRecommendation.outcome === 'external' ? 'bg-green-100 text-green-800' :
                    'bg-purple-100 text-purple-800'
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

          {/* CFO Decision */}
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">CFO Decision</h3>

            <div className="space-y-4">
              <div className="flex gap-3">
                <button
                  onClick={() => setCfoDecision('internal')}
                  className={`flex-1 px-6 py-3 rounded-lg font-medium transition-colors ${
                    cfoDecision === 'internal' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  Go Internal
                </button>
                <button
                  onClick={() => setCfoDecision('external')}
                  className={`flex-1 px-6 py-3 rounded-lg font-medium transition-colors ${
                    cfoDecision === 'external' ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  Outsource
                </button>
                <button
                  onClick={() => setCfoDecision('hybrid')}
                  className={`flex-1 px-6 py-3 rounded-lg font-medium transition-colors ${
                    cfoDecision === 'hybrid' ? 'bg-purple-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  Hybrid Model ✅
                </button>
                <button
                  onClick={() => setCfoDecision('review')}
                  className={`flex-1 px-6 py-3 rounded-lg font-medium transition-colors ${
                    cfoDecision === 'review' ? 'bg-yellow-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  Hold
                </button>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  CFO Notes (optional)
                </label>
                <textarea
                  value={cfoNotes}
                  onChange={(e) => setCfoNotes(e.target.value)}
                  placeholder="Add notes before saving..."
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                />
              </div>

              <button
                onClick={handleSave}
                disabled={!cfoDecision}
                className="w-full px-6 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Save to Audit Trail 📋
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default InternalVsExternal;
