import type { LucideIcon } from 'lucide-react';
import {
  BarChart3,
  Building2,
  Gauge,
  Layers,
  LineChart,
  PieChart,
  TrendingUp,
  Wallet,
} from 'lucide-react';

export type ExcelModuleSlug =
  | 'variance'
  | 'budget-builder'
  | 'rolling-forecast'
  | 'cashflow'
  | 'kpi-dashboard'
  | 'board-pack'
  | 'scenarios'
  | 'management-accounts';

export type ExcelModuleConfig = {
  slug: ExcelModuleSlug;
  title: string;
  description: string;
  /** POST path relative to API base (no /api/v1) */
  endpoint: string;
  icon: LucideIcon;
  /** Extra multipart fields beyond the primary file */
  extraFields?: 'budget' | 'rollingMonth' | 'budgetAssumptions' | 'minCash' | 'mgmtFormat' | 'scenarioJson';
  /** Second file upload (board pack budget TB) */
  secondFile?: boolean;
};

const API = '/api/excel';

export const EXCEL_MODULES: ExcelModuleConfig[] = [
  {
    slug: 'variance',
    title: 'Excel Budget vs Actual',
    description: 'Upload Actual + Budget sheets — get Variance_Analysis, AI_Commentary, Executive_Summary.',
    endpoint: `${API}/variance-analysis`,
    icon: BarChart3,
  },
  {
    slug: 'budget-builder',
    title: 'Excel Budget Builder',
    description: 'Prior-year actuals → formula-based FY budget, assumptions sheet, and Prior vs Budget.',
    endpoint: `${API}/build-budget`,
    icon: LineChart,
    extraFields: 'budgetAssumptions',
  },
  {
    slug: 'rolling-forecast',
    title: 'Excel Rolling Forecast',
    description: 'Actuals YTD locked; AI-style forecast for remaining months with outlook sheet.',
    endpoint: `${API}/rolling-forecast`,
    icon: TrendingUp,
    extraFields: 'rollingMonth',
  },
  {
    slug: 'cashflow',
    title: 'Excel Cash Flow Forecaster',
    description: '13-week cash view, working capital metrics, and cash alerts (extend with your P&L/BS).',
    endpoint: `${API}/cashflow-forecast`,
    icon: Wallet,
    extraFields: 'minCash',
  },
  {
    slug: 'kpi-dashboard',
    title: 'Excel KPI Dashboard',
    description: 'CFO dashboard layout with RAG bands and KPI definitions from your monthly file.',
    endpoint: `${API}/kpi-dashboard`,
    icon: Gauge,
  },
  {
    slug: 'board-pack',
    title: 'Excel Board Pack',
    description: 'Eight-sheet board workbook: cover, summary, P&L, revenue, cost, BS, cash, risks.',
    endpoint: `${API}/board-pack`,
    icon: Building2,
    secondFile: true,
  },
  {
    slug: 'scenarios',
    title: 'Excel Scenario Planner',
    description: 'Base / Bull / Bear cases, comparison, sensitivity grid, and AI recommendation.',
    endpoint: `${API}/scenario-planner`,
    icon: Layers,
    extraFields: 'scenarioJson',
  },
  {
    slug: 'management-accounts',
    title: 'Excel Management Accounts',
    description: 'ICAI or CIMA-style management accounts, departmental P&L, bridge, AI notes.',
    endpoint: `${API}/management-accounts`,
    icon: PieChart,
    extraFields: 'mgmtFormat',
  },
];

export function getModuleBySlug(slug: string | undefined): ExcelModuleConfig | undefined {
  return EXCEL_MODULES.find((m) => m.slug === slug);
}
