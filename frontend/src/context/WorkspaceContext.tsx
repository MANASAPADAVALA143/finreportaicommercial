import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { useAuth } from './AuthContext';
import { useClient } from './ClientContext';
import {
  getStoredWorkspaceId,
  listWorkspaces,
  setStoredWorkspaceId,
  type Workspace,
} from '../services/workspaceService';

interface WorkspaceContextValue {
  workspaces: Workspace[];
  activeWorkspace: Workspace | null;
  loading: boolean;
  error: string | null;
  switchWorkspace: (workspace: Workspace) => void;
  refreshWorkspaces: () => Promise<void>;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const { accessToken, isAuthenticated } = useAuth();
  const { setActiveClient } = useClient();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWorkspace, setActiveWorkspace] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const applyWorkspace = useCallback((ws: Workspace) => {
    setActiveWorkspace(ws);
    setStoredWorkspaceId(ws.id);
    setActiveClient({
      companyId: ws.id,
      name: ws.name,
      currency: ws.currency,
    });
  }, [setActiveClient]);

  const refreshWorkspaces = useCallback(async () => {
    if (!isAuthenticated || !accessToken) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const list = await listWorkspaces(accessToken);
      setWorkspaces(list);
      const storedId = getStoredWorkspaceId();
      const match = list.find((w) => w.id === storedId) ?? list[0] ?? null;
      if (match) applyWorkspace(match);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [accessToken, isAuthenticated, applyWorkspace]);

  const switchWorkspace = useCallback((workspace: Workspace) => {
    applyWorkspace(workspace);
    window.location.reload();
  }, [applyWorkspace]);

  useEffect(() => {
    refreshWorkspaces();
  }, [refreshWorkspaces]);

  const value = useMemo(
    () => ({
      workspaces,
      activeWorkspace,
      loading,
      error,
      switchWorkspace,
      refreshWorkspaces,
    }),
    [workspaces, activeWorkspace, loading, error, switchWorkspace, refreshWorkspaces],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) {
    return {
      workspaces: [],
      activeWorkspace: null,
      loading: false,
      error: null,
      switchWorkspace: () => {},
      refreshWorkspaces: async () => {},
    };
  }
  return ctx;
}
