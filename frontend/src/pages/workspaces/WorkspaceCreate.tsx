import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useAuth } from '../../context/AuthContext';
import { useWorkspace } from '../../context/WorkspaceContext';
import { createWorkspace, setStoredWorkspaceId } from '../../services/workspaceService';
import { ensureApCompanySynced, setApSyncAccessToken } from '../../lib/ap-invoice/workspaceCompanySync';
import { clearCompanyCache } from '../../lib/ap-invoice/companyService';

const INDUSTRIES = ['Trading', 'Construction', 'Retail', 'Hospitality', 'Professional Services', 'Manufacturing', 'Logistics', 'Real Estate'];

export default function WorkspaceCreate() {
  const { accessToken, isAuthenticated, bootstrapping } = useAuth();
  const { refreshWorkspaces } = useWorkspace();
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!bootstrapping && !isAuthenticated) {
      navigate('/login', { replace: true, state: { from: '/workspaces/create' } });
    }
  }, [bootstrapping, isAuthenticated, navigate]);
  const [form, setForm] = useState({
    name: '',
    legal_entity_name: '',
    trn_number: '',
    country: 'UAE',
    currency: 'AED',
    fiscal_year_start_month: 1,
    fiscal_year_end_month: 12,
    industry: 'Trading',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accessToken) {
      navigate('/login', { replace: true, state: { from: '/workspaces/create' } });
      return;
    }
    setSaving(true);
    try {
      const ws = await createWorkspace(accessToken, form);
      setStoredWorkspaceId(ws.id);
      setApSyncAccessToken(accessToken);
      await ensureApCompanySynced(accessToken);
      clearCompanyCache();
      await refreshWorkspaces();
      navigate(`/workspaces/${ws.id}/dashboard`);
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  if (bootstrapping) {
    return <div className="min-h-screen bg-slate-900 text-white p-8">Checking session…</div>;
  }

  return (
    <div className="min-h-screen bg-slate-900 text-white p-8">
      <div className="max-w-xl mx-auto">
        <h1 className="text-2xl font-bold mb-2">Create Workspace</h1>
        <p className="text-slate-400 text-sm mb-8">
          A new UAE Chart of Accounts and VAT settings will be generated automatically.
        </p>

        <form onSubmit={handleSubmit} className="space-y-5">
          <Field label="Workspace Name" required>
            <input
              className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="ABC Trading LLC"
              required
            />
          </Field>

          <Field label="Legal Entity Name" required>
            <input
              className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm"
              value={form.legal_entity_name}
              onChange={(e) => setForm({ ...form, legal_entity_name: e.target.value })}
              placeholder="ABC Trading LLC"
              required
            />
          </Field>

          <Field label="TRN Number">
            <input
              className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm"
              value={form.trn_number}
              onChange={(e) => setForm({ ...form, trn_number: e.target.value })}
              placeholder="100123456700003"
              maxLength={15}
            />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Country">
              <select
                className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm"
                value={form.country}
                onChange={(e) => setForm({ ...form, country: e.target.value })}
              >
                <option value="UAE">UAE</option>
                <option value="KSA">KSA</option>
                <option value="Qatar">Qatar</option>
                <option value="Bahrain">Bahrain</option>
                <option value="Oman">Oman</option>
              </select>
            </Field>
            <Field label="Base Currency">
              <select
                className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm"
                value={form.currency}
                onChange={(e) => setForm({ ...form, currency: e.target.value })}
              >
                <option value="AED">AED</option>
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
                <option value="SAR">SAR</option>
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Fiscal Year Start (month)">
              <select
                className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm"
                value={form.fiscal_year_start_month}
                onChange={(e) => setForm({ ...form, fiscal_year_start_month: Number(e.target.value) })}
              >
                {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </select>
            </Field>
            <Field label="Fiscal Year End (month)">
              <select
                className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm"
                value={form.fiscal_year_end_month}
                onChange={(e) => setForm({ ...form, fiscal_year_end_month: Number(e.target.value) })}
              >
                {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </select>
            </Field>
          </div>

          <Field label="Industry">
            <select
              className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm"
              value={form.industry}
              onChange={(e) => setForm({ ...form, industry: e.target.value })}
            >
              {INDUSTRIES.map((ind) => <option key={ind} value={ind}>{ind}</option>)}
            </select>
          </Field>

          <div className="flex gap-3 pt-4">
            <button
              type="submit"
              disabled={saving}
              className="px-6 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-medium disabled:opacity-50"
            >
              {saving ? 'Creating…' : 'Create Workspace'}
            </button>
            <button
              type="button"
              onClick={() => navigate('/workspaces')}
              className="px-6 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm text-slate-300 mb-1.5">
        {label}{required && <span className="text-red-400 ml-1">*</span>}
      </label>
      {children}
    </div>
  );
}
