import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowDownCircle, ArrowUpCircle, Banknote, Building2,
  Receipt, Scale, TrendingUp, Wallet,
} from 'lucide-react';

import { useAuth } from '../../context/AuthContext';
import { getWorkspace, getWorkspaceDashboard, type Workspace, type WorkspaceDashboard as Dash } from '../../services/workspaceService';

function KpiCard({ label, value, icon: Icon, color }: { label: string; value: string; icon: React.ElementType; color: string }) {
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-5">
      <div className="flex items-center gap-2 mb-2">
        <Icon size={18} className={color} />
        <span className="text-slate-400 text-sm">{label}</span>
      </div>
      <div className="text-2xl font-bold text-white">{value}</div>
    </div>
  );
}

export default function WorkspaceDashboard() {
  const { id } = useParams<{ id: string }>();
  const { accessToken } = useAuth();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [dash, setDash] = useState<Dash | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    Promise.all([
      getWorkspace(accessToken, id),
      getWorkspaceDashboard(accessToken, id),
    ])
      .then(([ws, d]) => { setWorkspace(ws); setDash(d); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [id, accessToken]);

  const fmt = (n: number) => `AED ${n.toLocaleString('en-AE', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

  if (loading) return <div className="min-h-screen bg-slate-900 text-white p-8">Loading…</div>;

  return (
    <div className="min-h-screen bg-slate-900 text-white p-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <div className="flex items-center gap-2 text-slate-400 text-sm mb-1">
              <Link to="/workspaces" className="hover:text-white">Workspaces</Link>
              <span>/</span>
              <span>{workspace?.name}</span>
            </div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Building2 className="text-blue-400" />
              {workspace?.name}
            </h1>
            <p className="text-slate-400 text-sm mt-1">{workspace?.legal_entity_name} · {workspace?.currency}</p>
          </div>
          <div className="flex gap-2">
            <Link to={`/workspaces/${id}/settings`} className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm">Settings</Link>
            <Link to="/uae-full" className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm">Open UAE Accounting →</Link>
          </div>
        </div>

        {dash && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <KpiCard label="Revenue" value={fmt(dash.revenue)} icon={TrendingUp} color="text-green-400" />
              <KpiCard label="Expenses" value={fmt(dash.expenses)} icon={ArrowDownCircle} color="text-red-400" />
              <KpiCard label="Profit" value={fmt(dash.profit)} icon={ArrowUpCircle} color="text-emerald-400" />
              <KpiCard label="Cash Balance" value={fmt(dash.cash_balance)} icon={Wallet} color="text-blue-400" />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <KpiCard label="Open AP" value={fmt(dash.open_ap)} icon={Receipt} color="text-orange-400" />
              <KpiCard label="Open AR" value={fmt(dash.open_ar)} icon={Banknote} color="text-yellow-400" />
              <KpiCard label="VAT Payable" value={fmt(dash.vat_payable)} icon={Scale} color="text-purple-400" />
              <KpiCard label="Net Assets" value={fmt(dash.assets - dash.liabilities)} icon={Building2} color="text-cyan-400" />
            </div>
            <div className="grid grid-cols-3 gap-4 text-sm text-slate-400">
              <div className="rounded-lg border border-slate-700 p-4">
                <div className="text-white font-semibold text-lg">{dash.journal_count}</div>
                Journal Entries
              </div>
              <div className="rounded-lg border border-slate-700 p-4">
                <div className="text-white font-semibold text-lg">{dash.customer_count}</div>
                Customers
              </div>
              <div className="rounded-lg border border-slate-700 p-4">
                <div className="text-white font-semibold text-lg">{dash.fixed_asset_count}</div>
                Fixed Assets
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
