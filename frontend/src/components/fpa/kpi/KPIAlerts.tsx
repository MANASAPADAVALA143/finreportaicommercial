import React from 'react';
import { AlertCircle, AlertTriangle, Info, TrendingUp } from 'lucide-react';
import { KPIAlert } from '../../../types/kpi';

interface KPIAlertsProps {
  alerts: KPIAlert[];
}

const KPIAlerts: React.FC<KPIAlertsProps> = ({ alerts }) => {
  const criticalAlerts = alerts.filter(a => a.severity === 'critical');
  const warningAlerts = alerts.filter(a => a.severity === 'warning');
  const infoAlerts = alerts.filter(a => a.severity === 'info');

  const getSeverityIcon = (severity: 'critical' | 'warning' | 'info') => {
    switch (severity) {
      case 'critical':
        return <AlertCircle className="text-red-600" size={20} />;
      case 'warning':
        return <AlertTriangle className="text-amber-600" size={20} />;
      case 'info':
        return <TrendingUp className="text-green-600" size={20} />;
    }
  };

  const getSeverityBg = (severity: 'critical' | 'warning' | 'info') => {
    switch (severity) {
      case 'critical':
        return 'bg-red-50 border-red-200';
      case 'warning':
        return 'bg-amber-50 border-amber-200';
      case 'info':
        return 'bg-green-50 border-green-200';
    }
  };

  const getSeverityTextColor = (severity: 'critical' | 'warning' | 'info') => {
    switch (severity) {
      case 'critical':
        return 'text-red-900';
      case 'warning':
        return 'text-amber-900';
      case 'info':
        return 'text-green-900';
    }
  };

  return (
    <div className="bg-white rounded-xl border-2 border-gray-200 p-6 shadow-sm">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-semibold text-gray-900">KPI Alerts</h3>
        <div className="flex items-center gap-4 text-sm">
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded-full bg-red-500"></div>
            <span className="text-gray-600">{criticalAlerts.length} Critical</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded-full bg-amber-500"></div>
            <span className="text-gray-600">{warningAlerts.length} Warning</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded-full bg-green-500"></div>
            <span className="text-gray-600">{infoAlerts.length} On Track</span>
          </div>
        </div>
      </div>

      <div className="space-y-6">
        {/* Critical Alerts */}
        {criticalAlerts.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <AlertCircle className="text-red-600" size={20} />
              <h4 className="font-bold text-red-900">CRITICAL ALERTS</h4>
            </div>
            <div className="space-y-2">
              {criticalAlerts.map(alert => (
                <div
                  key={alert.id}
                  className={`p-4 rounded-lg border-2 ${getSeverityBg(alert.severity)} transition-all hover:shadow-md`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        {getSeverityIcon(alert.severity)}
                        <span className={`font-semibold ${getSeverityTextColor(alert.severity)}`}>
                          {alert.title}
                        </span>
                      </div>
                      <p className={`text-sm ${getSeverityTextColor(alert.severity)} mb-2`}>
                        {alert.message}
                      </p>
                      {alert.action && (
                        <div className="flex items-center gap-2 text-xs text-gray-600 bg-white px-3 py-1.5 rounded-md border border-gray-200">
                          <span className="font-semibold">Action:</span>
                          <span>{alert.action}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Warning Alerts */}
        {warningAlerts.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="text-amber-600" size={20} />
              <h4 className="font-bold text-amber-900">WARNING ALERTS</h4>
            </div>
            <div className="space-y-2">
              {warningAlerts.map(alert => (
                <div
                  key={alert.id}
                  className={`p-4 rounded-lg border-2 ${getSeverityBg(alert.severity)} transition-all hover:shadow-md`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        {getSeverityIcon(alert.severity)}
                        <span className={`font-semibold ${getSeverityTextColor(alert.severity)}`}>
                          {alert.title}
                        </span>
                      </div>
                      <p className={`text-sm ${getSeverityTextColor(alert.severity)} mb-2`}>
                        {alert.message}
                      </p>
                      {alert.action && (
                        <div className="flex items-center gap-2 text-xs text-gray-600 bg-white px-3 py-1.5 rounded-md border border-gray-200">
                          <span className="font-semibold">Action:</span>
                          <span>{alert.action}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Info/Positive Alerts */}
        {infoAlerts.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp className="text-green-600" size={20} />
              <h4 className="font-bold text-green-900">ON TRACK</h4>
            </div>
            <div className="space-y-2">
              {infoAlerts.map(alert => (
                <div
                  key={alert.id}
                  className={`p-4 rounded-lg border-2 ${getSeverityBg(alert.severity)} transition-all hover:shadow-md`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        {getSeverityIcon(alert.severity)}
                        <span className={`font-semibold ${getSeverityTextColor(alert.severity)}`}>
                          {alert.title}
                        </span>
                      </div>
                      <p className={`text-sm ${getSeverityTextColor(alert.severity)}`}>
                        {alert.message}
                      </p>
                      {alert.action && (
                        <div className="flex items-center gap-2 text-xs text-gray-600 bg-white px-3 py-1.5 rounded-md border border-gray-200 mt-2">
                          <span className="font-semibold">Recommendation:</span>
                          <span>{alert.action}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Summary Footer */}
      <div className="mt-6 pt-4 border-t border-gray-200">
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-600">
            {alerts.length} total alerts • {criticalAlerts.length} need immediate action
          </span>
          <button className="text-blue-600 hover:text-blue-700 font-medium">
            View All →
          </button>
        </div>
      </div>
    </div>
  );
};

export default KPIAlerts;
