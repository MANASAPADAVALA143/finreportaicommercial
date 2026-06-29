import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Plus, Search } from 'lucide-react';
import { createContact, listContacts, listDeals, listActivities, type CRMContact, type CRMDeal, type CRMActivity } from '../../services/crmService';

const TYPES = ['Lead', 'Prospect', 'Customer'] as const;

const RISK_STYLES: Record<string, string> = {
  LOW: 'bg-green-900/50 text-green-400 border-green-700',
  MEDIUM: 'bg-amber-900/50 text-amber-400 border-amber-700',
  HIGH: 'bg-orange-900/50 text-orange-400 border-orange-700',
  CRITICAL: 'bg-red-900/50 text-red-400 border-red-700',
};

function RiskBadge({ contact }: { contact: { credit_score?: number | null; risk_category?: string | null } }) {
  if (!contact.risk_category) return null;
  const cat = contact.risk_category.toUpperCase();
  const score = contact.credit_score ?? '—';
  return (
    <span
      title={`Score: ${score}/100 — ${cat.replace('_', ' ')} Risk`}
      className={`ml-2 text-[10px] px-2 py-0.5 rounded-full border ${RISK_STYLES[cat] ?? 'bg-gray-800 text-gray-400 border-gray-700'}`}
    >
      {cat}
    </span>
  );
}

export default function CRMContacts() {
  const [contacts, setContacts] = useState<CRMContact[]>([]);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [selected, setSelected] = useState<CRMContact | null>(null);
  const [deals, setDeals] = useState<CRMDeal[]>([]);
  const [activities, setActivities] = useState<CRMActivity[]>([]);
  const [form, setForm] = useState({ name: '', company_name: '', email: '', phone: '', contact_type: 'Lead', source: 'website' });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listContacts(search || undefined, typeFilter || undefined);
      setContacts(res.contacts);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Load failed');
    } finally {
      setLoading(false);
    }
  }, [search, typeFilter]);

  useEffect(() => { void load(); }, [load]);

  async function openDetail(c: CRMContact) {
    setSelected(c);
    try {
      const [d, a] = await Promise.all([
        listDeals(),
        listActivities(undefined, c.id),
      ]);
      setDeals(d.deals.filter((x) => x.contact_id === c.id));
      setActivities(a.activities);
    } catch {
      setDeals([]);
      setActivities([]);
    }
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      await createContact(form);
      toast.success('Contact added');
      setShowAdd(false);
      setForm({ name: '', company_name: '', email: '', phone: '', contact_type: 'Lead', source: 'website' });
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-center justify-between">
        <div className="flex gap-2 flex-1 min-w-[200px]">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
            <input
              className="w-full pl-9 pr-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-sm"
              placeholder="Search contacts…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select
            className="bg-gray-900 border border-gray-700 rounded-lg px-3 text-sm"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
          >
            <option value="">All types</option>
            {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <button
          type="button"
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 bg-teal-700 hover:bg-teal-600 px-4 py-2 rounded-lg text-sm"
        >
          <Plus size={14} /> Add Contact
        </button>
      </div>

      {loading ? (
        <p className="text-gray-500">Loading…</p>
      ) : contacts.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          <p>No contacts yet — add your first lead or customer</p>
        </div>
      ) : (
        <div className="overflow-x-auto w-full rounded-xl border border-gray-800">
          <table className="w-full text-sm">
            <thead className="bg-gray-900/80 text-gray-400 text-left">
              <tr>
                <th className="p-3">Name</th>
                <th className="p-3">Company</th>
                <th className="p-3">Type</th>
                <th className="p-3">Email</th>
                <th className="p-3">Phone</th>
              </tr>
            </thead>
            <tbody>
              {contacts.map((c) => (
                <tr
                  key={c.id}
                  className="border-t border-gray-800 hover:bg-gray-900/50 cursor-pointer"
                  onClick={() => void openDetail(c)}
                >
                  <td className="p-3 font-medium">
                    {c.name}
                    <RiskBadge contact={c} />
                  </td>
                  <td className="p-3 text-gray-400">{c.company_name || '—'}</td>
                  <td className="p-3"><span className="px-2 py-0.5 rounded bg-gray-800 text-xs">{c.contact_type}</span></td>
                  <td className="p-3 text-gray-400">{c.email || '—'}</td>
                  <td className="p-3 text-gray-400">{c.phone || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <form onSubmit={(e) => void handleAdd(e)} className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-md p-6 space-y-3">
            <h3 className="text-lg font-semibold">Add Contact</h3>
            {(['name', 'company_name', 'email', 'phone'] as const).map((f) => (
              <input
                key={f}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm"
                placeholder={f.replace('_', ' ')}
                value={form[f]}
                onChange={(e) => setForm((p) => ({ ...p, [f]: e.target.value }))}
                required={f === 'name'}
              />
            ))}
            <select
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm"
              value={form.contact_type}
              onChange={(e) => setForm((p) => ({ ...p, contact_type: e.target.value }))}
            >
              {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <div className="flex gap-2 justify-end pt-2">
              <button type="button" onClick={() => setShowAdd(false)} className="px-4 py-2 text-sm text-gray-400">Cancel</button>
              <button type="submit" disabled={saving} className="px-4 py-2 bg-teal-700 rounded-lg text-sm disabled:opacity-50">
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
        </div>
      )}

      {selected && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={() => setSelected(null)}>
          <div className="w-full max-w-md bg-gray-900 border-l border-gray-700 h-full overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-xl font-bold">{selected.name}</h3>
            <p className="text-gray-400 text-sm">{selected.company_name}</p>
            <p className="text-sm mt-4">{selected.email}</p>
            <p className="text-sm text-gray-400">{selected.phone}</p>
            <h4 className="mt-6 font-semibold text-sm">Deals ({deals.length})</h4>
            <ul className="mt-2 space-y-1 text-sm text-gray-400">
              {deals.map((d) => <li key={d.id}>{d.deal_name} — AED {d.value_aed.toLocaleString()}</li>)}
            </ul>
            <h4 className="mt-4 font-semibold text-sm">Activities</h4>
            <ul className="mt-2 space-y-1 text-sm text-gray-400">
              {activities.map((a) => <li key={a.id}>{a.subject} ({a.activity_type})</li>)}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
