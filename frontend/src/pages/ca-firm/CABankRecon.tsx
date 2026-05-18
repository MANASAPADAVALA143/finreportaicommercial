/**
 * CA Firm — Bank Reconciliation
 * Match bank statement vs. books, flag unmatched, export BRS report
 */
import { useState } from 'react';
import {
  CheckCircle2,
  XCircle,
  AlertCircle,
  Download,
  ArrowLeft,
  Sparkles,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';

const API_URL =
  (import.meta.env.VITE_API_URL && String(import.meta.env.VITE_API_URL).trim()) ||
  'http://localhost:8000';

interface BankEntry {
  id: number;
  date: string;
  description: string;
  amount: number; // positive = credit, negative = debit
  matchedId?: number;
  status: 'matched' | 'unmatched' | 'review';
}

interface BookEntry {
  id: number;
  date: string;
  description: string;
  amount: number;
  matchedId?: number;
  status: 'matched' | 'unmatched' | 'review';
}

const DEMO_BANK: BankEntry[] = [
  { id: 1,  date: '01-Apr-25', description: 'Opening Balance',           amount: 180000,  status: 'matched' },
  { id: 2,  date: '02-Apr-25', description: 'NEFT CR - SHARMA TRADERS',  amount: 250000,  status: 'matched' },
  { id: 3,  date: '03-Apr-25', description: 'HDFC BANK CHARGES',         amount: -590,    status: 'unmatched' },
  { id: 4,  date: '05-Apr-25', description: 'SALARY CREDIT APR 2025',    amount: -85000,  status: 'matched' },
  { id: 5,  date: '07-Apr-25', description: 'NEFT CR - MEHTA INFRA',     amount: 180000,  status: 'matched' },
  { id: 6,  date: '10-Apr-25', description: 'RENT PAYMENT',              amount: -45000,  status: 'matched' },
  { id: 7,  date: '12-Apr-25', description: 'CREDIT CARD PAYMENT',       amount: -22000,  status: 'review'  },
  { id: 8,  date: '15-Apr-25', description: 'TDS CHALLAN 281',           amount: -12500,  status: 'matched' },
  { id: 9,  date: '16-Apr-25', description: 'NEFT CR - PATEL EXPORTS',   amount: 320000,  status: 'matched' },
  { id: 10, date: '20-Apr-25', description: 'GOOGLE ADS DEBIT',          amount: -8900,   status: 'unmatched'},
  { id: 11, date: '25-Apr-25', description: 'ADVANCE TAX Q1 FY26',       amount: -35000,  status: 'matched' },
  { id: 12, date: '28-Apr-25', description: 'INSURANCE PREMIUM - LIC',   amount: -24000,  status: 'matched' },
  { id: 13, date: '29-Apr-25', description: 'LOAN EMI - HDFC',           amount: -55000,  status: 'matched' },
  { id: 14, date: '30-Apr-25', description: 'INTEREST EARNED',           amount: 2180,    status: 'unmatched'},
];

const DEMO_BOOKS: BookEntry[] = [
  { id: 1,  date: '01-Apr-25', description: 'Opening Balance',           amount: 180000,  status: 'matched' },
  { id: 2,  date: '02-Apr-25', description: 'Receipt - Sharma Traders',  amount: 250000,  status: 'matched' },
  { id: 3,  date: '05-Apr-25', description: 'Salary Expense Apr 2025',   amount: -85000,  status: 'matched' },
  { id: 4,  date: '07-Apr-25', description: 'Receipt - Mehta Infra',     amount: 180000,  status: 'matched' },
  { id: 5,  date: '10-Apr-25', description: 'Rent Payment Apr 2025',     amount: -45000,  status: 'matched' },
  { id: 6,  date: '12-Apr-25', description: 'Credit Card Bill Payment',  amount: -20000,  status: 'review'  }, // ₹2000 diff
  { id: 7,  date: '15-Apr-25', description: 'TDS Payment Challan',       amount: -12500,  status: 'matched' },
  { id: 8,  date: '16-Apr-25', description: 'Receipt - Patel Exports',   amount: 320000,  status: 'matched' },
  { id: 9,  date: '25-Apr-25', description: 'Advance Tax Q1',            amount: -35000,  status: 'matched' },
  { id: 10, date: '28-Apr-25', description: 'LIC Premium Payment',       amount: -24000,  status: 'matched' },
  { id: 11, date: '29-Apr-25', description: 'HDFC Term Loan EMI',        amount: -55000,  status: 'matched' },
  { id: 12, date: '22-Apr-25', description: 'Professional Fees - CA',    amount: -15000,  status: 'unmatched'}, // not in bank yet
];

const statusStyle = {
  matched:   { icon: CheckCircle2, color: 'text-emerald-400', bg: 'bg-emerald-900/20', label: 'Matched'  },
  unmatched: { icon: XCircle,      color: 'text-red-400',     bg: 'bg-red-900/20',     label: 'Unmatched'},
  review:    { icon: AlertCircle,  color: 'text-amber-400',   bg: 'bg-amber-900/20',   label: 'Review'   },
};

function fmtAmt(n: number) {
  const abs = Math.abs(n);
  const str = `₹${abs.toLocaleString('en-IN')}`;
  return n < 0 ? `(${str})` : str;
}

export default function CABankRecon() {
  const navigate = useNavigate();
  const [bankEntries, setBankEntries] = useState<BankEntry[]>([]);
  const [bookEntries, setBookEntries] = useState<BookEntry[]>([]);
  const [aiNote, setAiNote]           = useState('');
  const [aiLoading, setAiLoading]     = useState(false);
  const [loaded, setLoaded]           = useState(false);

  const loadDemo = () => {
    setBankEntries(DEMO_BANK);
    setBookEntries(DEMO_BOOKS);
    setLoaded(true);
    setAiNote('');
    toast.success('Demo BRS loaded — Sharma & Sons Pvt Ltd, Apr 2025');
  };

  // Summary
  const bankTotal   = bankEntries.reduce((s, e) => s + e.amount, 0);
  const bookTotal   = bookEntries.reduce((s, e) => s + e.amount, 0);
  const difference  = bankTotal - bookTotal;
  const unmatchedBank = bankEntries.filter((e) => e.status === 'unmatched');
  const unmatchedBook = bookEntries.filter((e) => e.status === 'unmatched');
  const reviewItems = [...bankEntries, ...bookEntries].filter((e) => e.status === 'review');

  const runAI = async () => {
    setAiLoading(true);
    try {
      const unmatchedDesc = [
        ...unmatchedBank.map((e) => `Bank: ${e.description} (${fmtAmt(e.amount)})`),
        ...unmatchedBook.map((e) => `Books: ${e.description} (${fmtAmt(e.amount)})`),
        ...reviewItems.map((e) => `Review: ${e.description} (${fmtAmt(e.amount)})`),
      ].join('\n');

      const res = await fetch(`${API_URL}/api/anthropic/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-5',
          max_tokens: 500,
          messages: [{
            role: 'user',
            content: `You are an expert Indian CA reviewing a bank reconciliation for April 2025.

Bank closing balance: ₹${bankTotal.toLocaleString('en-IN')}
Book closing balance: ₹${bookTotal.toLocaleString('en-IN')}
Net difference: ₹${Math.abs(difference).toLocaleString('en-IN')} ${difference > 0 ? '(Bank > Books)' : difference < 0 ? '(Books > Bank)' : '(Balanced ✅)'}

Unmatched / Review items:
${unmatchedDesc || 'None'}

Write a concise BRS commentary (under 150 words):
1. State if BRS is balanced or explain the difference
2. For each unmatched item, state likely reason (timing, error, missing entry)
3. Give 2 corrective action items

Professional Indian CA style.`,
          }],
        }),
      });
      const d = await res.json() as { content?: Array<{ text?: string }> };
      setAiNote(d.content?.[0]?.text ?? '');
      toast.success('AI BRS commentary ready!');
    } catch {
      toast.error('Could not reach Claude API');
    }
    setAiLoading(false);
  };

  const exportBRS = () => {
    const lines = [
      'BANK RECONCILIATION STATEMENT',
      'Entity: Sharma & Sons Pvt Ltd',
      'Period: April 2025',
      '',
      'BANK STATEMENT',
      'Date,Description,Amount,Status',
      ...bankEntries.map((e) => `"${e.date}","${e.description}",${e.amount},"${e.status}"`),
      '',
      'BOOKS OF ACCOUNTS',
      'Date,Description,Amount,Status',
      ...bookEntries.map((e) => `"${e.date}","${e.description}",${e.amount},"${e.status}"`),
      '',
      `Bank Closing Balance,${bankTotal}`,
      `Book Closing Balance,${bookTotal}`,
      `Difference,${difference}`,
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = 'bank_reconciliation_apr2025.csv'; a.click();
    toast.success('BRS exported');
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6">
      {/* Header */}
      <div className="mb-6 flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="p-2 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-amber-400 mb-0.5">CA Firm Tools</p>
          <h1 className="text-2xl font-bold">Bank Reconciliation (BRS)</h1>
          <p className="text-slate-400 text-sm mt-0.5">Match bank statement vs books · flag exceptions · AI commentary</p>
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-3 mb-6">
        <button onClick={loadDemo} className="px-4 py-2 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 text-sm font-medium">
          Load Demo BRS
        </button>
        {loaded && (
          <>
            <button
              onClick={runAI}
              disabled={aiLoading}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-sm font-semibold"
            >
              {aiLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              {aiLoading ? 'Analysing…' : 'AI BRS Analysis'}
            </button>
            <button onClick={exportBRS} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-sm font-medium">
              <Download className="w-4 h-4" /> Export BRS
            </button>
          </>
        )}
      </div>

      {!loaded ? (
        <div className="flex flex-col items-center justify-center h-64 rounded-xl border-2 border-dashed border-slate-800 text-slate-500">
          <RefreshCw className="w-10 h-10 mb-3 opacity-40" />
          <p className="text-sm">Load demo data or upload bank + book entries</p>
        </div>
      ) : (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            <div className="bg-slate-900 rounded-xl p-4 border border-slate-800">
              <p className="text-xl font-bold text-blue-400">{fmtAmt(bankTotal)}</p>
              <p className="text-xs text-slate-400 mt-1">Bank Closing Balance</p>
            </div>
            <div className="bg-slate-900 rounded-xl p-4 border border-slate-800">
              <p className="text-xl font-bold text-purple-400">{fmtAmt(bookTotal)}</p>
              <p className="text-xs text-slate-400 mt-1">Book Closing Balance</p>
            </div>
            <div className={`rounded-xl p-4 border ${Math.abs(difference) < 1 ? 'bg-emerald-900/20 border-emerald-800' : 'bg-red-900/20 border-red-800'}`}>
              <p className={`text-xl font-bold ${Math.abs(difference) < 1 ? 'text-emerald-400' : 'text-red-400'}`}>
                {Math.abs(difference) < 1 ? '✅ Balanced' : fmtAmt(difference)}
              </p>
              <p className="text-xs text-slate-400 mt-1">Net Difference</p>
            </div>
            <div className="bg-amber-900/20 rounded-xl p-4 border border-amber-800">
              <p className="text-xl font-bold text-amber-400">{unmatchedBank.length + unmatchedBook.length + reviewItems.length}</p>
              <p className="text-xs text-slate-400 mt-1">Items to Review</p>
            </div>
          </div>

          {/* Two-column reconciliation table */}
          <div className="grid md:grid-cols-2 gap-6 mb-6">
            {/* Bank */}
            <div className="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden">
              <div className="px-5 py-3 border-b border-slate-800 bg-slate-800/40">
                <h3 className="text-sm font-bold text-slate-300">Bank Statement</h3>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-slate-500 uppercase border-b border-slate-800">
                    <th className="px-4 py-2 text-left">Date</th>
                    <th className="px-4 py-2 text-left">Description</th>
                    <th className="px-4 py-2 text-right">Amount</th>
                    <th className="px-4 py-2 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {bankEntries.map((e) => {
                    const s = statusStyle[e.status];
                    const Icon = s.icon;
                    return (
                      <tr key={e.id} className={`${s.bg} transition-colors`}>
                        <td className="px-4 py-2 text-slate-400 text-xs whitespace-nowrap">{e.date}</td>
                        <td className="px-4 py-2 text-slate-200 text-xs max-w-[140px] truncate">{e.description}</td>
                        <td className={`px-4 py-2 text-right text-xs font-medium ${e.amount < 0 ? 'text-red-400' : 'text-emerald-400'}`}>{fmtAmt(e.amount)}</td>
                        <td className="px-4 py-2 text-center"><Icon className={`w-4 h-4 mx-auto ${s.color}`} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="px-5 py-3 border-t border-slate-800 flex justify-between text-xs text-slate-400">
                <span>Closing Balance</span>
                <span className="font-semibold text-blue-400">{fmtAmt(bankTotal)}</span>
              </div>
            </div>

            {/* Books */}
            <div className="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden">
              <div className="px-5 py-3 border-b border-slate-800 bg-slate-800/40">
                <h3 className="text-sm font-bold text-slate-300">Books of Accounts</h3>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-slate-500 uppercase border-b border-slate-800">
                    <th className="px-4 py-2 text-left">Date</th>
                    <th className="px-4 py-2 text-left">Description</th>
                    <th className="px-4 py-2 text-right">Amount</th>
                    <th className="px-4 py-2 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {bookEntries.map((e) => {
                    const s = statusStyle[e.status];
                    const Icon = s.icon;
                    return (
                      <tr key={e.id} className={`${s.bg} transition-colors`}>
                        <td className="px-4 py-2 text-slate-400 text-xs whitespace-nowrap">{e.date}</td>
                        <td className="px-4 py-2 text-slate-200 text-xs max-w-[140px] truncate">{e.description}</td>
                        <td className={`px-4 py-2 text-right text-xs font-medium ${e.amount < 0 ? 'text-red-400' : 'text-emerald-400'}`}>{fmtAmt(e.amount)}</td>
                        <td className="px-4 py-2 text-center"><Icon className={`w-4 h-4 mx-auto ${s.color}`} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="px-5 py-3 border-t border-slate-800 flex justify-between text-xs text-slate-400">
                <span>Closing Balance</span>
                <span className="font-semibold text-purple-400">{fmtAmt(bookTotal)}</span>
              </div>
            </div>
          </div>

          {/* AI Commentary */}
          {aiNote && (
            <div className="bg-slate-900 rounded-xl border border-amber-800/40 p-6 max-w-3xl">
              <div className="flex items-center gap-2 mb-3">
                <Sparkles className="w-5 h-5 text-amber-400" />
                <h3 className="text-sm font-bold text-amber-400 uppercase tracking-wider">AI BRS Commentary</h3>
              </div>
              <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap">{aiNote}</p>
            </div>
          )}

          {/* Legend */}
          <div className="flex gap-4 mt-4 text-xs text-slate-500">
            {Object.entries(statusStyle).map(([k, v]) => {
              const Icon = v.icon;
              return (
                <div key={k} className="flex items-center gap-1.5">
                  <Icon className={`w-3.5 h-3.5 ${v.color}`} />
                  <span>{v.label}</span>
                </div>
              );
            })}
          </div>
        </>
      )}

      <p className="text-xs text-slate-600 text-center mt-8">Powered by FinReportAI · CA Firm Tools</p>
    </div>
  );
}
