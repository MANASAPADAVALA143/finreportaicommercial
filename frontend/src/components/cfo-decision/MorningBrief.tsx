import React from 'react';
import { AlertCircle, AlertTriangle, Info, ArrowRight } from 'lucide-react';
import { MorningBriefItem } from '../../types/decisions';

interface MorningBriefProps {
  items: MorningBriefItem[];
  onActionClick: (action: string) => void;
}

const MorningBrief: React.FC<MorningBriefProps> = ({ items, onActionClick }) => {
  const getUrgencyConfig = (urgency: string) => {
    switch (urgency) {
      case 'critical':
        return {
          icon: AlertCircle,
          color: 'text-red-600',
          bgColor: 'bg-red-50',
          borderColor: 'border-l-red-500'
        };
      case 'warning':
        return {
          icon: AlertTriangle,
          color: 'text-yellow-600',
          bgColor: 'bg-yellow-50',
          borderColor: 'border-l-yellow-500'
        };
      default:
        return {
          icon: Info,
          color: 'text-blue-600',
          bgColor: 'bg-blue-50',
          borderColor: 'border-l-blue-500'
        };
    }
  };

  const criticalCount = items.filter(item => item.urgency === 'critical').length;
  const warningCount = items.filter(item => item.urgency === 'warning').length;
  const resolvedCount = items.filter(item => item.urgency === 'info').length;

  return (
    <div className="bg-gradient-to-r from-amber-50 to-orange-50 rounded-lg p-6 border border-amber-200 mb-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            🌅 Morning Brief
            <span className="text-sm font-normal text-gray-600">
              {new Date().toLocaleDateString('en-IN', { weekday: 'long', month: 'short', day: 'numeric' })}
            </span>
          </h3>
          <p className="text-sm text-gray-600 mt-1">
            AI-generated alerts requiring your attention
          </p>
        </div>
        <div className="flex items-center gap-4 text-sm">
          {criticalCount + warningCount > 0 && (
            <span className="text-red-600 font-medium">
              🔴 {criticalCount + warningCount} decision{criticalCount + warningCount > 1 ? 's' : ''} need attention
            </span>
          )}
          {resolvedCount > 0 && (
            <span className="text-green-600 font-medium">
              ✅ {resolvedCount} resolved
            </span>
          )}
        </div>
      </div>

      <div className="space-y-3">
        {items.map((item, index) => {
          const config = getUrgencyConfig(item.urgency);
          const Icon = config.icon;

          return (
            <div
              key={index}
              className={`${config.bgColor} ${config.borderColor} border-l-4 rounded-r-lg p-4`}
            >
              <div className="flex items-start gap-3">
                <Icon className={`${config.color} w-5 h-5 mt-0.5 flex-shrink-0`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <h4 className="font-semibold text-gray-900 text-sm mb-1">
                        {item.title}
                      </h4>
                      <p className="text-sm text-gray-700 mb-2">
                        <span className="font-medium">Decision:</span> {item.decision}
                      </p>
                      <p className="text-sm text-gray-600">
                        <span className="font-medium">Impact:</span> {item.impact}
                      </p>
                    </div>
                    {item.action && (
                      <button
                        onClick={() => onActionClick(item.action!)}
                        className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors text-sm font-medium text-gray-700 whitespace-nowrap"
                      >
                        Take Action
                        <ArrowRight className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default MorningBrief;
