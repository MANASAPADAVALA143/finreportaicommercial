import React, { useState } from 'react';
import { CheckCircle, XCircle, AlertTriangle, Calendar, TrendingUp } from 'lucide-react';
import { auditTrailData } from '../../data/decisionMockData';
import { AuditTrailEntry } from '../../types/decisions';

interface DecisionAuditTrailProps {
  savedDecisions?: AuditTrailEntry[];
}

const DecisionAuditTrail: React.FC<DecisionAuditTrailProps> = ({ savedDecisions = [] }) => {
  const [selectedDecision, setSelectedDecision] = useState<AuditTrailEntry | null>(null);
  
  const allDecisions = [...auditTrailData, ...savedDecisions];

  const getDecisionTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      investment: '💰 Investment',
      build_vs_buy: '🏗️ Build vs Buy',
      internal_vs_external: '🔄 Outsource',
      hire_vs_automate: '👥 Hire vs Auto',
      cost_cut_vs_invest: '✂️ Cost Cut',
      capital_allocation: '🏢 Capital Allocation',
      risk: '⚠️ Risk'
    };
    return labels[type] || type;
  };

  const getOutcomeColor = (outcome: string) => {
    switch (outcome) {
      case 'approve': return 'text-green-600';
      case 'reject': return 'text-red-600';
      case 'conditional': return 'text-yellow-600';
      case 'hybrid': return 'text-purple-600';
      default: return 'text-gray-600';
    }
  };

  const getOutcomeIcon = (outcome: string) => {
    switch (outcome) {
      case 'approve': return '✅';
      case 'reject': return '❌';
      case 'conditional': return '⚠️';
      case 'hybrid': return '🔀';
      default: return '📋';
    }
  };

  // Calculate AI accuracy
  const trackedDecisions = allDecisions.filter(d => d.tracked);
  const correctDecisions = trackedDecisions.filter(d => d.aiCorrect);
  const aiAccuracy = trackedDecisions.length > 0 
    ? Math.round((correctDecisions.length / trackedDecisions.length) * 100) 
    : 0;

  const cfoOverrideCount = allDecisions.filter(d => d.aiOutcome !== d.cfoOutcome).length;
  const overrideRate = Math.round((cfoOverrideCount / allDecisions.length) * 100);

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="text-sm text-gray-600 mb-1">Total Decisions</div>
          <div className="text-3xl font-bold text-gray-900">{allDecisions.length}</div>
        </div>

        <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-lg border border-green-200 p-4">
          <div className="text-sm text-green-700 mb-1">AI Accuracy</div>
          <div className="text-3xl font-bold text-green-600">{aiAccuracy}%</div>
          <div className="text-xs text-green-600 mt-1">
            {correctDecisions.length}/{trackedDecisions.length} tracked
          </div>
        </div>

        <div className="bg-gradient-to-br from-blue-50 to-cyan-50 rounded-lg border border-blue-200 p-4">
          <div className="text-sm text-blue-700 mb-1">CFO Override Rate</div>
          <div className="text-3xl font-bold text-blue-600">{overrideRate}%</div>
          <div className="text-xs text-blue-600 mt-1">
            {cfoOverrideCount} decisions
          </div>
        </div>

        <div className="bg-gradient-to-br from-purple-50 to-indigo-50 rounded-lg border border-purple-200 p-4">
          <div className="text-sm text-purple-700 mb-1">Decisions Saved</div>
          <div className="text-3xl font-bold text-purple-600">₹67L</div>
          <div className="text-xs text-purple-600 mt-1">
            in avoided bad investments
          </div>
        </div>
      </div>

      {/* Decision History Table */}
      <div className="bg-white rounded-lg border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900">Decision History</h3>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left py-3 px-4 text-xs font-medium text-gray-600 uppercase">Date</th>
                <th className="text-left py-3 px-4 text-xs font-medium text-gray-600 uppercase">Type</th>
                <th className="text-left py-3 px-4 text-xs font-medium text-gray-600 uppercase">Decision</th>
                <th className="text-center py-3 px-4 text-xs font-medium text-gray-600 uppercase">AI Rec</th>
                <th className="text-center py-3 px-4 text-xs font-medium text-gray-600 uppercase">CFO</th>
                <th className="text-center py-3 px-4 text-xs font-medium text-gray-600 uppercase">Confidence</th>
                <th className="text-left py-3 px-4 text-xs font-medium text-gray-600 uppercase">Outcome</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {allDecisions.map((decision, idx) => (
                <tr 
                  key={decision.id} 
                  className="hover:bg-gray-50 cursor-pointer transition-colors"
                  onClick={() => setSelectedDecision(decision)}
                >
                  <td className="py-3 px-4 text-sm text-gray-900">
                    <div className="flex items-center gap-2">
                      <Calendar className="w-4 h-4 text-gray-400" />
                      {new Date(decision.date).toLocaleDateString('en-IN', { 
                        day: 'numeric', 
                        month: 'short' 
                      })}
                    </div>
                  </td>
                  <td className="py-3 px-4 text-sm">
                    <span className="text-gray-700">{getDecisionTypeLabel(decision.type)}</span>
                  </td>
                  <td className="py-3 px-4 text-sm font-medium text-gray-900">
                    {decision.title}
                  </td>
                  <td className="py-3 px-4 text-center">
                    <span className={`text-lg ${getOutcomeColor(decision.aiOutcome)}`}>
                      {getOutcomeIcon(decision.aiOutcome)}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-center">
                    <span className={`text-lg ${getOutcomeColor(decision.cfoOutcome)}`}>
                      {getOutcomeIcon(decision.cfoOutcome)}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-center">
                    {decision.confidence && (
                      <span className={`text-sm font-medium ${
                        decision.confidence >= 80 ? 'text-green-600' :
                        decision.confidence >= 60 ? 'text-yellow-600' :
                        'text-red-600'
                      }`}>
                        {decision.confidence}%
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-sm">
                    {decision.tracked ? (
                      <div className="flex items-center gap-2">
                        {decision.aiCorrect ? (
                          <CheckCircle className="w-4 h-4 text-green-600" />
                        ) : (
                          <XCircle className="w-4 h-4 text-red-600" />
                        )}
                        <span className={decision.aiCorrect ? 'text-green-600' : 'text-red-600'}>
                          {decision.aiCorrect ? 'AI Correct' : 'AI Wrong'}
                        </span>
                      </div>
                    ) : (
                      <span className="text-gray-400 flex items-center gap-1">
                        <AlertTriangle className="w-4 h-4" />
                        Pending
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Decision Detail Modal */}
      {selectedDecision && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-2xl w-full p-6">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="text-xl font-bold text-gray-900 mb-1">
                  {selectedDecision.title}
                </h3>
                <p className="text-sm text-gray-600">
                  {getDecisionTypeLabel(selectedDecision.type)} • {new Date(selectedDecision.date).toLocaleDateString('en-IN', { 
                    day: 'numeric', 
                    month: 'long',
                    year: 'numeric'
                  })}
                </p>
              </div>
              <button
                onClick={() => setSelectedDecision(null)}
                className="text-gray-400 hover:text-gray-600 text-2xl"
              >
                ×
              </button>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-purple-50 rounded-lg p-4 border border-purple-200">
                  <div className="text-sm text-gray-600 mb-1">AI Recommendation</div>
                  <div className={`text-2xl font-bold ${getOutcomeColor(selectedDecision.aiOutcome)}`}>
                    {getOutcomeIcon(selectedDecision.aiOutcome)} {selectedDecision.aiOutcome.toUpperCase()}
                  </div>
                  {selectedDecision.confidence && (
                    <div className="text-sm text-gray-600 mt-1">
                      Confidence: <span className="font-semibold">{selectedDecision.confidence}%</span>
                    </div>
                  )}
                </div>

                <div className="bg-blue-50 rounded-lg p-4 border border-blue-200">
                  <div className="text-sm text-gray-600 mb-1">CFO Decision</div>
                  <div className={`text-2xl font-bold ${getOutcomeColor(selectedDecision.cfoOutcome)}`}>
                    {getOutcomeIcon(selectedDecision.cfoOutcome)} {selectedDecision.cfoOutcome.toUpperCase()}
                  </div>
                  {selectedDecision.aiOutcome !== selectedDecision.cfoOutcome && (
                    <div className="text-sm text-blue-600 mt-1 font-medium">
                      ⚡ CFO Override
                    </div>
                  )}
                </div>
              </div>

              {selectedDecision.tracked && (
                <div className={`rounded-lg p-4 border-2 ${
                  selectedDecision.aiCorrect 
                    ? 'bg-green-50 border-green-300' 
                    : 'bg-red-50 border-red-300'
                }`}>
                  <div className="flex items-center gap-2 mb-2">
                    {selectedDecision.aiCorrect ? (
                      <CheckCircle className="w-5 h-5 text-green-600" />
                    ) : (
                      <XCircle className="w-5 h-5 text-red-600" />
                    )}
                    <span className={`font-semibold ${
                      selectedDecision.aiCorrect ? 'text-green-800' : 'text-red-800'
                    }`}>
                      AI was {selectedDecision.aiCorrect ? 'CORRECT' : 'INCORRECT'}
                    </span>
                  </div>
                  <p className={`text-sm ${
                    selectedDecision.aiCorrect ? 'text-green-700' : 'text-red-700'
                  }`}>
                    <span className="font-medium">Outcome:</span> {selectedDecision.outcome}
                  </p>
                </div>
              )}

              {!selectedDecision.tracked && (
                <div className="bg-yellow-50 rounded-lg p-4 border border-yellow-200">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-5 h-5 text-yellow-600" />
                    <span className="font-semibold text-yellow-800">
                      Outcome tracking pending
                    </span>
                  </div>
                  <p className="text-sm text-yellow-700 mt-1">
                    Decision is too recent to track results. Check back in 3-6 months.
                  </p>
                </div>
              )}

              <button
                onClick={() => setSelectedDecision(null)}
                className="w-full px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors font-medium"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AI Learning Insights */}
      <div className="bg-gradient-to-r from-indigo-50 to-purple-50 rounded-lg border border-indigo-200 p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-purple-600" />
          AI Learning Insights
        </h3>

        <div className="grid grid-cols-2 gap-4">
          <div className="bg-white rounded-lg p-4">
            <div className="text-sm text-gray-600 mb-2">Strongest Decision Type</div>
            <div className="text-lg font-bold text-green-600">Cost Cut vs Invest</div>
            <div className="text-xs text-gray-600 mt-1">95% accuracy on 20 decisions</div>
          </div>

          <div className="bg-white rounded-lg p-4">
            <div className="text-sm text-gray-600 mb-2">Needs Improvement</div>
            <div className="text-lg font-bold text-yellow-600">Build vs Buy</div>
            <div className="text-xs text-gray-600 mt-1">65% accuracy - adding more training data</div>
          </div>
        </div>

        <div className="mt-4 pt-4 border-t border-indigo-200">
          <p className="text-sm text-gray-700">
            <span className="font-semibold">AI Model Performance:</span> The recommendation engine improves with every decision. 
            Your feedback helps refine predictions for future strategic choices.
          </p>
        </div>
      </div>
    </div>
  );
};

export default DecisionAuditTrail;
