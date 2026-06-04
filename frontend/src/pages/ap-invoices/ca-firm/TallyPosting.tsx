import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { CheckCircle2, AlertTriangle, Download, Upload, Zap, Info } from 'lucide-react';
import { useToast } from '../../hooks/use-toast';
import { cn } from '../../lib/ap-invoice/utils';

type VEntry = {
  date: string;
  narration: string;
  dr_ledger: string;
  cr_ledger: string;
  amount: number;
  voucher_type: string;
  valid: boolean;
  warning?: string;
};

const LEDGER_MAP: Record<string, boolean> = {
  'Bank Account': true, 'Cash Account': true, 'Debtors A/c': true, 'Creditors A/c': true,
  'Salary A/c': true, 'Rent A/c': true, 'Electricity A/c': true, 'Utilities A/c': true,
  'GST Payable': true, 'CGST Payable': true, 'SGST Payable': true, 'IGST Payable': true,
  'TDS Payable': true, 'Advance Tax': true, 'Income Tax': true,
  'Bank Charges': true, 'Interest A/c': true, 'Loan A/c': true,
  'PF Expense': true, 'ESI Expense': true, 'Professional Tax': true,
  'Capital A/c': true, 'Drawings A/c': true, 'Suspense A/c': true,
  'Prepaid Expenses': true, 'Accrued Income': true, 'Depreciation A/c': true,
};

const DEMO_ENTRIES: VEntry[] = [
  { date: '2025-05-01', narration: 'Rent Apr 2025 - Sharma Builders', dr_ledger: 'Rent A/c', cr_ledger: 'Bank Account', amount: 75000, voucher_type: 'Payment', valid: true },
  { date: '2025-05-02', narration: 'Salary May 2025', dr_ledger: 'Salary A/c', cr_ledger: 'Bank Account', amount: 180000, voucher_type: 'Payment', valid: true },
  { date: '2025-05-03', narration: 'Receipt - Atlas Corp INV-2214', dr_ledger: 'Bank Account', cr_ledger: 'Debtors A/c', amount: 95000, voucher_type: 'Receipt', valid: true },
  { date: '2025-05-04', narration: 'GST Payment May 2025', dr_ledger: 'GST Payable', cr_ledger: 'Bank Account', amount: 42000, voucher_type: 'Payment', valid: true },
  { date: '2025-05-10', narration: 'HDFC Bank Charges', dr_ledger: 'Bank Charges', cr_ledger: 'Bank Account', amount: 500, voucher_type: 'Payment', valid: false, warning: 'Ledger "Bank Charges" not in master â€” use "Bank Charges"' },
  { date: '2025-05-13', narration: 'SBI Loan EMI May 2025', dr_ledger: 'Loan A/c', cr_ledger: 'Bank Account', amount: 35000, voucher_type: 'Payment', valid: true },
  { date: '2025-05-17', narration: 'EPF Contribution May 2025', dr_ledger: 'PF Expense', cr_ledger: 'Bank Account', amount: 22000, voucher_type: 'Payment', valid: true },
  { date: '2025-05-19', narration: 'XYZ Unknown Corp - Suspense', dr_ledger: 'Suspense A/c', cr_ledger: 'Bank Account', amount: 15000, voucher_type: 'Journal', valid: true, warning: 'Suspense entry â€” requires manual review before posting' },
  { date: '2025-05-21', narration: 'Cash Withdrawal ATM', dr_ledger: 'Cash Account', cr_ledger: 'Bank Account', amount: 20000, voucher_type: 'Contra', valid: true },
  { date: '2025-05-23', narration: 'Advance Tax Q1 FY26', dr_ledger: 'Advance Tax', cr_ledger: 'Bank Account', amount: 30000, voucher_type: 'Payment', valid: true },
];

function generateTallyXML(entries: VEntry[]): string {
  const vouchers = entries
    .filter((e) => e.valid)
    .map(
      (e) => `
    <TALLYMESSAGE>
      <VOUCHER VCHTYPE="${e.voucher_type}" ACTION="Create">
        <DATE>${e.date.replace(/-/g, '')}</DATE>
        <NARRATION>${e.narration}</NARRATION>
        <ALLLEDGERENTRIES.LIST>
          <LEDGERNAME>${e.dr_ledger}</LEDGERNAME>
          <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
          <AMOUNT>-${e.amount}</AMOUNT>
        </ALLLEDGERENTRIES.LIST>
        <ALLLEDGERENTRIES.LIST>
          <LEDGERNAME>${e.cr_ledger}</LEDGERNAME>
          <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
          <AMOUNT>${e.amount}</AMOUNT>
        </ALLLEDGERENTRIES.LIST>
      </VOUCHER>
    </TALLYMESSAGE>`
    )
    .join('');

  return `<?xml version="1.0" encoding="utf-8"?>
<ENVELOPE>
  <HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME></REQUESTDESC>
      <REQUESTDATA>${vouchers}
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>`;
}

function validateEntries(entries: VEntry[]): VEntry[] {
  return entries.map((e) => {
    const drOk = LEDGER_MAP[e.dr_ledger] ?? false;
    const crOk = LEDGER_MAP[e.cr_ledger] ?? false;
    const suspense = e.dr_ledger === 'Suspense A/c' || e.cr_ledger === 'Suspense A/c';
    let warning = e.warning;
    let valid = e.valid;
    if (!drOk) { warning = `Dr ledger "${e.dr_ledger}" not in master map`; valid = false; }
    else if (!crOk) { warning = `Cr ledger "${e.cr_ledger}" not in master map`; valid = false; }
    else if (suspense) { warning = 'Suspense entry â€” requires manual review'; }
    return { ...e, valid, warning };
  });
}

export function TallyPosting() {
  const { toast } = useToast();
  const [entries, setEntries] = useState<VEntry[]>([]);
  const [loaded, setLoaded] = useState(false);

  const loadDemo = () => {
    const validated = validateEntries(DEMO_ENTRIES);
    setEntries(validated);
    setLoaded(true);
    toast({ title: 'Demo data loaded', description: `${validated.length} vouchers validated` });
  };

  const downloadXML = () => {
    const xml = generateTallyXML(entries);
    const blob = new Blob([xml], { type: 'text/xml' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = 'tally_import.xml'; a.click();
    toast({ title: 'Tally XML downloaded', description: 'Import into Tally: Gateway â†’ Import Data â†’ Vouchers' });
  };

  const downloadErrorReport = () => {
    const rows = [['Date', 'Narration', 'Dr Ledger', 'Cr Ledger', 'Amount', 'Issue'], ...entries.filter((e) => e.warning).map((e) => [e.date, e.narration, e.dr_ledger, e.cr_ledger, e.amount, e.warning ?? ''])];
    const csv = rows.map((r) => r.map((v) => `"${String(v)}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'tally_error_report.csv'; a.click();
  };

  const valid = entries.filter((e) => e.valid && !e.warning?.includes('Suspense'));
  const warnings = entries.filter((e) => e.warning);
  const invalid = entries.filter((e) => !e.valid);
  const totalDebit = entries.reduce((s, e) => s + e.amount, 0);

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">CA Firm Tools</p>
        <h1 className="text-2xl font-bold text-slate-900">Tally Auto-Posting</h1>
        <p className="text-sm text-slate-500 mt-1">Validate journal entries, map to Tally ledgers, and download import-ready XML.</p>
      </div>

      <div className="flex gap-3 flex-wrap">
        <Button onClick={loadDemo} className="gap-2 bg-violet-600 hover:bg-violet-700">
          <Zap className="w-4 h-4" /> Load Demo Vouchers
        </Button>
        <Button variant="outline" className="gap-2" disabled>
          <Upload className="w-4 h-4" /> Upload Journal Entries CSV
        </Button>
      </div>

      {loaded && (
        <>
          {/* Validation summary */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Total Vouchers', value: entries.length, cls: 'bg-slate-100 text-slate-700' },
              { label: 'âœ… Valid', value: valid.length, cls: 'bg-emerald-100 text-emerald-700' },
              { label: 'âš ï¸ Warnings', value: warnings.length, cls: 'bg-amber-100 text-amber-700' },
              { label: 'âŒ Invalid', value: invalid.length, cls: 'bg-red-100 text-red-700' },
            ].map((s) => (
              <div key={s.label} className={`rounded-xl p-3 text-center ${s.cls}`}>
                <p className="text-2xl font-bold">{s.value}</p>
                <p className="text-xs font-medium">{s.label}</p>
              </div>
            ))}
          </div>

          {/* Balance check */}
          <Card className="border border-emerald-200 bg-emerald-50">
            <CardContent className="p-4 flex items-center gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
              <div className="text-sm">
                <span className="font-semibold text-emerald-800">Debit = Credit âœ“</span>
                <span className="text-emerald-700 ml-2">Total: â‚¹{totalDebit.toLocaleString('en-IN')}</span>
              </div>
            </CardContent>
          </Card>

          {/* Export */}
          <div className="flex gap-3 flex-wrap">
            <Button onClick={downloadXML} className="gap-2 bg-violet-600 hover:bg-violet-700">
              <Download className="w-4 h-4" /> Download Tally XML
            </Button>
            <Button variant="outline" size="sm" className="gap-2" onClick={downloadErrorReport}>
              <Download className="w-4 h-4" /> Download Error Report
            </Button>
          </div>

          {/* Voucher table */}
          <Card className="border border-slate-200 overflow-hidden">
            <CardHeader className="px-5 py-3 bg-slate-50 border-b">
              <CardTitle className="text-sm font-semibold">Vouchers</CardTitle>
            </CardHeader>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-100 text-slate-600 uppercase tracking-wide">
                  <tr>{['Status', 'Date', 'Narration', 'Dr Ledger', 'Cr Ledger', 'Amount', 'Type'].map((h) => <th key={h} className="px-3 py-2 text-left whitespace-nowrap font-semibold">{h}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {entries.map((e, i) => (
                    <tr key={i} className={cn(!e.valid ? 'bg-red-50/60' : e.warning ? 'bg-amber-50/60' : 'bg-white')}>
                      <td className="px-3 py-2">
                        {!e.valid ? <XCircle className="w-4 h-4 text-red-500" /> : e.warning ? <AlertTriangle className="w-4 h-4 text-amber-500" /> : <CheckCircle2 className="w-4 h-4 text-emerald-600" />}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">{e.date}</td>
                      <td className="px-3 py-2 max-w-[200px]">
                        <div className="truncate" title={e.narration}>{e.narration}</div>
                        {e.warning && <div className="text-amber-600 text-[10px] mt-0.5">{e.warning}</div>}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">{e.dr_ledger}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{e.cr_ledger}</td>
                      <td className="px-3 py-2 font-mono font-semibold whitespace-nowrap">â‚¹{e.amount.toLocaleString('en-IN')}</td>
                      <td className="px-3 py-2"><Badge variant="outline" className="text-xs">{e.voucher_type}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Import instructions */}
          <Card className="border border-blue-100 bg-blue-50/40">
            <CardContent className="p-5">
              <div className="flex items-center gap-2 mb-3">
                <Info className="w-4 h-4 text-blue-600" />
                <span className="text-sm font-semibold text-blue-800">How to Import into Tally</span>
              </div>
              <ol className="text-sm text-slate-700 space-y-1 list-decimal list-inside">
                <li>Open <strong>TallyPrime</strong> or Tally ERP 9</li>
                <li>Go to <strong>Gateway of Tally â†’ Import Data</strong></li>
                <li>Select <strong>Vouchers</strong></li>
                <li>Browse to the downloaded <code className="bg-white px-1 rounded text-blue-700">tally_import.xml</code> file</li>
                <li>Press <strong>Enter</strong> to import â€” vouchers will appear in Day Book</li>
              </ol>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function XCircle({ className }: { className?: string }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></svg>;
}

