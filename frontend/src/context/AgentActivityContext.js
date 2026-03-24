import { jsx as _jsx } from "react/jsx-runtime";
import { createContext, useContext, useState, useCallback } from 'react';
const AGENT_NAMES = {
    r2r: 'R2R Agent',
    ifrs: 'IFRS Agent',
    fpa: 'FP&A Agent',
    decision: 'Decision Agent',
    voice: 'Voice Agent',
};
// No demo actions: activity appears only after real upload/analysis
const defaultActions = [];
const AgentActivityContext = createContext(null);
export function AgentActivityProvider({ children }) {
    const [actions, setActions] = useState(defaultActions);
    const [activeAgents, setActiveAgents] = useState(() => new Set(['r2r', 'ifrs', 'fpa', 'decision', 'voice']));
    const pushAction = useCallback((agentId, message) => {
        const action = {
            id: `act-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
            agentId,
            agentName: AGENT_NAMES[agentId],
            message,
            timestamp: Date.now(),
        };
        setActions((prev) => [action, ...prev].slice(0, 5));
        setActiveAgents((prev) => new Set([...prev, agentId]));
    }, []);
    const markActive = useCallback((agentId) => {
        setActiveAgents((prev) => new Set([...prev, agentId]));
    }, []);
    return (_jsx(AgentActivityContext.Provider, { value: { actions, activeAgents, pushAction, markActive }, children: children }));
}
export function useAgentActivity() {
    const ctx = useContext(AgentActivityContext);
    if (!ctx)
        return { actions: [], activeAgents: new Set(), pushAction: () => { }, markActive: () => { } };
    return ctx;
}
