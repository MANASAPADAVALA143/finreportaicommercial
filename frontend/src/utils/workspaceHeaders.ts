/**
 * Central workspace header helper — never falls back to "demo".
 */
import { getStoredWorkspaceId } from '../services/workspaceService';

/** JWT from RBAC login (AuthContext stores as `token`). */
export function getStoredAccessToken(): string | null {
  return (
    localStorage.getItem('token')
    ?? localStorage.getItem('accessToken')
    ?? localStorage.getItem('access_token')
  );
}

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
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}
