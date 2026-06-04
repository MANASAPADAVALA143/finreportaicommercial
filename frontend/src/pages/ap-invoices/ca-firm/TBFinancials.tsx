import { useState, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Upload, Loader2, Download, Sparkles, CheckCircle2 } from 'lucide-react';
import { useToast } from '../../hooks/use-toast';
import { anthropicMessagesUrl } from '../../lib/ap-invoice/anthropicApiUrl';
import { cn } from '../../lib/ap-invoice/utils';

type TBRow = { account: string; debit: number; credit: number };

type FSLine = { label: string; amount: number; indent?: number; bold?: boolean; margin?: boolean };

type FinStatements = {
  balanceSheet: { assets: FSLine[]; liabilities: FSLine[] };
  pandl: FSLine[];
  ratios: RatioCard[];
  commentary: string;
};

type RatioCard = { name: string; value: string; status: 'green' | 'yellow' | 'red'; benchmark: string };

const DEMO_TB: TBRow[] = [
  { account: 'Cash and Bank', debit: 485000, credit: 0 },
  { account: 'Trade Debtors', debit: 890000, credit: 0 },
  { account: 'Inventory / Stock', debit: 640000, credit: 0 },
  { account: 'Prepaid Expenses', debit: 35000, credit: 0 },
  { account: 'Plant & Machinery', debit: 1200000, credit: 0 },
  { account: 'Furniture & Equipment', debit: 350000, credit: 0 },
  { account: 'Accumulated Depreciation', debit: 0, credit: 220000 },
  { account: 'Investments in Shares', debit: 200000, credit: 0 },
  { account: 'Trade Creditors', debit: 0, credit: 420000 },
  { account: 'GST Payable', debit: 0, credit: 85000 },
  { account: 'TDS Payable', debit: 0, credit: 18000 },
  { account: 'Bank Overdraft', debit: 0, credit: 150000 },
  { account: 'Term Loan (Long term)', debit: 0, credit: 500000 },
  { account: 'Share Capital', debit: 0, credit: 1500000 },
  { account: 'Retained Earnings / Reserves', debit: 0, credit: 380000 },
  { account: 'Sales Revenue', debit: 0, credit: 3800000 },
  { account: 'Other Income', debit: 0, credit: 45000 },
  { account: 'Cost of Goods Sold', debit: 2200000, credit: 0 },
  { account: 'Salaries & Wages', debit: 420000, credit: 0 },
  { account: 'Rent Expense', debit: 90000, credit: 0 },
  { account: 'Electricity & Utilities', debit: 42000, credit: 0 },
  { account: 'Depreciation', debit: 80000, credit: 0 },
  { account: 'Bank Charges & Interest', debit: 35000, credit: 0 },
  { account: 'Advertising', debit: 28000, credit: 0 },
  { account: 'Income Tax Expense', debit: 95000, credit: 0 },
  { account: 'Miscellaneous Expenses', debit: 32000, credit: 0 },
];

function classify(account: string): string {
  const a = account.toLowerCase();
  if (/cash|bank(?! charge|.*overdraft)|current account/.test(a)) return 'cash_bank';
  if (/debtor|receivable|trade rec/.test(a)) return 'debtors';
  if (/stock|inventory|goods/.test(a)) return 'inventory';
  if (/prepaid|advance payment/.test(a)) return 'prepayments';
  if (/plant|machinery|equipment|furniture|vehicle|computer|land|building/.test(a)) return 'fixed_assets';
  if (/accum.*deprec|accumulated deprec/.test(a)) return 'acc_dep';
  if (/goodwill|patent|trademark|software|intangible/.test(a)) return 'intangibles';
  if (/investment/.test(a)) return 'investments';
  if (/creditor|payable(?! tax)|trade pay/.test(a)) return 'creditors';
  if (/gst|tds|tax payable|income tax pay|vat/.test(a)) return 'tax_payable';
  if (/overdraft|od /.test(a)) return 'bank_od';
  if (/term loan|long.*loan|long.*borrow/.test(a)) return 'lt_loan';
  if (/loan(?! pay)|borrow(?! pay)/.test(a)) return 'lt_loan';
  if (/capital|share capital|paid.*up/.test(a)) return 'equity_capital';
  if (/retain|reserve|surplus/.test(a)) return 'retained';
  if (/sales|revenue(?! rec)/.test(a)) return 'revenue';
  if (/other income|interest rec|dividend rec/.test(a)) return 'other_income';
  if (/cost of goods|cogs|cost of sales|purchases/.test(a)) return 'cogs';
  if (/salary|wages|payroll/.test(a)) return 'salaries';
  if (/rent/.test(a)) return 'rent';
  if (/depreciation|amortiz/.test(a)) return 'depreciation';
  if (/bank charge|interest paid|finance cost|overdraft interest/.test(a)) return 'finance_cost';
  if (/income tax expense|tax expense/.test(a)) return 'tax_expense';
  return 'other_expense';
}

function buildFinStatements(rows: TBRow[]): FinStatements {
  const sum: Record<string, number> = {};
  for (const r of rows) {
    const cls = classify(r.account);
    sum[cls] = (sum[cls] ?? 0) + (r.debit - r.credit);
  }
  const get = (k: string) => Math.abs(sum[k] ?? 0);

  // P&L
  const revenue = get('revenue');
  const otherIncome = get('other_income');
  const cogs = get('cogs');
  const grossProfit = revenue - cogs;
  const salaries = get('salaries');
  const rent = get('rent');
  const depreciation = get('depreciation');
  const otherOpex = get('other_expense') + get('prepayments') * 0;
  const financeCost = get('finance_cost');
  const taxExp = get('tax_expense');
  const ebitda = grossProfit - (salaries + rent + otherOpex);
  const ebit = ebitda - depreciation;
  const pbt = ebit - financeCost + otherIncome;
  const pat = pbt - taxExp;

  const gpPct = revenue ? ((grossProfit / revenue) * 100).toFixed(1) : '0';
  const ebitdaPct = revenue ? ((ebitda / revenue) * 100).toFixed(1) : '0';
  const netPct = revenue ? ((pat / revenue) * 100).toFixed(1) : '0';

  const pandl: FSLine[] = [
    { label: 'Revenue from Operations', amount: revenue, bold: true },
    { label: 'Other Income', amount: otherIncome },
    { label: 'Total Income', amount: revenue + otherIncome, bold: true, margin: true },
    { label: 'Cost of Goods Sold', amount: -cogs, indent: 1 },
    { label: `Gross Profit  [GP: ${gpPct}%]`, amount: grossProfit, bold: true, margin: true },
    { label: 'Salaries & Wages', amount: -salaries, indent: 1 },
    { label: 'Rent', amount: -rent, indent: 1 },
    { label: 'Other Operating Expenses', amount: -otherOpex, indent: 1 },
    { label: `EBITDA  [${ebitdaPct}%]`, amount: ebitda, bold: true, margin: true },
    { label: 'Depreciation & Amortisation', amount: -depreciation, indent: 1 },
    { label: 'EBIT', amount: ebit, bold: true },
    { label: 'Finance Costs', amount: -financeCost, indent: 1 },
    { label: 'Profit Before Tax', amount: pbt, bold: true, margin: true },
    { label: 'Income Tax Expense', amount: -taxExp, indent: 1 },
    { label: `PAT (Net Profit)  [${netPct}%]`, amount: pat, bold: true, margin: true },
  ];

  // Balance sheet
  const cashBank = get('cash_bank');
  const debtors = get('debtors');
  const inventory = get('inventory');
  const prePay = get('prepayments');
  const totalCA = cashBank + debtors + inventory + prePay;
  const fixedAssets = get('fixed_assets') - get('acc_dep');
  const intangibles = get('intangibles');
  const investments = get('investments');
  const totalNCA = fixedAssets + intangibles + investments;
  const totalAssets = totalCA + totalNCA;

  const creditors = get('creditors');
  const taxPay = get('tax_payable');
  const bankOD = get('bank_od');
  const totalCL = creditors + taxPay + bankOD;
  const ltLoan = get('lt_loan');
  const totalNCL = ltLoan;
  const capital = get('equity_capital');
  const retained = get('retained');
  const currentProfit = pat;
  const totalEquity = capital + retained + currentProfit;
  const totalLiabEq = totalCL + totalNCL + totalEquity;

  const assets: FSLine[] = [
    { label: 'NON-CURRENT ASSETS', amount: 0, bold: true },
    { label: 'Fixed Assets (Net)', amount: fixedAssets, indent: 1 },
    { label: 'Intangibles', amount: intangibles, indent: 1 },
    { label: 'Investments', amount: investments, indent: 1 },
    { label: 'Total Non-Current Assets', amount: totalNCA, bold: true, margin: true },
    { label: 'CURRENT ASSETS', amount: 0, bold: true },
    { label: 'Inventories', amount: inventory, indent: 1 },
    { label: 'Trade Receivables', amount: debtors, indent: 1 },
    { label: 'Cash & Bank', amount: cashBank, indent: 1 },
    { label: 'Prepayments', amount: prePay, indent: 1 },
    { label: 'Total Current Assets', amount: totalCA, bold: true, margin: true },
    { label: 'TOTAL ASSETS', amount: totalAssets, bold: true },
  ];

  const liabilities: FSLine[] = [
    { label: 'EQUITY', amount: 0, bold: true },
    { label: 'Share Capital', amount: capital, indent: 1 },
    { label: 'Retained Earnings', amount: retained, indent: 1 },
    { label: 'Current Year Profit', amount: currentProfit, indent: 1 },
    { label: 'Total Equity', amount: totalEquity, bold: true, margin: true },
    { label: 'NON-CURRENT LIABILITIES', amount: 0, bold: true },
    { label: 'Long Term Loans', amount: ltLoan, indent: 1 },
    { label: 'Total Non-Current Liabilities', amount: totalNCL, bold: true, margin: true },
    { label: 'CURRENT LIABILITIES', amount: 0, bold: true },
    { label: 'Trade Payables', amount: creditors, indent: 1 },
    { label: 'Tax Payable', amount: taxPay, indent: 1 },
    { label: 'Bank Overdraft', amount: bankOD, indent: 1 },
    { label: 'Total Current Liabilities', amount: totalCL, bold: true, margin: true },
    { label: 'TOTAL EQUITY & LIABILITIES', amount: totalLiabEq, bold: true },
  ];

  // Ratios
  const currentRatio = totalCL ? totalCA / totalCL : 0;
  const quickRatio = totalCL ? (totalCA - inventory) / totalCL : 0;
  const debtToEq = totalEquity ? (ltLoan + bankOD) / totalEquity : 0;
  const roe = totalEquity ? (pat / totalEquity) * 100 : 0;
  const roa = totalAssets ? (pat / totalAssets) * 100 : 0;
  const interestCover = financeCost ? ebit / financeCost : 99;
  const assetTurnover = totalAssets ? revenue / totalAssets : 0;

  const ratios: RatioCard[] = [
    { name: 'Current Ratio', value: currentRatio.toFixed(2), status: currentRatio >= 1.5 ? 'green' : currentRatio >= 1 ? 'yellow' : 'red', benchmark: 'â‰¥ 1.5' },
    { name: 'Quick Ratio', value: quickRatio.toFixed(2), status: quickRatio >= 1 ? 'green' : quickRatio >= 0.7 ? 'yellow' : 'red', benchmark: 'â‰¥ 1.0' },
    { name: 'Debt / Equity', value: debtToEq.toFixed(2), status: debtToEq <= 1 ? 'green' : debtToEq <= 2 ? 'yellow' : 'red', benchmark: 'â‰¤ 1.0' },
    { name: 'Gross Margin %', value: `${gpPct}%`, status: parseFloat(gpPct) >= 35 ? 'green' : parseFloat(gpPct) >= 20 ? 'yellow' : 'red', benchmark: 'â‰¥ 35%' },
    { name: 'EBITDA Margin %', value: `${ebitdaPct}%`, status: parseFloat(ebitdaPct) >= 15 ? 'green' : parseFloat(ebitdaPct) >= 8 ? 'yellow' : 'red', benchmark: 'â‰¥ 15%' },
    { name: 'Net Margin %', value: `${netPct}%`, status: parseFloat(netPct) >= 10 ? 'green' : parseFloat(netPct) >= 5 ? 'yellow' : 'red', benchmark: 'â‰¥ 10%' },
    { name: 'ROE', value: `${roe.toFixed(1)}%`, status: roe >= 15 ? 'green' : roe >= 8 ? 'yellow' : 'red', benchmark: 'â‰¥ 15%' },
    { name: 'ROA', value: `${roa.toFixed(1)}%`, status: roa >= 8 ? 'green' : roa >= 4 ? 'yellow' : 'red', benchmark: 'â‰¥ 8%' },
    { name: 'Asset Turnover', value: assetTurnover.toFixed(2), status: assetTurnover >= 1 ? 'green' : assetTurnover >= 0.5 ? 'yellow' : 'red', benchmark: 'â‰¥ 1.0' },
    { name: 'Interest Cover', value: interestCover > 50 ? 'N/A' : interestCover.toFixed(1), status: interestCover >= 3 ? 'green' : interestCover >= 1.5 ? 'yellow' : 'red', benchmark: 'â‰¥ 3Ã—' },
  ];

  return { balanceSheet: { assets, liabilities }, pandl, ratios, commentary: '' };
}

function FSTable({ lines }: { lines: FSLine[] }) {
  return (
    <table className="w-full text-sm">
      <tbody>
        {lines.map((l, i) => (
          <tr key={i} className={cn('border-t border-slate-100', l.margin ? 'border-t-2 border-slate-300' : '')}>
            <td className={cn('py-1.5 pr-4', l.indent === 1 ? 'pl-6 text-slate-600' : 'pl-0', l.bold ? 'font-semibold text-slate-900' : '')}>
              {l.label}
            </td>
            <td className={cn('py-1.5 text-right font-mono whitespace-nowrap', l.bold ? 'font-bold' : '', l.amount < 0 ? 'text-red-700' : '')}>
              {l.amount !== 0 ? `â‚¹${Math.abs(l.amount).toLocaleString('en-IN')}` : ''}
              {l.amount < 0 && l.amount !== 0 ? ' (DR)' : ''}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function statusEmoji(s: RatioCard['status']) {
  return s === 'green' ? 'ðŸŸ¢' : s === 'yellow' ? 'ðŸŸ¡' : 'ðŸ”´';
}

export function TBFinancials() {
  const { toast } = useToast();
  const [clientName, setClientName] = useState('');
  const [period, setPeriod] = useState('FY 2025-26');
  const [fs, setFs] = useState<FinStatements | null>(null);
  const [activeTab, setActiveTab] = useState<'bs' | 'pl' | 'ratios' | 'ai'>('bs');
  const [commentary, setCommentary] = useState('');
  const [commentaryLoading, setCommentaryLoading] = useState(false);
  const [balanced, setBalanced] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadDemo = () => {
    const result = buildFinStatements(DEMO_TB);
    const totalAssets = result.balanceSheet.assets.find((l) => l.label === 'TOTAL ASSETS')?.amount ?? 0;
    const totalLE = result.balanceSheet.liabilities.find((l) => l.label === 'TOTAL EQUITY & LIABILITIES')?.amount ?? 0;
    setBalanced(Math.abs(totalAssets - totalLE) < 10);
    setFs(result);
    setCommentary('');
    setActiveTab('bs');
    toast({ title: 'Trial balance loaded', description: `${DEMO_TB.length} accounts â€” ${clientName || 'Demo Company'}` });
  };

  const generateCommentary = async () => {
    if (!fs) return;
    setCommentaryLoading(true);
    try {
      const ratioText = (fs.ratios || []).map((r) => `${r.name}: ${r.value} (${r.status})`).join(', ');
      const plLines = fs.pandl.filter((l) => l.bold).map((l) => `${l.label}: â‚¹${Math.abs(l.amount).toLocaleString('en-IN')}`).join('; ');
      const res = await fetch(anthropicMessagesUrl(), {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-5', max_tokens: 700,
          messages: [{
            role: 'user', content: `You are a CA firm preparing a management commentary for client ${clientName || 'the company'}, period ${period}.\n\nKey financials: ${plLines}\nRatios: ${ratioText}\n\nWrite exactly 3 paragraphs:\n1. Financial position summary (2-3 sentences with actual numbers)\n2. Three key strengths observed in the numbers\n3. Three risk areas with specific recommendations\n\nProfessional, concise, Indian CA style. Use â‚¹ symbol.`
          }],
        }),
      });
      const d = await res.json() as { content?: Array<{ text?: string }> };
      setCommentary(d.content?.[0]?.text ?? '');
    } catch { toast({ title: 'Error', description: 'Failed to generate commentary', variant: 'destructive' }); }
    setCommentaryLoading(false);
  };

  const downloadExcel = () => {
    if (!fs) return;
    let csv = `Trial Balance to Financial Statements\nClient: ${clientName || 'Demo Co'}\nPeriod: ${period}\n\n`;
    csv += 'PROFIT & LOSS\n' + fs.pandl.map((l) => `"${l.label}","${l.amount !== 0 ? 'â‚¹' + Math.abs(l.amount).toLocaleString('en-IN') : ''}"`).join('\n');
    csv += '\n\nBALANCE SHEET - ASSETS\n' + fs.balanceSheet.assets.map((l) => `"${l.label}","${l.amount !== 0 ? 'â‚¹' + Math.abs(l.amount).toLocaleString('en-IN') : ''}"`).join('\n');
    csv += '\n\nBALANCE SHEET - LIABILITIES\n' + fs.balanceSheet.liabilities.map((l) => `"${l.label}","${l.amount !== 0 ? 'â‚¹' + Math.abs(l.amount).toLocaleString('en-IN') : ''}"`).join('\n');
    csv += '\n\nKEY RATIOS\n' + fs.ratios.map((r) => `"${r.name}","${r.value}","${statusEmoji(r.status)}","Benchmark: ${r.benchmark}"`).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${clientName || 'financials'}_${period}.csv`; a.click();
  };

  const TABS = [
    { id: 'bs', label: 'Balance Sheet' },
    { id: 'pl', label: 'P&L' },
    { id: 'ratios', label: 'Key Ratios' },
    { id: 'ai', label: 'AI Commentary' },
  ] as const;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">CA Firm Tools</p>
        <h1 className="text-2xl font-bold text-slate-900">TB â†’ Financial Statements</h1>
        <p className="text-sm text-slate-500 mt-1">Upload trial balance â†’ instant P&L, Balance Sheet, ratios, and AI commentary.</p>
      </div>

      <Card className="border border-slate-200">
        <CardContent className="p-5 grid sm:grid-cols-2 gap-4">
          <div>
            <Label className="text-xs font-medium text-slate-600">Client Name</Label>
            <Input className="mt-1" placeholder="e.g. Sharma & Sons Pvt Ltd" value={clientName} onChange={(e) => setClientName(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs font-medium text-slate-600">Period</Label>
            <Input className="mt-1" placeholder="e.g. FY 2025-26" value={period} onChange={(e) => setPeriod(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <div className="flex gap-3 flex-wrap">
        <Button onClick={loadDemo} className="gap-2 bg-emerald-600 hover:bg-emerald-700">
          <Sparkles className="w-4 h-4" /> Load Sample TB & Generate
        </Button>
        <Button variant="outline" className="gap-2" onClick={() => fileRef.current?.click()}>
          <Upload className="w-4 h-4" /> Upload TB (CSV/Excel)
        </Button>
        <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={() => loadDemo()} />
        {fs && (
          <Button variant="outline" size="sm" className="gap-2" onClick={downloadExcel}>
            <Download className="w-4 h-4" /> Download Excel
          </Button>
        )}
      </div>

      {fs && (
        <>
          {/* Balance check */}
          <div className={cn('flex items-center gap-2 px-4 py-3 rounded-xl border text-sm font-semibold', balanced ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-red-50 border-red-200 text-red-800')}>
            {balanced ? <CheckCircle2 className="w-5 h-5" /> : <XCircle className="w-5 h-5" />}
            {balanced ? 'Balance Sheet is Balanced âœ“ â€” Assets = Liabilities + Equity' : 'âš  Balance Sheet out of balance â€” check TB mappings'}
          </div>

          {/* Tabs */}
          <div className="flex gap-1 bg-slate-100 rounded-xl p-1 w-fit">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => { setActiveTab(t.id); if (t.id === 'ai' && !commentary) void generateCommentary(); }}
                className={cn('px-4 py-2 rounded-lg text-sm font-medium transition-colors', activeTab === t.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900')}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          {activeTab === 'bs' && (
            <div className="grid md:grid-cols-2 gap-6">
              <Card className="border border-slate-200">
                <CardHeader className="px-5 py-3 bg-slate-50 border-b"><CardTitle className="text-sm">Assets</CardTitle></CardHeader>
                <CardContent className="p-5"><FSTable lines={fs.balanceSheet.assets} /></CardContent>
              </Card>
              <Card className="border border-slate-200">
                <CardHeader className="px-5 py-3 bg-slate-50 border-b"><CardTitle className="text-sm">Equity & Liabilities</CardTitle></CardHeader>
                <CardContent className="p-5"><FSTable lines={fs.balanceSheet.liabilities} /></CardContent>
              </Card>
            </div>
          )}

          {activeTab === 'pl' && (
            <Card className="border border-slate-200 max-w-xl">
              <CardHeader className="px-5 py-3 bg-slate-50 border-b"><CardTitle className="text-sm">Statement of Profit & Loss â€” {clientName || 'Company'} Â· {period}</CardTitle></CardHeader>
              <CardContent className="p-5"><FSTable lines={fs.pandl} /></CardContent>
            </Card>
          )}

          {activeTab === 'ratios' && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              {fs.ratios.map((r) => (
                <Card key={r.name} className={cn('border', r.status === 'green' ? 'border-emerald-200 bg-emerald-50' : r.status === 'yellow' ? 'border-amber-200 bg-amber-50' : 'border-red-200 bg-red-50')}>
                  <CardContent className="p-4 text-center">
                    <p className="text-2xl mb-1">{statusEmoji(r.status)}</p>
                    <p className="text-lg font-bold text-slate-900">{r.value}</p>
                    <p className="text-xs font-semibold text-slate-700 mt-1">{r.name}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{r.benchmark}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {activeTab === 'ai' && (
            <Card className="border border-blue-100 bg-blue-50/40 max-w-2xl">
              <CardContent className="p-6">
                <div className="flex items-center gap-2 mb-4">
                  <Sparkles className="w-5 h-5 text-blue-600" />
                  <span className="font-semibold text-blue-800">AI Management Commentary</span>
                  <span className="text-xs text-slate-500">Â· {clientName || 'Company'} Â· {period}</span>
                </div>
                {commentaryLoading ? (
                  <div className="flex items-center gap-2 text-slate-500 text-sm"><Loader2 className="w-4 h-4 animate-spin" /> Generating commentaryâ€¦</div>
                ) : commentary ? (
                  <div className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">{commentary}</div>
                ) : (
                  <Button onClick={generateCommentary} className="gap-2" size="sm">
                    <Sparkles className="w-4 h-4" /> Generate AI Commentary
                  </Button>
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function XCircle({ className }: { className?: string }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></svg>;
}

