import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, X } from 'lucide-react';
import * as api from '../../services/reraApi';
import type { RERAProject } from '../../services/reraApi';
import { useReraData, AED, DemoBadge, PageHeader, GoldButton, Table, EmptyRow, StatusBadge, SURFACE, BORDER, MUTED, GOLD } from './shared';

const DEMO_PROJECTS: RERAProject[] = [
  {
    id: 'demo-1', workspace_id: '', name: 'Marina Heights', rera_number: 'RERA-DXB-0142',
    location: 'Dubai Marina', total_units: 220, total_project_cost: 320_000_000, total_collections_target: 320_000_000,
    escrow_percentage: 70, construction_progress: 42, utilization_percentage: 30,
    escrow_balance: 180_000_000, withdrawn: 60_000_000, total_collected: 240_000_000,
    start_date: '2025-01-10', completion_date: '2027-06-30', status: 'active',
    developer_pan: null, promoter_din: null, gstin: null, trn_number: null, qpr_deadline: '2026-09-30',
    currency: 'AED', created_at: null,
  },
  {
    id: 'demo-2', workspace_id: '', name: 'Downtown Tower B', rera_number: 'RERA-DXB-0198',
    location: 'Downtown Dubai', total_units: 340, total_project_cost: 540_000_000, total_collections_target: 540_000_000,
    escrow_percentage: 70, construction_progress: 68, utilization_percentage: 55,
    escrow_balance: 150_000_000, withdrawn: 90_000_000, total_collected: 240_000_000,
    start_date: '2024-03-01', completion_date: '2026-12-31', status: 'active',
    developer_pan: null, promoter_din: null, gstin: null, trn_number: null, qpr_deadline: '2026-09-30',
    currency: 'AED', created_at: null,
  },
];

export default function RERAProjects() {
  const navigate = useNavigate();
  const projects = useReraData(async () => (await api.listProjects()).projects, DEMO_PROJECTS, (d) => d.length === 0);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    name: '', rera_number: '', location: '', total_project_cost: '', start_date: '', completion_date: '', currency: 'AED',
  });

  const handleCreate = async () => {
    setSaving(true);
    setError('');
    try {
      await api.createProject({
        name: form.name,
        rera_number: form.rera_number,
        location: form.location || undefined,
        total_project_cost: form.total_project_cost ? Number(form.total_project_cost) : undefined,
        start_date: form.start_date || undefined,
        completion_date: form.completion_date || undefined,
        currency: form.currency,
      });
      setModalOpen(false);
      setForm({ name: '', rera_number: '', location: '', total_project_cost: '', start_date: '', completion_date: '', currency: 'AED' });
      projects.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Projects"
        subtitle={`${projects.data.length} project(s)`}
        action={
          <GoldButton onClick={() => setModalOpen(true)}>
            <span className="flex items-center gap-2"><Plus size={14} /> New Project</span>
          </GoldButton>
        }
      />

      <Table headers={['Project Name', 'Location', 'Total Budget', 'Escrow Balance', 'Progress', 'Status', '']}>
        {projects.data.length === 0 ? (
          <EmptyRow colSpan={7} text="No projects yet — create one to get started." />
        ) : (
          projects.data.map((p) => (
            <tr
              key={p.id}
              className="border-b cursor-pointer hover:bg-white/5"
              style={{ borderColor: BORDER }}
              onClick={() => navigate(`/real-estate/projects/${p.id}`)}
            >
              <td className="px-4 py-3 font-medium">{p.name}</td>
              <td className="px-4 py-3" style={{ color: MUTED }}>{p.location || '—'}</td>
              <td className="px-4 py-3">{AED(p.total_project_cost)}</td>
              <td className="px-4 py-3">{AED(p.escrow_balance)}</td>
              <td className="px-4 py-3">{p.construction_progress}%</td>
              <td className="px-4 py-3"><StatusBadge status={p.status} /></td>
              <td className="px-4 py-3 text-right" style={{ color: GOLD }}>View →</td>
            </tr>
          ))
        )}
      </Table>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-xl border p-6" style={{ background: SURFACE, borderColor: BORDER }}>
            <div className="flex items-center justify-between mb-4">
              <p className="font-semibold">New Project</p>
              <button type="button" onClick={() => setModalOpen(false)}><X size={18} /></button>
            </div>
            {error && <p className="text-xs text-red-400 mb-3">{error}</p>}
            <div className="space-y-3">
              {[
                { key: 'name', label: 'Project name', type: 'text' },
                { key: 'rera_number', label: 'RERA number', type: 'text' },
                { key: 'location', label: 'Location', type: 'text' },
                { key: 'total_project_cost', label: 'Total budget (AED)', type: 'number' },
                { key: 'start_date', label: 'Start date', type: 'date' },
                { key: 'completion_date', label: 'End date', type: 'date' },
              ].map((f) => (
                <div key={f.key}>
                  <label className="text-xs" style={{ color: MUTED }}>{f.label}</label>
                  <input
                    type={f.type}
                    value={(form as Record<string, string>)[f.key]}
                    onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                    className="w-full mt-1 px-3 py-2 rounded-lg border bg-transparent text-sm text-white"
                    style={{ borderColor: BORDER }}
                  />
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button type="button" onClick={() => setModalOpen(false)} className="px-4 py-2 text-sm" style={{ color: MUTED }}>
                Cancel
              </button>
              <GoldButton onClick={() => void handleCreate()} disabled={saving || !form.name || !form.rera_number}>
                {saving ? 'Saving…' : 'Create Project'}
              </GoldButton>
            </div>
          </div>
        </div>
      )}

      <DemoBadge show={projects.isDemo} />
    </div>
  );
}
