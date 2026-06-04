/**
 * Public FastAPI origin for browser calls.
 * In production, VITE_API_URL must be set (e.g. on Vercel) â€” never defaults to localhost,
 * which would make every visitor's browser call their own machine.
 */
export function backendOrigin(): string {
  const raw = (import.meta.env.VITE_API_URL && String(import.meta.env.VITE_API_URL).trim()) || "";
  const t = raw.replace(/\/$/, "");
  if (t) return t;
  if (import.meta.env.DEV) return "http://localhost:8001";
  return "";
}

export function isBackendConfigured(): boolean {
  return backendOrigin() !== "";
}

