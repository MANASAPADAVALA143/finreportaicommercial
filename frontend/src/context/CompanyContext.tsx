import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from './AuthContext';
import { useWorkspace } from './WorkspaceContext';
import { listCompanies, type CompanyProfile } from '../services/companySetup.service';

const STORAGE_KEY = 'active_company_id';

export interface CompanyContextValue {
  activeCompanyId: string | null;
  activeCompany: CompanyProfile | null;
  companiesList: CompanyProfile[];
  loading: boolean;
  setActiveCompany: (id: string) => void;
  loadCompanies: () => Promise<void>;
}

const CompanyContext = createContext<CompanyContextValue | null>(null);

export function CompanyProvider({ children }: { children: React.ReactNode }) {
  const { accessToken, isAuthenticated } = useAuth();
  const { activeWorkspace } = useWorkspace();
  const [companiesList, setCompaniesList] = useState<CompanyProfile[]>([]);
  const [activeCompanyId, setActiveCompanyId] = useState<string | null>(
    () => localStorage.getItem(STORAGE_KEY),
  );
  const [loading, setLoading] = useState(false);

  const loadCompanies = useCallback(async () => {
    if (!isAuthenticated || !activeWorkspace?.id) {
      setCompaniesList([]);
      return;
    }
    setLoading(true);
    try {
      const res = await listCompanies(accessToken);
      setCompaniesList(res.companies);
      const stored = localStorage.getItem(STORAGE_KEY);
      const valid = res.companies.find(c => c.id === stored);
      if (valid) {
        setActiveCompanyId(valid.id);
        if (valid.company_name) localStorage.setItem('active_company_name', valid.company_name);
      } else if (res.companies.length === 1) {
        setActiveCompanyId(res.companies[0].id);
        localStorage.setItem(STORAGE_KEY, res.companies[0].id);
        if (res.companies[0].company_name) {
          localStorage.setItem('active_company_name', res.companies[0].company_name);
        }
      } else if (stored && !valid) {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem('active_company_name');
        setActiveCompanyId(null);
      }
    } catch {
      setCompaniesList([]);
    } finally {
      setLoading(false);
    }
  }, [accessToken, isAuthenticated, activeWorkspace?.id]);

  useEffect(() => {
    void loadCompanies();
  }, [loadCompanies]);

  const setActiveCompany = useCallback((id: string) => {
    setActiveCompanyId(id);
    localStorage.setItem(STORAGE_KEY, id);
    localStorage.setItem('gulftax_company_id', id);
    const named = companiesList.find(c => c.id === id);
    if (named?.company_name) {
      localStorage.setItem('active_company_name', named.company_name);
    } else {
      localStorage.removeItem('active_company_name');
    }
  }, [companiesList]);

  const activeCompany = useMemo(
    () => companiesList.find(c => c.id === activeCompanyId) ?? null,
    [companiesList, activeCompanyId],
  );

  const value = useMemo(
    () => ({
      activeCompanyId,
      activeCompany,
      companiesList,
      loading,
      setActiveCompany,
      loadCompanies,
    }),
    [activeCompanyId, activeCompany, companiesList, loading, setActiveCompany, loadCompanies],
  );

  return <CompanyContext.Provider value={value}>{children}</CompanyContext.Provider>;
}

export function useCompany(): CompanyContextValue {
  const ctx = useContext(CompanyContext);
  if (!ctx) throw new Error('useCompany must be used within CompanyProvider');
  return ctx;
}

export function getActiveCompanyId(): string | null {
  return localStorage.getItem(STORAGE_KEY);
}
