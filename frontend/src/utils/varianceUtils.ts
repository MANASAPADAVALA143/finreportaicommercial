// ==================== FP&A VARIANCE ANALYSIS — UTILITY FUNCTIONS ====================

import type { VarianceRow, KPISummary, VarianceAlert } from '../types/fpa';

// ==================== CURRENCY FORMATTING ====================

export const formatCurrency = (amount: number, currency = "INR"): string => {
  const absAmount = Math.abs(amount);
  const isNegative = amount < 0;
  const prefix = isNegative ? '-' : '';
  
  let formatted = '';
  
  if (currency === "INR") {
    // Indian numbering system: Crore (Cr) and Lakh (L)
    if (absAmount >= 10000000) {
      formatted = `₹${(absAmount / 10000000).toFixed(1)}Cr`;
    } else if (absAmount >= 100000) {
      formatted = `₹${(absAmount / 100000).toFixed(1)}L`;
    } else {
      formatted = `₹${absAmount.toLocaleString('en-IN')}`;
    }
  } else {
    // Western numbering: Million (M) and Thousand (K)
    const symbols: Record<string, string> = {
      USD: '$',
      EUR: '€',
      GBP: '£'
    };
    const symbol = symbols[currency] || currency;
    
    if (absAmount >= 1000000) {
      formatted = `${symbol}${(absAmount / 1000000).toFixed(1)}M`;
    } else if (absAmount >= 1000) {
      formatted = `${symbol}${(absAmount / 1000).toFixed(1)}K`;
    } else {
      formatted = `${symbol}${absAmount.toLocaleString()}`;
    }
  }
  
  return prefix + formatted;
};

export const formatCurrencyFull = (amount: number, currency = "INR"): string => {
  const symbols: Record<string, string> = {
    INR: '₹',
    USD: '$',
    EUR: '€',
    GBP: '£'
  };
  
  const symbol = symbols[currency] || currency;
  const absAmount = Math.abs(amount);
  const formatted = currency === "INR" 
    ? absAmount.toLocaleString('en-IN', { maximumFractionDigits: 0 })
    : absAmount.toLocaleString('en-US', { maximumFractionDigits: 0 });
  
  return `${amount < 0 ? '-' : ''}${symbol}${formatted}`;
};

// ==================== PERCENTAGE FORMATTING ====================

export const formatPercentage = (value: number, decimals = 1): string => {
  const formatted = Math.abs(value).toFixed(decimals);
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  return `${sign}${formatted}%`;
};

// ==================== VARIANCE CLASSIFICATION ====================

export const getThreshold = (variancePct: number, isExpense = false): "critical" | "warning" | "ok" => {
  const abs = Math.abs(variancePct);
  if (abs > 10) return "critical";
  if (abs > 5) return "warning";
  return "ok";
};

export const isFavorable = (variance: number, isRevenue: boolean): boolean => {
  // Revenue: Positive variance = favorable (actual > budget)
  // Expense: Negative variance = favorable (actual < budget)
  if (isRevenue) {
    return variance > 0;
  } else {
    return variance < 0;
  }
};

// ==================== COLOR CODING ====================

export const getVarianceColor = (favorable: boolean, threshold: string): string => {
  if (threshold === "ok") return "text-gray-600";
  if (favorable) return "text-green-600";
  if (threshold === "critical") return "text-red-600";
  if (threshold === "warning") return "text-amber-600";
  return "text-gray-600";
};

export const getVarianceBgColor = (favorable: boolean, threshold: string): string => {
  if (threshold === "ok") return "bg-gray-50";
  if (favorable) return "bg-green-50";
  if (threshold === "critical") return "bg-red-50";
  if (threshold === "warning") return "bg-amber-50";
  return "bg-gray-50";
};

export const getVarianceBorderColor = (favorable: boolean, threshold: string): string => {
  if (threshold === "ok") return "border-gray-200";
  if (favorable) return "border-green-200";
  if (threshold === "critical") return "border-red-200";
  if (threshold === "warning") return "border-amber-200";
  return "border-gray-200";
};

export const getCardGradient = (favorable: boolean, threshold: string): string => {
  if (threshold === "ok") return "from-gray-50 to-gray-100";
  if (favorable) return "from-green-50 to-green-100";
  if (threshold === "critical") return "from-red-50 to-red-100";
  if (threshold === "warning") return "from-amber-50 to-amber-100";
  return "from-gray-50 to-gray-100";
};

// ==================== ICONS ====================

export const getVarianceIcon = (favorable: boolean, threshold: string): string => {
  if (favorable && threshold !== "ok") return "✅";
  if (threshold === "critical") return "🔴";
  if (threshold === "warning") return "⚠️";
  return "✅";
};

export const getVarianceArrow = (variance: number): string => {
  if (variance > 0) return "▲";
  if (variance < 0) return "▼";
  return "−";
};

// ==================== DATA CALCULATIONS ====================

export const calculateKPISummaries = (data: VarianceRow[]): KPISummary[] => {
  const revenue = data.find(r => r.id === "revenue");
  const expenses = data.find(r => r.id === "total-expenses");
  const netProfit = data.find(r => r.id === "net-profit");
  const ebitda = data.find(r => r.id === "ebitda");
  
  const summaries: KPISummary[] = [];
  
  if (revenue) {
    summaries.push({
      id: "revenue",
      label: "Total Revenue",
      actual: revenue.actual,
      budget: revenue.budget,
      variance: revenue.variance,
      variancePct: revenue.variancePct,
      favorable: revenue.favorable,
      threshold: revenue.threshold
    });
  }
  
  if (expenses) {
    summaries.push({
      id: "expenses",
      label: "Total Expenses",
      actual: expenses.actual,
      budget: expenses.budget,
      variance: expenses.variance,
      variancePct: expenses.variancePct,
      favorable: expenses.favorable,
      threshold: expenses.threshold
    });
  }
  
  if (netProfit) {
    summaries.push({
      id: "netProfit",
      label: "Net Profit",
      actual: netProfit.actual,
      budget: netProfit.budget,
      variance: netProfit.variance,
      variancePct: netProfit.variancePct,
      favorable: netProfit.favorable,
      threshold: netProfit.threshold
    });
  }
  
  if (ebitda) {
    summaries.push({
      id: "ebitda",
      label: "EBITDA",
      actual: ebitda.actual,
      budget: ebitda.budget,
      variance: ebitda.variance,
      variancePct: ebitda.variancePct,
      favorable: ebitda.favorable,
      threshold: ebitda.threshold
    });
  }
  
  return summaries;
};

export const extractVarianceAlerts = (data: VarianceRow[]): VarianceAlert[] => {
  const alerts: VarianceAlert[] = [];
  
  // Materiality thresholds (in currency units)
  const MATERIALITY_AMOUNT = 100000; // ₹1L minimum to be considered material
  
  data.forEach(row => {
    const absVariancePct = Math.abs(row.variancePct);
    const absVarianceAmount = Math.abs(row.variance);
    
    // Skip if variance is immaterial (both % and amount)
    if (absVariancePct < 5 && absVarianceAmount < MATERIALITY_AMOUNT) {
      return;
    }
    
    // Determine if this is a critical item (always include these)
    const criticalCategories = [
      'net profit', 'operating profit', 'ebitda', 'revenue', 'total revenue',
      'gross profit', 'profit before tax', 'operating expenses'
    ];
    const isCriticalCategory = criticalCategories.some(cat => 
      row.category.toLowerCase().includes(cat)
    );
    
    // Determine nature of line item for proper favorable/unfavorable logic
    const isRevenueType = row.category.toLowerCase().includes('revenue') || 
                          row.category.toLowerCase().includes('sales') ||
                          row.category.toLowerCase().includes('income') ||
                          row.category.toLowerCase().includes('profit');
    
    const isExpenseType = row.category.toLowerCase().includes('expense') ||
                          row.category.toLowerCase().includes('cost') ||
                          row.category.toLowerCase().includes('depreciation');
    
    // Calculate true favorable status
    let trueFavorable = row.favorable;
    
    if (isRevenueType) {
      // For revenue/profit: positive variance = favorable
      trueFavorable = row.variance > 0;
    } else if (isExpenseType) {
      // For expenses: negative variance = favorable (spending less)
      trueFavorable = row.variance < 0;
    }
    
    // Recalculate threshold based on absolute variance %
    let threshold: 'critical' | 'warning' | 'ok' = 'ok';
    
    if (absVariancePct > 10 || (isCriticalCategory && absVariancePct > 5)) {
      threshold = 'critical';
    } else if (absVariancePct > 5) {
      threshold = 'warning';
    }
    
    // Only include material variances or critical categories
    if (threshold === 'critical' || threshold === 'warning' || isCriticalCategory) {
      // Create detailed message
      let message = '';
      if (!trueFavorable && threshold === 'critical') {
        message = `${row.category}: 🔴 ${formatPercentage(row.variancePct)} ${isRevenueType ? 'below' : 'over'} budget (Critical)`;
      } else if (!trueFavorable && threshold === 'warning') {
        message = `${row.category}: ⚠️ ${formatPercentage(row.variancePct)} ${isRevenueType ? 'below' : 'over'} budget`;
      } else if (trueFavorable) {
        message = `${row.category}: ✅ ${formatPercentage(Math.abs(row.variancePct))} ${isRevenueType ? 'above' : 'under'} budget`;
      } else {
        message = `${row.category}: ${formatPercentage(row.variancePct)} variance`;
      }
      
      alerts.push({
        id: row.id,
        category: row.category,
        variance: row.variance,
        variancePct: row.variancePct,
        threshold: threshold,
        favorable: trueFavorable,
        message: message
      });
    }
  });
  
  // Sort by severity and impact
  alerts.sort((a, b) => {
    // First by favorable status (unfavorable first)
    if (a.favorable !== b.favorable) {
      return a.favorable ? 1 : -1;
    }
    
    // Then by severity
    const severityOrder = { critical: 0, warning: 1, ok: 2 };
    if (a.threshold !== b.threshold) {
      return severityOrder[a.threshold] - severityOrder[b.threshold];
    }
    
    // Finally by absolute variance %
    return Math.abs(b.variancePct) - Math.abs(a.variancePct);
  });
  
  return alerts;
};

// ==================== TABLE HELPERS ====================

export const toggleRowExpansion = (data: VarianceRow[], rowId: string): VarianceRow[] => {
  return data.map(row => {
    if (row.id === rowId) {
      return { ...row, isExpanded: !row.isExpanded };
    }
    return row;
  });
};

export const getVisibleRows = (data: VarianceRow[]): VarianceRow[] => {
  const visible: VarianceRow[] = [];
  
  data.forEach(row => {
    // Always show top-level rows
    if (!row.parentId) {
      visible.push(row);
      
      // If expanded, show children
      if (row.isExpanded && row.hasChildren) {
        const children = data.filter(r => r.parentId === row.id);
        visible.push(...children);
      }
    }
  });
  
  return visible;
};

// ==================== MONTH/PERIOD HELPERS ====================

export const getMonthName = (month: number): string => {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return months[month - 1] || "";
};

export const getQuarterName = (quarter: number): string => {
  return `Q${quarter}`;
};

export const getPeriodLabel = (periodType: string, month?: number, quarter?: number, year?: number): string => {
  if (periodType === "monthly" && month) {
    return `${getMonthName(month)} ${year || ''}`;
  }
  if (periodType === "quarterly" && quarter) {
    return `${getQuarterName(quarter)} ${year || ''}`;
  }
  if (periodType === "ytd") {
    return `YTD ${year || ''}`;
  }
  if (periodType === "annual") {
    return `FY ${year || ''}`;
  }
  return "";
};
