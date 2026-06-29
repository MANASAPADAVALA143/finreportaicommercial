/**
 * InvoiceFlow FastAPI agent (Railway in prod).
 * Dev: leave VITE_API_URL unset → `/api/agent/...` is proxied by Vite to localhost:8000.
 * Vercel prod: leave VITE_API_URL unset → browser POSTs same-origin `/api/agent/extract-image`,
 * which is rewritten to a serverless proxy (set INVOICEFLOW_AGENT_URL there). Or set VITE_API_URL
 * to the FastAPI base for direct calls (ensure CORS on the agent).
 */
export function getInvoiceFlowAgentBase(): string {
  return (import.meta.env.VITE_API_URL ?? '').trim().replace(/\/$/, '');
}

/** Absolute URL in prod when VITE_API_URL is set; same-origin `/api/...` in dev (Vite proxy). */
export function invoiceFlowAgentUrl(path: string): string {
  const base = getInvoiceFlowAgentBase();
  const p = path.startsWith('/') ? path : `/${path}`;
  if (base) return `${base}${p}`;
  return p;
}
