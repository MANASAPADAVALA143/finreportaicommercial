import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { getReviewQueue, receiptReminder, attachReceipt, verifyReceipt } from '../../services/bookkeeping.service';

type Missing = {
  id: number;
  transaction_id: number;
  amount: number;
  vendor: string | null;
  date: string | null;
  reminder_sent_count: number;
};

export const BookkeepingMissingReceiptsPage: React.FC = () => {
  const [clientId, setClientId] = useState(() => sessionStorage.getItem('bp_last_client') || '');
  const [missing, setMissing] = useState<Missing[]>([]);
  const [urls, setUrls] = useState<Record<number, string>>({});
  const [receiptText, setReceiptText] = useState<Record<number, string>>({});

  const load = async () => {
    if (!clientId) return;
    try {
      const q = (await getReviewQueue(clientId)) as { missing_receipts: Missing[] };
      setMissing(q.missing_receipts ?? []);
    } catch {
      toast.error('Failed to load queue');
    }
  };

  useEffect(() => {
    load();
  }, [clientId]);

  return (
    <div>
      <h1 className="text-3xl font-bold text-white mb-2">Missing receipts</h1>
      <p className="text-slate-400 mb-6">
        Reminder API increments counts for audit. Attach receipt URL or paste OCR text for Claude verification.
      </p>
      <div className="flex flex-wrap gap-3 mb-6">
        <input
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          placeholder="Client ID"
          className="bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white"
        />
        <button type="button" onClick={load} className="px-4 py-2 bg-slate-700 rounded-lg text-white text-sm">
          Refresh
        </button>
        <button
          type="button"
          onClick={async () => {
            if (!clientId) return;
            try {
              await receiptReminder(clientId);
              toast.success('Bulk reminders logged');
              load();
            } catch {
              toast.error('Bulk reminder failed');
            }
          }}
          className="px-4 py-2 bg-emerald-700 rounded-lg text-white text-sm"
        >
          Bulk reminder
        </button>
      </div>
      <div className="space-y-4">
        {missing.map((m) => (
          <div key={m.id} className="bg-slate-800/50 border border-slate-700 rounded-xl p-4 space-y-3">
            <div className="flex flex-wrap justify-between gap-2">
              <div>
                <p className="text-white font-medium">
                  Tx {m.transaction_id} {m.date} {m.vendor}
                </p>
                <p className="text-slate-400 text-sm font-mono">{m.amount.toFixed(2)}</p>
                <p className="text-xs text-slate-500">Reminders: {m.reminder_sent_count}</p>
              </div>
              <button
                type="button"
                onClick={async () => {
                  try {
                    await receiptReminder(clientId, [m.transaction_id]);
                    toast.success('Reminder logged');
                    load();
                  } catch {
                    toast.error('Failed');
                  }
                }}
                className="px-3 py-1.5 bg-slate-600 rounded-lg text-white text-xs"
              >
                WhatsApp reminder
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              <input
                value={urls[m.transaction_id] ?? ''}
                onChange={(e) => setUrls((p) => ({ ...p, [m.transaction_id]: e.target.value }))}
                placeholder="Receipt URL"
                className="flex-1 min-w-[180px] bg-slate-900 border border-slate-600 rounded-lg px-2 py-1 text-sm text-white"
              />
              <button
                type="button"
                onClick={async () => {
                  const u = urls[m.transaction_id]?.trim();
                  if (!u) return toast.error('URL required');
                  try {
                    await attachReceipt(m.transaction_id, u);
                    toast.success('Saved');
                    load();
                  } catch {
                    toast.error('Failed');
                  }
                }}
                className="px-3 py-1 bg-emerald-600 rounded text-white text-xs"
              >
                Save URL
              </button>
            </div>
            <textarea
              value={receiptText[m.transaction_id] ?? ''}
              onChange={(e) => setReceiptText((p) => ({ ...p, [m.transaction_id]: e.target.value }))}
              placeholder="Receipt OCR text"
              className="w-full min-h-[64px] bg-slate-900 border border-slate-600 rounded-lg px-2 py-1 text-sm text-white"
            />
            <button
              type="button"
              onClick={async () => {
                const t = receiptText[m.transaction_id]?.trim();
                if (!t) return toast.error('Text required');
                try {
                  const r = await verifyReceipt(m.transaction_id, t);
                  toast.success(r.matches ? 'Likely match' : 'Review needed');
                } catch {
                  toast.error('Verify failed');
                }
              }}
              className="px-3 py-1 bg-indigo-600 rounded text-white text-xs"
            >
              Claude verify
            </button>
          </div>
        ))}
        {!missing.length && <p className="text-slate-600">No open missing receipts.</p>}
      </div>
    </div>
  );
};
