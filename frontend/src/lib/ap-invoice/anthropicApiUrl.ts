function isAnthropicPublicApiHost(hostname: string): boolean {
  return hostname === 'api.anthropic.com';
}

/**
 * Dev: same-origin `/api/anthropic` â†’ Vite proxy (or `server.js` when using `dev:with-api`).
 * Prod: set `VITE_ANTHROPIC_API_BASE` to your own backend (e.g. Edge Function). Never set it to
 * `https://api.anthropic.com` â€” the browser cannot call Anthropic directly without their
 * `anthropic-dangerous-direct-browser-access` flow.
 */
export function anthropicMessagesUrl(): string {
  const raw = import.meta.env.VITE_ANTHROPIC_API_BASE?.trim().replace(/\/$/, '') ?? '';
  let base = '/api/anthropic';

  if (raw) {
    if (raw.startsWith('/')) {
      base = raw;
    } else {
      try {
        const { hostname } = new URL(raw);
        base = isAnthropicPublicApiHost(hostname) ? '/api/anthropic' : raw;
      } catch {
        base = '/api/anthropic';
      }
    }
  }

  return `${base}/messages`;
}

