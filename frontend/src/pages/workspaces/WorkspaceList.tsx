import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Building2, Plus, Settings, Users, BarChart3 } from 'lucide-react';

import { useAuth } from '../../context/AuthContext';
import { useWorkspace } from '../../context/WorkspaceContext';
import { seedAbcTrading } from '../../services/workspaceService';

export default function WorkspaceList() {
  const { accessToken, isAuthenticated, bootstrapping } = useAuth();
  const { workspaces, activeWorkspace, refreshWorkspaces, switchWorkspace } = useWorkspace();
  const [seeding, setSeeding] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (!bootstrapping && !isAuthenticated) {
      navigate('/login', { replace: true, state: { from: '/workspaces' } });
    }
  }, [bootstrapping, isAuthenticated, navigate]);

  useEffect(() => { if (isAuthenticated) refreshWorkspaces(); }, [refreshWorkspaces, isAuthenticated]);

  if (bootstrapping) {
    return <div className="min-h-screen bg-slate-900 text-white p-8">Checking session…</div>;
  }

  const handleSeed = async () => {
    setSeeding(true);
    try {
      const result = await seedAbcTrading(accessToken);
      await refreshWorkspaces();
      navigate(`/workspaces/${result.workspace_id}/dashboard`);
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setSeeding(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 text-white p-8">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Building2 className="text-blue-400" />
              Client Workspaces
            </h1>
            <p className="text-slate-400 text-sm mt-1">
              Each workspace is an isolated UAE accounting environment for one legal entity.
            </p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={handleSeed}
              disabled={seeding}
              className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm disabled:opacity-50"
            >
              {seeding ? 'Seeding…' : 'Seed ABC Trading LLC'}
            </button>
            <Link
              to="/workspaces/create"
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm flex items-center gap-2"
            >
              <Plus size={16} />
              Create Workspace
            </Link>
          </div>
        </div>

        <div className="grid gap-4">
          {workspaces.map((ws) => (
            <div
              key={ws.id}
              className={`rounded-xl border p-5 ${
                ws.id === activeWorkspace?.id
                  ? 'border-blue-500 bg-blue-950/30'
                  : 'border-slate-700 bg-slate-800/50'
              }`}
            >
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-lg font-semibold">{ws.name}</h2>
                  <p className="text-slate-400 text-sm">{ws.legal_entity_name}</p>
                  <div className="flex gap-4 mt-2 text-xs text-slate-500">
                    <span>{ws.country}</span>
                    <span>{ws.currency}</span>
                    {ws.trn_number && <span>TRN: {ws.trn_number}</span>}
                    {ws.industry && <span>{ws.industry}</span>}
                    {ws.role && <span className="text-blue-400 capitalize">{ws.role.replace('_', ' ')}</span>}
                  </div>
                </div>
                <div className="flex gap-2">
                  {ws.id !== activeWorkspace?.id && (
                    <button
                      onClick={() => switchWorkspace(ws)}
                      className="px-3 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 rounded"
                    >
                      Switch
                    </button>
                  )}
                  <Link
                    to={`/workspaces/${ws.id}/dashboard`}
                    className="px-3 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 rounded flex items-center gap-1"
                  >
                    <BarChart3 size={12} /> Dashboard
                  </Link>
                  <Link
                    to={`/workspaces/${ws.id}/settings`}
                    className="px-3 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 rounded flex items-center gap-1"
                  >
                    <Settings size={12} /> Settings
                  </Link>
                  <Link
                    to={`/workspaces/${ws.id}/users`}
                    className="px-3 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 rounded flex items-center gap-1"
                  >
                    <Users size={12} /> Users
                  </Link>
                </div>
              </div>
            </div>
          ))}
          {workspaces.length === 0 && (
            <div className="text-center py-16 text-slate-500">
              No workspaces yet. Create one or seed the ABC Trading LLC demo.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
