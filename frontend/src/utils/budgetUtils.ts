import type { MonthlyBudget } from '../types/budget';

export const BUDGET_MONTH_KEYS = [
  'jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec',
] as const;

export type BudgetSection = 'REVENUE' | 'COGS' | 'EXPENSE' | 'OTHER';

/** Forward-fill budget months when upload only has Jan–Mar (or partial quarters). */
export function forwardFillMonthlyBudget(monthly: Partial<MonthlyBudget>): MonthlyBudget {
  const filled: MonthlyBudget = {
    jan: 0, feb: 0, mar: 0, apr: 0, may: 0, jun: 0,
    jul: 0, aug: 0, sep: 0, oct: 0, nov: 0, dec: 0,
  };
  let lastKnownBudget = 0;

  BUDGET_MONTH_KEYS.forEach((month) => {
    const v = Number(monthly[month] || 0);
    if (v > 0) {
      lastKnownBudget = v;
      filled[month] = v;
    } else if (lastKnownBudget > 0) {
      filled[month] = lastKnownBudget;
    }
  });

  return filled;
}

export function inferBudgetDepartment(
  account: string,
  category?: string,
  existing?: string,
): string {
  if (existing && String(existing).trim() && !/^all\s*depts?$/i.test(String(existing))) {
    return String(existing).trim();
  }
  const text = `${account} ${category || ''}`.toLowerCase();
  if (/customer\s*(success|support)|support\s*staff/.test(text)) return 'Customer Success';
  if (/engineering|r&d|research|cloud|infra|technology/.test(text)) return 'Engineering';
  if (/marketing|advertis/.test(text)) return 'Marketing';
  if (/sales|revenue|subscri|implement|professional/.test(text) && !/marketing|cost/.test(text)) {
    return 'Sales';
  }
  if (/g&a|general\s*admin|admin|finance|legal|audit/.test(text)) return 'G&A';
  if (/hr|payroll|people|benefit/.test(text)) return 'HR';
  if (/operations|manufactur|logistics/.test(text)) return 'Operations';
  return 'General';
}

export function getBudgetSection(
  accountType?: string,
  accountName?: string,
): BudgetSection {
  const at = String(accountType || '').toLowerCase();
  const name = String(accountName || '').toLowerCase();

  if (at === 'income' || /^(total\s+)?(revenue|income|turnover)/.test(name)) {
    if (!/cost|expense|marketing|salary|cloud|admin/.test(name)) return 'REVENUE';
  }
  if (
    /cogs|cost of goods|cost of sales|cost of revenue|cloud infra|direct (cost|labor)/.test(name) ||
    (at === 'expense' && /cogs|cost of/.test(name))
  ) {
    return 'COGS';
  }
  if (at === 'expense' || /expense|salary|marketing|admin|overhead|payroll|rent|depreciation/.test(name)) {
    return 'EXPENSE';
  }
  if (at === 'income') return 'REVENUE';
  return 'OTHER';
}

export function sumMonthlyValues(monthly?: Partial<MonthlyBudget>): number {
  if (!monthly) return 0;
  return BUDGET_MONTH_KEYS.reduce((s, k) => s + (Number(monthly[k]) || 0), 0);
}

export function isYoYComparable(current: number, prior: number | null | undefined): boolean {
  if (!prior || prior <= 0 || current <= 0) return false;
  const ratio = prior / current;
  return ratio >= 0.05 && ratio <= 5;
}

export function getBudgetRowStatus(row: {
  monthly: MonthlyBudget;
  monthlyActuals?: Partial<MonthlyBudget>;
  accountType?: string;
  lineItem?: string;
  category?: string;
}): { label: string; color: string; bg: string } {
  const totalBudget = sumMonthlyValues(row.monthly);
  const totalActual = sumMonthlyValues(row.monthlyActuals);

  if (totalActual === 0 || totalBudget === 0) {
    return { label: 'Budget Only', color: 'text-slate-400', bg: '' };
  }

  const variancePct = (totalActual - totalBudget) / totalBudget;
  const isRevenue =
    row.accountType === 'income' ||
    getBudgetSection(row.accountType, row.lineItem || row.category) === 'REVENUE';

  if (isRevenue) {
    if (variancePct > 0.05) return { label: 'Above Target', color: 'text-emerald-400', bg: 'bg-emerald-950/30' };
    if (variancePct >= 0) return { label: 'On Track', color: 'text-blue-400', bg: '' };
    return { label: 'Below Target', color: 'text-red-400', bg: 'bg-red-950/30' };
  }

  if (variancePct < -0.05) return { label: 'Under Budget', color: 'text-emerald-400', bg: 'bg-emerald-950/30' };
  if (variancePct <= 0.05) return { label: 'On Track', color: 'text-blue-400', bg: '' };
  if (variancePct <= 0.1) return { label: 'Watch', color: 'text-amber-400', bg: 'bg-amber-950/20' };
  return { label: 'Over Budget', color: 'text-red-400', bg: 'bg-red-950/30' };
}

export function getMonthCellStyle(
  actual: number,
  budget: number,
  accountType?: string,
  accountName?: string,
): string {
  if (!budget) return 'text-slate-300';
  if (!actual) return 'text-slate-200';
  const variance = (actual - budget) / budget;
  const isRevenue =
    accountType === 'income' ||
    getBudgetSection(accountType, accountName) === 'REVENUE';
  const isFavorable = isRevenue ? variance > 0 : variance < 0;
  const magnitude = Math.abs(variance);

  if (isFavorable && magnitude > 0.05) return 'text-emerald-400 font-medium';
  if (!isFavorable && magnitude > 0.1) return 'text-red-400 font-medium';
  if (!isFavorable && magnitude > 0.05) return 'text-amber-400';
  return 'text-slate-200';
}

export const BUDGET_SECTION_CONFIG: Record<
  BudgetSection,
  { label: string; bg: string; text: string; border: string }
> = {
  REVENUE: {
    label: 'REVENUE',
    bg: 'bg-blue-900/40',
    text: 'text-blue-300',
    border: 'border-blue-800',
  },
  COGS: {
    label: 'COST OF GOODS SOLD',
    bg: 'bg-orange-900/30',
    text: 'text-orange-300',
    border: 'border-orange-800',
  },
  EXPENSE: {
    label: 'OPERATING EXPENSES',
    bg: 'bg-amber-900/30',
    text: 'text-amber-300',
    border: 'border-amber-800',
  },
  OTHER: {
    label: 'OTHER',
    bg: 'bg-slate-800/50',
    text: 'text-slate-300',
    border: 'border-slate-700',
  },
};
