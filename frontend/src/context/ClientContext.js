import { jsx as _jsx } from "react/jsx-runtime";
import { createContext, useContext, useState, useMemo } from 'react';
const DEFAULT_CLIENT = {
    companyId: 'default',
    name: 'Default Client',
    currency: 'INR',
};
const ClientContext = createContext(null);
export function ClientProvider({ children }) {
    const [activeClient, setActiveClient] = useState(DEFAULT_CLIENT);
    const value = useMemo(() => ({ activeClient, setActiveClient }), [activeClient]);
    return _jsx(ClientContext.Provider, { value: value, children: children });
}
export function useClient() {
    const ctx = useContext(ClientContext);
    if (!ctx) {
        return {
            activeClient: DEFAULT_CLIENT,
            setActiveClient: () => { },
        };
    }
    return ctx;
}
