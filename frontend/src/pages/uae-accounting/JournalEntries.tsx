/**
 * Journal Entries — GL drill-down, double-entry ledger
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, RefreshCw, ChevronDown, ChevronRight, CheckCircle, Clock, Search, Upload, AlertTriangle } from 'lucide-react';
import * as XLSX from 'xlsx';
import * as svc from '../../services/uaeFullAccounting.service';
import type { JournalEntry } from '../../services/uaeFullAccounting.service';

const SOURCE_COLORS: Record<string, string> = {
  manual:     'bg-blue-900/40 text-blue-400 border-blue-700',
  ar_invoice: 'bg-green-900/40 text-green-400 border-green-700',
  depreciation:'bg-purple-900/40 text-purple-400 border-purple-700',
  accrual:    'bg-amber-900/40 text-amber-400 border-amber-700',
  bank_recon: 'bg-cyan-900/40 text-cyan-400 border-cyan-700',
};

const THIS_PERIOD = new Date().toISOString().slice(0, 7);

export default function JournalEntries() {
  const navigate = useNavigate();
  const [entries, setEntries]     = useState<JournalEntry[]>([]);
  const [loading, setLoading]     = useState(true);
  const [period, setPeriod]       = useState(THIS_PERIOD);
  const [expanded, setExpanded]   = useState<Set<string>>(new Set());
  const [details, setDetails]     = useState<Record<string, JournalEntry>>({});
  const [error, setError]         = useState('');
  const [sendingR2R, setSendingR2R] = useState(false);
  const [r2rMsg, setR2rMsg]       = useState('');

  const load = () => {
    setLoading(true);
    svc.listJournals({ period })
      .then(d => setEntries(d.entries))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [period]);

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

  const handlePost = async (id: string) => {
    await svc.postJE(id);
    load();
  };

  const totalDebit = entries.reduce((s, e) => s + e.total_debit, 0);

  // ── CSV/Excel bulk import ─────────────────────────────────────────────────
  const [importing, setImporting]   = useState(false);
  const [importMsg, setImportMsg]   = useState('');
  const [importErrors, setImportErrors] = useState<string[]>([]);

  const handleImportCSV = async (file: File) => {
    setImporting(true); setImportMsg(''); setImportErrors([]);
    try {
      // Parse file
      let rows: Record<string, string>[] = [];
      if (file.name.toLowerCase().endsWith('.csv')) {
        const text = await file.text();
        const lines = text.trim().split('\n');
        const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
        rows = lines.slice(1).map(l => {
          const vals = l.split(',').map(v => v.trim().replace(/^"|"$/g, ''));
          return Object.fromEntries(headers.map((h, i) => [h, vals[i] || '']));
        }).filter(r => r.je_number || r.date);
      } else {
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: 'array' });
        rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' }) as Record<string, string>[];
      }

      // Group flat rows by je_number into JE + lines
      const jeMap = new Map<string, { header: any; lines: any[] }>();
      for (const r of rows) {
        const jeNum = String(r.je_number || r['JE Number'] || '').trim();
        if (!jeNum) continue;
        if (!jeMap.has(jeNum)) {
          jeMap.set(jeNum, {
            header: {
              reference: jeNum,
              entry_date: r.date || r.gl_date || new Date().toISOString().slice(0,10),
              period: (() => {
                const d = r.date || r.gl_date || '';
                const m = d.match(/(\d{2})-(\w{3})-(\d{2,4})/);
                if (m) { const months: Record<string,string> = {Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12'}; return `20${m[3].length===2?m[3]:m[3].slice(2)}-${months[m[2]]||'01'}`; }
                return period;
              })(),
              description: r.description || '',
              source: String(r.source || 'manual').toLowerCase() as any,
              prepared_by: r.prepared_by || undefined,
              approved_by: r.approved_by || undefined,
              status: 'posted' as const,   // import as posted so anomaly detection works immediately
              anomaly_flags: r.flag_notes ? [r.flag_notes] : [],
            },
            lines: [],
          });
        }
        const je = jeMap.get(jeNum)!;
        const debit  = parseFloat(String(r.debit_aed  || r.debit  || 0).replace(/,/g,'')) || 0;
        const credit = parseFloat(String(r.credit_aed || r.credit || 0).replace(/,/g,'')) || 0;
        if (debit === 0 && credit === 0) continue;
        je.lines.push({
          account_code: String(r.account_code || r.account || ''),
          account_name: String(r.account_name || r.description || ''),
          debit, credit,
          description: r.description || '',
        });
        // Update description from first meaningful line
        if (!je.header.description && r.description) je.header.description = r.description;
      }

      // Save each JE via service
      let saved = 0, skipped = 0;
      const errs: string[] = [];
      for (const [jeNum, { header, lines }] of jeMap) {
        if (lines.length === 0) { skipped++; continue; }
        try {
          await svc.createJE({ ...header, lines });
          saved++;
        } catch (e: any) {
          errs.push(`${jeNum}: ${e.message}`);
        }
      }
      setImportErrors(errs);
      setImportMsg(`✅ Imported ${saved} journal entries${skipped > 0 ? ` (${skipped} skipped — no lines)` : ''}. ${errs.length > 0 ? `${errs.length} errors — see below.` : ''} Click "Run Anomaly Detection" to flag suspicious entries.`);
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
          {/* CSV / Excel bulk import */}
          <label className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium cursor-pointer transition-colors ${importing ? 'bg-gray-600 opacity-50' : 'bg-emerald-700 hover:bg-emerald-600'}`}
            title="Import journal entries from CSV or Excel (columns: je_number, date, description, account_code, account_name, debit_aed, credit_aed, source, prepared_by, approved_by, flag_notes)">
            {importing ? <RefreshCw size={14} className="animate-spin" /> : <Upload size={14} />}
            {importing ? 'Importing…' : 'Import CSV/Excel'}
            <input type="file" accept=".csv,.xlsx,.xls" className="hidden"
              disabled={importing}
              onChange={e => { const f = e.target.files?.[0]; if (f) handleImportCSV(f); e.target.value = ''; }} />
          </label>

          <button className="flex items-center gap-2 bg-blue-700 hover:bg-blue-600 px-4 py-2 rounded-lg text-sm font-medium">
            <Plus size={14} /> New JE
          </button>
        </div>
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
          <div className="bg-gray-800/60 border border-gray-700 rounded-xl p-12 text-center text-gray-500">
            No journal entries for {period}
          </div>
        ) : (
          entries.map(e => {
            const isExpanded = expanded.has(e.id);
            const det = details[e.id];
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
                      <p className="text-xs text-gray-500">{e.entry_date} • {e.reference ?? 'No ref'}</p>
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
                    ) : (
                      <button
                        onClick={ev => { ev.stopPropagation(); handlePost(e.id); }}
                        className="flex items-center gap-1 text-xs bg-amber-700 hover:bg-amber-600 px-2 py-1 rounded text-white transition-colors"
                      >
                        <Clock size={12} /> Post
                      </button>
                    )}
                    <span className="text-sm font-mono text-white">
                      AED {e.total_debit.toLocaleString()}
                    </span>
                  </div>
                </div>
                {isExpanded && (
                  <div className="border-t border-gray-700 bg-gray-900/40 px-4 py-3">
                    {det ? (
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
                          {(det.lines ?? []).map(l => (
                            <tr key={l.id} className="border-t border-gray-800">
                              <td className="py-1 font-mono text-blue-400">{l.account_code}</td>
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
