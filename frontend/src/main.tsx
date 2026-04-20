import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import { ErrorBoundary } from './ErrorBoundary.tsx';
import './index.css';

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('FinReport AI: missing #root in index.html');
}

// Lazy chunk/network failures reject without hitting React Error Boundaries; surface a hint if #root stays empty.
window.addEventListener('unhandledrejection', (ev) => {
  const msg = String((ev.reason as Error)?.message ?? ev.reason ?? '');
  if (!/Failed to fetch|dynamically imported|Importing a module script failed|Loading chunk/i.test(msg)) {
    return;
  }
  const el = document.getElementById('root');
  if (!el || el.childElementCount > 0) return;
  el.innerHTML = `<div style="padding:24px;font-family:system-ui,sans-serif;max-width:520px;background:#0f172a;color:#e2e8f0;border-radius:8px;margin:24px auto">
    <p style="margin:0 0 8px;font-weight:600">Could not load the app (network or cached old build).</p>
    <p style="margin:0;color:#94a3b8;font-size:14px">Try <strong>Ctrl+Shift+R</strong> (hard refresh). If you use a build folder, run <code>npm run preview</code> from <code>frontend</code>—do not open <code>dist/index.html</code> directly.</p>
    <pre style="margin-top:12px;font-size:11px;color:#fca5a5;white-space:pre-wrap">${msg.replace(/</g, '&lt;')}</pre></div>`;
});

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
