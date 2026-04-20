const API_BASE = (import.meta.env.VITE_API_URL && String(import.meta.env.VITE_API_URL).trim()) || "http://localhost:8000";
const BASE = `${API_BASE.replace(/\/$/, "")}/api/r2r`;

export type R2RFeedback = "approved" | "rejected" | "needs_review";

export type FeedbackEntryData = {
  account?: string;
  amount: number;
  user?: string;
  date?: string;
  description?: string;
  risk_score: number;
  risk_level: string;
  risk_reasons: string[];
};

export async function postR2RFeedback(payload: {
  client_id: string;
  entry_id: string;
  entry_data: FeedbackEntryData;
  feedback: R2RFeedback;
  comment?: string;
  reviewed_by?: string;
}): Promise<{ saved: boolean; learning_triggered?: boolean; adjustments?: string[]; feedback_id?: number }> {
  const res = await fetch(`${BASE}/feedback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...payload,
      comment: payload.comment ?? "",
      reviewed_by: payload.reviewed_by ?? "analyst",
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || `Feedback failed (${res.status})`);
  }
  return res.json();
}

export async function getLearningProgress(clientId: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${BASE}/learning-progress/${encodeURIComponent(clientId)}`);
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || `Learning progress failed (${res.status})`);
  }
  return res.json();
}

export async function getFeedbackHistory(
  clientId: string,
  status?: R2RFeedback | ""
): Promise<{ count: number; items: unknown[] }> {
  const q = status ? `?status=${encodeURIComponent(status)}` : "";
  const res = await fetch(`${BASE}/feedback-history/${encodeURIComponent(clientId)}${q}`);
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || `History failed (${res.status})`);
  }
  return res.json();
}
