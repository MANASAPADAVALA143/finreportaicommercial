/** Turn FastAPI / axios error payloads into a single user-visible string. */
export function formatApiError(error: unknown): string {
  const e = error as {
    response?: { data?: { detail?: unknown } };
    message?: string;
  };
  const d = e?.response?.data?.detail;
  if (typeof d === "string") return d;
  if (Array.isArray(d)) {
    return d
      .map((item) =>
        typeof item === "object" && item != null && "msg" in item
          ? String((item as { msg: string }).msg)
          : JSON.stringify(item)
      )
      .join("; ");
  }
  if (d != null && typeof d === "object") return JSON.stringify(d);
  return e?.message || "Request failed";
}
