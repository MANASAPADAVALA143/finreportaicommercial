import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { RefreshCw } from 'lucide-react';
import {
  CRM_STAGES,
  fetchCRMDashboard,
  fetchPipeline,
  fetchCreditRiskSummary,
  recalculateAllCreditRisk,
  updateDealStage,
  type CreditRiskSummary,
} from '../../services/crmService';

function fmt(n: number) {
  return `AED ${n.toLocaleString('en-AE', { maximumFractionDigits: 0 })}`;
}

const RISK_COL: Record<string, string> = {
  LOW: 'text-green-400',
  MEDIUM: 'text-amber-400',
  HIGH: 'text-orange-400',
  CRITICAL: 'text-red-400',
};

type DashTab = 'pipeline' | 'credit';

export default function CRMDashboard() {
  const [tab, setTab] = useState<DashTab>('pipeline');
  const [kpis, setKpis] = useState<Awaited<ReturnType<typeof fetchCRMDashboard>> | null>(null);
  const [pipeline, setPipeline] = useState<Awaited<ReturnType<typeof fetchPipeline>> | null>(null);
  const [credit, setCredit] = useState<CreditRiskSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [recalcing, setRecalcing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [d, p, c] = await Promise.all([
        fetchCRMDashboard(),
        fetchPipeline(),
        fetchCreditRiskSummary().catch(() => null),
      ]);
      setKpis(d);
      setPipeline(p);
      setCredit(c);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load CRM');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function moveDeal(deal: { id: string }, stage: string) {
    try {
      await updateDealStage(deal.id, stage);
      toast.success(`Moved to ${stage}`);
      void load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Update failed');
    }
  }

  async function handleRecalcAll() {
    setRecalcing(true);
    try {
      const res = await recalculateAllCreditRisk();
      setCredit(res);
      toast.success('Credit scores recalculated');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Recalculate failed');
    } finally {
      setRecalcing(false);
    }
  }

  if (loading) return <p className="text-gray-500">Loading CRM…</p>;

  const sum = credit?.summary;

  return (
    <div className="space-y-6">
      <div className="flex gap-2 border-b border-gray-800 pb-2">
        {(['pipeline', 'credit'] as DashTab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm rounded-t-lg capitalize ${tab === t ? 'bg-gray-800 text-teal-400' : 'text-gray-500 hover:text-gray-300'}`}
          >
            {t === 'credit' ? 'Credit Risk' : 'Pipeline'}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Pipeline value', value: fmt(kpis?.pipeline_value_aed ?? 0) },
          { label: 'Won this month', value: fmt(kpis?.deals_won_value_aed ?? 0) },
          { label: 'Open deals', value: String(kpis?.open_deals ?? 0) },
          { label: 'Overdue follow-ups', value: String(kpis?.overdue_activities_count ?? 0), warn: (kpis?.overdue_activities_count ?? 0) > 0 },
        ].map((c) => (
          <div key={c.label} className={`rounded-xl border p-4 ${c.warn ? 'border-red-800 bg-red-950/30' : 'border-gray-800 bg-gray-900/60'}`}>
            <p className="text-xs text-gray-500 uppercase tracking-wide">{c.label}</p>
            <p className="text-xl font-semibold mt-1">{c.value}</p>
          </div>
        ))}
      </div>

      {tab === 'pipeline' && (
        <div>
          <h2 className="text-lg font-semibold mb-3">Pipeline</h2>
          <div className="overflow-x-auto pb-2">
            <div className="flex gap-3 min-w-max">
              {CRM_STAGES.map((stage) => {
                const col = pipeline?.stages?.[stage];
                const deals = col?.deals ?? [];
                return (
                  <div key={stage} className="w-56 shrink-0 rounded-xl border border-gray-800 bg-gray-900/40 p-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium">{stage}</span>
                      <span className="text-xs text-gray-500">{deals.length}</span>
                    </div>
                    <p className="text-xs text-teal-400 mb-3">{fmt(col?.total_value_aed ?? 0)}</p>
                    <div className="space-y-2 max-h-64 overflow-y-auto">
                      {deals.map((d) => (
                        <div key={d.id} className="rounded-lg border border-gray-700 bg-gray-800/80 p-2 text-xs">
                          <p className="font-medium text-gray-200 truncate">{d.deal_name}</p>
                          <p className="text-gray-500 truncate">{d.company_name || d.contact_name || '—'}</p>
                          <p className="text-teal-400 mt-1">{fmt(d.value_aed)}</p>
                          <select
                            className="mt-2 w-full bg-gray-900 border border-gray-700 rounded text-xs py-1"
                            value={stage}
                            onChange={(e) => void moveDeal(d, e.target.value)}
                          >
                            {CRM_STAGES.map((s) => (
                              <option key={s} value={s}>{s}</option>
                            ))}
                          </select>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {tab === 'credit' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-semibold">Credit Risk</h2>
            <button
              type="button"
              disabled={recalcing}
              onClick={() => void handleRecalcAll()}
              className="flex items-center gap-2 bg-teal-800 hover:bg-teal-700 px-3 py-2 rounded-lg text-sm disabled:opacity-50"
            >
              <RefreshCw size={14} className={recalcing ? 'animate-spin' : ''} />
              Recalculate All
            </button>
          </div>

          {sum && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                { label: 'Portfolio risk score', value: `${sum.portfolio_risk_score}/100` },
                { label: 'Critical risk', value: `${sum.critical_risk_count} · ${fmt(credit?.customers.filter((c) => c.risk_category === 'CRITICAL').reduce((s, c) => s + c.total_outstanding_aed, 0) ?? 0)}` },
                { label: 'High risk', value: `${sum.high_risk_count} · ${fmt(credit?.customers.filter((c) => c.risk_category === 'HIGH').reduce((s, c) => s + c.total_outstanding_aed, 0) ?? 0)}` },
                { label: 'Total overdue', value: fmt(sum.total_overdue_aed) },
              ].map((c) => (
                <div key={c.label} className="rounded-xl border border-gray-800 bg-gray-900/60 p-4">
                  <p className="text-xs text-gray-500 uppercase">{c.label}</p>
                  <p className="text-lg font-semibold mt-1">{c.value}</p>
                </div>
              ))}
            </div>
          )}

          <div className="overflow-x-auto rounded-xl border border-gray-800">
            <table className="w-full text-sm">
              <thead className="bg-gray-900/80 text-gray-400 text-left">
                <tr>
                  {['Customer', 'Score', 'Risk', 'Outstanding', 'Overdue', 'Avg Days Late', 'Credit Limit', 'Recommendation'].map((h) => (
                    <th key={h} className="p-3 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(credit?.customers ?? []).map((c) => (
                  <tr key={c.contact_id} className="border-t border-gray-800 hover:bg-gray-900/40">
                    <td className="p-3 font-medium">{c.customer_name}</td>
                    <td className="p-3">{c.credit_score}</td>
                    <td className={`p-3 font-semibold ${RISK_COL[c.risk_category] ?? ''}`}>{c.risk_category}</td>
                    <td className="p-3">{fmt(c.total_outstanding_aed)}</td>
                    <td className="p-3 text-red-400">{fmt(c.overdue_amount_aed)}</td>
                    <td className="p-3">{c.avg_days_late}</td>
                    <td className="p-3">{fmt(c.recommended_credit_limit_aed)}</td>
                    <td className="p-3 text-gray-400 text-xs max-w-[200px]">{c.recommendation}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!credit?.customers?.length && (
              <p className="text-center py-8 text-gray-500">Add CRM contacts and AR invoices to see credit scores.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
