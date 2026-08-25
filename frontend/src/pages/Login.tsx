import { FormEvent, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import { useAuth } from '../context/AuthContext';
import { useMarket } from '../contexts/MarketContext';
import type { Market } from '../lib/ap-invoice/marketConfig';
import { loginRedirectFor, normalizeProductRole, isUaeProductRole, uaeHubPath, type ProductRole } from '../config/productRole';

/** Never resume the old module-picker after login. */
function normalizePostLoginPath(path: string | undefined): string | undefined {
  if (!path || path === '/company-setup' || path.startsWith('/login')) return undefined;
  if (path === '/uae-select' || path.startsWith('/uae-select/')) return '/dashboard';
  return path;
}

function resolvePostLoginPath(
  from: string | undefined,
  productRole: ProductRole,
  market: Market,
): string {
  const resume = normalizePostLoginPath(from);
  if (resume) return resume;
  // Always land on AP for the market chosen on the login screen
  if (market === 'india' || market === 'uae') return '/ap-invoices';
  if (isUaeProductRole(productRole)) return uaeHubPath();
  return loginRedirectFor(productRole);
}

export default function Login() {
  const nav = useNavigate();
  const location = useLocation();
  const { login } = useAuth();
  const { isUAE, setMarket } = useMarket();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Pre-select whatever the last session used, so returning users aren't
  // reset to UAE every time.
  const [country, setCountry] = useState<Market>(isUAE ? 'uae' : 'india');

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      // Persist the login-screen choice BEFORE calling login(): login()
      // internally pins a market based on the account's product_role
      // (pinUaeSuiteMarket / pinIndiaSuiteMarket in AuthContext), and that
      // pin logic checks whether the user has already made an explicit
      // choice this session — so the flag has to be set first, or the
      // login-time auto-pin fires and silently reverts this selection.
      await setMarket(country);
      const loggedIn = await login(email, password);
      const from = (location.state as { from?: string } | null)?.from;
      const role = normalizeProductRole(loggedIn.product_role);
      nav(resolvePostLoginPath(from, role, country), { replace: true });
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      try {
        const parsed = JSON.parse(raw) as { detail?: string };
        setError(parsed.detail ?? raw);
      } catch {
        setError(raw);
      }
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

        <div>
          <span className="block text-sm text-slate-300 mb-1.5">Country</span>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setCountry('uae')}
              className={`flex items-center justify-center gap-2 rounded border py-2 text-sm font-medium transition-colors ${
                country === 'uae'
                  ? 'border-blue-500 bg-blue-500/10 text-white'
                  : 'border-slate-700 bg-slate-950 text-slate-400 hover:border-slate-600'
              }`}
            >
              🇦🇪 UAE
            </button>
            <button
              type="button"
              onClick={() => setCountry('india')}
              className={`flex items-center justify-center gap-2 rounded border py-2 text-sm font-medium transition-colors ${
                country === 'india'
                  ? 'border-orange-500 bg-orange-500/10 text-white'
                  : 'border-slate-700 bg-slate-950 text-slate-400 hover:border-slate-600'
              }`}
            >
              🇮🇳 India
            </button>
          </div>
          <p className="text-xs text-slate-500 mt-1.5">You can switch this anytime from the header after signing in.</p>
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

        <div className="text-center">
          <Link className="text-slate-400 hover:text-slate-200 text-sm" to="/forgot-password">Forgot password?</Link>
        </div>

        <div className="border-t border-slate-700 pt-4 text-center">
          <p className="text-slate-400 text-sm mb-2">New client? Set up their workspace here.</p>
          <button
            type="button"
            onClick={() => nav('/register')}
            className="w-full rounded border border-blue-500 py-2 text-sm font-medium text-blue-400 hover:bg-blue-500 hover:text-white transition-colors"
          >
            Create a free account
          </button>
        </div>
      </form>
    </div>
  );
}
