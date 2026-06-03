/**
 * India Chart of Accounts — 47 Ind AS accounts, GST flagged
 */
import { useEffect, useState } from 'react';
import { BookOpen, Plus, Search, Zap } from 'lucide-react';
import * as svc from '../../services/indiaAccounting.service';
import type { IndiaAccount } from '../../services/indiaAccounting.service';

const TYPE_COLORS: Record<string, string> = {
  Asset:     'text-blue-400 bg-blue-900/30 border-blue-700',
  Liability: 'text-red-400 bg-red-900/30 border-red-700',
  Equity:    'text-purple-400 bg-purple-900/30 border-purple-700',
  Revenue:   'text-emerald-400 bg-emerald-900/30 border-emerald-700',
  Expense:   'text-amber-400 bg-amber-900/30 border-amber-700',
};

const ACCOUNT_TYPES = ['Asset', 'Liability', 'Equity', 'Revenue', 'Expense'];

export default function IndiaChartOfAccounts() {
  const [accounts, setAccounts] = useState<IndiaAccount[]>([]);
  const [loading, setLoading]   = useState(true);
  const [seeding, setSeeding]   = useState(false);
  const [search, setSearch]     = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [error, setError]       = useState('');
  const [msg, setMsg]           = useState('');

  const load = () => {
    setLoading(true);
    svc.listIndiaAccounts(typeFilter || undefined)
      .then(d => setAccounts(d.accounts))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, [typeFilter]);

  const handleSeed = async () => {
    setSeeding(true); setError(''); setMsg('');
    try {
      const r = await svc.seedIndiaCoA();
      setMsg(r.seeded > 0 ? `Seeded ${r.seeded} India Ind AS accounts` : 'CoA already seeded');
      load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSeeding(false);
    }
  };

  const filtered = accounts.filter(a =>
    !search || a.code.toLowerCase().includes(search.toLowerCase()) ||
    a.name.toLowerCase().includes(search.toLowerCase())
  );

  const totals = ACCOUNT_TYPES.map(t => ({
    type: t,
    count: accounts.filter(a => a.account_type === t).length,
  }));

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Chart of Accounts</h1>
          <p className="text-gray-400 text-sm mt-1">India Ind AS — GST & TDS flagged accounts</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={handleSeed} disabled={seeding}
            className="flex items-center gap-2 bg-orange-700 hover:bg-orange-600 disabled:opacity-50 px-4 py-2 rounded-lg text-sm font-medium"
          >
            <Zap size={14} /> {seeding ? 'Seeding…' : 'Seed India CoA'}
          </button>
          <button className="flex items-center gap-2 bg-blue-700 hover:bg-blue-600 px-4 py-2 rounded-lg text-sm font-medium">
            <Plus size={14} /> Add Account
          </button>
        </div>
      </div>

      {(error || msg) && (
        <div className={`rounded-lg p-3 mb-4 text-sm ${error ? 'bg-red-900/40 text-red-300 border border-red-700' : 'bg-orange-900/40 text-orange-300 border border-orange-700'}`}>
          {error || msg}
        </div>
      )}

      {/* Type summary */}
      <div className="grid grid-cols-5 gap-3 mb-6">
        {totals.map(t => (
          <button
            key={t.type}
            onClick={() => setTypeFilter(typeFilter === t.type ? '' : t.type)}
            className={`rounded-xl p-3 text-center border transition-all ${
              typeFilter === t.type
                ? (TYPE_COLORS[t.type] || 'border-gray-600')
                : 'bg-gray-800/40 border-gray-700/50 hover:border-gray-600'
            }`}
          >
            <p className="text-lg font-bold text-white">{t.count}</p>
            <p className="text-xs text-gray-400 mt-0.5">{t.type}</p>
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search by code or name…"
          className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-8 pr-4 py-2 text-sm text-white focus:outline-none focus:border-orange-500"
        />
      </div>

      {/* Table */}
      <div className="bg-gray-800/60 border border-gray-700 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-700 bg-gray-800/80">
              <th className="px-4 py-3 text-left text-xs text-gray-400 font-semibold">Code</th>
              <th className="px-4 py-3 text-left text-xs text-gray-400 font-semibold">Account Name</th>
              <th className="px-4 py-3 text-left text-xs text-gray-400 font-semibold">Type</th>
              <th className="px-4 py-3 text-left text-xs text-gray-400 font-semibold">Sub-Type</th>
              <th className="px-4 py-3 text-center text-xs text-gray-400 font-semibold">GST</th>
              <th className="px-4 py-3 text-center text-xs text-gray-400 font-semibold">TDS</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <tr key={i} className="border-b border-gray-700/50">
                  {Array.from({ length: 6 }).map((_, j) => (
                    <td key={j} className="px-4 py-3"><div className="h-3 bg-gray-700 rounded animate-pulse" /></td>
                  ))}
                </tr>
              ))
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-gray-500">
                  No accounts yet — click "Seed India CoA" to load 47 Ind AS accounts.
                </td>
              </tr>
            ) : (
              filtered.map(a => (
                <tr key={a.id} className="border-b border-gray-700/30 hover:bg-gray-700/20 transition-colors">
                  <td className="px-4 py-3 font-mono text-orange-400 text-xs">{a.code}</td>
                  <td className="px-4 py-3 text-white text-sm">{a.name}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full border ${TYPE_COLORS[a.account_type] || 'text-gray-400'}`}>
                      {a.account_type}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-400 text-xs">{a.sub_type}</td>
                  <td className="px-4 py-3 text-center">
                    {a.is_gst && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-purple-900/40 border border-purple-700 text-purple-400">
                        {a.gst_type?.toUpperCase() || 'GST'}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {a.is_tds && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-red-900/40 border border-red-700 text-red-400">TDS</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-600 mt-2 text-right">{filtered.length} accounts</p>
    </div>
  );
}
