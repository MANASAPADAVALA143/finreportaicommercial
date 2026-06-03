/**
 * Chart of Accounts — UAE IFRS-aligned CoA
 * 62 accounts, VAT flags, CT flags, seed wizard
 */
import { useEffect, useState } from 'react';
import { Plus, Search, Zap, Download } from 'lucide-react';
import * as svc from '../../services/uaeFullAccounting.service';
import type { UAEAccount } from '../../services/uaeFullAccounting.service';

const TYPE_COLORS: Record<string, string> = {
  asset:     'text-blue-400',
  liability: 'text-red-400',
  equity:    'text-purple-400',
  revenue:   'text-green-400',
  expense:   'text-amber-400',
};

export default function ChartOfAccounts() {
  const [accounts, setAccounts]   = useState<UAEAccount[]>([]);
  const [loading, setLoading]     = useState(true);
  const [seeding, setSeeding]     = useState(false);
  const [search, setSearch]       = useState('');
  const [filterType, setFilterType] = useState('');
  const [error, setError]         = useState('');
  const [msg, setMsg]             = useState('');

  const load = () => {
    setLoading(true);
    svc.listAccounts()
      .then(d => setAccounts(d.accounts))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const handleSeed = async () => {
    setSeeding(true); setError(''); setMsg('');
    try {
      const r = await svc.seedCoA();
      setMsg(`Seeded ${r.seeded} accounts successfully.`);
      load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSeeding(false);
    }
  };

  const filtered = accounts.filter(a => {
    const s = search.toLowerCase();
    const matchSearch = !s || a.account_code.toLowerCase().includes(s) || a.account_name.toLowerCase().includes(s);
    const matchType   = !filterType || a.account_type === filterType;
    return matchSearch && matchType;
  });

  const types = Array.from(new Set(accounts.map(a => a.account_type))).sort();

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Chart of Accounts</h1>
          <p className="text-gray-400 text-sm mt-1">UAE IFRS-aligned — 62 standard accounts</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={handleSeed}
            disabled={seeding}
            className="flex items-center gap-2 bg-green-700 hover:bg-green-600 disabled:opacity-50 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            <Zap size={14} />
            {seeding ? 'Seeding…' : 'Seed UAE CoA'}
          </button>
          <button className="flex items-center gap-2 bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded-lg text-sm font-medium transition-colors">
            <Plus size={14} /> Add Account
          </button>
        </div>
      </div>

      {(error || msg) && (
        <div className={`rounded-lg p-3 mb-4 text-sm ${error ? 'bg-red-900/40 text-red-300 border border-red-700' : 'bg-green-900/40 text-green-300 border border-green-700'}`}>
          {error || msg}
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-3 mb-4">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search code or name…"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-green-500"
          />
        </div>
        <select
          value={filterType}
          onChange={e => setFilterType(e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-green-500"
        >
          <option value="">All Types</option>
          {types.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
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
              <th className="px-4 py-3 text-center text-xs text-gray-400 font-semibold">VAT</th>
              <th className="px-4 py-3 text-center text-xs text-gray-400 font-semibold">CT</th>
              <th className="px-4 py-3 text-right text-xs text-gray-400 font-semibold">Currency</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 10 }).map((_, i) => (
                <tr key={i} className="border-b border-gray-700/50">
                  {Array.from({ length: 7 }).map((_, j) => (
                    <td key={j} className="px-4 py-3">
                      <div className="h-3 bg-gray-700 rounded animate-pulse" />
                    </td>
                  ))}
                </tr>
              ))
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-gray-500">
                  {accounts.length === 0
                    ? 'No accounts yet — click "Seed UAE CoA" to populate the standard chart of accounts.'
                    : 'No accounts match your filter.'}
                </td>
              </tr>
            ) : (
              filtered.map(a => (
                <tr key={a.id} className="border-b border-gray-700/30 hover:bg-gray-700/20 transition-colors">
                  <td className="px-4 py-3 font-mono text-blue-400 text-xs">{a.account_code}</td>
                  <td className="px-4 py-3 text-white">{a.account_name}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-medium capitalize ${TYPE_COLORS[a.account_type] ?? 'text-gray-400'}`}>
                      {a.account_type}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-400 text-xs">{a.sub_type ?? '—'}</td>
                  <td className="px-4 py-3 text-center">
                    {a.is_vat ? (
                      <span className="text-xs bg-amber-900/40 text-amber-400 border border-amber-700 px-2 py-0.5 rounded-full">
                        {a.vat_rate}%
                      </span>
                    ) : (
                      <span className="text-gray-600 text-xs">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {a.is_ct ? (
                      <span className="text-xs bg-purple-900/40 text-purple-400 border border-purple-700 px-2 py-0.5 rounded-full">CT</span>
                    ) : (
                      <span className="text-gray-600 text-xs">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-400 text-xs">{a.currency}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-600 mt-3">{filtered.length} of {accounts.length} accounts</p>
    </div>
  );
}
