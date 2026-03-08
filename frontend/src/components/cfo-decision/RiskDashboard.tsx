import React from 'react';
import { TrendingUp, TrendingDown, Minus, AlertCircle } from 'lucide-react';
import { riskData } from '../../data/decisionMockData';

const RiskDashboard: React.FC = () => {
  const getRiskColor = (status: string) => {
    switch (status) {
      case 'high': return 'text-red-600 bg-red-50 border-red-200';
      case 'medium': return 'text-yellow-600 bg-yellow-50 border-yellow-200';
      default: return 'text-green-600 bg-green-50 border-green-200';
    }
  };

  const getTrendIcon = (trend: string) => {
    switch (trend) {
      case 'improving': return <TrendingDown className="w-4 h-4 text-green-600" />;
      case 'worsening': return <TrendingUp className="w-4 h-4 text-red-600" />;
      default: return <Minus className="w-4 h-4 text-gray-600" />;
    }
  };

  const getStatusEmoji = (status: string) => {
    switch (status) {
      case 'high': return '🔴';
      case 'medium': return '🟡';
      default: return '🟢';
    }
  };

  const risks = [
    { name: 'Liquidity', icon: '💧', ...riskData.liquidity },
    { name: 'Credit', icon: '💳', ...riskData.credit },
    { name: 'Operational', icon: '⚙️', ...riskData.operational },
    { name: 'Market', icon: '📈', ...riskData.market },
    { name: 'Compliance', icon: '📋', ...riskData.compliance },
    { name: 'FX', icon: '💱', ...riskData.fx },
    { name: 'Concentration', icon: '🏢', ...riskData.concentration }
  ];

  const overallStatus = riskData.overall > 7 ? 'high' : riskData.overall > 5 ? 'medium' : 'low';

  return (
    <div className="space-y-6">
      {/* Overall Risk Score */}
      <div className="bg-gradient-to-r from-red-50 to-orange-50 rounded-lg border-2 border-red-200 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-2xl font-bold text-gray-900 mb-1">
              Overall Risk Score
            </h3>
            <p className="text-sm text-gray-600">
              {getStatusEmoji(overallStatus)} MEDIUM-HIGH{' '}
              <span className="text-red-600 font-medium">↑ Deteriorating</span>
            </p>
          </div>
          <div className="text-right">
            <div className="text-5xl font-bold text-red-600">
              {riskData.overall.toFixed(1)}<span className="text-2xl text-gray-600">/10</span>
            </div>
          </div>
        </div>
      </div>

      {/* Risk Categories */}
      <div className="bg-white rounded-lg border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900">Risk Categories</h3>
        </div>

        <div className="divide-y divide-gray-100">
          {risks.map((risk, idx) => (
            <div key={idx} className="px-6 py-4 hover:bg-gray-50 transition-colors">
              <div className="flex items-center gap-4">
                <div className="text-3xl">{risk.icon}</div>
                
                <div className="flex-1 min-w-0">
                  <h4 className="font-semibold text-gray-900 mb-1">{risk.name}</h4>
                  <p className="text-sm text-gray-600">{risk.action}</p>
                </div>

                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <div className="text-2xl font-bold text-gray-900">{risk.score.toFixed(1)}/10</div>
                  </div>

                  <div className="flex items-center gap-2">
                    {getTrendIcon(risk.trend)}
                  </div>

                  <div>
                    <span className={`px-3 py-1.5 rounded-full text-sm font-medium border ${getRiskColor(risk.status)}`}>
                      {getStatusEmoji(risk.status)} {risk.status.toUpperCase()}
                    </span>
                  </div>

                  <div className="w-24">
                    {risk.status === 'high' && (
                      <span className="text-sm font-medium text-red-600">URGENT</span>
                    )}
                    {risk.status === 'medium' && (
                      <span className="text-sm font-medium text-yellow-600">Watch</span>
                    )}
                    {risk.status === 'low' && (
                      <span className="text-sm font-medium text-green-600">OK</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* AI Risk Actions */}
      <div className="bg-gradient-to-r from-purple-50 to-indigo-50 rounded-lg border border-purple-200 p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
          🤖 AI Risk Actions (Amazon Nova)
        </h3>

        <div className="space-y-3">
          {risks
            .filter(r => r.status === 'high')
            .map((risk, idx) => (
              <div key={idx} className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" />
                <div>
                  <span className="font-semibold text-red-600">{risk.name}:</span>
                  <span className="text-gray-800 ml-2">{risk.action}</span>
                </div>
              </div>
            ))}

          {risks
            .filter(r => r.status === 'medium')
            .map((risk, idx) => (
              <div key={idx} className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-yellow-600 mt-0.5 flex-shrink-0" />
                <div>
                  <span className="font-semibold text-yellow-600">{risk.name}:</span>
                  <span className="text-gray-800 ml-2">{risk.action}</span>
                </div>
              </div>
            ))}
        </div>

        <div className="mt-6 pt-4 border-t border-purple-200 flex gap-3">
          <button className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors font-medium">
            Export Risk Report
          </button>
          <button className="px-4 py-2 bg-white border border-purple-300 text-purple-700 rounded-lg hover:bg-purple-50 transition-colors font-medium">
            Add to Board Pack
          </button>
          <button className="px-4 py-2 bg-white border border-purple-300 text-purple-700 rounded-lg hover:bg-purple-50 transition-colors font-medium">
            Set Alerts
          </button>
        </div>
      </div>
    </div>
  );
};

export default RiskDashboard;
