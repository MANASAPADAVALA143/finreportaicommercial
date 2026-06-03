import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Sidebar from '../../components/layout/Sidebar';
import toast from 'react-hot-toast';
import { getQBOAuthUrl } from '../../services/uaeAccounting.service';

export default function QBOConnect() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);

  const handleConnect = async () => {
    setLoading(true);
    try {
      const { auth_url } = await getQBOAuthUrl();
      window.location.href = auth_url;
    } catch (e: any) {
      toast.error(e.message);
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen bg-slate-900">
      <Sidebar />
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-lg">
          <button
            onClick={() => navigate('/uae-accounting')}
            className="text-slate-400 hover:text-white text-sm mb-6 flex items-center gap-1"
          >
            ← Back to UAE Accounting
          </button>

          <div className="bg-slate-800 rounded-2xl border border-slate-700 p-8">
            {/* Header */}
            <div className="flex items-center gap-4 mb-6">
              <div className="w-14 h-14 rounded-2xl bg-blue-600/20 flex items-center justify-center text-3xl">
                🟢
              </div>
              <div>
                <h1 className="text-xl font-bold text-white">Connect QuickBooks Online</h1>
                <p className="text-slate-400 text-sm">OAuth 2.0 — secure, token-based access</p>
              </div>
            </div>

            {/* What we access */}
            <div className="mb-6 p-4 bg-slate-900/60 rounded-xl border border-slate-700">
              <p className="text-slate-300 text-sm font-medium mb-2">What FinReport AI will access:</p>
              <ul className="space-y-1 text-sm text-slate-400">
                <li className="flex items-center gap-2"><span className="text-green-400">✓</span> Trial Balance report (read-only)</li>
                <li className="flex items-center gap-2"><span className="text-green-400">✓</span> Company info (name, currency, country)</li>
                <li className="flex items-center gap-2"><span className="text-green-400">✓</span> Accounting data via QBO Reports API</li>
                <li className="flex items-center gap-2"><span className="text-red-400">✗</span> No write access — we never modify your books</li>
              </ul>
            </div>

            {/* Steps */}
            <div className="mb-6 space-y-3">
              {[
                'Click "Connect to QuickBooks" below',
                'Sign in to Intuit and authorise FinReport AI',
                'You\'ll be redirected back automatically with your company linked',
                'Set a date range and sync your Trial Balance',
              ].map((step, i) => (
                <div key={i} className="flex items-start gap-3 text-sm text-slate-300">
                  <span className="w-6 h-6 rounded-full bg-blue-600/20 text-blue-400 flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">
                    {i + 1}
                  </span>
                  {step}
                </div>
              ))}
            </div>

            {/* Environment badge */}
            <div className="mb-4 flex items-center gap-2">
              <span className="text-xs px-2 py-1 rounded bg-amber-900/40 text-amber-300 border border-amber-800">
                Sandbox Mode
              </span>
              <span className="text-slate-500 text-xs">
                Set QBO_ENVIRONMENT=production in .env to connect to live data
              </span>
            </div>

            <button
              onClick={handleConnect}
              disabled={loading}
              className="w-full py-3 bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white font-semibold rounded-xl transition-colors"
            >
              {loading ? 'Redirecting to Intuit…' : 'Connect to QuickBooks Online'}
            </button>

            <p className="text-center text-slate-500 text-xs mt-4">
              Your credentials are never stored — only OAuth tokens with accounting read-only scope.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
