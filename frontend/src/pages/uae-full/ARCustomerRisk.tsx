/**
 * AR Customer Risk — per-customer risk dashboard
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, ShieldAlert } from 'lucide-react';
import toast from 'react-hot-toast';
import { useCompany } from '../../context/CompanyContext';
import * as arSvc from '../../services/arService';
import type { ARCustomerRiskRow } from '../../services/arService';

const RISK_TIERS = ['all', 'low', 'medium', 'high', 'critical'] as const;
type RiskFilter = (typeof RISK_TIERS)[number];

const RISK_BADGE: Record<string, string> = {
  low: 'bg-green-900/40 text-green-400 border-green-700',
  medium: 'bg-amber-900/40 text-amber-400 border-amber-700',
  high: 'bg-red-900/40 text-red-400 border-red-700',
  critical: 'bg-red-950/60 text-red-300 border-red-800',
};

type SortKey =
  | 'customer_name'
  | 'risk_tier'
  | 'total_outstanding'
  | 'total_overdue'
  | 'credit_notes_count'
  | 'avg_days_to_pay';

function fmtAED(n: number): string {
  return `AED ${n.toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function riskRank(tier: string): number {
  return { low: 0, medium: 1, high: 2, critical: 3 }[tier] ?? 0;
}

export default function ARCustomerRisk() {
  const { activeCompanyId } = useCompany();
  const companyId = activeCompanyId ?? '';

  const [rows, setRows] = useState<ARCustomerRiskRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [tierFilter, setTierFilter] = useState<RiskFilter>('all');
  const [sortKey, setSortKey] = useState<SortKey>('risk_tier');
  const [sortAsc, setSortAsc] = useState(false);
  const [summary, setSummary] = useState({ total_outstanding: 0, total_overdue: 0, customer_count: 0 });

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    try {
      const res = await arSvc.getARCustomerRisk(
        tierFilter === 'all' ? undefined : tierFilter,
      );
      setRows(res.customers);
      setSummary({
        total_outstanding: res.total_outstanding,
        total_overdue: res.total_overdue,
        customer_count: res.customer_count,
      });
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Failed to load customer risk');
    } finally {
      setLoading(false);
    }
  }, [companyId, tierFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'customer_name':
          cmp = a.customer_name.localeCompare(b.customer_name);
          break;
        case 'risk_tier':
          cmp = riskRank(a.risk_tier) - riskRank(b.risk_tier);
          break;
        case 'total_outstanding':
          cmp = a.total_outstanding - b.total_outstanding;
          break;
        case 'total_overdue':
          cmp = a.total_overdue - b.total_overdue;
          break;
        case 'credit_notes_count':
          cmp = a.credit_notes_count - b.credit_notes_count;
          break;
        case 'avg_days_to_pay':
          cmp = (a.avg_days_to_pay ?? -1) - (b.avg_days_to_pay ?? -1);
          break;
        default:
          break;
      }
      return sortAsc ? cmp : -cmp;
    });
    return copy;
  }, [rows, sortKey, sortAsc]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(key === 'customer_name');
    }
  }

  function sortIndicator(key: SortKey) {
    if (sortKey !== key) return '';
    return sortAsc ? ' ↑' : ' ↓';
  }

  if (!companyId) {
    return (
      <div className="p-6 text-gray-400">
        Select a company to view customer risk.
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <ShieldAlert className="w-7 h-7 text-teal-400" />
          <div>
            <h1 className="text-2xl font-semibold text-white">Customer Risk</h1>
            <p className="text-sm text-gray-400">
              AR exposure by customer — aging buckets, credit notes, payment history
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Customers at risk</p>
          <p className="text-2xl font-semibold text-white mt-1">{summary.customer_count}</p>
        </div>
        <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Total outstanding</p>
          <p className="text-2xl font-semibold text-teal-400 mt-1">{fmtAED(summary.total_outstanding)}</p>
        </div>
        <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Total overdue</p>
          <p className="text-2xl font-semibold text-amber-400 mt-1">{fmtAED(summary.total_overdue)}</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        {RISK_TIERS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTierFilter(t)}
            className={`px-3 py-1.5 rounded-lg text-sm border capitalize ${
              tierFilter === t
                ? 'bg-teal-900/40 border-teal-600 text-teal-300'
                : 'bg-gray-900 border-gray-700 text-gray-400 hover:border-gray-600'
            }`}
          >
            {t === 'all' ? 'All tiers' : t}
          </button>
        ))}
      </div>

      <div className="rounded-xl border border-gray-800 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-900/80 text-gray-400 text-left">
            <tr>
              <th className="px-4 py-3 cursor-pointer" onClick={() => toggleSort('customer_name')}>
                Customer{sortIndicator('customer_name')}
              </th>
              <th className="px-4 py-3 cursor-pointer" onClick={() => toggleSort('risk_tier')}>
                Risk{sortIndicator('risk_tier')}
              </th>
              <th className="px-4 py-3 cursor-pointer text-right" onClick={() => toggleSort('total_outstanding')}>
                Outstanding{sortIndicator('total_outstanding')}
              </th>
              <th className="px-4 py-3 cursor-pointer text-right" onClick={() => toggleSort('total_overdue')}>
                Overdue{sortIndicator('total_overdue')}
              </th>
              <th className="px-4 py-3 cursor-pointer text-right" onClick={() => toggleSort('credit_notes_count')}>
                Credit notes{sortIndicator('credit_notes_count')}
              </th>
              <th className="px-4 py-3 cursor-pointer text-right" onClick={() => toggleSort('avg_days_to_pay')}>
                Avg days to pay{sortIndicator('avg_days_to_pay')}
              </th>
              <th className="px-4 py-3 text-right">Worst bucket</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                  Loading…
                </td>
              </tr>
            ) : sorted.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                  No customers with open AR balance.
                </td>
              </tr>
            ) : (
              sorted.map((row) => (
                <tr key={row.customer_id ?? row.customer_name} className="border-t border-gray-800 hover:bg-gray-900/40">
                  <td className="px-4 py-3 font-medium text-white">{row.customer_name}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-block px-2 py-0.5 rounded border text-xs capitalize ${
                        RISK_BADGE[row.risk_tier] ?? RISK_BADGE.low
                      }`}
                    >
                      {row.risk_tier}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">{fmtAED(row.total_outstanding)}</td>
                  <td className="px-4 py-3 text-right text-amber-300">{fmtAED(row.total_overdue)}</td>
                  <td className="px-4 py-3 text-right">
                    {row.credit_notes_count}
                    {row.total_credited > 0 && (
                      <span className="text-gray-500 text-xs ml-1">
                        ({fmtAED(row.total_credited)})
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {row.avg_days_to_pay != null ? `${row.avg_days_to_pay}d` : '—'}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-400">{row.worst_bucket}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
