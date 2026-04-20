import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { getReviewQueue, anomalyAction, type BookTxn } from '../../services/bookkeeping.service';

type FlagItem = { transaction: BookTxn; flag: Record<string, unknown> };

type Queue = {
  anomalies_by_severity?: {
    critical: FlagItem[];
    high: FlagItem[];
    medium: FlagItem[];
  };
};

export const BookkeepingAnomaliesPage: React.FC = () => {
  const [clientId, setClientId] = useState(() => sessionStorage.getItem('bp_last_client') || '');
  const [data, setData] = useState<Queue | null>(null);

  const load = async () => {
    if (!clientId) return;
    try {
      const q = (await getReviewQueue(clientId)) as Queue;
      setData(q);
    } catch {
      toast.error('Failed to load anomaly queue');
    }
  };

  useEffect(() => {
    load();
  }, [clientId]);

  const act = async (t: BookTxn, action: 'approve' | 'investigate' | 'escalate') => {
    if (!clientId) return;
    try {
      await anomalyAction(clientId, t.id, action);
      toast.success(`Marked: ${action}`);
      await load();
    } catch {
      toast.error('Action failed');
    }
  };

  const Section = ({
    title,
    items,
    subtitle,
  }: {
    title: string;
    items: FlagItem[];
    subtitle: string;
  }) => (
    <section className="mb-10">
      <h2 className="text-xl font-semibold text-white mb-1">{title}</h2>
      <p className="text-sm text-slate-500 mb-4">{subtitle}</p>
      <div className="space-y-3">
        {items?.length ? (
          items.map((it, i) => (
            <div
              key={`${it.transaction.id}-${i}`}
              className="bg-slate-800/50 border border-slate-700 rounded-xl p-4 flex flex-col lg:flex-row lg:items-start gap-4"
            >
              <div className="flex-1 min-w-0">
                <p className="text-slate-200 font-medium">
                  {it.transaction.date} · {it.transaction.vendor_name} ·{' '}
                  <span className="font-mono">{it.transaction.amount.toFixed(2)}</span>
                </p>
                <p className="text-slate-400 text-sm mt-1 truncate">{it.transaction.description}</p>
                <p className="text-amber-200/90 text-sm mt-2">
                  <strong>{String(it.flag.type)}</strong>: {String(it.flag.message)}
                </p>
                <p className="text-slate-500 text-xs mt-1">Suggested: {String(it.flag.action)}</p>
              </div>
              <div className="flex flex-wrap gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => act(it.transaction, 'approve')}
                  className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium"
                >
                  Approve
                </button>
                <button
                  type="button"
                  onClick={() => act(it.transaction, 'investigate')}
                  className="px-3 py-1.5 rounded-lg bg-slate-600 hover:bg-slate-500 text-white text-xs font-medium"
                >
                  Investigate
                </button>
                <button
                  type="button"
                  onClick={() => act(it.transaction, 'escalate')}
                  className="px-3 py-1.5 rounded-lg bg-red-700 hover:bg-red-600 text-white text-xs font-medium"
                >
                  Escalate
                </button>
              </div>
            </div>
          ))
        ) : (
          <p className="text-slate-600 text-sm">No items in this bucket.</p>
        )}
      </div>
    </section>
  );

  const sev = data?.anomalies_by_severity;

  return (
    <div>
      <h1 className="text-3xl font-bold text-white mb-2">Anomaly report</h1>
      <div className="flex gap-3 mb-8">
        <input
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          placeholder="Client ID"
          className="bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white"
        />
        <button
          type="button"
          onClick={load}
          className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-white text-sm"
        >
          Refresh
        </button>
      </div>

      <Section
        title="Critical"
        subtitle="Duplicate payments, transfer mismatches, large recon variances (see reconciliation)."
        items={sev?.critical ?? []}
      />
      <Section
        title="High"
        subtitle="New vendors, round amounts, weekend postings (if disabled in client profile)."
        items={sev?.high ?? []}
      />
      <Section
        title="Medium"
        subtitle="Missing receipts, personal-expense keywords, amount spikes vs category mean."
        items={sev?.medium ?? []}
      />
    </div>
  );
};
