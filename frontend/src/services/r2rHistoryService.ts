/**
 * R2R stateful backend — clients and journal history (MindBridge-style).
 * Each client's uploads are stored; baseline is built from full history.
 */

import { backendOrigin } from "../utils/backendOrigin";

const getBase = () => backendOrigin();

export interface R2RClient {
  id: string;
  name: string;
  created_at: string;
}

export async function listClients(): Promise<R2RClient[]> {
  const b = getBase();
  if (!b) return [];
  const res = await fetch(`${b}/api/r2r/clients`);
  if (!res.ok) throw new Error("Failed to list clients");
  return res.json();
}

export async function createClient(name: string): Promise<R2RClient> {
  const b = getBase();
  if (!b) throw new Error("Set VITE_API_URL to your deployed API (e.g. in Vercel Environment Variables).");
  const res = await fetch(`${b}/api/r2r/clients`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: name.trim() }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || "Failed to create client");
  }
  return res.json();
}

export async function saveUpload(
  clientId: string,
  entries: Record<string, unknown>[],
  filename?: string
): Promise<{ upload_id: string; row_count: number }> {
  const b = getBase();
  if (!b) throw new Error("Set VITE_API_URL to your deployed API.");
  const res = await fetch(`${b}/api/r2r/upload`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: clientId, entries, filename }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || "Failed to save upload");
  }
  return res.json();
}

export async function getClientHistory(
  clientId: string
): Promise<{ client_id: string; entries: Record<string, unknown>[]; total: number }> {
  const b = getBase();
  if (!b) throw new Error("Set VITE_API_URL to your deployed API.");
  const res = await fetch(`${b}/api/r2r/history?client_id=${encodeURIComponent(clientId)}`);
  if (!res.ok) throw new Error("Failed to load client history");
  return res.json();
}
