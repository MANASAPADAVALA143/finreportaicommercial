/**
 * UAE Finance Suite — unified AP + AR + UAE Tax dashboard (uae_suite role home)
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle, Download, FileText, Receipt, RefreshCw, Scale, Send, Shield,
} from 'lucide-react';
import * as suiteSvc from '../../services/uaeSuite.service';
import type { UaeSuiteSummary } from '../../services/uaeSuite.service';

function fmt(n: number) {
  return `AED ${n.toLocaleString('en-AE', { minimumFractionDigits: 0 })}`;
}

function fmtDate(iso: string | null | undefined) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function statusBadge(status: string) {
  const s = status.replace(/_/g, ' ');
  const cls =
    status === 'filed' || status === 'approved' ? 'bg-green-900/50 text-green-300' :
    status === 'draft' ? 'bg-amber-900/50 text-amber-300' :
    status === 'not_started' ? 'bg-gray-700 text-gray-300' :
    'bg-teal-900/50 text-teal-300';
  return <span className={`px-2 py-0.5 rounded text-xs capitalize ${cls}`}>{s}</span>;
}

export default function UAEFinanceSuiteDashboard() {
  const [data, setData] = useState<UaeSuiteSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await suiteSvc.fetchUaeSuiteSummary());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  if (loading && !data) {
    return <div className="min-h-screen bg-gray-950 text-gray-400 p-8">Loading UAE Finance Suite…</div>;
  }

  if (error && !data) {
    return (
      <div className="min-h-screen bg-gray-950 text-gray-100 p-8">
        <p className="text-red-400 mb-4">{error}</p>
        <button onClick={() => void load()} className="bg-gray-700 px-4 py-2 rounded-lg text-sm">Retry</button>
      </div>
    );
  }

  if (!data) return null;

  const period = data.uae_tax.tax_period;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">UAE Finance Suite</h1>
          <p className="text-gray-400 text-sm mt-1">AP · AR · UAE Tax — unified operations view</p>
        </div>
        <button onClick={() => void load()} disabled={loading}
          className="flex items-center gap-2 bg-gray-800 hover:bg-gray-700 px-3 py-2 rounded-lg text-sm">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {/* Banner */}
      <section className="bg-gradient-to-r from-indigo-950/80 to-gray-900 border border-indigo-500/30 rounded-xl p-5 mb-6">
        <div className="flex flex-wrap gap-6 text-sm">
          <div>
            <p className="text-gray-500 text-xs uppercase mb-1">Entity</p>
            <p className="font-semibold text-white">{data.company.name ?? '—'}</p>
            <p className="text-gray-400 text-xs">TRN: {data.company.trn ?? '—'}</p>
          </div>
          <div>
            <p className="text-gray-500 text-xs uppercase mb-1">VAT period</p>
            <p className="text-white">{data.banner.vat_period_label}</p>
            <p className="text-gray-400 text-xs">{fmtDate(data.banner.vat_period_start)} → {fmtDate(data.banner.vat_period_end)}</p>
          </div>
          <div>
            <p className="text-gray-500 text-xs uppercase mb-1">VAT filing</p>
            <p className={data.banner.days_to_vat_filing <= 14 ? 'text-amber-400 font-semibold' : 'text-white'}>
              {data.banner.days_to_vat_filing} days · due {fmtDate(data.banner.vat_filing_deadline)}
            </p>
          </div>
          <div>
            <p className="text-gray-500 text-xs uppercase mb-1">CT return</p>
            {statusBadge(data.banner.ct_return_status)}
          </div>
        </div>
      </section>

      {/* Three module cards */}
      <div className="grid lg:grid-cols-3 gap-5 mb-8">
        {/* AP */}
        <div className="bg-gray-900/80 border border-gray-700 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <Receipt size={18} className="text-orange-400" />
            <h2 className="font-semibold text-orange-300">Accounts Payable</h2>
          </div>
          <dl className="space-y-3 text-sm">
            <div className="flex justify-between"><dt className="text-gray-500">Outstanding</dt><dd className="font-mono">{fmt(data.ap.total_outstanding)}</dd></div>
            <div className="flex justify-between"><dt className="text-gray-500">Overdue</dt><dd className="font-mono text-red-400">{fmt(data.ap.total_overdue)}</dd></div>
            <div className="flex justify-between"><dt className="text-gray-500">Pending approvals</dt><dd className="font-mono">{data.ap.pending_approvals}</dd></div>
            {data.ap.top_overdue_vendor && (
              <div className="pt-2 border-t border-gray-700/50">
                <p className="text-xs text-gray-500 mb-1">Top overdue vendor</p>
                <p className="text-gray-200">{data.ap.top_overdue_vendor.vendor_name}</p>
                <p className="font-mono text-amber-300 text-xs">{fmt(data.ap.top_overdue_vendor.overdue_amount)}</p>
              </div>
            )}
          </dl>
          <Link to="/ap-invoices" className="inline-block mt-4 text-xs text-orange-400 hover:underline">Open AP InvoiceFlow →</Link>
        </div>

        {/* AR */}
        <div className="bg-gray-900/80 border border-gray-700 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <FileText size={18} className="text-teal-400" />
            <h2 className="font-semibold text-teal-300">Accounts Receivable</h2>
          </div>
          <dl className="space-y-3 text-sm">
            <div className="flex justify-between"><dt className="text-gray-500">Outstanding</dt><dd className="font-mono">{fmt(data.ar.total_outstanding)}</dd></div>
            <div className="flex justify-between"><dt className="text-gray-500">Overdue</dt><dd className="font-mono text-red-400">{fmt(data.ar.total_overdue)}</dd></div>
            {data.ar.worst_aging_bucket && (
              <div className="flex justify-between">
                <dt className="text-gray-500">Worst bucket</dt>
                <dd className="text-right"><span className="text-gray-300">{data.ar.worst_aging_bucket.label}</span><br /><span className="font-mono text-xs">{fmt(data.ar.worst_aging_bucket.amount)}</span></dd>
              </div>
            )}
            <div className="flex justify-between"><dt className="text-gray-500">Credit notes (period)</dt><dd className="font-mono">{data.ar.credit_notes_issued.count} · {fmt(data.ar.credit_notes_issued.total_amount)}</dd></div>
          </dl>
          <Link to="/uae-full/ar" className="inline-block mt-4 text-xs text-teal-400 hover:underline">Open AR →</Link>
        </div>

        {/* UAE Tax */}
        <div className="bg-gray-900/80 border border-gray-700 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <Shield size={18} className="text-indigo-400" />
            <h2 className="font-semibold text-indigo-300">UAE Tax</h2>
          </div>
          <dl className="space-y-3 text-sm">
            <div className="flex justify-between items-center">
              <dt className="text-gray-500">VAT recon</dt>
              <dd>{statusBadge(data.uae_tax.recon_status)}</dd>
            </div>
            <div className="flex justify-between"><dt className="text-gray-500">Est. VAT payable</dt><dd className="font-mono">{fmt(data.uae_tax.estimated_vat_payable_aed)}</dd></div>
            <div className="flex justify-between items-center">
              <dt className="text-gray-500">CT return</dt>
              <dd>{statusBadge(data.uae_tax.ct_return.status)}</dd>
            </div>
            <div className="flex justify-between"><dt className="text-gray-500">E-invoicing readiness</dt><dd className="font-mono">{data.uae_tax.e_invoicing.readiness_score}%</dd></div>
          </dl>
          <Link to="/gulftax" className="inline-block mt-4 text-xs text-indigo-400 hover:underline">Open GulfTax →</Link>
        </div>
      </div>

      {/* Quick actions */}
      <section className="bg-gray-900/60 border border-gray-700 rounded-xl p-5">
        <h2 className="text-sm font-bold text-gray-400 uppercase mb-4">Quick actions</h2>
        <div className="flex flex-wrap gap-3">
          <Link to={`/gulftax/reconciliation?period=${encodeURIComponent(period)}`}
            className="flex items-center gap-2 bg-indigo-800/60 hover:bg-indigo-700/60 px-4 py-2 rounded-lg text-sm">
            <Scale size={14} /> Run VAT Recon
          </Link>
          <Link to="/uae-full/ar"
            className="flex items-center gap-2 bg-teal-800/60 hover:bg-teal-700/60 px-4 py-2 rounded-lg text-sm">
            <FileText size={14} /> Issue Credit Note
          </Link>
          <Link to="/uae-full/ar/dunning"
            className="flex items-center gap-2 bg-amber-800/60 hover:bg-amber-700/60 px-4 py-2 rounded-lg text-sm">
            <Send size={14} /> Run Dunning
          </Link>
          <Link to="/gulftax/audit-exports"
            className="flex items-center gap-2 bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded-lg text-sm">
            <Download size={14} /> Download Audit Pack
          </Link>
        </div>
        {data.uae_tax.recon_status === 'mismatch_found' && (
          <p className="flex items-center gap-2 mt-4 text-xs text-amber-400">
            <AlertTriangle size={14} /> VAT reconciliation mismatch — review before filing.
          </p>
        )}
      </section>
    </div>
  );
}
