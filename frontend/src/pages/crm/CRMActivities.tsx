import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Plus } from 'lucide-react';
import { createActivity, listActivities, type CRMActivity } from '../../services/crmService';
import { format, parseISO, isToday, isPast, startOfDay } from 'date-fns';

const TYPES = ['call', 'email', 'meeting', 'follow-up', 'proposal'] as const;

function rowClass(a: CRMActivity): string {
  if (a.completed) return 'border-gray-800 opacity-60';
  if (!a.due_date) return 'border-gray-800';
  const d = parseISO(a.due_date);
  if (isPast(startOfDay(d)) && !isToday(d)) return 'border-red-800 bg-red-950/20';
  if (isToday(d)) return 'border-amber-700 bg-amber-950/20';
  return 'border-gray-800';
}

export default function CRMActivities() {
  const [activities, setActivities] = useState<CRMActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [showLog, setShowLog] = useState(false);
  const [form, setForm] = useState({ subject: '', activity_type: 'follow-up', due_date: '', notes: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listActivities();
      setActivities(res.activities);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Load failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function handleLog(e: React.FormEvent) {
    e.preventDefault();
    try {
      await createActivity(form);
      toast.success('Activity logged');
      setShowLog(false);
      setForm({ subject: '', activity_type: 'follow-up', due_date: '', notes: '' });
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed');
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button type="button" onClick={() => setShowLog(true)} className="flex items-center gap-2 bg-teal-700 px-4 py-2 rounded-lg text-sm">
          <Plus size={14} /> Log Activity
        </button>
      </div>

      {loading ? (
        <p className="text-gray-500">Loading…</p>
      ) : activities.length === 0 ? (
        <p className="text-center py-16 text-gray-500">No activities yet</p>
      ) : (
        <div className="space-y-2">
          {activities.map((a) => (
            <div key={a.id} className={`rounded-xl border p-4 ${rowClass(a)}`}>
              <div className="flex justify-between gap-2">
                <div>
                  <p className="font-medium">{a.subject}</p>
                  <p className="text-xs text-gray-500 mt-1 capitalize">{a.activity_type}</p>
                </div>
                <div className="text-right text-xs text-gray-400">
                  {a.due_date ? format(parseISO(a.due_date), 'dd MMM yyyy') : 'No due date'}
                  {a.completed && <span className="block text-green-500">Done</span>}
                </div>
              </div>
              {a.notes && <p className="text-sm text-gray-500 mt-2">{a.notes}</p>}
            </div>
          ))}
        </div>
      )}

      {showLog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <form onSubmit={(e) => void handleLog(e)} className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-md p-6 space-y-3">
            <h3 className="text-lg font-semibold">Log Activity</h3>
            <input className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm" placeholder="Subject" value={form.subject} onChange={(e) => setForm((p) => ({ ...p, subject: e.target.value }))} required />
            <select className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm" value={form.activity_type} onChange={(e) => setForm((p) => ({ ...p, activity_type: e.target.value }))}>
              {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <input type="date" className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm" value={form.due_date} onChange={(e) => setForm((p) => ({ ...p, due_date: e.target.value }))} />
            <textarea className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm min-h-[80px]" placeholder="Notes" value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} />
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setShowLog(false)} className="text-gray-400 text-sm">Cancel</button>
              <button type="submit" className="bg-teal-700 px-4 py-2 rounded-lg text-sm">Save</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
