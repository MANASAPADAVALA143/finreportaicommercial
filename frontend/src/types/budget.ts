export type DepartmentType = 'Sales' | 'HR' | 'IT' | 'Marketing' | 'Operations' | 'Finance';

export type BudgetStatus = 'Draft' | 'Under Review' | 'Approved' | 'Locked';

export type BudgetApproach = 'Top-Down' | 'Bottom-Up';

export interface MonthlyBudget {
  jan: number;
  feb: number;
  mar: number;
  apr: number;
  may: number;
  jun: number;
  jul: number;
  aug: number;
  sep: number;
  oct: number;
  nov: number;
  dec: number;
}

export interface BudgetLineItem {
  id: string;
  category: string;
  isHeader: boolean;
  isEditable: boolean;
  monthly: MonthlyBudget;
  priorYearActual?: number;
  department?: DepartmentType;
  indent?: number;
}

export interface BudgetVersion {
  id: string;
  name: string;
  createdDate: string;
  createdBy: string;
  status: BudgetStatus;
  isCurrent: boolean;
}

export interface DepartmentBudget {
  department: DepartmentType;
  totalBudget: number;
  priorYearActual: number;
  variance: number;
  variancePct: number;
  status: BudgetStatus;
}

export interface BudgetSummary {
  totalRevenue: number;
  totalExpenses: number;
  netProfit: number;
  ebitda: number;
  priorYearRevenue: number;
  priorYearExpenses: number;
  priorYearNetProfit: number;
  priorYearEbitda: number;
}
