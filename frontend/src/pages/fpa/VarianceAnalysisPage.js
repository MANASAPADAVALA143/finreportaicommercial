import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
// FP&A Suite — Variance Analysis Module
// URL: /dashboard/fpa/variance-analysis
// Budget vs Actual — AI-powered variance intelligence (Level 1–3)
import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Upload, Download, Bot, BarChart3, Table2, PieChart, Sparkles, X, FileSpreadsheet, Loader2, Copy, Mail, } from 'lucide-react';
import * as XLSX from 'xlsx';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, Cell, ResponsiveContainer, PieChart as RechartsPie, Pie, } from 'recharts';
import { formatCurrency, formatCurrencyFull } from '../../utils/varianceUtils';
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
function getStatus(variance_pct) {
    if (Math.abs(variance_pct) < 5)
        return 'On Track';
    if (variance_pct > 10)
        return 'Over Budget';
    if (variance_pct < -10)
        return 'Under Budget';
    return 'Watch';
}
function computeVarianceAnalysis(items) {
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
    const dept_agg = {};
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
    const [rawItems, setRawItems] = useState([]);
    const [activeTab, setActiveTab] = useState('overview');
    const [uploadModal, setUploadModal] = useState(false);
    const [uploadFile, setUploadFile] = useState(null);
    const [uploading, setUploading] = useState(false);
    const [loadBanner, setLoadBanner] = useState(null);
    const [aiNarrative, setAiNarrative] = useState(null);
    const [aiLoading, setAiLoading] = useState(false);
    const [aiStep, setAiStep] = useState('');
    const [tableSearch, setTableSearch] = useState('');
    const [tableDept, setTableDept] = useState('all');
    const [tableStatus, setTableStatus] = useState('all');
    const [tableDirection, setTableDirection] = useState('all');
    const [materialityPct, setMaterialityPct] = useState(0);
    const analysis = useMemo(() => (rawItems.length ? computeVarianceAnalysis(rawItems) : null), [rawItems]);
    const loadSampleData = () => {
        setRawItems(SAMPLE_VARIANCE_DATA.map((i) => ({ ...i })));
        setLoadBanner(`Data loaded: ${SAMPLE_VARIANCE_DATA.length} line items across ${new Set(SAMPLE_VARIANCE_DATA.map((i) => i.department)).size} departments`);
        setTimeout(() => setLoadBanner(null), 5000);
    };
    const handleUpload = async () => {
        if (!uploadFile)
            return;
        setUploading(true);
        try {
            if (API_BASE) {
                const form = new FormData();
                form.append('file', uploadFile);
                const res = await fetch(`${API_BASE}/api/fpa/variance/upload`, { method: 'POST', body: form });
                if (!res.ok)
                    throw new Error(await res.text());
                const data = await res.json();
                setRawItems(data.line_items || []);
                const n = (data.line_items || []).length;
                const d = (data.departments || []).length;
                setLoadBanner(`Data loaded: ${n} line items across ${d} departments`);
            }
            else {
                const buf = await uploadFile.arrayBuffer();
                const wb = XLSX.read(buf, { type: 'array' });
                const sheet = wb.Sheets[wb.SheetNames[0]];
                const rows = XLSX.utils.sheet_to_json(sheet);
                const parseNum = (v) => {
                    if (v == null || v === '')
                        return 0;
                    if (typeof v === 'number')
                        return v;
                    return parseFloat(String(v).replace(/,/g, '')) || 0;
                };
                const accCol = rows[0] && Object.keys(rows[0]).find((k) => /account|category|name/i.test(k)) || Object.keys(rows[0] || {})[0];
                const deptCol = rows[0] && Object.keys(rows[0]).find((k) => /department|dept/i.test(k));
                const budgetCol = rows[0] && Object.keys(rows[0]).find((k) => /budget/i.test(k) && !/actual/i.test(k));
                const actualCol = rows[0] && Object.keys(rows[0]).find((k) => /actual/i.test(k));
                if (!budgetCol || !actualCol)
                    throw new Error('Need Budget and Actual columns');
                const items = rows
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
        }
        catch (e) {
            alert('Upload failed: ' + (e.message || e));
        }
        finally {
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
        }
        else {
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
        if (!analysis)
            return;
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
                if (!res.ok)
                    throw new Error(await res.text());
                const data = await res.json();
                setAiNarrative({
                    executive_summary: data.executive_summary || '',
                    line_commentary: data.line_commentary || [],
                    action_items: data.action_items || [],
                });
            }
            else {
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
        }
        catch (e) {
            alert('AI narrative failed: ' + (e.message || e));
        }
        finally {
            setAiLoading(false);
            setAiStep('');
        }
    };
    const downloadReport = async () => {
        if (!analysis)
            return;
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
        }
        else {
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
        if (!analysis)
            return [];
        let rows = analysis.line_items;
        if (tableSearch) {
            const q = tableSearch.toLowerCase();
            rows = rows.filter((r) => r.account.toLowerCase().includes(q) || r.department.toLowerCase().includes(q));
        }
        if (tableDept !== 'all')
            rows = rows.filter((r) => r.department === tableDept);
        if (tableStatus !== 'all')
            rows = rows.filter((r) => r.status === tableStatus);
        if (tableDirection === 'over')
            rows = rows.filter((r) => (r.variance ?? 0) > 0);
        if (tableDirection === 'under')
            rows = rows.filter((r) => (r.variance ?? 0) < 0);
        if (tableDirection === 'material')
            rows = rows.filter((r) => r.material);
        if (materialityPct > 0)
            rows = rows.filter((r) => Math.abs(r.variance_pct ?? 0) >= materialityPct);
        return rows;
    }, [analysis, tableSearch, tableDept, tableStatus, tableDirection, materialityPct]);
    const exportTableExcel = () => {
        if (!analysis)
            return;
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
        if (!analysis)
            return [];
        const items = [];
        items.push({ name: 'Total Budget', value: analysis.total_budget, type: 'start', fill: colors.budgetBar });
        const overspends = analysis.line_items.filter((i) => (i.variance ?? 0) > 0).sort((a, b) => (b.variance ?? 0) - (a.variance ?? 0));
        const savings = analysis.line_items.filter((i) => (i.variance ?? 0) < 0).sort((a, b) => (a.variance ?? 0) - (b.variance ?? 0));
        overspends.slice(0, 8).forEach((i) => items.push({ name: i.account, value: i.variance ?? 0, type: 'overspend', fill: colors.unfavorable }));
        savings.slice(0, 8).forEach((i) => items.push({ name: i.account, value: Math.abs(i.variance ?? 0), type: 'saving', fill: colors.favorable }));
        items.push({ name: 'Total Actual', value: analysis.total_actual, type: 'end', fill: colors.actualBar });
        return items;
    }, [analysis]);
    const topOverspends = useMemo(() => {
        if (!analysis)
            return [];
        return analysis.line_items
            .filter((i) => (i.variance ?? 0) > 0)
            .sort((a, b) => (b.variance ?? 0) - (a.variance ?? 0))
            .slice(0, 5);
    }, [analysis]);
    const topSavings = useMemo(() => {
        if (!analysis)
            return [];
        return analysis.line_items
            .filter((i) => (i.variance ?? 0) < 0)
            .sort((a, b) => (a.variance ?? 0) - (b.variance ?? 0))
            .slice(0, 5);
    }, [analysis]);
    const hasData = rawItems.length > 0;
    return (_jsxs("div", { className: "min-h-screen", style: { background: colors.bg }, children: [_jsx("header", { className: "border-b sticky top-0 z-40", style: { borderColor: colors.border, background: colors.card }, children: _jsxs("div", { className: "max-w-[1600px] mx-auto px-6 py-4", children: [_jsxs("div", { className: "flex flex-wrap items-center justify-between gap-4", children: [_jsxs("div", { className: "flex items-center gap-4", children: [_jsx("button", { onClick: () => navigate('/fpa'), className: "p-2 rounded-lg transition hover:opacity-90", style: { color: colors.text }, children: _jsx(ArrowLeft, { className: "w-5 h-5" }) }), _jsxs("div", { children: [_jsx("h1", { className: "text-2xl font-bold", style: { color: colors.text }, children: "Variance Analysis" }), _jsx("p", { className: "text-sm", style: { color: colors.muted }, children: "Budget vs Actual \u2014 AI-powered variance intelligence" })] })] }), _jsxs("div", { className: "flex items-center gap-2", children: [_jsxs("button", { onClick: () => setUploadModal(true), className: "px-4 py-2 rounded-lg font-medium flex items-center gap-2 transition", style: { background: colors.budgetBar, color: '#fff' }, children: [_jsx(Upload, { className: "w-4 h-4" }), "Upload Data"] }), _jsxs("button", { onClick: downloadReport, disabled: !hasData, className: "px-4 py-2 rounded-lg font-medium flex items-center gap-2 border transition disabled:opacity-50", style: { borderColor: colors.border, color: colors.text }, children: [_jsx(Download, { className: "w-4 h-4" }), "Download Report"] }), _jsxs("button", { onClick: () => { setActiveTab('ai'); if (!aiNarrative && analysis)
                                                generateAINarrative(); }, disabled: !hasData, className: "px-4 py-2 rounded-lg font-medium flex items-center gap-2 transition disabled:opacity-50", style: { background: 'linear-gradient(135deg,#F59E0B,#EA580C)', color: '#fff' }, children: [_jsx(Bot, { className: "w-4 h-4" }), "AI Narrative"] })] })] }), _jsx("p", { className: "text-xs mt-2", style: { color: colors.muted }, children: "FP&A Suite > Variance Analysis" }), hasData && (_jsx("div", { className: "flex gap-1 mt-4 border-b", style: { borderColor: colors.border }, children: [
                                { id: 'overview', label: 'Overview', icon: BarChart3 },
                                { id: 'table', label: 'Detail Table', icon: Table2 },
                                { id: 'charts', label: 'Charts', icon: PieChart },
                                { id: 'ai', label: 'AI Insights', icon: Sparkles },
                            ].map(({ id, label, icon: Icon }) => (_jsxs("button", { onClick: () => setActiveTab(id), className: "px-4 py-2.5 text-sm font-medium rounded-t-lg flex items-center gap-2 transition", style: {
                                    background: activeTab === id ? colors.card : 'transparent',
                                    color: activeTab === id ? colors.text : colors.muted,
                                    borderBottom: activeTab === id ? `2px solid ${colors.actualBar}` : '2px solid transparent',
                                }, children: [_jsx(Icon, { className: "w-4 h-4" }), label] }, id))) }))] }) }), loadBanner && (_jsx("div", { className: "max-w-[1600px] mx-auto px-6 py-2", children: _jsxs("div", { className: "rounded-lg px-4 py-2 flex items-center gap-2", style: { background: colors.favorable + '22', color: colors.favorable }, children: ["\u2705 ", loadBanner] }) })), _jsx("main", { className: "max-w-[1600px] mx-auto px-6 py-8", children: !hasData ? (
                /* Upload section when no data */
                _jsxs("div", { className: "max-w-2xl mx-auto rounded-xl border-2 border-dashed p-10 text-center", style: { borderColor: colors.border, background: colors.card }, children: [_jsx("h2", { className: "text-xl font-bold mb-2", style: { color: colors.text }, children: "\uD83D\uDCCA Upload Budget vs Actual Data" }), _jsx("p", { className: "text-sm mb-6", style: { color: colors.muted }, children: "Supports Excel (.xlsx) or CSV" }), _jsxs("div", { className: "grid grid-cols-1 md:grid-cols-2 gap-6 text-left", children: [_jsxs("div", { className: "rounded-lg p-6 border", style: { borderColor: colors.border, background: colors.bg }, children: [_jsx("p", { className: "font-medium mb-2", style: { color: colors.text }, children: "Upload a file with Budget and Actual columns" }), _jsx("p", { className: "text-xs mb-4", style: { color: colors.muted }, children: "Drag & drop or click to browse. Format A: Account, Department, Budget, Actual. Format B: Jan_Budget, Jan_Actual, ..." }), _jsxs("button", { onClick: () => setUploadModal(true), className: "w-full py-3 rounded-lg border flex items-center justify-center gap-2", style: { borderColor: colors.border, color: colors.text }, children: [_jsx(Upload, { className: "w-5 h-5" }), "Choose File"] })] }), _jsxs("div", { className: "rounded-lg p-6 border", style: { borderColor: colors.border, background: colors.bg }, children: [_jsx("p", { className: "font-medium mb-2", style: { color: colors.text }, children: "Try with our demo dataset" }), _jsx("p", { className: "text-xs mb-4", style: { color: colors.muted }, children: "Loads built-in CFO demo data instantly (24 line items, 6 departments)." }), _jsx("button", { onClick: loadSampleData, className: "w-full py-3 rounded-lg font-medium flex items-center justify-center gap-2", style: { background: colors.favorable, color: '#fff' }, children: "Load Sample Data" })] })] }), _jsx("div", { className: "mt-6", children: _jsxs("button", { onClick: downloadTemplate, className: "text-sm flex items-center gap-2 mx-auto", style: { color: colors.actualBar }, children: [_jsx(Download, { className: "w-4 h-4" }), "Download Excel Template"] }) })] })) : (_jsxs(_Fragment, { children: [activeTab === 'overview' && analysis && (_jsxs("div", { className: "space-y-6", children: [_jsx("div", { className: "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4", children: [
                                        { label: 'Total Budgeted Amount', value: analysis.total_budget, icon: '📋', color: colors.text },
                                        { label: 'Total Actual Spend', value: analysis.total_actual, color: analysis.total_variance <= 0 ? colors.favorable : colors.unfavorable },
                                        { label: 'Total Variance (₹)', value: analysis.total_variance, badge: analysis.total_variance >= 0 ? 'Unfavorable' : 'Favorable', color: analysis.total_variance >= 0 ? colors.unfavorable : colors.favorable },
                                        { label: 'Overall Variance %', value: analysis.total_variance_pct, color: Math.abs(analysis.total_variance_pct) < 5 ? colors.favorable : Math.abs(analysis.total_variance_pct) < 10 ? colors.watch : colors.unfavorable },
                                    ].map((card, i) => (_jsxs("div", { className: "rounded-xl p-5 border", style: { background: colors.card, borderColor: colors.border }, children: [_jsx("p", { className: "text-xs font-medium mb-1", style: { color: colors.muted }, children: card.label }), _jsx("p", { className: "text-2xl font-bold font-mono", style: { color: card.color ?? colors.text }, children: i === 3 ? `${card.value.toFixed(1)}%` : formatCurrencyFull(card.value, 'INR') }), card.badge && (_jsx("span", { className: "inline-block mt-2 px-2 py-0.5 rounded text-xs font-medium", style: { background: card.value >= 0 ? colors.unfavorable + '33' : colors.favorable + '33', color: card.color }, children: card.badge }))] }, i))) }), _jsxs("div", { className: "grid grid-cols-1 md:grid-cols-2 gap-6", children: [_jsxs("div", { className: "rounded-xl p-5 border", style: { background: colors.card, borderColor: colors.border }, children: [_jsx("h3", { className: "font-semibold mb-4", style: { color: colors.unfavorable }, children: "Top Overspends" }), _jsx("ul", { className: "space-y-2 text-sm", children: topOverspends.map((i, idx) => (_jsxs("li", { style: { color: colors.text }, children: [idx + 1, ". ", i.account, " \u2014 ", formatCurrencyFull(i.variance ?? 0, 'INR'), " over (", (i.variance_pct ?? 0).toFixed(0), "% unfavorable)"] }, idx))) })] }), _jsxs("div", { className: "rounded-xl p-5 border", style: { background: colors.card, borderColor: colors.border }, children: [_jsx("h3", { className: "font-semibold mb-4", style: { color: colors.favorable }, children: "Top Savings" }), _jsx("ul", { className: "space-y-2 text-sm", children: topSavings.map((i, idx) => (_jsxs("li", { style: { color: colors.text }, children: [idx + 1, ". ", i.account, " \u2014 ", formatCurrencyFull(Math.abs(i.variance ?? 0), 'INR'), " saved (", (i.variance_pct ?? 0).toFixed(0), "% favorable)"] }, idx))) })] })] }), _jsx("div", { className: "rounded-xl border overflow-hidden", style: { background: colors.card, borderColor: colors.border }, children: _jsxs("table", { className: "w-full text-sm", children: [_jsx("thead", { children: _jsxs("tr", { style: { background: colors.bg }, children: [_jsx("th", { className: "text-left py-3 px-4", style: { color: colors.muted }, children: "Department" }), _jsx("th", { className: "text-right py-3 px-4", style: { color: colors.muted }, children: "Budget" }), _jsx("th", { className: "text-right py-3 px-4", style: { color: colors.muted }, children: "Actual" }), _jsx("th", { className: "text-right py-3 px-4", style: { color: colors.muted }, children: "Variance \u20B9" }), _jsx("th", { className: "text-right py-3 px-4", style: { color: colors.muted }, children: "Variance %" }), _jsx("th", { className: "text-center py-3 px-4", style: { color: colors.muted }, children: "Status" })] }) }), _jsx("tbody", { children: analysis.department_summary.map((d, i) => (_jsxs("tr", { className: "border-t", style: { borderColor: colors.border }, children: [_jsx("td", { className: "py-3 px-4 font-medium", style: { color: colors.text }, children: d.department }), _jsx("td", { className: "py-3 px-4 text-right font-mono", style: { color: colors.text }, children: formatCurrencyFull(d.budget, 'INR') }), _jsx("td", { className: "py-3 px-4 text-right font-mono", style: { color: colors.text }, children: formatCurrencyFull(d.actual, 'INR') }), _jsx("td", { className: "py-3 px-4 text-right font-mono", style: { color: d.variance >= 0 ? colors.unfavorable : colors.favorable }, children: formatCurrencyFull(d.variance, 'INR') }), _jsxs("td", { className: "py-3 px-4 text-right font-mono", style: { color: d.variance_pct >= 0 ? colors.unfavorable : colors.favorable }, children: [d.variance_pct.toFixed(1), "%"] }), _jsx("td", { className: "py-3 px-4 text-center", children: _jsx("span", { className: "px-2 py-1 rounded-full text-xs font-medium", style: {
                                                                    background: d.status === 'On Track' ? colors.favorable + '33' : d.status === 'Watch' ? colors.watch + '33' : d.status === 'Over Budget' ? colors.unfavorable + '33' : colors.budgetBar + '33',
                                                                    color: colors.text,
                                                                }, children: d.status }) })] }, i))) })] }) })] })), activeTab === 'table' && analysis && (_jsxs("div", { className: "space-y-4", children: [_jsxs("div", { className: "flex flex-wrap gap-3 items-center", children: [_jsx("input", { type: "text", placeholder: "Search account name...", value: tableSearch, onChange: (e) => setTableSearch(e.target.value), className: "px-3 py-2 rounded-lg border w-48 text-sm", style: { background: colors.card, borderColor: colors.border, color: colors.text } }), _jsxs("select", { value: tableDept, onChange: (e) => setTableDept(e.target.value), className: "px-3 py-2 rounded-lg border text-sm", style: { background: colors.card, borderColor: colors.border, color: colors.text }, children: [_jsx("option", { value: "all", children: "All Departments" }), analysis.department_summary.map((d) => (_jsx("option", { value: d.department, children: d.department }, d.department)))] }), _jsxs("select", { value: tableStatus, onChange: (e) => setTableStatus(e.target.value), className: "px-3 py-2 rounded-lg border text-sm", style: { background: colors.card, borderColor: colors.border, color: colors.text }, children: [_jsx("option", { value: "all", children: "All Status" }), _jsx("option", { value: "On Track", children: "On Track" }), _jsx("option", { value: "Watch", children: "Watch" }), _jsx("option", { value: "Over Budget", children: "Over Budget" }), _jsx("option", { value: "Under Budget", children: "Under Budget" })] }), _jsxs("select", { value: tableDirection, onChange: (e) => setTableDirection(e.target.value), className: "px-3 py-2 rounded-lg border text-sm", style: { background: colors.card, borderColor: colors.border, color: colors.text }, children: [_jsx("option", { value: "all", children: "All" }), _jsx("option", { value: "over", children: "Over Budget Only" }), _jsx("option", { value: "under", children: "Under Budget Only" }), _jsx("option", { value: "material", children: "Material (>10%)" })] }), _jsxs("label", { className: "flex items-center gap-2 text-sm", style: { color: colors.muted }, children: ["Materiality >", _jsx("input", { type: "range", min: 0, max: 20, value: materialityPct, onChange: (e) => setMaterialityPct(Number(e.target.value)), className: "w-24" }), materialityPct, "%"] }), _jsxs("button", { onClick: exportTableExcel, className: "ml-auto px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2", style: { background: colors.budgetBar, color: '#fff' }, children: [_jsx(Download, { className: "w-4 h-4" }), "Export to Excel"] })] }), _jsx("div", { className: "rounded-xl border overflow-x-auto", style: { background: colors.card, borderColor: colors.border }, children: _jsxs("table", { className: "w-full text-sm", children: [_jsx("thead", { children: _jsxs("tr", { style: { background: colors.bg }, children: [_jsx("th", { className: "text-left py-3 px-4", style: { color: colors.muted }, children: "#" }), _jsx("th", { className: "text-left py-3 px-4", style: { color: colors.muted }, children: "Account" }), _jsx("th", { className: "text-left py-3 px-4", style: { color: colors.muted }, children: "Department" }), _jsx("th", { className: "text-right py-3 px-4", style: { color: colors.muted }, children: "Budget (\u20B9)" }), _jsx("th", { className: "text-right py-3 px-4", style: { color: colors.muted }, children: "Actual (\u20B9)" }), _jsx("th", { className: "text-right py-3 px-4", style: { color: colors.muted }, children: "Variance (\u20B9)" }), _jsx("th", { className: "text-right py-3 px-4", style: { color: colors.muted }, children: "Variance %" }), _jsx("th", { className: "text-center py-3 px-4", style: { color: colors.muted }, children: "Status" })] }) }), _jsx("tbody", { children: filteredTableRows.map((r, i) => (_jsxs("tr", { className: "border-t", style: { borderColor: colors.border }, children: [_jsx("td", { className: "py-2 px-4", style: { color: colors.muted }, children: i + 1 }), _jsx("td", { className: "py-2 px-4 font-medium", style: { color: colors.text }, children: r.account }), _jsx("td", { className: "py-2 px-4", style: { color: colors.muted }, children: r.department }), _jsx("td", { className: "py-2 px-4 text-right font-mono", style: { color: colors.text }, children: formatCurrencyFull(r.budget, 'INR') }), _jsx("td", { className: "py-2 px-4 text-right font-mono", style: { color: colors.text }, children: formatCurrencyFull(r.actual, 'INR') }), _jsx("td", { className: "py-2 px-4 text-right font-mono", style: { color: (r.variance ?? 0) >= 0 ? colors.unfavorable : colors.favorable }, children: formatCurrencyFull(r.variance ?? 0, 'INR') }), _jsxs("td", { className: "py-2 px-4 text-right font-mono", style: { color: (r.variance_pct ?? 0) >= 0 ? colors.unfavorable : colors.favorable }, children: [(r.variance_pct ?? 0).toFixed(1), "%"] }), _jsx("td", { className: "py-2 px-4 text-center", children: _jsx("span", { className: "px-2 py-0.5 rounded text-xs", style: { background: colors.border, color: colors.text }, children: r.status }) })] }, i))) })] }) })] })), activeTab === 'charts' && analysis && (_jsxs("div", { className: "space-y-8", children: [_jsxs("div", { className: "rounded-xl border p-6", style: { background: colors.card, borderColor: colors.border }, children: [_jsx("h3", { className: "text-lg font-bold mb-4", style: { color: colors.text }, children: "Variance Waterfall: Budget \u2192 Actual" }), _jsx(ResponsiveContainer, { width: "100%", height: 380, children: _jsxs(BarChart, { data: waterfallData, margin: { top: 20, right: 20, left: 20, bottom: 80 }, children: [_jsx(CartesianGrid, { strokeDasharray: "3 3", stroke: colors.border }), _jsx(XAxis, { dataKey: "name", angle: -35, textAnchor: "end", height: 80, tick: { fill: colors.muted, fontSize: 11 } }), _jsx(YAxis, { tickFormatter: (v) => formatCurrency(v, 'INR'), tick: { fill: colors.muted } }), _jsx(Tooltip, { formatter: (v) => [formatCurrencyFull(v, 'INR'), ''], contentStyle: { background: colors.card, border: `1px solid ${colors.border}`, borderRadius: 8 }, labelStyle: { color: colors.text } }), _jsx(Bar, { dataKey: "value", name: "Amount", children: waterfallData.map((e, i) => (_jsx(Cell, { fill: e.fill }, i))) })] }) })] }), _jsxs("div", { className: "rounded-xl border p-6", style: { background: colors.card, borderColor: colors.border }, children: [_jsx("h3", { className: "text-lg font-bold mb-4", style: { color: colors.text }, children: "Budget vs Actual by Department" }), _jsx(ResponsiveContainer, { width: "100%", height: 320, children: _jsxs(BarChart, { data: analysis.department_summary, layout: "vertical", margin: { left: 100, right: 20 }, children: [_jsx(CartesianGrid, { strokeDasharray: "3 3", stroke: colors.border }), _jsx(XAxis, { type: "number", tickFormatter: (v) => formatCurrency(v, 'INR'), tick: { fill: colors.muted } }), _jsx(YAxis, { type: "category", dataKey: "department", width: 95, tick: { fill: colors.muted, fontSize: 11 } }), _jsx(Tooltip, { formatter: (v) => [formatCurrencyFull(v, 'INR'), ''], contentStyle: { background: colors.card, border: `1px solid ${colors.border}` } }), _jsx(Legend, {}), _jsx(Bar, { dataKey: "budget", name: "Budget", fill: colors.budgetBar, radius: [0, 4, 4, 0] }), _jsx(Bar, { dataKey: "actual", name: "Actual", fill: colors.actualBar, radius: [0, 4, 4, 0] })] }) })] }), _jsxs("div", { className: "rounded-xl border p-6", style: { background: colors.card, borderColor: colors.border }, children: [_jsx("h3", { className: "text-lg font-bold mb-4", style: { color: colors.text }, children: "Variance % by Department" }), _jsx(ResponsiveContainer, { width: "100%", height: 320, children: _jsxs(BarChart, { data: [...analysis.department_summary].sort((a, b) => (b.variance_pct ?? 0) - (a.variance_pct ?? 0)), layout: "vertical", margin: { left: 100 }, children: [_jsx(CartesianGrid, { strokeDasharray: "3 3", stroke: colors.border }), _jsx(XAxis, { type: "number", tickFormatter: (v) => `${v}%`, tick: { fill: colors.muted }, domain: ['auto', 'auto'] }), _jsx(YAxis, { type: "category", dataKey: "department", width: 95, tick: { fill: colors.muted } }), _jsx(Tooltip, { formatter: (v) => [`${v.toFixed(1)}%`, 'Variance %'], contentStyle: { background: colors.card, border: `1px solid ${colors.border}` } }), _jsx(Bar, { dataKey: "variance_pct", name: "Variance %", children: [...analysis.department_summary].sort((a, b) => (b.variance_pct ?? 0) - (a.variance_pct ?? 0)).map((d, i) => (_jsx(Cell, { fill: (d.variance_pct ?? 0) >= 0 ? colors.unfavorable : colors.favorable }, i))) })] }) })] }), _jsxs("div", { className: "grid grid-cols-1 md:grid-cols-2 gap-6", children: [_jsxs("div", { className: "rounded-xl border p-6", style: { background: colors.card, borderColor: colors.border }, children: [_jsx("h3", { className: "text-lg font-bold mb-4", style: { color: colors.unfavorable }, children: "Overspends by Category" }), _jsx(ResponsiveContainer, { width: "100%", height: 260, children: _jsxs(RechartsPie, { children: [_jsx(Pie, { data: analysis.line_items
                                                                    .filter((i) => (i.variance ?? 0) > 0)
                                                                    .sort((a, b) => (b.variance ?? 0) - (a.variance ?? 0))
                                                                    .slice(0, 6)
                                                                    .map((i) => ({ name: i.account, value: i.variance ?? 0 })), dataKey: "value", nameKey: "name", cx: "50%", cy: "50%", innerRadius: 50, outerRadius: 80, paddingAngle: 2, label: ({ name, value }) => `${name}: ${formatCurrency(value, 'INR')}`, children: analysis.line_items
                                                                    .filter((i) => (i.variance ?? 0) > 0)
                                                                    .slice(0, 6)
                                                                    .map((_, i) => (_jsx(Cell, { fill: colors.unfavorable }, i))) }), _jsx(Tooltip, { formatter: (v) => [formatCurrencyFull(v, 'INR'), ''], contentStyle: { background: colors.card, border: `1px solid ${colors.border}` } })] }) })] }), _jsxs("div", { className: "rounded-xl border p-6", style: { background: colors.card, borderColor: colors.border }, children: [_jsx("h3", { className: "text-lg font-bold mb-4", style: { color: colors.favorable }, children: "Savings by Category" }), _jsx(ResponsiveContainer, { width: "100%", height: 260, children: _jsxs(RechartsPie, { children: [_jsx(Pie, { data: analysis.line_items
                                                                    .filter((i) => (i.variance ?? 0) < 0)
                                                                    .sort((a, b) => (a.variance ?? 0) - (b.variance ?? 0))
                                                                    .slice(0, 6)
                                                                    .map((i) => ({ name: i.account, value: Math.abs(i.variance ?? 0) })), dataKey: "value", nameKey: "name", cx: "50%", cy: "50%", innerRadius: 50, outerRadius: 80, paddingAngle: 2, label: ({ name, value }) => `${name}: ${formatCurrency(value, 'INR')}`, children: analysis.line_items
                                                                    .filter((i) => (i.variance ?? 0) < 0)
                                                                    .slice(0, 6)
                                                                    .map((_, i) => (_jsx(Cell, { fill: colors.favorable }, i))) }), _jsx(Tooltip, { formatter: (v) => [formatCurrencyFull(v, 'INR'), ''], contentStyle: { background: colors.card, border: `1px solid ${colors.border}` } })] }) })] })] })] })), activeTab === 'ai' && (_jsxs("div", { className: "space-y-6", children: [!aiNarrative && !aiLoading && (_jsxs("div", { className: "rounded-xl border p-8 text-center", style: { background: colors.card, borderColor: colors.border }, children: [_jsx("p", { className: "mb-4", style: { color: colors.text }, children: "Generate CFO-ready narrative and line-by-line commentary powered by AI." }), _jsxs("button", { onClick: generateAINarrative, className: "px-6 py-3 rounded-lg font-medium flex items-center gap-2 mx-auto", style: { background: 'linear-gradient(135deg,#F59E0B,#EA580C)', color: '#fff' }, children: [_jsx(Sparkles, { className: "w-5 h-5" }), "Generate AI Variance Analysis"] }), _jsx("p", { className: "text-xs mt-2", style: { color: colors.muted }, children: "Powered by AWS Nova \u2014 takes 10\u201315 seconds" })] })), aiLoading && (_jsxs("div", { className: "rounded-xl border p-8", style: { background: colors.card, borderColor: colors.border }, children: [_jsxs("p", { className: "mb-4 flex items-center gap-2", style: { color: colors.text }, children: [_jsx(Loader2, { className: "w-5 h-5 animate-spin" }), "AI is analysing ", rawItems.length, " line items across ", analysis?.department_summary.length ?? 0, " departments..."] }), _jsxs("div", { className: "space-y-2 text-sm", style: { color: colors.muted }, children: [_jsx("p", { children: "\u2705 Data validated" }), _jsx("p", { children: "\u2705 Variances calculated" }), _jsx("p", { children: aiStep ? '🔄 ' + aiStep : '⏳ Generating narrative...' })] })] })), aiNarrative && !aiLoading && (_jsxs(_Fragment, { children: [_jsx("div", { className: "rounded-xl border-l-4 p-6", style: { background: colors.card, borderColor: colors.actualBar }, children: _jsxs("div", { className: "flex items-start justify-between gap-4", children: [_jsx("p", { className: "text-sm leading-relaxed whitespace-pre-wrap", style: { color: colors.text }, children: aiNarrative.executive_summary }), _jsx("div", { className: "flex gap-2 shrink-0", children: _jsx("button", { onClick: () => navigator.clipboard.writeText(aiNarrative.executive_summary), className: "p-2 rounded border", style: { borderColor: colors.border, color: colors.text }, title: "Copy", children: _jsx(Copy, { className: "w-4 h-4" }) }) })] }) }), aiNarrative.line_commentary.length > 0 && (_jsxs("div", { className: "space-y-4", children: [_jsx("h3", { className: "font-bold", style: { color: colors.text }, children: "Line-by-line commentary" }), aiNarrative.line_commentary.map((c, i) => (_jsxs("div", { className: "rounded-xl border p-4", style: { background: colors.card, borderColor: colors.border }, children: [_jsx("p", { className: "font-medium mb-2", style: { color: colors.text }, children: c.account }), _jsxs("p", { className: "text-sm mb-2", style: { color: colors.muted }, children: [_jsx("strong", { children: "WHY:" }), " ", c.why] }), _jsxs("p", { className: "text-sm", style: { color: colors.muted }, children: [_jsx("strong", { children: "RECOMMENDATION:" }), " ", c.recommendation] })] }, i)))] })), aiNarrative.action_items.length > 0 && (_jsxs("div", { className: "rounded-xl border p-6", style: { background: colors.card, borderColor: colors.border }, children: [_jsx("h3", { className: "font-bold mb-4", style: { color: colors.text }, children: "Action Items" }), _jsx("ol", { className: "list-decimal list-inside space-y-2 text-sm", style: { color: colors.text }, children: aiNarrative.action_items.map((item, i) => (_jsx("li", { children: item }, i))) }), _jsxs("button", { onClick: () => window.open(`mailto:?subject=Variance%20Analysis%20Action%20Items&body=${encodeURIComponent(aiNarrative.executive_summary + '\n\n' + aiNarrative.action_items.join('\n'))}`), className: "mt-4 px-4 py-2 rounded-lg border flex items-center gap-2", style: { borderColor: colors.border, color: colors.text }, children: [_jsx(Mail, { className: "w-4 h-4" }), "Email to CFO"] })] }))] }))] }))] })) }), uploadModal && (_jsx("div", { className: "fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4", children: _jsxs("div", { className: "rounded-xl max-w-lg w-full overflow-hidden", style: { background: colors.card, border: `1px solid ${colors.border}` }, children: [_jsxs("div", { className: "flex items-center justify-between p-4 border-b", style: { borderColor: colors.border }, children: [_jsx("h2", { className: "text-lg font-bold", style: { color: colors.text }, children: "\uD83D\uDCE4 Upload Budget vs Actual Data" }), _jsx("button", { onClick: () => { setUploadModal(false); setUploadFile(null); }, className: "p-2", style: { color: colors.muted }, children: _jsx(X, { className: "w-5 h-5" }) })] }), _jsxs("div", { className: "p-4 space-y-4", children: [_jsx("p", { className: "text-sm", style: { color: colors.muted }, children: "Expected: Account, Department, Budget, Actual (or period columns). Template available below." }), _jsxs("div", { className: "border-2 border-dashed rounded-lg p-6 text-center cursor-pointer", style: { borderColor: colors.border }, onClick: () => document.getElementById('fpa-var-file')?.click(), children: [_jsx("input", { id: "fpa-var-file", type: "file", accept: ".xlsx,.xls,.csv", className: "hidden", onChange: (e) => setUploadFile(e.target.files?.[0] ?? null) }), _jsx(FileSpreadsheet, { className: "w-10 h-10 mx-auto mb-2", style: { color: colors.muted } }), _jsx("p", { className: "text-sm", style: { color: colors.text }, children: "Drag & drop or click to browse" }), uploadFile && _jsx("p", { className: "text-xs mt-2", style: { color: colors.favorable }, children: uploadFile.name })] }), _jsxs("button", { onClick: downloadTemplate, className: "text-sm flex items-center gap-2", style: { color: colors.actualBar }, children: [_jsx(Download, { className: "w-4 h-4" }), " Download Excel Template"] })] }), _jsxs("div", { className: "flex justify-end gap-2 p-4 border-t", style: { borderColor: colors.border }, children: [_jsx("button", { onClick: () => { setUploadModal(false); setUploadFile(null); }, className: "px-4 py-2 rounded-lg border", style: { borderColor: colors.border, color: colors.text }, children: "Cancel" }), _jsxs("button", { onClick: handleUpload, disabled: !uploadFile || uploading, className: "px-4 py-2 rounded-lg font-medium flex items-center gap-2 disabled:opacity-50", style: { background: colors.budgetBar, color: '#fff' }, children: [uploading ? _jsx(Loader2, { className: "w-4 h-4 animate-spin" }) : _jsx(Upload, { className: "w-4 h-4" }), uploading ? 'Uploading...' : 'Upload & Analyze'] })] })] }) }))] }));
}
