/**
 * Accruals Engine — AI pattern detection + mandatory UAE EOSB
 */
import { useEffect, useRef, useState } from 'react';
import { Zap, CheckCircle2, RefreshCw, Shield, Plus, Upload, Download, X } from 'lucide-react';
import * as XLSX from 'xlsx';
import * as svc from '../../services/uaeFullAccounting.service';
import type { Accrual } from '../../services/uaeFullAccounting.service';

const THIS_PERIOD = new Date().toISOString().slice(0, 7);

const ACCRUAL_TYPES = ['rent', 'salary', 'utility', 'professional_fee', 'eosb', 'other'];

const STATUS_STYLE: Record<string, string> = {
  suggested: 'bg-amber-900/40 text-amber-400 border-amber-700',
  approved:  'bg-blue-900/40 text-blue-400 border-blue-700',
  posted:    'bg-green-900/40 text-green-400 border-green-700',
  reversed:  'bg-gray-700 text-gray-400 border-gray-600',
};

const EMPTY_FORM = {
  description: '',
  amount: '',
  account_code: '6100',
  accrual_type: 'other',
  is_mandatory: false,
  ai_reasoning: '',
};

function normalizeType(raw: string): string {
  const s = raw.trim().toLowerCase().replace(/\s+/g, '_');
  const hit = ACCRUAL_TYPES.find((t) => t === s || t.replace('_', ' ') === s.replace('_', ' '));
  return hit ?? 'other';
}

function parseMandatory(v: unknown): boolean {
  const s = String(v ?? '').trim().toLowerCase();
  return s === 'yes' || s === 'y' || s === 'true' || s === '1' || s === 'mandatory';
}

function parsePeriod(v: unknown, fallback: string): string {
  if (!v) return fallback;
  if (typeof v === 'number') {
    const d = XLSX.SSF.parse_date_code(v);
    if (d) return `${d.y}-${String(d.m).padStart(2, '0')}`;
  }
  const s = String(v).trim().slice(0, 7);
  if (/^\d{4}-\d{2}$/.test(s)) return s;
  const parts = String(v).trim().split(/[/-]/);
  if (parts.length >= 2) {
    const [a, b] = parts.map(Number);
    if (a > 31) return `${a}-${String(b).padStart(2, '0')}`;
    if (b > 12) return `${b}-${String(a).padStart(2, '0')}`;
    return `${a}-${String(b).padStart(2, '0')}`;
  }
  return fallback;
}

export default function Accruals() {
  const [accruals, setAccruals]     = useState<Accrual[]>([]);
  const [period, setPeriod]         = useState(THIS_PERIOD);
  const [suggesting, setSuggesting] = useState(false);
  const [posting, setPosting]       = useState<string>('');
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState('');
  const [msg, setMsg]               = useState('');
  const [showAdd, setShowAdd]       = useState(false);
  const [saving, setSaving]         = useState(false);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [form, setForm]             = useState(EMPTY_FORM);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = () => {
    setLoading(true);
    svc.listAccruals(period)
      .then(d => setAccruals(d.accruals))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [period]);

  const handleSuggest = async () => {
    setSuggesting(true); setError(''); setMsg('');
    try {
      const r = await svc.suggestAccruals(period);
      setMsg(`AI found ${r.count} accrual suggestions for ${period}`);
      load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSuggesting(false);
    }
  };

  const handlePost = async (id: string) => {
    setPosting(id); setError('');
    try {
      await svc.postAccrualRoute(id);
      setMsg('Accrual posted — GL journal entry created + reversal scheduled');
      load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPosting('');
    }
  };

  const handleAddAccrual = async (e: React.FormEvent) => {
    e.preventDefault();
    const amount = Number(form.amount);
    if (!form.description.trim() || !amount || amount <= 0) {
      setError('Description and amount are required.');
      return;
    }
    setSaving(true);
    setError('');
    setMsg('');
    try {
      await svc.createAccrual({
        period,
        description: form.description.trim(),
        amount,
        account_code: form.account_code.trim() || '6100',
        accrual_type: form.accrual_type,
        is_mandatory: form.is_mandatory,
        ai_reasoning: form.ai_reasoning.trim() || undefined,
      });
      setMsg('Accrual added — review and click Post to create journal entry.');
      setShowAdd(false);
      setForm(EMPTY_FORM);
      load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const downloadTemplate = () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['description', 'amount', 'account_code', 'accrual_type', 'period', 'is_mandatory', 'notes'],
      ['Office rent — June', 25000, '6100', 'rent', '2026-06', 'no', 'Monthly lease accrual'],
      ['Utilities estimate', 3500, '6200', 'utility', '2026-06', 'no', 'DEWA bill not yet received'],
      ['EOSB provision', 12000, '2300', 'eosb', '2026-06', 'yes', 'UAE Labour Law mandatory'],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Accruals');
    XLSX.writeFile(wb, 'uae_accruals_template.xlsx');
  };

  const handleBulkFile = async (file: File) => {
    setBulkLoading(true);
    setError('');
    setMsg('');
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(new Uint8Array(buf), { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
      if (rows.length === 0) throw new Error('Excel file is empty.');

      let ok = 0;
      const failures: string[] = [];
      for (const row of rows) {
        const description = String(
          row.description ?? row.Description ?? row['Accrual Description'] ?? ''
        ).trim();
        const amount = Number(row.amount ?? row.Amount ?? row.value ?? 0);
        if (!description || !amount) continue;
        const rowPeriod = parsePeriod(row.period ?? row.Period ?? row.month, period);
        try {
          await svc.createAccrual({
            period: rowPeriod,
            description,
            amount,
            account_code: String(row.account_code ?? row['Account Code'] ?? row.gl ?? '6100').trim(),
            accrual_type: normalizeType(String(row.accrual_type ?? row.type ?? row.Type ?? 'other')),
            is_mandatory: parseMandatory(row.is_mandatory ?? row.mandatory ?? row.Mandatory),
            ai_reasoning: String(row.notes ?? row.ai_reasoning ?? row.reasoning ?? '').trim() || undefined,
          });
          ok += 1;
        } catch (err: unknown) {
          failures.push(`${description}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      if (ok === 0) throw new Error(failures[0] ?? 'No valid rows found. Check column headers.');
      setMsg(`Imported ${ok} accrual${ok === 1 ? '' : 's'}${failures.length ? ` (${failures.length} failed)` : ''}.`);
      load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBulkLoading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const mandatory   = accruals.filter(a => a.is_mandatory);
  const suggested   = accruals.filter(a => !a.is_mandatory && a.status === 'suggested');
  const posted      = accruals.filter(a => a.status === 'posted');
  const totalAmount = accruals.filter(a => a.status !== 'reversed').reduce((s, a) => s + a.amount, 0);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Accruals Engine</h1>
          <p className="text-gray-400 text-sm mt-1">AI pattern detection + mandatory UAE EOSB</p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-3">
          <input
            type="month" value={period}
            onChange={e => setPeriod(e.target.value)}
            className="bg-gray-800 border border-gray-700 text-white px-3 py-2 rounded-lg text-sm"
          />
          <button onClick={load} className="p-2 bg-gray-700 hover:bg-gray-600 rounded-lg"><RefreshCw size={14} /></button>
          <button
            type="button"
            onClick={downloadTemplate}
            className="flex items-center gap-2 bg-gray-800 hover:bg-gray-700 border border-gray-600 px-4 py-2 rounded-lg text-sm font-medium"
          >
            <Download size={14} /> Template
          </button>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={bulkLoading}
            className="flex items-center gap-2 bg-emerald-800 hover:bg-emerald-700 disabled:opacity-50 px-4 py-2 rounded-lg text-sm font-medium"
          >
            <Upload size={14} /> {bulkLoading ? 'Importing…' : 'Bulk Upload'}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleBulkFile(f);
            }}
          />
          <button
            type="button"
            onClick={() => { setShowAdd(true); setError(''); }}
            className="flex items-center gap-2 bg-blue-700 hover:bg-blue-600 px-4 py-2 rounded-lg text-sm font-medium"
          >
            <Plus size={14} /> Add Accrual
          </button>
          <button
            onClick={handleSuggest}
            disabled={suggesting}
            className="flex items-center gap-2 bg-amber-700 hover:bg-amber-600 disabled:opacity-50 px-4 py-2 rounded-lg text-sm font-medium"
          >
            <Zap size={14} /> {suggesting ? 'Analysing…' : 'AI Suggest'}
          </button>
        </div>
      </div>

      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-lg shadow-xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700">
              <h2 className="text-lg font-semibold text-white">Add Accrual — {period}</h2>
              <button type="button" onClick={() => setShowAdd(false)} className="text-gray-400 hover:text-white">
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleAddAccrual} className="p-5 space-y-4">
              <div>
                <label className="text-xs text-gray-400 block mb-1">Description *</label>
                <input
                  required
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
                  placeholder="e.g. Office rent — June"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Amount (AED) *</label>
                  <input
                    required
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={form.amount}
                    onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">GL Account Code</label>
                  <input
                    value={form.account_code}
                    onChange={e => setForm(f => ({ ...f, account_code: e.target.value }))}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
                    placeholder="6100"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Type</label>
                  <select
                    value={form.accrual_type}
                    onChange={e => setForm(f => ({ ...f, accrual_type: e.target.value }))}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
                  >
                    {ACCRUAL_TYPES.map(t => (
                      <option key={t} value={t}>{t.replace('_', ' ')}</option>
                    ))}
                  </select>
                </div>
                <div className="flex items-end pb-2">
                  <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.is_mandatory}
                      onChange={e => setForm(f => ({ ...f, is_mandatory: e.target.checked }))}
                      className="rounded"
                    />
                    Mandatory (EOSB)
                  </label>
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Notes (optional)</label>
                <input
                  value={form.ai_reasoning}
                  onChange={e => setForm(f => ({ ...f, ai_reasoning: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
                  placeholder="Supporting detail for audit trail"
                />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowAdd(false)} className="px-4 py-2 text-sm text-gray-400 hover:text-white">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="bg-blue-700 hover:bg-blue-600 disabled:opacity-50 px-4 py-2 rounded-lg text-sm font-medium"
                >
                  {saving ? 'Saving…' : 'Save Accrual'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {(error || msg) && (
        <div className={`rounded-lg p-3 mb-4 text-sm ${error ? 'bg-red-900/40 text-red-300 border border-red-700' : 'bg-amber-900/40 text-amber-300 border border-amber-700'}`}>
          {error || msg}
        </div>
      )}

      {/* Summary */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Mandatory (EOSB)', value: String(mandatory.length), color: 'text-red-400' },
          { label: 'AI Suggested',     value: String(suggested.length), color: 'text-amber-400' },
          { label: 'Posted',           value: String(posted.length),    color: 'text-green-400' },
          { label: 'Total AED',        value: totalAmount.toLocaleString(), color: 'text-white' },
        ].map(s => (
          <div key={s.label} className="bg-gray-800/60 border border-gray-700 rounded-xl p-4">
            <p className="text-xs text-gray-400">{s.label}</p>
            <p className={`text-lg font-bold ${s.color} mt-1`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* EOSB Mandatory Section */}
      {mandatory.length > 0 && (
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <Shield size={14} className="text-red-400" />
            <h2 className="text-sm font-semibold text-red-400 uppercase tracking-wider">Mandatory — UAE Labour Law</h2>
          </div>
          <div className="space-y-2">
            {mandatory.map(a => (
              <div key={a.id} className="bg-red-900/20 border border-red-800/50 rounded-xl p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-white">{a.description}</p>
                    <p className="text-xs text-gray-400 mt-1">{a.account_code} • {a.accrual_type}</p>
                    {a.ai_reasoning && (
                      <p className="text-xs text-gray-500 mt-1 italic">{a.ai_reasoning}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-bold text-white">AED {a.amount.toLocaleString()}</span>
                    <span className={`text-xs border px-2 py-0.5 rounded-full ${STATUS_STYLE[a.status] ?? ''}`}>
                      {a.status}
                    </span>
                    {a.status === 'suggested' && (
                      <button
                        onClick={() => handlePost(a.id)}
                        disabled={!!posting}
                        className="text-xs bg-red-700 hover:bg-red-600 disabled:opacity-50 px-3 py-1.5 rounded-lg text-white"
                      >
                        {posting === a.id ? 'Posting…' : 'Post Now'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Accruals list */}
      {loading ? (
        Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="bg-gray-800/60 border border-gray-700 rounded-xl p-4 mb-2 animate-pulse h-20" />
        ))
      ) : accruals.filter(a => !a.is_mandatory).length === 0 ? (
        <div className="bg-gray-800/60 border border-gray-700 rounded-xl p-12 text-center">
          <Upload size={24} className="text-emerald-400 mx-auto mb-3" />
          <p className="text-gray-400 text-sm">No accruals for {period}</p>
          <p className="text-gray-600 text-xs mt-1">
            Download <strong className="text-gray-500">Template</strong>, fill in Excel, then click{' '}
            <strong className="text-gray-500">Bulk Upload</strong> — or use <strong className="text-gray-500">AI Suggest</strong>
          </p>
        </div>
      ) : (
        <div>
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Suggested & Posted</h2>
          <div className="space-y-2">
            {accruals.filter(a => !a.is_mandatory).map(a => (
              <div key={a.id} className="bg-gray-800/60 border border-gray-700 rounded-xl p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-white">{a.description}</p>
                    <p className="text-xs text-gray-400 mt-1">{a.account_code} • {a.accrual_type}</p>
                    {a.ai_reasoning && (
                      <p className="text-xs text-gray-500 mt-1 italic">{a.ai_reasoning}</p>
                    )}
                    {a.ai_confidence !== undefined && (
                      <div className="flex items-center gap-1 mt-1">
                        <div className="h-1 w-24 bg-gray-700 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-amber-500 rounded-full"
                            style={{ width: `${(a.ai_confidence ?? 0) * 100}%` }}
                          />
                        </div>
                        <span className="text-xs text-gray-500">{Math.round((a.ai_confidence ?? 0) * 100)}% confidence</span>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-bold text-white">AED {a.amount.toLocaleString()}</span>
                    <span className={`text-xs border px-2 py-0.5 rounded-full ${STATUS_STYLE[a.status] ?? ''}`}>
                      {a.status}
                    </span>
                    {a.status === 'suggested' && (
                      <button
                        onClick={() => handlePost(a.id)}
                        disabled={!!posting}
                        className="text-xs bg-amber-700 hover:bg-amber-600 disabled:opacity-50 px-3 py-1.5 rounded-lg text-white"
                      >
                        {posting === a.id ? 'Posting…' : 'Post'}
                      </button>
                    )}
                    {a.status === 'posted' && <CheckCircle2 size={14} className="text-green-400" />}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
