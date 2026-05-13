import { FormEvent, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { useAuth } from '../context/AuthContext';

export default function Login() {
  const nav = useNavigate();
  const { login } = useAuth();
  const [email, setEmail] = useState('admin@gnanova.com');
  const [password, setPassword] = useState('Admin@123');
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(email, password);
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
        <div className="text-center">
          <h1 className="text-2xl font-bold text-white">FinReportAI</h1>
          <p className="text-slate-400 text-sm mt-1">Sign in to your workspace</p>
        </div>

        <label className="block text-sm text-slate-300">
          Email
          <input className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-white" value={email} onChange={(e) => setEmail(e.target.value)} type="email" required />
        </label>

        <label className="block text-sm text-slate-300">
          Password
          <div className="mt-1 relative">
            <input className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-white pr-10" value={password} onChange={(e) => setPassword(e.target.value)} type={showPwd ? 'text' : 'password'} required />
            <button type="button" className="absolute right-2 top-2 text-slate-400" onClick={() => setShowPwd((x) => !x)}>
              {showPwd ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
        </label>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <button disabled={loading} className="w-full rounded bg-blue-600 py-2 text-white font-medium hover:bg-blue-500 disabled:opacity-50" type="submit">
          {loading ? 'Signing in...' : 'Sign In'}
        </button>

        <div className="flex justify-between text-sm">
          <a className="text-slate-400 hover:text-slate-200" href="#">Forgot password?</a>
          <button className="text-blue-400 hover:text-blue-300" type="button" onClick={() => nav('/register')}>
            Create account
          </button>
        </div>
      </form>
    </div>
  );
}
