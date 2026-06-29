/**
 * Active tenant for /ifrs-statement flows (onboarding, TB upload, mapping, review).
 * Set from ClientContext.activeClient.companyId — not VITE_TENANT_ID.
 */
let activeTenantId: string = "default";

export function setIfrsTenantId(tenantId: string | null | undefined): void {
  const t = (tenantId ?? "").trim();
  activeTenantId = t || "default";
}

export function getIfrsTenantId(): string {
  return activeTenantId;
}
