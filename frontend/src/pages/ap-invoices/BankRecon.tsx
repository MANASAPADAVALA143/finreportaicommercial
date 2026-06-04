import { useState, useEffect, useMemo, useRef, type ChangeEvent } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import {
  Landmark,
  Sparkles,
  Check,
  Flag,
  Upload,
  Download,
  FolderOpen,
  Loader2,
} from 'lucide-react';
import { useToast } from '../../hooks/use-toast';
import { cn } from '../../lib/ap-invoice/utils';
import { supabase } from '../../lib/ap-invoice/supabase';
import { getMyCompany } from '../../lib/ap-invoice/companyService';

// Types
type InvTxn = {
  id: string;
  date: string;
  /** YYYY-MM-DD from DB for amount-only auto-match tie-breaks */
  dateIso: string;
  desc: string;
  ref: string;
  amount: number;
  cur: string;
  status: 'matched' | 'unmatched';
  matchedTo?: string;
  reconHint?: string;
  utr_number?: string | null;
};

const FX_RATES: Record<string, number> = {
  USD: 1,
  EUR: 1.0842,
  GBP: 1.2701,
  INR: 0.01192,
  AED: 0.2723,
  SGD: 0.7441,
  AUD: 0.6234,
};

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$',
  EUR: 'â‚¬',
  GBP: 'Â£',
  INR: 'â‚¹',
  AED: 'AED ',
  SGD: 'S$',
  AUD: 'A$',
};

function fmt(amount: number, cur: string) {
  const s = CURRENCY_SYMBOLS[cur] || cur + ' ';
  return s + amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

type BankTxn = {
  id: string;
  date: string;
  dateIso: string;
  desc: string;
  ref: string;
  amount: number;
  cur: string;
  type: 'debit' | 'credit';
  status: 'matched' | 'unmatched' | 'flagged';
  matchedTo?: string;
  /** AI / rules: bank fee, receipt, not vendor AP */
  ignored?: boolean;
  reconHint?: string;
  matchConfidence?: number;
  matchType?: 'UTR/Reference' | 'Amount+Vendor';
};

function detectDelimiter(firstLine: string): string {
  const commas = (firstLine.match(/,/g) || []).length;
  const semis = (firstLine.match(/;/g) || []).length;
  const tabs = (firstLine.match(/\t/g) || []).length;
  if (tabs > 0 && tabs >= commas && tabs >= semis) return '\t';
  if (semis > commas) return ';';
  return ',';
}

function parseDelimitedRows(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQ = false;
  const s = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQ) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
          continue;
        }
        inQ = false;
        continue;
      }
      field += c;
      continue;
    }
    if (c === '"') {
      inQ = true;
      continue;
    }
    if (c === delimiter) {
      row.push(field);
      field = '';
      continue;
    }
    if (c === '\n') {
      row.push(field);
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
      field = '';
      continue;
    }
    field += c;
  }
  row.push(field);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

function normHeader(h: string) {
  return h.trim().toLowerCase().replace(/\s+/g, ' ');
}

function colIndex(headers: string[], patterns: string[]): number {
  for (const p of patterns) {
    const idx = headers.findIndex((h) => h.includes(p));
    if (idx >= 0) return idx;
  }
  return -1;
}

/** Strip currency symbols and grouping; return absolute numeric value for reconciliation. */
function normaliseAmountString(raw: string | number): number {
  if (typeof raw === 'number') return Math.abs(raw);
  const t = String(raw)
    .replace(/,/g, '')
    .replace(/[â‚¹$Â£â‚¬\s\u00A0]/g, '')
    .trim();
  if (!t) return 0;
  const n = parseFloat(t);
  return Number.isFinite(n) ? Math.abs(n) : 0;
}

function parseMoneyCell(raw: string): number | null {
  const n = normaliseAmountString(raw);
  if (n === 0 && !String(raw).trim()) return null;
  if (n === 0) return null;
  return n;
}

function utrMatchesBankLine(utr: string | null | undefined, bankRef: string, bankDesc: string): boolean {
  const u = (utr ?? '').trim().toLowerCase();
  if (u.length < 2) return false;
  const blob = `${bankRef} ${bankDesc}`.toLowerCase();
  if (blob.includes(u)) return true;
  const uCompact = u.replace(/[^a-z0-9]/g, '');
  if (uCompact.length >= 6 && blob.replace(/[^a-z0-9]/g, '').includes(uCompact)) return true;
  return false;
}

function bankLineMatchesInvoiceRefs(bankRef: string, bankDesc: string, invoiceNumber: string): boolean {
  const br = `${bankRef} ${bankDesc}`.toLowerCase();
  const inv = (invoiceNumber ?? '').trim().toLowerCase();
  if (!inv) return false;
  const invTail = inv.replace(/^inv-/, '').replace(/-/g, '');
  if (invTail.length >= 4 && br.includes(invTail)) return true;
  const payStyle = br.match(/(?:pay|pmt)[\s\-_:]*([a-z0-9\-]+)/i);
  const invClean = inv.replace(/^inv-/, '').replace(/-/g, '');
  if (payStyle?.[1]) {
    const payClean = payStyle[1].replace(/-/g, '').toLowerCase();
    if (payClean && payClean === invClean) return true;
  }
  return false;
}

function amountRelDiffUsd(a1: number, c1: string, a2: number, c2: string) {
  const u1 = a1 * (FX_RATES[c1.toUpperCase().slice(0, 3)] ?? 1);
  const u2 = a2 * (FX_RATES[c2.toUpperCase().slice(0, 3)] ?? 1);
  const d = Math.abs(u1 - u2);
  const denom = Math.max(u1, u2, 0.01);
  return d / denom;
}

/** When most invoices are INR, treat bank lines as INR for display and AI (amounts stay numeric). */
function alignBankRowsCurrency(rows: BankTxn[], invoices: InvTxn[]): BankTxn[] {
  if (rows.length === 0 || invoices.length === 0) return rows;
  const inrN = invoices.filter((i) => i.cur === 'INR').length;
  if (inrN < invoices.length * 0.5) return rows;
  return rows.map((r) => ({ ...r, cur: 'INR' }));
}

function parseDateCell(raw: string): { display: string; iso: string } | null {
  const t = raw.trim();
  if (!t) return null;
  const isoLike = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoLike) {
    const d = new Date(`${isoLike[1]}-${isoLike[2]}-${isoLike[3]}`);
    if (!Number.isNaN(d.getTime())) {
      return {
        iso: d.toISOString().slice(0, 10),
        display: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      };
    }
  }
  const d = new Date(t);
  if (!Number.isNaN(d.getTime())) {
    return {
      iso: d.toISOString().slice(0, 10),
      display: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    };
  }
  const m = t.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/);
  if (m) {
    let y = parseInt(m[3], 10);
    if (y < 100) y += 2000;
    const day = parseInt(m[1], 10);
    const month = parseInt(m[2], 10);
    const d2 = new Date(y, month - 1, day);
    if (!Number.isNaN(d2.getTime())) {
      return {
        iso: d2.toISOString().slice(0, 10),
        display: d2.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      };
    }
  }
  return null;
}

/** Parse bank statement CSV/TSV. Uses separate Debit/Credit columns when present; otherwise one Amount column (positive = payment out / debit, negative = receipt / credit). */
function parseBankStatementFromText(csvText: string, defaultCurrency: string): { rows: BankTxn[]; error: string | null } {
  const trimmed = csvText.trim().replace(/^\uFEFF/, '');
  if (!trimmed) return { rows: [], error: 'File is empty' };
  const firstLine = trimmed.split(/\r?\n/)[0] || '';
  const delim = detectDelimiter(firstLine);
  const table = parseDelimitedRows(trimmed, delim);
  if (table.length < 2) return { rows: [], error: 'Need a header row and at least one data row' };

  const headers = table[0].map(normHeader);
  const dateIdx = colIndex(headers, ['transaction date', 'txn date', 'posting date', 'book date', 'value date', 'date']);
  const descIdx = colIndex(headers, ['description', 'narration', 'memo', 'details', 'payee', 'particulars', 'merchant']);
  const refIdx = colIndex(headers, ['reference', 'ref no', 'cheque', 'utr', 'transaction id', 'txn id']);
  const curIdx = colIndex(headers, ['currency', 'ccy', 'curr']);
  const amtIdx = colIndex(headers, ['amount', 'net amount', 'transaction amount']);
  const debitIdx = colIndex(headers, ['debit', 'withdrawal', 'payment out', 'dr']);
  const creditIdx = colIndex(headers, ['credit', 'deposit', 'payment in', 'cr']);

  if (dateIdx < 0) {
    return { rows: [], error: 'Could not find a date column (e.g. Date, Transaction Date, Value Date)' };
  }
  const hasSplit = debitIdx >= 0 && creditIdx >= 0;
  if (!hasSplit && amtIdx < 0) {
    return { rows: [], error: 'Could not find amount columns (Amount, or separate Debit/Credit)' };
  }

  const defCur = (defaultCurrency || 'USD').toUpperCase().slice(0, 3);
  const rows: BankTxn[] = [];

  for (let r = 1; r < table.length; r++) {
    const cells = table[r];
    const dateRaw = dateIdx < cells.length ? cells[dateIdx] : '';
    const parsedDate = parseDateCell(dateRaw);
    if (!parsedDate) continue;

    let amount = 0;
    let type: 'debit' | 'credit' = 'debit';
    if (hasSplit) {
      const dr = debitIdx < cells.length ? parseMoneyCell(cells[debitIdx]) : null;
      const cr = creditIdx < cells.length ? parseMoneyCell(cells[creditIdx]) : null;
      if (dr != null && dr > 0) {
        amount = dr;
        type = 'debit';
      } else if (cr != null && cr > 0) {
        amount = cr;
        type = 'credit';
      } else continue;
    } else {
      const n = amtIdx < cells.length ? parseMoneyCell(cells[amtIdx]) : null;
      if (n == null || n === 0) continue;
      amount = Math.abs(n);
      type = n < 0 ? 'credit' : 'debit';
    }

    const desc = descIdx >= 0 && descIdx < cells.length ? cells[descIdx].trim() : '';
    const ref = refIdx >= 0 && refIdx < cells.length ? cells[refIdx].trim() : '';
    let cur = defCur;
    if (curIdx >= 0 && curIdx < cells.length) {
      const c = cells[curIdx].trim().toUpperCase();
      if (c.length >= 3) cur = c.slice(0, 3);
    }

    rows.push({
      id: `b-${crypto.randomUUID()}`,
      date: parsedDate.display,
      dateIso: parsedDate.iso,
      desc: desc || ref || 'Bank transaction',
      ref: ref || 'â€”',
      amount,
      cur,
      type,
      status: 'unmatched',
    });
  }

  if (rows.length === 0) {
    return { rows: [], error: 'No valid rows (check date and amount formats)' };
  }
  return { rows, error: null };
}

function formatInvoiceDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function BankRecon() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<'recon' | 'import' | 'connect' | 'report'>('recon');
  const [bankTxns, setBankTxns] = useState<BankTxn[]>([]);
  const [invTxns, setInvTxns] = useState<InvTxn[]>([]);
  const [selectedBank, setSelectedBank] = useState<string | null>(null);
  const [selectedInv, setSelectedInv] = useState<string | null>(null);
  const [bankCurFilter, setBankCurFilter] = useState('ALL');
  const [invCurFilter, setInvCurFilter] = useState('ALL');
  const [bankSearch, setBankSearch] = useState('');
  const [invSearch, setInvSearch] = useState('');
  const [aiLastSummary, setAiLastSummary] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [manualModalOpen, setManualModalOpen] = useState(false);
  const [importDefaultCurrency, setImportDefaultCurrency] = useState('INR');
  const [invLoadError, setInvLoadError] = useState<string | null>(null);
  const bankStatementFileRef = useRef<HTMLInputElement>(null);
  const [manualForm, setManualForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    currency: 'INR',
    desc: '',
    amount: '',
    type: 'debit' as 'debit' | 'credit',
    ref: '',
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('invoices')
        .select('id, invoice_number, invoice_date, vendor_name, total_amount, currency, status, utr_number')
        .in('status', ['Approved', 'Paid'])
        .order('invoice_date', { ascending: false });

      if (cancelled) return;
      if (error) {
        setInvLoadError(error.message);
        setInvTxns([]);
        return;
      }
      setInvLoadError(null);
      const rows: InvTxn[] = (data || []).map((inv) => ({
        id: inv.id,
        date: formatInvoiceDate(inv.invoice_date),
        dateIso:
          typeof inv.invoice_date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(inv.invoice_date)
            ? inv.invoice_date.slice(0, 10)
            : (() => {
                const d = new Date(inv.invoice_date as string);
                return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
              })(),
        desc: inv.vendor_name?.trim() || 'Vendor',
        ref: inv.invoice_number || 'â€”',
        amount: Number(inv.total_amount) || 0,
        cur: (inv.currency || 'USD').toUpperCase().slice(0, 3),
        status: 'unmatched' as const,
        utr_number: (inv as { utr_number?: string | null }).utr_number ?? null,
      }));
      setInvTxns(rows);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const statementRangeLabel = useMemo(() => {
    if (bankTxns.length === 0) return 'Upload a bank statement (CSV)';
    const sorted = [...bankTxns].sort((a, b) => a.dateIso.localeCompare(b.dateIso));
    const a = sorted[0]!.dateIso;
    const b = sorted[sorted.length - 1]!.dateIso;
    if (a === b) return sorted[0]!.date;
    return `${sorted[0]!.date} â€“ ${sorted[sorted.length - 1]!.date}`;
  }, [bankTxns]);

  function onBankStatementFileChange(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) void processBankStatementFile(f);
  }

  async function processBankStatementFile(file: File) {
    const lower = file.name.toLowerCase();
    if (!lower.endsWith('.csv') && !lower.endsWith('.txt')) {
      toast({
        title: 'CSV only',
        description: 'Please export your bank statement as CSV (or .txt) and upload that file.',
        variant: 'destructive',
      });
      return;
    }
    try {
      const text = await file.text();
      const { rows, error } = parseBankStatementFromText(text, importDefaultCurrency);
      if (error) {
        toast({ title: 'Could not read statement', description: error, variant: 'destructive' });
        return;
      }
      const aligned = alignBankRowsCurrency(rows, invTxns).map((r) => ({
        ...r,
        ignored: false,
        reconHint: undefined,
        matchConfidence: undefined,
      }));
      setBankTxns(aligned);
      setSelectedBank(null);
      setSelectedInv(null);
      setAiLastSummary(null);
      setActiveTab('recon');
      toast({
        title: 'Statement loaded',
        description: `${rows.length} bank transaction${rows.length === 1 ? '' : 's'} imported.`,
      });
    } catch {
      toast({ title: 'Read failed', description: 'Could not read the file.', variant: 'destructive' });
    }
  }

  const filteredBank = bankTxns.filter(
    (t) =>
      (bankCurFilter === 'ALL' || t.cur === bankCurFilter) &&
      (t.desc.toLowerCase().includes(bankSearch.toLowerCase()) || t.ref.toLowerCase().includes(bankSearch.toLowerCase()))
  );

  const filteredInv = invTxns.filter(
    (t) =>
      (invCurFilter === 'ALL' || t.cur === invCurFilter) &&
      (t.desc.toLowerCase().includes(invSearch.toLowerCase()) || t.ref.toLowerCase().includes(invSearch.toLowerCase()))
  );

  const matchedCount = bankTxns.filter((t) => t.status === 'matched').length;
  const ignoredBankCount = bankTxns.filter((t) => t.ignored).length;
  const unmatchedBankVendor = bankTxns.filter(
    (t) => t.status !== 'matched' && !t.ignored && t.type === 'debit'
  ).length;
  const unmatchedInvCount = invTxns.filter((t) => t.status !== 'matched').length;
  const unmatchedBankLinesCount = bankTxns.filter((t) => t.status !== 'matched').length;
  const flaggedDiff = bankTxns
    .filter((t) => t.status === 'flagged')
    .reduce((a, t) => a + t.amount * (FX_RATES[t.cur] ?? 1), 0);
  const matchRatePct = bankTxns.length ? Math.round((matchedCount / bankTxns.length) * 100) : 0;
  const reportDebitUsd = useMemo(
    () => bankTxns.filter((t) => t.type === 'debit').reduce((a, t) => a + t.amount * (FX_RATES[t.cur] ?? 1), 0),
    [bankTxns]
  );
  const reportCreditUsd = useMemo(
    () => bankTxns.filter((t) => t.type === 'credit').reduce((a, t) => a + t.amount * (FX_RATES[t.cur] ?? 1), 0),
    [bankTxns]
  );

  function confirmMatch() {
    if (!selectedBank || !selectedInv) {
      toast({ title: 'Select both', description: 'Select one bank transaction AND one invoice to match.', variant: 'destructive' });
      return;
    }
    const bRow = bankTxns.find((x) => x.id === selectedBank);
    const iRow = invTxns.find((x) => x.id === selectedInv);
    setBankTxns((prev) =>
      prev.map((b) => (b.id === selectedBank ? { ...b, status: 'matched' as const, matchedTo: selectedInv } : b))
    );
    setInvTxns((prev) =>
      prev.map((i) => (i.id === selectedInv ? { ...i, status: 'matched' as const, matchedTo: selectedBank } : i))
    );
    if (bRow && iRow) {
      void saveMatchResultsToSupabase([{ invoice_number: iRow.ref, bank_ref: bRow.ref }]);
    }
    setSelectedBank(null);
    setSelectedInv(null);
    setAiLastSummary(null);
    toast({ title: 'Matched', description: 'Transaction matched successfully.' });
  }

  function flagSelected() {
    if (!selectedBank) {
      toast({ title: 'Select a bank transaction to flag.', variant: 'destructive' });
      return;
    }
    setBankTxns((prev) =>
      prev.map((b) => (b.id === selectedBank ? { ...b, status: 'flagged' as const } : b))
    );
    setSelectedBank(null);
    toast({ title: 'Flagged', description: 'Transaction flagged for review.' });
  }

  async function saveMatchResultsToSupabase(pairs: { invoice_number: string; bank_ref: string }[]) {
    const company = await getMyCompany();
    const companyId = company?.id;
    const now = new Date().toISOString();
    for (const p of pairs) {
      let q = supabase
        .from('invoices')
        .update({
          bank_reconciled: true,
          bank_ref: p.bank_ref,
          reconciled_at: now,
        })
        .eq('invoice_number', p.invoice_number);
      if (companyId) q = q.eq('company_id', companyId);
      const { error } = await q;
      if (error) {
        console.warn('Bank recon Supabase update:', p.invoice_number, error.message);
      }
    }
  }

  /** PASS 1: UTR / reference on bank line vs invoice UTR (100%). PASS 2: amount + vendor (~5% FX tolerance). */
  async function runAutoMatch() {
    if (bankTxns.length === 0) {
      toast({
        title: 'Upload a bank statement',
        description: 'Import a CSV on Import Statement or Reconciliation before running Auto Match.',
        variant: 'destructive',
      });
      return;
    }
    if (invTxns.length === 0) {
      toast({
        title: 'No invoices',
        description: 'Need Approved or Paid invoices in the database to match.',
        variant: 'destructive',
      });
      return;
    }

    const unB = bankTxns.filter((t) => t.status !== 'matched' && !t.ignored && t.type === 'debit');
    const unI = invTxns.filter((t) => t.status !== 'matched');
    if (!unB.length) {
      toast({
        title: 'Nothing to match',
        description: 'No unmatched debit lines. Credits stay separate; use Flag if needed.',
      });
      return;
    }
    if (!unI.length) {
      toast({ title: 'No open invoice rows', description: 'All invoice rows are already matched to bank.' });
      return;
    }

    setAiLoading(true);
    try {
      const nextBank: BankTxn[] = bankTxns.map((b) => ({
        ...b,
        reconHint: undefined,
        matchType: undefined,
      }));
      const nextInv: InvTxn[] = invTxns.map((i) => ({ ...i, reconHint: undefined }));
      const appliedPairs: { invoice_number: string; bank_ref: string }[] = [];
      let utrMatches = 0;
      let amtMatches = 0;

      const banksPass1 = [...unB].sort((a, b) => a.dateIso.localeCompare(b.dateIso) || a.amount - b.amount);

      for (const b of banksPass1) {
        const bi = nextBank.findIndex((x) => x.id === b.id);
        if (bi < 0 || nextBank[bi]!.status === 'matched') continue;

        const invMatch = nextInv.find(
          (inv) =>
            inv.status !== 'matched' &&
            (utrMatchesBankLine(inv.utr_number, b.ref, b.desc) ||
              bankLineMatchesInvoiceRefs(b.ref, b.desc, inv.ref))
        );
        if (!invMatch) continue;

        const ii = nextInv.findIndex((i) => i.id === invMatch.id);
        nextBank[bi] = {
          ...nextBank[bi]!,
          status: 'matched',
          matchedTo: invMatch.id,
          matchConfidence: 100,
          reconHint: 'Reference / UTR match',
          matchType: 'UTR/Reference',
          ignored: false,
        };
        if (ii >= 0) {
          nextInv[ii] = {
            ...nextInv[ii]!,
            status: 'matched',
            matchedTo: nextBank[bi]!.id,
            reconHint: 'Reference / UTR match',
          };
        }
        appliedPairs.push({ invoice_number: invMatch.ref, bank_ref: nextBank[bi]!.ref });
        utrMatches++;
      }

      const banksPass2 = nextBank
        .filter((t) => t.status !== 'matched' && !t.ignored && t.type === 'debit')
        .sort((a, b) => a.dateIso.localeCompare(b.dateIso) || a.amount - b.amount);

      for (const b of banksPass2) {
        const bi = nextBank.findIndex((x) => x.id === b.id);
        if (bi < 0 || nextBank[bi]!.status === 'matched') continue;
        if (b.amount <= 0) continue;

        let bestInv: InvTxn | null = null;
        let bestScore = -1;
        let bestAmtDiff = 1;

        for (const inv of nextInv) {
          if (inv.status !== 'matched') {
            const sameCurNear = inv.cur === nextBank[bi]!.cur && Math.abs(inv.amount - nextBank[bi]!.amount) < 0.02;
            const rel = amountRelDiffUsd(nextBank[bi]!.amount, nextBank[bi]!.cur, inv.amount, inv.cur);
            if (rel > 0.051 && !sameCurNear) continue;

            const denom = Math.max(inv.amount, 0.01);
            const amtDiff = Math.abs(nextBank[bi]!.amount - inv.amount) / denom;
            const firstTok = (inv.desc ?? '').split(/\s+/)[0]?.toLowerCase() || '';
            const vendorMatch =
              firstTok.length >= 2 &&
              (nextBank[bi]!.desc?.toLowerCase().includes(firstTok) ||
                nextBank[bi]!.ref?.toLowerCase().includes(firstTok));

            const score =
              (amtDiff <= 0.01 ? 60 : amtDiff <= 0.05 ? 40 : sameCurNear ? 35 : 0) + (vendorMatch ? 35 : 0);
            if (score > bestScore || (score === bestScore && amtDiff < bestAmtDiff)) {
              bestScore = score;
              bestAmtDiff = amtDiff;
              bestInv = inv;
            }
          }
        }

        if (!bestInv || bestScore < 60) continue;

        const ii = nextInv.findIndex((i) => i.id === bestInv!.id);
        const confidence = Math.min(Math.round(bestScore), 99);
        nextBank[bi] = {
          ...nextBank[bi]!,
          status: 'matched',
          matchedTo: bestInv.id,
          matchConfidence: confidence,
          reconHint: `Amount (${(bestAmtDiff * 100).toFixed(1)}% variance) + vendor`,
          matchType: 'Amount+Vendor',
          ignored: false,
        };
        if (ii >= 0) {
          nextInv[ii] = {
            ...nextInv[ii]!,
            status: 'matched',
            matchedTo: nextBank[bi]!.id,
            reconHint: 'Amount + vendor',
          };
        }
        appliedPairs.push({ invoice_number: bestInv.ref, bank_ref: nextBank[bi]!.ref });
        amtMatches++;
      }

      setBankTxns(nextBank);
      setInvTxns(nextInv);
      setAiLastSummary(
        `Auto Match: ${appliedPairs.length} pair(s) â€” ${utrMatches} by UTR/reference, ${amtMatches} by amount + vendor.`
      );

      if (appliedPairs.length) {
        await saveMatchResultsToSupabase(appliedPairs);
      }

      setActiveTab('report');
      toast({
        title: 'Auto Match complete',
        description: `${appliedPairs.length} bankâ†”invoice pair(s) applied.`,
      });
    } finally {
      setAiLoading(false);
    }
  }

  function addManualTxn() {
    const amount = parseFloat(manualForm.amount);
    if (!manualForm.desc || !manualForm.amount || isNaN(amount)) {
      toast({ title: 'Required', description: 'Fill in description and amount.', variant: 'destructive' });
      return;
    }
    const d = new Date(manualForm.date);
    const dateIso = Number.isNaN(d.getTime()) ? new Date().toISOString().slice(0, 10) : d.toISOString().slice(0, 10);
    const id = `b-${crypto.randomUUID()}`;
    setBankTxns((prev) => [
      ...prev,
      {
        id,
        date: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
        dateIso,
        desc: manualForm.desc,
        ref: manualForm.ref || 'â€”',
        amount,
        cur: manualForm.currency,
        type: manualForm.type,
        status: 'unmatched',
      },
    ]);
    setManualModalOpen(false);
    setManualForm({
      date: new Date().toISOString().slice(0, 10),
      currency: 'INR',
      desc: '',
      amount: '',
      type: 'debit',
      ref: '',
    });
    toast({ title: 'Added', description: 'Transaction added.' });
  }

  function exportReport() {
    const lines: string[] = [];
    const esc = (s: string) => `"${String(s).replace(/"/g, '""')}"`;
    lines.push('section,type,date,ref,description,amount,currency,status,confidence,match_type,note');
    for (const t of bankTxns.filter((x) => x.status === 'matched')) {
      const inv = invTxns.find((i) => i.id === t.matchedTo);
      lines.push(
        [
          'matched',
          'bank',
          esc(t.date),
          esc(t.ref),
          esc(t.desc),
          String(t.amount),
          t.cur,
          'matched',
          t.matchConfidence != null ? String(t.matchConfidence) : '',
          esc(t.matchType ?? ''),
          esc(inv?.ref ?? ''),
        ].join(',')
      );
    }
    for (const t of bankTxns.filter((x) => x.status !== 'matched')) {
      lines.push(
        [
          'unmatched_bank',
          'bank',
          esc(t.date),
          esc(t.ref),
          esc(t.desc),
          String(t.amount),
          t.cur,
          t.ignored ? 'ignored' : t.status,
          '',
          '',
          esc(t.reconHint ?? ''),
        ].join(',')
      );
    }
    for (const t of invTxns.filter((x) => x.status !== 'matched')) {
      lines.push(
        [
          'unmatched_invoice',
          'invoice',
          esc(t.date),
          esc(t.ref),
          esc(t.desc),
          String(t.amount),
          t.cur,
          'unmatched',
          '',
          '',
          esc(t.reconHint ?? ''),
        ].join(',')
      );
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bank-recon-export-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: 'Export ready', description: 'CSV download started.' });
  }

  const tabs = [
    { id: 'recon' as const, label: 'Reconciliation' },
    { id: 'import' as const, label: 'Import Statement' },
    { id: 'connect' as const, label: 'Bank API' },
    { id: 'report' as const, label: 'Report' },
  ];

  return (
    <div className="space-y-6">
      <input
        ref={bankStatementFileRef}
        type="file"
        accept=".csv,.txt,text/csv"
        className="sr-only"
        onChange={onBankStatementFileChange}
      />
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold text-gray-900">Bank Reconciliation</h1>
            <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 font-mono text-xs">
              BANK RECON
            </Badge>
          </div>
          <p className="mt-1 text-sm text-gray-500">
            Upload your bank statement CSV â†’ match payments to invoices using UTR/reference numbers first, then amounts
            and vendor names â†’ export a reconciliation report. Manual match remains for overrides.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="font-normal text-gray-600 max-w-[220px] truncate" title={statementRangeLabel}>
            {statementRangeLabel}
          </Badge>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => bankStatementFileRef.current?.click()}
          >
            <Upload className="mr-2 h-4 w-4" />
            Upload CSV
          </Button>
          <Button variant="outline" size="sm" onClick={() => setManualModalOpen(true)}>
            + Add Transaction
          </Button>
            <Button size="sm" className="bg-[#0A4B8F]" onClick={exportReport}>
            <Download className="mr-2 h-4 w-4" />
            Export CSV
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={cn(
              'px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors',
              activeTab === t.id
                ? 'border-[#0A4B8F] text-[#0A4B8F]'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-px bg-gray-200 rounded-lg overflow-hidden">
        {[
          { label: 'Bank Transactions', value: bankTxns.length, sub: 'from statement' },
          { label: 'Invoice Payments', value: invTxns.length, sub: 'approved / paid' },
          { label: 'Matched', value: matchedCount, sub: `${matchRatePct}% of bank lines`, green: true },
          { label: 'Unmatched bank', value: unmatchedBankVendor, sub: 'debits, no invoice', amber: true },
          { label: 'Ignored / other', value: ignoredBankCount, sub: 'fees, receipts, non-AP' },
          { label: 'Unmatched invoices', value: unmatchedInvCount, sub: 'no bank line', amber: true },
        ].map((s) => (
          <div key={s.label} className="bg-white p-4">
            <div className="text-xs text-gray-500 font-mono uppercase tracking-wide">{s.label}</div>
            <div
              className={cn(
                'text-xl font-bold mt-0.5',
                s.green && 'text-green-600',
                s.amber && 'text-amber-600'
              )}
            >
              {s.value}
            </div>
            <div className="text-xs text-gray-500 mt-0.5">{s.sub}</div>
          </div>
        ))}
      </div>

      {invLoadError && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          Invoice list could not be loaded (match against bank lines once this is fixed): {invLoadError}
        </div>
      )}

      {/* Reconciliation view */}
      {activeTab === 'recon' && (
        <div className="flex flex-col gap-4">
          <div className="rounded-lg border border-blue-100 bg-blue-50/80 px-4 py-3 text-sm text-blue-950">
            <span className="font-medium">Tip:</span> Capture UTR or NEFT reference when you mark an invoice paid. Bank
            recon then matches that reference first (typically 100% confidence), with amount + vendor as a fallback for
            older rows.
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 min-h-[400px]">
            {/* Bank panel */}
            <Card>
              <CardHeader className="py-3 px-4 flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-base">Bank Statement</CardTitle>
                  <p className="text-xs text-gray-500 font-mono mt-0.5">
                    {filteredBank.length} shown Â· {bankTxns.length} loaded
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => bankStatementFileRef.current?.click()}
                >
                  <Upload className="mr-1 h-3.5 w-3.5" />
                  Upload CSV
                </Button>
              </CardHeader>
              <CardContent className="p-0">
                <div className="flex gap-2 p-3 border-b border-gray-100 flex-wrap">
                  <Input
                    placeholder="Search..."
                    value={bankSearch}
                    onChange={(e) => setBankSearch(e.target.value)}
                    className="h-8 w-40 text-sm"
                  />
                  {['ALL', 'USD', 'EUR', 'GBP', 'INR'].map((c) => (
                    <button
                      key={c}
                      onClick={() => setBankCurFilter(c)}
                      className={cn(
                        'px-2.5 py-1 text-xs font-mono rounded border',
                        bankCurFilter === c ? 'bg-blue-50 text-blue-700 border-blue-200' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                      )}
                    >
                      {c}
                    </button>
                  ))}
                </div>
                <div className="max-h-[320px] overflow-y-auto">
                  {filteredBank.length === 0 ? (
                    <div className="py-12 text-center text-gray-500">
                      <Landmark className="mx-auto h-10 w-10 text-gray-300" />
                      <p className="mt-2 text-sm">{bankTxns.length === 0 ? 'Upload a CSV bank statement or add a transaction.' : 'No transactions match filters.'}</p>
                    </div>
                  ) : (
                    filteredBank.map((t) => (
                      <div
                        key={t.id}
                        onClick={() => t.status !== 'matched' && setSelectedBank(selectedBank === t.id ? null : t.id)}
                        className={cn(
                          'grid grid-cols-[24px_1fr_auto_auto] gap-2 items-center px-4 py-2.5 border-b border-gray-50 cursor-pointer hover:bg-gray-50/80',
                          t.status === 'matched' && 'bg-green-50/50 opacity-75',
                          t.status === 'flagged' && 'bg-red-50/50',
                          selectedBank === t.id && 'bg-blue-50 border-l-2 border-l-[#0A4B8F]'
                        )}
                      >
                        <div
                          className={cn(
                            'w-4 h-4 rounded border flex items-center justify-center text-white text-[10px]',
                            t.status === 'matched' ? 'bg-green-600 border-green-600' : selectedBank === t.id ? 'bg-[#0A4B8F] border-[#0A4B8F]' : 'border-gray-300'
                          )}
                        >
                          {(t.status === 'matched' || selectedBank === t.id) && <Check className="h-2.5 w-2.5" />}
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-medium truncate">{t.desc}</div>
                          <div className="text-xs text-gray-500 font-mono">{t.date} Â· {t.ref}</div>
                        </div>
                        <div className="flex flex-col gap-0.5 items-end">
                          {t.status === 'matched' && <Badge className="text-[10px] bg-green-100 text-green-800">matched</Badge>}
                          {t.ignored && t.status !== 'matched' && (
                            <Badge className="text-[10px] bg-slate-100 text-slate-700 border-slate-200">ignored</Badge>
                          )}
                          {t.status !== 'matched' && !t.ignored && t.type === 'debit' && (
                            <Badge className="text-[10px] bg-amber-50 text-amber-800 border-amber-200">unmatched</Badge>
                          )}
                          {t.status === 'flagged' && <Badge variant="destructive" className="text-[10px]">flagged</Badge>}
                          <Badge variant="outline" className="text-[10px]">{t.cur}</Badge>
                        </div>
                        <div className={cn('text-sm font-mono font-medium', t.type === 'debit' ? 'text-red-600' : 'text-green-600')}>
                          {t.type === 'debit' ? 'âˆ’' : '+'}{fmt(t.amount, t.cur)}
                        </div>
                      </div>
                    ))
                  )}
                </div>
                <div className="px-4 py-2 border-t border-gray-100 flex items-center justify-between text-xs text-gray-500 bg-gray-50/50">
                  <span>{selectedBank ? `Selected: ${bankTxns.find((x) => x.id === selectedBank)?.desc}` : 'Select a bank transaction to match'}</span>
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={flagSelected}>
                    <Flag className="mr-1 h-3 w-3" /> Flag
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Invoice panel */}
            <Card>
              <CardHeader className="py-3 px-4 flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-base">Invoice Payments</CardTitle>
                  <p className="text-xs text-gray-500 font-mono mt-0.5">
                    {filteredInv.length} shown Â· {invTxns.length} Approved/Paid from database
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  className="bg-green-600 hover:bg-green-700"
                  onClick={() => void runAutoMatch()}
                  disabled={aiLoading}
                >
                  {aiLoading ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1 h-3.5 w-3.5" />}
                  Auto match
                </Button>
              </CardHeader>
              <CardContent className="p-0">
                <div className="flex gap-2 p-3 border-b border-gray-100 flex-wrap">
                  <Input
                    placeholder="Search..."
                    value={invSearch}
                    onChange={(e) => setInvSearch(e.target.value)}
                    className="h-8 w-40 text-sm"
                  />
                  {['ALL', 'USD', 'EUR', 'GBP', 'INR'].map((c) => (
                    <button
                      key={c}
                      onClick={() => setInvCurFilter(c)}
                      className={cn(
                        'px-2.5 py-1 text-xs font-mono rounded border',
                        invCurFilter === c ? 'bg-blue-50 text-blue-700 border-blue-200' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                      )}
                    >
                      {c}
                    </button>
                  ))}
                </div>
                <div className="max-h-[320px] overflow-y-auto">
                  {filteredInv.length === 0 ? (
                    <div className="py-12 text-center text-gray-500">
                      <Landmark className="mx-auto h-10 w-10 text-gray-300" />
                      <p className="mt-2 text-sm">
                        {invTxns.length === 0
                          ? 'No Approved or Paid invoices yet, or list failed to load.'
                          : 'No invoices match filters.'}
                      </p>
                    </div>
                  ) : (
                    filteredInv.map((t) => (
                      <div
                        key={t.id}
                        onClick={() => t.status !== 'matched' && setSelectedInv(selectedInv === t.id ? null : t.id)}
                        className={cn(
                          'grid grid-cols-[24px_1fr_auto_auto] gap-2 items-center px-4 py-2.5 border-b border-gray-50 cursor-pointer hover:bg-gray-50/80',
                          t.status === 'matched' && 'bg-green-50/50 opacity-75',
                          selectedInv === t.id && 'bg-blue-50 border-l-2 border-l-[#0A4B8F]'
                        )}
                      >
                        <div
                          className={cn(
                            'w-4 h-4 rounded border flex items-center justify-center text-white text-[10px]',
                            t.status === 'matched' ? 'bg-green-600 border-green-600' : selectedInv === t.id ? 'bg-[#0A4B8F] border-[#0A4B8F]' : 'border-gray-300'
                          )}
                        >
                          {(t.status === 'matched' || selectedInv === t.id) && <Check className="h-2.5 w-2.5" />}
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-medium truncate">{t.desc}</div>
                          <div className="text-xs text-gray-500 font-mono">{t.date} Â· {t.ref}</div>
                        </div>
                        <div>
                          {t.status === 'matched' && <Badge className="text-[10px] bg-green-100 text-green-800">matched</Badge>}
                          {t.status !== 'matched' && (
                            <Badge className="text-[10px] bg-amber-50 text-amber-800 border-amber-200 ml-0">unmatched</Badge>
                          )}
                          <Badge variant="outline" className="text-[10px] ml-1">{t.cur}</Badge>
                        </div>
                        <div className="text-sm font-mono font-medium text-red-600">âˆ’{fmt(t.amount, t.cur)}</div>
                      </div>
                    ))
                  )}
                </div>
                <div className="px-4 py-2 border-t border-gray-100 flex items-center justify-between text-xs text-gray-500 bg-gray-50/50">
                  <span>{selectedInv ? `Selected: ${invTxns.find((x) => x.id === selectedInv)?.desc}` : 'Select an invoice to match with bank'}</span>
                  <Button type="button" size="sm" className="bg-[#0A4B8F] h-7 text-xs" onClick={confirmMatch}>
                    <Check className="mr-1 h-3 w-3" /> Match Selected
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Auto-match helper */}
          <Card>
            <CardHeader className="py-2 px-4">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-purple-500" />
                <CardTitle className="text-sm">Auto match (UTR first, then amount)</CardTitle>
                <span className="text-xs text-gray-500 font-mono ml-auto">One click applies all pairs</span>
              </div>
            </CardHeader>
            <CardContent className="py-2 px-4 space-y-3">
              {aiLastSummary && (
                <p className="text-sm text-green-900 bg-green-50 border border-green-200 rounded-md px-3 py-2">{aiLastSummary}</p>
              )}
              {!aiLastSummary && !aiLoading && (
                <p className="text-sm text-gray-500">
                  Click <span className="font-semibold text-purple-600">Auto match</span> above â€” UTR/reference pairs
                  first, then amount + vendor fallback â€” then open the <strong>Report</strong> tab.
                </p>
              )}
              {aiLoading && (
                <div className="flex items-center gap-2 text-sm text-gray-500">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Matching all lines (amounts, vendors, dates, refs)â€¦
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Import view */}
      {activeTab === 'import' && (
        <Card className="max-w-2xl">
          <CardHeader>
            <CardTitle>Import Bank Statement</CardTitle>
            <p className="text-sm text-gray-500 mt-1">
              Upload a CSV export from your bank. Headers are detected automatically (Date; Amount or Debit/Credit; Description; Reference; optional Currency).
            </p>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2 max-w-xs">
              <Label className="text-xs font-mono uppercase text-gray-500">Default currency if CSV has no currency column</Label>
              <Select value={importDefaultCurrency} onValueChange={setImportDefaultCurrency}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {['USD', 'EUR', 'GBP', 'INR', 'AED', 'SGD', 'AUD'].map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <button
              type="button"
              className={cn(
                'flex w-full flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 cursor-pointer transition-colors',
                'border-gray-300 hover:border-blue-400 hover:bg-blue-50/30'
              )}
              onClick={() => bankStatementFileRef.current?.click()}
            >
              <FolderOpen className="h-12 w-12 text-amber-500 mb-3" />
              <span className="font-medium text-gray-700">Choose bank statement CSV</span>
              <span className="text-sm text-gray-500 mt-1 text-center px-4">
                Excel (.xlsx), OFX, and QIF are not parsed in the browser yetâ€”export from your bank as CSV.
              </span>
            </button>
            <div className="rounded-lg border border-blue-100 bg-blue-50/80 px-4 py-3 text-sm text-blue-950">
              <span className="font-medium">Tip:</span> When paying an invoice, enter the UTR or NEFT reference on the
              invoice payment screen. That gives the most reliable match to your bank statementâ€”often a single exact hit
              instead of amount guessing.
            </div>
          </CardContent>
        </Card>
      )}

      {/* Bank API view */}
      {activeTab === 'connect' && (
        <Card className="max-w-2xl">
          <CardHeader>
            <CardTitle>Connect Bank API</CardTitle>
            <p className="text-sm text-gray-500 mt-1">
              Direct bank feeds are not configured yet. Use the Import Statement tab to upload a CSV from your bank.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-gray-600">
              When enabled, providers such as Plaid, TrueLayer, or regional open-banking APIs can pull transactions automatically. No connection is active in this build.
            </p>
            <Button variant="outline" size="sm" onClick={() => setActiveTab('import')}>
              <Upload className="mr-2 h-4 w-4" />
              Go to Import Statement
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Report view */}
      {activeTab === 'report' && (
        <Card className="max-w-3xl">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Reconciliation Report</CardTitle>
              <p className="text-xs text-gray-500 font-mono mt-1">
                {statementRangeLabel} Â· Generated {new Date().toLocaleDateString('en-US')}
              </p>
            </div>
            <Button className="bg-[#0A4B8F]" onClick={exportReport}>
              <Download className="mr-2 h-4 w-4" /> Export CSV
            </Button>
          </CardHeader>
          <CardContent className="space-y-6">
            {aiLastSummary && (
              <p className="text-sm text-blue-900 bg-blue-50 border border-blue-100 rounded-md px-3 py-2">{aiLastSummary}</p>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {[
                { label: 'Bank lines', value: bankTxns.length },
                { label: 'Matched', value: matchedCount, green: true },
                { label: 'Unmatched bank', value: unmatchedBankLinesCount, amber: true },
                { label: 'Ignored / non-AP', value: ignoredBankCount },
                { label: 'Unmatched invoices', value: unmatchedInvCount, amber: true },
                { label: 'Invoice rows', value: invTxns.length },
              ].map((c) => (
                <div key={c.label} className="rounded-lg border border-gray-200 bg-white p-3">
                  <div className="text-[10px] font-mono uppercase text-gray-500">{c.label}</div>
                  <div
                    className={cn(
                      'text-lg font-bold',
                      c.green && 'text-green-600',
                      c.amber && 'text-amber-600'
                    )}
                  >
                    {c.value}
                  </div>
                </div>
              ))}
            </div>
            <div>
              <h3 className="font-semibold text-gray-900 mb-2">Summary</h3>
              <div className="overflow-hidden rounded-lg border border-gray-200">
                <table className="w-full text-sm">
                  <tbody>
                    {[
                      ['Bank lines loaded', String(bankTxns.length)],
                      ['Invoice payments (Approved/Paid)', String(invTxns.length)],
                      ['Matched bank lines', String(matchedCount)],
                      ['Unmatched / flagged bank lines', String(unmatchedBankLinesCount)],
                      [
                        'Debits (USD equiv., indicative)',
                        reportDebitUsd ? `âˆ’$${reportDebitUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : 'â€”',
                      ],
                      [
                        'Credits (USD equiv., indicative)',
                        reportCreditUsd ? `+$${reportCreditUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : 'â€”',
                      ],
                      [
                        'Flagged amount (USD equiv., indicative)',
                        flaggedDiff > 0 ? `$${flaggedDiff.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : 'â€”',
                      ],
                    ].map(([label, val], i) => (
                      <tr
                        key={label}
                        className={cn(
                          'border-b border-gray-100 last:border-0',
                          i === 6 && flaggedDiff > 0 ? 'bg-red-50' : ''
                        )}
                      >
                        <td className="py-2.5 px-4 font-medium">{label}</td>
                        <td
                          className={cn(
                            'py-2.5 px-4 text-right font-mono',
                            String(val).startsWith('âˆ’') ? 'text-red-600' : String(val).startsWith('+') ? 'text-green-600' : 'text-gray-600'
                          )}
                        >
                          {val}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <h3 className="font-semibold text-gray-900 mb-2">âœ“ Matched Transactions ({bankTxns.filter((t) => t.status === 'matched').length})</h3>
              <div className="overflow-hidden rounded-lg border border-gray-200">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="text-left py-2 px-4 text-xs font-mono text-gray-500 uppercase">Bank Date</th>
                      <th className="text-left py-2 px-4 text-xs font-mono text-gray-500 uppercase">Vendor / Description</th>
                      <th className="text-left py-2 px-4 text-xs font-mono text-gray-500 uppercase">Invoice #</th>
                      <th className="text-left py-2 px-4 text-xs font-mono text-gray-500 uppercase">Currency</th>
                      <th className="text-right py-2 px-4 text-xs font-mono text-gray-500 uppercase">Amount</th>
                      <th className="text-right py-2 px-4 text-xs font-mono text-gray-500 uppercase">Conf.</th>
                      <th className="text-left py-2 px-4 text-xs font-mono text-gray-500 uppercase">Match type</th>
                      <th className="text-left py-2 px-4 text-xs font-mono text-gray-500 uppercase">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bankTxns
                      .filter((t) => t.status === 'matched')
                      .map((t) => {
                        const inv = invTxns.find((i) => i.id === t.matchedTo);
                        return (
                          <tr key={t.id} className="border-b border-gray-100 hover:bg-gray-50/50">
                            <td className="py-2 px-4 font-mono text-xs">{t.date}</td>
                            <td className="py-2 px-4">{t.desc}</td>
                            <td className="py-2 px-4 font-mono text-gray-500">{inv?.ref ?? '-'}</td>
                            <td><Badge variant="outline" className="text-xs">{t.cur}</Badge></td>
                            <td className="py-2 px-4 text-right font-mono">{fmt(t.amount, t.cur)}</td>
                            <td className="py-2 px-4 text-right font-mono text-xs text-gray-600">
                              {t.matchConfidence != null ? `${t.matchConfidence}%` : 'â€”'}
                            </td>
                            <td className="py-2 px-4">
                              {t.matchType === 'UTR/Reference' ? (
                                <Badge className="bg-emerald-100 text-emerald-900 border-emerald-200 text-[10px]">
                                  Reference match
                                </Badge>
                              ) : t.matchType === 'Amount+Vendor' ? (
                                <Badge className="bg-amber-50 text-amber-900 border-amber-200 text-[10px]">
                                  Amount match
                                </Badge>
                              ) : (
                                <span className="text-xs text-gray-500">â€”</span>
                              )}
                            </td>
                            <td><Badge className="bg-green-100 text-green-800 text-xs">âœ“ matched</Badge></td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <h3 className="font-semibold text-gray-900 mb-2">âš‘ Unmatched / Flagged ({bankTxns.filter((t) => t.status !== 'matched').length})</h3>
              <div className="overflow-hidden rounded-lg border border-gray-200">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="text-left py-2 px-4 text-xs font-mono text-gray-500 uppercase">Date</th>
                      <th className="text-left py-2 px-4 text-xs font-mono text-gray-500 uppercase">Description</th>
                      <th className="text-left py-2 px-4 text-xs font-mono text-gray-500 uppercase">Currency</th>
                      <th className="text-right py-2 px-4 text-xs font-mono text-gray-500 uppercase">Amount</th>
                      <th className="text-left py-2 px-4 text-xs font-mono text-gray-500 uppercase">Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bankTxns
                      .filter((t) => t.status !== 'matched')
                      .map((t) => (
                        <tr key={t.id} className="border-b border-gray-100 hover:bg-gray-50/50">
                          <td className="py-2 px-4 font-mono text-xs">{t.date}</td>
                          <td className="py-2 px-4">{t.desc}</td>
                          <td><Badge variant="outline" className="text-xs">{t.cur}</Badge></td>
                          <td className={cn('py-2 px-4 text-right font-mono', t.type === 'debit' ? 'text-red-600' : 'text-green-600')}>
                            {t.type === 'debit' ? 'âˆ’' : '+'}{fmt(t.amount, t.cur)}
                          </td>
                          <td className="text-xs text-gray-600 max-w-[220px]">
                            {t.status === 'flagged' ? (
                              <Badge variant="destructive" className="text-xs">
                                Flagged
                              </Badge>
                            ) : (
                              <span>{t.reconHint || (t.ignored ? 'Ignored / non-AP' : 'No match found')}</span>
                            )}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <h3 className="font-semibold text-gray-900 mb-2">Unmatched invoice payments ({unmatchedInvCount})</h3>
              <div className="overflow-hidden rounded-lg border border-gray-200">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="text-left py-2 px-4 text-xs font-mono text-gray-500 uppercase">Date</th>
                      <th className="text-left py-2 px-4 text-xs font-mono text-gray-500 uppercase">Vendor</th>
                      <th className="text-left py-2 px-4 text-xs font-mono text-gray-500 uppercase">Invoice #</th>
                      <th className="text-left py-2 px-4 text-xs font-mono text-gray-500 uppercase">CCY</th>
                      <th className="text-right py-2 px-4 text-xs font-mono text-gray-500 uppercase">Amount</th>
                      <th className="text-left py-2 px-4 text-xs font-mono text-gray-500 uppercase">Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invTxns
                      .filter((t) => t.status !== 'matched')
                      .map((t) => (
                        <tr key={t.id} className="border-b border-gray-100 hover:bg-gray-50/50">
                          <td className="py-2 px-4 font-mono text-xs">{t.date}</td>
                          <td className="py-2 px-4">{t.desc}</td>
                          <td className="py-2 px-4 font-mono text-gray-600">{t.ref}</td>
                          <td>
                            <Badge variant="outline" className="text-xs">
                              {t.cur}
                            </Badge>
                          </td>
                          <td className="py-2 px-4 text-right font-mono text-red-600">âˆ’{fmt(t.amount, t.cur)}</td>
                          <td className="text-xs text-gray-600">{t.reconHint ?? 'â€”'}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <h3 className="font-semibold text-gray-900 mb-2">FX Rates Applied (Base: USD)</h3>
              <div className="overflow-hidden rounded-lg border border-gray-200">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="text-left py-2 px-4 text-xs font-mono text-gray-500 uppercase">Currency</th>
                      <th className="text-left py-2 px-4 text-xs font-mono text-gray-500 uppercase">Rate</th>
                      <th className="text-left py-2 px-4 text-xs font-mono text-gray-500 uppercase">Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(FX_RATES)
                      .filter(([c]) => c !== 'USD')
                      .map(([cur, rate]) => (
                        <tr key={cur} className="border-b border-gray-100 last:border-0">
                          <td className="py-2 px-4">{cur}</td>
                          <td className="py-2 px-4 font-mono">{String(rate)}</td>
                          <td className="py-2 px-4 text-gray-500">Indicative vs USD (report estimates only)</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Manual entry modal */}
      <Dialog open={manualModalOpen} onOpenChange={setManualModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Bank Transaction</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Date</Label>
              <Input type="date" value={manualForm.date} onChange={(e) => setManualForm({ ...manualForm, date: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Currency</Label>
              <Select value={manualForm.currency} onValueChange={(v) => setManualForm({ ...manualForm, currency: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['USD', 'EUR', 'GBP', 'INR', 'AED', 'SGD', 'AUD'].map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2 space-y-2">
              <Label>Description</Label>
              <Input placeholder="e.g. NEFT / vendor name / bank narration" value={manualForm.desc} onChange={(e) => setManualForm({ ...manualForm, desc: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Amount</Label>
              <Input type="number" placeholder="42500.00" value={manualForm.amount} onChange={(e) => setManualForm({ ...manualForm, amount: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Type</Label>
              <Select value={manualForm.type} onValueChange={(v: 'debit' | 'credit') => setManualForm({ ...manualForm, type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="debit">Debit (payment out)</SelectItem>
                  <SelectItem value="credit">Credit (receipt in)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2 space-y-2">
              <Label>Reference / Cheque No.</Label>
              <Input placeholder="e.g. CHQ-10021 / UTR / SWIFT ref" value={manualForm.ref} onChange={(e) => setManualForm({ ...manualForm, ref: e.target.value })} />
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setManualModalOpen(false)}>Cancel</Button>
            <Button className="bg-[#0A4B8F]" onClick={addManualTxn}>Add Transaction</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

