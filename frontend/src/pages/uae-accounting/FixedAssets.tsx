/**
 * Fixed Assets — IFRS depreciation + UAE CT Ministerial Decision 134
 * Side-by-side IFRS vs CT book values
 */
import { Fragment, useEffect, useRef, useState } from 'react';
import { Plus, Zap, ChevronDown, ChevronRight, Upload, Download, X } from 'lucide-react';
import * as XLSX from 'xlsx';
import * as svc from '../../services/uaeFullAccounting.service';
import type { FixedAsset } from '../../services/uaeFullAccounting.service';

const THIS_PERIOD = new Date().toISOString().slice(0, 7);

const CATEGORIES = ['Computer', 'Vehicle', 'Furniture', 'Machinery', 'Building', 'Intangible'];

const CT_RATES: Record<string, string> = {
  Computer: '33.3%',
  Vehicle:  '20%',
  Furniture:'20%',
  Machinery:'20%',
  Building: '4%',
  Intangible:'10%',
};

const DEFAULT_LIFE: Record<string, number> = {
  Computer: 3, Vehicle: 5, Furniture: 10, Machinery: 10, Building: 25, Intangible: 5,
};

const EMPTY_FORM = {
  asset_name: '',
  asset_code: '',
  asset_category: 'Computer',
  acquisition_date: new Date().toISOString().slice(0, 10),
  cost: '',
  residual_value: '0',
  useful_life_years: '3',
};

function normalizeCategory(raw: string): string {
  const s = raw.trim();
  const hit = CATEGORIES.find((c) => c.toLowerCase() === s.toLowerCase());
  return hit ?? 'Computer';
}

function parseExcelDate(v: unknown): string {
  if (!v) return new Date().toISOString().slice(0, 10);
  if (typeof v === 'number') {
    const d = XLSX.SSF.parse_date_code(v);
    if (d) return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
  }
  const s = String(v).trim().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const parts = s.split(/[/-]/);
  if (parts.length === 3) {
    const [a, b, c] = parts.map(Number);
    if (c > 31) return `${c}-${String(b).padStart(2, '0')}-${String(a).padStart(2, '0')}`;
    if (a > 31) return `${a}-${String(b).padStart(2, '0')}-${String(c).padStart(2, '0')}`;
  }
  return new Date().toISOString().slice(0, 10);
}

export default function FixedAssets() {
  const [assets, setAssets]       = useState<FixedAsset[]>([]);
  const [schedule, setSchedule]   = useState<{ asset_id: string; schedule: any[] } | null>(null);
  const [period, setPeriod]       = useState(THIS_PERIOD);
  const [loading, setLoading]     = useState(true);
  const [running, setRunning]     = useState(false);
  const [error, setError]         = useState('');
  const [msg, setMsg]             = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showAdd, setShowAdd]     = useState(false);
  const [saving, setSaving]       = useState(false);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [form, setForm]           = useState(EMPTY_FORM);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = () => {
    setLoading(true);
    svc.listAssets()
      .then(d => setAssets(d.assets))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const handleRunDep = async () => {
    setRunning(true); setError(''); setMsg('');
    try {
      const r = await svc.runDepreciation(period);
      setMsg(`Depreciation run: ${r.assets_processed} assets | IFRS AED ${r.total_ifrs_depreciation?.toLocaleString()} | CT AED ${r.total_ct_depreciation?.toLocaleString()}`);
      load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setRunning(false);
    }
  };

  const handleExpand = async (id: string) => {
    if (expandedId === id) { setExpandedId(null); return; }
    setExpandedId(id);
    if (!schedule || schedule.asset_id !== id) {
      const s = await svc.getDepreciationSchedule(id).catch(() => null);
      if (s) setSchedule(s);
    }
  };

  const handleAddAsset = async (e: React.FormEvent) => {
    e.preventDefault();
    const cost = Number(form.cost);
    if (!form.asset_name.trim() || !cost || cost <= 0) {
      setError('Asset name and cost are required.');
      return;
    }
    setSaving(true);
    setError('');
    setMsg('');
    try {
      const cat = form.asset_category;
      const r = await svc.createAsset({
        asset_name: form.asset_name.trim(),
        asset_code: form.asset_code.trim() || undefined,
        asset_category: cat,
        acquisition_date: form.acquisition_date,
        cost,
        residual_value: Number(form.residual_value) || 0,
        useful_life_years: Number(form.useful_life_years) || DEFAULT_LIFE[cat] || 5,
      });
      setMsg(`Asset ${r.asset_code} registered.`);
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
      ['asset_name', 'asset_category', 'acquisition_date', 'cost', 'asset_code', 'residual_value', 'useful_life_years'],
      ['Dell Laptop — Finance', 'Computer', '2024-06-01', 4500, 'FA-0001', 0, 3],
      ['Toyota Hilux', 'Vehicle', '2023-01-15', 85000, '', 5000, 5],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Fixed Assets');
    XLSX.writeFile(wb, 'uae_fixed_assets_template.xlsx');
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
        const name = String(row.asset_name ?? row['Asset Name'] ?? row.name ?? '').trim();
        const cost = Number(row.cost ?? row.Cost ?? row.purchase_cost ?? 0);
        if (!name || !cost) continue;
        const cat = normalizeCategory(String(row.asset_category ?? row.category ?? row.Category ?? 'Computer'));
        try {
          await svc.createAsset({
            asset_name: name,
            asset_code: String(row.asset_code ?? row.code ?? '').trim() || undefined,
            asset_category: cat,
            acquisition_date: parseExcelDate(row.acquisition_date ?? row.purchase_date ?? row.date),
            cost,
            residual_value: Number(row.residual_value ?? 0) || 0,
            useful_life_years: Number(row.useful_life_years ?? DEFAULT_LIFE[cat] ?? 5) || DEFAULT_LIFE[cat] || 5,
          });
          ok += 1;
        } catch (err: unknown) {
          failures.push(`${name}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      if (ok === 0) throw new Error(failures[0] ?? 'No valid rows found. Check column headers.');
      setMsg(`Imported ${ok} asset${ok === 1 ? '' : 's'}${failures.length ? ` (${failures.length} failed)` : ''}.`);
      load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBulkLoading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const totalCost     = assets.reduce((s, a) => s + a.cost, 0);
  const totalNBV      = assets.reduce((s, a) => s + a.net_book_value, 0);
  const totalCTNBV    = assets.reduce((s, a) => s + a.ct_net_book_value, 0);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Fixed Assets</h1>
          <p className="text-gray-400 text-sm mt-1">IFRS Depreciation + UAE CT Ministerial Decision 134</p>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="month" value={period}
            onChange={e => setPeriod(e.target.value)}
            className="bg-gray-800 border border-gray-700 text-white px-3 py-2 rounded-lg text-sm"
          />
          <button
            onClick={handleRunDep}
            disabled={running}
            className="flex items-center gap-2 bg-purple-700 hover:bg-purple-600 disabled:opacity-50 px-4 py-2 rounded-lg text-sm font-medium"
          >
            <Zap size={14} /> {running ? 'Running…' : 'Run Depreciation'}
          </button>
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
            <Plus size={14} /> Add Asset
          </button>
        </div>
      </div>

      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-lg shadow-xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700">
              <h2 className="text-lg font-semibold text-white">Register Fixed Asset</h2>
              <button type="button" onClick={() => setShowAdd(false)} className="text-gray-400 hover:text-white">
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleAddAsset} className="p-5 space-y-4">
              <div>
                <label className="text-xs text-gray-400 block mb-1">Asset Name *</label>
                <input
                  required
                  value={form.asset_name}
                  onChange={(e) => setForm({ ...form, asset_name: e.target.value })}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
                  placeholder="Dell Laptop — Finance Dept"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Category *</label>
                  <select
                    value={form.asset_category}
                    onChange={(e) => {
                      const cat = e.target.value;
                      setForm({ ...form, asset_category: cat, useful_life_years: String(DEFAULT_LIFE[cat] ?? 5) });
                    }}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
                  >
                    {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Asset Code</label>
                  <input
                    value={form.asset_code}
                    onChange={(e) => setForm({ ...form, asset_code: e.target.value })}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
                    placeholder="Auto (FA-0001)"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Acquisition Date *</label>
                  <input
                    type="date"
                    required
                    value={form.acquisition_date}
                    onChange={(e) => setForm({ ...form, acquisition_date: e.target.value })}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Cost (AED) *</label>
                  <input
                    type="number"
                    required
                    min={1}
                    step="0.01"
                    value={form.cost}
                    onChange={(e) => setForm({ ...form, cost: e.target.value })}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Residual Value (AED)</label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={form.residual_value}
                    onChange={(e) => setForm({ ...form, residual_value: e.target.value })}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Useful Life (years)</label>
                  <input
                    type="number"
                    min={1}
                    value={form.useful_life_years}
                    onChange={(e) => setForm({ ...form, useful_life_years: e.target.value })}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowAdd(false)} className="px-4 py-2 text-sm text-gray-400 hover:text-white">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 bg-blue-700 hover:bg-blue-600 disabled:opacity-50 rounded-lg text-sm font-medium"
                >
                  {saving ? 'Saving…' : 'Save Asset'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {(error || msg) && (
        <div className={`rounded-lg p-3 mb-4 text-sm ${error ? 'bg-red-900/40 text-red-300 border border-red-700' : 'bg-purple-900/40 text-purple-300 border border-purple-700'}`}>
          {error || msg}
        </div>
      )}

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: 'Total Cost',    value: `AED ${totalCost.toLocaleString()}`,  color: 'text-blue-400' },
          { label: 'IFRS Net Book', value: `AED ${totalNBV.toLocaleString()}`,   color: 'text-green-400' },
          { label: 'CT Net Book',   value: `AED ${totalCTNBV.toLocaleString()}`, color: 'text-purple-400' },
        ].map(s => (
          <div key={s.label} className="bg-gray-800/60 border border-gray-700 rounded-xl p-4">
            <p className="text-xs text-gray-400">{s.label}</p>
            <p className={`text-lg font-bold ${s.color} mt-1`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* CT Rates Reference */}
      <div className="bg-gray-800/40 border border-gray-700/50 rounded-xl p-4 mb-6">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">CT Depreciation Rates (MoF Decision 134)</p>
        <div className="flex gap-4 flex-wrap">
          {Object.entries(CT_RATES).map(([cat, rate]) => (
            <div key={cat} className="bg-gray-900/60 rounded-lg px-3 py-2 text-center">
              <p className="text-xs text-gray-500">{cat}</p>
              <p className="text-sm font-bold text-purple-400">{rate}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Assets Table */}
      <div className="bg-gray-800/60 border border-gray-700 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-700 bg-gray-800/80">
              <th className="px-4 py-3 text-left text-xs text-gray-400 font-semibold w-6"></th>
              <th className="px-4 py-3 text-left text-xs text-gray-400 font-semibold">Code</th>
              <th className="px-4 py-3 text-left text-xs text-gray-400 font-semibold">Asset Name</th>
              <th className="px-4 py-3 text-left text-xs text-gray-400 font-semibold">Category</th>
              <th className="px-4 py-3 text-left text-xs text-gray-400 font-semibold">Acquired</th>
              <th className="px-4 py-3 text-right text-xs text-gray-400 font-semibold">Cost</th>
              <th className="px-4 py-3 text-right text-xs text-gray-400 font-semibold">IFRS NBV</th>
              <th className="px-4 py-3 text-right text-xs text-gray-400 font-semibold">CT NBV</th>
              <th className="px-4 py-3 text-center text-xs text-gray-400 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="border-b border-gray-700/50">
                  {Array.from({ length: 9 }).map((_, j) => (
                    <td key={j} className="px-4 py-3">
                      <div className="h-3 bg-gray-700 rounded animate-pulse" />
                    </td>
                  ))}
                </tr>
              ))
            ) : assets.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-12 text-center text-gray-500">
                  No assets yet. Click "Add Asset" to register your first fixed asset.
                </td>
              </tr>
            ) : (
              assets.map(a => (
                <Fragment key={a.id}>
                  <tr
                    className="border-b border-gray-700/30 hover:bg-gray-700/20 transition-colors cursor-pointer"
                    onClick={() => handleExpand(a.id)}
                  >
                    <td className="px-4 py-3 text-gray-500">
                      {expandedId === a.id ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    </td>
                    <td className="px-4 py-3 font-mono text-blue-400 text-xs">{a.asset_code}</td>
                    <td className="px-4 py-3 text-white">{a.asset_name}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{a.asset_category}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{a.acquisition_date}</td>
                    <td className="px-4 py-3 text-right text-white text-xs">{a.cost.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right text-green-400 text-xs">{a.net_book_value.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right text-purple-400 text-xs">{a.ct_net_book_value.toLocaleString()}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`text-xs px-2 py-0.5 rounded-full border ${a.status === 'active' ? 'border-green-700 text-green-400 bg-green-900/30' : 'border-gray-600 text-gray-400'}`}>
                        {a.status}
                      </span>
                    </td>
                  </tr>
                  {expandedId === a.id && schedule?.asset_id === a.id && (
                    <tr key={`${a.id}-sched`}>
                      <td colSpan={9} className="bg-gray-900/60 px-6 py-4 border-b border-gray-700">
                        <p className="text-xs font-semibold text-gray-400 mb-3 uppercase tracking-wider">Depreciation Schedule</p>
                        <div className="overflow-x-auto">
                          <table className="text-xs w-full">
                            <thead>
                              <tr className="text-gray-500">
                                <th className="text-left py-1 pr-4 font-normal">Year</th>
                                <th className="text-right py-1 pr-4 font-normal">IFRS Dep</th>
                                <th className="text-right py-1 pr-4 font-normal">IFRS NBV</th>
                                <th className="text-right py-1 pr-4 font-normal">CT Dep</th>
                                <th className="text-right py-1 font-normal">CT NBV</th>
                              </tr>
                            </thead>
                            <tbody>
                              {schedule.schedule.map((r: any) => (
                                <tr key={r.year} className="border-t border-gray-800">
                                  <td className="py-1 pr-4 text-gray-300">{r.year}</td>
                                  <td className="py-1 pr-4 text-right text-amber-400">{(r.ifrs_depreciation ?? 0).toLocaleString()}</td>
                                  <td className="py-1 pr-4 text-right text-green-400">{(r.ifrs_closing_nbv ?? 0).toLocaleString()}</td>
                                  <td className="py-1 pr-4 text-right text-amber-400">{(r.ct_depreciation ?? 0).toLocaleString()}</td>
                                  <td className="py-1 text-right text-purple-400">{(r.ct_closing_nbv ?? 0).toLocaleString()}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
