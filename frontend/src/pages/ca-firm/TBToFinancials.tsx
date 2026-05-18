/**
 * CA Firm — Trial Balance → Financial Statements
 * Paste or upload TB → auto-generate BS, P&L, Ratios + AI commentary
 */
import { useState } from 'react';
import {
  Sparkles,
  Loader2,
  Download,
  ArrowLeft,
  TrendingUp,
  BarChart3,
  FileText,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';

const API_URL =
  (import.meta.env.VITE_API_URL && String(import.meta.env.VITE_API_URL).trim()) ||
  'http://localhost:8000';

type FSType = 'bs' | 'pl' | 'ratios' | 'commentary';

interface TBRow {
  account: string;
  debit: number;
  credit: number;
}

interface BSLine  { label: string; amount: number; indent?: boolean }
interface PLLine  { label: string; amount: number; indent?: boolean; bold?: boolean }
interface Ratio   { label: string; value: string; status: 'green' | 'amber' | 'red'; note: string }

const DEMO_TB: TBRow[] = [
  { account: 'Capital Account',            debit: 0,       credit: 500000 },
  { account: 'Reserves & Surplus',         debit: 0,       credit: 220000 },
  { account: 'Term Loan - HDFC Bank',      debit: 0,       credit: 300000 },
  { account: 'Trade Payables',             debit: 0,       credit: 85000  },
  { account: 'Other Current Liabilities',  debit: 0,       credit: 35000  },
  { account: 'GST Payable',                debit: 0,       credit: 18500  },
  { account: 'Land & Building',            debit: 450000,  credit: 0      },
  { account: 'Plant & Machinery',          debit: 280000,  credit: 0      },
  { account: 'Furniture & Fixtures',       debit: 45000,   credit: 0      },
  { account: 'Accumulated Depreciation',   debit: 0,       credit: 95000  },
  { account: 'Trade Receivables',          debit: 180000,  credit: 0      },
  { account: 'Cash & Bank',                debit: 95000,   credit: 0      },
  { account: 'Inventory / Stock',          debit: 120000,  credit: 0      },
  { account: 'Advance Tax Paid',           debit: 35000,   credit: 0      },
  { account: 'Prepaid Expenses',           debit: 12500,   credit: 0      },
  { account: 'Sales / Revenue',            debit: 0,       credit: 850000 },
  { account: 'Other Income',               debit: 0,       credit: 18000  },
  { account: 'Cost of Goods Sold',         debit: 480000,  credit: 0      },
  { account: 'Staff Salaries',             debit: 120000,  credit: 0      },
  { account: 'Rent Expense',               debit: 54000,   credit: 0      },
  { account: 'Office & Admin Expenses',    debit: 28000,   credit: 0      },
  { account: 'Marketing Expenses',         debit: 15000,   credit: 0      },
  { account: 'Bank Charges',               debit: 3200,    credit: 0      },
  { account: 'Depreciation Expense',       debit: 38000,   credit: 0      },
  { account: 'Interest on Term Loan',      debit: 24000,   credit: 0      },
  { account: 'Tax Expense',                debit: 22300,   credit: 0      },
];

function classify(account: string): string {
  const a = account.toLowerCase();
  if (/capital|reserve|surplus|retained/.test(a)) return 'equity';
  if (/term loan|long.term|debenture|bond/.test(a)) return 'ncl';
  if (/payable|creditor|gst payable|tds payable|advance from|contract liability/.test(a)) return 'cl';
  if (/other current liabilit/.test(a)) return 'cl';
  if (/land|building|plant|machinery|furniture|vehicle|intangible|goodwill|copyright/.test(a)) return 'nca';
  if (/accumulated depreciation/.test(a)) return 'nca_contra';
  if (/receivable|debtor|trade rec/.test(a)) return 'ca';
  if (/cash|bank|petty/.test(a)) return 'ca';
  if (/inventory|stock/.test(a)) return 'ca';
  if (/advance tax|prepaid|tds receivable|deposit/.test(a)) return 'ca';
  if (/sales|revenue|turnover|income/.test(a) && !/interest on|finance/.test(a)) return 'revenue';
  if (/other income|dividend|interest income/.test(a)) return 'other_income';
  if (/cost of goods|cogs|cost of sales|purchases/.test(a)) return 'cogs';
  if (/salary|wage|payroll|staff/.test(a)) return 'opex';
  if (/rent|electric|utilities|internet|phone/.test(a)) return 'opex';
  if (/office|admin|stationery|marketing|advertising|travel|professional fee|audit fee/.test(a)) return 'opex';
  if (/bank charge|banking/.test(a)) return 'opex';
  if (/depreciation|amortis/.test(a)) return 'opex';
  if (/interest on loan|finance cost|borrowing cost/.test(a)) return 'finance_cost';
  if (/tax expense|income tax|deferred tax/.test(a)) return 'tax';
  return 'other';
}

function netAmt(row: TBRow) { return row.debit - row.credit; }

function buildBS(tb: TBRow[]): { assets: BSLine[]; liabilities: BSLine[]; totalAssets: number; totalLiab: number } {
  const sum = (cls: string[]) => tb.filter((r) => cls.includes(classify(r.account))).reduce((s, r) => s + Math.abs(netAmt(r)), 0);
  const nca = tb.filter((r) => classify(r.account) === 'nca').reduce((s, r) => s + r.debit, 0);
  const contra = tb.filter((r) => classify(r.account) === 'nca_contra').reduce((s, r) => s + r.credit, 0);
  const netNCA = nca - contra;
  const ca    = sum(['ca']);
  const eq    = sum(['equity']);
  const ncl   = sum(['ncl']);
  const cl    = sum(['cl']);
  const totalAssets = netNCA + ca;
  const totalLiab   = eq + ncl + cl;

  const assets: BSLine[] = [
    { label: 'NON-CURRENT ASSETS', amount: 0, bold: true } as BSLine & { bold: boolean },
    { label: 'Fixed Assets (Net)', amount: netNCA, indent: true },
    { label: 'CURRENT ASSETS', amount: 0, bold: true } as BSLine & { bold: boolean },
    ...tb.filter((r) => classify(r.account) === 'ca').map((r) => ({ label: r.account, amount: Math.abs(netAmt(r)), indent: true })),
    { label: 'TOTAL ASSETS', amount: totalAssets },
  ];
  const liabilities: BSLine[] = [
    { label: "SHAREHOLDERS' EQUITY", amount: 0, bold: true } as BSLine & { bold: boolean },
    ...tb.filter((r) => classify(r.account) === 'equity').map((r) => ({ label: r.account, amount: Math.abs(netAmt(r)), indent: true })),
    { label: 'NON-CURRENT LIABILITIES', amount: 0, bold: true } as BSLine & { bold: boolean },
    ...tb.filter((r) => classify(r.account) === 'ncl').map((r) => ({ label: r.account, amount: Math.abs(netAmt(r)), indent: true })),
    { label: 'CURRENT LIABILITIES', amount: 0, bold: true } as BSLine & { bold: boolean },
    ...tb.filter((r) => classify(r.account) === 'cl').map((r) => ({ label: r.account, amount: Math.abs(netAmt(r)), indent: true })),
    { label: 'TOTAL LIABILITIES & EQUITY', amount: totalLiab },
  ];
  return { assets, liabilities, totalAssets, totalLiab };
}

function buildPL(tb: TBRow[]): { lines: PLLine[]; revenue: number; grossProfit: number; ebit: number; pat: number } {
  const revenue     = tb.filter((r) => classify(r.account) === 'revenue').reduce((s, r) => s + r.credit, 0);
  const otherIncome = tb.filter((r) => classify(r.account) === 'other_income').reduce((s, r) => s + r.credit, 0);
  const cogs        = tb.filter((r) => classify(r.account) === 'cogs').reduce((s, r) => s + r.debit, 0);
  const opex        = tb.filter((r) => classify(r.account) === 'opex').reduce((s, r) => s + r.debit, 0);
  const finCost     = tb.filter((r) => classify(r.account) === 'finance_cost').reduce((s, r) => s + r.debit, 0);
  const tax         = tb.filter((r) => classify(r.account) === 'tax').reduce((s, r) => s + r.debit, 0);
  const grossProfit = revenue - cogs;
  const ebit        = grossProfit + otherIncome - opex;
  const ebt         = ebit - finCost;
  const pat         = ebt - tax;

  const lines: PLLine[] = [
    { label: 'Revenue from Operations', amount: revenue },
    { label: 'Cost of Goods Sold', amount: -cogs, indent: true },
    { label: 'GROSS PROFIT', amount: grossProfit, bold: true },
    { label: 'Other Income', amount: otherIncome, indent: true },
    { label: 'Operating Expenses', amount: -opex, indent: true },
    { label: 'EBIT', amount: ebit, bold: true },
    { label: 'Finance Costs', amount: -finCost, indent: true },
    { label: 'EBT', amount: ebt },
    { label: 'Tax Expense', amount: -tax, indent: true },
    { label: 'PROFIT AFTER TAX (PAT)', amount: pat, bold: true },
  ];
  return { lines, revenue, grossProfit, ebit, pat };
}

function buildRatios(revenue: number, grossProfit: number, ebit: number, pat: number, ca: number, cl: number, totalAssets: number, debt: number): Ratio[] {
  const gpPct   = revenue ? (grossProfit / revenue) * 100 : 0;
  const npmPct  = revenue ? (pat / revenue) * 100 : 0;
  const ebitPct = revenue ? (ebit / revenue) * 100 : 0;
  const curRatio= cl ? ca / cl : 0;
  const debtEq  = (totalAssets - debt) > 0 ? debt / (totalAssets - debt) : 0;
  const roa     = totalAssets ? (pat / totalAssets) * 100 : 0;

  return [
    { label: 'Gross Margin',    value: `${gpPct.toFixed(1)}%`,   status: gpPct > 35 ? 'green' : gpPct > 20 ? 'amber' : 'red', note: 'Revenue − COGS / Revenue' },
    { label: 'Net Margin',      value: `${npmPct.toFixed(1)}%`,  status: npmPct > 10 ? 'green' : npmPct > 5 ? 'amber' : 'red', note: 'PAT / Revenue' },
    { label: 'EBIT Margin',     value: `${ebitPct.toFixed(1)}%`, status: ebitPct > 15 ? 'green' : ebitPct > 8 ? 'amber' : 'red', note: 'Operating profitability' },
    { label: 'Current Ratio',   value: curRatio.toFixed(2),      status: curRatio > 1.5 ? 'green' : curRatio > 1 ? 'amber' : 'red', note: 'CA / CL — liquidity' },
    { label: 'Debt/Equity',     value: debtEq.toFixed(2),        status: debtEq < 1 ? 'green' : debtEq < 2 ? 'amber' : 'red', note: 'Leverage ratio' },
    { label: 'ROA',             value: `${roa.toFixed(1)}%`,     status: roa > 8 ? 'green' : roa > 4 ? 'amber' : 'red', note: 'PAT / Total Assets' },
  ];
}

const statusColor = { green: 'text-emerald-400 bg-emerald-900/30 border-emerald-800', amber: 'text-amber-400 bg-amber-900/30 border-amber-800', red: 'text-red-400 bg-red-900/30 border-red-800' };

function fmt(n: number) {
  const abs = Math.abs(n);
  return `${n < 0 ? '(' : ''}₹${abs.toLocaleString('en-IN')}${n < 0 ? ')' : ''}`;
}

export default function TBToFinancials() {
  const navigate = useNavigate();
  const [tb, setTb]               = useState<TBRow[]>([]);
  const [activeTab, setActiveTab] = useState<FSType>('bs');
  const [commentary, setCommentary] = useState('');
  const [aiLoading, setAiLoading]   = useState(false);
  const [processed, setProcessed]   = useState(false);

  const loadDemo = () => {
    setTb(DEMO_TB);
    setProcessed(true);
    setCommentary('');
    toast.success('Demo TB loaded — Sharma & Sons Pvt Ltd, FY 2025-26');
  };

  const bs  = processed ? buildBS(tb)  : null;
  const pl  = processed ? buildPL(tb)  : null;
  const ca  = processed ? tb.filter((r) => classify(r.account) === 'ca').reduce((s, r) => s + Math.abs(netAmt(r)), 0) : 0;
  const cl  = processed ? tb.filter((r) => classify(r.account) === 'cl').reduce((s, r) => s + Math.abs(netAmt(r)), 0) : 0;
  const debt= processed ? tb.filter((r) => classify(r.account) === 'ncl').reduce((s, r) => s + Math.abs(netAmt(r)), 0) : 0;
  const ratios = (processed && bs && pl) ? buildRatios(pl.revenue, pl.grossProfit, pl.ebit, pl.pat, ca, cl, bs.totalAssets, debt) : [];

  const generateCommentary = async () => {
    if (!pl || !bs) return;
    setAiLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/anthropic/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-5',
          max_tokens: 700,
          messages: [{
            role: 'user',
            content: `As an expert Indian CA, write a professional financial commentary for this client:

Revenue: ₹${pl.revenue.toLocaleString('en-IN')}
Gross Profit: ₹${pl.grossProfit.toLocaleString('en-IN')} (${pl.revenue ? ((pl.grossProfit/pl.revenue)*100).toFixed(1) : 0}%)
EBIT: ₹${pl.ebit.toLocaleString('en-IN')}
PAT: ₹${pl.pat.toLocaleString('en-IN')} (${pl.revenue ? ((pl.pat/pl.revenue)*100).toFixed(1) : 0}%)
Current Ratio: ${cl ? (ca/cl).toFixed(2) : 'N/A'}
Total Assets: ₹${bs.totalAssets.toLocaleString('en-IN')}

Write 3 sections:
1. FINANCIAL PERFORMANCE (2-3 sentences on P&L)
2. BALANCE SHEET HEALTH (2-3 sentences on liquidity, leverage)
3. KEY RECOMMENDATIONS (3 bullet points with specific actions)

Professional Indian CA style. Use ₹. Keep under 250 words.`,
          }],
        }),
      });
      const d = await res.json() as { content?: Array<{ text?: string }> };
      setCommentary(d.content?.[0]?.text ?? '');
      setActiveTab('commentary');
      toast.success('AI commentary generated!');
    } catch {
      toast.error('Could not reach Claude API');
    }
    setAiLoading(false);
  };

  const tabs: { id: FSType; label: string; icon: typeof FileText }[] = [
    { id: 'bs',          label: 'Balance Sheet',  icon: BarChart3  },
    { id: 'pl',          label: 'P&L Statement',  icon: TrendingUp },
    { id: 'ratios',      label: 'Key Ratios',      icon: BarChart3  },
    { id: 'commentary',  label: 'AI Commentary',   icon: Sparkles   },
  ];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6">
      {/* Header */}
      <div className="mb-6 flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="p-2 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-amber-400 mb-0.5">CA Firm Tools</p>
          <h1 className="text-2xl font-bold">TB → Financial Statements</h1>
          <p className="text-slate-400 text-sm mt-0.5">Upload trial balance → auto-generate BS, P&L, ratios &amp; AI commentary</p>
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-3 mb-6">
        <button onClick={loadDemo} className="px-4 py-2 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 text-sm font-medium">
          Load Demo TB
        </button>
        {processed && (
          <button
            onClick={generateCommentary}
            disabled={aiLoading}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-sm font-semibold"
          >
            {aiLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {aiLoading ? 'Generating…' : 'AI Commentary'}
          </button>
        )}
        {processed && (
          <button
            onClick={() => {
              const rows = tb.map((r) => `"${r.account}",${r.debit},${r.credit}`).join('\n');
              const blob = new Blob([`Account,Debit,Credit\n${rows}`], { type: 'text/csv' });
              const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'trial_balance.csv'; a.click();
              toast.success('TB exported');
            }}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-sm font-medium"
          >
            <Download className="w-4 h-4" /> Export TB
          </button>
        )}
      </div>

      {!processed ? (
        <div className="flex flex-col items-center justify-center h-64 rounded-xl border-2 border-dashed border-slate-800 text-slate-500">
          <FileText className="w-10 h-10 mb-3 opacity-40" />
          <p className="text-sm">Load demo TB or upload your trial balance to begin</p>
        </div>
      ) : (
        <>
          {/* Tabs */}
          <div className="flex gap-1 mb-6 bg-slate-900 p-1 rounded-xl border border-slate-800 w-fit">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  activeTab === t.id ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800'
                }`}
              >
                <t.icon className="w-4 h-4" />
                {t.label}
              </button>
            ))}
          </div>

          {/* Balance Sheet */}
          {activeTab === 'bs' && bs && (
            <div className="grid md:grid-cols-2 gap-6">
              {/* Assets */}
              <div className="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden">
                <div className="px-5 py-3 border-b border-slate-800 bg-slate-800/40">
                  <h3 className="text-sm font-bold uppercase tracking-wider text-slate-300">Assets</h3>
                </div>
                <table className="w-full text-sm">
                  <tbody>
                    {bs.assets.map((line, i) => (
                      <tr key={i} className="border-b border-slate-800/50">
                        <td className={`px-5 py-2 ${(line as any).bold ? 'font-bold text-white uppercase text-xs tracking-wider pt-4' : line.indent ? 'pl-8 text-slate-300' : 'font-semibold text-white'}`}>
                          {line.label}
                        </td>
                        <td className={`px-5 py-2 text-right ${line.amount === 0 && (line as any).bold ? '' : 'text-slate-200'}`}>
                          {line.amount !== 0 ? fmt(line.amount) : ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* Liabilities */}
              <div className="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden">
                <div className="px-5 py-3 border-b border-slate-800 bg-slate-800/40">
                  <h3 className="text-sm font-bold uppercase tracking-wider text-slate-300">Liabilities &amp; Equity</h3>
                </div>
                <table className="w-full text-sm">
                  <tbody>
                    {bs.liabilities.map((line, i) => (
                      <tr key={i} className="border-b border-slate-800/50">
                        <td className={`px-5 py-2 ${(line as any).bold ? 'font-bold text-white uppercase text-xs tracking-wider pt-4' : line.indent ? 'pl-8 text-slate-300' : 'font-semibold text-white'}`}>
                          {line.label}
                        </td>
                        <td className="px-5 py-2 text-right text-slate-200">
                          {line.amount !== 0 ? fmt(line.amount) : ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="px-5 py-3 border-t border-slate-700 flex justify-between text-xs text-slate-400">
                  <span>Balanced: {Math.abs(bs.totalAssets - bs.totalLiab) < 1 ? '✅ Yes' : `❌ Diff: ₹${Math.abs(bs.totalAssets - bs.totalLiab).toLocaleString('en-IN')}`}</span>
                </div>
              </div>
            </div>
          )}

          {/* P&L */}
          {activeTab === 'pl' && pl && (
            <div className="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden max-w-2xl">
              <div className="px-5 py-3 border-b border-slate-800 bg-slate-800/40">
                <h3 className="text-sm font-bold uppercase tracking-wider text-slate-300">Statement of Profit &amp; Loss</h3>
              </div>
              <table className="w-full text-sm">
                <tbody>
                  {pl.lines.map((line, i) => (
                    <tr key={i} className={`border-b border-slate-800/50 ${line.bold ? 'bg-slate-800/40' : ''}`}>
                      <td className={`px-5 py-2.5 ${line.bold ? 'font-bold text-white' : line.indent ? 'pl-8 text-slate-400' : 'text-slate-300'}`}>
                        {line.label}
                      </td>
                      <td className={`px-5 py-2.5 text-right ${line.amount < 0 ? 'text-red-400' : line.bold ? 'text-white font-bold' : 'text-slate-200'}`}>
                        {fmt(line.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Ratios */}
          {activeTab === 'ratios' && (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {ratios.map((r) => (
                <div key={r.label} className={`rounded-xl p-5 border ${statusColor[r.status]}`}>
                  <p className="text-2xl font-bold mb-1">{r.value}</p>
                  <p className="text-sm font-semibold mb-0.5">{r.label}</p>
                  <p className="text-xs opacity-70">{r.note}</p>
                </div>
              ))}
            </div>
          )}

          {/* Commentary */}
          {activeTab === 'commentary' && (
            <div className="max-w-3xl">
              {commentary ? (
                <div className="bg-slate-900 rounded-xl border border-slate-800 p-6">
                  <div className="flex items-center gap-2 mb-4">
                    <Sparkles className="w-5 h-5 text-amber-400" />
                    <h3 className="text-sm font-bold text-amber-400 uppercase tracking-wider">AI Financial Commentary</h3>
                  </div>
                  <div className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap">{commentary}</div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-48 rounded-xl border-2 border-dashed border-slate-800 text-slate-500 gap-3">
                  <Sparkles className="w-8 h-8 opacity-40" />
                  <p className="text-sm">Click "AI Commentary" above to generate analysis</p>
                </div>
              )}
            </div>
          )}
        </>
      )}

      <p className="text-xs text-slate-600 text-center mt-8">Powered by FinReportAI · CA Firm Tools</p>
    </div>
  );
}
