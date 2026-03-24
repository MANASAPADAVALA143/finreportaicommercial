// ==================== FP&A VARIANCE ANALYSIS — UTILITY FUNCTIONS ====================
// ==================== CURRENCY FORMATTING ====================
export const formatCurrency = (amount, currency = "INR") => {
    const absAmount = Math.abs(amount);
    const isNegative = amount < 0;
    const prefix = isNegative ? '-' : '';
    let formatted = '';
    if (currency === "INR") {
        // Indian numbering system: Crore (Cr) and Lakh (L)
        if (absAmount >= 10000000) {
            formatted = `₹${(absAmount / 10000000).toFixed(1)}Cr`;
        }
        else if (absAmount >= 100000) {
            formatted = `₹${(absAmount / 100000).toFixed(1)}L`;
        }
        else {
            formatted = `₹${absAmount.toLocaleString('en-IN')}`;
        }
    }
    else {
        // Western numbering: Million (M) and Thousand (K)
        const symbols = {
            USD: '$',
            EUR: '€',
            GBP: '£'
        };
        const symbol = symbols[currency] || currency;
        if (absAmount >= 1000000) {
            formatted = `${symbol}${(absAmount / 1000000).toFixed(1)}M`;
        }
        else if (absAmount >= 1000) {
            formatted = `${symbol}${(absAmount / 1000).toFixed(1)}K`;
        }
        else {
            formatted = `${symbol}${absAmount.toLocaleString()}`;
        }
    }
    return prefix + formatted;
};
export const formatCurrencyFull = (amount, currency = "INR") => {
    const symbols = {
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
export const formatPercentage = (value, decimals = 1) => {
    const formatted = Math.abs(value).toFixed(decimals);
    const sign = value > 0 ? '+' : value < 0 ? '-' : '';
    return `${sign}${formatted}%`;
};
// ==================== VARIANCE CLASSIFICATION ====================
export const getThreshold = (variancePct, isExpense = false) => {
    const abs = Math.abs(variancePct);
    if (abs > 10)
        return "critical";
    if (abs > 5)
        return "warning";
    return "ok";
};
export const isFavorable = (variance, isRevenue) => {
    // Revenue: Positive variance = favorable (actual > budget)
    // Expense: Negative variance = favorable (actual < budget)
    if (isRevenue) {
        return variance > 0;
    }
    else {
        return variance < 0;
    }
};
// ==================== COLOR CODING ====================
export const getVarianceColor = (favorable, threshold) => {
    if (threshold === "ok")
        return "text-gray-600";
    if (favorable)
        return "text-green-600";
    if (threshold === "critical")
        return "text-red-600";
    if (threshold === "warning")
        return "text-amber-600";
    return "text-gray-600";
};
export const getVarianceBgColor = (favorable, threshold) => {
    if (threshold === "ok")
        return "bg-gray-50";
    if (favorable)
        return "bg-green-50";
    if (threshold === "critical")
        return "bg-red-50";
    if (threshold === "warning")
        return "bg-amber-50";
    return "bg-gray-50";
};
export const getVarianceBorderColor = (favorable, threshold) => {
    if (threshold === "ok")
        return "border-gray-200";
    if (favorable)
        return "border-green-200";
    if (threshold === "critical")
        return "border-red-200";
    if (threshold === "warning")
        return "border-amber-200";
    return "border-gray-200";
};
export const getCardGradient = (favorable, threshold) => {
    if (threshold === "ok")
        return "from-gray-50 to-gray-100";
    if (favorable)
        return "from-green-50 to-green-100";
    if (threshold === "critical")
        return "from-red-50 to-red-100";
    if (threshold === "warning")
        return "from-amber-50 to-amber-100";
    return "from-gray-50 to-gray-100";
};
// ==================== ICONS ====================
export const getVarianceIcon = (favorable, threshold) => {
    if (favorable && threshold !== "ok")
        return "✅";
    if (threshold === "critical")
        return "🔴";
    if (threshold === "warning")
        return "⚠️";
    return "✅";
};
export const getVarianceArrow = (variance) => {
    if (variance > 0)
        return "▲";
    if (variance < 0)
        return "▼";
    return "−";
};
// When variance is 0 or near 0, show "Neutral" not "Unfavorable"
export const getVarianceLabel = (pct) => {
    const val = typeof pct === 'number' ? pct : parseFloat(String(pct));
    if (Number.isNaN(val) || Math.abs(val) < 0.5)
        return "Neutral";
    if (val > 0)
        return "Favorable";
    return "Unfavorable";
};
// For revenue: positive variance = good (green). For expenses: positive variance = bad (red). Near zero = gray.
export const getVarianceColorForCard = (pct, type) => {
    const val = typeof pct === 'number' ? pct : parseFloat(String(pct));
    if (Number.isNaN(val) || Math.abs(val) < 0.5)
        return "gray";
    if (type === 'expense')
        return val > 0 ? "red" : "green";
    return val > 0 ? "green" : "red";
};
// ==================== DATA CALCULATIONS ====================
// Classify row as revenue-type or expense-type from category (exclude headers)
// Use category or type; exclude header rows and cost-of-sales from revenue
const isRevenueRow = (r) => !r.isHeader && ((r.category?.toLowerCase().includes('revenue') || r.type?.toLowerCase() === 'revenue') &&
    !/cost of sales|cos|cogs|cost of goods/i.test(r.category || ''));
const isExpenseRow = (r) => !r.isHeader && (r.category?.toLowerCase().includes('expense') ||
    r.category?.toLowerCase().includes('cost') ||
    r.type?.toLowerCase() === 'expense' ||
    /cogs|operating|employee|admin|payroll|marketing|rent|depreciation|distribution/i.test(r.category || ''));
// Compute totals from actual data rows so dashboard cards show values from data
const computeTotalsFromRows = (data) => {
    const revenueRows = data.filter(isRevenueRow);
    const expenseRows = data.filter(isExpenseRow);
    const totalRevenueActual = revenueRows.reduce((sum, r) => sum + (parseFloat(String(r.actual)) || 0), 0);
    const totalRevenueBudget = revenueRows.reduce((sum, r) => sum + (parseFloat(String(r.budget)) || 0), 0);
    const totalExpensesActual = expenseRows.reduce((sum, r) => sum + (parseFloat(String(r.actual)) || 0), 0);
    const totalExpensesBudget = expenseRows.reduce((sum, r) => sum + (parseFloat(String(r.budget)) || 0), 0);
    const netProfitActual = totalRevenueActual - totalExpensesActual;
    const netProfitBudget = totalRevenueBudget - totalExpensesBudget;
    const revenueVariance = totalRevenueActual - totalRevenueBudget;
    const revenueVariancePct = totalRevenueBudget !== 0 ? (revenueVariance / totalRevenueBudget) * 100 : 0;
    const expensesVariance = totalExpensesActual - totalExpensesBudget;
    const expensesVariancePct = totalExpensesBudget !== 0 ? (expensesVariance / totalExpensesBudget) * 100 : 0;
    const netProfitVariance = netProfitActual - netProfitBudget;
    const netProfitVariancePct = netProfitBudget !== 0 ? (netProfitVariance / Math.abs(netProfitBudget)) * 100 : 0;
    return {
        totalRevenueActual,
        totalRevenueBudget,
        totalExpensesActual,
        totalExpensesBudget,
        netProfitActual,
        netProfitBudget,
        revenueVariance,
        revenueVariancePct,
        expensesVariance,
        expensesVariancePct,
        netProfitVariance,
        netProfitVariancePct,
    };
};
// Match row by id or by category (for uploaded data which has uploaded-0, uploaded-1, etc.)
const findRow = (data, id, categoryPatterns) => {
    const byId = data.find(r => r.id === id);
    if (byId)
        return byId;
    const cat = data.find(r => categoryPatterns.some(p => r.category.toLowerCase().includes(p)));
    return cat;
};
export const calculateKPISummaries = (data) => {
    const totals = computeTotalsFromRows(data);
    const hasAnyData = totals.totalRevenueActual !== 0 || totals.totalRevenueBudget !== 0 || totals.totalExpensesActual !== 0 || totals.totalExpensesBudget !== 0;
    const summaries = [];
    // BUG 1 FIX: Always show Total Revenue, Total Expenses, Net Profit from computed row totals when we have data
    if (data.length > 0 && (hasAnyData || totals.netProfitActual !== 0 || totals.netProfitBudget !== 0)) {
        summaries.push({
            id: "revenue",
            label: "Total Revenue",
            actual: totals.totalRevenueActual,
            budget: totals.totalRevenueBudget,
            variance: totals.revenueVariance,
            variancePct: totals.revenueVariancePct,
            favorable: totals.revenueVariance > 0,
            threshold: getThreshold(totals.revenueVariancePct, false)
        });
        summaries.push({
            id: "expenses",
            label: "Total Expenses",
            actual: totals.totalExpensesActual,
            budget: totals.totalExpensesBudget,
            variance: totals.expensesVariance,
            variancePct: totals.expensesVariancePct,
            favorable: totals.expensesVariance < 0,
            threshold: getThreshold(totals.expensesVariancePct, true)
        });
        summaries.push({
            id: "netProfit",
            label: "Net Profit",
            actual: totals.netProfitActual,
            budget: totals.netProfitBudget,
            variance: totals.netProfitVariance,
            variancePct: totals.netProfitVariancePct,
            favorable: totals.netProfitVariance > 0,
            threshold: getThreshold(totals.netProfitVariancePct, false)
        });
    }
    else {
        // Fallback: use single-row match if no computed totals (e.g. only one row)
        const revenue = findRow(data, "revenue", ["total revenue", "revenue"]);
        const expenses = findRow(data, "total-expenses", ["operating expenses", "total expenses", "expenses"]);
        const netProfit = findRow(data, "net-profit", ["net profit", "profit after tax"]);
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
    }
    const ebitda = findRow(data, "ebitda", ["ebitda"]);
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
// Alert if variance > 5% AND amount > 5L; severity CRITICAL if |variancePct| > 10 else WARNING
export const extractVarianceAlerts = (data) => {
    const ALERT_MIN_PCT = 5;
    const ALERT_MIN_AMOUNT = 500000; // 5L
    const rows = data.filter(row => {
        const varPct = Math.abs(parseFloat(String(row.variancePct)) || 0);
        const varAmt = Math.abs(parseFloat(String(row.variance)) || 0);
        return varPct > ALERT_MIN_PCT && varAmt > ALERT_MIN_AMOUNT && !row.isHeader;
    });
    const isRevenueType = (r) => /revenue|sales|income|profit/i.test(r.category || '') && !/cost of sales|cos|cogs/i.test(r.category || '');
    const isExpenseType = (r) => /expense|cost|depreciation|cogs|operating|admin|payroll|marketing|rent/i.test(r.category || '');
    const alerts = rows.map(row => {
        const variancePct = parseFloat(String(row.variancePct)) || 0;
        const variance = parseFloat(String(row.variance)) || 0;
        const absPct = Math.abs(variancePct);
        const threshold = absPct > 10 ? 'critical' : 'warning';
        let favorable = row.favorable;
        if (isRevenueType(row))
            favorable = variance > 0;
        else if (isExpenseType(row))
            favorable = variance < 0;
        let message = '';
        if (!favorable && threshold === 'critical') {
            message = `${row.category}: 🔴 ${formatPercentage(variancePct)} ${isRevenueType(row) ? 'below' : 'over'} budget (Critical)`;
        }
        else if (!favorable && threshold === 'warning') {
            message = `${row.category}: ⚠️ ${formatPercentage(variancePct)} ${isRevenueType(row) ? 'below' : 'over'} budget`;
        }
        else if (favorable) {
            message = `${row.category}: ✅ ${formatPercentage(Math.abs(variancePct))} ${isRevenueType(row) ? 'above' : 'under'} budget`;
        }
        else {
            message = `${row.category}: ${formatPercentage(variancePct)} variance`;
        }
        return {
            id: row.id,
            category: row.category,
            variance: row.variance,
            variancePct: row.variancePct,
            threshold,
            favorable,
            message
        };
    });
    // Sort by absolute variance % descending (highest impact first)
    alerts.sort((a, b) => Math.abs(parseFloat(String(b.variancePct))) - Math.abs(parseFloat(String(a.variancePct))));
    return alerts;
};
// ==================== TABLE HELPERS ====================
export const toggleRowExpansion = (data, rowId) => {
    return data.map(row => {
        if (row.id === rowId) {
            return { ...row, isExpanded: !row.isExpanded };
        }
        return row;
    });
};
export const getVisibleRows = (data) => {
    const visible = [];
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
export const getMonthName = (month) => {
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return months[month - 1] || "";
};
export const getQuarterName = (quarter) => {
    return `Q${quarter}`;
};
export const getPeriodLabel = (periodType, month, quarter, year) => {
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
