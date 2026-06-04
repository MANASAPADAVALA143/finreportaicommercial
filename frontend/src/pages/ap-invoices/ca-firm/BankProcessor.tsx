import { useState, useRef, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Badge } from '../../components/ui/badge';
import { Upload, Loader2, Download, Sparkles, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';
import { useToast } from '../../hooks/use-toast';
import { anthropicMessagesUrl } from '../../lib/ap-invoice/anthropicApiUrl';
import { cn } from '../../lib/ap-invoice/utils';

type TxnRow = {
  date: string;
  description: string;
  amount: number;
  type: 'debit' | 'credit';
};

type JournalEntry = TxnRow & {
  debit_account: string;
  credit_account: string;
  voucher_type: 'Payment' | 'Receipt' | 'Journal' | 'Contra';
  tally_ledger_dr: string;
  tally_ledger_cr: string;
  narration: string;
  confidence: number;
  gst_applicable: boolean;
  gst_rate: number | null;
};

const BANKS = ['HDFC', 'ICICI', 'SBI', 'Axis', 'Kotak', 'Yes Bank', 'IndusInd', 'Federal Bank', 'Other'];

const DEMO_TRANSACTIONS: TxnRow[] = [
  { date: '2025-05-01', description: 'NEFT/Sharma Builders/Rent Apr25', amount: 75000, type: 'debit' },
  { date: '2025-05-02', description: 'Salary May 2025 - Staff', amount: 180000, type: 'debit' },
  { date: '2025-05-03', description: 'RTGS/Atlas Corp Ltd/INV-2214', amount: 95000, type: 'credit' },
  { date: '2025-05-04', description: 'GSTIN Pay May25', amount: 42000, type: 'debit' },
  { date: '2025-05-05', description: 'NEFT/Tata Power/Elec Bill', amount: 8500, type: 'debit' },
  { date: '2025-05-06', description: 'UPI/Swiggy/Canteen', amount: 2200, type: 'debit' },
  { date: '2025-05-07', description: 'RTGS/Kumar Traders/PO-441', amount: 55000, type: 'debit' },
  { date: '2025-05-08', description: 'INV REC/Bharat Electronics/INV-98', amount: 120000, type: 'credit' },
  { date: '2025-05-09', description: 'TDS Payment Q4 FY25', amount: 18000, type: 'debit' },
  { date: '2025-05-10', description: 'HDFC Bank Charges May', amount: 500, type: 'debit' },
  { date: '2025-05-11', description: 'NEFT/M/s Gupta & Sons/Adv', amount: 25000, type: 'debit' },
  { date: '2025-05-12', description: 'RTGS/Mukesh Exports/INV-567', amount: 88000, type: 'credit' },
  { date: '2025-05-13', description: 'SBI Loan EMI May25', amount: 35000, type: 'debit' },
  { date: '2025-05-14', description: 'Interest on OD A/c', amount: 4200, type: 'debit' },
  { date: '2025-05-15', description: 'UPI/Amazon/Office supplies', amount: 3100, type: 'debit' },
  { date: '2025-05-16', description: 'RTGS/Patel Industries/Part pay', amount: 65000, type: 'credit' },
  { date: '2025-05-17', description: 'EPF Contribution May25', amount: 22000, type: 'debit' },
  { date: '2025-05-18', description: 'NEFT/Airtel/Phone bill', amount: 2800, type: 'debit' },
  { date: '2025-05-19', description: 'NEFT/XYZ Unknown Corp', amount: 15000, type: 'debit' },
  { date: '2025-05-20', description: 'INV REC/Reliance Retail/Bal', amount: 47000, type: 'credit' },
  { date: '2025-05-21', description: 'Cash Withdrawal ATM', amount: 20000, type: 'debit' },
  { date: '2025-05-22', description: 'NEFT/City Gas/Utility', amount: 6500, type: 'debit' },
  { date: '2025-05-23', description: 'Advance Tax Q1 FY26', amount: 30000, type: 'debit' },
  { date: '2025-05-24', description: 'RTGS/Mehta & Co/INV-331', amount: 72000, type: 'credit' },
  { date: '2025-05-25', description: 'Stationery / Misc expense', amount: 1800, type: 'debit' },
];

async function categoriseTxn(txn: TxnRow): Promise<Omit<JournalEntry, keyof TxnRow>> {
  const res = await fetch(anthropicMessagesUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5',
      max_tokens: 400,
      system: `You are a senior Indian CA firm accountant. Analyse the bank transaction and return ONLY a JSON object (no markdown):
{
  "debit_account": string,
  "credit_account": string,
  "voucher_type": "Payment"|"Receipt"|"Journal"|"Contra",
  "tally_ledger_dr": string,
  "tally_ledger_cr": string,
  "narration": string,
  "confidence": number (0-100),
  "gst_applicable": boolean,
  "gst_rate": number|null
}
Standard rules: Salary â†’ Dr Salary A/c Cr Bank; Vendor pmt â†’ Dr Creditors Cr Bank; Customer receipt â†’ Dr Bank Cr Debtors; GST pmt â†’ Dr GST Payable Cr Bank; Rent â†’ Dr Rent A/c Cr Bank; Electricity/Utilities â†’ Dr respective expense Cr Bank; Bank charges â†’ Dr Bank Charges Cr Bank; Loan EMI â†’ Dr Loan A/c Cr Bank; Interest â†’ Dr Interest A/c Cr Bank; TDS/TCS/Advance tax â†’ Dr Tax Payable Cr Bank; EPF/PF â†’ Dr PF Expense Cr Bank; Cash withdrawal â†’ Dr Cash A/c Cr Bank (Contra); Unknown â†’ Dr Suspense A/c Cr Bank confidence 30.`,
      messages: [{ role: 'user', content: `Transaction: date=${txn.date}, description="${txn.description}", amount=â‚¹${txn.amount}, type=${txn.type}` }],
    }),
  });
  const data = await res.json() as { content?: Array<{ text?: string }> };
  const text = data.content?.[0]?.text ?? '{}';
  const clean = text.replace(/```json\n?/g, '').replace(/```/g, '').trim();
  return JSON.parse(clean) as Omit<JournalEntry, keyof TxnRow>;
}

function confidenceColor(c: number) {
  if (c >= 85) return 'bg-emerald-100 text-emerald-800';
  if (c >= 60) return 'bg-amber-100 text-amber-800';
  return 'bg-red-100 text-red-800';
}

function rowBg(c: number) {
  if (c >= 85) return 'bg-emerald-50/40';
  if (c >= 60) return 'bg-amber-50/40';
  return 'bg-red-50/40';
}

function StatusIcon({ c }: { c: number }) {
  if (c >= 85) return <CheckCircle2 className="w-4 h-4 text-emerald-600" />;
  if (c >= 60) return <AlertTriangle className="w-4 h-4 text-amber-500" />;
  return <XCircle className="w-4 h-4 text-red-500" />;
}

function exportCSV(entries: JournalEntry[], clientName: string) {
  const rows = [
    ['Date', 'Description', 'Amount', 'Type', 'Dr Account', 'Cr Account', 'Voucher Type', 'Narration', 'GST', 'Confidence'],
    ...entries.map((e) => [
      e.date, e.description, e.amount, e.type, e.debit_account, e.credit_account,
      e.voucher_type, e.narration, e.gst_applicable ? `${e.gst_rate ?? 18}%` : 'No', `${e.confidence}%`,
    ]),
  ];
  const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = `${clientName || 'bank'}_journal_entries.csv`; a.click();
}

function exportTallyXML(entries: JournalEntry[], clientName: string) {
  const vouchers = entries.map((e) => `
    <TALLYMESSAGE>
      <VOUCHER VCHTYPE="${e.voucher_type}" ACTION="Create">
        <DATE>${e.date.replace(/-/g, '')}</DATE>
        <NARRATION>${e.narration}</NARRATION>
        <ALLLEDGERENTRIES.LIST>
          <LEDGERNAME>${e.tally_ledger_dr}</LEDGERNAME>
          <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
          <AMOUNT>-${e.amount}</AMOUNT>
        </ALLLEDGERENTRIES.LIST>
        <ALLLEDGERENTRIES.LIST>
          <LEDGERNAME>${e.tally_ledger_cr}</LEDGERNAME>
          <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
          <AMOUNT>${e.amount}</AMOUNT>
        </ALLLEDGERENTRIES.LIST>
      </VOUCHER>
    </TALLYMESSAGE>`).join('');
  const xml = `<?xml version="1.0" encoding="utf-8"?>\n<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME></REQUESTDESC><REQUESTDATA>${vouchers}</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`;
  const blob = new Blob([xml], { type: 'text/xml' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = `${clientName || 'bank'}_tally_import.xml`; a.click();
}

export function BankProcessor() {
  const { toast } = useToast();
  const [clientName, setClientName] = useState('');
  const [period, setPeriod] = useState(() => {
    const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [bank, setBank] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [aiNarrative, setAiNarrative] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) setFile(f);
  }, []);

  const processDemo = async () => {
    setLoading(true); setEntries([]); setProgress(0); setAiNarrative('');
    const results: JournalEntry[] = [];
    for (let i = 0; i < DEMO_TRANSACTIONS.length; i++) {
      const txn = DEMO_TRANSACTIONS[i];
      try {
        const cat = await categoriseTxn(txn);
        results.push({ ...txn, ...cat });
      } catch {
        results.push({ ...txn, debit_account: 'Suspense A/c', credit_account: 'Bank A/c', voucher_type: 'Journal', tally_ledger_dr: 'Suspense A/c', tally_ledger_cr: 'Bank Account', narration: txn.description, confidence: 30, gst_applicable: false, gst_rate: null });
      }
      setProgress(Math.round(((i + 1) / DEMO_TRANSACTIONS.length) * 100));
      setEntries([...results]);
    }
    // AI narrative
    try {
      const total = results.length;
      const auto = results.filter((r) => r.confidence >= 60).length;
      const flagged = results.filter((r) => r.confidence < 60).length;
      const top3 = [...results].filter((r) => r.type === 'debit').sort((a, b) => b.amount - a.amount).slice(0, 3);
      const res = await fetch(anthropicMessagesUrl(), {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-5', max_tokens: 400,
          messages: [{ role: 'user', content: `Bank statement processed for ${clientName || 'Demo Client'}, period ${period}. ${total} transactions, ${auto} auto-categorized, ${flagged} flagged. Top 3 expenses: ${top3.map((t) => `${t.description} â‚¹${t.amount.toLocaleString('en-IN')}`).join('; ')}. Write 3 bullet points: total summary, top expenses insight, any unusual patterns. Concise, professional, Indian CA style.` }],
        }),
      });
      const d = await res.json() as { content?: Array<{ text?: string }> };
      setAiNarrative(d.content?.[0]?.text ?? '');
    } catch { /* ignore */ }
    setLoading(false);
    toast({ title: 'Processing complete', description: `${results.length} journal entries generated` });
  };

  const auto = entries.filter((e) => e.confidence >= 85).length;
  const review = entries.filter((e) => e.confidence >= 60 && e.confidence < 85).length;
  const flagged = entries.filter((e) => e.confidence < 60).length;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">CA Firm Tools</p>
        <h1 className="text-2xl font-bold text-slate-900">Bank Statement Processor</h1>
        <p className="text-sm text-slate-500 mt-1">Upload any Indian bank statement â€” AI categorises every transaction into journal entries.</p>
      </div>

      {/* Config */}
      <Card className="border border-slate-200">
        <CardContent className="p-5 grid sm:grid-cols-3 gap-4">
          <div>
            <Label className="text-xs font-medium text-slate-600">Client Name</Label>
            <Input className="mt-1" placeholder="e.g. Sharma & Sons Pvt Ltd" value={clientName} onChange={(e) => setClientName(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs font-medium text-slate-600">Period (YYYY-MM)</Label>
            <Input className="mt-1" type="month" value={period} onChange={(e) => setPeriod(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs font-medium text-slate-600">Bank</Label>
            <Select value={bank} onValueChange={setBank}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Select bank" /></SelectTrigger>
              <SelectContent>{BANKS.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Upload */}
      <Card
        className={cn('border-2 border-dashed cursor-pointer transition-colors', dragging ? 'border-blue-400 bg-blue-50' : 'border-slate-200 hover:border-blue-300')}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => fileRef.current?.click()}
      >
        <CardContent className="p-10 flex flex-col items-center gap-3 text-center">
          <Upload className="w-10 h-10 text-slate-400" />
          <div>
            <p className="font-semibold text-slate-700">{file ? file.name : 'Drag & drop bank statement'}</p>
            <p className="text-xs text-slate-500 mt-1">PDF Â· Excel Â· CSV â€” HDFC, ICICI, SBI, Axis, Kotak, QuickBooks, Xero, Tally exports</p>
          </div>
          <input ref={fileRef} type="file" accept=".pdf,.xlsx,.xls,.csv" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </CardContent>
      </Card>

      <div className="flex gap-3 flex-wrap">
        <Button onClick={processDemo} disabled={loading} className="gap-2 bg-blue-600 hover:bg-blue-700">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          {loading ? `Processingâ€¦ ${progress}%` : 'Load Demo Data & Process'}
        </Button>
        {file && !loading && (
          <Button onClick={processDemo} variant="outline" className="gap-2">
            <Sparkles className="w-4 h-4" /> Process Uploaded File
          </Button>
        )}
      </div>

      {loading && (
        <div className="w-full bg-slate-200 rounded-full h-2">
          <div className="bg-blue-600 h-2 rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
        </div>
      )}

      {entries.length > 0 && (
        <>
          {/* Summary */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Total', value: entries.length, cls: 'text-slate-700 bg-slate-100' },
              { label: 'âœ… Auto-posted', value: auto, cls: 'text-emerald-700 bg-emerald-100' },
              { label: 'âš ï¸ Review', value: review, cls: 'text-amber-700 bg-amber-100' },
              { label: 'ðŸ”´ Flagged', value: flagged, cls: 'text-red-700 bg-red-100' },
            ].map((s) => (
              <div key={s.label} className={`rounded-xl p-3 text-center ${s.cls}`}>
                <p className="text-2xl font-bold">{s.value}</p>
                <p className="text-xs font-medium">{s.label}</p>
              </div>
            ))}
          </div>

          {/* Export buttons */}
          <div className="flex gap-3 flex-wrap">
            <Button variant="outline" size="sm" className="gap-2" onClick={() => exportTallyXML(entries, clientName)}>
              <Download className="w-4 h-4" /> Download Tally XML
            </Button>
            <Button variant="outline" size="sm" className="gap-2" onClick={() => exportCSV(entries, clientName)}>
              <Download className="w-4 h-4" /> Download CSV
            </Button>
          </div>

          {/* Table */}
          <Card className="border border-slate-200 overflow-hidden">
            <CardHeader className="px-5 py-3 bg-slate-50 border-b">
              <CardTitle className="text-sm font-semibold text-slate-700">Journal Entries</CardTitle>
            </CardHeader>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-100 text-slate-600 uppercase tracking-wide">
                  <tr>
                    {['', 'Date', 'Description', 'Amount', 'Dr Account', 'Cr Account', 'Voucher', 'GST', 'Conf%'].map((h) => (
                      <th key={h} className="px-3 py-2 text-left whitespace-nowrap font-semibold">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {entries.map((e, i) => (
                    <tr key={i} className={cn('hover:brightness-95', rowBg(e.confidence))}>
                      <td className="px-3 py-2"><StatusIcon c={e.confidence} /></td>
                      <td className="px-3 py-2 whitespace-nowrap">{e.date}</td>
                      <td className="px-3 py-2 max-w-[200px] truncate" title={e.description}>{e.description}</td>
                      <td className={cn('px-3 py-2 font-mono font-semibold whitespace-nowrap', e.type === 'debit' ? 'text-red-700' : 'text-emerald-700')}>
                        {e.type === 'debit' ? 'âˆ’' : '+'}â‚¹{e.amount.toLocaleString('en-IN')}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">{e.debit_account}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{e.credit_account}</td>
                      <td className="px-3 py-2"><Badge variant="outline" className="text-xs">{e.voucher_type}</Badge></td>
                      <td className="px-3 py-2">{e.gst_applicable ? `${e.gst_rate ?? 18}%` : 'â€”'}</td>
                      <td className="px-3 py-2">
                        <span className={cn('px-2 py-0.5 rounded-full text-xs font-semibold', confidenceColor(e.confidence))}>{e.confidence}%</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* AI Narrative */}
          {aiNarrative && (
            <Card className="border border-blue-100 bg-blue-50/40">
              <CardContent className="p-5">
                <div className="flex items-center gap-2 mb-3">
                  <Sparkles className="w-4 h-4 text-blue-600" />
                  <span className="text-sm font-semibold text-blue-800">AI Analysis â€” {clientName || 'Demo Client'} Â· {period}</span>
                </div>
                <div className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">{aiNarrative}</div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

