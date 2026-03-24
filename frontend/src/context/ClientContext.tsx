import React, { createContext, useContext, useState, useMemo } from 'react';

export interface Client {
  companyId: string;
  name: string;
  currency: string;
}

const DEFAULT_CLIENT: Client = {
  companyId: 'default',
  name: 'Default Client',
  currency: 'INR',
};

interface ClientContextValue {
  activeClient: Client | null;
  setActiveClient: (client: Client | null) => void;
}

const ClientContext = createContext<ClientContextValue | null>(null);

export function ClientProvider({ children }: { children: React.ReactNode }) {
  const [activeClient, setActiveClient] = useState<Client | null>(DEFAULT_CLIENT);
  const value = useMemo(
    () => ({ activeClient, setActiveClient }),
    [activeClient]
  );
  return <ClientContext.Provider value={value}>{children}</ClientContext.Provider>;
}

export function useClient(): ClientContextValue {
  const ctx = useContext(ClientContext);
  if (!ctx) {
    return {
      activeClient: DEFAULT_CLIENT,
      setActiveClient: () => {},
    };
  }
  return ctx;
}
