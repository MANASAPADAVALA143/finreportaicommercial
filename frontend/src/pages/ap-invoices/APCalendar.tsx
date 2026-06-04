/**
 * APCalendar.tsx â€” Payment & Due Date Calendar
 * Shows invoices due/payments scheduled on a monthly calendar grid
 */
import { useState, useEffect, useMemo } from 'react';
import { ChevronLeft, ChevronRight, CalendarDays, AlertTriangle, Clock, CheckCircle } from 'lucide-react';
import { apSupabase, type APInvoice } from '../../lib/apSupabase';

function fmt(n: number, cur = 'AED') {
  return new Intl.NumberFormat('en-AE', { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(n);
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

export default function APCalendar() {
  const now = new Date();
  const [year, setYear]   = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth()); // 0-based
  const [invoices, setInvoices]  = useState<APInvoice[]>([]);
  const [selected, setSelected]  = useState<string | null>(null); // YYYY-MM-DD
  const [loading, setLoading]    = useState(true);

  const load = async () => {
    setLoading(true);
    const { data } = await apSupabase
      .from('invoices')
      .select('*')
      .order('due_date', { ascending: true })
      .limit(500);
    setInvoices((data ?? []) as APInvoice[]);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  // Map date â†’ invoices
  const byDate = useMemo(() => {
    const map: Record<string, APInvoice[]> = {};
    for (const inv of invoices) {
      const d = inv.due_date || inv.invoice_date;
      if (d) {
        const key = d.slice(0, 10);
        if (!map[key]) map[key] = [];
        map[key].push(inv);
      }
    }
    return map;
  }, [invoices]);

  // Calendar grid
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  // Pad to complete final row
  while (cells.length % 7 !== 0) cells.push(null);

  const prevMonth = () => { if (month === 0) { setYear(y => y-1); setMonth(11); } else setMonth(m => m-1); };
  const nextMonth = () => { if (month === 11) { setYear(y => y+1); setMonth(0); } else setMonth(m => m+1); };

  const todayStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;

  const getCellDate = (d: number) =>
    `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;

  const selectedInvoices = selected ? (byDate[selected] ?? []) : [];

  // This month totals
  const monthStr = `${year}-${String(month+1).padStart(2,'0')}`;
  const monthInvoices = invoices.filter(i => (i.due_date ?? i.invoice_date ?? '').startsWith(monthStr));
  const monthTotal = monthInvoices.reduce((s, i) => s + i.total_amount, 0);
  const overdueThisMonth = monthInvoices.filter(i => i.due_date && new Date(i.due_date) < now && i.status !== 'Paid').length;

  return (
    <div className="p-6 space-y-6 min-h-screen bg-gray-950">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <CalendarDays className="w-5 h-5 text-blue-400" /> Payment Calendar
          </h1>
          <p className="text-slate-400 text-sm mt-0.5">Invoice due dates and scheduled payments</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={prevMonth} className="p-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-white font-bold text-base min-w-[160px] text-center">{MONTHS[month]} {year}</span>
          <button onClick={nextMonth} className="p-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Month KPIs */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-slate-900 border border-slate-700 rounded-xl p-4">
          <p className="text-xs text-slate-400">This Month Due</p>
          <p className="text-lg font-bold text-white mt-1">{fmt(monthTotal)}</p>
        </div>
        <div className="bg-slate-900 border border-slate-700 rounded-xl p-4">
          <p className="text-xs text-slate-400">Invoices Due</p>
          <p className="text-lg font-bold text-white mt-1">{monthInvoices.length}</p>
        </div>
        <div className="bg-slate-900 border border-red-800/40 rounded-xl p-4">
          <p className="text-xs text-red-400">Overdue This Month</p>
          <p className="text-lg font-bold text-red-400 mt-1">{overdueThisMonth}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Calendar grid */}
        <div className="lg:col-span-2 bg-slate-900 border border-slate-700 rounded-xl overflow-hidden">
          {/* Day headers */}
          <div className="grid grid-cols-7 border-b border-slate-700">
            {DAYS.map(d => (
              <div key={d} className="text-center py-2 text-xs font-semibold text-slate-400 uppercase tracking-wide">{d}</div>
            ))}
          </div>
          {/* Cells */}
          <div className="grid grid-cols-7">
            {cells.map((d, i) => {
              if (d === null) return <div key={`e-${i}`} className="h-20 border-b border-r border-slate-800/50" />;
              const dateStr = getCellDate(d);
              const dayInvoices = byDate[dateStr] ?? [];
              const isToday = dateStr === todayStr;
              const isSelected = dateStr === selected;
              const hasOverdue = dayInvoices.some(i => i.status !== 'Paid' && new Date(dateStr) < now);
              return (
                <div
                  key={dateStr}
                  onClick={() => setSelected(isSelected ? null : dateStr)}
                  className={`h-20 border-b border-r border-slate-800/50 p-1.5 cursor-pointer transition-colors
                    ${isSelected ? 'bg-blue-900/40 border-blue-700' : 'hover:bg-slate-800/60'}
                    ${isToday ? 'ring-1 ring-inset ring-blue-500' : ''}`}
                >
                  <div className={`text-xs font-bold mb-1 w-6 h-6 rounded-full flex items-center justify-center
                    ${isToday ? 'bg-blue-600 text-white' : 'text-slate-300'}`}>
                    {d}
                  </div>
                  {dayInvoices.slice(0, 2).map(inv => (
                    <div key={inv.id}
                      className={`text-[9px] rounded px-1 py-0.5 truncate mb-0.5 ${
                        inv.status === 'Paid' ? 'bg-green-900/60 text-green-300' :
                        hasOverdue ? 'bg-red-900/60 text-red-300' :
                        'bg-blue-900/60 text-blue-300'}`}>
                      {inv.vendor_name.split(' ')[0]} {fmt(inv.total_amount, inv.currency)}
                    </div>
                  ))}
                  {dayInvoices.length > 2 && (
                    <div className="text-[9px] text-slate-500">+{dayInvoices.length - 2} more</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Side panel â€” selected day or upcoming */}
        <div className="space-y-4">
          {selected ? (
            <div className="bg-slate-900 border border-slate-700 rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold text-white">
                  {new Date(selected + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
                </h3>
                <button onClick={() => setSelected(null)} className="text-slate-500 hover:text-white text-xs">âœ• Clear</button>
              </div>
              {selectedInvoices.length === 0 ? (
                <p className="text-slate-500 text-sm">No invoices on this date.</p>
              ) : (
                <div className="space-y-2">
                  {selectedInvoices.map(inv => (
                    <div key={inv.id} className="bg-slate-800 rounded-lg p-3">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-blue-400 text-xs">{inv.invoice_number}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
                          inv.status === 'Paid' ? 'bg-green-900 text-green-300' : 'bg-yellow-900 text-yellow-300'
                        }`}>{inv.status}</span>
                      </div>
                      <p className="text-white text-xs font-medium mt-1">{inv.vendor_name}</p>
                      <p className="text-slate-300 text-xs">{fmt(inv.total_amount, inv.currency)}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : null}

          {/* Upcoming this month */}
          <div className="bg-slate-900 border border-slate-700 rounded-xl p-4">
            <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-1.5">
              <Clock className="w-4 h-4 text-blue-400" /> Upcoming Due
            </h3>
            {loading ? (
              <p className="text-slate-500 text-xs">Loadingâ€¦</p>
            ) : monthInvoices.filter(i => i.status !== 'Paid').slice(0, 8).map(inv => {
              const overdue = inv.due_date && new Date(inv.due_date) < now;
              return (
                <div key={inv.id} className="flex items-start justify-between py-2 border-b border-slate-800 last:border-0">
                  <div>
                    <p className="font-mono text-blue-400 text-xs">{inv.invoice_number}</p>
                    <p className="text-slate-300 text-xs truncate max-w-[120px]">{inv.vendor_name}</p>
                    <p className="text-slate-500 text-[10px]">{inv.due_date?.slice(0,10) ?? 'â€”'}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-white text-xs font-semibold">{fmt(inv.total_amount, inv.currency)}</p>
                    {overdue ? (
                      <span className="flex items-center gap-0.5 text-[10px] text-red-400 justify-end">
                        <AlertTriangle className="w-3 h-3" /> Overdue
                      </span>
                    ) : (
                      <span className="text-[10px] text-slate-500">Due soon</span>
                    )}
                  </div>
                </div>
              );
            })}
            {monthInvoices.filter(i => i.status !== 'Paid').length === 0 && (
              <div className="flex items-center gap-2 text-green-400 text-sm">
                <CheckCircle className="w-4 h-4" /> All paid this month!
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

