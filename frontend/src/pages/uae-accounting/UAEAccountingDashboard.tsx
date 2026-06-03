import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Sidebar from '../../components/layout/Sidebar';
import {
  getUAEStats,
  listConnectedAccounts,
  listTrialBalances,
  type ConnectedAccount,
  type UAEStats,
  type UAETrialBalance,
} from '../../services/uaeAccounting.service';

function StatCard({
  label,
  value,
  icon,
  color,
}: {
  label: string;
  value: number | string;
  icon: string;
  color: string;
}) {
  return (
    <div className={`rounded-xl p-5 border ${color} bg-slate-800/50`}>
      <div className="flex items-center gap-3 mb-2">
        <span className="text-2xl">{icon}</span>
        <span className="text-slate-400 text-sm">{label}</span>
      </div>
      <div className="text-3xl font-bold text-white">{value}</div>
    </div>
  );
}

export default function UAEAccountingDashboard() {
  const navigate = useNavigate();
  const [stats, setStats] = useState<UAEStats | null>(null);
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([]);
  const [tbs, setTbs] = useState<UAETrialBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([getUAEStats(), listConnectedAccounts(), listTrialBalances()])
      .then(([s, a, t]) => {
        setStats(s);
        setAccounts(a);
        setTbs(t.slice(0, 5));
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="flex min-h-screen bg-slate-900">
      <Sidebar />
      <div className="flex-1 p-8 overflow-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              🇦🇪 UAE Accounting
            </h1>
            <p className="text-slate-400 text-sm mt-1">
              Sync trial balances from Zoho Books or QuickBooks Online → IFRS Statements
            </p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => navigate('/uae-accounting/connect/zoho')}
              className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg text-sm font-medium transition-colors"
            >
              + Connect Zoho
            </button>
            <button
              onClick={() => navigate('/uae-accounting/connect/qbo')}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors"
            >
              + Connect QuickBooks
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-900/40 border border-red-700 rounded-xl text-red-300 text-sm">
            {error}
          </div>
        )}

        {/* Stats */}
        {loading ? (
          <div className="text-slate-400 text-sm">Loading…</div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
              <StatCard
                label="Connected Accounts"
                value={stats?.connected_accounts ?? 0}
                icon="🔗"
                color="border-blue-800"
              />
              <StatCard
                label="Trial Balances Synced"
                value={stats?.trial_balances_synced ?? 0}
                icon="📊"
                color="border-green-800"
              />
              <StatCard
                label="IFRS Statements Generated"
                value={stats?.ifrs_statements_generated ?? 0}
                icon="📄"
                color="border-amber-800"
              />
            </div>

            {/* Connected Accounts */}
            <div className="mb-8">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-lg font-semibold text-white">Connected Accounts</h2>
                <button
                  onClick={() => navigate('/uae-accounting/accounts')}
                  className="text-blue-400 hover:text-blue-300 text-sm"
                >
                  Manage →
                </button>
              </div>
              {accounts.length === 0 ? (
                <div className="p-6 bg-slate-800 rounded-xl text-slate-400 text-center text-sm">
                  No accounts connected yet. Connect Zoho Books or QuickBooks Online above.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {accounts.slice(0, 4).map((acc) => (
                    <div
                      key={acc.id}
                      className="p-4 bg-slate-800 rounded-xl border border-slate-700 flex items-center gap-4"
                    >
                      <span className="text-2xl">
                        {acc.source === 'zoho' ? '🔴' : acc.source === 'quickbooks' ? '🟢' : '📁'}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="text-white font-medium truncate">{acc.company_name}</div>
                        <div className="text-slate-400 text-xs capitalize">
                          {acc.source} · {acc.currency_code ?? 'AED'}
                          {acc.last_synced_at && (
                            <> · synced {new Date(acc.last_synced_at).toLocaleDateString()}</>
                          )}
                        </div>
                      </div>
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full ${acc.is_active ? 'bg-green-900 text-green-300' : 'bg-slate-700 text-slate-400'}`}
                      >
                        {acc.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Recent Trial Balances */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-lg font-semibold text-white">Recent Trial Balances</h2>
                <button
                  onClick={() => navigate('/uae-accounting/trial-balances')}
                  className="text-blue-400 hover:text-blue-300 text-sm"
                >
                  View all →
                </button>
              </div>
              {tbs.length === 0 ? (
                <div className="p-6 bg-slate-800 rounded-xl text-slate-400 text-center text-sm">
                  No trial balances synced yet. Connect an account and run a sync.
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
                        <th className="text-center px-4 py-3">Balanced</th>
                        <th className="text-center px-4 py-3">IFRS</th>
                        <th className="px-4 py-3" />
                      </tr>
                    </thead>
                    <tbody>
                      {tbs.map((tb) => (
                        <tr key={tb.id} className="border-b border-slate-700/50 hover:bg-slate-700/30">
                          <td className="px-4 py-3 text-white font-medium">{tb.company_name}</td>
                          <td className="px-4 py-3 text-slate-400 capitalize">{tb.source}</td>
                          <td className="px-4 py-3 text-slate-300">
                            {tb.period_start} → {tb.period_end}
                          </td>
                          <td className="px-4 py-3 text-right text-slate-300">{tb.account_count}</td>
                          <td className="px-4 py-3 text-center">
                            <span className={tb.is_balanced ? 'text-green-400' : 'text-red-400'}>
                              {tb.is_balanced ? '✓' : '✗'}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span
                              className={`text-xs px-2 py-0.5 rounded-full ${tb.ifrs_trial_balance_id ? 'bg-green-900 text-green-300' : 'bg-slate-700 text-slate-400'}`}
                            >
                              {tb.ifrs_trial_balance_id ? 'Generated' : 'Pending'}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <button
                              onClick={() => navigate(`/uae-accounting/trial-balances/${tb.id}`)}
                              className="text-blue-400 hover:text-blue-300 text-xs"
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
          </>
        )}
      </div>
    </div>
  );
}
