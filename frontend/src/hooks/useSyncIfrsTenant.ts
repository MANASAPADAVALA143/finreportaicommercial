import { useEffect } from "react";
import { useClient } from "../context/ClientContext";
import { setIfrsTenantId } from "../services/ifrsTenant";

/**
 * Keeps ifrsService X-Tenant-ID aligned with the selected client for /ifrs-statement flows.
 * Fallback when no client is selected: "default" (single-tenant / demo).
 */
export function useSyncIfrsTenant(): string {
  const { activeClient } = useClient();
  const tenantId = activeClient?.companyId?.trim() || "default";

  useEffect(() => {
    setIfrsTenantId(tenantId);
  }, [tenantId]);

  return tenantId;
}
