import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';

import { backendOrigin } from '../utils/backendOrigin';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [devLink, setDevLink] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setDevLink(null);
    setLoading(true);
    try {
      const base = backendOrigin();
      const res = await fetch(`${base}/api/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          typeof data.detail === 'string' ? data.detail : 'Failed to send reset link',
        );
      }
      setMessage(data.message ?? 'If that email is registered, a reset link has been sent.');
      if (data.reset_link) setDevLink(data.reset_link);
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
          <h1 className="text-2xl font-bold text-white">Reset password</h1>
          <p className="text-slate-400 text-sm mt-1">Enter your email and we&apos;ll send a reset link</p>
        </div>

        <label className="block text-sm text-slate-300">
          Email
          <input
            className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-white"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            required
            autoComplete="email"
          />
        </label>

        {error && <p className="text-sm text-red-400">{error}</p>}
        {message && (
          <div className="text-sm text-green-400 bg-green-950/40 border border-green-800 rounded-lg px-3 py-2">
            {message}
          </div>
        )}
        {devLink && (
          <div className="text-xs text-slate-400 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 break-all">
            <p className="text-slate-300 mb-1">Dev mode — reset link:</p>
            <a href={devLink} className="text-blue-400 hover:underline">{devLink}</a>
          </div>
        )}

        <button
          disabled={loading}
          className="w-full rounded bg-blue-600 py-2 text-white font-medium hover:bg-blue-500 disabled:opacity-50"
          type="submit"
        >
          {loading ? 'Sending…' : 'Send reset link'}
        </button>

        <div className="text-center text-sm">
          <Link to="/login" className="text-blue-400 hover:text-blue-300">← Back to sign in</Link>
        </div>
      </form>
    </div>
  );
}
