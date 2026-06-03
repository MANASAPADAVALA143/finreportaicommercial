/**
 * APGLAccounts.tsx — GL Account Mapping
 * Shows which GL accounts are assigned to invoices, allows mapping IFRS categories to GL codes
 */
import { useState, useEffect, useMemo } from 'react';
import { BookOpen, Search, Edit2, Save, X, RefreshCw, Download } from 'lucide-react';
import { apSupabase, type APInvoice } from '../../lib/apSupabase';
import * as XLSX from 'xlsx';

function fmt(n: number, cur = 'AED') {
  return new Intl.NumberFormat('en-AE', { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(n);
}

// Default GL mapping per IFRS category
const DEFAULT_GL_MAP: Record<string, { code: string; name: string; type: string }> = {
  'Operating Expenses':     { code: '5100', name: 'Operating Expenses',     type: 'Expense' },
  'Cost of Sales':          { code: '5000', name: 'Cost of Goods Sold',     type: 'Expense' },
  'Research & Development': { code: '5200', name: 'R&D Expenses',           type: 'Expense' },
  'Capital Expenditure':    { code: '1500', name: 'Capital Assets',         type: 'Asset' },
  'Finance Costs':          { code: '6100', name: 'Finance Costs',          type: 'Expense' },
  'Revenue':                { code: '4000', name: 'Revenue',                type: 'Income' },
  'Other':                  { code: '5900', name: 'Miscellaneous Expenses', type: 'Expense' },
};

type GLEntry = {
  category: string;
  code: string;
  name: string;
  type: string;
  invoiceCount: number;
  totalAmount: number;
  currency: string;
};

export default function APGLAccounts() {
  const [invoices, setInvoices] = useState<APInvoice[]>([]);
  const [loading, setLoading]   = useState(true);
  const [search, setSearch]     = useState('');
  const [editing, setEditing]   = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ code: '', name: '', type: '' });
  const [glOverrides, setGlOverrides] = useState<Record<string, { code: string; name: string; type: string }>>({});

  const load = async () => {
    setLoading(true);
    const { data } = await apSupabase.from('invoices').select('*').limit(500);
    setInvoices((data ?? []) as APInvoice[]);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const entries: GLEntry[] = useMemo(() => {
    const groups: Record<string, APInvoice[]> = {};
    for (const inv of invoices) {
      const cat = inv.ifrs_category || 'Uncategorised';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(inv);
    }
    return Object.entries(groups).map(([cat, invs]) => {
      const glBase = DEFAULT_GL_MAP[cat] ?? { code: '9999', name: 'Uncategorised', type: 'Expense' };
      const override = glOverrides[cat];
      return {
        category: cat,
        code: override?.code ?? glBase.code,
        name: override?.name ?? glBase.name,
        type: override?.type ?? glBase.type,
        invoiceCount: invs.length,
        totalAmount: invs.reduce((s, i) => s + i.total_amount, 0),
        currency: invs[0]?.currency ?? 'AED',
      };
    }).sort((a, b) => b.totalAmount - a.totalAmount);
  }, [invoices, glOverrides]);

  const filtered = entries.filter(e => {
    const q = search.toLowerCase();
    return !q || e.category.toLowerCase().includes(q) || e.code.includes(q) || e.name.toLowerCase().includes(q);
  });

  const startEdit = (e: GLEntry) => {
    setEditing(e.category);
    setEditForm({ code: e.code, name: e.name, type: e.type });
  };
  const saveEdit = (cat: string) => {
    setGlOverrides(p => ({ ...p, [cat]: { ...editForm } }));
    setEditing(null);
  };

  const exportXLSX = () => {
    const rows = entries.map(e => ({
      'IFRS Category': e.category,
      'GL Code': e.code,
      'GL Account Name': e.name,
      'Account Type': e.type,
      'Invoice Count': e.invoiceCount,
      'Total Amount': e.totalAmount,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'GL Accounts');
    XLSX.writeFile(wb, `gl_accounts_${new Date().toISOString().slice(0,10)}.xlsx`);
  };

  const typeColor: Record<string, string> = {
    Expense: 'bg-orange-900 text-orange-300 border-orange-700',
    Asset:   'bg-blue-900 text-blue-300 border-blue-700',
    Income:  'bg-green-900 text-green-300 border-green-700',
    Liability:'bg-purple-900 text-purple-300 border-purple-700',
  };

  return (
    <div className="p-6 space-y-6 min-h-screen bg-gray-950">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-purple-400" /> GL Account Mapping
          </h1>
          <p className="text-slate-400 text-sm mt-0.5">Map IFRS categories to GL account codes — click Edit to override</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm">
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
          <button onClick={exportXLSX} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm">
            <Download className="w-3.5 h-3.5" /> Export
          </button>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-slate-900 border border-slate-700 rounded-xl p-4">
          <p className="text-xs text-slate-400">GL Categories</p>
          <p className="text-xl font-bold text-white mt-1">{entries.length}</p>
        </div>
        <div className="bg-slate-900 border border-slate-700 rounded-xl p-4">
          <p className="text-xs text-slate-400">Total Invoices Mapped</p>
          <p className="text-xl font-bold text-white mt-1">{invoices.length}</p>
        </div>
        <div className="bg-slate-900 border border-slate-700 rounded-xl p-4">
          <p className="text-xs text-slate-400">Custom Overrides</p>
          <p className="text-xl font-bold text-purple-400 mt-1">{Object.keys(glOverrides).length}</p>
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-xs">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search GL code, category…"
          className="w-full bg-slate-800 border border-slate-600 rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500" />
      </div>

      {/* Table */}
      <div className="bg-slate-900 border border-slate-700 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700 bg-slate-800/50">
                {['IFRS Category','GL Code','Account Name','Type','Invoice Count','Total Amount','Actions'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wide whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="text-center py-12 text-slate-500">Loading GL accounts…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-12 text-slate-500">No GL entries found</td></tr>
              ) : (
                filtered.map(e => (
                  <tr key={e.category} className="border-b border-slate-800 hover:bg-slate-800/40 transition-colors">
                    <td className="px-4 py-3 text-white font-medium">{e.category}</td>
                    <td className="px-4 py-3">
                      {editing === e.category ? (
                        <input value={editForm.code} onChange={f => setEditForm(p => ({ ...p, code: f.target.value }))}
                          className="w-20 bg-slate-700 border border-blue-500 rounded px-2 py-1 text-white text-xs font-mono" />
                      ) : (
                        <span className="font-mono text-blue-400 text-sm font-bold">{e.code}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {editing === e.category ? (
                        <input value={editForm.name} onChange={f => setEditForm(p => ({ ...p, name: f.target.value }))}
                          className="w-48 bg-slate-700 border border-blue-500 rounded px-2 py-1 text-white text-xs" />
                      ) : (
                        <span className="text-slate-200">{e.name}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {editing === e.category ? (
                        <select value={editForm.type} onChange={f => setEditForm(p => ({ ...p, type: f.target.value }))}
                          className="bg-slate-700 border border-blue-500 rounded px-2 py-1 text-white text-xs">
                          {['Expense','Asset','Income','Liability'].map(t => <option key={t}>{t}</option>)}
                        </select>
                      ) : (
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${typeColor[e.type] ?? 'bg-slate-700 text-slate-300 border-slate-600'}`}>
                          {e.type}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="px-2 py-0.5 rounded-full bg-slate-700 text-slate-300 text-xs">{e.invoiceCount}</span>
                    </td>
                    <td className="px-4 py-3 text-white font-semibold">{fmt(e.totalAmount, e.currency)}</td>
                    <td className="px-4 py-3">
                      {editing === e.category ? (
                        <div className="flex gap-1.5">
                          <button onClick={() => saveEdit(e.category)}
                            className="flex items-center gap-1 px-2 py-1 rounded bg-green-700 hover:bg-green-600 text-white text-xs">
                            <Save className="w-3 h-3" /> Save
                          </button>
                          <button onClick={() => setEditing(null)}
                            className="p-1 rounded bg-slate-700 hover:bg-slate-600 text-slate-300">
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      ) : (
                        <button onClick={() => startEdit(e)}
                          className="flex items-center gap-1 px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs">
                          <Edit2 className="w-3 h-3" /> Edit
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-3 border-t border-slate-700 text-xs text-slate-500">
          {filtered.length} categories · Edits are session-only. Connect to ERP to persist GL mapping.
        </div>
      </div>
    </div>
  );
}
