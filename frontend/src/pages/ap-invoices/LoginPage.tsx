/**
 * Login page â€” email + password via Supabase Auth.
 * After login redirects to /dashboard (or the page they tried to reach).
 */
import { useState } from 'react';
import { useNavigate, Link, useLocation } from 'react-router-dom';
import { signInWithEmail } from '../../lib/ap-invoice/authService';
import { supabase } from '../../lib/ap-invoice/supabase';

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/dashboard';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Forgot password state
  const [forgotMode, setForgotMode] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetLoading, setResetLoading] = useState(false);
  const [resetMessage, setResetMessage] = useState('');
  const [resetError, setResetError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await signInWithEmail(email.trim(), password);
      navigate(from, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed. Check your credentials.');
    } finally {
      setLoading(false);
    }
  }

  async function handleForgotPassword(e: React.FormEvent) {
    e.preventDefault();
    setResetError('');
    setResetMessage('');
    setResetLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(resetEmail.trim(), {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw error;
      setResetMessage('Password reset link sent! Check your inbox.');
    } catch (err) {
      setResetError(err instanceof Error ? err.message : 'Failed to send reset email.');
    } finally {
      setResetLoading(false);
    }
  }

  if (forgotMode) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-lg p-8 w-full max-w-sm">
          <div className="flex items-center gap-3 mb-8">
            <div className="bg-[#1a56db] rounded-xl p-2.5">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <div>
              <div className="font-bold text-gray-900 text-lg leading-tight">InvoiceFlow</div>
              <div className="text-xs text-gray-500">AP Automation</div>
            </div>
          </div>

          <h1 className="text-xl font-bold text-gray-900 mb-1">Reset password</h1>
          <p className="text-sm text-gray-500 mb-6">Enter your email and we'll send you a reset link.</p>

          {resetMessage ? (
            <div className="space-y-4">
              <div className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-3">
                âœ… {resetMessage}
              </div>
              <button
                type="button"
                onClick={() => { setForgotMode(false); setResetMessage(''); }}
                className="w-full text-sm text-[#1a56db] font-medium hover:underline"
              >
                â† Back to sign in
              </button>
            </div>
          ) : (
            <form onSubmit={handleForgotPassword} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                <input
                  type="email"
                  required
                  autoComplete="email"
                  value={resetEmail}
                  onChange={(e) => setResetEmail(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="you@company.com"
                />
              </div>

              {resetError && (
                <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  {resetError}
                </div>
              )}

              <button
                type="submit"
                disabled={resetLoading}
                className="w-full bg-[#1a56db] text-white font-semibold rounded-lg py-2.5 text-sm hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
              >
                {resetLoading ? 'Sendingâ€¦' : 'Send reset link'}
              </button>

              <button
                type="button"
                onClick={() => setForgotMode(false)}
                className="w-full text-sm text-gray-500 hover:text-gray-700"
              >
                â† Back to sign in
              </button>
            </form>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-lg p-8 w-full max-w-sm">
        {/* Logo */}
        <div className="flex items-center gap-3 mb-8">
          <div className="bg-[#1a56db] rounded-xl p-2.5">
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <div>
            <div className="font-bold text-gray-900 text-lg leading-tight">InvoiceFlow</div>
            <div className="text-xs text-gray-500">AP Automation</div>
          </div>
        </div>

        <h1 className="text-xl font-bold text-gray-900 mb-1">Sign in</h1>
        <p className="text-sm text-gray-500 mb-6">Enter your email and password to continue.</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="you@company.com"
            />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-sm font-medium text-gray-700">Password</label>
              <button
                type="button"
                onClick={() => { setForgotMode(true); setResetEmail(email); }}
                className="text-xs text-[#1a56db] hover:underline font-medium"
              >
                Forgot password?
              </button>
            </div>
            <input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢"
            />
          </div>

          {error && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-[#1a56db] text-white font-semibold rounded-lg py-2.5 text-sm hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? 'Signing inâ€¦' : 'Sign in'}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-gray-500">
          No account?{' '}
          <Link to="/signup" className="text-[#1a56db] font-medium hover:underline">
            Create one
          </Link>
        </p>
      </div>
    </div>
  );
}

