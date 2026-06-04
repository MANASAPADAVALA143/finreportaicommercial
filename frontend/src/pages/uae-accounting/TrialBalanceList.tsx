import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Sidebar from '../../components/layout/Sidebar';
import toast from 'react-hot-toast';
import {
  listTrialBalances,
  listConnectedAccounts,
  syncTrialBalance,
  type UAETrialBalance,
  type ConnectedAccount,
} from '../../services/uaeAccounting.service';

function fmt(n: number) {
  return n.toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const CURRENT_PERIOD = new Date().toISOString().slice(0, 7);

export default function TrialBalanceList() {
  const navigate = useNavigate();
  const [tbs, setTbs] = useState<UAETrialBalance[]>([]);
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [form, setForm] = useState({
    connected_account_id: '',
    from_date: new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0, 10),
    to_date: new Date().toISOString().slice(0, 10),
  });
  const [genPeriod, setGenPeriod] = useState(CURRENT_PERIOD);
  const [generating, setGenerating] = useState(false);
  const [genResult, setGenResult] = useState<any>(null);
  const [genError, setGenError] = useState('');

  const load = () => {
    setLoading(true);
    Promise.all([listTrialBalances(), listConnectedAccounts()])
      .then(([t, a]) => { setTbs(t); setAccounts(a); })
      .catch((e) => toast.error(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const handleGenerateFromJEs = async () => {
    setGenerating(true);
    setGenError('');
    setGenResult(null);
    try {
      const res = await fetch(`/api/uae/accounting/trial-balance/generate/${genPeriod}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setGenResult(data);
      toast.success(`Trial balance generated — ${data.rows?.length ?? 0} accounts`);
    } catch (e: any) {
      setGenError(e.message);
    } finally {
      setGenerating(false);
    }
  };

  const handleSync = async () => {
    if (!form.connected_account_id) {
      toast.error('Please select an account');
      return;
    }
    setSyncing(true);
    try {
      const tb = await syncTrialBalance({
        connected_account_id: Number(form.connected_account_id),
        from_date: form.from_date,
        to_date: form.to_date,
      });
      toast.success(`Synced ${tb.account_count} accounts!`);
      navigate(`/uae-accounting/trial-balances/${tb.id}`);
    } catch (e: any) {
      toast.error(`Sync failed: ${e.message}`);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="flex min-h-screen bg-slate-900">
      <Sidebar />
      <div className="flex-1 p-8 overflow-auto">
        <button
          onClick={() => navigate('/uae-accounting')}
          className="text-slate-400 hover:text-white text-sm mb-4 flex items-center gap-1"
        >
          ← Dashboard
        </button>
        <h1 className="text-2xl font-bold text-white mb-1">Trial Balances</h1>
        <p className="text-slate-400 text-sm mb-6">Sync and manage trial balances from Zoho Books and QuickBooks</p>

        {/* Auto-generate from posted JEs banner */}
        <div className="mb-6 p-5 bg-blue-950/60 rounded-xl border border-blue-700">
          <h2 className="text-base font-semibold text-blue-300 mb-3">Auto-generate from posted JEs</h2>
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className="block text-slate-400 text-xs mb-1">Period (YYYY-MM)</label>
              <input
                type="month"
                value={genPeriod}
                onChange={e => setGenPeriod(e.target.value)}
                className="bg-slate-900 border border-slate-600 text-white rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <button
              onClick={handleGenerateFromJEs}
              disabled={generating}
              className="px-5 py-2 bg-blue-700 hover:bg-blue-600 disabled:opacity-50 text-white rounded-lg text-sm font-medium"
            >
              {generating ? 'Generating…' : 'Generate from Posted Entries'}
            </button>
          </div>
          {genError && (
            <div className="mt-3 text-sm text-red-400">{genError}</div>
          )}
          {genResult && (
            <div className="mt-4 overflow-x-auto">
              <p className="text-xs text-blue-400 mb-2">
                {genResult.rows?.length ?? 0} accounts — Balanced: {genResult.balanced ? '✅' : '❌'}
                {genResult.demo_data ? ' (demo data)' : ''}
              </p>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-slate-400 border-b border-slate-700">
                    <th className="text-left py-1 px-2">Account</th>
                    <th className="text-left py-1 px-2">Name</th>
                    <th className="text-right py-1 px-2">Debit</th>
                    <th className="text-right py-1 px-2">Credit</th>
                  </tr>
                </thead>
                <tbody>
                  {(genResult.rows ?? []).map((r: any) => (
                    <tr key={r.account_code} className="border-b border-slate-800">
                      <td className="py-1 px-2 font-mono text-blue-400">{r.account_code}</td>
                      <td className="py-1 px-2 text-slate-300">{r.account_name}</td>
                      <td className="py-1 px-2 text-right text-white">{r.total_debit ? r.total_debit.toLocaleString() : '—'}</td>
                      <td className="py-1 px-2 text-right text-white">{r.total_credit ? r.total_credit.toLocaleString() : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Sync Panel */}
        <div className="mb-6 p-5 bg-slate-800 rounded-xl border border-slate-700">
          <h2 className="text-base font-semibold text-white mb-4">Sync New Trial Balance</h2>
          <div className="flex flex-wrap gap-4 items-end">
            <div>
              <label className="block text-slate-400 text-xs mb-1">Connected Account</label>
              <select
                value={form.connected_account_id}
                onChange={(e) => setForm((f) => ({ ...f, connected_account_id: e.target.value }))}
                className="bg-slate-900 border border-slate-600 text-white rounded-lg px-3 py-2 text-sm min-w-[220px]"
              >
                <option value="">— Select account —</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.company_name} ({a.source})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-slate-400 text-xs mb-1">From</label>
              <input
                type="date"
                value={form.from_date}
                onChange={(e) => setForm((f) => ({ ...f, from_date: e.target.value }))}
                className="bg-slate-900 border border-slate-600 text-white rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-slate-400 text-xs mb-1">To</label>
              <input
                type="date"
                value={form.to_date}
                onChange={(e) => setForm((f) => ({ ...f, to_date: e.target.value }))}
                className="bg-slate-900 border border-slate-600 text-white rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <button
              onClick={handleSync}
              disabled={syncing || !form.connected_account_id}
              className="px-5 py-2 bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white rounded-lg text-sm font-medium"
            >
              {syncing ? 'Syncing…' : 'Sync Now'}
            </button>
            {accounts.length === 0 && (
              <button
                onClick={() => navigate('/uae-accounting/accounts')}
                className="text-blue-400 hover:text-blue-300 text-sm"
              >
                + Connect an account first
              </button>
            )}
          </div>
        </div>

        {/* Table */}
        {loading ? (
          <div className="text-slate-400 text-sm">Loading…</div>
        ) : tbs.length === 0 ? (
          <div className="p-10 bg-slate-800 rounded-xl text-center text-slate-400">
            <div className="text-4xl mb-3">📊</div>
            <p className="font-medium">No trial balances yet</p>
            <p className="text-sm mt-1">Connect an account and sync your first trial balance above.</p>
          </div>
        ) : (
          <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700 text-slate-400 text-xs uppercase">
                  <th className="text-left px-4 py-3">Company</th>
                  <th className="text-left px-4 py-3">Source</th>
                  <th className="text-left px-4 py-3">Period</th>
                  <th className="text-right px-4 py-3">Accounts</th>
                  <th className="text-right px-4 py-3">Total Debits</th>
                  <th className="text-center px-4 py-3">Balanced</th>
                  <th className="text-center px-4 py-3">IFRS</th>
                  <th className="text-left px-4 py-3">Synced</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {tbs.map((tb) => (
                  <tr key={tb.id} className="border-b border-slate-700/50 hover:bg-slate-700/30">
                    <td className="px-4 py-3 text-white font-medium">{tb.company_name}</td>
                    <td className="px-4 py-3 text-slate-400 capitalize">{tb.source}</td>
                    <td className="px-4 py-3 text-slate-300 text-xs">
                      {tb.period_start}<br />{tb.period_end}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-300">{tb.account_count}</td>
                    <td className="px-4 py-3 text-right text-slate-300 font-mono text-xs">
                      {tb.currency} {fmt(tb.total_debits)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={tb.is_balanced ? 'text-green-400' : 'text-red-400'}>
                        {tb.is_balanced ? '✓' : '✗'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full ${tb.ifrs_trial_balance_id ? 'bg-green-900 text-green-300' : 'bg-slate-700 text-slate-400'}`}
                      >
                        {tb.ifrs_trial_balance_id ? 'Done' : 'Pending'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-xs">
                      {new Date(tb.synced_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => navigate(`/uae-accounting/trial-balances/${tb.id}`)}
                        className="text-blue-400 hover:text-blue-300 text-xs whitespace-nowrap"
                      >
                        View →
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
