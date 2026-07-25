import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Loader2, Radar, ExternalLink } from 'lucide-react';
import {
  fetchFtaApRisk,
  fetchFtaAuditChecklist,
  fetchVatTransactions,
  taxPeriodToDateRange,
  type FtaAuditChecklist,
} from '../../services/gulfTaxApi';
import { useCompany } from '../../context/CompanyContext';

function currentQuarter(): string {
  const d = new Date();
  const q = Math.floor(d.getMonth() / 3) + 1;
  return `${d.getFullYear()}-Q${q}`;
}

type ApRisk = {
  total_invoices?: number;
  total_vat_at_risk_aed?: number;
  blocked_input_vat_aed?: number;
  flag_counts?: { high?: number; medium?: number; low?: number; total?: number };
  anomaly_counts?: { missing_or_invalid_trn?: number; duplicate_invoices?: number };
};

type VatTxn = {
  id?: number;
  description?: string;
  vendor_or_customer?: string;
  invoice_number?: string;
  vat_treatment?: string;
  confidence_score?: number;
  is_verified?: boolean;
  amount_aed?: number;
};

export default function AnomalyDetectionPage() {
  const { activeCompanyId } = useCompany();
  const [period, setPeriod] = useState(currentQuarter());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [apRisk, setApRisk] = useState<ApRisk | null>(null);
  const [checklist, setChecklist] = useState<FtaAuditChecklist | null>(null);
  const [txns, setTxns] = useState<VatTxn[]>([]);

  const load = useCallback(async () => {
    if (!activeCompanyId) return;
    setLoading(true);
    setError(null);
    const { start, end } = taxPeriodToDateRange(period);
    try {
      const [risk, cl, vat] = await Promise.all([
        fetchFtaApRisk().catch(() => null),
        fetchFtaAuditChecklist(start, end).catch(() => null),
        fetchVatTransactions(200).catch(() => []),
      ]);
      setApRisk((risk as ApRisk) || null);
      setChecklist(cl);
      const list = Array.isArray(vat) ? vat : (vat as { transactions?: VatTxn[] })?.transactions || [];
      setTxns(list as VatTxn[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load anomalies');
    } finally {
      setLoading(false);
    }
  }, [activeCompanyId, period]);

  useEffect(() => {
    void load();
  }, [load]);

  const lowConfidence = useMemo(
    () =>
      txns.filter(
        (t) => t.confidence_score != null && Number(t.confidence_score) < 70 && !t.is_verified,
      ),
    [txns],
  );

  const unclassified = useMemo(
    () => txns.filter((t) => !(t.vat_treatment || '').trim()),
    [txns],
  );

  const failItems = (checklist?.items || []).filter((i) => i.status === 'fail' || i.status === 'warning');

  const fmt = (n: number) =>
    `AED ${Number(n || 0).toLocaleString('en-AE', { minimumFractionDigits: 2 })}`;

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl font-semibold text-white flex items-center gap-2">
            <Radar className="w-5 h-5 text-amber-400" />
            Anomaly Detection
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Tax &amp; AP risk signals — TRN gaps, duplicates, low-confidence VAT classifications
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            className="bg-gray-900 border border-white/10 rounded-lg px-3 py-2 text-sm text-white w-32"
          />
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="px-3 py-2 rounded-lg text-sm bg-amber-500/20 text-amber-400 border border-amber-500/30"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Refresh'}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
          <div className="text-[10px] uppercase text-gray-500 font-mono">Missing / invalid TRN</div>
          <div className="text-2xl font-bold text-amber-400 mt-1">
            {apRisk?.anomaly_counts?.missing_or_invalid_trn ?? '—'}
          </div>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
          <div className="text-[10px] uppercase text-gray-500 font-mono">Duplicate invoices</div>
          <div className="text-2xl font-bold text-red-400 mt-1">
            {apRisk?.anomaly_counts?.duplicate_invoices ?? '—'}
          </div>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
          <div className="text-[10px] uppercase text-gray-500 font-mono">VAT at risk</div>
          <div className="text-2xl font-bold text-white mt-1">
            {apRisk?.total_vat_at_risk_aed != null ? fmt(apRisk.total_vat_at_risk_aed) : '—'}
          </div>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
          <div className="text-[10px] uppercase text-gray-500 font-mono">Low-confidence VAT</div>
          <div className="text-2xl font-bold text-amber-300 mt-1">{lowConfidence.length}</div>
        </div>
      </div>

      <div className="mb-4 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-amber-100">
          For statistical AP anomaly intelligence (Benford / SPC / vendor outliers), open the AP module.
        </p>
        <Link
          to="/ap-invoices/anomaly"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-300 underline"
        >
          Open AP Anomaly Intelligence <ExternalLink className="w-3.5 h-3.5" />
        </Link>
      </div>

      <div className="grid lg:grid-cols-2 gap-4 mb-6">
        <div className="rounded-xl border border-white/10 overflow-hidden">
          <div className="px-4 py-3 bg-white/[0.03] border-b border-white/10 text-sm font-semibold text-white">
            Compliance warnings
          </div>
          <div className="divide-y divide-white/5 max-h-80 overflow-y-auto">
            {failItems.length === 0 && (
              <p className="px-4 py-6 text-sm text-gray-500">No fail/warning checklist items for this period.</p>
            )}
            {failItems.map((item) => (
              <div key={item.id} className="px-4 py-3 flex gap-2">
                <AlertTriangle
                  className={`w-4 h-4 shrink-0 mt-0.5 ${
                    item.status === 'fail' ? 'text-red-400' : 'text-amber-400'
                  }`}
                />
                <div>
                  <div className="text-sm text-white">{item.title}</div>
                  <div className="text-xs text-gray-500 font-mono mt-0.5">{item.detail}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-white/10 overflow-hidden">
          <div className="px-4 py-3 bg-white/[0.03] border-b border-white/10 text-sm font-semibold text-white">
            Low-confidence / unclassified ({lowConfidence.length + unclassified.length})
          </div>
          <div className="divide-y divide-white/5 max-h-80 overflow-y-auto">
            {[...unclassified, ...lowConfidence].slice(0, 40).map((t, i) => (
              <div key={t.id ?? i} className="px-4 py-2.5 text-sm">
                <div className="text-white truncate">
                  {t.invoice_number || t.description || 'Transaction'}
                </div>
                <div className="text-xs text-gray-500 mt-0.5">
                  {t.vendor_or_customer || '—'} · conf {t.confidence_score ?? '—'}% ·{' '}
                  {t.vat_treatment || 'unclassified'}
                </div>
              </div>
            ))}
            {lowConfidence.length + unclassified.length === 0 && (
              <p className="px-4 py-6 text-sm text-gray-500">No classification anomalies in Saved transactions.</p>
            )}
          </div>
          <div className="px-4 py-2 border-t border-white/10">
            <Link to="/gulftax/vat-classifier" className="text-xs text-teal-400 underline">
              Review in VAT Classifier →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
