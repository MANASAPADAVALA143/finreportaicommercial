/**
 * APApprovals.tsx
 * Approval queue — Pending / Approved / Rejected tabs with 3-way match display.
 */
import { useEffect, useState } from 'react';
import { CheckCircle2, X, AlertTriangle, Clock, RefreshCw } from 'lucide-react';
import { apSupabase, type APInvoice } from '../../lib/apSupabase';

function fmtAED(n: number) {
  return `AED ${n.toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

type TabKey = 'pending' | 'approved' | 'rejected';

const API_BASE = (import.meta.env.VITE_API_URL && String(import.meta.env.VITE_API_URL).trim()) || '';

function MatchLine({ inv }: { inv: APInvoice }) {
  const po  = inv.po_number ? '✅ PO linked' : '❌ No PO';
  const grn = inv.match_status === 'three_way_matched' ? '✅ GRN matched' : inv.match_status === 'matched' ? '✅ Matched' : '⚠️ Not matched';
  const price = inv.match_status === 'mismatch' ? '❌ Price mismatch' : inv.match_status === 'partial' ? '⚠️ Partial match' : '✅ Amount OK';
  return (
    <div className="flex gap-3 flex-wrap text-xs">
      <span className="text-gray-300">{po}</span>
      <span className="text-gray-300">{grn}</span>
      <span className="text-gray-300">{price}</span>
    </div>
  );
}

function RiskBadge({ risk }: { risk: string | null }) {
  if (!risk) return null;
  const map: Record<string, string> = {
    low: 'bg-green-500/20 text-green-300 border-green-700/40',
    medium: 'bg-amber-500/20 text-amber-300 border-amber-700/40',
    high: 'bg-red-500/20 text-red-300 border-red-700/40',
  };
  return <span className={`text-[10px] px-2 py-0.5 rounded-full border ${map[risk] || 'bg-gray-700 text-gray-300 border-gray-600'}`}>{risk.toUpperCase()}</span>;
}

export default function APApprovals() {
  const [tab, setTab]       = useState<TabKey>('pending');
  const [pending, setPending]   = useState<APInvoice[]>([]);
  const [approved, setApproved] = useState<APInvoice[]>([]);
  const [rejected, setRejected] = useState<APInvoice[]>([]);
  const [loading, setLoading]   = useState(true);
  const [acting, setActing]     = useState('');
  const [toast, setToast]       = useState('');
  const [jeMap, setJeMap]       = useState<Record<string, string>>({});
  const [jeLoading, setJeLoading] = useState('');

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 4000); };

  const postToGL = async (inv: APInvoice) => {
    setJeLoading(inv.id);
    try {
      const res = await fetch(`${API_BASE}/api/accounting/invoice-to-je`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invoice_id: inv.invoice_number || inv.id,
          invoice_type: 'AP',
          amount: inv.total_amount,
          vendor: inv.vendor_name,
          expense_category: inv.ifrs_category || 'general',
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { je_id: string };
      setJeMap(prev => ({ ...prev, [inv.id]: data.je_id }));
      showToast(`JE Created ${data.je_id}`);
    } catch (e) {
      showToast(`GL post failed: ${String(e)}`);
    } finally {
      setJeLoading('');
    }
  };

  const load = async () => {
    setLoading(true);
    const { data } = await apSupabase
      .from('invoices')
      .select('id,invoice_number,invoice_date,vendor_name,total_amount,currency,status,risk_score,risk_flags,match_status,po_number,approval_status,approved_by,approved_at,rejection_reason,ifrs_category,created_at')
      .order('created_at', { ascending: false })
      .limit(200);
    const rows = (data || []) as APInvoice[];
    setPending(rows.filter(r  => r.status === 'Processing' || r.approval_status === 'pending'));
    setApproved(rows.filter(r => r.status === 'Approved'   || r.approval_status === 'approved'));
    setRejected(rows.filter(r => r.status === 'Rejected'   || r.approval_status === 'rejected'));
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  const act = async (inv: APInvoice, action: 'approve' | 'reject') => {
    if (action === 'reject') {
      const reason = prompt('Rejection reason:');
      if (!reason) return;
      setActing(inv.id);
      await apSupabase.from('invoices').update({ status: 'Rejected', approval_status: 'rejected', rejection_reason: reason }).eq('id', inv.id);
      showToast(`Invoice ${inv.invoice_number} rejected.`);
    } else {
      setActing(inv.id);
      await apSupabase.from('invoices').update({ status: 'Approved', approval_status: 'approved', approved_at: new Date().toISOString() }).eq('id', inv.id);
      showToast(`✅ Invoice ${inv.invoice_number} approved & ready to post to GL.`);
    }
    setActing('');
    void load();
  };

  const TAB_DATA: Record<TabKey, APInvoice[]> = { pending, approved, rejected };

  const tabBtn = (key: TabKey, label: string, count: number, color: string) => (
    <button
      onClick={() => setTab(key)}
      className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${tab === key ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}
    >
      {label}
      {count > 0 && <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${tab === key ? 'bg-white/20' : color} text-white font-bold`}>{count}</span>}
    </button>
  );

  return (
    <div className="p-6">
      {/* Toast */}
      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-gray-800 border border-gray-600 rounded-xl px-4 py-3 text-sm text-white shadow-xl">
          {toast}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Approvals</h1>
          <p className="text-gray-400 text-sm mt-1">Review · approve · reject AP invoices</p>
        </div>
        <button onClick={load} disabled={loading} className="p-2 bg-gray-700 hover:bg-gray-600 rounded-lg disabled:opacity-50">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6">
        {tabBtn('pending',  'Pending',  pending.length,  'bg-amber-600')}
        {tabBtn('approved', 'Approved', approved.length, 'bg-green-700')}
        {tabBtn('rejected', 'Rejected', rejected.length, 'bg-red-700')}
      </div>

      {loading ? (
        <div className="grid gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="bg-gray-800/60 border border-gray-700 rounded-xl p-5 animate-pulse h-28" />
          ))}
        </div>
      ) : TAB_DATA[tab].length === 0 ? (
        <div className="bg-gray-800/40 border border-gray-700/50 rounded-xl p-12 text-center">
          <Clock size={32} className="text-gray-600 mx-auto mb-3" />
          <p className="text-gray-400">No {tab} invoices</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {TAB_DATA[tab].map(inv => {
            const flags = Array.isArray(inv.risk_flags) ? inv.risk_flags : [];
            return (
              <div key={inv.id} className="bg-gray-800/60 border border-gray-700 rounded-xl p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    {/* Header row */}
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <p className="text-sm font-semibold text-white">{inv.vendor_name}</p>
                      <span className="text-xs text-gray-500">#{inv.invoice_number}</span>
                      <RiskBadge risk={inv.risk_score} />
                      {flags.length > 0 && (
                        <span className="flex items-center gap-1 text-[10px] text-red-400">
                          <AlertTriangle size={10} /> {flags.length} flag{flags.length > 1 ? 's' : ''}
                        </span>
                      )}
                    </div>

                    {/* Amount + date */}
                    <p className="text-lg font-bold text-white mb-1">{fmtAED(inv.total_amount)}</p>
                    <p className="text-xs text-gray-400 mb-2">{inv.invoice_date || inv.created_at?.slice(0, 10) || '—'} · {inv.ifrs_category || 'No category'}</p>

                    {/* 3-way match */}
                    <MatchLine inv={inv} />

                    {/* Rejection reason */}
                    {tab === 'rejected' && inv.rejection_reason && (
                      <p className="mt-2 text-xs text-red-300 bg-red-900/20 rounded px-2 py-1">
                        Reason: {inv.rejection_reason}
                      </p>
                    )}

                    {/* Approved by */}
                    {tab === 'approved' && inv.approved_at && (
                      <p className="mt-2 text-xs text-green-400">
                        Approved {new Date(inv.approved_at).toLocaleString()}
                        {inv.approved_by ? ` by ${inv.approved_by}` : ''}
                      </p>
                    )}

                    {/* Risk flags detail */}
                    {tab === 'pending' && flags.length > 0 && (
                      <div className="mt-3 space-y-1">
                        {flags.map((f, i) => (
                          <p key={i} className="text-xs text-red-300 flex items-start gap-1">
                            <AlertTriangle size={10} className="mt-0.5 shrink-0" /> {f.message}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Action buttons (pending only) */}
                  {tab === 'pending' && (
                    <div className="flex flex-col gap-2 shrink-0">
                      <button
                        onClick={() => act(inv, 'approve')}
                        disabled={acting === inv.id}
                        className="flex items-center gap-1.5 bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white text-xs px-3 py-2 rounded-lg font-medium"
                      >
                        <CheckCircle2 size={13} /> Approve
                      </button>
                      <button
                        onClick={() => act(inv, 'reject')}
                        disabled={acting === inv.id}
                        className="flex items-center gap-1.5 bg-red-800 hover:bg-red-700 disabled:opacity-50 text-white text-xs px-3 py-2 rounded-lg font-medium"
                      >
                        <X size={13} /> Reject
                      </button>
                    </div>
                  )}
                  {/* Post to GL button (approved tab) */}
                  {tab === 'approved' && (
                    <div className="flex flex-col gap-2 shrink-0">
                      {jeMap[inv.id] ? (
                        <span className="text-[11px] bg-green-900/40 text-green-300 border border-green-700/40 rounded-lg px-3 py-2 font-mono">
                          JE {jeMap[inv.id]}
                        </span>
                      ) : (
                        <button
                          onClick={() => postToGL(inv)}
                          disabled={jeLoading === inv.id}
                          className="flex items-center gap-1.5 bg-blue-700 hover:bg-blue-600 disabled:opacity-50 text-white text-xs px-3 py-2 rounded-lg font-medium"
                        >
                          {jeLoading === inv.id ? (
                            <RefreshCw size={12} className="animate-spin" />
                          ) : (
                            <CheckCircle2 size={13} />
                          )}
                          Post to GL
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
