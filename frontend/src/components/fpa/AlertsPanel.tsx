// FP&A Variance Analysis - Variance Alerts Panel Component
import { AlertTriangle, CheckCircle, AlertCircle } from 'lucide-react';
import type { VarianceAlert, CurrencyFormatLocale } from '../../types/fpa';
import { formatCurrency, formatPercentage } from '../../utils/varianceUtils';

interface Props {
  alerts: VarianceAlert[];
  currency?: string;
  currencyFormat?: CurrencyFormatLocale;
  onAlertClick?: (alert: VarianceAlert) => void;
}

export const AlertsPanel = ({ alerts, currency = "INR", currencyFormat, onAlertClick }: Props) => {
  // Group alerts by threshold
  const criticalAlerts = alerts.filter(a => a.threshold === "critical");
  const warningAlerts = alerts.filter(a => a.threshold === "warning");
  const onTargetAlerts = alerts.filter(a => a.threshold === "ok" && a.favorable);

  const AlertItem = ({ alert }: { alert: VarianceAlert }) => {
    const getIcon = () => {
      if (alert.threshold === "critical") return <AlertCircle className="w-5 h-5 text-red-600" />;
      if (alert.threshold === "warning") return <AlertTriangle className="w-5 h-5 text-amber-600" />;
      return <CheckCircle className="w-5 h-5 text-green-600" />;
    };

    const getBgColor = () => {
      if (alert.threshold === "critical" && !alert.favorable) return "bg-red-50 border-red-200 hover:bg-red-100";
      if (alert.threshold === "warning" && !alert.favorable) return "bg-amber-50 border-amber-200 hover:bg-amber-100";
      if (alert.favorable) return "bg-green-50 border-green-200 hover:bg-green-100";
      return "bg-gray-50 border-gray-200 hover:bg-gray-100";
    };

    const getTextColor = () => {
      if (alert.threshold === "critical" && !alert.favorable) return "text-red-700";
      if (alert.threshold === "warning" && !alert.favorable) return "text-amber-700";
      if (alert.favorable) return "text-green-700";
      return "text-gray-700";
    };

    return (
      <div
        className={`p-3 rounded-lg border ${getBgColor()} cursor-pointer transition group`}
        onClick={() => onAlertClick?.(alert)}
      >
        <div className="flex items-start gap-3">
          <div className="mt-0.5">{getIcon()}</div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2 mb-1">
              <span className={`font-semibold text-sm ${getTextColor()} truncate`}>
                {alert.category}
              </span>
              <span className={`font-bold text-sm ${getTextColor()} whitespace-nowrap`}>
                {formatPercentage(alert.variancePct)}
              </span>
            </div>
            <p className="text-xs text-gray-600 mb-1">
              {formatCurrency(Math.abs(alert.variance), currency, currencyFormat)} {alert.favorable ? 'under' : 'over'} budget
            </p>
            {alert.message && (
              <p className="text-xs text-gray-500 italic">
                {alert.message}
              </p>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 h-full overflow-y-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="p-2 bg-amber-100 rounded-lg">
          <AlertTriangle className="w-6 h-6 text-amber-600" />
        </div>
        <div>
          <h3 className="text-lg font-bold text-gray-900">Variance Alerts</h3>
          <p className="text-sm text-gray-600">{alerts.length} items requiring attention</p>
        </div>
      </div>

      {/* Critical Alerts */}
      {criticalAlerts.length > 0 && (
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <AlertCircle className="w-5 h-5 text-red-600" />
            <h4 className="font-bold text-red-700 uppercase text-sm">
              Critical ({criticalAlerts.filter(a => !a.favorable).length})
            </h4>
          </div>
          <div className="space-y-2">
            {criticalAlerts.filter(a => !a.favorable).map(alert => (
              <AlertItem key={alert.id} alert={alert} />
            ))}
          </div>
          {criticalAlerts.filter(a => !a.favorable).length === 0 && (
            <p className="text-sm text-gray-500 italic">No critical unfavorable variances</p>
          )}
        </div>
      )}

      {/* Warning Alerts */}
      {warningAlerts.length > 0 && (
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-5 h-5 text-amber-600" />
            <h4 className="font-bold text-amber-700 uppercase text-sm">
              Warning ({warningAlerts.filter(a => !a.favorable).length})
            </h4>
          </div>
          <div className="space-y-2">
            {warningAlerts.filter(a => !a.favorable).map(alert => (
              <AlertItem key={alert.id} alert={alert} />
            ))}
          </div>
          {warningAlerts.filter(a => !a.favorable).length === 0 && (
            <p className="text-sm text-gray-500 italic">No warning variances</p>
          )}
        </div>
      )}

      {/* Favorable Variances (On Target/Positive) */}
      {(criticalAlerts.filter(a => a.favorable).length > 0 || 
        warningAlerts.filter(a => a.favorable).length > 0 ||
        onTargetAlerts.length > 0) && (
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle className="w-5 h-5 text-green-600" />
            <h4 className="font-bold text-green-700 uppercase text-sm">
              On Target / Favorable
            </h4>
          </div>
          <div className="space-y-2">
            {criticalAlerts.filter(a => a.favorable).map(alert => (
              <AlertItem key={alert.id} alert={alert} />
            ))}
            {warningAlerts.filter(a => a.favorable).map(alert => (
              <AlertItem key={alert.id} alert={alert} />
            ))}
            {onTargetAlerts.slice(0, 3).map(alert => (
              <AlertItem key={alert.id} alert={alert} />
            ))}
          </div>
        </div>
      )}

      {/* Summary Stats */}
      <div className="pt-6 border-t border-gray-200">
        <div className="grid grid-cols-3 gap-4 text-center">
          <div>
            <div className="text-2xl font-bold text-red-600">
              {criticalAlerts.filter(a => !a.favorable).length}
            </div>
            <div className="text-xs text-gray-600 mt-1">Critical</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-amber-600">
              {warningAlerts.filter(a => !a.favorable).length}
            </div>
            <div className="text-xs text-gray-600 mt-1">Warning</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-green-600">
              {criticalAlerts.filter(a => a.favorable).length + 
               warningAlerts.filter(a => a.favorable).length + 
               onTargetAlerts.length}
            </div>
            <div className="text-xs text-gray-600 mt-1">Favorable</div>
          </div>
        </div>
      </div>
    </div>
  );
};
