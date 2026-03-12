import { jsx as _jsx } from "react/jsx-runtime";
import { createContext, useContext, useState, useCallback } from 'react';
const AGENT_NAMES = {
    r2r: 'R2R Agent',
    ifrs: 'IFRS Agent',
    fpa: 'FP&A Agent',
    decision: 'Decision Agent',
    voice: 'Voice Agent',
};
const defaultActions = [
    { id: '1', agentId: 'r2r', agentName: 'R2R Agent', message: 'Analysed 200 JEs, flagged 8 HIGH risk', timestamp: Date.now() - 60000 },
    { id: '2', agentId: 'ifrs', agentName: 'IFRS Agent', message: 'Generated P&L + Balance Sheet', timestamp: Date.now() - 50000 },
    { id: '3', agentId: 'fpa', agentName: 'FP&A Agent', message: 'Variance: Marketing over budget 23%', timestamp: Date.now() - 40000 },
    { id: '4', agentId: 'decision', agentName: 'Decision Agent', message: 'Hire vs Automate: Automate (87%)', timestamp: Date.now() - 30000 },
    { id: '5', agentId: 'voice', agentName: 'Voice Agent', message: 'CFO asked: cash runway → 4.2 months', timestamp: Date.now() - 20000 },
];
const AgentActivityContext = createContext(null);
export function AgentActivityProvider({ children }) {
    const [actions, setActions] = useState(defaultActions);
    const [activeAgents, setActiveAgents] = useState(() => new Set(['r2r', 'ifrs', 'fpa', 'decision', 'voice']));
    const pushAction = useCallback((agentId, message) => {
        const action = {
            id: `act-${Date.now()}`,
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
