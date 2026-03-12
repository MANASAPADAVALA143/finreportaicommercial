import React, { useState } from 'react';
import {
  FraudPatternAlert,
  AlertSeverity,
  AlertCategory,
} from '../../services/patternAnalysis';

interface Props {
  alerts: FraudPatternAlert[];
}

const CATEGORY_ICON: Record<AlertCategory, string> = {
  user: '👤',
  vendor: '🏢',
  account: '📒',
  timing: '🕐',
  benford: '📊',
};

const CATEGORY_LABEL: Record<AlertCategory, string> = {
  user: 'User Pattern',
  vendor: 'Vendor Pattern',
  account: 'Account Pattern',
  timing: 'Timing Pattern',
  benford: "Benford's Law",
};

const SEVERITY_STYLE: Record<
  AlertSeverity,
  { border: string; bg: string; badgeBg: string; textColor: string; leftBar: string }
> = {
  CRITICAL: {
    border: 'border-red-200',
    bg: 'bg-red-50',
    badgeBg: 'bg-red-600 text-white',
    textColor: 'text-red-900',
    leftBar: 'bg-red-500',
  },
  HIGH: {
    border: 'border-orange-200',
    bg: 'bg-orange-50',
    badgeBg: 'bg-orange-500 text-white',
    textColor: 'text-orange-900',
    leftBar: 'bg-orange-400',
  },
  MEDIUM: {
    border: 'border-amber-200',
    bg: 'bg-amber-50',
    badgeBg: 'bg-amber-400 text-white',
    textColor: 'text-amber-900',
    leftBar: 'bg-amber-400',
  },
};

const FraudPatternAlerts: React.FC<Props> = ({ alerts }) => {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  if (!alerts || alerts.length === 0) {
    return (
      <div className="mb-6 rounded-xl border border-green-200 bg-green-50 px-5 py-4 flex items-center gap-3">
        <span className="text-2xl">✅</span>
        <div>
          <p className="font-semibold text-green-800 text-sm">
            No Cross-Entry Fraud Patterns Detected
          </p>
          <p className="text-green-600 text-xs mt-0.5">
            No suspicious patterns found across entries. Individual entry anomalies may
            still appear in the table below.
          </p>
        </div>
      </div>
    );
  }

  const criticalCount = alerts.filter((a) => a.severity === 'CRITICAL').length;
  const highCount = alerts.filter((a) => a.severity === 'HIGH').length;
  const displayAlerts = showAll ? alerts : alerts.slice(0, 5);

  return (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-xl">⚠️</span>
            <h3 className="text-base font-bold text-gray-900">Fraud Pattern Alerts</h3>
          </div>
          {criticalCount > 0 && (
            <span className="px-2 py-0.5 bg-red-600 text-white rounded-full text-xs font-bold tracking-wide">
              {criticalCount} CRITICAL
            </span>
          )}
          {highCount > 0 && (
            <span className="px-2 py-0.5 bg-orange-500 text-white rounded-full text-xs font-bold">
              {highCount} HIGH
            </span>
          )}
          <span className="px-2 py-0.5 bg-gray-200 text-gray-600 rounded-full text-xs font-medium">
            {alerts.length} patterns detected
          </span>
        </div>
        <p className="text-xs text-gray-400 hidden sm:block">Cross-entry analysis</p>
      </div>

      <div className="space-y-2">
        {displayAlerts.map((alert) => {
          const s = SEVERITY_STYLE[alert.severity];
          const isExpanded = expanded === alert.id;

          return (
            <div
              key={alert.id}
              className={`rounded-lg border ${s.border} ${s.bg} overflow-hidden transition-all duration-150`}
            >
              <button
                className="w-full text-left flex items-stretch"
                onClick={() => setExpanded(isExpanded ? null : alert.id)}
              >
                <div className={`w-1 flex-shrink-0 ${s.leftBar}`} />
                <div className="flex-1 px-4 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2 flex-1 min-w-0">
                      <span className="text-base flex-shrink-0 mt-0.5">
                        {CATEGORY_ICON[alert.category]}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-0.5">
                          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                            {CATEGORY_LABEL[alert.category]}
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded-full text-xs font-bold ${s.badgeBg}`}
                          >
                            {alert.severity}
                          </span>
                        </div>
                        <p className={`text-sm font-semibold ${s.textColor}`}>
                          {alert.detail}
                        </p>
                        <p className="text-xs text-gray-600 mt-0.5">{alert.insight}</p>
                      </div>
                    </div>
                    <div className="flex-shrink-0 flex flex-col items-end gap-1">
                      <span className="text-xs font-bold text-gray-700 whitespace-nowrap">
                        ₹{Math.round(alert.totalAmount).toLocaleString('en-IN')}
                      </span>
                      <span className="text-xs text-gray-400">
                        {alert.entryCount} entr{alert.entryCount > 1 ? 'ies' : 'y'}
                      </span>
                      <span className="text-xs text-blue-500">
                        {isExpanded ? '▲ less' : '▼ more'}
                      </span>
                    </div>
                  </div>
                </div>
              </button>

              {isExpanded && (
                <div className="px-4 pb-4 ml-1 border-t border-gray-200 mt-0 bg-white bg-opacity-60">
                  <div className="pt-3 space-y-3">
                    <div className="flex gap-2">
                      <span className="text-sm flex-shrink-0">🎯</span>
                      <div>
                        <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-0.5">
                          Recommended Action
                        </p>
                        <p className="text-sm text-gray-800">{alert.recommendation}</p>
                      </div>
                    </div>
                    {alert.entryIds.filter(Boolean).length > 0 && (
                      <div className="flex gap-2">
                        <span className="text-sm flex-shrink-0">🔍</span>
                        <div>
                          <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-1">
                            Affected Entries
                          </p>
                          <div className="flex flex-wrap gap-1">
                            {alert.entryIds
                              .filter(Boolean)
                              .slice(0, 12)
                              .map((id) => (
                                <span
                                  key={id}
                                  className="px-2 py-0.5 bg-gray-100 border border-gray-200 rounded text-xs font-mono text-gray-700"
                                >
                                  {id}
                                </span>
                              ))}
                            {alert.entryIds.length > 12 && (
                              <span className="px-2 py-0.5 text-xs text-gray-400">
                                +{alert.entryIds.length - 12} more
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {alerts.length > 5 && (
        <button
          onClick={() => setShowAll(!showAll)}
          className="mt-3 w-full py-2 border border-gray-200 rounded-lg text-sm text-gray-500 hover:text-gray-700 hover:border-gray-300 transition-colors"
        >
          {showAll ? '▲ Show fewer alerts' : `▼ Show all ${alerts.length} alerts`}
        </button>
      )}
    </div>
  );
};

export default FraudPatternAlerts;
