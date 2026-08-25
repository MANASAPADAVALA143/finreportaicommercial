import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, ShieldCheck, AlertTriangle, XCircle, CheckCircle2 } from 'lucide-react';
import {
  fetchFtaAuditChecklist,
  fetchVatReturnAllBoxes,
  fetchVatReconStatus,
  taxPeriodToDateRange,
  type FtaAuditChecklist,
  type VatReconStatus,
} from '../../services/gulfTaxApi';
import { useCompany } from '../../context/CompanyContext';

function currentQuarter(): string {
  const d = new Date();
  const q = Math.floor(d.getMonth() / 3) + 1;
  return `${d.getFullYear()}-Q${q}`;
}

const STATUS_STYLE: Record<string, string> = {
  pass: 'bg-green-500/15 text-green-400 border-green-500/30',
  warning: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  fail: 'bg-red-500/15 text-red-400 border-red-500/30',
  na: 'bg-white/5 text-gray-400 border-white/10',
};

export default function TaxComplianceReportPage() {
  const { activeCompanyId } = useCompany();
  const [period, setPeriod] = useState(currentQuarter());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checklist, setChecklist] = useState<FtaAuditChecklist | null>(null);
  const [recon, setRecon] = useState<VatReconStatus | null>(null);
  const [box12, setBox12] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!activeCompanyId) return;
    setLoading(true);
    setError(null);
    const { start, end } = taxPeriodToDateRange(period);
    try {
      const [cl, rs, boxes] = await Promise.all([
        fetchFtaAuditChecklist(start, end),
        fetchVatReconStatus(period, activeCompanyId).catch(() => null),
        fetchVatReturnAllBoxes(period, activeCompanyId).catch(() => null),
      ]);
      setChecklist(cl);
      setRecon(rs);
      setBox12(
        boxes && typeof boxes.box12_net_vat_payable_or_refundable === 'number'
          ? Number(boxes.box12_net_vat_payable_or_refundable)
          : null,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load compliance report');
      setChecklist(null);
    } finally {
      setLoading(false);
    }
  }, [activeCompanyId, period]);

  useEffect(() => {
    void load();
  }, [load]);

  const fmt = (n: number) =>
    `AED ${n.toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl font-semibold text-white flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-amber-400" />
            Tax Compliance Report
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Period readiness scorecard — TRN, classification, AP controls, VAT return &amp; recon
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            className="bg-gray-900 border border-white/10 rounded-lg px-3 py-2 text-sm text-white w-32"
            placeholder="2026-Q2"
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

      {checklist && (
        <>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
              <div className="text-[10px] uppercase tracking-widest text-gray-500 font-mono">Score</div>
              <div className="text-3xl font-black text-white mt-1">{checklist.overall_score_pct}%</div>
              <div className="text-xs text-gray-500 mt-1">{checklist.company_name}</div>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
              <div className="text-[10px] uppercase tracking-widest text-gray-500 font-mono">Risk</div>
              <div
                className={`text-2xl font-bold mt-1 capitalize ${
                  checklist.overall_risk === 'high'
                    ? 'text-red-400'
                    : checklist.overall_risk === 'medium'
                      ? 'text-amber-400'
                      : 'text-green-400'
                }`}
              >
                {checklist.overall_risk}
              </div>
              <div className="text-xs text-gray-500 mt-1">
                {checklist.summary.pass} pass · {checklist.summary.warning} warn · {checklist.summary.fail} fail
              </div>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
              <div className="text-[10px] uppercase tracking-widest text-gray-500 font-mono">Box 12</div>
              <div className="text-2xl font-bold text-amber-400 mt-1">
                {box12 != null ? fmt(box12) : '—'}
              </div>
              <div className="text-xs text-gray-500 mt-1">
                <Link to="/gulftax/vat-return" className="text-teal-400 underline">
                  VAT Return →
                </Link>
              </div>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
              <div className="text-[10px] uppercase tracking-widest text-gray-500 font-mono">Recon</div>
              <div className="text-2xl font-bold text-white mt-1 capitalize">
                {recon?.status?.replace(/_/g, ' ') ?? '—'}
              </div>
              <div className="text-xs text-gray-500 mt-1">
                <Link to="/gulftax/recon-summary" className="text-teal-400 underline">
                  Recon summary →
                </Link>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-white/10 overflow-hidden">
            <div className="px-4 py-3 bg-white/[0.03] border-b border-white/10 text-sm font-semibold text-white">
              Checklist ({checklist.transaction_count} transactions · {checklist.period_start} →{' '}
              {checklist.period_end})
            </div>
            <div className="divide-y divide-white/5">
              {checklist.items.map((item) => (
                <div key={item.id} className="px-4 py-3 flex gap-3 items-start">
                  <div className="mt-0.5">
                    {item.status === 'pass' && <CheckCircle2 className="w-4 h-4 text-green-400" />}
                    {item.status === 'warning' && <AlertTriangle className="w-4 h-4 text-amber-400" />}
                    {item.status === 'fail' && <XCircle className="w-4 h-4 text-red-400" />}
                    {item.status === 'na' && <AlertTriangle className="w-4 h-4 text-gray-500" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-white">{item.title}</span>
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold uppercase ${STATUS_STYLE[item.status]}`}
                      >
                        {item.status}
                      </span>
                      <span className="text-[10px] text-gray-500 font-mono">{item.category}</span>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">{item.description}</p>
                    <p className="text-xs text-gray-400 mt-1 font-mono">{item.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-3 text-xs">
            <Link to="/gulftax/audit-exports" className="text-amber-400 underline">
              Download audit pack →
            </Link>
            <Link to="/gulftax/fta-reports" className="text-teal-400 underline">
              FTA Reports →
            </Link>
            <Link to="/gulftax/tax-memo" className="text-teal-400 underline">
              Generate tax memo →
            </Link>
          </div>
        </>
      )}

      {!loading && !checklist && !error && (
        <p className="text-sm text-gray-500">Select a company and period to generate the report.</p>
      )}
    </div>
  );
}
