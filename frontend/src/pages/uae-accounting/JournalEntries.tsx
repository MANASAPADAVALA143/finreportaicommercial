/**
 * Journal Entries — GL drill-down, double-entry ledger
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, RefreshCw, ChevronDown, ChevronRight, CheckCircle, Clock, Search, Upload, AlertTriangle, FileText, Trash2 } from 'lucide-react';
import * as XLSX from 'xlsx';
import * as svc from '../../services/uaeFullAccounting.service';
import type { JournalEntry, JournalLine, UAEAccount } from '../../services/uaeFullAccounting.service';
import { useClient } from '../../context/ClientContext';
import { syncJournalLinesToR2R, uaeJEToHistoryEntries } from '../../services/r2rHistorySync';

const SOURCE_COLORS: Record<string, string> = {
  manual:     'bg-blue-900/40 text-blue-400 border-blue-700',
  ar_invoice: 'bg-green-900/40 text-green-400 border-green-700',
  depreciation:'bg-purple-900/40 text-purple-400 border-purple-700',
  accrual:    'bg-amber-900/40 text-amber-400 border-amber-700',
  bank_recon: 'bg-cyan-900/40 text-cyan-400 border-cyan-700',
};

const THIS_PERIOD = new Date().toISOString().slice(0, 7);

function accountLabel(code: string, name: string | undefined, coa: Record<string, string>): string {
  const n = (name || coa[code] || '').trim();
  return n ? `${code} ${n}` : code;
}

function accountSummary(
  lines: JournalLine[] | undefined,
  coa: Record<string, string>,
): string {
  if (!lines?.length) return '';
  const debitLine = lines.find(l => l.debit > 0) ?? lines[0];
  const creditLine = lines.find(l => l.credit > 0) ?? lines[lines.length - 1];
  return `${accountLabel(debitLine.account_code, debitLine.account_name, coa)} → ${accountLabel(creditLine.account_code, creditLine.account_name, coa)}`;
}

const MONTHS: Record<string, string> = {
  Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
  Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
};

function parseExcelDate(d: unknown): string {
  if (!d) return new Date().toISOString().slice(0, 10);
  if (typeof d === 'number') {
    const parsed = XLSX.SSF.parse_date_code(d);
    if (parsed) {
      return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
    }
  }
  const s = String(d).trim();
  const m1 = s.match(/^(\d{1,2})[/-]([A-Za-z]{3})[/-](\d{2,4})$/);
  if (m1) {
    const yr = m1[3].length === 2 ? `20${m1[3]}` : m1[3];
    const mon = MONTHS[m1[2].charAt(0).toUpperCase() + m1[2].slice(1).toLowerCase()] || '01';
    return `${yr}-${mon}-${m1[1].padStart(2, '0')}`;
  }
  const m2 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m2) return `${m2[3]}-${m2[2].padStart(2, '0')}-${m2[1].padStart(2, '0')}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return new Date().toISOString().slice(0, 10);
}

function periodEndDate(period: string): string {
  const [y, m] = period.slice(0, 7).split('-').map(Number);
  if (!y || !m) return new Date().toISOString().slice(0, 10);
  const last = new Date(y, m, 0).getDate();
  return `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
}

function isAccrualsPrepaymentsSheet(rows: Record<string, unknown>[]): boolean {
  if (!rows.length) return false;
  const hasJeKey = rows.some(r =>
    String(r.je_number ?? r['JE Number'] ?? r.reference ?? r.ref ?? '').trim()
  );
  if (hasJeKey) return false;
  return rows.some(r => {
    const amt = Number(String(r.amount_aed ?? r.amount ?? 0).replace(/,/g, '')) || 0;
    const code = String(r.gl_code ?? r.account_code ?? r.GL ?? '').trim();
    return amt > 0 && code.length > 0;
  });
}

function normalizeAccountCode(raw: unknown): string {
  if (raw === null || raw === undefined || raw === '') return '';
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(Math.trunc(raw));
  const s = String(raw).trim();
  return /^\d+(\.0+)?$/.test(s) ? s.replace(/\.0+$/, '') : s;
}

function resolveCreditAccount(
  coaMap: Record<string, string>,
  accrualType: string,
  glCode: string,
  explicitCredit?: string,
): string {
  if (explicitCredit) {
    const c = normalizeAccountCode(explicitCredit);
    if (!coaMap[c]) throw new Error(`Account ${c} not found in Chart of Accounts`);
    return c;
  }
  const t = accrualType.toLowerCase();
  if (t.includes('prepay')) {
    for (const c of ['1012', '1010', '1000']) {
      if (coaMap[c]) return c;
    }
    throw new Error('No bank account found in Chart of Accounts for prepayment credit (e.g. 1012)');
  }
  if (glCode.startsWith('610') || glCode.startsWith('7101')) {
    for (const c of ['3021', '2104', '2103', '3020']) {
      if (coaMap[c]) return c;
    }
  }
  for (const c of ['2103', '3020', '3022', '2500']) {
    if (coaMap[c]) return c;
  }
  const byName = Object.entries(coaMap).find(([, n]) => /accrued\s*expense/i.test(n));
  if (byName) return byName[0];
  throw new Error('No accrued expenses liability account in Chart of Accounts (add 2103 or 3020)');
}

type JeImportBundle = { header: {
  reference: string; entry_date: string; description: string; source: string;
}; lines: { account_code: string; account_name: string; debit: number; credit: number; description: string }[] };

function buildAccrualsPrepaymentsJEs(
  rows: Record<string, unknown>[],
  defaultPeriod: string,
  coaMap: Record<string, string>,
): { bundles: JeImportBundle[]; errors: string[] } {
  const out: JeImportBundle[] = [];
  const errors: string[] = [];
  rows.forEach((r, idx) => {
    const desc = String(r.description ?? r.Description ?? '').trim();
    const gl = normalizeAccountCode(r.gl_code ?? r.GL ?? r.account_code);
    const amount = Number(String(r.amount_aed ?? r.amount ?? r.Amount ?? 0).replace(/,/g, '')) || 0;
    if (!desc && !gl && !amount) return;
    if (!desc || !gl || amount <= 0) {
      errors.push(`Row ${idx + 1}: missing description, gl_code, or amount`);
      return;
    }

    try {
      if (!coaMap[gl]) throw new Error(`Account ${gl} not found in Chart of Accounts`);

      const periodStr = String(r.period ?? r.Period ?? defaultPeriod).trim().slice(0, 7);
      const entryDate = periodEndDate(periodStr);
      const accType = String(r.accrual_type ?? r.type ?? '');
      const explicitCredit = String(
        r.credit_gl ?? r.credit_account ?? r.credit_code ?? r.credit_gl_code ?? ''
      ).trim();
      const credit = resolveCreditAccount(
        coaMap, accType, gl, explicitCredit || undefined,
      );
      const ref = `ACC-${periodStr}-${String(idx + 1).padStart(3, '0')}`;

      out.push({
        header: {
          reference: ref,
          entry_date: entryDate,
          description: desc,
          source: 'accrual',
        },
        lines: [
          {
            account_code: gl,
            account_name: coaMap[gl] || '',
            debit: amount,
            credit: 0,
            description: desc,
          },
          {
            account_code: credit,
            account_name: coaMap[credit] || '',
            debit: 0,
            credit: amount,
            description: desc,
          },
        ],
      });
    } catch (err: unknown) {
      errors.push(`Row ${idx + 1} (${desc}): ${err instanceof Error ? err.message : String(err)}`);
    }
  });
  return { bundles: out, errors };
}

function buildStandardExcelJEs(rows: Record<string, string>[]): Map<string, JeImportBundle> {
  const jeMap = new Map<string, JeImportBundle>();
  for (const r of rows) {
    const jeNum = String(r.je_number || r['JE Number'] || r.reference || r.ref || '').trim();
    if (!jeNum) continue;
    if (!jeMap.has(jeNum)) {
      const rawDate = r.date || r.gl_date || '';
      const isoDate = parseExcelDate(rawDate);
      jeMap.set(jeNum, {
        header: {
          reference: jeNum,
          entry_date: isoDate,
          description: r.description || '',
          source: String(r.source || 'manual').toLowerCase(),
        },
        lines: [],
      });
    }
    const je = jeMap.get(jeNum)!;
    const debit = parseFloat(String(r.debit_aed || r.debit || 0).replace(/,/g, '')) || 0;
    const credit = parseFloat(String(r.credit_aed || r.credit || 0).replace(/,/g, '')) || 0;
    if (debit === 0 && credit === 0) continue;
    je.lines.push({
      account_code: String(r.account_code || r.account || ''),
      account_name: String(r.account_name || r.description || ''),
      debit, credit,
      description: r.description || '',
    });
    if (!je.header.description && r.description) je.header.description = r.description;
  }
  return jeMap;
}

export default function JournalEntries() {
  const navigate = useNavigate();
  const { activeClient } = useClient();
  const companyId = activeClient?.companyId || 'default';
  const [entries, setEntries]     = useState<JournalEntry[]>([]);
  const [loading, setLoading]     = useState(true);
  const [period, setPeriod]       = useState(THIS_PERIOD);
  const [expanded, setExpanded]   = useState<Set<string>>(new Set());
  const [details, setDetails]     = useState<Record<string, JournalEntry>>({});
  const [error, setError]         = useState('');
  const [sendingR2R, setSendingR2R] = useState(false);
  const [r2rMsg, setR2rMsg]       = useState('');
  const [validating, setValidating] = useState<string>('');
  const [approving, setApproving] = useState<string>('');
  const [deleting, setDeleting] = useState<string>('');
  const [coaMap, setCoaMap] = useState<Record<string, string>>({});
  const [riskResults, setRiskResults] = useState<Record<string, { risk_score: number; risk_level: string; status: string }>>({});
  const [r2rSyncCount, setR2rSyncCount] = useState<number>(0);

  // Load R2R sync count after entries load
  const refreshR2rCount = () => {
    fetch('/api/r2r/baseline-status/demo?country=UAE')
      .then(r => r.json())
      .then(d => setR2rSyncCount(d.total_entries || 0))
      .catch(() => {});
  };

  const handleSyncToR2R = async () => {
    setSendingR2R(true);
    try {
      const res = await fetch('/api/r2r/sync-from-accounting', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': 'demo' },
        body: JSON.stringify({ company_id: 'demo', country: 'UAE', period }),
      });
      const d = await res.json();
      setR2rMsg(`✅ Synced ${d.synced} entries to R2R baseline`);
      refreshR2rCount();
    } catch (e: any) {
      setR2rMsg('⚠️ R2R sync failed');
    } finally {
      setSendingR2R(false);
    }
  };

  const load = () => {
    setLoading(true);
    svc.listJournals({ period })
      .then(d => setEntries(d.entries))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    svc.listAccounts()
      .then(d => {
        const map: Record<string, string> = {};
        for (const a of d.accounts as UAEAccount[]) map[a.account_code] = a.account_name;
        setCoaMap(map);
      })
      .catch(() => { /* COA optional for display */ });
  }, []);

  useEffect(() => { load(); refreshR2rCount(); }, [period]);

  const toggle = async (id: string) => {
    const next = new Set(expanded);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
      if (!details[id]) {
        const je = await svc.getJE(id).catch(() => null);
        if (je) setDetails(d => ({ ...d, [id]: je }));
      }
    }
    setExpanded(next);
  };

  const syncPostedToR2R = async (je: JournalEntry) => {
    try {
      const historyEntries = uaeJEToHistoryEntries(
        { ...je, lines: (je as { lines?: unknown[] }).lines as Parameters<typeof uaeJEToHistoryEntries>[0]['lines'] },
        companyId,
      );
      if (historyEntries.length > 0) {
        const uploadMonth = (je.entry_date || period).slice(0, 7);
        await syncJournalLinesToR2R({ companyId, uploadMonth, entries: historyEntries });
        setR2rMsg(`Posted & synced to R2R baseline (${historyEntries.length} lines).`);
        setTimeout(() => setR2rMsg(''), 4000);
      }
    } catch (syncErr) {
      console.warn('R2R auto-sync after post:', syncErr);
    }
  };

  const handlePost = async (id: string) => {
    setError('');
    try {
      console.log('[JE] post start', id);
      const result = await svc.postJE(id);
      console.log('[JE] post result', result);
      if (result.status === 'pending_approval' || result.requires_approval) {
        setR2rMsg(
          `Submitted for approval (exceeds AED 50,000 threshold). Click Approve to post.${
            result.warnings?.length ? ` ${result.warnings[0]}` : ''
          }`
        );
        setTimeout(() => setR2rMsg(''), 6000);
      } else if (result.status === 'posted') {
        const je = await svc.getJE(id);
        await syncPostedToR2R(je);
      }
      load();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[JE] post failed', id, msg);
      setError(`Post failed: ${msg}`);
    }
  };

  const handleApprove = async (id: string) => {
    setApproving(id);
    setError('');
    try {
      console.log('[JE] approve start', id);
      const result = await svc.approveJE(id);
      console.log('[JE] approve result', result);
      const je = await svc.getJE(id);
      await syncPostedToR2R(je);
      load();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[JE] approve failed', id, msg);
      setError(`Approve failed: ${msg}`);
    } finally {
      setApproving('');
    }
  };

  const handleDelete = async (e: JournalEntry) => {
    if (!window.confirm(`Delete journal entry "${e.description}"? This cannot be undone.`)) return;
    setDeleting(e.id);
    setError('');
    try {
      await svc.deleteJE(e.id);
      load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeleting('');
    }
  };

  const canDelete = (status: string) =>
    status === 'draft' || status === 'pending_approval' || status === 'rejected';

  const draftEntries = entries.filter(e => canDelete(e.status));

  const handleDeleteAllDrafts = async () => {
    if (draftEntries.length === 0) return;
    if (!window.confirm(`Delete all ${draftEntries.length} unposted entries? This cannot be undone.`)) return;
    setDeleting('all');
    setError('');
    try {
      for (const e of draftEntries) {
        await svc.deleteJE(e.id);
      }
      setR2rMsg(`Deleted ${draftEntries.length} unposted entries.`);
      setTimeout(() => setR2rMsg(''), 4000);
      load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeleting('');
    }
  };

  const handleValidateAndPost = async (e: JournalEntry) => {
    setValidating(e.id);
    setError('');
    try {
      console.log('[JE] validate-and-post start', e.id, e.description);
      const result = await svc.postJE(e.id);
      console.log('[JE] validate-and-post result', result);
      if (result.status === 'pending_approval' || result.requires_approval) {
        setRiskResults(prev => ({
          ...prev,
          [e.id]: { risk_score: 0, risk_level: 'medium', status: 'pending_approval' },
        }));
        setR2rMsg('High-value JE — approval required. Click Approve to post.');
        setTimeout(() => setR2rMsg(''), 6000);
      } else {
        setRiskResults(prev => ({
          ...prev,
          [e.id]: { risk_score: 100, risk_level: 'low', status: 'posted' },
        }));
        const je = await svc.getJE(e.id);
        await syncPostedToR2R(je);
      }
      load();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[JE] validate-and-post failed', e.id, msg);
      setError(`Validate & Post failed: ${msg}`);
    } finally {
      setValidating('');
    }
  };

  const totalDebit = entries.reduce((s, e) => s + e.total_debit, 0);

  // ── CSV/Excel bulk import ─────────────────────────────────────────────────
  const [importing, setImporting]   = useState(false);
  const [importMsg, setImportMsg]   = useState('');
  const [importErrors, setImportErrors] = useState<string[]>([]);

  const handleImportCSV = async (file: File) => {
    setImporting(true); setImportMsg(''); setImportErrors([]);
    try {
      if (file.name.toLowerCase().endsWith('.csv')) {
        const result = await svc.importJournalsCSV(file);
        setImportErrors(result.errors);
        setImportMsg(
          `✅ Imported ${result.imported} journal entries` +
          (result.skipped > 0 ? ` (${result.skipped} skipped)` : '') +
          (result.errors.length > 0 ? `. ${result.errors.length} errors — see below.` : '') +
          '. Click "Run Anomaly Detection" to flag suspicious entries.'
        );
        load();
        return;
      }

      // Excel: client-side parse (multiline format)
      let rows: Record<string, string>[] = [];
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' }) as Record<string, string>[];

      let map = coaMap;
      if (Object.keys(map).length === 0) {
        const coa = await svc.listAccounts();
        map = {};
        for (const a of coa.accounts as UAEAccount[]) map[a.account_code] = a.account_name;
        setCoaMap(map);
      }

      let bundles: JeImportBundle[] = [];
      let parseErrors: string[] = [];
      if (isAccrualsPrepaymentsSheet(rows)) {
        const built = buildAccrualsPrepaymentsJEs(rows, period, map);
        bundles = built.bundles;
        parseErrors = built.errors;
      } else {
        bundles = [...buildStandardExcelJEs(rows).values()];
      }

      if (bundles.length === 0) {
        throw new Error(
          parseErrors[0] ??
          'No valid rows found. Use standard JE format (je_number, account_code, debit, credit) ' +
          'or accruals format (description, gl_code, amount_aed, period, accrual_type).'
        );
      }

      const existingRefs = new Set(entries.map(e => e.reference));

      let saved = 0, skipped = 0, dupes = 0;
      const errs: string[] = [...parseErrors];
      for (const { header, lines } of bundles) {
        if (lines.length === 0) { skipped++; continue; }
        if (existingRefs.has(header.reference)) { dupes++; continue; }
        try {
          await svc.createJE({ ...header, lines });
          saved++;
        } catch (e: unknown) {
          errs.push(`${header.reference}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      setImportErrors(errs);
      const formatHint = isAccrualsPrepaymentsSheet(rows) ? ' (accruals/prepayments format)' : '';
      setImportMsg(
        `✅ Imported ${saved} journal entries${formatHint}` +
        `${skipped > 0 ? ` (${skipped} skipped — no lines)` : ''}` +
        `${dupes > 0 ? ` (${dupes} duplicates skipped)` : ''}. ` +
        `${errs.length > 0 ? `${errs.length} errors — see below. ` : ''}` +
        'High-value entries may need Approve after Post.'
      );
      load();
    } catch (e: any) {
      setImportErrors([e.message]);
    } finally {
      setImporting(false);
    }
  };

  /** Send current period's posted JEs to R2R Pattern Analysis for Isolation Forest anomaly detection */
  const handleSendToR2R = async () => {
    const posted = entries.filter(e => e.status === 'posted');
    if (posted.length === 0) {
      setR2rMsg('No posted journal entries to analyse. Post some entries first.');
      setTimeout(() => setR2rMsg(''), 4000);
      return;
    }
    setSendingR2R(true);
    setR2rMsg('');
    try {
      // Map UAE JE lines to flat R2R CSV rows
      const rows: Record<string, string>[] = [];
      for (const je of posted) {
        const detail = details[je.id] || je;
        const lines = (detail as any).lines ?? [];
        if (lines.length > 0) {
          for (const l of lines) {
            rows.push({
              date: je.entry_date,
              account: l.account_code || '',
              description: je.description || '',
              debit: String(l.debit || 0),
              credit: String(l.credit || 0),
              reference: je.reference || je.id,
              user: 'uae-system',
              source: je.source || 'manual',
              period,
            });
          }
        } else {
          rows.push({
            date: je.entry_date,
            account: '',
            description: je.description || '',
            debit: String(je.total_debit),
            credit: String(je.total_debit),
            reference: je.reference || je.id,
            user: 'uae-system',
            source: je.source || 'manual',
            period,
          });
        }
      }
      // Store in sessionStorage so R2R page can pick it up
      sessionStorage.setItem('r2r_uae_payload', JSON.stringify({ rows, period, source: 'uae', entryCount: posted.length }));
      navigate(`/r2r-pattern?source=uae&period=${period}`);
    } catch (e: any) {
      setR2rMsg(`Error: ${e.message}`);
    } finally {
      setSendingR2R(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Journal Entries</h1>
          <p className="text-gray-400 text-sm mt-1">Double-entry GL ledger</p>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="month" value={period}
            onChange={e => setPeriod(e.target.value)}
            className="bg-gray-800 border border-gray-700 text-white px-3 py-2 rounded-lg text-sm"
          />
          <button onClick={load} className="p-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors">
            <RefreshCw size={14} />
          </button>
          <button
            onClick={handleSendToR2R}
            disabled={sendingR2R}
            className="flex items-center gap-2 bg-purple-700 hover:bg-purple-600 disabled:opacity-50 px-3 py-2 rounded-lg text-sm font-medium transition-colors"
            title="Send posted JEs to R2R Pattern Analysis (Isolation Forest + 7 anomaly models)"
          >
            <Search size={14} />
            {sendingR2R ? 'Sending…' : 'Run Anomaly Detection'}
          </button>
          {/* R2R sync button */}
          <button
            onClick={handleSyncToR2R}
            disabled={sendingR2R}
            className="flex items-center gap-2 bg-teal-800 hover:bg-teal-700 disabled:opacity-50 px-3 py-2 rounded-lg text-sm font-medium transition-colors"
            title="Sync posted JEs to R2R historical baseline"
          >
            🔄 Sync to R2R
          </button>
          {/* R2R sync badge */}
          {r2rSyncCount > 0 && (
            <span className="flex items-center gap-1 text-xs text-teal-300 bg-teal-900/30 border border-teal-800 rounded-full px-2.5 py-1">
              <span className="w-1.5 h-1.5 rounded-full bg-teal-400 animate-pulse" />
              R2R: {r2rSyncCount} synced ✅
            </span>
          )}
          {/* CSV / Excel bulk import */}
          <label className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium cursor-pointer transition-colors ${importing ? 'bg-gray-600 opacity-50' : 'bg-emerald-700 hover:bg-emerald-600'}`}
            title="Upload or re-import: standard JE Excel (je_number + lines) OR accruals sheet (description, gl_code, amount_aed, period)">
            {importing ? <RefreshCw size={14} className="animate-spin" /> : <Upload size={14} />}
            {importing ? 'Importing…' : 'Import / Re-import'}
            <input type="file" accept=".csv,.xlsx,.xls" className="hidden"
              disabled={importing}
              onChange={e => { const f = e.target.files?.[0]; if (f) handleImportCSV(f); e.target.value = ''; }} />
          </label>

          {draftEntries.length > 0 && (
            <button
              type="button"
              onClick={() => void handleDeleteAllDrafts()}
              disabled={deleting === 'all'}
              className="flex items-center gap-2 bg-red-900/80 hover:bg-red-800 disabled:opacity-50 px-3 py-2 rounded-lg text-sm font-medium text-red-200 border border-red-700"
            >
              <Trash2 size={14} />
              {deleting === 'all' ? 'Deleting…' : `Delete ${draftEntries.length} draft${draftEntries.length === 1 ? '' : 's'}`}
            </button>
          )}

          <button id="je-header-new" className="flex items-center gap-2 bg-blue-700 hover:bg-blue-600 px-4 py-2 rounded-lg text-sm font-medium">
            <Plus size={14} /> New JE
          </button>
        </div>
      </div>

      <div className="bg-gray-800/40 border border-gray-700 rounded-lg px-4 py-2.5 mb-4 text-xs text-gray-400">
        <strong className="text-gray-300">Import / Re-import:</strong> green <strong className="text-emerald-400">Import / Re-import</strong> button (top right) — uploads Excel/CSV again; adds new rows (skips duplicate references).
        {' '}
        <strong className="text-gray-300">Delete:</strong> trash icon on each <strong className="text-amber-400">draft</strong> row only — posted entries (green check) cannot be deleted; use Reverse instead.
        {draftEntries.length > 0 && (
          <> Or click <strong className="text-red-300">Delete {draftEntries.length} drafts</strong> to clear all unposted imports.</>
        )}
      </div>

      {error && (
        <div className="bg-red-900/40 border border-red-700 rounded-lg p-3 mb-4 text-sm text-red-300">{error}</div>
      )}
      {r2rMsg && (
        <div className="bg-purple-900/30 border border-purple-700 rounded-lg p-3 mb-4 text-sm text-purple-300">{r2rMsg}</div>
      )}
      {importMsg && (
        <div className="bg-emerald-900/30 border border-emerald-700 rounded-lg p-3 mb-4 text-sm text-emerald-300 flex items-start gap-2">
          <CheckCircle size={14} className="mt-0.5 shrink-0" /> {importMsg}
        </div>
      )}
      {importErrors.length > 0 && (
        <div className="bg-red-900/20 border border-red-700/50 rounded-lg p-3 mb-4 text-xs text-red-300">
          <div className="flex items-center gap-1 mb-1"><AlertTriangle size={12} /> Import errors:</div>
          {importErrors.map((e, i) => <div key={i}>• {e}</div>)}
        </div>
      )}

      {/* Summary bar */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: 'Entries', value: String(entries.length) },
          { label: 'Total Debit', value: `AED ${totalDebit.toLocaleString()}` },
          { label: 'Period', value: period },
        ].map(s => (
          <div key={s.label} className="bg-gray-800/60 border border-gray-700 rounded-xl p-4">
            <p className="text-xs text-gray-400">{s.label}</p>
            <p className="text-lg font-bold text-white mt-1">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Entries list */}
      <div className="space-y-2">
        {loading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="bg-gray-800/60 border border-gray-700 rounded-xl p-4 animate-pulse h-16" />
          ))
        ) : entries.length === 0 ? (
          <div className="bg-gray-800/60 border border-gray-700 rounded-xl py-16 px-6 text-center">
            <FileText className="w-10 h-10 text-gray-500 mx-auto mb-3" />
            <p className="text-gray-400 mb-4">No journal entries yet — post your first entry</p>
            <button
              type="button"
              onClick={() => document.getElementById('je-header-new')?.scrollIntoView({ behavior: 'smooth' })}
              className="inline-flex items-center gap-2 bg-green-700 hover:bg-green-600 px-4 py-2 rounded-lg text-sm text-white"
            >
              <Plus size={14} /> New Journal Entry
            </button>
          </div>
        ) : (
          entries.map(e => {
            const isExpanded = expanded.has(e.id);
            const det = details[e.id];
            const lines = det?.lines ?? e.lines;
            const acctLine = accountSummary(lines, coaMap);
            return (
              <div key={e.id} className="bg-gray-800/60 border border-gray-700 rounded-xl overflow-hidden">
                <div
                  className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-gray-700/30 transition-colors"
                  onClick={() => toggle(e.id)}
                >
                  <div className="flex items-center gap-3">
                    {isExpanded ? <ChevronDown size={14} className="text-gray-500" /> : <ChevronRight size={14} className="text-gray-500" />}
                    <div>
                      <p className="text-sm font-medium text-white">{e.description}</p>
                      {acctLine && (
                        <p className="text-xs text-gray-400 mt-0.5">{acctLine}</p>
                      )}
                      <p className="text-xs text-gray-500 mt-0.5">{e.entry_date} • {e.reference ?? 'No ref'}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`text-xs border px-2 py-0.5 rounded-full ${SOURCE_COLORS[e.source] ?? 'bg-gray-700 text-gray-400 border-gray-600'}`}>
                      {e.source}
                    </span>
                    {e.status === 'posted' ? (
                      <span className="flex items-center gap-1 text-xs text-green-400">
                        <CheckCircle size={12} /> Posted
                      </span>
                    ) : e.status === 'pending_approval' ? (
                      <button
                        onClick={ev => { ev.stopPropagation(); handleApprove(e.id); }}
                        disabled={approving === e.id}
                        className="flex items-center gap-1 text-xs bg-orange-700 hover:bg-orange-600 disabled:opacity-50 px-2 py-1 rounded text-white transition-colors"
                      >
                        <Clock size={12} /> {approving === e.id ? '…' : 'Approve'}
                      </button>
                    ) : (
                      <button
                        onClick={ev => { ev.stopPropagation(); handlePost(e.id); }}
                        className="flex items-center gap-1 text-xs bg-amber-700 hover:bg-amber-600 px-2 py-1 rounded text-white transition-colors"
                      >
                        <Clock size={12} /> Post
                      </button>
                    )}
                    {e.status !== 'posted' && e.status !== 'pending_approval' && (
                      riskResults[e.id] ? (
                        <span className={`text-xs border px-2 py-0.5 rounded-full ${
                          riskResults[e.id].risk_level === 'low'    ? 'bg-green-900/40 text-green-400 border-green-700' :
                          riskResults[e.id].risk_level === 'medium' ? 'bg-amber-900/40 text-amber-400 border-amber-700' :
                                                                       'bg-red-900/40 text-red-400 border-red-700'
                        }`}>
                          {riskResults[e.id].status === 'pending_approval' ? 'Pending approval' : `Risk ${riskResults[e.id].risk_score}`}
                        </span>
                      ) : (
                        <button
                          onClick={ev => { ev.stopPropagation(); handleValidateAndPost(e); }}
                          disabled={validating === e.id}
                          className="text-xs bg-indigo-700 hover:bg-indigo-600 disabled:opacity-50 px-2 py-1 rounded text-white transition-colors whitespace-nowrap"
                        >
                          {validating === e.id ? '…' : 'Validate & Post'}
                        </button>
                      )
                    )}
                    {e.status === 'pending_approval' && (
                      <span className="text-xs text-orange-400">Awaiting approval</span>
                    )}
                    {canDelete(e.status) && (
                      <button
                        type="button"
                        onClick={ev => { ev.stopPropagation(); void handleDelete(e); }}
                        disabled={deleting === e.id || deleting === 'all'}
                        title="Delete draft entry"
                        className="flex items-center gap-1 text-xs text-red-400 hover:text-red-300 hover:bg-red-900/30 px-2 py-1 rounded transition-colors disabled:opacity-50"
                      >
                        <Trash2 size={12} /> Delete
                      </button>
                    )}
                    <span className="text-sm font-mono text-white">
                      AED {e.total_debit.toLocaleString()}
                    </span>
                  </div>
                </div>
                {isExpanded && (
                  <div className="border-t border-gray-700 bg-gray-900/40 px-4 py-3">
                    {(det?.lines ?? lines)?.length ? (
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-gray-500">
                            <th className="text-left py-1 font-normal">Account</th>
                            <th className="text-left py-1 font-normal">Description</th>
                            <th className="text-right py-1 font-normal">Debit (AED)</th>
                            <th className="text-right py-1 font-normal">Credit (AED)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(det?.lines ?? lines ?? []).map(l => (
                            <tr key={l.id} className="border-t border-gray-800">
                              <td className="py-1 text-blue-400">{accountLabel(l.account_code, l.account_name, coaMap)}</td>
                              <td className="py-1 text-gray-300">{l.description}</td>
                              <td className="py-1 text-right text-white">{l.debit ? l.debit.toLocaleString() : '—'}</td>
                              <td className="py-1 text-right text-white">{l.credit ? l.credit.toLocaleString() : '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <div className="text-xs text-gray-500 animate-pulse">Loading lines…</div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
