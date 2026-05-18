/**
 * ZohoCallback.tsx
 * ─────────────────
 * Handles Zoho OAuth redirect: /connections/zoho/callback?code=xxx&state=yyy
 * Exchanges the one-time code for tokens, saves the connection, redirects to /connections.
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8000';

export default function ZohoCallback() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<'processing' | 'success' | 'error'>('processing');
  const [error, setError] = useState('');

  useEffect(() => {
    const run = async () => {
      const params = new URLSearchParams(window.location.search);
      const code   = params.get('code');
      const state  = params.get('state');

      if (!code) {
        setError('No auth code returned by Zoho.');
        setStatus('error');
        return;
      }

      let orgId      = '';
      let clientName = 'Zoho Client';

      try {
        const parsed = JSON.parse(decodeURIComponent(state ?? '{}'));
        orgId      = parsed.orgId      ?? '';
        clientName = parsed.clientName ?? 'Zoho Client';
      } catch { /* state may be absent */ }

      try {
        const res  = await fetch(`${API}/api/connections/zoho/connect`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            client_name: clientName,
            org_id:      orgId,
            auth_code:   code,
          }),
        });
        const data = await res.json();
        if (data.success) {
          setStatus('success');
          setTimeout(() => navigate('/connections'), 1500);
        } else {
          setError(data.detail ?? 'Connection failed');
          setStatus('error');
        }
      } catch (err) {
        setError(String(err));
        setStatus('error');
      }
    };
    void run();
  }, [navigate]);

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-100">
      <div className="text-center max-w-sm px-6">
        {status === 'processing' && (
          <>
            <div className="w-10 h-10 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-white font-semibold">Connecting Zoho Books…</p>
            <p className="text-slate-400 text-sm mt-1">Exchanging tokens with Zoho</p>
          </>
        )}
        {status === 'success' && (
          <>
            <div className="text-5xl mb-4">✅</div>
            <p className="text-white font-semibold">Zoho Books connected!</p>
            <p className="text-slate-400 text-sm mt-1">Redirecting to Connections…</p>
          </>
        )}
        {status === 'error' && (
          <>
            <div className="text-5xl mb-4">❌</div>
            <p className="text-white font-semibold">Connection failed</p>
            <p className="text-slate-400 text-sm mt-2">{error}</p>
            <button
              onClick={() => navigate('/connections')}
              className="mt-4 bg-blue-600 hover:bg-blue-500 text-white text-sm px-4 py-2 rounded-lg"
            >
              Back to Connections
            </button>
          </>
        )}
      </div>
    </div>
  );
}
