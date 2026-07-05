import { FormEvent, useEffect, useMemo, useState } from 'react';

import { useAuth } from '../context/AuthContext';
import type { ProductRole } from '../config/productRole';

type Role = 'cfo' | 'finance_manager' | 'accountant' | 'auditor' | 'super_admin';

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: Role;
  product_role: ProductRole;
  is_active: boolean;
  last_login: string | null;
}

interface AuditRow {
  id: string;
  user_id: string;
  action: string;
  module: string;
  timestamp: string;
  ip_address?: string;
}

export default function UserManagement() {
  const { authFetch, user } = useAuth();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [activeTab, setActiveTab] = useState<'users' | 'audit'>('users');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('Temp@123');
  const [role, setRole] = useState<Role>('accountant');
  const [companyInfo, setCompanyInfo] = useState<{ name: string; plan: string; users_count: number } | null>(null);

  const loadUsers = async () => {
    const r = await authFetch('/api/users');
    if (r.ok) {
      const j = await r.json();
      setUsers(j.items || []);
    }
  };

  const loadAudit = async () => {
    const r = await authFetch('/api/users/audit-log');
    if (r.ok) {
      const j = await r.json();
      setAudit(j.items || []);
    }
  };

  const loadCompany = async () => {
    const r = await authFetch('/api/users/company');
    if (r.ok) setCompanyInfo(await r.json());
  };

  useEffect(() => {
    void loadUsers();
    void loadAudit();
    void loadCompany();
  }, []);

  const onAdd = async (e: FormEvent) => {
    e.preventDefault();
    const r = await authFetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password, role }),
    });
    if (r.ok) {
      setName('');
      setEmail('');
      setPassword('Temp@123');
      setRole('accountant');
      await loadUsers();
      await loadCompany();
    }
  };

  const updateRole = async (u: UserRow, nextRole: Role) => {
    await authFetch(`/api/users/${u.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: nextRole }),
    });
    await loadUsers();
  };

  const updateProductRole = async (u: UserRow, next: ProductRole) => {
    await authFetch(`/api/users/${u.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ product_role: next }),
    });
    await loadUsers();
  };

  const deactivate = async (u: UserRow) => {
    await authFetch(`/api/users/${u.id}`, { method: 'DELETE' });
    await loadUsers();
    await loadCompany();
  };

  const csv = useMemo(() => {
    const hdr = 'User,Action,Module,Time,IP\n';
    return (
      hdr +
      audit
        .map((a) => `${a.user_id},${a.action},${a.module},${a.timestamp},${a.ip_address ?? ''}`)
        .join('\n')
    );
  }, [audit]);

  if (user?.role !== 'super_admin') {
    return <div className="p-8 text-slate-300">Only Super Admin can access User Management.</div>;
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6 space-y-6">
      <h1 className="text-2xl font-bold">User Management</h1>

      <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
        <h2 className="font-semibold text-white mb-2">Company Info</h2>
        <p className="text-sm text-slate-300">Name: {companyInfo?.name || '-'}</p>
        <p className="text-sm text-slate-300">Plan: {companyInfo?.plan || '-'}</p>
        <p className="text-sm text-slate-300">Users: {companyInfo?.users_count || 0}</p>
      </div>

      <div className="flex gap-2">
        <button className={`px-3 py-1.5 rounded ${activeTab === 'users' ? 'bg-blue-600' : 'bg-slate-800'}`} onClick={() => setActiveTab('users')}>Users</button>
        <button className={`px-3 py-1.5 rounded ${activeTab === 'audit' ? 'bg-blue-600' : 'bg-slate-800'}`} onClick={() => setActiveTab('audit')}>Audit Trail</button>
      </div>

      {activeTab === 'users' && (
        <>
          <form onSubmit={onAdd} className="grid md:grid-cols-5 gap-2 rounded-lg border border-slate-800 bg-slate-900 p-3">
            <input className="rounded bg-slate-950 border border-slate-700 px-2 py-1" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} required />
            <input className="rounded bg-slate-950 border border-slate-700 px-2 py-1" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            <input className="rounded bg-slate-950 border border-slate-700 px-2 py-1" placeholder="Temp password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            <select className="rounded bg-slate-950 border border-slate-700 px-2 py-1" value={role} onChange={(e) => setRole(e.target.value as Role)}>
              <option value="cfo">CFO</option>
              <option value="finance_manager">Finance Manager</option>
              <option value="accountant">Accountant</option>
              <option value="auditor">Auditor</option>
            </select>
            <button className="rounded bg-emerald-600 px-3 py-1 text-white" type="submit">Add User</button>
          </form>

          <div className="overflow-x-auto rounded-lg border border-slate-800">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-900">
                <tr>
                  <th className="text-left p-2">Name</th>
                  <th className="text-left p-2">Email</th>
                  <th className="text-left p-2">Role</th>
                  <th className="text-left p-2">Product Access</th>
                  <th className="text-left p-2">Status</th>
                  <th className="text-left p-2">Last Login</th>
                  <th className="text-left p-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-t border-slate-800">
                    <td className="p-2">{u.name}</td>
                    <td className="p-2">{u.email}</td>
                    <td className="p-2">
                      <select className="rounded bg-slate-950 border border-slate-700 px-2 py-1" value={u.role} onChange={(e) => void updateRole(u, e.target.value as Role)}>
                        <option value="super_admin">Super Admin</option>
                        <option value="cfo">CFO</option>
                        <option value="finance_manager">Finance Manager</option>
                        <option value="accountant">Accountant</option>
                        <option value="auditor">Auditor</option>
                      </select>
                    </td>
                    <td className="p-2">
                      <select
                        className="rounded bg-slate-950 border border-slate-700 px-2 py-1"
                        value={u.product_role}
                        onChange={(e) => void updateProductRole(u, e.target.value as ProductRole)}
                      >
                        <option value="full_access">Full Access</option>
                        <option value="uae_client">UAE Client</option>
                        <option value="uae_suite">UAE Finance Suite</option>
                        <option value="uae_full">UAE Full</option>
                        <option value="india_client">India Client</option>
                      </select>
                    </td>
                    <td className="p-2">{u.is_active ? 'Active' : 'Inactive'}</td>
                    <td className="p-2">{u.last_login || '-'}</td>
                    <td className="p-2">
                      <button className="text-red-300 hover:text-red-200" onClick={() => void deactivate(u)}>Deactivate</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {activeTab === 'audit' && (
        <div className="space-y-3">
          <a
            className="inline-block rounded bg-slate-800 px-3 py-1.5 text-sm"
            href={`data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`}
            download="audit-log.csv"
          >
            Export CSV
          </a>
          <div className="overflow-x-auto rounded-lg border border-slate-800">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-900">
                <tr>
                  <th className="text-left p-2">User</th>
                  <th className="text-left p-2">Action</th>
                  <th className="text-left p-2">Module</th>
                  <th className="text-left p-2">Time</th>
                  <th className="text-left p-2">IP</th>
                </tr>
              </thead>
              <tbody>
                {audit.map((a) => (
                  <tr key={a.id} className="border-t border-slate-800">
                    <td className="p-2">{a.user_id}</td>
                    <td className="p-2">{a.action}</td>
                    <td className="p-2">{a.module}</td>
                    <td className="p-2">{a.timestamp}</td>
                    <td className="p-2">{a.ip_address || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
