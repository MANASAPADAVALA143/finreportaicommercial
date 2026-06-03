import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Sidebar from '../../components/layout/Sidebar';
import toast from 'react-hot-toast';
import {
  listConnectedAccounts,
  deleteConnectedAccount,
  syncTrialBalance,
  type ConnectedAccount,
} from '../../services/uaeAccounting.service';

function sourceLabel(source: ConnectedAccount['source']) {
  if (source === 'zoho') return { emoji: '🔴', name: 'Zoho Books' };
  if (source === 'quickbooks') return { emoji: '🟢', name: 'QuickBooks Online' };
  return { emoji: '📁', name: 'Manual CSV' };
}

export default function ConnectedAccounts() {
  const navigate = useNavigate();
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncingId, setSyncingId] = useState<number | null>(null);
  const [syncForm, setSyncForm] = useState<{ from: string; to: string }>({
    from: new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0, 10),
    to: new Date().toISOString().slice(0, 10),
  });

  const load = () => {
    setLoading(true);
    listConnectedAccounts()
      .then(setAccounts)
      .catch((e) => toast.error(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const handleDelete = async (id: number, name: string) => {
    if (!window.confirm(`Disconnect "${name}"? This removes saved tokens only.`)) return;
    try {
      await deleteConnectedAccount(id);
      toast.success('Account disconnected');
      load();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleSync = async (acc: ConnectedAccount) => {
    setSyncingId(acc.id);
    try {
      const tb = await syncTrialBalance({
        connected_account_id: acc.id,
        from_date: syncForm.from,
        to_date: syncForm.to,
      });
      toast.success(`Synced ${tb.account_count} accounts!`);
      navigate(`/uae-accounting/trial-balances/${tb.id}`);
    } catch (e: any) {
      toast.error(`Sync failed: ${e.message}`);
    } finally {
      setSyncingId(null);
    }
  };

  return (
    <div className="flex min-h-screen bg-slate-900">
      <Sidebar />
      <div className="flex-1 p-8 overflow-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <button
              onClick={() => navigate('/uae-accounting')}
              className="text-slate-400 hover:text-white text-sm mb-2 flex items-center gap-1"
            >
              ← Dashboard
            </button>
            <h1 className="text-2xl font-bold text-white">Connected Accounts</h1>
            <p className="text-slate-400 text-sm mt-1">Manage your Zoho Books and QuickBooks connections</p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => navigate('/uae-accounting/connect/zoho')}
              className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg text-sm font-medium"
            >
              + Zoho Books
            </button>
            <button
              onClick={() => navigate('/uae-accounting/connect/qbo')}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium"
            >
              + QuickBooks
            </button>
          </div>
        </div>

        {/* Sync date range */}
        <div className="mb-6 p-4 bg-slate-800 rounded-xl border border-slate-700 flex flex-wrap gap-4 items-end">
          <div>
            <label className="block text-slate-400 text-xs mb-1">Sync From</label>
            <input
              type="date"
              value={syncForm.from}
              onChange={(e) => setSyncForm((f) => ({ ...f, from: e.target.value }))}
              className="bg-slate-900 border border-slate-600 text-white rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-slate-400 text-xs mb-1">Sync To</label>
            <input
              type="date"
              value={syncForm.to}
              onChange={(e) => setSyncForm((f) => ({ ...f, to: e.target.value }))}
              className="bg-slate-900 border border-slate-600 text-white rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <p className="text-slate-500 text-xs">Select a date range, then click Sync on any account below.</p>
        </div>

        {loading ? (
          <div className="text-slate-400 text-sm">Loading accounts…</div>
        ) : accounts.length === 0 ? (
          <div className="p-10 bg-slate-800 rounded-xl text-center text-slate-400">
            <div className="text-4xl mb-3">🔗</div>
            <p className="font-medium">No accounts connected yet</p>
            <p className="text-sm mt-1">Connect Zoho Books or QuickBooks Online to get started.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {accounts.map((acc) => {
              const src = sourceLabel(acc.source);
              return (
                <div
                  key={acc.id}
                  className="p-5 bg-slate-800 rounded-xl border border-slate-700 flex flex-wrap gap-4 items-center justify-between"
                >
                  <div className="flex items-center gap-4">
                    <span className="text-3xl">{src.emoji}</span>
                    <div>
                      <div className="text-white font-semibold">{acc.company_name}</div>
                      <div className="text-slate-400 text-sm">
                        {src.name} · {acc.currency_code ?? 'AED'}
                        {acc.company_id_external && <> · ID: {acc.company_id_external}</>}
                      </div>
                      {acc.last_synced_at && (
                        <div className="text-slate-500 text-xs mt-0.5">
                          Last synced: {new Date(acc.last_synced_at).toLocaleString()}
                        </div>
                      )}
                      {acc.last_error && (
                        <div className="text-red-400 text-xs mt-0.5">Error: {acc.last_error}</div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span
                      className={`text-xs px-2 py-1 rounded-full ${acc.is_active ? 'bg-green-900/60 text-green-300' : 'bg-slate-700 text-slate-400'}`}
                    >
                      {acc.is_active ? 'Active' : 'Inactive'}
                    </span>
                    <button
                      onClick={() => handleSync(acc)}
                      disabled={syncingId === acc.id}
                      className="px-4 py-2 bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white rounded-lg text-sm font-medium"
                    >
                      {syncingId === acc.id ? 'Syncing…' : 'Sync TB'}
                    </button>
                    <button
                      onClick={() => handleDelete(acc.id, acc.company_name)}
                      className="px-3 py-2 bg-red-900/40 hover:bg-red-800/60 text-red-400 rounded-lg text-sm"
                    >
                      Disconnect
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
