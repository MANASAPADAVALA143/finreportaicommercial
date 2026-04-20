import React, { useState } from 'react';
import { TrendingUp, TrendingDown, Minus, AlertCircle, CheckCircle, AlertTriangle } from 'lucide-react';
import { InvestmentInputs } from '../../types/decisions';
import { calculateInvestmentMetrics, generateDecisionRecommendation } from '../../services/decisionEngine';
import { compareProjectsData } from '../../data/decisionMockData';
import { loadCFODecisionData } from '../../services/cfoDecisionDataService';

interface InvestmentDecisionProps {
  onSaveToAudit: (decision: any) => void;
}

const InvestmentDecision: React.FC<InvestmentDecisionProps> = ({ onSaveToAudit }) => {
  const uploadedData = loadCFODecisionData();
  const firstProject = uploadedData?.investment?.[0];
  
  const [inputs, setInputs] = useState<InvestmentInputs>(firstProject ? {
    projectName: firstProject.projectName,
    investment: firstProject.investment,
    annualReturns: firstProject.yearlyRevenue - firstProject.yearlyCost,
    projectLife: firstProject.projectYears,
    riskLevel: 'medium',
    discountRate: firstProject.discountRate,
    strategicValue: 'medium',
    cashPosition: firstProject.investment * 1.5
  } : {
    projectName: 'New ERP System',
    investment: 20000000,
    annualReturns: 5000000,
    projectLife: 5,
    riskLevel: 'medium',
    discountRate: 12,
    strategicValue: 'medium',
    cashPosition: 25000000
  });

  const [metrics, setMetrics] = useState<any>(null);
  const [aiRecommendation, setAiRecommendation] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [cfoDecision, setCfoDecision] = useState<string>('');
  const [cfoNotes, setCfoNotes] = useState('');

  const handleCalculate = async () => {
    setLoading(true);
    
    // Calculate metrics
    const calculated = calculateInvestmentMetrics(
      inputs.investment,
      inputs.annualReturns,
      inputs.projectLife,
      inputs.discountRate
    );
    
    setMetrics(calculated);

    // Get AI recommendation
    try {
      const recommendation = await generateDecisionRecommendation('investment', {
        ...calculated,
        investment: inputs.investment,
        hurdleRate: inputs.discountRate,
        risk: inputs.riskLevel,
        cashPosition: inputs.cashPosition
      });
      
      setAiRecommendation(recommendation);
    } catch (error) {
      console.error('Error getting AI recommendation:', error);
    }
    
    setLoading(false);
  };

  const handleSave = () => {
    if (!metrics || !aiRecommendation) return;
    
    const decision = {
      id: `inv-${Date.now()}`,
      type: 'investment',
      title: `${inputs.projectName} - ₹${(inputs.investment / 10000000).toFixed(1)}Cr`,
      date: new Date().toISOString().split('T')[0],
      inputs,
      results: {
        primaryMetric: metrics.npv,
        secondaryMetrics: {
          irr: metrics.irr,
          payback: metrics.payback,
          roi: metrics.roi
        },
        riskScore: metrics.riskScore,
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

  const formatCurrency = (amount: number) => {
    if (amount >= 10000000) return `₹${(amount / 10000000).toFixed(2)}Cr`;
    if (amount >= 100000) return `₹${(amount / 100000).toFixed(1)}L`;
    return `₹${amount.toLocaleString('en-IN')}`;
  };

  const getMetricStatus = (metric: string, value: number) => {
    switch (metric) {
      case 'npv':
        return value > 0 ? 'positive' : 'negative';
      case 'irr':
        return value > inputs.discountRate ? 'positive' : 'negative';
      case 'payback':
        return value < 3 ? 'positive' : value < 5 ? 'neutral' : 'negative';
      case 'roi':
        return value > 20 ? 'positive' : value > 10 ? 'neutral' : 'negative';
      default:
        return 'neutral';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'positive':
        return <CheckCircle className="w-5 h-5 text-green-600" />;
      case 'negative':
        return <AlertCircle className="w-5 h-5 text-red-600" />;
      default:
        return <AlertTriangle className="w-5 h-5 text-yellow-600" />;
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'positive':
        return 'text-green-600';
      case 'negative':
        return 'text-red-600';
      default:
        return 'text-yellow-600';
    }
  };

  return (
    <div className="space-y-6">
      {/* Uploaded Projects Selector */}
      {uploadedData && uploadedData.investment.length > 0 && (
        <div className="bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <CheckCircle className="w-5 h-5 text-green-600" />
              <div>
                <p className="font-semibold text-green-900">
                  ✅ {uploadedData.investment.length} Investment Project{uploadedData.investment.length > 1 ? 's' : ''} Loaded
                </p>
                <p className="text-sm text-green-700">
                  Select a project from your uploaded data or enter manually below
                </p>
              </div>
            </div>
            {uploadedData.investment.length > 1 && (
              <select
                onChange={(e) => {
                  const project = uploadedData.investment[Number(e.target.value)];
                  if (project) {
                    setInputs({
                      projectName: project.projectName,
                      investment: project.investment,
                      annualReturns: project.yearlyRevenue - project.yearlyCost,
                      projectLife: project.projectYears,
                      riskLevel: 'medium',
                      discountRate: project.discountRate,
                      strategicValue: 'medium',
                      cashPosition: project.investment * 1.5
                    });
                  }
                }}
                className="px-3 py-2 border border-green-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-green-500"
              >
                {uploadedData.investment.map((project, idx) => (
                  <option key={idx} value={idx}>
                    {project.projectName} - ₹{(project.investment / 10000000).toFixed(1)}Cr
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>
      )}

      {/* Input Form */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Investment Details</h3>
        
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Project Name
            </label>
            <input
              type="text"
              value={inputs.projectName}
              onChange={(e) => setInputs({ ...inputs, projectName: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Total Investment (₹)
            </label>
            <input
              type="number"
              value={inputs.investment}
              onChange={(e) => setInputs({ ...inputs, investment: Number(e.target.value) })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Annual Returns (₹)
            </label>
            <input
              type="number"
              value={inputs.annualReturns}
              onChange={(e) => setInputs({ ...inputs, annualReturns: Number(e.target.value) })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Project Life (years)
            </label>
            <input
              type="number"
              value={inputs.projectLife}
              onChange={(e) => setInputs({ ...inputs, projectLife: Number(e.target.value) })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Risk Level
            </label>
            <div className="flex gap-4">
              {['low', 'medium', 'high'].map((level) => (
                <label key={level} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="riskLevel"
                    value={level}
                    checked={inputs.riskLevel === level}
                    onChange={(e) => setInputs({ ...inputs, riskLevel: e.target.value as any })}
                    className="text-amber-600 focus:ring-amber-500"
                  />
                  <span className="text-sm text-gray-700 capitalize">{level}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Discount Rate (%) <span className="text-gray-500 text-xs">← auto from WACC</span>
            </label>
            <input
              type="number"
              value={inputs.discountRate}
              onChange={(e) => setInputs({ ...inputs, discountRate: Number(e.target.value) })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Strategic Value
            </label>
            <div className="flex gap-4">
              {['low', 'medium', 'high'].map((level) => (
                <label key={level} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="strategicValue"
                    value={level}
                    checked={inputs.strategicValue === level}
                    onChange={(e) => setInputs({ ...inputs, strategicValue: e.target.value as any })}
                    className="text-amber-600 focus:ring-amber-500"
                  />
                  <span className="text-sm text-gray-700 capitalize">{level}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Current Cash Position (₹)
            </label>
            <input
              type="number"
              value={inputs.cashPosition}
              onChange={(e) => setInputs({ ...inputs, cashPosition: Number(e.target.value) })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
            />
          </div>
        </div>

        <button
          onClick={handleCalculate}
          disabled={loading}
          className="mt-6 px-6 py-3 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
        >
          {loading ? 'Calculating...' : 'Calculate & Decide ▶'}
        </button>
      </div>

      {/* Results */}
      {metrics && (
        <>
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Financial Metrics</h3>
            
            <div className="grid grid-cols-4 gap-6">
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-700">NPV</span>
                  {getStatusIcon(getMetricStatus('npv', metrics.npv))}
                </div>
                <div className={`text-2xl font-bold ${getStatusText(getMetricStatus('npv', metrics.npv))}`}>
                  {formatCurrency(metrics.npv)}
                </div>
                <p className="text-xs text-gray-600">
                  {metrics.npv > 0 ? 'Positive' : 'Negative'}
                </p>
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-700">IRR</span>
                  {getStatusIcon(getMetricStatus('irr', metrics.irr))}
                </div>
                <div className={`text-2xl font-bold ${getStatusText(getMetricStatus('irr', metrics.irr))}`}>
                  {metrics.irr}%
                </div>
                <p className="text-xs text-gray-600">
                  {metrics.irr > inputs.discountRate ? 'Above hurdle' : 'Below hurdle'} ({inputs.discountRate}%)
                </p>
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-700">Payback</span>
                  {getStatusIcon(getMetricStatus('payback', metrics.payback))}
                </div>
                <div className={`text-2xl font-bold ${getStatusText(getMetricStatus('payback', metrics.payback))}`}>
                  {metrics.payback} yrs
                </div>
                <p className="text-xs text-gray-600">
                  {metrics.payback < 3 ? 'Excellent' : metrics.payback < 5 ? 'Borderline' : 'Long'}
                </p>
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-700">ROI</span>
                  {getStatusIcon(getMetricStatus('roi', metrics.roi))}
                </div>
                <div className={`text-2xl font-bold ${getStatusText(getMetricStatus('roi', metrics.roi))}`}>
                  {metrics.roi}%
                </div>
                <p className="text-xs text-gray-600">
                  {metrics.roi > 20 ? 'Good return' : 'Moderate return'}
                </p>
              </div>
            </div>

            <div className="mt-4 pt-4 border-t border-gray-200">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-700">Risk Score</span>
                <span className={`text-lg font-bold ${metrics.riskScore > 7 ? 'text-red-600' : metrics.riskScore > 5 ? 'text-yellow-600' : 'text-green-600'}`}>
                  {metrics.riskScore}/10
                </span>
              </div>
            </div>
          </div>

          {/* AI Recommendation - hidden when Nova/credentials error so users don't see technical message */}
          {aiRecommendation && !(aiRecommendation.confidence === 0 && (aiRecommendation.recommendation?.startsWith('Unable to generate') || /security token|AI call failed|invalid.*token/i.test(aiRecommendation.recommendation || ''))) && (
            <div className="bg-gradient-to-r from-purple-50 to-indigo-50 rounded-lg border border-purple-200 p-6">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                    🤖 AI Recommendation (Amazon Nova)
                  </h3>
                  <p className="text-sm text-gray-600 mt-1">
                    Powered by AI (backend Claude)
                  </p>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-bold text-purple-600">
                    {aiRecommendation.confidence}%
                  </div>
                  <div className="text-xs text-gray-600">Confidence</div>
                </div>
              </div>

              <div className="bg-white rounded-lg p-4 mb-4">
                <div className="flex items-center gap-2 mb-3">
                  <span className={`px-3 py-1 rounded-full text-sm font-medium ${
                    aiRecommendation.outcome === 'approve' ? 'bg-green-100 text-green-800' :
                    aiRecommendation.outcome === 'conditional' ? 'bg-yellow-100 text-yellow-800' :
                    'bg-red-100 text-red-800'
                  }`}>
                    {aiRecommendation.outcome.toUpperCase()}
                    {aiRecommendation.outcome === 'approve' && ' ✅'}
                    {aiRecommendation.outcome === 'conditional' && ' ⚠️'}
                    {aiRecommendation.outcome === 'reject' && ' ❌'}
                  </span>
                </div>
                <p className="text-gray-800 leading-relaxed whitespace-pre-wrap">
                  {aiRecommendation.recommendation}
                </p>
              </div>

              {/* Confidence Factors */}
              {aiRecommendation.confidenceFactors && aiRecommendation.confidenceFactors.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-sm font-semibold text-gray-900">Confidence Factors:</h4>
                  {aiRecommendation.confidenceFactors.map((factor: any, idx: number) => (
                    <div key={idx} className="flex items-start gap-2 text-sm">
                      {factor.status === 'positive' && <CheckCircle className="w-4 h-4 text-green-600 mt-0.5" />}
                      {factor.status === 'negative' && <AlertCircle className="w-4 h-4 text-red-600 mt-0.5" />}
                      {factor.status === 'neutral' && <AlertTriangle className="w-4 h-4 text-yellow-600 mt-0.5" />}
                      <div>
                        <span className="font-medium text-gray-900">{factor.factor}</span>
                        <span className="text-gray-600"> ({factor.impact} confidence)</span>
                        <p className="text-gray-600">{factor.detail}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* CFO Decision */}
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">CFO Decision</h3>
            
            <div className="space-y-4">
              <div className="flex gap-3">
                <button
                  onClick={() => setCfoDecision('approve')}
                  className={`flex-1 px-6 py-3 rounded-lg font-medium transition-colors ${
                    cfoDecision === 'approve'
                      ? 'bg-green-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  Approve ✅
                </button>
                <button
                  onClick={() => setCfoDecision('reject')}
                  className={`flex-1 px-6 py-3 rounded-lg font-medium transition-colors ${
                    cfoDecision === 'reject'
                      ? 'bg-red-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  Reject ❌
                </button>
                <button
                  onClick={() => setCfoDecision('conditional')}
                  className={`flex-1 px-6 py-3 rounded-lg font-medium transition-colors ${
                    cfoDecision === 'conditional'
                      ? 'bg-yellow-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}>
                  Hold ⏸️
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
                className="w-full px-6 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                Save to Audit Trail 📋
              </button>
            </div>
          </div>
        </>
      )}

      {/* Compare Projects Table */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Compare Multiple Projects</h3>
        
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-3 px-4 text-sm font-medium text-gray-700">Project</th>
                <th className="text-right py-3 px-4 text-sm font-medium text-gray-700">Investment</th>
                <th className="text-right py-3 px-4 text-sm font-medium text-gray-700">NPV</th>
                <th className="text-right py-3 px-4 text-sm font-medium text-gray-700">IRR</th>
                <th className="text-right py-3 px-4 text-sm font-medium text-gray-700">Payback</th>
                <th className="text-right py-3 px-4 text-sm font-medium text-gray-700">Score</th>
                <th className="text-center py-3 px-4 text-sm font-medium text-gray-700">Decision</th>
              </tr>
            </thead>
            <tbody>
              {compareProjectsData.map((project, idx) => (
                <tr key={idx} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="py-3 px-4 text-sm font-medium text-gray-900">{project.name}</td>
                  <td className="py-3 px-4 text-sm text-right text-gray-700">{formatCurrency(project.investment)}</td>
                  <td className={`py-3 px-4 text-sm text-right font-medium ${project.npv > 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {formatCurrency(project.npv)}
                  </td>
                  <td className="py-3 px-4 text-sm text-right text-gray-700">{project.irr}%</td>
                  <td className="py-3 px-4 text-sm text-right text-gray-700">{project.payback}y</td>
                  <td className="py-3 px-4 text-sm text-right font-medium text-gray-900">{project.score}</td>
                  <td className="py-3 px-4 text-center">
                    {project.decision === 'approve' ? (
                      <span className="text-green-600 font-medium">✅</span>
                    ) : (
                      <span className="text-red-600 font-medium">❌</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-4 pt-4 border-t border-gray-200">
          <p className="text-sm font-medium text-purple-600">
            🤖 AI RANKING: Sales Expansion &gt; AI Platform &gt; ERP System &gt; New Office
          </p>
        </div>
      </div>
    </div>
  );
};

export default InvestmentDecision;
