/**
 * AR Dunning — history, run dunning, template preview
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Mail, RefreshCw, FileText, History } from 'lucide-react';
import toast from 'react-hot-toast';
import { useCompany } from '../../context/CompanyContext';
import * as arSvc from '../../services/arService';
import type { ARDunningHistoryRow, ARDunningTemplate } from '../../services/arService';

type Tab = 'history' | 'templates';
type SortKey = 'invoice_number' | 'customer_name' | 'last_dunning_level' | 'last_dunning_sent_at' | 'dunning_count' | 'outstanding' | 'days_overdue';

const LEVEL_BADGE: Record<number, string> = {
  1: 'bg-green-900/40 text-green-400 border-green-700',
  2: 'bg-amber-900/40 text-amber-400 border-amber-700',
  3: 'bg-red-900/40 text-red-400 border-red-700',
  4: 'bg-red-950/60 text-red-300 border-red-800',
};

const LEVEL_FILTER = ['all', '1', '2', '3', '4'] as const;
type LevelFilter = (typeof LEVEL_FILTER)[number];

function fmtAED(n: number): string {
  return `AED ${n.toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-AE', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function ARDunning() {
  const { activeCompanyId } = useCompany();
  const companyId = activeCompanyId ?? '';

  const [tab, setTab] = useState<Tab>('history');
  const [rows, setRows] = useState<ARDunningHistoryRow[]>([]);
  const [templates, setTemplates] = useState<ARDunningTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [levelFilter, setLevelFilter] = useState<LevelFilter>('all');
  const [lastRun, setLastRun] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('last_dunning_sent_at');
  const [sortAsc, setSortAsc] = useState(false);

  const loadHistory = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    try {
      const res = await arSvc.getARDunningHistory(
        levelFilter === 'all' ? undefined : Number(levelFilter),
      );
      setRows(res.invoices);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Failed to load dunning history');
    } finally {
      setLoading(false);
    }
  }, [companyId, levelFilter]);

  const loadTemplates = useCallback(async () => {
    try {
      const res = await arSvc.getARDunningTemplates();
      setTemplates(res.templates);
    } catch {
      /* templates are optional on first paint */
    }
  }, []);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    void loadTemplates();
  }, [loadTemplates]);

  const handleRunDunning = async () => {
    if (!companyId) return;
    setRunning(true);
    try {
      const res = await arSvc.runCollectionsDunning(companyId);
      setLastRun(res.summary.join(' · '));
      if (res.sent_count === 0 && res.skipped_count === 0) {
        toast('No overdue invoices to chase', { icon: 'ℹ️' });
      } else {
        toast.success(`Sent ${res.sent_count}, skipped ${res.skipped_count}`);
      }
      void loadHistory();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Dunning failed');
    } finally {
      setRunning(false);
    }
  };

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'customer_name':
          cmp = a.customer_name.localeCompare(b.customer_name);
          break;
        case 'last_dunning_level':
          cmp = a.last_dunning_level - b.last_dunning_level;
          break;
        case 'last_dunning_sent_at':
          cmp = (a.last_dunning_sent_at ?? '').localeCompare(b.last_dunning_sent_at ?? '');
          break;
        case 'dunning_count':
          cmp = a.dunning_count - b.dunning_count;
          break;
        case 'outstanding':
          cmp = a.outstanding - b.outstanding;
          break;
        case 'days_overdue':
          cmp = a.days_overdue - b.days_overdue;
          break;
        default:
          cmp = a.invoice_number.localeCompare(b.invoice_number);
      }
      return sortAsc ? cmp : -cmp;
    });
    return copy;
  }, [rows, sortKey, sortAsc]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc((v) => !v);
    else {
      setSortKey(key);
      setSortAsc(false);
    }
  };

  const SortTh = ({ label, col }: { label: string; col: SortKey }) => (
    <th
      className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase cursor-pointer hover:text-gray-200"
      onClick={() => toggleSort(col)}
    >
      {label}{sortKey === col ? (sortAsc ? ' ↑' : ' ↓') : ''}
    </th>
  );

  if (!companyId) {
    return (
      <div className="min-h-screen bg-gray-950 text-gray-100 p-6 flex items-center justify-center">
        <p className="text-gray-400">Select a company to manage dunning.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Mail size={22} className="text-amber-400" /> AR Dunning
          </h1>
          <p className="text-gray-400 text-sm mt-1">Escalating payment reminders — L1 through L4 by days overdue</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => void loadHistory()} className="p-2 bg-gray-800 hover:bg-gray-700 rounded-lg">
            <RefreshCw size={14} />
          </button>
          <button
            type="button"
            disabled={running}
            onClick={() => void handleRunDunning()}
            className="flex items-center gap-2 bg-amber-700 hover:bg-amber-600 px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
          >
            <Mail size={14} /> {running ? 'Sending…' : 'Run Dunning'}
          </button>
        </div>
      </div>

      {lastRun && (
        <div className="mb-4 text-sm bg-amber-950/40 border border-amber-800 rounded-lg px-4 py-2 text-amber-200">
          {lastRun}
        </div>
      )}

      <div className="flex gap-1 bg-gray-800/60 p-1 rounded-xl w-fit mb-4">
        {([
          { id: 'history' as Tab, label: 'History', icon: History },
          { id: 'templates' as Tab, label: 'Templates', icon: FileText },
        ]).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === id ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {tab === 'history' && (
        <>
          <div className="flex items-center gap-3 mb-4">
            <span className="text-sm text-gray-400">Filter by level:</span>
            {LEVEL_FILTER.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setLevelFilter(f)}
                className={`px-3 py-1 rounded-full text-xs border ${
                  levelFilter === f
                    ? 'bg-amber-900/40 text-amber-300 border-amber-700'
                    : 'bg-gray-800 text-gray-400 border-gray-700 hover:border-gray-500'
                }`}
              >
                {f === 'all' ? 'All' : `L${f}`}
              </button>
            ))}
          </div>

          <div className="overflow-x-auto rounded-xl border border-gray-800">
            <table className="w-full text-sm">
              <thead className="bg-gray-900/80 border-b border-gray-800">
                <tr>
                  <SortTh label="Invoice" col="invoice_number" />
                  <SortTh label="Customer" col="customer_name" />
                  <SortTh label="Level" col="last_dunning_level" />
                  <SortTh label="Last Sent" col="last_dunning_sent_at" />
                  <SortTh label="Count" col="dunning_count" />
                  <SortTh label="Outstanding" col="outstanding" />
                  <SortTh label="Days Overdue" col="days_overdue" />
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500">Loading…</td></tr>
                ) : sorted.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                      No dunning history yet. Run dunning on overdue invoices to see records here.
                    </td>
                  </tr>
                ) : (
                  sorted.map((r) => (
                    <tr key={r.invoice_id} className="border-b border-gray-800/60 hover:bg-gray-900/40">
                      <td className="px-4 py-3 font-mono text-gray-200">{r.invoice_number}</td>
                      <td className="px-4 py-3">{r.customer_name}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded border text-xs font-medium ${LEVEL_BADGE[r.last_dunning_level] ?? LEVEL_BADGE[1]}`}>
                          L{r.last_dunning_level}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-400">{fmtDate(r.last_dunning_sent_at)}</td>
                      <td className="px-4 py-3">{r.dunning_count}</td>
                      <td className="px-4 py-3">{fmtAED(r.outstanding)}</td>
                      <td className="px-4 py-3">{r.days_overdue > 0 ? `${r.days_overdue}d` : '—'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'templates' && (
        <div className="grid gap-4 md:grid-cols-2">
          {(templates.length ? templates : []).map((t) => (
            <div key={t.level} className="rounded-xl border border-gray-800 bg-gray-900/50 p-5">
              <div className="flex items-center gap-2 mb-3">
                <span className={`px-2 py-0.5 rounded border text-xs font-medium ${LEVEL_BADGE[t.level] ?? LEVEL_BADGE[1]}`}>
                  L{t.level}
                </span>
                <span className="text-sm text-gray-300">{t.label}</span>
              </div>
              <p className="text-xs text-gray-500 mb-2">Subject: {t.subject}</p>
              <pre className="text-xs text-gray-400 whitespace-pre-wrap font-sans leading-relaxed bg-gray-950/60 rounded-lg p-3 border border-gray-800">
                {t.body}
              </pre>
            </div>
          ))}
          {templates.length === 0 && (
            <p className="text-gray-500 text-sm">Loading templates…</p>
          )}
        </div>
      )}
    </div>
  );
}
