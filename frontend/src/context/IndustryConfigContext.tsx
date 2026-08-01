import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useWorkspace } from './WorkspaceContext';
import {
  DEFAULT_INDUSTRY_CONFIG,
  fetchTenantIndustryConfig,
  setTenantIndustry as apiSetIndustry,
  type IndustryConfig,
  type IndustryKey,
} from '../services/industryConfig.service';

const CACHE_KEY = 'gnanova_industry_config';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

type IndustryConfigContextValue = IndustryConfig & {
  loading: boolean;
  isLoading: boolean;
  refresh: () => Promise<void>;
  refetch: () => Promise<void>;
  setIndustry: (industry: IndustryKey) => Promise<IndustryConfig>;
  /** CamelCase aliases for components */
  industryLabel: string;
  costCenterLabel: string;
  costCenterPlaceholder: string;
  apLabel: string;
  arLabel: string;
  showIfrs15: boolean;
  showIfrs16: boolean;
  showRera: boolean;
  showEjari: boolean;
  showPropertyTagging: boolean;
  sidebarTheme: string;
};

const IndustryConfigContext = createContext<IndustryConfigContextValue | null>(null);

function readCache(workspaceId: string | undefined): IndustryConfig | null {
  if (!workspaceId || typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      workspaceId?: string;
      savedAt?: number;
      config?: IndustryConfig;
    };
    if (parsed.workspaceId !== workspaceId) return null;
    if (!parsed.savedAt || Date.now() - parsed.savedAt > CACHE_TTL_MS) return null;
    if (!parsed.config) return null;
    return { ...DEFAULT_INDUSTRY_CONFIG, ...parsed.config };
  } catch {
    return null;
  }
}

function writeCache(workspaceId: string | undefined, config: IndustryConfig) {
  if (!workspaceId || typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ workspaceId, savedAt: Date.now(), config }),
    );
  } catch {
    /* ignore quota */
  }
}

function toValue(
  config: IndustryConfig,
  loading: boolean,
  refresh: () => Promise<void>,
  setIndustry: (industry: IndustryKey) => Promise<IndustryConfig>,
): IndustryConfigContextValue {
  return {
    ...config,
    loading,
    isLoading: loading,
    refresh,
    refetch: refresh,
    setIndustry,
    industryLabel: config.industry_label,
    costCenterLabel: config.cost_center_label,
    costCenterPlaceholder: config.cost_center_placeholder,
    apLabel: config.ap_label,
    arLabel: config.ar_label,
    showIfrs15: config.show_ifrs15,
    showIfrs16: config.show_ifrs16,
    showRera: config.show_rera,
    showEjari: config.show_ejari,
    showPropertyTagging: config.show_property_tagging,
    sidebarTheme: config.sidebar_theme,
  };
}

export function IndustryConfigProvider({ children }: { children: ReactNode }) {
  const { activeWorkspace } = useWorkspace();
  const [config, setConfig] = useState<IndustryConfig>(() => {
    return readCache(activeWorkspace?.id) || DEFAULT_INDUSTRY_CONFIG;
  });
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!activeWorkspace?.id) {
      setConfig(DEFAULT_INDUSTRY_CONFIG);
      setLoading(false);
      return;
    }
    const cached = readCache(activeWorkspace.id);
    if (cached) {
      setConfig(cached);
      setLoading(false);
    } else {
      setLoading(true);
    }
    try {
      const data = await fetchTenantIndustryConfig();
      const next = { ...DEFAULT_INDUSTRY_CONFIG, ...data };
      setConfig(next);
      writeCache(activeWorkspace.id, next);
    } catch {
      if (!cached) setConfig(DEFAULT_INDUSTRY_CONFIG);
    } finally {
      setLoading(false);
    }
  }, [activeWorkspace?.id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const setIndustry = useCallback(
    async (industry: IndustryKey) => {
      const data = await apiSetIndustry(industry);
      const next = { ...DEFAULT_INDUSTRY_CONFIG, ...data };
      setConfig(next);
      writeCache(activeWorkspace?.id, next);
      return next;
    },
    [activeWorkspace?.id],
  );

  const value = useMemo(
    () => toValue(config, loading, refresh, setIndustry),
    [config, loading, refresh, setIndustry],
  );

  return (
    <IndustryConfigContext.Provider value={value}>{children}</IndustryConfigContext.Provider>
  );
}

export function useIndustryConfig(): IndustryConfigContextValue {
  const ctx = useContext(IndustryConfigContext);
  if (!ctx) {
    return toValue(
      DEFAULT_INDUSTRY_CONFIG,
      false,
      async () => undefined,
      async () => DEFAULT_INDUSTRY_CONFIG,
    );
  }
  return ctx;
}

/** Alias matching the IndustryContext naming from the product brief. */
export { IndustryConfigProvider as IndustryProvider };
