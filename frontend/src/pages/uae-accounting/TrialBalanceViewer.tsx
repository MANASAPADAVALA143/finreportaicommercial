import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Sidebar from '../../components/layout/Sidebar';
import toast from 'react-hot-toast';
import {
  getTrialBalance,
  generateIFRS,
  type UAETrialBalance,
  type UAETrialBalanceLine,
} from '../../services/uaeAccounting.service';

function fmt(n: number) {
  return n.toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function groupByType(lines: UAETrialBalanceLine[]) {
  const map: Record<string, UAETrialBalanceLine[]> = {};
  for (const l of lines) {
    const key = l.account_type || 'Other';
    if (!map[key]) map[key] = [];
    map[key].push(l);
  }
  return map;
}

export default function TrialBalanceViewer() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [tb, setTb] = useState<UAETrialBalance | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!id) return;
    getTrialBalance(Number(id))
      .then(setTb)
      .catch((e) => toast.error(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  const handleGenerateIFRS = async () => {
    if (!tb) return;
    if (tb.ifrs_trial_balance_id) {
      navigate(`/ifrs-statement?tb=${tb.ifrs_trial_balance_id}`);
      return;
    }
    setGenerating(true);
    try {
      const result = await generateIFRS(tb.id);
      toast.success('IFRS statements generated! Redirecting…');
      setTimeout(() => navigate(`/ifrs-statement?tb=${result.ifrs_trial_balance_id}`), 1200);
    } catch (e: any) {
      toast.error(`Generation failed: ${e.message}`);
    } finally {
      setGenerating(false);
    }
  };

  const toggleGroup = (type: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  if (loading) {
    return (
      <div className="flex min-h-screen bg-slate-900">
        <Sidebar />
        <div className="flex-1 flex items-center justify-center text-slate-400">Loading trial balance…</div>
      </div>
    );
  }

  if (!tb) {
    return (
      <div className="flex min-h-screen bg-slate-900">
        <Sidebar />
        <div className="flex-1 flex items-center justify-center text-red-400">Trial balance not found.</div>
      </div>
    );
  }

  const lines = tb.lines ?? [];
  const filtered = search
    ? lines.filter(
        (l) =>
          l.account_name.toLowerCase().includes(search.toLowerCase()) ||
          l.account_code.toLowerCase().includes(search.toLowerCase())
      )
    : lines;
  const groups = groupByType(filtered);

  return (
    <div className="flex min-h-screen bg-slate-900">
      <Sidebar />
      <div className="flex-1 p-8 overflow-auto">
        {/* Breadcrumb */}
        <button
          onClick={() => navigate('/uae-accounting')}
          className="text-slate-400 hover:text-white text-sm mb-4 flex items-center gap-1"
        >
          ← UAE Accounting
        </button>

        {/* Header */}
        <div className="flex flex-wrap gap-4 items-start justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white">{tb.company_name}</h1>
            <p className="text-slate-400 text-sm mt-1">
              Trial Balance · {tb.period_start} to {tb.period_end} · {tb.currency} ·{' '}
              <span className="capitalize">{tb.source}</span>
            </p>
          </div>
          <button
            onClick={handleGenerateIFRS}
            disabled={generating}
            className={`px-5 py-2.5 rounded-xl text-sm font-semibold transition-colors ${
              tb.ifrs_trial_balance_id
                ? 'bg-green-700 hover:bg-green-600 text-white'
                : 'bg-blue-600 hover:bg-blue-500 text-white'
            } disabled:opacity-60`}
          >
            {generating
              ? 'Generating…'
              : tb.ifrs_trial_balance_id
              ? '✓ View IFRS Statements'
              : '⚡ Generate IFRS Statements'}
          </button>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {[
            { label: 'Accounts', value: tb.account_count },
            { label: 'Total Debits', value: `${tb.currency} ${fmt(tb.total_debits)}` },
            { label: 'Total Credits', value: `${tb.currency} ${fmt(tb.total_credits)}` },
            {
              label: 'Balance Status',
              value: tb.is_balanced ? '✓ Balanced' : '✗ Unbalanced',
              color: tb.is_balanced ? 'text-green-400' : 'text-red-400',
            },
          ].map((card) => (
            <div key={card.label} className="p-4 bg-slate-800 rounded-xl border border-slate-700">
              <div className="text-slate-400 text-xs mb-1">{card.label}</div>
              <div className={`font-semibold text-sm ${(card as any).color ?? 'text-white'}`}>
                {card.value}
              </div>
            </div>
          ))}
        </div>

        {/* Search */}
        <div className="mb-4">
          <input
            type="text"
            placeholder="Search accounts…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full max-w-sm bg-slate-800 border border-slate-600 text-white rounded-lg px-4 py-2 text-sm placeholder-slate-500 focus:outline-none focus:border-blue-500"
          />
        </div>

        {/* Grouped Table */}
        {Object.entries(groups).map(([type, typeLines]) => (
          <div key={type} className="mb-4">
            <button
              onClick={() => toggleGroup(type)}
              className="w-full flex items-center justify-between p-3 bg-slate-700/50 rounded-xl border border-slate-600 hover:bg-slate-700 transition-colors"
            >
              <span className="text-white font-medium text-sm">{type}</span>
              <span className="text-slate-400 text-xs">
                {typeLines.length} accounts {collapsed.has(type) ? '▶' : '▼'}
              </span>
            </button>
            {!collapsed.has(type) && (
              <div className="mt-1 bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-slate-400 text-xs uppercase border-b border-slate-700">
                      <th className="text-left px-4 py-2.5">Code</th>
                      <th className="text-left px-4 py-2.5">Account Name</th>
                      <th className="text-right px-4 py-2.5">Debit</th>
                      <th className="text-right px-4 py-2.5">Credit</th>
                      <th className="text-right px-4 py-2.5">Net Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {typeLines.map((line) => (
                      <tr key={line.id} className="border-b border-slate-700/40 hover:bg-slate-700/30">
                        <td className="px-4 py-2.5 text-slate-400 font-mono text-xs">
                          {line.account_code || '—'}
                        </td>
                        <td className="px-4 py-2.5 text-white">{line.account_name}</td>
                        <td className="px-4 py-2.5 text-right text-slate-300 font-mono">
                          {line.debit > 0 ? fmt(line.debit) : '—'}
                        </td>
                        <td className="px-4 py-2.5 text-right text-slate-300 font-mono">
                          {line.credit > 0 ? fmt(line.credit) : '—'}
                        </td>
                        <td
                          className={`px-4 py-2.5 text-right font-mono font-medium ${
                            line.net_balance >= 0 ? 'text-green-400' : 'text-red-400'
                          }`}
                        >
                          {fmt(Math.abs(line.net_balance))}
                          {line.net_balance < 0 ? ' Cr' : ''}
                        </td>
                      </tr>
                    ))}
                    {/* Group subtotal */}
                    <tr className="bg-slate-700/30 font-semibold text-sm">
                      <td colSpan={2} className="px-4 py-2 text-slate-300">
                        Subtotal — {type}
                      </td>
                      <td className="px-4 py-2 text-right text-white font-mono">
                        {fmt(typeLines.reduce((s, l) => s + l.debit, 0))}
                      </td>
                      <td className="px-4 py-2 text-right text-white font-mono">
                        {fmt(typeLines.reduce((s, l) => s + l.credit, 0))}
                      </td>
                      <td className="px-4 py-2 text-right text-white font-mono">
                        {fmt(typeLines.reduce((s, l) => s + l.net_balance, 0))}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ))}

        {filtered.length === 0 && (
          <div className="text-center text-slate-400 py-10">No accounts match your search.</div>
        )}
      </div>
    </div>
  );
}
