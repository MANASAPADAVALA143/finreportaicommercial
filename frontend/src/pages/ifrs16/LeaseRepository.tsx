import { useCallback, useEffect, useState } from 'react';
import { format } from 'date-fns';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  Building2, Download, FileText, RefreshCw, Search, Trash2, TrendingUp,
} from 'lucide-react';
import { useCompany } from '../../context/CompanyContext';
import {
  downloadAuditPdf,
  downloadIFRS16Excel,
  fetchLeases,
  fetchPortfolioSummary,
  postAllMonthlyJEs,
  postMonthlyJE,
  terminateLease,
  type LeaseRecord,
  type PortfolioSummary,
} from '../../services/ifrs16.service';
import { CPIRemeasureModal } from './CPIRemeasureModal';

function fmt(n: number | undefined) {
  if (n == null) return '—';
  return `AED ${n.toLocaleString('en-AE', { maximumFractionDigits: 0 })}`;
}

function statusBadge(s: string) {
  const colors: Record<string, string> = {
    active: 'bg-teal-900/50 text-teal-300',
    expired: 'bg-gray-700 text-gray-400',
    terminated: 'bg-red-900/40 text-red-300',
    modified: 'bg-amber-900/40 text-amber-300',
  };
  return colors[s] ?? 'bg-gray-700 text-gray-300';
}

export default function LeaseRepository() {
  const { activeCompanyId } = useCompany();
  const [leases, setLeases] = useState<LeaseRecord[]>([]);
  const [summary, setSummary] = useState<PortfolioSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [assetFilter, setAssetFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [scheduleLease, setScheduleLease] = useState<LeaseRecord | null>(null);
  const [remeasureLease, setRemeasureLease] = useState<LeaseRecord | null>(null);
  const [posting, setPosting] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!activeCompanyId) return;
    setLoading(true);
    try {
      const [ls, sm] = await Promise.all([
        fetchLeases(activeCompanyId, {
          search: search || undefined,
          asset_class: assetFilter !== 'all' ? assetFilter : undefined,
          status: statusFilter !== 'all' ? statusFilter : undefined,
        }),
        fetchPortfolioSummary(activeCompanyId),
      ]);
      setLeases(ls);
      setSummary(sm);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load leases');
    } finally {
      setLoading(false);
    }
  }, [activeCompanyId, search, assetFilter, statusFilter]);

  useEffect(() => { void load(); }, [load]);

  async function handlePostJE(lease: LeaseRecord) {
    if (!activeCompanyId) return;
    setPosting(lease.id);
    try {
      const period = format(new Date(), 'yyyy-MM-dd');
      const res = await postMonthlyJE(lease.id, period, activeCompanyId);
      toast.success(`3 journal entries posted for ${res.lease_name}`, { duration: 5000 });
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'JE posting failed');
    } finally {
      setPosting(null);
    }
  }

  async function handlePostAll() {
    if (!activeCompanyId) return;
    setPosting('all');
    try {
      const period = format(new Date(), 'yyyy-MM-dd');
      const res = await postAllMonthlyJEs(period, activeCompanyId);
      toast.success(`Posted JEs for ${res.successful} leases (${res.failed} failed)`);
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Bulk posting failed');
    } finally {
      setPosting(null);
    }
  }

  if (!activeCompanyId) {
    return (
      <div className="min-h-screen bg-gray-950 text-gray-100 p-6 flex items-center justify-center">
        <p className="text-gray-400">Select a company to view the lease register.</p>
      </div>
    );
  }

  const schedule = (scheduleLease?.calculation_results?.amortization_schedule ?? []) as Array<Record<string, unknown>>;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <p className="text-xs text-teal-400 uppercase tracking-widest mb-1">IFRS 16</p>
            <h1 className="text-2xl font-bold flex items-center gap-2"><Building2 size={22} /> Lease Register</h1>
          </div>
          <div className="flex gap-2 flex-wrap">
            <button onClick={() => void load()} className="flex items-center gap-1 text-xs bg-gray-800 px-3 py-2 rounded-lg border border-gray-700">
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
            </button>
            <button
              disabled={posting === 'all'}
              onClick={() => void handlePostAll()}
              className="text-xs bg-teal-800 hover:bg-teal-700 px-3 py-2 rounded-lg disabled:opacity-50"
            >
              Post All Leases This Month
            </button>
            <button
              onClick={() => void downloadAuditPdf(activeCompanyId)}
              className="flex items-center gap-1 text-xs bg-gray-800 px-3 py-2 rounded-lg border border-gray-700"
            >
              <FileText size={14} /> Download Audit PDF
            </button>
            <Link to="/ifrs/16" className="text-xs bg-teal-700 hover:bg-teal-600 px-3 py-2 rounded-lg">+ New Lease</Link>
          </div>
        </div>

        {summary && (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {[
              { label: 'Total ROU Assets', value: fmt(summary.total_rou_assets_aed) },
              { label: 'Total Lease Liability', value: fmt(summary.total_lease_liability_aed) },
              { label: 'Active Leases', value: String(summary.active_leases) },
              {
                label: 'Expiring in 90 days',
                value: String(summary.leases_expiring_90_days),
                warn: summary.leases_expiring_90_days > 0,
              },
              { label: 'Interest YTD', value: fmt(summary.total_interest_ytd) },
            ].map((c) => (
              <div key={c.label} className={`bg-gray-900/60 border rounded-xl p-4 ${c.warn ? 'border-amber-700' : 'border-gray-800'}`}>
                <p className="text-xs text-gray-500">{c.label}</p>
                <p className={`text-lg font-bold mt-1 ${c.warn ? 'text-amber-400' : 'text-teal-400'}`}>{c.value}</p>
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-wrap gap-3 items-center bg-gray-900/40 border border-gray-800 rounded-xl p-4">
          <div className="flex items-center gap-2 flex-1 min-w-[200px]">
            <Search size={14} className="text-gray-500" />
            <input
              className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm w-full"
              placeholder="Search lease name or asset…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm" value={assetFilter} onChange={(e) => setAssetFilter(e.target.value)}>
            {['all', 'property', 'vehicle', 'equipment', 'other'].map((v) => (
              <option key={v} value={v}>{v === 'all' ? 'All classes' : v.charAt(0).toUpperCase() + v.slice(1)}</option>
            ))}
          </select>
          <select className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            {['all', 'active', 'expired', 'terminated'].map((v) => (
              <option key={v} value={v}>{v === 'all' ? 'All statuses' : v.charAt(0).toUpperCase() + v.slice(1)}</option>
            ))}
          </select>
        </div>

        <div className="bg-gray-900/60 border border-gray-800 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-800/80 text-gray-400">
                <tr>
                  {['Lease Name', 'Asset Class', 'Start', 'Term', 'ROU Asset', 'Liability', 'IBR%', 'Status', 'Actions'].map((h) => (
                    <th key={h} className="px-3 py-3 text-left whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {leases.length === 0 && (
                  <tr><td colSpan={9} className="px-3 py-8 text-center text-gray-500">No leases in register. Calculate and save from <Link to="/ifrs/16" className="text-teal-400">Calculator</Link>.</td></tr>
                )}
                {leases.map((l) => (
                  <tr key={l.id} className="border-t border-gray-800 hover:bg-gray-800/30">
                    <td className="px-3 py-3 font-medium">{l.lease_name}</td>
                    <td className="px-3 py-3 capitalize">{l.asset_class ?? '—'}</td>
                    <td className="px-3 py-3">{l.commencement_date?.slice(0, 10) ?? '—'}</td>
                    <td className="px-3 py-3">{l.lease_term_months}m</td>
                    <td className="px-3 py-3">{fmt(l.rou_asset_current)}</td>
                    <td className="px-3 py-3">{fmt(l.lease_liability_current)}</td>
                    <td className="px-3 py-3">{l.incremental_borrowing_rate != null ? `${(l.incremental_borrowing_rate * 100).toFixed(2)}%` : '—'}</td>
                    <td className="px-3 py-3"><span className={`px-2 py-0.5 rounded text-xs ${statusBadge(l.status ?? 'active')}`}>{l.status}</span></td>
                    <td className="px-3 py-3">
                      <div className="flex gap-1 flex-wrap">
                        <button onClick={() => setScheduleLease(l)} className="text-teal-400 hover:text-teal-300 px-1" title="View schedule">Schedule</button>
                        <button
                          disabled={posting === l.id || l.status !== 'active'}
                          onClick={() => void handlePostJE(l)}
                          className="text-teal-400 hover:text-teal-300 px-1 disabled:opacity-40"
                        >
                          {posting === l.id ? '…' : 'Post JEs'}
                        </button>
                        <button onClick={() => setRemeasureLease(l)} className="text-amber-400 hover:text-amber-300 px-1">Remeasure</button>
                        <button
                          onClick={() => void downloadIFRS16Excel(l.lease_name, (l.calculation_results ?? {}) as Record<string, unknown>)}
                          className="text-gray-400 hover:text-gray-200 px-1"
                        ><Download size={12} /></button>
                        <button
                          onClick={() => void downloadAuditPdf(activeCompanyId, { leaseId: l.id })}
                          className="text-gray-400 hover:text-gray-200 px-1"
                        ><FileText size={12} /></button>
                        {l.status === 'active' && (
                          <button
                            onClick={() => void terminateLease(l.id, activeCompanyId).then(() => { toast.success('Lease terminated'); void load(); })}
                            className="text-red-400 hover:text-red-300 px-1"
                          ><Trash2 size={12} /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {posting && posting !== 'all' && (
          <p className="text-xs text-gray-500">
            After posting: <Link to="/uae-full/journals" className="text-teal-400">View in Journal Entries →</Link>
          </p>
        )}
      </div>

      {scheduleLease && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={() => setScheduleLease(null)}>
          <div className="bg-gray-900 border border-gray-700 rounded-xl max-w-4xl w-full max-h-[80vh] overflow-auto p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-bold mb-4 flex items-center gap-2"><TrendingUp size={16} /> {scheduleLease.lease_name} — Amortisation Schedule</h2>
            <table className="w-full text-xs">
              <thead className="text-gray-400"><tr>
                {['Period', 'Date', 'Payment', 'Interest', 'Principal', 'Closing'].map((h) => <th key={h} className="px-2 py-2 text-left">{h}</th>)}
              </tr></thead>
              <tbody>
                {schedule.map((row, i) => (
                  <tr key={i} className="border-t border-gray-800">
                    <td className="px-2 py-1">{String(row.Period ?? i + 1)}</td>
                    <td className="px-2 py-1">{String(row.Date ?? '')}</td>
                    <td className="px-2 py-1">{fmt(Number(row.Payment ?? 0))}</td>
                    <td className="px-2 py-1">{fmt(Number(row.Interest ?? 0))}</td>
                    <td className="px-2 py-1">{fmt(Number(row.Principal ?? 0))}</td>
                    <td className="px-2 py-1">{fmt(Number(row.Closing_Balance ?? 0))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button onClick={() => setScheduleLease(null)} className="mt-4 text-sm text-gray-400">Close</button>
          </div>
        </div>
      )}

      {remeasureLease && (
        <CPIRemeasureModal
          lease={remeasureLease}
          companyId={activeCompanyId}
          onClose={() => setRemeasureLease(null)}
          onDone={() => { setRemeasureLease(null); void load(); }}
        />
      )}
    </div>
  );
}
