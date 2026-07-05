import { useCallback, useEffect, useState } from 'react';
import { Download, FileArchive, Loader2, Shield } from 'lucide-react';
import {
  downloadAuditPack,
  fetchAuditManifest,
  fetchAuditPeriods,
  type AuditManifest,
  type AuditPeriod,
} from '../../services/gulfTaxApi';
import { useCompany } from '../../context/CompanyContext';

export default function AuditExportsPage() {
  const { companyId } = useCompany();
  const [periods, setPeriods] = useState<AuditPeriod[]>([]);
  const [taxPeriod, setTaxPeriod] = useState('');
  const [manifest, setManifest] = useState<AuditManifest | null>(null);
  const [loadingPeriods, setLoadingPeriods] = useState(true);
  const [loadingManifest, setLoadingManifest] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);

  const loadPeriods = useCallback(async () => {
    if (!companyId) return;
    setLoadingPeriods(true);
    setError(null);
    try {
      const res = await fetchAuditPeriods();
      const items = res.items ?? [];
      setPeriods(items);
      if (items.length && !taxPeriod) {
        setTaxPeriod(items[0].tax_period);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load periods');
    } finally {
      setLoadingPeriods(false);
    }
  }, [companyId, taxPeriod]);

  const loadManifest = useCallback(async () => {
    if (!taxPeriod || !companyId) {
      setManifest(null);
      return;
    }
    setLoadingManifest(true);
    setError(null);
    try {
      const m = await fetchAuditManifest(taxPeriod);
      setManifest(m);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load manifest');
      setManifest(null);
    } finally {
      setLoadingManifest(false);
    }
  }, [taxPeriod, companyId]);

  useEffect(() => {
    void loadPeriods();
  }, [loadPeriods]);

  useEffect(() => {
    void loadManifest();
  }, [loadManifest]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const handleDownload = async () => {
    if (!taxPeriod) return;
    setDownloading(true);
    setError(null);
    try {
      await downloadAuditPack(taxPeriod);
      setToast({ kind: 'success', message: 'Audit pack downloaded' });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Download failed';
      setError(msg);
      setToast({ kind: 'error', message: msg });
    } finally {
      setDownloading(false);
    }
  };

  if (!companyId) {
    return (
      <div className="p-6 text-slate-400">
        Select a company to export audit packs.
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl space-y-6">
      <div className="flex items-start gap-3">
        <Shield className="h-8 w-8 text-emerald-400 shrink-0 mt-1" />
        <div>
          <h1 className="text-2xl font-semibold text-white">Audit-Ready Exports</h1>
          <p className="text-slate-400 text-sm mt-1">
            Download a tamper-evident ZIP with VAT return, transaction listing, reconciliation,
            CT return, advanced VAT, and audit trail — RDS artifacts only.
          </p>
        </div>
      </div>

      {toast && (
        <div
          className={`rounded-lg px-4 py-2 text-sm ${
            toast.kind === 'success' ? 'bg-emerald-900/50 text-emerald-200' : 'bg-red-900/50 text-red-200'
          }`}
        >
          {toast.message}
        </div>
      )}

      {error && (
        <div className="rounded-lg bg-red-900/40 border border-red-700 px-4 py-3 text-red-200 text-sm">
          {error}
        </div>
      )}

      <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-5 space-y-4">
        <label className="block text-sm text-slate-300">
          Tax period
          <select
            className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-800 text-white px-3 py-2"
            value={taxPeriod}
            onChange={e => setTaxPeriod(e.target.value)}
            disabled={loadingPeriods || periods.length === 0}
          >
            {periods.length === 0 && <option value="">No periods found</option>}
            {periods.map(p => (
              <option key={p.tax_period} value={p.tax_period}>
                {p.tax_period}
                {p.transaction_count != null ? ` (${p.transaction_count} transactions)` : ''}
              </option>
            ))}
          </select>
        </label>

        {loadingPeriods && (
          <p className="text-slate-400 text-sm flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading periods…
          </p>
        )}
      </div>

      <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-5">
        <h2 className="text-lg font-medium text-white flex items-center gap-2 mb-4">
          <FileArchive className="h-5 w-5 text-sky-400" />
          Pack manifest preview
        </h2>

        {loadingManifest && (
          <p className="text-slate-400 text-sm flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Building preview…
          </p>
        )}

        {!loadingManifest && manifest && (
          <div className="space-y-4">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <dt className="text-slate-500">Company</dt>
              <dd className="text-white">{manifest.company_name}</dd>
              <dt className="text-slate-500">TRN</dt>
              <dd className="text-white">{manifest.trn || '—'}</dd>
              <dt className="text-slate-500">Period</dt>
              <dd className="text-white">
                {manifest.tax_period} ({manifest.period_start} → {manifest.period_end})
              </dd>
            </dl>

            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-700">
                  <th className="pb-2 pr-4">Sheet</th>
                  <th className="pb-2 pr-4">Description</th>
                  <th className="pb-2 text-right">Rows</th>
                </tr>
              </thead>
              <tbody>
                {manifest.artifacts.map(a => (
                  <tr key={a.sheet} className="border-b border-slate-800">
                    <td className="py-2 pr-4 text-white font-medium">{a.sheet}</td>
                    <td className="py-2 pr-4 text-slate-400">{a.description}</td>
                    <td className="py-2 text-right text-slate-300">{a.row_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {manifest.preview && (
              <p className="text-xs text-slate-500">
                SHA-256 hash is computed when you download the full pack.
              </p>
            )}
          </div>
        )}

        {!loadingManifest && !manifest && taxPeriod && (
          <p className="text-slate-500 text-sm">No manifest available for this period.</p>
        )}
      </div>

      <button
        type="button"
        onClick={() => void handleDownload()}
        disabled={!taxPeriod || downloading || loadingPeriods}
        className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-5 py-2.5 font-medium"
      >
        {downloading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Download className="h-4 w-4" />
        )}
        Download Audit Pack
      </button>
    </div>
  );
}
