import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useAuth } from '../context/AuthContext';

export default function Register() {
  const nav = useNavigate();
  const { register } = useAuth();
  const [companyName, setCompanyName] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }
    setLoading(true);
    try {
      await register({ company_name: companyName, name, email, password });
      nav('/dashboard', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <form onSubmit={onSubmit} className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
        <h1 className="text-2xl font-bold text-white text-center">Create Account</h1>

        <label className="block text-sm text-slate-300">Company name
          <input className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-white" value={companyName} onChange={(e) => setCompanyName(e.target.value)} required />
        </label>
        <label className="block text-sm text-slate-300">Your name
          <input className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-white" value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label className="block text-sm text-slate-300">Email
          <input className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-white" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label className="block text-sm text-slate-300">Password
          <input className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-white" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        <label className="block text-sm text-slate-300">Confirm password
          <input className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-white" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
        </label>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <button disabled={loading} className="w-full rounded bg-blue-600 py-2 text-white font-medium hover:bg-blue-500 disabled:opacity-50" type="submit">
          {loading ? 'Creating...' : 'Create Account'}
        </button>

        <button type="button" className="w-full text-slate-400 hover:text-slate-200 text-sm" onClick={() => nav('/login')}>
          Back to login
        </button>
      </form>
    </div>
  );
}
