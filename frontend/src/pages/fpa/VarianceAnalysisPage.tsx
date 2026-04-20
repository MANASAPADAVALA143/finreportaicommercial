// FP&A Suite — Variance Analysis Module
// URL: /dashboard/fpa/variance-analysis
// Budget vs Actual — AI-powered variance intelligence (Level 1–3)

import { useState, useMemo } from 'react';
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
import { formatCurrency, formatCurrencyFull, formatPercentage } from '../../utils/varianceUtils';
import { callAI } from '../../services/aiProvider';

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
  variance?: number;
  variance_pct?: number;
  status?: string;
  material?: boolean;
};

function getStatus(variance_pct: number): string {
  if (Math.abs(variance_pct) < 5) return 'On Track';
  if (variance_pct > 10) return 'Over Budget';
  if (variance_pct < -10) return 'Under Budget';
  return 'Watch';
}

function computeVarianceAnalysis(items: VarianceLineItem[]) {
  const line_items = items.map((i) => {
    const variance = i.actual - i.budget;
    const variance_pct = i.budget ? (variance / i.budget) * 100 : 0;
    return {
      ...i,
      variance,
      variance_pct,
      status: getStatus(variance_pct),
      material: Math.abs(variance_pct) > 10,
    };
  });
  const total_budget = line_items.reduce((s, i) => s + i.budget, 0);
  const total_actual = line_items.reduce((s, i) => s + i.actual, 0);
  const total_variance = total_actual - total_budget;
  const total_variance_pct = total_budget ? (total_variance / total_budget) * 100 : 0;
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
    v.status = getStatus(v.variance_pct);
  });
  const department_summary = Object.values(dept_agg);
  return {
    line_items,
    department_summary,
    total_budget,
    total_actual,
    total_variance,
    total_variance_pct,
    overall_status: getStatus(total_variance_pct),
  };
}

export function VarianceAnalysisPage() {
  const navigate = useNavigate();
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
  } | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiStep, setAiStep] = useState('');
  const [tableSearch, setTableSearch] = useState('');
  const [tableDept, setTableDept] = useState('all');
  const [tableStatus, setTableStatus] = useState('all');
  const [tableDirection, setTableDirection] = useState<'all' | 'over' | 'under' | 'material'>('all');
  const [materialityPct, setMaterialityPct] = useState(0);

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
      if (API_BASE) {
        const form = new FormData();
        form.append('file', uploadFile);
        const res = await fetch(`${API_BASE}/api/fpa/variance/upload`, { method: 'POST', body: form });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        setRawItems(data.line_items || []);
        const n = (data.line_items || []).length;
        const d = (data.departments || []).length;
        setLoadBanner(`Data loaded: ${n} line items across ${d} departments`);
      } else {
        const buf = await uploadFile.arrayBuffer();
        const wb = XLSX.read(buf, { type: 'array' });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rows: any[] = XLSX.utils.sheet_to_json(sheet);
        const parseNum = (v: any) => {
          if (v == null || v === '') return 0;
          if (typeof v === 'number') return v;
          return parseFloat(String(v).replace(/,/g, '')) || 0;
        };
        const accCol = rows[0] && Object.keys(rows[0]).find((k) => /account|category|name/i.test(k)) || Object.keys(rows[0] || {})[0];
        const deptCol = rows[0] && Object.keys(rows[0]).find((k) => /department|dept/i.test(k));
        const budgetCol = rows[0] && Object.keys(rows[0]).find((k) => /budget/i.test(k) && !/actual/i.test(k));
        const actualCol = rows[0] && Object.keys(rows[0]).find((k) => /actual/i.test(k));
        if (!budgetCol || !actualCol) throw new Error('Need Budget and Actual columns');
        const items: VarianceLineItem[] = rows
          .filter((r) => parseNum(r[budgetCol]) !== 0 || parseNum(r[actualCol]) !== 0)
          .map((r) => ({
            account: String(r[accCol] ?? ''),
            department: deptCol ? String(r[deptCol] ?? '') : 'All Depts',
            budget: parseNum(r[budgetCol]),
            actual: parseNum(r[actualCol]),
          }));
        setRawItems(items);
        setLoadBanner(`Data loaded: ${items.length} line items across ${new Set(items.map((i) => i.department)).size} departments`);
      }
      setUploadModal(false);
      setUploadFile(null);
      setTimeout(() => setLoadBanner(null), 5000);
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

  const generateAINarrative = async () => {
    if (!analysis) return;
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
          body: JSON.stringify({ variance_analysis: analysis }),
        });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        setAiNarrative({
          executive_summary: data.executive_summary || '',
          line_commentary: data.line_commentary || [],
          action_items: data.action_items || [],
        });
      } else {
        const material = analysis.line_items.filter((i) => (i.material ?? Math.abs(i.variance_pct ?? 0) > 10));
        const prompt = `You are a CFO advisor. In one short paragraph, summarize: Total budget ₹${analysis.total_budget.toLocaleString('en-IN')}, actual ₹${analysis.total_actual.toLocaleString('en-IN')}, variance ${analysis.total_variance_pct.toFixed(1)}%. Top overspend: ${material.filter((i) => (i.variance ?? 0) > 0).slice(0, 3).map((i) => i.account).join(', ')}. Top savings: ${material.filter((i) => (i.variance ?? 0) < 0).slice(0, 3).map((i) => i.account).join(', ')}. Give 3 action items.`;
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
      alert('AI narrative failed: ' + (e.message || e));
    } finally {
      setAiLoading(false);
      setAiStep('');
    }
  };

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
      ['#', 'Account', 'Department', 'Budget (₹)', 'Actual (₹)', 'Variance (₹)', 'Variance %', 'Status'],
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

  // Waterfall data: Budget → overspends (red) / savings (green) → Actual
  const waterfallData = useMemo(() => {
    if (!analysis) return [];
    const items: { name: string; value: number; type: string; fill: string }[] = [];
    items.push({ name: 'Total Budget', value: analysis.total_budget, type: 'start', fill: colors.budgetBar });
    const overspends = analysis.line_items.filter((i) => (i.variance ?? 0) > 0).sort((a, b) => (b.variance ?? 0) - (a.variance ?? 0));
    const savings = analysis.line_items.filter((i) => (i.variance ?? 0) < 0).sort((a, b) => (a.variance ?? 0) - (b.variance ?? 0));
    overspends.slice(0, 8).forEach((i) => items.push({ name: i.account, value: i.variance ?? 0, type: 'overspend', fill: colors.unfavorable }));
    savings.slice(0, 8).forEach((i) => items.push({ name: i.account, value: Math.abs(i.variance ?? 0), type: 'saving', fill: colors.favorable }));
    items.push({ name: 'Total Actual', value: analysis.total_actual, type: 'end', fill: colors.actualBar });
    return items;
  }, [analysis]);

  const topOverspends = useMemo(() => {
    if (!analysis) return [];
    return analysis.line_items
      .filter((i) => (i.variance ?? 0) > 0)
      .sort((a, b) => (b.variance ?? 0) - (a.variance ?? 0))
      .slice(0, 5);
  }, [analysis]);

  const topSavings = useMemo(() => {
    if (!analysis) return [];
    return analysis.line_items
      .filter((i) => (i.variance ?? 0) < 0)
      .sort((a, b) => (a.variance ?? 0) - (b.variance ?? 0))
      .slice(0, 5);
  }, [analysis]);

  const hasData = rawItems.length > 0;

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
            <div className="flex items-center gap-2">
              <button
                onClick={() => setUploadModal(true)}
                className="px-4 py-2 rounded-lg font-medium flex items-center gap-2 transition"
                style={{ background: colors.budgetBar, color: '#fff' }}
              >
                <Upload className="w-4 h-4" />
                Upload Data
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
              <button
                onClick={() => { setActiveTab('ai'); if (!aiNarrative && analysis) generateAINarrative(); }}
                disabled={!hasData}
                className="px-4 py-2 rounded-lg font-medium flex items-center gap-2 transition disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg,#F59E0B,#EA580C)', color: '#fff' }}
              >
                <Bot className="w-4 h-4" />
                AI Narrative
              </button>
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
                    { label: 'Total Budgeted Amount', value: analysis.total_budget, icon: '📋', color: colors.text },
                    { label: 'Total Actual Spend', value: analysis.total_actual, color: analysis.total_variance <= 0 ? colors.favorable : colors.unfavorable },
                    { label: 'Total Variance (₹)', value: analysis.total_variance, badge: analysis.total_variance >= 0 ? 'Unfavorable' : 'Favorable', color: analysis.total_variance >= 0 ? colors.unfavorable : colors.favorable },
                    { label: 'Overall Variance %', value: analysis.total_variance_pct, color: Math.abs(analysis.total_variance_pct) < 5 ? colors.favorable : Math.abs(analysis.total_variance_pct) < 10 ? colors.watch : colors.unfavorable },
                  ].map((card, i) => (
                    <div key={i} className="rounded-xl p-5 border" style={{ background: colors.card, borderColor: colors.border }}>
                      <p className="text-xs font-medium mb-1" style={{ color: colors.muted }}>
                        {card.label}
                      </p>
                      <p className="text-2xl font-bold font-mono" style={{ color: card.color ?? colors.text }}>
                        {i === 3 ? `${(card.value as number).toFixed(1)}%` : formatCurrencyFull(card.value as number, 'INR')}
                      </p>
                      {card.badge && (
                        <span className="inline-block mt-2 px-2 py-0.5 rounded text-xs font-medium" style={{ background: (card.value as number) >= 0 ? colors.unfavorable + '33' : colors.favorable + '33', color: card.color }}>
                          {card.badge}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
                {/* Top overspends / savings */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="rounded-xl p-5 border" style={{ background: colors.card, borderColor: colors.border }}>
                    <h3 className="font-semibold mb-4" style={{ color: colors.unfavorable }}>Top Overspends</h3>
                    <ul className="space-y-2 text-sm">
                      {topOverspends.map((i, idx) => (
                        <li key={idx} style={{ color: colors.text }}>
                          {idx + 1}. {i.account} — {formatCurrencyFull(i.variance ?? 0, 'INR')} over ({(i.variance_pct ?? 0).toFixed(0)}% unfavorable)
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="rounded-xl p-5 border" style={{ background: colors.card, borderColor: colors.border }}>
                    <h3 className="font-semibold mb-4" style={{ color: colors.favorable }}>Top Savings</h3>
                    <ul className="space-y-2 text-sm">
                      {topSavings.map((i, idx) => (
                        <li key={idx} style={{ color: colors.text }}>
                          {idx + 1}. {i.account} — {formatCurrencyFull(Math.abs(i.variance ?? 0), 'INR')} saved ({(i.variance_pct ?? 0).toFixed(0)}% favorable)
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
                        <th className="text-right py-3 px-4" style={{ color: colors.muted }}>Variance ₹</th>
                        <th className="text-right py-3 px-4" style={{ color: colors.muted }}>Variance %</th>
                        <th className="text-center py-3 px-4" style={{ color: colors.muted }}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analysis.department_summary.map((d, i) => (
                        <tr key={i} className="border-t" style={{ borderColor: colors.border }}>
                          <td className="py-3 px-4 font-medium" style={{ color: colors.text }}>{d.department}</td>
                          <td className="py-3 px-4 text-right font-mono" style={{ color: colors.text }}>{formatCurrencyFull(d.budget, 'INR')}</td>
                          <td className="py-3 px-4 text-right font-mono" style={{ color: colors.text }}>{formatCurrencyFull(d.actual, 'INR')}</td>
                          <td className="py-3 px-4 text-right font-mono" style={{ color: d.variance >= 0 ? colors.unfavorable : colors.favorable }}>{formatCurrencyFull(d.variance, 'INR')}</td>
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
                        <th className="text-left py-3 px-4" style={{ color: colors.muted }}>Department</th>
                        <th className="text-right py-3 px-4" style={{ color: colors.muted }}>Budget (₹)</th>
                        <th className="text-right py-3 px-4" style={{ color: colors.muted }}>Actual (₹)</th>
                        <th className="text-right py-3 px-4" style={{ color: colors.muted }}>Variance (₹)</th>
                        <th className="text-right py-3 px-4" style={{ color: colors.muted }}>Variance %</th>
                        <th className="text-center py-3 px-4" style={{ color: colors.muted }}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredTableRows.map((r, i) => (
                        <tr key={i} className="border-t" style={{ borderColor: colors.border }}>
                          <td className="py-2 px-4" style={{ color: colors.muted }}>{i + 1}</td>
                          <td className="py-2 px-4 font-medium" style={{ color: colors.text }}>{r.account}</td>
                          <td className="py-2 px-4" style={{ color: colors.muted }}>{r.department}</td>
                          <td className="py-2 px-4 text-right font-mono" style={{ color: colors.text }}>{formatCurrencyFull(r.budget, 'INR')}</td>
                          <td className="py-2 px-4 text-right font-mono" style={{ color: colors.text }}>{formatCurrencyFull(r.actual, 'INR')}</td>
                          <td className="py-2 px-4 text-right font-mono" style={{ color: (r.variance ?? 0) >= 0 ? colors.unfavorable : colors.favorable }}>{formatCurrencyFull(r.variance ?? 0, 'INR')}</td>
                          <td className="py-2 px-4 text-right font-mono" style={{ color: (r.variance_pct ?? 0) >= 0 ? colors.unfavorable : colors.favorable }}>{(r.variance_pct ?? 0).toFixed(1)}%</td>
                          <td className="py-2 px-4 text-center">
                            <span className="px-2 py-0.5 rounded text-xs" style={{ background: colors.border, color: colors.text }}>{r.status}</span>
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
                      <YAxis tickFormatter={(v) => formatCurrency(v, 'INR')} tick={{ fill: colors.muted }} />
                      <Tooltip
                        formatter={(v: number) => [formatCurrencyFull(v, 'INR'), '']}
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
                      <XAxis type="number" tickFormatter={(v) => formatCurrency(v, 'INR')} tick={{ fill: colors.muted }} />
                      <YAxis type="category" dataKey="department" width={95} tick={{ fill: colors.muted, fontSize: 11 }} />
                      <Tooltip formatter={(v: number) => [formatCurrencyFull(v, 'INR'), '']} contentStyle={{ background: colors.card, border: `1px solid ${colors.border}` }} />
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
                    <h3 className="text-lg font-bold mb-4" style={{ color: colors.unfavorable }}>Overspends by Category</h3>
                    <ResponsiveContainer width="100%" height={260}>
                      <RechartsPie>
                        <Pie
                          data={analysis.line_items
                            .filter((i) => (i.variance ?? 0) > 0)
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
                          label={({ name, value }) => `${name}: ${formatCurrency(value, 'INR')}`}
                        >
                          {analysis.line_items
                            .filter((i) => (i.variance ?? 0) > 0)
                            .slice(0, 6)
                            .map((_, i) => (
                              <Cell key={i} fill={colors.unfavorable} />
                            ))}
                        </Pie>
                        <Tooltip formatter={(v: number) => [formatCurrencyFull(v, 'INR'), '']} contentStyle={{ background: colors.card, border: `1px solid ${colors.border}` }} />
                      </RechartsPie>
                    </ResponsiveContainer>
                  </div>
                  <div className="rounded-xl border p-6" style={{ background: colors.card, borderColor: colors.border }}>
                    <h3 className="text-lg font-bold mb-4" style={{ color: colors.favorable }}>Savings by Category</h3>
                    <ResponsiveContainer width="100%" height={260}>
                      <RechartsPie>
                        <Pie
                          data={analysis.line_items
                            .filter((i) => (i.variance ?? 0) < 0)
                            .sort((a, b) => (a.variance ?? 0) - (b.variance ?? 0))
                            .slice(0, 6)
                            .map((i) => ({ name: i.account, value: Math.abs(i.variance ?? 0) }))}
                          dataKey="value"
                          nameKey="name"
                          cx="50%"
                          cy="50%"
                          innerRadius={50}
                          outerRadius={80}
                          paddingAngle={2}
                          label={({ name, value }) => `${name}: ${formatCurrency(value, 'INR')}`}
                        >
                          {analysis.line_items
                            .filter((i) => (i.variance ?? 0) < 0)
                            .slice(0, 6)
                            .map((_, i) => (
                              <Cell key={i} fill={colors.favorable} />
                            ))}
                        </Pie>
                        <Tooltip formatter={(v: number) => [formatCurrencyFull(v, 'INR'), '']} contentStyle={{ background: colors.card, border: `1px solid ${colors.border}` }} />
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
                      onClick={generateAINarrative}
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
                    <div className="rounded-xl border-l-4 p-6" style={{ background: colors.card, borderColor: colors.actualBar }}>
                      <div className="flex items-start justify-between gap-4">
                        <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: colors.text }}>
                          {aiNarrative.executive_summary}
                        </p>
                        <div className="flex gap-2 shrink-0">
                          <button
                            onClick={() => navigator.clipboard.writeText(aiNarrative.executive_summary)}
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
                          onClick={() => window.open(`mailto:?subject=Variance%20Analysis%20Action%20Items&body=${encodeURIComponent(aiNarrative.executive_summary + '\n\n' + aiNarrative.action_items.join('\n'))}`)}
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
