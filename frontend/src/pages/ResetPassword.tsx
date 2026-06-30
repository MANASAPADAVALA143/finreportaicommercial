import { FormEvent, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';

import { backendOrigin } from '../utils/backendOrigin';

export default function ResetPassword() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    if (!token) {
      setError('Invalid reset link — request a new one from the login page.');
      return;
    }
    setLoading(true);
    try {
      const base = backendOrigin();
      const res = await fetch(`${base}/api/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, new_password: password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          typeof data.detail === 'string' ? data.detail : 'Failed to reset password',
        );
      }
      setMessage(data.message ?? 'Password updated. Redirecting to login…');
      setTimeout(() => navigate('/login', { replace: true }), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-xl p-6 text-center space-y-4">
          <p className="text-red-400 text-sm">Invalid or missing reset link.</p>
          <Link to="/forgot-password" className="text-blue-400 hover:text-blue-300 text-sm">Request a new link</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <form onSubmit={onSubmit} className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-white">Set new password</h1>
          <p className="text-slate-400 text-sm mt-1">Choose a new password for your account</p>
        </div>

        <label className="block text-sm text-slate-300">
          New password
          <div className="mt-1 relative">
            <input
              className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-white pr-10"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type={showPwd ? 'text' : 'password'}
              required
              minLength={8}
              autoComplete="new-password"
            />
            <button type="button" className="absolute right-2 top-2 text-slate-400" onClick={() => setShowPwd((x) => !x)}>
              {showPwd ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
        </label>

        <label className="block text-sm text-slate-300">
          Confirm password
          <input
            className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-white"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
          />
        </label>

        {error && <p className="text-sm text-red-400">{error}</p>}
        {message && <p className="text-sm text-green-400">{message}</p>}

        <button
          disabled={loading || !!message}
          className="w-full rounded bg-blue-600 py-2 text-white font-medium hover:bg-blue-500 disabled:opacity-50"
          type="submit"
        >
          {loading ? 'Updating…' : 'Update password'}
        </button>

        <div className="text-center text-sm">
          <Link to="/login" className="text-blue-400 hover:text-blue-300">← Back to sign in</Link>
        </div>
      </form>
    </div>
  );
}
