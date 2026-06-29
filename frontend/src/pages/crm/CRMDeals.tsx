import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Plus } from 'lucide-react';
import { CRM_STAGES, createDeal, listContacts, listDeals, listActivities, listQuotes, updateDealStage, type CRMDeal, type CRMActivity, type CRMQuote } from '../../services/crmService';

export default function CRMDeals() {
  const [deals, setDeals] = useState<CRMDeal[]>([]);
  const [view, setView] = useState<'list' | 'pipeline'>('list');
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [contacts, setContacts] = useState<{ id: string; name: string }[]>([]);
  const [selected, setSelected] = useState<CRMDeal | null>(null);
  const [activities, setActivities] = useState<CRMActivity[]>([]);
  const [quotes, setQuotes] = useState<CRMQuote[]>([]);
  const [form, setForm] = useState({ deal_name: '', value_aed: '', contact_id: '', stage: 'New' });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [d, c] = await Promise.all([listDeals(), listContacts()]);
      setDeals(d.deals);
      setContacts(c.contacts.map((x) => ({ id: x.id, name: x.name })));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Load failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function openDetail(d: CRMDeal) {
    setSelected(d);
    const [a, q] = await Promise.all([listActivities(d.id), listQuotes()]);
    setActivities(a.activities);
    setQuotes(q.quotes.filter((x) => x.deal_id === d.id));
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await createDeal({
        deal_name: form.deal_name,
        value_aed: parseFloat(form.value_aed) || 0,
        contact_id: form.contact_id || undefined,
        stage: form.stage,
      });
      toast.success('Deal created');
      setShowAdd(false);
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 justify-between">
        <div className="flex gap-1 bg-gray-800/60 p-1 rounded-lg">
          {(['list', 'pipeline'] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={`px-3 py-1.5 rounded text-sm capitalize ${view === v ? 'bg-teal-800 text-white' : 'text-gray-400'}`}
            >
              {v}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => setShowAdd(true)} className="flex items-center gap-2 bg-teal-700 px-4 py-2 rounded-lg text-sm">
          <Plus size={14} /> Add Deal
        </button>
      </div>

      {loading ? (
        <p className="text-gray-500">Loading…</p>
      ) : view === 'pipeline' ? (
        <div className="overflow-x-auto flex gap-3 pb-2">
          {CRM_STAGES.map((stage) => (
            <div key={stage} className="w-52 shrink-0 border border-gray-800 rounded-xl p-3 bg-gray-900/40">
              <p className="text-sm font-medium mb-2">{stage}</p>
              {deals.filter((d) => d.stage === stage).map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => void openDetail(d)}
                  className="w-full text-left mb-2 p-2 rounded-lg bg-gray-800 text-xs border border-gray-700"
                >
                  <p className="font-medium truncate">{d.deal_name}</p>
                  <p className="text-teal-400">AED {d.value_aed.toLocaleString()}</p>
                </button>
              ))}
            </div>
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto w-full rounded-xl border border-gray-800">
          <table className="w-full text-sm">
            <thead className="bg-gray-900/80 text-gray-400 text-left">
              <tr>
                <th className="p-3">Deal</th>
                <th className="p-3">Contact</th>
                <th className="p-3">Value</th>
                <th className="p-3">Stage</th>
                <th className="p-3">Close</th>
              </tr>
            </thead>
            <tbody>
              {deals.map((d) => (
                <tr key={d.id} className="border-t border-gray-800 hover:bg-gray-900/50 cursor-pointer" onClick={() => void openDetail(d)}>
                  <td className="p-3 font-medium">{d.deal_name}</td>
                  <td className="p-3 text-gray-400">{d.contact_name || '—'}</td>
                  <td className="p-3">AED {d.value_aed.toLocaleString()}</td>
                  <td className="p-3">
                    <select
                      className="bg-gray-800 border border-gray-700 rounded text-xs py-1"
                      value={d.stage}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => void updateDealStage(d.id, e.target.value).then(() => load())}
                    >
                      {CRM_STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </td>
                  <td className="p-3 text-gray-400">{d.expected_close_date || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <form onSubmit={(e) => void handleAdd(e)} className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-md p-6 space-y-3">
            <h3 className="text-lg font-semibold">New Deal</h3>
            <input className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm" placeholder="Deal name" value={form.deal_name} onChange={(e) => setForm((p) => ({ ...p, deal_name: e.target.value }))} required />
            <input className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm" placeholder="Value AED" type="number" value={form.value_aed} onChange={(e) => setForm((p) => ({ ...p, value_aed: e.target.value }))} />
            <select className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm" value={form.contact_id} onChange={(e) => setForm((p) => ({ ...p, contact_id: e.target.value }))}>
              <option value="">No contact</option>
              {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setShowAdd(false)} className="text-gray-400 text-sm px-4">Cancel</button>
              <button type="submit" disabled={saving} className="bg-teal-700 px-4 py-2 rounded-lg text-sm">{saving ? 'Saving…' : 'Create'}</button>
            </div>
          </form>
        </div>
      )}

      {selected && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={() => setSelected(null)}>
          <div className="w-full max-w-lg bg-gray-900 border-l border-gray-700 h-full overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-xl font-bold">{selected.deal_name}</h3>
            <p className="text-teal-400 text-lg mt-1">AED {selected.value_aed.toLocaleString()}</p>
            <p className="text-sm text-gray-400 mt-2">Stage: {selected.stage} · {selected.probability_pct}% probability</p>
            {selected.ar_invoice_id && (
              <a href="/uae-full/ar" className="text-sm text-teal-400 underline mt-2 inline-block">View AR invoice</a>
            )}
            <h4 className="mt-6 font-semibold text-sm">Activities</h4>
            <ul className="mt-2 space-y-2 text-sm">
              {activities.map((a) => (
                <li key={a.id} className="border-l-2 border-gray-700 pl-3 text-gray-400">{a.subject}</li>
              ))}
            </ul>
            <h4 className="mt-4 font-semibold text-sm">Quotes</h4>
            <ul className="mt-2 text-sm text-gray-400">
              {quotes.map((q) => <li key={q.id}>{q.quote_number} — {q.status} — AED {q.total_aed.toLocaleString()}</li>)}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
