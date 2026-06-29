import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { getSetupStatus, type SetupStatus } from '../services/companySetup.service';

export function useCompanySetupStatus() {
  const { accessToken } = useAuth();
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getSetupStatus(accessToken)
      .then(s => { if (!cancelled) setStatus(s); })
      .catch(() => { if (!cancelled) setStatus(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [accessToken]);

  return {
    loading,
    setupRequired: status?.setup_required ?? true,
    hasActiveCompany: status?.has_active_company ?? false,
    activeCompany: status?.active_company,
    setupBadge: status?.has_active_company ? 'Active' : 'Setup Required',
  };
}
