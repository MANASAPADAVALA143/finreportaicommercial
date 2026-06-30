/**
 * Public FastAPI origin for browser calls.
 * In production, VITE_API_URL must be set (e.g. on Vercel) â€” never defaults to localhost,
 * which would make every visitor's browser call their own machine.
 */
export function backendOrigin(): string {
  const raw = (import.meta.env.VITE_API_URL && String(import.meta.env.VITE_API_URL).trim()) || "";
  const t = raw.replace(/\/$/, "");
  if (t) return t;
  if (import.meta.env.DEV) return "http://localhost:8000";
  return "";
}

export function isBackendConfigured(): boolean {
  return backendOrigin() !== "";
}

/** Turn browser "Failed to fetch" into an actionable message for login/API calls. */
export function formatApiNetworkError(err: unknown, apiUrl: string): Error {
  const isNetworkFailure =
    err instanceof TypeError ||
    (err instanceof Error && /failed to fetch|networkerror|load failed/i.test(err.message));
  if (!isNetworkFailure) {
    return err instanceof Error ? err : new Error(String(err));
  }
  const isHttpsSite = typeof window !== "undefined" && window.location.protocol === "https:";
  if (isHttpsSite && apiUrl.startsWith("http://")) {
    return new Error(
      `Cannot reach API: ${apiUrl} uses HTTP but this site uses HTTPS. Set VITE_API_URL to an https:// backend URL, then redeploy.`
    );
  }
  return new Error(
    `Cannot reach API at ${apiUrl}. Confirm the backend is running (open ${apiUrl}/health in a browser) and VITE_API_URL on Vercel matches your live API.`
  );
}

