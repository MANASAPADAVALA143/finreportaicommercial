import { useEffect, useRef, useState } from 'react';
import { format } from 'date-fns';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Calculator, Download, FileUp, Save, Sparkles } from 'lucide-react';
import { useCompany } from '../../context/CompanyContext';
import {
  calculateIFRS16Lease,
  downloadIFRS16Excel,
  IBR_STORAGE_KEY,
  mapExtractionToForm,
  saveLeaseToRegister,
  uploadIFRS16Contract,
  type LeaseCalculateResult,
} from '../../services/ifrs16.service';

function fmt(n: number | undefined, currency = 'AED') {
  if (n == null) return '—';
  return `${currency} ${n.toLocaleString('en-AE', { maximumFractionDigits: 2 })}`;
}

export default function IFRS16Leases() {
  const { activeCompanyId } = useCompany();
  const fileRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState({
    lease_id: `LEASE-${Date.now().toString().slice(-6)}`,
    asset_description: '',
    lessee_name: '',
    lessor_name: '',
    asset_class: 'property',
    commencement_date: format(new Date(), 'yyyy-MM-dd'),
    lease_term_months: 36,
    monthly_payment: 50000,
    annual_discount_rate: 0.085,
    currency: 'AED',
  });
  const [result, setResult] = useState<LeaseCalculateResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(IBR_STORAGE_KEY);
    if (stored) {
      setForm((p) => ({ ...p, annual_discount_rate: Number(stored) }));
      localStorage.removeItem(IBR_STORAGE_KEY);
    }
  }, []);

  async function handleCalculate(e: React.FormEvent) {
    e.preventDefault();
    if (!form.asset_description.trim()) {
      toast.error('Asset description required');
      return;
    }
    setLoading(true);
    try {
      const res = await calculateIFRS16Lease(form);
      setResult(res);
      toast.success('IFRS 16 calculation complete');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Calculation failed');
    } finally {
      setLoading(false);
    }
  }

  async function handleUpload(file: File) {
    setExtracting(true);
    try {
      const res = await uploadIFRS16Contract(file);
      const mapped = mapExtractionToForm(res.extracted_data);
      setForm((p) => ({
        ...p,
        ...Object.fromEntries(Object.entries(mapped).filter(([, v]) => v != null && v !== '')),
      }));
      if (res.validation?.requires_review) {
        toast('Extraction complete — review low-confidence fields', { icon: '⚠️' });
      } else {
        toast.success(`Extracted from ${res.filename ?? 'contract'}`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Extraction failed');
    } finally {
      setExtracting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function handleExport() {
    if (!result) return;
    setExporting(true);
    try {
      await downloadIFRS16Excel(result.lease_id, result.results as Record<string, unknown>);
      toast.success('Excel workbook downloaded');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  }

  async function handleSave() {
    if (!result || !activeCompanyId) {
      toast.error(activeCompanyId ? 'Calculate first' : 'Select a company first');
      return;
    }
    setSaving(true);
    try {
      await saveLeaseToRegister({
        lease_name: form.asset_description || form.lease_id,
        asset_description: form.asset_description,
        asset_class: form.asset_class,
        commencement_date: form.commencement_date,
        lease_term_months: form.lease_term_months,
        monthly_payment: form.monthly_payment,
        lease_payments_aed: form.monthly_payment,
        annual_discount_rate: form.annual_discount_rate,
        incremental_borrowing_rate: form.annual_discount_rate,
        lease_liability: result.lease_liability,
        rou_asset: result.rou_asset,
        calculation_results: result.results,
      }, activeCompanyId);
      toast.success('Lease saved to register');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  const schedule = result?.results?.amortization_schedule ?? [];

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div>
            <p className="text-xs text-teal-400 uppercase tracking-widest mb-1">IFRS AI · Ported from ifrsai</p>
            <h1 className="text-2xl font-bold">IFRS 16 Lease Calculator</h1>
          <p className="text-gray-400 text-sm mt-1">Upload a contract, extract terms with AI, calculate liability & ROU asset</p>
          <Link to="/ifrs/16/leases" className="text-xs text-teal-400 hover:text-teal-300 mt-2 inline-block">View Lease Register →</Link>
        </div>
        <div className="flex gap-2">
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.docx,.txt,.xlsx,.xls"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleUpload(f);
              }}
            />
            <button
              type="button"
              disabled={extracting}
              onClick={() => fileRef.current?.click()}
              className="flex items-center gap-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 px-4 py-2 rounded-lg text-sm disabled:opacity-50"
            >
              {extracting ? <Sparkles size={16} className="animate-pulse" /> : <FileUp size={16} />}
              {extracting ? 'Extracting…' : 'Upload contract'}
            </button>
          </div>
        </div>

        <form onSubmit={(e) => void handleCalculate(e)} className="grid md:grid-cols-2 gap-4 bg-gray-900/60 border border-gray-800 rounded-xl p-6">
          {[
            { key: 'lease_id', label: 'Lease ID' },
            { key: 'asset_description', label: 'Asset description' },
            { key: 'lessee_name', label: 'Lessee' },
            { key: 'lessor_name', label: 'Lessor' },
          ].map(({ key, label }) => (
            <label key={key} className="block text-sm">
              <span className="text-gray-400 text-xs">{label}</span>
              <input
                className="mt-1 w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm"
                value={(form as Record<string, string | number>)[key] as string}
                onChange={(e) => setForm((p) => ({ ...p, [key]: e.target.value }))}
              />
            </label>
          ))}
          <label className="block text-sm">
            <span className="text-gray-400 text-xs">Commencement date</span>
            <input type="date" className="mt-1 w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm"
              value={form.commencement_date} onChange={(e) => setForm((p) => ({ ...p, commencement_date: e.target.value }))} />
          </label>
          <label className="block text-sm">
            <span className="text-gray-400 text-xs">Term (months)</span>
            <input type="number" className="mt-1 w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm"
              value={form.lease_term_months} onChange={(e) => setForm((p) => ({ ...p, lease_term_months: Number(e.target.value) }))} />
          </label>
          <label className="block text-sm">
            <span className="text-gray-400 text-xs">Monthly payment</span>
            <input type="number" className="mt-1 w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm"
              value={form.monthly_payment} onChange={(e) => setForm((p) => ({ ...p, monthly_payment: Number(e.target.value) }))} />
          </label>
          <label className="block text-sm">
            <span className="text-gray-400 text-xs">Asset class</span>
            <select className="mt-1 w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm" value={form.asset_class} onChange={(e) => setForm((p) => ({ ...p, asset_class: e.target.value }))}>
              {['property', 'vehicle', 'equipment', 'other'].map((c) => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
            </select>
          </label>
          <label className="block text-sm">
            <span className="text-gray-400 text-xs">IBR (e.g. 0.085 = 8.5%) · <Link to="/ifrs/16/ibr-tool" className="text-teal-500">IBR Tool</Link></span>
            <input type="number" step="0.001" className="mt-1 w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm"
              value={form.annual_discount_rate} onChange={(e) => setForm((p) => ({ ...p, annual_discount_rate: Number(e.target.value) }))} />
          </label>
          <div className="md:col-span-2 flex justify-end">
            <button type="submit" disabled={loading}
              className="flex items-center gap-2 bg-teal-700 hover:bg-teal-600 px-5 py-2 rounded-lg text-sm font-medium disabled:opacity-50">
              <Calculator size={16} /> {loading ? 'Calculating…' : 'Calculate IFRS 16'}
            </button>
          </div>
        </form>

        {result && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {[
                { label: 'Lease liability', value: result.lease_liability },
                { label: 'ROU asset', value: result.rou_asset },
                { label: 'Total interest', value: result.total_interest },
              ].map((c) => (
                <div key={c.label} className="bg-gray-900/60 border border-gray-800 rounded-xl p-4">
                  <p className="text-xs text-gray-500">{c.label}</p>
                  <p className="text-xl font-bold text-teal-400 mt-1">{fmt(c.value, result.currency)}</p>
                </div>
              ))}
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                disabled={saving || !activeCompanyId}
                onClick={() => void handleSave()}
                className="flex items-center gap-2 bg-amber-800 hover:bg-amber-700 px-5 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
              >
                <Save size={16} /> {saving ? 'Saving…' : 'Save Lease to Register'}
              </button>
            </div>

            <div className="bg-gray-900/60 border border-gray-800 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
                <h2 className="font-semibold text-sm">Amortization schedule (first 12 periods)</h2>
                <button
                  type="button"
                  disabled={exporting}
                  onClick={() => void handleExport()}
                  className="text-xs text-teal-400 hover:text-teal-300 flex items-center gap-1 disabled:opacity-50"
                >
                  <Download size={12} /> {exporting ? 'Exporting…' : 'Download Excel'}
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-gray-800/80 text-gray-400">
                    <tr>
                      {['Period', 'Payment', 'Interest', 'Principal', 'Liability', 'ROU NBV'].map((h) => (
                        <th key={h} className="px-3 py-2 text-left">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {schedule.slice(0, 12).map((row, i) => (
                      <tr key={i} className="border-t border-gray-800">
                        <td className="px-3 py-2">{String(row.Period ?? row.period ?? i + 1)}</td>
                        <td className="px-3 py-2">{fmt(Number(row.Payment ?? row.payment ?? row.lease_payment ?? 0), result.currency)}</td>
                        <td className="px-3 py-2">{fmt(Number(row.Interest ?? row.interest_expense ?? row.interest ?? 0), result.currency)}</td>
                        <td className="px-3 py-2">{fmt(Number(row.Principal ?? row.principal_reduction ?? row.principal ?? 0), result.currency)}</td>
                        <td className="px-3 py-2">{fmt(Number(row['Lease Liability'] ?? row.lease_liability_balance ?? row.liability ?? 0), result.currency)}</td>
                        <td className="px-3 py-2">{fmt(Number(row['ROU Asset'] ?? row.rou_asset_balance ?? row.rou_nbv ?? 0), result.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
