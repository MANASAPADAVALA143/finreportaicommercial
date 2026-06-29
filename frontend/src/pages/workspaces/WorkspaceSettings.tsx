import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { useAuth } from '../../context/AuthContext';
import { getWorkspace, updateWorkspace, type Workspace } from '../../services/workspaceService';

export default function WorkspaceSettings() {
  const { id } = useParams<{ id: string }>();
  const { accessToken } = useAuth();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!id) return;
    getWorkspace(accessToken, id).then(setWorkspace).catch(console.error);
  }, [id, accessToken]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id || !workspace) return;
    setSaving(true);
    try {
      const updated = await updateWorkspace(accessToken, id, workspace);
      setWorkspace(updated);
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  if (!workspace) return <div className="min-h-screen bg-slate-900 text-white p-8">Loading…</div>;

  return (
    <div className="min-h-screen bg-slate-900 text-white p-8">
      <div className="max-w-xl mx-auto">
        <Link to={`/workspaces/${id}/dashboard`} className="text-slate-400 text-sm hover:text-white">← Back to dashboard</Link>
        <h1 className="text-2xl font-bold mt-4 mb-6">Workspace Settings</h1>

        <form onSubmit={handleSave} className="space-y-4">
          {(['name', 'legal_entity_name', 'trn_number', 'country', 'currency', 'industry'] as const).map((field) => (
            <div key={field}>
              <label className="block text-sm text-slate-300 mb-1 capitalize">{field.replace(/_/g, ' ')}</label>
              <input
                className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm"
                value={(workspace[field] as string) ?? ''}
                onChange={(e) => setWorkspace({ ...workspace, [field]: e.target.value })}
              />
            </div>
          ))}
          <button
            type="submit"
            disabled={saving}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </form>

        {workspace.vat_settings && (
          <div className="mt-8 rounded-xl border border-slate-700 p-5">
            <h2 className="font-semibold mb-3">VAT Settings</h2>
            <div className="text-sm text-slate-400 space-y-1">
              <p>Entity type: {workspace.vat_settings.entity_type}</p>
              <p>VAT registered: {workspace.vat_settings.vat_registered ? 'Yes' : 'No'}</p>
              <p>Standard rate: {workspace.vat_settings.standard_rate}%</p>
              <p>Filing: {workspace.vat_settings.filing_frequency}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
