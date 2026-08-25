// FP&A Suite — Variance Analysis Module
// URL: /dashboard/fpa/variance-analysis
// Budget vs Actual — AI-powered variance intelligence (Level 1–3)

import { useState, useMemo, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Upload,
  Download,
  Bot,
  BarChart3,
  Table2,
  PieChart,
  Sparkles,
  X,
  FileSpreadsheet,
  Loader2,
  Copy,
  Mail,
  ChevronDown,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  Cell,
  ResponsiveContainer,
  PieChart as RechartsPie,
  Pie,
} from 'recharts';
import {
  formatCurrency,
  formatCurrencyFull,
  getCurrencyDisplaySymbol,
  LS_FPA_CURRENCY_KEY,
  LS_APP_CURRENCY_FALLBACK_KEY,
  LS_CURRENCY_FORMAT_KEY,
} from '../../utils/varianceUtils';
import type { CurrencyType, CurrencyFormatLocale } from '../../types/fpa';
import { callAI } from '../../services/aiProvider';
import { postCfoAgentRun } from '../../services/cfoAgents';
import { getActiveCompanyId } from '../../context/CompanyContext';
import { loadFPAActual, loadFPABudget, convertToVarianceData, syncFpaMasterFromApi, FPA_MASTER_UPDATED_EVENT } from '../../utils/fpaDataLoader';

const API_BASE = (import.meta.env.VITE_API_URL && String(import.meta.env.VITE_API_URL).trim()) || '';

// Design system
const colors = {
  bg: '#0F172A',
  card: '#1E293B',
  border: '#334155',
  text: '#F8FAFC',
  muted: '#94A3B8',
  favorable: '#22C55E',
  unfavorable: '#EF4444',
  neutral: '#64748B',
  watch: '#F59E0B',
  budgetBar: '#3B82F6',
  actualBar: '#F97316',
  totalBar: '#6366F1',
};

// Sample data (built-in for "Load Sample Data")
const SAMPLE_VARIANCE_DATA = [
  { account: 'Marketing', department: 'Marketing', budget: 2300000, actual: 2720000 },
  { account: 'IT Infrastructure', department: 'Technology', budget: 1800000, actual: 2016000 },
  { account: 'Travel & Expenses', department: 'All Depts', budget: 680000, actual: 530000 },
  { account: 'Salaries & Wages', department: 'All Depts', budget: 8500000, actual: 8500000 },
  { account: 'Office Rent', department: 'Admin', budget: 1200000, actual: 1200000 },
  { account: 'Training & Dev', department: 'HR', budget: 600000, actual: 510000 },
  { account: 'Legal & Compliance', department: 'Finance', budget: 450000, actual: 423000 },
  { account: 'Sales Commissions', department: 'Sales', budget: 1100000, actual: 1320000 },
  { account: 'Customer Support', department: 'Operations', budget: 920000, actual: 875000 },
  { account: 'R&D Expenses', department: 'Technology', budget: 2200000, actual: 2310000 },
  { account: 'Advertising', department: 'Marketing', budget: 850000, actual: 940000 },
  { account: 'Software Licenses', department: 'Technology', budget: 420000, actual: 398000 },
  { account: 'Recruitment', department: 'HR', budget: 380000, actual: 510000 },
  { account: 'Insurance', department: 'Finance', budget: 290000, actual: 290000 },
  { account: 'Utilities', department: 'Admin', budget: 180000, actual: 162000 },
  { account: 'Maintenance', department: 'Operations', budget: 240000, actual: 228000 },
  { account: 'Professional Fees', department: 'Finance', budget: 620000, actual: 698000 },
  { account: 'Depreciation', department: 'Finance', budget: 1100000, actual: 1100000 },
  { account: 'Interest Expense', department: 'Finance', budget: 340000, actual: 325000 },
  { account: 'Printing & Stationery', department: 'Admin', budget: 45000, actual: 38000 },
  { account: 'Telephone & Internet', department: 'Admin', budget: 120000, actual: 114000 },
  { account: 'Bank Charges', department: 'Finance', budget: 28000, actual: 31000 },
  { account: 'Event & Conferences', department: 'Marketing', budget: 350000, actual: 420000 },
  { account: 'Security Services', department: 'Admin', budget: 160000, actual: 155000 },
];

export type VarianceLineItem = {
  account: string;
  department: string;
  budget: number;
  actual: number;
  accountType?: 'income' | 'expense' | 'other';
  variance?: number;
  variance_pct?: number;
  status?: string;
  favorable?: boolean;
  material?: boolean;
  ytdActual?: number;
  ytdBudget?: number;
  priorYear?: number;
};

function stripEmbeddedActionItems(summary: string): string {
  if (!summary) return summary;
  let text = summary;
  for (const marker of ['---ACTION_ITEMS---', '---LINE_COMMENTARY---', '\nACTION ITEMS:', '\n3) ACTION ITEMS', '\n3. ACTION ITEMS']) {
    const idx = text.indexOf(marker);
    if (idx >= 0) text = text.slice(0, idx);
  }
  const lines = text.trim().split('\n');
  while (lines.length > 0) {
    const last = lines[lines.length - 1].trim();
    if (/^\d+[\.)]\s*[🔴🟡🟢]/.test(last) || /^[🔴🟡🟢]\s*(URGENT|MONITOR|FAVORABLE|OPTIMISE)/i.test(last)) {
      lines.pop();
    } else {
      break;
    }
  }
  return lines.join('\n').trim();
}

function buildClientActionItems(
  analysis: NonNullable<ReturnType<typeof computeVarianceAnalysis>>,
  currency: CurrencyType,
  currencyFormat: CurrencyFormatLocale,
): string[] {
  type Sev = 'urgent' | 'monitor' | 'favorable' | 'ok';
  const getSeverity = (row: VarianceLineItem & { variance?: number; variance_pct?: number }): Sev => {
    const vp = row.budget ? (row.actual - row.budget) / Math.abs(row.budget) : 0;
    const isRevenue = row.accountType === 'income';
    if (isRevenue) {
      if (vp >= 0.05) return 'favorable';
      if (vp >= 0) return 'ok';
      if (vp < -0.05) return 'urgent';
      return 'monitor';
    }
    if (vp <= -0.05) return 'favorable';
    if (vp <= 0) return 'ok';
    if (vp > 0.1) return 'urgent';
    return 'monitor';
  };

  const items = analysis.line_items
    .map((row) => {
      const severity = getSeverity(row);
      if (severity === 'ok') return null;
      const pct = row.budget ? (((row.actual - row.budget) / Math.abs(row.budget)) * 100).toFixed(1) : '0.0';
      const amt = formatCurrency(Math.abs((row.variance ?? row.actual - row.budget)), currency, currencyFormat);
      const isRevenue = row.accountType === 'income';
      if (severity === 'urgent') {
        return isRevenue
          ? `🔴 URGENT: Revenue missed budget by ${amt} (${pct}%) — investigate pipeline gaps`
          : `🔴 URGENT: ${row.account} exceeded budget by ${amt} (${pct}%) — review and contain`;
      }
      if (severity === 'monitor') {
        return isRevenue
          ? `🟡 MONITOR: ${row.account} below budget by ${amt} (${pct}%) — validate drivers, update forecast`
          : `🟡 MONITOR: ${row.account} over budget by ${amt} (${pct}%) — monitor closely`;
      }
      return isRevenue
        ? `🟢 FAVORABLE: ${row.account} beat budget by ${amt} (+${Math.abs(Number(pct))}%) — roll into forecast`
        : `🟢 FAVORABLE: ${row.account} under budget by ${amt} (${pct}%) — sustain cost discipline`;
    })
    .filter(Boolean) as string[];

  return items.slice(0, 5).map((text, i) => `${i + 1}. ${text}`);
}

function inferAccountType(account: string, accountType?: string): 'income' | 'expense' | 'other' {
  const explicit = String(accountType || '').toLowerCase();
  if (explicit.includes('income') || explicit.includes('revenue')) return 'income';
  if (explicit.includes('expense') || explicit.includes('cost')) return 'expense';
  if (explicit.includes('asset') || explicit.includes('liability') || explicit.includes('equity')) return 'other';
  const name = String(account || '').toLowerCase();
  // Expense keywords checked FIRST — catches "Sales Commission", "Sales & Marketing" etc.
  if (/commission|rebate|discount|refund|cost|expense|cogs|payroll|rent|marketing|admin|depreciation|interest|salary|salaries|subscription|infrastructure|license|support|overhead|allowance|bonus|benefit|insurance|maintenance|repair|utilities|cloud|hosting/.test(name)) return 'expense';
  // Income: must start with or be purely a revenue concept — not expense items that contain "sales"
  if (/^(total\s+)?(revenue|income|turnover|receipts|fees earned|service income)/.test(name)) return 'income';
  if (/\bsales\b/.test(name) && !/commission|marketing|cost/.test(name)) return 'income';
  return 'expense'; // default to expense — safer than 'other' which drops rows
}

function getStatus(variance_pct: number, accountType: 'income' | 'expense' | 'other'): string {
  if (Math.abs(variance_pct) < 5) return 'On Track';
  if (accountType === 'income') {
    if (variance_pct > 10) return 'Above Target';
    if (variance_pct < -10) return 'Below Target';
  }
  if (accountType === 'expense') {
    if (variance_pct > 10) return 'Over Budget';
    if (variance_pct < -10) return 'Under Budget';
  }
  return 'Watch';
}

function computeVarianceAnalysis(items: VarianceLineItem[]) {
  const line_items = items
    .map((i) => {
    const accountType = inferAccountType(i.account, i.accountType);
    if (accountType === 'other') return null;
    const variance = i.actual - i.budget;
    const variance_pct = i.budget ? (variance / i.budget) * 100 : 0;
    const favorable = accountType === 'income' ? variance > 0 : variance < 0;
    return {
      ...i,
      accountType,
      variance,
      variance_pct,
      favorable,
      status: getStatus(variance_pct, accountType),
      material: Math.abs(variance_pct) > 10,
    };
  })
  .filter(Boolean) as VarianceLineItem[];
  const revenue_items = line_items.filter((i) => i.accountType === 'income');
  const expense_items = line_items.filter((i) => i.accountType === 'expense');
  const revenue_budget = revenue_items.reduce((s, i) => s + i.budget, 0);
  const revenue_actual = revenue_items.reduce((s, i) => s + i.actual, 0);
  const revenue_variance = revenue_actual - revenue_budget;
  const revenue_variance_pct = revenue_budget ? (revenue_variance / revenue_budget) * 100 : 0;
  const cost_budget = expense_items.reduce((s, i) => s + i.budget, 0);
  const cost_actual = expense_items.reduce((s, i) => s + i.actual, 0);
  const cost_variance = cost_actual - cost_budget;
  const cost_variance_pct = cost_budget ? (cost_variance / cost_budget) * 100 : 0;
  const total_budget = revenue_budget - cost_budget;
  const total_actual = revenue_actual - cost_actual;
  const total_variance = total_actual - total_budget;
  const total_variance_pct = total_budget ? (total_variance / Math.abs(total_budget)) * 100 : 0;
  const dept_agg: Record<string, { department: string; budget: number; actual: number; variance: number; variance_pct: number; status: string }> = {};
  line_items.forEach((i) => {
    if (!dept_agg[i.department]) {
      dept_agg[i.department] = { department: i.department, budget: 0, actual: 0, variance: 0, variance_pct: 0, status: '' };
    }
    dept_agg[i.department].budget += i.budget;
    dept_agg[i.department].actual += i.actual;
  });
  Object.keys(dept_agg).forEach((d) => {
    const v = dept_agg[d];
    v.variance = v.actual - v.budget;
    v.variance_pct = v.budget ? (v.variance / v.budget) * 100 : 0;
    v.status = getStatus(v.variance_pct, 'expense');
  });
  const department_summary = Object.values(dept_agg);
  return {
    line_items,
    revenue_items,
    expense_items,
    department_summary,
    revenue_budget,
    revenue_actual,
    revenue_variance,
    revenue_variance_pct,
    cost_budget,
    cost_actual,
    cost_variance,
    cost_variance_pct,
    total_budget,
    total_actual,
    total_variance,
    total_variance_pct,
    overall_status:
      revenue_variance_pct > cost_variance_pct && total_actual > total_budget
        ? 'High Growth with Margin Expansion'
        : revenue_actual >= revenue_budget && cost_actual > cost_budget
          ? 'Growth with Margin Pressure'
          : revenue_actual < revenue_budget && cost_actual > cost_budget
            ? 'Underperforming'
            : 'Contracting',
  };
}

export function VarianceAnalysisPage() {
  const navigate = useNavigate();
  const tenantId = getActiveCompanyId() || '';
  const [rawItems, setRawItems] = useState<VarianceLineItem[]>([]);
  const [activeTab, setActiveTab] = useState<'overview' | 'table' | 'charts' | 'ai'>('overview');
  const [uploadModal, setUploadModal] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [loadBanner, setLoadBanner] = useState<string | null>(null);
  const [aiNarrative, setAiNarrative] = useState<{
    executive_summary: string;
    line_commentary: Array<{ account: string; why: string; recommendation: string }>;
    action_items: string[];
    fallback_used?: boolean;
  } | null>(null);
  const [narrativeFallback, setNarrativeFallback] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiStep, setAiStep] = useState('');
  const lastVarianceSyncKey = useRef<string | null>(null);
  const [tableSearch, setTableSearch] = useState('');
  const [tableDept, setTableDept] = useState('all');
  const [tableStatus, setTableStatus] = useState('all');
  const [tableDirection, setTableDirection] = useState<'all' | 'over' | 'under' | 'material'>('all');
  const [materialityPct, setMaterialityPct] = useState(0);
  const [syncActualsLoading, setSyncActualsLoading] = useState(false);
  const [syncActualsMsg, setSyncActualsMsg] = useState('');
  const [aiMode, setAiMode] = useState<'cfo' | 'board' | 'investor'>('cfo');
  const [showAiModeMenu, setShowAiModeMenu] = useState(false);
  const [currency, setCurrency] = useState<CurrencyType>(() => {
    const stored = (localStorage.getItem(LS_FPA_CURRENCY_KEY) || localStorage.getItem(LS_APP_CURRENCY_FALLBACK_KEY) || 'AED').toUpperCase();
    if (['INR', 'USD', 'EUR', 'GBP', 'AED'].includes(stored)) return stored as CurrencyType;
    return 'AED';
  });
  const [currencyFormat, setCurrencyFormat] = useState<CurrencyFormatLocale>(() => {
    const stored = String(localStorage.getItem(LS_CURRENCY_FORMAT_KEY) || 'GLOBAL').toUpperCase();
    return stored === 'IN' ? 'IN' : 'GLOBAL';
  });

  useEffect(() => {
    localStorage.setItem(LS_FPA_CURRENCY_KEY, currency);
  }, [currency]);

  useEffect(() => {
    localStorage.setItem(LS_CURRENCY_FORMAT_KEY, currencyFormat);
  }, [currencyFormat]);

  useEffect(() => {
    let cancelled = false;

    const hydrateFromStorage = (): boolean => {
      const actualData = loadFPAActual();
      const budgetData = loadFPABudget();
      if (!actualData) return false;

      const srcItems = actualData.lineItems || budgetData?.lineItems || [];
      if (srcItems.length > 0) {
        const MONTHS = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
        const rows: VarianceLineItem[] = srcItems.map((item: any, idx: number) => {
          const actArr: number[] = item.monthlyActuals || (item.monthly ? MONTHS.map((k: string) => Number(item.monthly[k]) || 0) : []);
          const budArr: number[] = item.monthlyBudgets || (item.monthly ? MONTHS.map((k: string) => Number((budgetData?.lineItems?.[idx] as any)?.monthly?.[k] || item.monthly[k]) || 0) : []);
          const ytdM = actArr.reduce((last, v, i) => (v > 0 ? i + 1 : last), 0) || MONTHS.length;
          const actual  = actArr.slice(0, ytdM).reduce((s, v) => s + v, 0) || Number(item.actual || 0);
          const budget  = budArr.slice(0, ytdM).reduce((s, v) => s + v, 0) || Number(item.budget || 0);
          const accType = String(item.accountType || item.account_type || '').toLowerCase();
          const name    = String(item.account || item.account_name || item.category || '');
          return {
            account:     name,
            department:  String(item.department || 'All Depts'),
            budget, actual,
            accountType: (accType === 'income' || accType === 'revenue' ? 'income' : accType === 'expense' || accType === 'cost' ? 'expense' : 'other') as any,
          };
        }).filter((r: VarianceLineItem) => r.account && (r.budget !== 0 || r.actual !== 0));

        if (rows.length) {
          setRawItems(rows);
          const cur = localStorage.getItem('fpa_currency') || 'AED';
          setLoadBanner(`✅ ${rows.length} lines loaded from master upload (${cur})`);
          window.setTimeout(() => setLoadBanner(null), 6000);
          return true;
        }
      }

      const rows = convertToVarianceData(actualData, budgetData || actualData)
        .filter((r: any) => !r.isHeader)
        .map((r: any) => ({
          account: String(r.category ?? ''),
          department: 'All Depts',
          budget: Number(r.budget) || 0,
          actual: Number(r.actual) || 0,
        }))
        .filter((r: VarianceLineItem) => r.account && (r.budget !== 0 || r.actual !== 0));

      if (!rows.length) return false;
      setRawItems(rows);
      setLoadBanner(`Data loaded: ${rows.length} variance lines`);
      window.setTimeout(() => setLoadBanner(null), 5000);
      return true;
    };

    const loadFromMaster = async () => {
      const sync = await syncFpaMasterFromApi(tenantId);
      if (cancelled) return;
      const loaded = hydrateFromStorage();
      if (!loaded && sync.rowCount > 0 && sync.usableRowCount === 0) {
        setLoadBanner(
          '⚠️ Master file has no budget/actual values. Add Account + Budget + Actual columns, then re-upload.'
        );
        window.setTimeout(() => setLoadBanner(null), 8000);
      }
    };

    void loadFromMaster();

    const onMasterUpdated = () => {
      void loadFromMaster();
    };
    window.addEventListener(FPA_MASTER_UPDATED_EVENT, onMasterUpdated);

    return () => {
      cancelled = true;
      window.removeEventListener(FPA_MASTER_UPDATED_EVENT, onMasterUpdated);
    };
  }, [tenantId]);

  const analysis = useMemo(() => (rawItems.length ? computeVarianceAnalysis(rawItems) : null), [rawItems]);

  const loadSampleData = () => {
    setRawItems(SAMPLE_VARIANCE_DATA.map((i) => ({ ...i })));
    setLoadBanner(`Data loaded: ${SAMPLE_VARIANCE_DATA.length} line items across ${new Set(SAMPLE_VARIANCE_DATA.map((i) => i.department)).size} departments`);
    setTimeout(() => setLoadBanner(null), 5000);
  };

  const handleUpload = async () => {
    if (!uploadFile) return;
    setUploading(true);
    try {
      // Always parse client-side — no backend dependency for uploads
      const buf = await uploadFile.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];

      // Smart header detection: scan rows 0-4 for ≥2 header keywords.
      // Works for files with 0, 1, or 2 title rows above the real column headers.
      const rawAll: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as any[][];
      const HDR_RE = /^(category|line.?item|account|actual|budget|metric|description)/i;
      let headerRowIdx = 0;
      for (let i = 0; i < Math.min(5, rawAll.length); i++) {
        const vals = rawAll[i].map((v: any) => String(v ?? '').trim());
        if (vals.filter((v: string) => HDR_RE.test(v)).length >= 2) { headerRowIdx = i; break; }
      }
      let rows: any[] = XLSX.utils.sheet_to_json(sheet, { defval: '', range: headerRowIdx });
      // Normalise column names to canonical form
      if (rows.length > 0) {
        const keyMap: Record<string, string> = {};
        Object.keys(rows[0]).forEach(k => {
          const n = k.trim().toLowerCase().replace(/[^a-z0-9]/g, '_');
          // Account Type must be matched first (specific) before generic 'account'
          if (/^account_?type$|^type$/.test(n))                  keyMap[k] = 'Account Type';
          else if (/^is_?header$/.test(n))                       keyMap[k] = 'Is Header';
          else if (/^(category|line_item|account|account_name|account_code|name|description|metric)$/.test(n)) keyMap[k] = 'Category';
          else if (/^actual($|_(?!units|price))/.test(n) && !/ytd|prior/.test(n)) keyMap[k] = 'Actual';
          else if (/^budget($|_(?!units|price))/.test(n) && !/ytd/.test(n))       keyMap[k] = 'Budget';
          else if (/ytd.*actual|actual.*ytd/.test(n))            keyMap[k] = 'YTD Actual';
          else if (/ytd.*budget|budget.*ytd/.test(n))            keyMap[k] = 'YTD Budget';
          else if (/prior|last.*year/.test(n))                   keyMap[k] = 'Prior Year';
        });
        rows = rows.map(r => { const o: any = {}; Object.entries(r).forEach(([k,v]) => { o[keyMap[k]??k]=v; }); return o; });
      }

      const parseNum = (v: any): number => {
        if (v == null || v === '') return 0;
        if (typeof v === 'number') return v;
        return parseFloat(String(v).replace(/,/g, '')) || 0;
      };

      if (!rows.length) throw new Error('File appears empty — check the sheet has data rows.');

      const keys = Object.keys(rows[0]);
      const accCol    = keys.find((k) => /^(account|category|line.?item|name|metric)/i.test(k)) ?? keys[0];
      const deptCol   = keys.find((k) => /^(department|dept)$/i.test(k));
      const ownerCol  = keys.find((k) => /^(owner|responsible|manager)$/i.test(k));
      const actualCol = keys.find((k) => /^actual$/i.test(k))  ?? keys.find((k) => /actual/i.test(k) && !/ytd|prior/i.test(k));
      const budgetCol = keys.find((k) => /^budget$/i.test(k))  ?? keys.find((k) => /budget/i.test(k) && !/ytd/i.test(k));
      const ytdActCol = keys.find((k) => /ytd.?actual|actual.?ytd/i.test(k));
      const ytdBudCol = keys.find((k) => /ytd.?budget|budget.?ytd/i.test(k));
      const priorCol  = keys.find((k) => /prior.?year|last.?year/i.test(k));
      const headerCol = keys.find((k) => /is.?header|header/i.test(k));

      // Detect monthly columns for YTD period matching
      const MONTHS = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
      const monthActCols = MONTHS.map(m => keys.find(k => new RegExp(`^${m}[_.]?act`, 'i').test(k) || new RegExp(`^${m}[_.]?actual`, 'i').test(k)));
      const monthBudCols = MONTHS.map(m => keys.find(k => new RegExp(`^${m}[_.]?bud`, 'i').test(k) || new RegExp(`^${m}[_.]?budget`, 'i').test(k)));
      const hasMonthlyActuals = monthActCols.some(c => c != null);
      const hasMonthlyBudgets = monthBudCols.some(c => c != null);

      if (!budgetCol && !actualCol && !hasMonthlyActuals) {
        throw new Error(
          `Could not find Budget/Actual columns.\nFound: ${keys.join(', ')}\n\nExpected: Category + (Actual & Budget) OR (jan_act..dec_act & jan_bud..dec_bud)`
        );
      }

      const items: VarianceLineItem[] = rows
        .filter((r) => {
          if (headerCol && (r[headerCol] === true || String(r[headerCol]).toLowerCase() === 'true')) return false;
          const hasValue = hasMonthlyActuals
            ? monthActCols.some(c => c && parseNum(r[c]) !== 0)
            : (budgetCol && parseNum(r[budgetCol]) !== 0) || (actualCol && parseNum(r[actualCol]) !== 0);
          return hasValue;
        })
        .map((r) => {
          let actual: number, budget: number, ytdActual: number, ytdBudget: number;

          if (hasMonthlyActuals) {
            // Sum actuals for months with data (YTD); sum budget for same months (YTD period matching)
            const actArr = monthActCols.map(c => c ? parseNum(r[c]) : 0);
            const budArr = monthBudCols.map(c => c ? parseNum(r[c]) : 0);
            // YTD = months where actuals exist
            const ytdMonths = actArr.reduce((last, v, i) => (v !== 0 ? i + 1 : last), 0);
            actual    = actArr.slice(0, ytdMonths).reduce((s, v) => s + v, 0);
            budget    = budArr.slice(0, ytdMonths).reduce((s, v) => s + v, 0); // YTD budget — same period!
            ytdActual = actual;
            ytdBudget = budget;
          } else {
            actual    = actualCol ? parseNum(r[actualCol]) : 0;
            budget    = budgetCol ? parseNum(r[budgetCol]) : 0;
            ytdActual = ytdActCol ? parseNum(r[ytdActCol]) : actual;
            ytdBudget = ytdBudCol ? parseNum(r[ytdBudCol]) : budget;
          }

          const priorYear = priorCol  ? parseNum(r[priorCol])  : actual * 0.85;
          return {
            account:     String(r[accCol] ?? ''),
            department:  deptCol  ? String(r[deptCol]  ?? '').trim() || 'All Depts' : 'All Depts',
            owner:       ownerCol ? String(r[ownerCol] ?? '').trim() || 'CFO'        : 'CFO',
            budget,
            actual,
            ytdActual,
            ytdBudget,
            priorYear,
            accountType: inferAccountType(
              String(r[accCol] ?? ''),
              String(r['Account_Type'] ?? r['Account Type'] ?? r['account_type'] ?? r['accountType'] ?? '')
            ),
          };
        });

      if (!items.length) throw new Error('No data rows found after parsing. Check the file format.');

      setRawItems(items);
      setLoadBanner(`✅ Loaded ${items.length} line items from "${uploadFile.name}"`);
      setUploadModal(false);
      setUploadFile(null);
      setTimeout(() => setLoadBanner(null), 6000);
    } catch (e: any) {
      alert('Upload failed: ' + (e.message || e));
    } finally {
      setUploading(false);
    }
  };

  const downloadTemplate = async () => {
    if (API_BASE) {
      const res = await fetch(`${API_BASE}/api/fpa/variance/template`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'FP&A_Variance_Template.xlsx';
      a.click();
      URL.revokeObjectURL(url);
    } else {
      const ws = XLSX.utils.aoa_to_sheet([
        ['Account_Name', 'Department', 'Budget_Amount', 'Actual_Amount', 'Notes'],
        ...SAMPLE_VARIANCE_DATA.slice(0, 5).map((i) => [i.account, i.department, i.budget, i.actual, '']),
      ]);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Variance Data');
      XLSX.writeFile(wb, 'FP&A_Variance_Template.xlsx');
    }
  };

  const generateAINarrative = async (modeOverride?: 'cfo' | 'board' | 'investor') => {
    if (!analysis) return;
    const selectedMode = modeOverride || aiMode;
    setAiLoading(true);
    setAiStep('Data validated');
    await new Promise((r) => setTimeout(r, 300));
    setAiStep('Variances calculated');
    await new Promise((r) => setTimeout(r, 300));
    setAiStep('Identifying patterns...');
    await new Promise((r) => setTimeout(r, 400));
    setAiStep('Generating narrative...');
    try {
      if (API_BASE) {
        const res = await fetch(`${API_BASE}/api/fpa/variance/ai-narrative`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
          variance_analysis: analysis,
          narrative_mode: selectedMode,
          currency,
          currency_format: currencyFormat,
        }),
        });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        setNarrativeFallback(Boolean(data.fallback_used));
        setAiNarrative({
          executive_summary: data.executive_summary || '',
          line_commentary: data.line_commentary || [],
          action_items: data.action_items || [],
          fallback_used: Boolean(data.fallback_used),
        });
      } else {
        const material = analysis.line_items.filter((i) => (i.material ?? Math.abs(i.variance_pct ?? 0) > 10));
        const topCostOverruns = material
          .filter((i) => i.accountType === 'expense' && (i.variance ?? 0) > 0)
          .slice(0, 3)
          .map((i) => i.account)
          .join(', ');
        const topFavorable = material
          .filter((i) => (i.accountType === 'income' && (i.variance ?? 0) > 0) || (i.accountType === 'expense' && (i.variance ?? 0) < 0))
          .slice(0, 3)
          .map((i) => i.account)
          .join(', ');
        const prompt = `You are a CFO advisor.
CRITICAL RULES:
1) Revenue above budget is always favorable.
2) Never call revenue an overspend.
3) Cost overruns must include expense accounts only.
4) Include sections: Revenue Performance, Cost Performance, Profit/Margin Impact.
5) Include COGS% interpretation: lower actual COGS% vs budget COGS% means margin improvement.
6) Narrative mode: ${selectedMode === 'board' ? 'Board Presentation (max 3 bullets, visual-first).' : selectedMode === 'investor' ? 'Investor Update (growth story + TAM context + explicit risks).' : 'CFO Summary (detailed numbers and specific actions).'}

DATA (amounts in ${currency} compact format):
Revenue budget ${formatCurrency(analysis.revenue_budget, currency, currencyFormat)}, actual ${formatCurrency(analysis.revenue_actual, currency, currencyFormat)}, variance ${analysis.revenue_variance_pct.toFixed(1)}%.
Cost budget ${formatCurrency(analysis.cost_budget, currency, currencyFormat)}, actual ${formatCurrency(analysis.cost_actual, currency, currencyFormat)}, variance ${analysis.cost_variance_pct.toFixed(1)}%.
Net budget ${formatCurrency(analysis.total_budget, currency, currencyFormat)}, actual ${formatCurrency(analysis.total_actual, currency, currencyFormat)}, variance ${analysis.total_variance_pct.toFixed(1)}%.
Top Expense Variances (Above Budget): ${topCostOverruns || 'None'}
Top Favorable Variances: ${topFavorable || 'None'}

Write concise CFO commentary and 3 numeric action items.`;
        const text = await callAI(prompt, { maxTokens: 800 });
        setAiNarrative({
          executive_summary: text,
          line_commentary: material.slice(0, 5).map((i) => ({
            account: i.account,
            why: 'Variance driven by category and timing.',
            recommendation: 'Review budget allocation and thresholds.',
          })),
          action_items: text.split(/\n/).filter((l) => /^\d+\.|^[🔴🟡🟢]/.test(l.trim())).slice(0, 5) || ['1. Review material variances with department heads.', '2. Update forecast for next quarter.', '3. Reallocate savings to priority areas.'],
        });
      }
    } catch (e: any) {
      console.warn('AI narrative unavailable, using on-page summary', e);
      const material = analysis.line_items.filter((i) => i.material ?? Math.abs(i.variance_pct ?? 0) > 10);
      setAiNarrative({
        executive_summary:
          `Net profit is ${formatCurrency(analysis.total_actual, currency, currencyFormat)} vs budget ` +
          `${formatCurrency(analysis.total_budget, currency, currencyFormat)} ` +
          `(${analysis.total_variance_pct.toFixed(1)}% total variance). ` +
          `Revenue ${analysis.revenue_variance_pct >= 0 ? 'beat' : 'missed'} plan by ${Math.abs(analysis.revenue_variance_pct).toFixed(1)}%; ` +
          `costs ${analysis.cost_variance_pct > 0 ? 'ran above' : 'came in below'} budget by ${Math.abs(analysis.cost_variance_pct).toFixed(1)}%.`,
        line_commentary: material.slice(0, 8).map((i) => ({
          account: i.account,
          why: `Variance of ${formatCurrency(i.variance ?? 0, currency, currencyFormat)} (${(i.variance_pct ?? 0).toFixed(1)}%).`,
          recommendation: 'Review with the department owner and update the forecast if the trend persists.',
        })),
        action_items: buildClientActionItems(analysis, currency, currencyFormat),
      });
      setNarrativeFallback(true);
    } finally {
      setAiLoading(false);
      setAiStep('');
    }
  };

  const runAnalysisSyncCommandCenter = async () => {
    if (!API_BASE || !rawItems.length) return;
    try {
      const line_items = rawItems.map((i) => ({
        account: i.account,
        department: i.department,
        budget: i.budget,
        actual: i.actual,
      }));
      const period = new Date().toISOString().slice(0, 7);
      await postCfoAgentRun(
        'fpa_variance',
        {
          line_items,
          period,
          company_id: tenantId,
        },
        tenantId
      );
      console.info('[CFO] fpa_variance synced silently');
    } catch (e: unknown) {
      console.warn('[CFO] fpa_variance sync failed', e);
    }
  };

  useEffect(() => {
    if (!rawItems.length || !API_BASE) return;
    const totalBudget = rawItems.reduce((s, i) => s + (Number(i.budget) || 0), 0);
    const totalActual = rawItems.reduce((s, i) => s + (Number(i.actual) || 0), 0);
    const key = `${tenantId}:${rawItems.length}:${totalBudget.toFixed(2)}:${totalActual.toFixed(2)}`;
    if (lastVarianceSyncKey.current === key) return;
    lastVarianceSyncKey.current = key;
    void runAnalysisSyncCommandCenter();
  }, [rawItems, tenantId, API_BASE]);

  const downloadReport = async () => {
    if (!analysis) return;
    if (API_BASE) {
      const res = await fetch(`${API_BASE}/api/fpa/variance/download-report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ variance_analysis: analysis, ai_narrative: aiNarrative || undefined }),
      });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'Variance_Analysis_Report.xlsx';
      a.click();
      URL.revokeObjectURL(url);
    } else {
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet([
        ['Account', 'Department', 'Budget', 'Actual', 'Variance', 'Variance %', 'Status'],
        ...analysis.line_items.map((i) => [i.account, i.department, i.budget, i.actual, i.variance, `${(i.variance_pct ?? 0).toFixed(1)}%`, i.status]),
      ]);
      XLSX.utils.book_append_sheet(wb, ws, 'Variance Table');
      XLSX.writeFile(wb, 'Variance_Analysis_Report.xlsx');
    }
  };

  const syncActualsFromGL = async () => {
    setSyncActualsLoading(true);
    setSyncActualsMsg('');
    try {
      const period = new Date().toISOString().slice(0, 7);
      const res = await fetch(`${API_BASE}/api/fpa/sync-actuals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ period, source: 'ifrs_statements' }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { actuals: { revenue: number; expenses: number }; period: string };
      setSyncActualsMsg(`Synced actuals for ${data.period}: Revenue AED ${data.actuals.revenue.toLocaleString()}, Expenses AED ${data.actuals.expenses.toLocaleString()}`);
    } catch (e) {
      setSyncActualsMsg(`Sync failed: ${String(e)}`);
    } finally {
      setSyncActualsLoading(false);
    }
  };

  const filteredTableRows = useMemo(() => {
    if (!analysis) return [];
    let rows = analysis.line_items;
    if (tableSearch) {
      const q = tableSearch.toLowerCase();
      rows = rows.filter((r) => r.account.toLowerCase().includes(q) || r.department.toLowerCase().includes(q));
    }
    if (tableDept !== 'all') rows = rows.filter((r) => r.department === tableDept);
    if (tableStatus !== 'all') rows = rows.filter((r) => r.status === tableStatus);
    if (tableDirection === 'over') rows = rows.filter((r) => (r.variance ?? 0) > 0);
    if (tableDirection === 'under') rows = rows.filter((r) => (r.variance ?? 0) < 0);
    if (tableDirection === 'material') rows = rows.filter((r) => r.material);
    if (materialityPct > 0) rows = rows.filter((r) => Math.abs(r.variance_pct ?? 0) >= materialityPct);
    return rows;
  }, [analysis, tableSearch, tableDept, tableStatus, tableDirection, materialityPct]);

  const exportTableExcel = () => {
    if (!analysis) return;
    const ws = XLSX.utils.aoa_to_sheet([
      [
        '#',
        'Account',
        'Department',
        `Budget (${getCurrencyDisplaySymbol(currency)})`,
        `Actual (${getCurrencyDisplaySymbol(currency)})`,
        `Variance (${getCurrencyDisplaySymbol(currency)})`,
        'Variance %',
        'Status',
      ],
      ...filteredTableRows.map((r, i) => [
        i + 1,
        r.account,
        r.department,
        r.budget,
        r.actual,
        r.variance ?? 0,
        `${(r.variance_pct ?? 0).toFixed(1)}%`,
        r.status ?? '',
      ]),
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Variance Detail');
    XLSX.writeFile(wb, 'Variance_Detail_Export.xlsx');
  };

  // Waterfall data: Net budget → cost overruns (red) / favorable variances (green) → Net actual
  const waterfallData = useMemo(() => {
    if (!analysis) return [];
    const items: { name: string; value: number; type: string; fill: string }[] = [];
    items.push({ name: 'Net Budget', value: analysis.total_budget, type: 'start', fill: colors.budgetBar });
    const costOverruns = analysis.line_items
      .filter((i) => i.accountType === 'expense' && (i.variance ?? 0) > 0)
      .sort((a, b) => (b.variance ?? 0) - (a.variance ?? 0));
    const favorable = analysis.line_items
      .filter((i) => (i.accountType === 'income' && (i.variance ?? 0) > 0) || (i.accountType === 'expense' && (i.variance ?? 0) < 0))
      .sort((a, b) => Math.abs(b.variance ?? 0) - Math.abs(a.variance ?? 0));
    costOverruns.slice(0, 8).forEach((i) => items.push({ name: i.account, value: i.variance ?? 0, type: 'cost-overrun', fill: colors.unfavorable }));
    favorable.slice(0, 8).forEach((i) => items.push({ name: i.account, value: Math.abs(i.variance ?? 0), type: 'favorable', fill: colors.favorable }));
    const netActualLabel = analysis.total_actual < 0 ? 'Net Actual (Loss)' : 'Net Actual';
    items.push({ name: netActualLabel, value: analysis.total_actual, type: 'end', fill: analysis.total_actual < 0 ? '#ef4444' : colors.actualBar });
    return items;
  }, [analysis]);

  const topCostOverruns = useMemo(() => {
    if (!analysis) return [];
    return analysis.line_items
      .filter((i) => i.accountType === 'expense' && (i.variance ?? 0) > 0)
      .sort((a, b) => (b.variance ?? 0) - (a.variance ?? 0))
      .slice(0, 5);
  }, [analysis]);

  const topFavorableVariances = useMemo(() => {
    if (!analysis) return [];
    return analysis.line_items
      .filter((i) => (i.accountType === 'income' && (i.variance ?? 0) > 0) || (i.accountType === 'expense' && (i.variance ?? 0) < 0))
      .sort((a, b) => Math.abs(b.variance ?? 0) - Math.abs(a.variance ?? 0))
      .slice(0, 5);
  }, [analysis]);

  const hasData = rawItems.length > 0;
  const curSym = getCurrencyDisplaySymbol(currency);

  return (
    <div className="min-h-screen" style={{ background: colors.bg }}>
      {/* Header */}
      <header className="border-b sticky top-0 z-40" style={{ borderColor: colors.border, background: colors.card }}>
        <div className="max-w-[1600px] mx-auto px-6 py-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <button
                onClick={() => navigate('/fpa')}
                className="p-2 rounded-lg transition hover:opacity-90"
                style={{ color: colors.text }}
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div>
                <h1 className="text-2xl font-bold" style={{ color: colors.text }}>
                  Variance Analysis
                </h1>
                <p className="text-sm" style={{ color: colors.muted }}>
                  Budget vs Actual — AI-powered variance intelligence
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-2 mr-1">
                <label className="flex flex-col gap-0.5 text-[10px] uppercase tracking-wide" style={{ color: colors.muted }}>
                  Currency
                  <select
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value as CurrencyType)}
                    className="text-xs rounded-lg border px-2 py-1.5 font-medium normal-case"
                    style={{ background: colors.bg, borderColor: colors.border, color: colors.text }}
                  >
                    <option value="USD">USD</option>
                    <option value="GBP">GBP</option>
                    <option value="EUR">EUR</option>
                    <option value="AED">AED</option>
                    <option value="INR">INR</option>
                  </select>
                </label>
                <label className="flex flex-col gap-0.5 text-[10px] uppercase tracking-wide" style={{ color: colors.muted }}>
                  Format
                  <select
                    value={currencyFormat}
                    onChange={(e) => setCurrencyFormat(e.target.value as CurrencyFormatLocale)}
                    className="text-xs rounded-lg border px-2 py-1.5 font-medium normal-case"
                    style={{ background: colors.bg, borderColor: colors.border, color: colors.text }}
                  >
                    <option value="GLOBAL">Global (M / K)</option>
                    <option value="IN">India (L / Cr)</option>
                  </select>
                </label>
              </div>
              <button
                onClick={() => setUploadModal(true)}
                className="px-4 py-2 rounded-lg font-medium flex items-center gap-2 transition"
                style={{ background: colors.budgetBar, color: '#fff' }}
              >
                <Upload className="w-4 h-4" />
                Upload Data
              </button>
              <button
                onClick={syncActualsFromGL}
                disabled={syncActualsLoading}
                className="px-4 py-2 rounded-lg font-medium flex items-center gap-2 transition disabled:opacity-50"
                style={{ background: '#0F766E', color: '#fff' }}
                title={syncActualsMsg || 'Sync actuals from posted GL entries'}
              >
                {syncActualsLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <BarChart3 className="w-4 h-4" />}
                Sync Actuals from Accounting
              </button>
              <button
                onClick={downloadReport}
                disabled={!hasData}
                className="px-4 py-2 rounded-lg font-medium flex items-center gap-2 border transition disabled:opacity-50"
                style={{ borderColor: colors.border, color: colors.text }}
              >
                <Download className="w-4 h-4" />
                Download Report
              </button>
              <div className="relative">
                <button
                  onClick={() => setShowAiModeMenu((s) => !s)}
                  disabled={!hasData}
                  className="px-4 py-2 rounded-lg font-medium flex items-center gap-2 transition disabled:opacity-50 max-w-[280px]"
                  style={{ background: 'linear-gradient(135deg,#F59E0B,#EA580C)', color: '#fff' }}
                >
                  <Bot className="w-4 h-4 shrink-0" />
                  <span className="truncate">
                    AI Narrative ·{' '}
                    {aiMode === 'board' ? 'Board' : aiMode === 'investor' ? 'Investor' : 'CFO'}
                  </span>
                  <ChevronDown className="w-4 h-4 shrink-0" />
                </button>
                {showAiModeMenu && hasData && (
                  <div className="absolute right-0 mt-2 w-52 rounded-lg shadow-lg border bg-white z-20" style={{ borderColor: colors.border }}>
                    {[
                      { id: 'cfo', label: 'CFO Summary' },
                      { id: 'board', label: 'Board Presentation' },
                      { id: 'investor', label: 'Investor Update' },
                    ].map((m) => (
                      <button
                        key={m.id}
                        onClick={() => {
                          setAiMode(m.id as 'cfo' | 'board' | 'investor');
                          setShowAiModeMenu(false);
                          setActiveTab('ai');
                          if (analysis) generateAINarrative(m.id as 'cfo' | 'board' | 'investor');
                        }}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
                        style={{ color: aiMode === m.id ? colors.actualBar : '#111827', fontWeight: aiMode === m.id ? 700 : 500 }}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
          {/* Breadcrumb */}
          <p className="text-xs mt-2" style={{ color: colors.muted }}>
            FP&A Suite &gt; Variance Analysis
          </p>
          {/* Tabs */}
          {hasData && (
            <div className="flex gap-1 mt-4 border-b" style={{ borderColor: colors.border }}>
              {[
                { id: 'overview', label: 'Overview', icon: BarChart3 },
                { id: 'table', label: 'Detail Table', icon: Table2 },
                { id: 'charts', label: 'Charts', icon: PieChart },
                { id: 'ai', label: 'AI Insights', icon: Sparkles },
              ].map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => setActiveTab(id as any)}
                  className="px-4 py-2.5 text-sm font-medium rounded-t-lg flex items-center gap-2 transition"
                  style={{
                    background: activeTab === id ? colors.card : 'transparent',
                    color: activeTab === id ? colors.text : colors.muted,
                    borderBottom: activeTab === id ? `2px solid ${colors.actualBar}` : '2px solid transparent',
                  }}
                >
                  <Icon className="w-4 h-4" />
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
      </header>

      {/* Success banner */}
      {loadBanner && (
        <div className="max-w-[1600px] mx-auto px-6 py-2">
          <div className="rounded-lg px-4 py-2 flex items-center gap-2" style={{ background: colors.favorable + '22', color: colors.favorable }}>
            ✅ {loadBanner}
          </div>
        </div>
      )}

      <main className="max-w-[1600px] mx-auto px-6 py-8">
        {!hasData ? (
          /* Upload section when no data */
          <div
            className="max-w-2xl mx-auto rounded-xl border-2 border-dashed p-10 text-center"
            style={{ borderColor: colors.border, background: colors.card }}
          >
            <h2 className="text-xl font-bold mb-2" style={{ color: colors.text }}>
              📊 Upload Budget vs Actual Data
            </h2>
            <p className="text-sm mb-6" style={{ color: colors.muted }}>
              Supports Excel (.xlsx) or CSV
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-left">
              <div className="rounded-lg p-6 border" style={{ borderColor: colors.border, background: colors.bg }}>
                <p className="font-medium mb-2" style={{ color: colors.text }}>
                  Upload a file with Budget and Actual columns
                </p>
                <p className="text-xs mb-4" style={{ color: colors.muted }}>
                  Drag & drop or click to browse. Format A: Account, Department, Budget, Actual. Format B: Jan_Budget, Jan_Actual, ...
                </p>
                <button
                  onClick={() => setUploadModal(true)}
                  className="w-full py-3 rounded-lg border flex items-center justify-center gap-2"
                  style={{ borderColor: colors.border, color: colors.text }}
                >
                  <Upload className="w-5 h-5" />
                  Choose File
                </button>
              </div>
              <div className="rounded-lg p-6 border" style={{ borderColor: colors.border, background: colors.bg }}>
                <p className="font-medium mb-2" style={{ color: colors.text }}>
                  Try with our demo dataset
                </p>
                <p className="text-xs mb-4" style={{ color: colors.muted }}>
                  Loads built-in CFO demo data instantly (24 line items, 6 departments).
                </p>
                <button
                  onClick={loadSampleData}
                  className="w-full py-3 rounded-lg font-medium flex items-center justify-center gap-2"
                  style={{ background: colors.favorable, color: '#fff' }}
                >
                  Load Sample Data
                </button>
              </div>
            </div>
            <div className="mt-6">
              <button
                onClick={downloadTemplate}
                className="text-sm flex items-center gap-2 mx-auto"
                style={{ color: colors.actualBar }}
              >
                <Download className="w-4 h-4" />
                Download Excel Template
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Tab: Overview */}
            {activeTab === 'overview' && analysis && (
              <div className="space-y-6">
                {/* KPI cards */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {[
                    { label: 'Revenue Performance', value: analysis.revenue_variance_pct, badge: analysis.revenue_variance >= 0 ? 'Favorable' : 'Below Target', color: analysis.revenue_variance >= 0 ? colors.favorable : colors.unfavorable },
                    { label: 'Cost Performance', value: analysis.cost_variance_pct, badge: analysis.cost_variance > 0 ? 'Over Budget' : 'Favorable', color: analysis.cost_variance > 0 ? colors.unfavorable : colors.favorable },
                    { label: 'Net Profit Variance', value: analysis.total_variance, badge: analysis.total_variance >= 0 ? 'Favorable' : 'Unfavorable', color: analysis.total_variance >= 0 ? colors.favorable : colors.unfavorable },
                    { label: 'Overall Status', value: 0, badge: analysis.overall_status, color: analysis.overall_status === 'Underperforming' ? colors.unfavorable : colors.favorable },
                  ].map((card, i) => (
                    <div key={i} className="rounded-xl p-5 border" style={{ background: colors.card, borderColor: colors.border }}>
                      <p className="text-xs font-medium mb-1" style={{ color: colors.muted }}>
                        {card.label}
                      </p>
                      <p className="text-2xl font-bold font-mono" style={{ color: card.color ?? colors.text }}>
                        {i === 0 ? `${analysis.revenue_variance_pct.toFixed(1)}%`
                          : i === 1 ? `${analysis.cost_variance_pct.toFixed(1)}%`
                          : i === 2 ? formatCurrencyFull(card.value as number, currency, currencyFormat)
                          : analysis.overall_status}
                      </p>
                      {card.badge && (
                        <span className="inline-block mt-2 px-2 py-0.5 rounded text-xs font-medium" style={{ background: card.color + '33', color: card.color }}>
                          {card.badge}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
                <div className="rounded-xl p-5 border" style={{ background: colors.card, borderColor: colors.border }}>
                  <h3 className="font-semibold mb-3" style={{ color: colors.text }}>Variance Summary</h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                    <div style={{ color: colors.text }}>
                      <p className="font-semibold" style={{ color: colors.favorable }}>Revenue Performance</p>
                      <p>Budget {formatCurrencyFull(analysis.revenue_budget, currency, currencyFormat)} | Actual {formatCurrencyFull(analysis.revenue_actual, currency, currencyFormat)}</p>
                      <p>{formatCurrencyFull(analysis.revenue_variance, currency, currencyFormat)} ({analysis.revenue_variance_pct.toFixed(1)}%)</p>
                    </div>
                    <div style={{ color: colors.text }}>
                      <p className="font-semibold" style={{ color: colors.unfavorable }}>Cost Performance</p>
                      <p>Budget {formatCurrencyFull(analysis.cost_budget, currency, currencyFormat)} | Actual {formatCurrencyFull(analysis.cost_actual, currency, currencyFormat)}</p>
                      <p>{formatCurrencyFull(analysis.cost_variance, currency, currencyFormat)} ({analysis.cost_variance_pct.toFixed(1)}%)</p>
                    </div>
                    <div style={{ color: colors.text }}>
                      <p className="font-semibold" style={{ color: colors.budgetBar }}>Profit/Margin Impact</p>
                      <p>Net Budget {formatCurrencyFull(analysis.total_budget, currency, currencyFormat)} | Net Actual {formatCurrencyFull(analysis.total_actual, currency, currencyFormat)}</p>
                      <p>Status: {analysis.overall_status}</p>
                    </div>
                  </div>
                </div>
                {/* Top overspends / savings */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="rounded-xl p-5 border" style={{ background: colors.card, borderColor: colors.border }}>
                    <h3 className="font-semibold mb-4" style={{ color: colors.unfavorable }}>Expense Variances (Above Budget)</h3>
                    <ul className="space-y-2 text-sm">
                      {topCostOverruns.map((i, idx) => (
                        <li key={idx} style={{ color: colors.text }}>
                          {idx + 1}. {i.account} — {formatCurrencyFull(i.variance ?? 0, currency, currencyFormat)} over ({(i.variance_pct ?? 0).toFixed(0)}%)
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="rounded-xl p-5 border" style={{ background: colors.card, borderColor: colors.border }}>
                    <h3 className="font-semibold mb-4" style={{ color: colors.favorable }}>Favorable Variances</h3>
                    <ul className="space-y-2 text-sm">
                      {topFavorableVariances.map((i, idx) => (
                        <li key={idx} style={{ color: colors.text }}>
                          {idx + 1}. {i.account} — {formatCurrencyFull(Math.abs(i.variance ?? 0), currency, currencyFormat)} ({Math.abs(i.variance_pct ?? 0).toFixed(0)}%)
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
                {/* Department summary table */}
                <div className="rounded-xl border overflow-hidden" style={{ background: colors.card, borderColor: colors.border }}>
                  <table className="w-full text-sm">
                    <thead>
                      <tr style={{ background: colors.bg }}>
                        <th className="text-left py-3 px-4" style={{ color: colors.muted }}>Department</th>
                        <th className="text-right py-3 px-4" style={{ color: colors.muted }}>Budget</th>
                        <th className="text-right py-3 px-4" style={{ color: colors.muted }}>Actual</th>
                        <th className="text-right py-3 px-4" style={{ color: colors.muted }}>Variance ({curSym})</th>
                        <th className="text-right py-3 px-4" style={{ color: colors.muted }}>Variance %</th>
                        <th className="text-center py-3 px-4" style={{ color: colors.muted }}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analysis.department_summary.map((d, i) => (
                        <tr key={i} className="border-t" style={{ borderColor: colors.border }}>
                          <td className="py-3 px-4 font-medium" style={{ color: colors.text }}>{d.department}</td>
                          <td className="py-3 px-4 text-right font-mono" style={{ color: colors.text }}>{formatCurrencyFull(d.budget, currency, currencyFormat)}</td>
                          <td className="py-3 px-4 text-right font-mono" style={{ color: colors.text }}>{formatCurrencyFull(d.actual, currency, currencyFormat)}</td>
                          <td className="py-3 px-4 text-right font-mono" style={{ color: d.variance >= 0 ? colors.unfavorable : colors.favorable }}>{formatCurrencyFull(d.variance, currency, currencyFormat)}</td>
                          <td className="py-3 px-4 text-right font-mono" style={{ color: d.variance_pct >= 0 ? colors.unfavorable : colors.favorable }}>{d.variance_pct.toFixed(1)}%</td>
                          <td className="py-3 px-4 text-center">
                            <span
                              className="px-2 py-1 rounded-full text-xs font-medium"
                              style={{
                                background: d.status === 'On Track' ? colors.favorable + '33' : d.status === 'Watch' ? colors.watch + '33' : d.status === 'Over Budget' ? colors.unfavorable + '33' : colors.budgetBar + '33',
                                color: colors.text,
                              }}
                            >
                              {d.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Tab: Detail Table */}
            {activeTab === 'table' && analysis && (
              <div className="space-y-4">
                <div className="flex flex-wrap gap-3 items-center">
                  <input
                    type="text"
                    placeholder="Search account name..."
                    value={tableSearch}
                    onChange={(e) => setTableSearch(e.target.value)}
                    className="px-3 py-2 rounded-lg border w-48 text-sm"
                    style={{ background: colors.card, borderColor: colors.border, color: colors.text }}
                  />
                  <select
                    value={tableDept}
                    onChange={(e) => setTableDept(e.target.value)}
                    className="px-3 py-2 rounded-lg border text-sm"
                    style={{ background: colors.card, borderColor: colors.border, color: colors.text }}
                  >
                    <option value="all">All Departments</option>
                    {analysis.department_summary.map((d) => (
                      <option key={d.department} value={d.department}>{d.department}</option>
                    ))}
                  </select>
                  <select
                    value={tableStatus}
                    onChange={(e) => setTableStatus(e.target.value)}
                    className="px-3 py-2 rounded-lg border text-sm"
                    style={{ background: colors.card, borderColor: colors.border, color: colors.text }}
                  >
                    <option value="all">All Status</option>
                    <option value="On Track">On Track</option>
                    <option value="Watch">Watch</option>
                    <option value="Over Budget">Over Budget</option>
                    <option value="Under Budget">Under Budget</option>
                  </select>
                  <select
                    value={tableDirection}
                    onChange={(e) => setTableDirection(e.target.value as any)}
                    className="px-3 py-2 rounded-lg border text-sm"
                    style={{ background: colors.card, borderColor: colors.border, color: colors.text }}
                  >
                    <option value="all">All</option>
                    <option value="over">Over Budget Only</option>
                    <option value="under">Under Budget Only</option>
                    <option value="material">Material (&gt;10%)</option>
                  </select>
                  <label className="flex items-center gap-2 text-sm" style={{ color: colors.muted }}>
                    Materiality &gt;
                    <input
                      type="range"
                      min={0}
                      max={20}
                      value={materialityPct}
                      onChange={(e) => setMaterialityPct(Number(e.target.value))}
                      className="w-24"
                    />
                    {materialityPct}%
                  </label>
                  <button
                    onClick={exportTableExcel}
                    className="ml-auto px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2"
                    style={{ background: colors.budgetBar, color: '#fff' }}
                  >
                    <Download className="w-4 h-4" />
                    Export to Excel
                  </button>
                </div>
                <div className="rounded-xl border overflow-x-auto" style={{ background: colors.card, borderColor: colors.border }}>
                  <table className="w-full text-sm">
                    <thead>
                      <tr style={{ background: colors.bg }}>
                        <th className="text-left py-3 px-4" style={{ color: colors.muted }}>#</th>
                        <th className="text-left py-3 px-4" style={{ color: colors.muted }}>Account</th>
                        <th className="text-left py-3 px-4" style={{ color: colors.muted }}>Account Type</th>
                        <th className="text-left py-3 px-4" style={{ color: colors.muted }}>Department</th>
                        <th className="text-right py-3 px-4" style={{ color: colors.muted }}>Budget ({curSym})</th>
                        <th className="text-right py-3 px-4" style={{ color: colors.muted }}>Actual ({curSym})</th>
                        <th className="text-right py-3 px-4" style={{ color: colors.muted }}>Variance ({curSym})</th>
                        <th className="text-right py-3 px-4" style={{ color: colors.muted }}>Variance %</th>
                        <th className="text-center py-3 px-4" style={{ color: colors.muted }}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredTableRows.map((r, i) => (
                        <tr key={i} className="border-t" style={{ borderColor: colors.border }}>
                          <td className="py-2 px-4" style={{ color: colors.muted }}>{i + 1}</td>
                          <td className="py-2 px-4 font-medium" style={{ color: colors.text }}>{r.account}</td>
                          <td className="py-2 px-4" style={{ color: colors.muted }}>{String(r.accountType || 'other').toUpperCase()}</td>
                          <td className="py-2 px-4" style={{ color: colors.muted }}>{r.department}</td>
                          <td className="py-2 px-4 text-right font-mono" style={{ color: colors.text }}>{formatCurrencyFull(r.budget, currency, currencyFormat)}</td>
                          <td className="py-2 px-4 text-right font-mono" style={{ color: colors.text }}>{formatCurrencyFull(r.actual, currency, currencyFormat)}</td>
                          <td className="py-2 px-4 text-right font-mono" style={{ color: r.favorable ? colors.favorable : colors.unfavorable }}>{formatCurrencyFull(r.variance ?? 0, currency, currencyFormat)}</td>
                          <td className="py-2 px-4 text-right font-mono" style={{ color: r.favorable ? colors.favorable : colors.unfavorable }}>{(r.variance_pct ?? 0).toFixed(1)}%</td>
                          <td className="py-2 px-4 text-center">
                            <span className="px-2 py-0.5 rounded text-xs" style={{ background: r.favorable ? colors.favorable + '33' : colors.unfavorable + '33', color: colors.text }}>
                              {r.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Tab: Charts */}
            {activeTab === 'charts' && analysis && (
              <div className="space-y-8">
                {/* Waterfall */}
                <div className="rounded-xl border p-6" style={{ background: colors.card, borderColor: colors.border }}>
                  <h3 className="text-lg font-bold mb-4" style={{ color: colors.text }}>
                    Variance Waterfall: Budget → Actual
                  </h3>
                  <ResponsiveContainer width="100%" height={380}>
                    <BarChart data={waterfallData} margin={{ top: 20, right: 20, left: 20, bottom: 80 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={colors.border} />
                      <XAxis dataKey="name" angle={-35} textAnchor="end" height={80} tick={{ fill: colors.muted, fontSize: 11 }} />
                      <YAxis tickFormatter={(v) => formatCurrency(v, currency, currencyFormat)} tick={{ fill: colors.muted }} />
                      <Tooltip
                        formatter={(v: number) => [formatCurrencyFull(v, currency, currencyFormat), '']}
                        contentStyle={{ background: colors.card, border: `1px solid ${colors.border}`, borderRadius: 8 }}
                        labelStyle={{ color: colors.text }}
                      />
                      <Bar dataKey="value" name="Amount">
                        {waterfallData.map((e, i) => (
                          <Cell key={i} fill={e.fill} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                {/* Budget vs Actual by department */}
                <div className="rounded-xl border p-6" style={{ background: colors.card, borderColor: colors.border }}>
                  <h3 className="text-lg font-bold mb-4" style={{ color: colors.text }}>
                    Budget vs Actual by Department
                  </h3>
                  <ResponsiveContainer width="100%" height={320}>
                    <BarChart
                      data={analysis.department_summary}
                      layout="vertical"
                      margin={{ left: 100, right: 20 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke={colors.border} />
                      <XAxis type="number" tickFormatter={(v) => formatCurrency(v, currency, currencyFormat)} tick={{ fill: colors.muted }} />
                      <YAxis type="category" dataKey="department" width={95} tick={{ fill: colors.muted, fontSize: 11 }} />
                      <Tooltip formatter={(v: number) => [formatCurrencyFull(v, currency, currencyFormat), '']} contentStyle={{ background: colors.card, border: `1px solid ${colors.border}` }} />
                      <Legend />
                      <Bar dataKey="budget" name="Budget" fill={colors.budgetBar} radius={[0, 4, 4, 0]} />
                      <Bar dataKey="actual" name="Actual" fill={colors.actualBar} radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                {/* Variance % by department */}
                <div className="rounded-xl border p-6" style={{ background: colors.card, borderColor: colors.border }}>
                  <h3 className="text-lg font-bold mb-4" style={{ color: colors.text }}>
                    Variance % by Department
                  </h3>
                  <ResponsiveContainer width="100%" height={320}>
                    <BarChart
                      data={[...analysis.department_summary].sort((a, b) => (b.variance_pct ?? 0) - (a.variance_pct ?? 0))}
                      layout="vertical"
                      margin={{ left: 100 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke={colors.border} />
                      <XAxis type="number" tickFormatter={(v) => `${v}%`} tick={{ fill: colors.muted }} domain={['auto', 'auto']} />
                      <YAxis type="category" dataKey="department" width={95} tick={{ fill: colors.muted }} />
                      <Tooltip formatter={(v: number) => [`${v.toFixed(1)}%`, 'Variance %']} contentStyle={{ background: colors.card, border: `1px solid ${colors.border}` }} />
                      <Bar dataKey="variance_pct" name="Variance %">
                        {[...analysis.department_summary].sort((a, b) => (b.variance_pct ?? 0) - (a.variance_pct ?? 0)).map((d, i) => (
                          <Cell key={i} fill={(d.variance_pct ?? 0) >= 0 ? colors.unfavorable : colors.favorable} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                {/* Pies: Overspends / Savings by category */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="rounded-xl border p-6" style={{ background: colors.card, borderColor: colors.border }}>
                    <h3 className="text-lg font-bold mb-4" style={{ color: colors.unfavorable }}>Expense Variances by Category</h3>
                    <ResponsiveContainer width="100%" height={260}>
                      <RechartsPie>
                        <Pie
                          data={analysis.line_items
                            .filter((i) => i.accountType === 'expense' && (i.variance ?? 0) > 0)
                            .sort((a, b) => (b.variance ?? 0) - (a.variance ?? 0))
                            .slice(0, 6)
                            .map((i) => ({ name: i.account, value: i.variance ?? 0 }))}
                          dataKey="value"
                          nameKey="name"
                          cx="50%"
                          cy="50%"
                          innerRadius={50}
                          outerRadius={80}
                          paddingAngle={2}
                          label={({ name, value }) => `${name}: ${formatCurrency(value, currency, currencyFormat)}`}
                        >
                          {analysis.line_items
                            .filter((i) => i.accountType === 'expense' && (i.variance ?? 0) > 0)
                            .slice(0, 6)
                            .map((_, i) => (
                              <Cell key={i} fill={colors.unfavorable} />
                            ))}
                        </Pie>
                        <Tooltip formatter={(v: number) => [formatCurrencyFull(v, currency, currencyFormat), '']} contentStyle={{ background: colors.card, border: `1px solid ${colors.border}` }} />
                      </RechartsPie>
                    </ResponsiveContainer>
                  </div>
                  <div className="rounded-xl border p-6" style={{ background: colors.card, borderColor: colors.border }}>
                    <h3 className="text-lg font-bold mb-4" style={{ color: colors.favorable }}>Favorable Variances by Category</h3>
                    <ResponsiveContainer width="100%" height={260}>
                      <RechartsPie>
                        <Pie
                          data={analysis.line_items
                            .filter((i) => (i.accountType === 'income' && (i.variance ?? 0) > 0) || (i.accountType === 'expense' && (i.variance ?? 0) < 0))
                            .sort((a, b) => Math.abs(b.variance ?? 0) - Math.abs(a.variance ?? 0))
                            .slice(0, 6)
                            .map((i) => ({ name: i.account, value: Math.abs(i.variance ?? 0) }))}
                          dataKey="value"
                          nameKey="name"
                          cx="50%"
                          cy="50%"
                          innerRadius={50}
                          outerRadius={80}
                          paddingAngle={2}
                          label={({ name, value }) => `${name}: ${formatCurrency(value, currency, currencyFormat)}`}
                        >
                          {analysis.line_items
                            .filter((i) => (i.accountType === 'income' && (i.variance ?? 0) > 0) || (i.accountType === 'expense' && (i.variance ?? 0) < 0))
                            .slice(0, 6)
                            .map((_, i) => (
                              <Cell key={i} fill={colors.favorable} />
                            ))}
                        </Pie>
                        <Tooltip formatter={(v: number) => [formatCurrencyFull(v, currency, currencyFormat), '']} contentStyle={{ background: colors.card, border: `1px solid ${colors.border}` }} />
                      </RechartsPie>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            )}

            {/* Tab: AI Insights */}
            {activeTab === 'ai' && (
              <div className="space-y-6">
                {!aiNarrative && !aiLoading && (
                  <div className="rounded-xl border p-8 text-center" style={{ background: colors.card, borderColor: colors.border }}>
                    <p className="mb-4" style={{ color: colors.text }}>
                      Generate CFO-ready narrative and line-by-line commentary powered by AI.
                    </p>
                    <button
                      type="button"
                      onClick={() => void generateAINarrative()}
                      className="px-6 py-3 rounded-lg font-medium flex items-center gap-2 mx-auto"
                      style={{ background: 'linear-gradient(135deg,#F59E0B,#EA580C)', color: '#fff' }}
                    >
                      <Sparkles className="w-5 h-5" />
                      Generate AI Variance Analysis
                    </button>
                    <p className="text-xs mt-2" style={{ color: colors.muted }}>Powered by AI (backend Claude) — takes 10–15 seconds</p>
                  </div>
                )}
                {aiLoading && (
                  <div className="rounded-xl border p-8" style={{ background: colors.card, borderColor: colors.border }}>
                    <p className="mb-4 flex items-center gap-2" style={{ color: colors.text }}>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      AI is analysing {rawItems.length} line items across {analysis?.department_summary.length ?? 0} departments...
                    </p>
                    <div className="space-y-2 text-sm" style={{ color: colors.muted }}>
                      <p>✅ Data validated</p>
                      <p>✅ Variances calculated</p>
                      <p>{aiStep ? '🔄 ' + aiStep : '⏳ Generating narrative...'}</p>
                    </div>
                  </div>
                )}
                {aiNarrative && !aiLoading && (
                  <>
                    {narrativeFallback && (
                      <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
                        Rule-based narrative shown — Claude AI is unavailable (check Anthropic API credits). Variance data and charts are unaffected.
                      </div>
                    )}
                    <div className="rounded-xl border-l-4 p-6" style={{ background: colors.card, borderColor: colors.actualBar }}>
                      <div className="flex items-start justify-between gap-4">
                        <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: colors.text }}>
                          {stripEmbeddedActionItems(aiNarrative.executive_summary)}
                        </p>
                        <div className="flex gap-2 shrink-0">
                          <button
                            onClick={() => navigator.clipboard.writeText(stripEmbeddedActionItems(aiNarrative.executive_summary))}
                            className="p-2 rounded border"
                            style={{ borderColor: colors.border, color: colors.text }}
                            title="Copy"
                          >
                            <Copy className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                    {aiNarrative.line_commentary.length > 0 && (
                      <div className="space-y-4">
                        <h3 className="font-bold" style={{ color: colors.text }}>Line-by-line commentary</h3>
                        {aiNarrative.line_commentary.map((c, i) => (
                          <div key={i} className="rounded-xl border p-4" style={{ background: colors.card, borderColor: colors.border }}>
                            <p className="font-medium mb-2" style={{ color: colors.text }}>{c.account}</p>
                            <p className="text-sm mb-2" style={{ color: colors.muted }}><strong>WHY:</strong> {c.why}</p>
                            <p className="text-sm" style={{ color: colors.muted }}><strong>RECOMMENDATION:</strong> {c.recommendation}</p>
                          </div>
                        ))}
                      </div>
                    )}
                    {aiNarrative.action_items.length > 0 && (
                      <div className="rounded-xl border p-6" style={{ background: colors.card, borderColor: colors.border }}>
                        <h3 className="font-bold mb-4" style={{ color: colors.text }}>Action Items</h3>
                        <ol className="list-decimal list-inside space-y-2 text-sm" style={{ color: colors.text }}>
                          {aiNarrative.action_items.map((item, i) => (
                            <li key={i}>{item}</li>
                          ))}
                        </ol>
                        <button
                          onClick={() => {
                            const summary = stripEmbeddedActionItems(aiNarrative.executive_summary);
                            const body = summary + (aiNarrative.action_items.length ? '\n\nKey actions:\n' + aiNarrative.action_items.join('\n') : '');
                            window.open(`mailto:?subject=Variance%20Analysis%20Summary&body=${encodeURIComponent(body)}`);
                          }}
                          className="mt-4 px-4 py-2 rounded-lg border flex items-center gap-2"
                          style={{ borderColor: colors.border, color: colors.text }}
                        >
                          <Mail className="w-4 h-4" />
                          Email to CFO
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </>
        )}
      </main>

      {/* Upload modal */}
      {uploadModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="rounded-xl max-w-lg w-full overflow-hidden" style={{ background: colors.card, border: `1px solid ${colors.border}` }}>
            <div className="flex items-center justify-between p-4 border-b" style={{ borderColor: colors.border }}>
              <h2 className="text-lg font-bold" style={{ color: colors.text }}>📤 Upload Budget vs Actual Data</h2>
              <button onClick={() => { setUploadModal(false); setUploadFile(null); }} className="p-2" style={{ color: colors.muted }}>
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 space-y-4">
              <p className="text-sm" style={{ color: colors.muted }}>
                Expected: Account, Department, Budget, Actual (or period columns). Template available below.
              </p>
              <div
                className="border-2 border-dashed rounded-lg p-6 text-center cursor-pointer"
                style={{ borderColor: colors.border }}
                onClick={() => document.getElementById('fpa-var-file')?.click()}
              >
                <input
                  id="fpa-var-file"
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="hidden"
                  onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
                />
                <FileSpreadsheet className="w-10 h-10 mx-auto mb-2" style={{ color: colors.muted }} />
                <p className="text-sm" style={{ color: colors.text }}>Drag & drop or click to browse</p>
                {uploadFile && <p className="text-xs mt-2" style={{ color: colors.favorable }}>{uploadFile.name}</p>}
              </div>
              <button onClick={downloadTemplate} className="text-sm flex items-center gap-2" style={{ color: colors.actualBar }}>
                <Download className="w-4 h-4" /> Download Excel Template
              </button>
            </div>
            <div className="flex justify-end gap-2 p-4 border-t" style={{ borderColor: colors.border }}>
              <button onClick={() => { setUploadModal(false); setUploadFile(null); }} className="px-4 py-2 rounded-lg border" style={{ borderColor: colors.border, color: colors.text }}>Cancel</button>
              <button onClick={handleUpload} disabled={!uploadFile || uploading} className="px-4 py-2 rounded-lg font-medium flex items-center gap-2 disabled:opacity-50" style={{ background: colors.budgetBar, color: '#fff' }}>
                {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                {uploading ? 'Uploading...' : 'Upload & Analyze'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
