import React, { useState } from 'react';
import { CheckCircle, XCircle, AlertTriangle } from 'lucide-react';
import { BuildVsBuyInputs } from '../../types/decisions';
import { calculateBuildVsBuyMetrics, generateDecisionRecommendation } from '../../services/decisionEngine';

interface BuildVsBuyProps {
  onSaveToAudit: (decision: any) => void;
}

const BuildVsBuy: React.FC<BuildVsBuyProps> = ({ onSaveToAudit }) => {
  const [inputs, setInputs] = useState<BuildVsBuyInputs>({
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

  const [results, setResults] = useState<any>(null);
  const [aiRecommendation, setAiRecommendation] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [cfoDecision, setCfoDecision] = useState<string>('');
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

  const handleSave = () => {
    if (!results || !aiRecommendation) return;

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

  return (
    <div className="space-y-6">
      {/* Input Form */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Requirements</h3>

        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              What we need
            </label>
            <input
              type="text"
              value={inputs.requirement}
              onChange={(e) => setInputs({ ...inputs, requirement: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
            />
          </div>

          <div className="col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Core requirement
            </label>
            <input
              type="text"
              value={inputs.coreRequirement}
              onChange={(e) => setInputs({ ...inputs, coreRequirement: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-6">
          {/* BUILD OPTION */}
          <div className="space-y-4">
            <h4 className="font-semibold text-gray-900 border-b pb-2">🏗️ BUILD OPTION</h4>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Development cost (₹)
              </label>
              <input
                type="number"
                value={inputs.buildCost}
                onChange={(e) => setInputs({ ...inputs, buildCost: Number(e.target.value) })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Build timeline (months)
              </label>
              <input
                type="number"
                value={inputs.buildTimeline}
                onChange={(e) => setInputs({ ...inputs, buildTimeline: Number(e.target.value) })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Team needed (developers)
              </label>
              <input
                type="number"
                value={inputs.buildTeam}
                onChange={(e) => setInputs({ ...inputs, buildTeam: Number(e.target.value) })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Annual maintenance (₹)
              </label>
              <input
                type="number"
                value={inputs.buildMaintenance}
                onChange={(e) => setInputs({ ...inputs, buildMaintenance: Number(e.target.value) })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Customization
              </label>
              <div className="space-y-2">
                {['full', 'partial', 'none'].map((level) => (
                  <label key={level} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="buildCustomization"
                      value={level}
                      checked={inputs.buildCustomization === level}
                      onChange={(e) => setInputs({ ...inputs, buildCustomization: e.target.value as any })}
                      className="text-amber-600 focus:ring-amber-500"
                    />
                    <span className="text-sm text-gray-700 capitalize">{level}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          {/* BUY OPTION */}
          <div className="space-y-4">
            <h4 className="font-semibold text-gray-900 border-b pb-2">💰 BUY OPTION</h4>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Vendor name
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
                License cost (₹/year)
              </label>
              <input
                type="number"
                value={inputs.buyCost}
                onChange={(e) => setInputs({ ...inputs, buyCost: Number(e.target.value) })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Implementation (₹, one-time)
              </label>
              <input
                type="number"
                value={inputs.buyImplementation}
                onChange={(e) => setInputs({ ...inputs, buyImplementation: Number(e.target.value) })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Go-live (months)
              </label>
              <input
                type="number"
                value={inputs.buyTimeline}
                onChange={(e) => setInputs({ ...inputs, buyTimeline: Number(e.target.value) })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Customization
              </label>
              <div className="space-y-2">
                {['full', 'partial', 'none'].map((level) => (
                  <label key={level} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="buyCustomization"
                      value={level}
                      checked={inputs.buyCustomization === level}
                      onChange={(e) => setInputs({ ...inputs, buyCustomization: e.target.value as any })}
                      className="text-amber-600 focus:ring-amber-500"
                    />
                    <span className="text-sm text-gray-700 capitalize">{level}</span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Vendor lock-in
              </label>
              <div className="space-y-2">
                {['high', 'medium', 'low'].map((level) => (
                  <label key={level} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="vendorLockIn"
                      value={level}
                      checked={inputs.vendorLockIn === level}
                      onChange={(e) => setInputs({ ...inputs, vendorLockIn: e.target.value as any })}
                      className="text-amber-600 focus:ring-amber-500"
                    />
                    <span className="text-sm text-gray-700 capitalize">{level}</span>
                  </label>
                ))}
              </div>
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
          {/* 5-Year Cost Comparison */}
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">5-Year Cost Comparison</h3>

            <div className="grid grid-cols-2 gap-6">
              <div className="space-y-3">
                <h4 className="font-semibold text-blue-600">BUILD:</h4>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Development:</span>
                    <span className="font-medium">{formatCurrency(inputs.buildCost)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Maintenance (5yr):</span>
                    <span className="font-medium">{formatCurrency(inputs.buildMaintenance * 5)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Team cost (5yr):</span>
                    <span className="font-medium">{formatCurrency(inputs.buildTeam * 1200000 * 5)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Opportunity:</span>
                    <span className="font-medium">{formatCurrency(inputs.buildTimeline > 6 ? 3000000 : 0)}</span>
                  </div>
                  <div className="flex justify-between pt-2 border-t border-gray-200">
                    <span className="font-semibold text-gray-900">TOTAL:</span>
                    <span className="font-bold text-blue-600 text-lg">{formatCurrency(results.buildTotal)}</span>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <h4 className="font-semibold text-green-600">BUY:</h4>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600">License (5yr):</span>
                    <span className="font-medium">{formatCurrency(inputs.buyCost * 5)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Implementation:</span>
                    <span className="font-medium">{formatCurrency(inputs.buyImplementation)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Customization:</span>
                    <span className="font-medium">{formatCurrency(2000000)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Support:</span>
                    <span className="font-medium">{formatCurrency(2500000)}</span>
                  </div>
                  <div className="flex justify-between pt-2 border-t border-gray-200">
                    <span className="font-semibold text-gray-900">TOTAL:</span>
                    <span className="font-bold text-green-600 text-lg">{formatCurrency(results.buyTotal)}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-4 pt-4 border-t border-gray-200">
              <p className={`text-center text-lg font-semibold ${results.savings > 0 ? 'text-green-600' : 'text-red-600'}`}>
                {results.savings > 0 ? 'BUILD CHEAPER' : 'BUY CHEAPER'} BY {formatCurrency(Math.abs(results.savings))} over 5 years
              </p>
            </div>
          </div>

          {/* Scorecard */}
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Scorecard</h3>

            <div className="space-y-3">
              {[
                { name: 'Cost (5yr)', build: formatCurrency(results.buildTotal), buy: formatCurrency(results.buyTotal), buildBetter: results.buildTotal < results.buyTotal },
                { name: 'Time to value', build: `${inputs.buildTimeline} mo`, buy: `${inputs.buyTimeline} mo`, buildBetter: inputs.buildTimeline <= inputs.buyTimeline },
                { name: 'Customization', build: inputs.buildCustomization, buy: inputs.buyCustomization, buildBetter: inputs.buildCustomization === 'full' },
                { name: 'Vendor risk', build: 'None', buy: inputs.vendorLockIn, buildBetter: true },
                { name: 'Scalability', build: 'High', buy: 'Limited', buildBetter: true },
                { name: 'IP ownership', build: 'Yes', buy: 'No', buildBetter: true },
                { name: 'Maintenance burden', build: 'High', buy: 'Vendor', buildBetter: false },
                { name: 'Integration', build: 'Custom', buy: 'Standard API', buildBetter: true }
              ].map((item, idx) => (
                <div key={idx} className="grid grid-cols-3 gap-4 py-2 border-b border-gray-100 last:border-0">
                  <div className="text-sm font-medium text-gray-700">{item.name}</div>
                  <div className="flex items-center gap-2">
                    {item.buildBetter ? <CheckCircle className="w-4 h-4 text-green-600" /> : <XCircle className="w-4 h-4 text-red-600" />}
                    <span className="text-sm text-gray-900">{item.build}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {!item.buildBetter ? <CheckCircle className="w-4 h-4 text-green-600" /> : 
                     item.buy === 'Limited' || item.buy === 'No' || item.buy === 'high' ? <AlertTriangle className="w-4 h-4 text-yellow-600" /> :
                     <XCircle className="w-4 h-4 text-red-600" />}
                    <span className="text-sm text-gray-900 capitalize">{item.buy}</span>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4 pt-4 border-t border-gray-200 flex items-center justify-between">
              <div>
                <span className="text-sm font-medium text-gray-700">BUILD SCORE:</span>
                <span className="ml-2 text-2xl font-bold text-blue-600">{results.buildScore}/100</span>
              </div>
              <div>
                <span className="text-sm font-medium text-gray-700">BUY SCORE:</span>
                <span className="ml-2 text-2xl font-bold text-green-600">{results.buyScore}/100</span>
              </div>
            </div>
          </div>

          {/* AI Recommendation - hidden when Nova/credentials error */}
          {aiRecommendation && !(aiRecommendation.confidence === 0 && (aiRecommendation.recommendation?.startsWith('Unable to generate') || /security token|AI call failed|invalid.*token/i.test(aiRecommendation.recommendation || ''))) && (
            <div className="bg-gradient-to-r from-purple-50 to-indigo-50 rounded-lg border border-purple-200 p-6">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">🤖 AI Recommendation</h3>
                  <p className="text-sm text-gray-600 mt-1">Powered by AWS Bedrock</p>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-bold text-purple-600">{aiRecommendation.confidence}%</div>
                  <div className="text-xs text-gray-600">Confidence</div>
                </div>
              </div>

              <div className="bg-white rounded-lg p-4">
                <div className="flex items-center gap-2 mb-3">
                  <span className={`px-3 py-1 rounded-full text-sm font-medium ${
                    aiRecommendation.outcome === 'build' ? 'bg-blue-100 text-blue-800' :
                    aiRecommendation.outcome === 'buy' ? 'bg-green-100 text-green-800' :
                    'bg-purple-100 text-purple-800'
                  }`}>
                    {aiRecommendation.outcome.toUpperCase()} ✅
                  </span>
                  <span className="text-sm text-gray-600">
                    (Confidence: {aiRecommendation.confidence}%)
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
                  onClick={() => setCfoDecision('build')}
                  className={`flex-1 px-6 py-3 rounded-lg font-medium transition-colors ${
                    cfoDecision === 'build' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  Approve Build
                </button>
                <button
                  onClick={() => setCfoDecision('buy')}
                  className={`flex-1 px-6 py-3 rounded-lg font-medium transition-colors ${
                    cfoDecision === 'buy' ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  Approve Buy
                </button>
                <button
                  onClick={() => setCfoDecision('hybrid')}
                  className={`flex-1 px-6 py-3 rounded-lg font-medium transition-colors ${
                    cfoDecision === 'hybrid' ? 'bg-purple-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  Hybrid Model
                </button>
                <button
                  onClick={() => setCfoDecision('review')}
                  className={`flex-1 px-6 py-3 rounded-lg font-medium transition-colors ${
                    cfoDecision === 'review' ? 'bg-yellow-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  Request POC
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

export default BuildVsBuy;
