// FP&A Variance Analysis - Summary KPI Cards Component
import { motion } from 'framer-motion';
import { TrendingUp, DollarSign, Target } from 'lucide-react';
import type { KPISummary, CurrencyFormatLocale } from '../../types/fpa';
import { formatCurrency, getVarianceArrow, formatPercentage, getVarianceLabel, getVarianceColorForCard } from '../../utils/varianceUtils';
import { useState, useEffect } from 'react';

interface Props {
  summaries: KPISummary[];
  currency?: string;
  currencyFormat?: CurrencyFormatLocale;
}

export const VarianceSummaryCards = ({ summaries, currency = "INR", currencyFormat }: Props) => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
      {summaries.map((summary, index) => (
        <KPICard key={summary.id} summary={summary} currency={currency} currencyFormat={currencyFormat} index={index} />
      ))}
    </div>
  );
};

interface KPICardProps {
  summary: KPISummary;
  currency: string;
  currencyFormat?: CurrencyFormatLocale;
  index: number;
}

const KPICard = ({ summary, currency, currencyFormat, index }: KPICardProps) => {
  const [count, setCount] = useState(0);
  const isFavorable = summary.favorable;
  const threshold = summary.threshold;
  const varianceLabel = getVarianceLabel(summary.variancePct);
  const cardType = summary.id === 'revenue' ? 'revenue' : summary.id === 'expenses' ? 'expense' : 'netProfit';
  const varianceColor = getVarianceColorForCard(summary.variancePct, cardType);

  // Animated count-up effect
  useEffect(() => {
    let start = 0;
    const end = summary.actual;
    const duration = 1000; // 1 second
    const increment = end / (duration / 16); // 60fps

    const timer = setInterval(() => {
      start += increment;
      if (start >= end) {
        setCount(end);
        clearInterval(timer);
      } else {
        setCount(Math.floor(start));
      }
    }, 16);

    return () => clearInterval(timer);
  }, [summary.actual]);

  const getIcon = () => {
    if (summary.id === 'revenue') return <DollarSign className="w-6 h-6" />;
    if (summary.id === 'expenses') return <TrendingUp className="w-6 h-6" />;
    if (summary.id === 'netProfit') return <Target className="w-6 h-6" />;
    return <TrendingUp className="w-6 h-6" />;
  };

  const getBgGradient = () => {
    if (threshold === "ok") return "from-gray-50 to-gray-100 border-gray-200";
    if (isFavorable) return "from-green-50 to-green-100 border-green-200";
    if (threshold === "critical") return "from-red-50 to-red-100 border-red-200";
    if (threshold === "warning") return "from-amber-50 to-amber-100 border-amber-200";
    return "from-gray-50 to-gray-100 border-gray-200";
  };

  const getTextColor = () => {
    if (threshold === "ok") return "text-gray-700";
    if (isFavorable) return "text-green-700";
    if (threshold === "critical") return "text-red-700";
    if (threshold === "warning") return "text-amber-700";
    return "text-gray-700";
  };

  const getIconBg = () => {
    if (threshold === "ok") return "bg-gray-200 text-gray-600";
    if (isFavorable) return "bg-green-200 text-green-700";
    if (threshold === "critical") return "bg-red-200 text-red-700";
    if (threshold === "warning") return "bg-amber-200 text-amber-700";
    return "bg-gray-200 text-gray-600";
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: index * 0.1 }}
      className={`relative overflow-hidden rounded-xl border-2 bg-gradient-to-br ${getBgGradient()} p-6 shadow-sm hover:shadow-md transition-shadow`}
    >
      {/* Icon */}
      <div className={`inline-flex p-3 rounded-lg ${getIconBg()} mb-4`}>
        {getIcon()}
      </div>

      {/* Label */}
      <h3 className="text-sm font-medium text-gray-600 mb-1">{summary.label}</h3>

      {/* Actual Amount */}
      <div className={`text-3xl font-bold ${getTextColor()} mb-2`}>
        {formatCurrency(count, currency, currencyFormat)}
      </div>

      {/* Budget Amount */}
      <div className="text-sm text-gray-500 mb-3">
        Budget: {formatCurrency(summary.budget, currency, currencyFormat)}
      </div>

      {/* Variance */}
      <div className="flex items-center justify-between pt-3 border-t border-gray-200">
        <div className="flex items-center gap-2">
          <span className={`text-lg font-semibold ${
            varianceColor === 'gray' ? 'text-gray-600' :
            varianceColor === 'green' ? 'text-green-700' : 'text-red-700'
          }`}>
            {getVarianceArrow(summary.variance)} {formatPercentage(summary.variancePct)}
          </span>
        </div>
        <div className={`px-3 py-1 rounded-full text-xs font-semibold ${
          varianceLabel === 'Neutral' ? 'bg-gray-200 text-gray-800' :
          varianceLabel === 'Favorable' ? 'bg-green-200 text-green-800' : 'bg-red-200 text-red-800'
        }`}>
          {varianceLabel === 'Neutral' ? '➖ Neutral' : varianceLabel === 'Favorable' ? '✅ Favorable' : '🔴 Unfavorable'}
        </div>
      </div>

      {/* Threshold indicator (critical/warning) */}
      {threshold === "critical" && (
        <div className="absolute top-2 right-2">
          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-bold bg-red-600 text-white">
            🔴 Critical
          </span>
        </div>
      )}
      {threshold === "warning" && !isFavorable && (
        <div className="absolute top-2 right-2">
          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-bold bg-amber-600 text-white">
            ⚠️ Warning
          </span>
        </div>
      )}
    </motion.div>
  );
};
