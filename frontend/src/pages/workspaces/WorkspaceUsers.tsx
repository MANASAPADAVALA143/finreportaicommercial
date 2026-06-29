import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { useAuth } from '../../context/AuthContext';
import { listWorkspaceMembers, type WorkspaceMember } from '../../services/workspaceService';

const ROLE_LABELS: Record<string, string> = {
  owner: 'Workspace Owner',
  finance_manager: 'Finance Manager',
  accountant: 'Accountant',
  auditor: 'Auditor',
  viewer: 'Viewer',
};

export default function WorkspaceUsers() {
  const { id } = useParams<{ id: string }>();
  const { accessToken } = useAuth();
  const [members, setMembers] = useState<WorkspaceMember[]>([]);

  useEffect(() => {
    if (!id) return;
    listWorkspaceMembers(accessToken, id).then(setMembers).catch(console.error);
  }, [id, accessToken]);

  return (
    <div className="min-h-screen bg-slate-900 text-white p-8">
      <div className="max-w-3xl mx-auto">
        <Link to={`/workspaces/${id}/dashboard`} className="text-slate-400 text-sm hover:text-white">← Back to dashboard</Link>
        <h1 className="text-2xl font-bold mt-4 mb-2">Workspace Users</h1>
        <p className="text-slate-400 text-sm mb-6">Permissions are workspace-specific.</p>

        <div className="rounded-xl border border-slate-700 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-800 text-slate-400">
              <tr>
                <th className="text-left px-4 py-3">Name</th>
                <th className="text-left px-4 py-3">Email</th>
                <th className="text-left px-4 py-3">Role</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id} className="border-t border-slate-700">
                  <td className="px-4 py-3">{m.name}</td>
                  <td className="px-4 py-3 text-slate-400">{m.email}</td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-0.5 rounded bg-blue-900/50 text-blue-300 text-xs">
                      {ROLE_LABELS[m.role] ?? m.role}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {members.length === 0 && (
            <div className="text-center py-8 text-slate-500">No members found.</div>
          )}
        </div>
      </div>
    </div>
  );
}
