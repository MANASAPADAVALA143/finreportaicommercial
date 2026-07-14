/**
 * Central workspace header helper — never falls back to "demo".
 */
import { getStoredAccessToken } from './authToken';
import { getStoredWorkspaceId } from '../services/workspaceService';

export { getStoredAccessToken } from './authToken';

export function getActiveWorkspaceId(): string | null {
  return getStoredWorkspaceId();
}

export function requireWorkspaceId(): string {
  const id = getActiveWorkspaceId();
  if (!id) {
    throw new Error('No active workspace — complete company setup first.');
  }
  return id;
}

export function workspaceHeaders(
  token?: string | null,
  extra: Record<string, string> = {},
): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...extra,
  };
  const wsId = getActiveWorkspaceId();
  if (wsId) {
    headers['X-Workspace-ID'] = wsId;
    headers['X-Tenant-ID'] = wsId;
  }
  // Fall back to stored/memory token (RBAC login or AuthContext) when
  // supabase.auth.getSession() has no session yet or returns null.
  const bearer = token ?? getStoredAccessToken();
  if (bearer) {
    headers.Authorization = `Bearer ${bearer}`;
  }
  return headers;
}
