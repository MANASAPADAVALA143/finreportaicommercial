import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';

export type AgentId = 'r2r' | 'ifrs' | 'fpa' | 'decision' | 'voice';
export interface AgentAction {
  id: string;
  agentId: AgentId;
  agentName: string;
  message: string;
  timestamp: number;
}

interface AgentActivityContextType {
  actions: AgentAction[];
  activeAgents: Set<AgentId>;
  pushAction: (agentId: AgentId, message: string) => void;
  markActive: (agentId: AgentId) => void;
}

const AGENT_NAMES: Record<AgentId, string> = {
  r2r: 'R2R Agent',
  ifrs: 'IFRS Agent',
  fpa: 'FP&A Agent',
  decision: 'Decision Agent',
  voice: 'Voice Agent',
};

// No demo actions: activity appears only after real upload/analysis
const defaultActions: AgentAction[] = [];

const AgentActivityContext = createContext<AgentActivityContextType | null>(null);

export function AgentActivityProvider({ children }: { children: ReactNode }) {
  const [actions, setActions] = useState<AgentAction[]>(defaultActions);
  const [activeAgents, setActiveAgents] = useState<Set<AgentId>>(
    () => new Set(['r2r', 'ifrs', 'fpa', 'decision', 'voice'])
  );

  const pushAction = useCallback((agentId: AgentId, message: string) => {
    const action: AgentAction = {
      id: `act-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      agentId,
      agentName: AGENT_NAMES[agentId],
      message,
      timestamp: Date.now(),
    };
    setActions((prev) => [action, ...prev].slice(0, 5));
    setActiveAgents((prev) => new Set([...prev, agentId]));
  }, []);

  const markActive = useCallback((agentId: AgentId) => {
    setActiveAgents((prev) => new Set([...prev, agentId]));
  }, []);

  return (
    <AgentActivityContext.Provider value={{ actions, activeAgents, pushAction, markActive }}>
      {children}
    </AgentActivityContext.Provider>
  );
}

export function useAgentActivity() {
  const ctx = useContext(AgentActivityContext);
  if (!ctx) return { actions: [], activeAgents: new Set<AgentId>(), pushAction: () => {}, markActive: () => {} };
  return ctx;
}
