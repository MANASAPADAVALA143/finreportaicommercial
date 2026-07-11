import { joinApiUrl } from '../../utils/backendOrigin';
import { getStoredAccessToken } from '../../utils/authToken';
import { EMAIL_INVOICE_CONSENT_VERSION } from '../../config/emailIntakeConsent';
import { supabase } from './supabase';

export type EmailIntakeConsentRecord = {
  id: string;
  company_id: string;
  consent_type: string;
  accepted_by_email: string | null;
  accepted_at: string;
  consent_version: string;
  withdrawn_at: string | null;
};

function authHeaders(): Record<string, string> {
  const token = getStoredAccessToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

export async function fetchEmailIntakeConsent(
  companyId: string,
): Promise<{ has_active_consent: boolean; consent: EmailIntakeConsentRecord | null; current_version: string }> {
  const res = await fetch(joinApiUrl(`/api/ap/email-intake/consent?company_id=${encodeURIComponent(companyId)}`), {
    headers: authHeaders(),
    credentials: 'include',
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(text || `Consent lookup failed (${res.status})`);
  }
  return res.json();
}

export async function recordEmailIntakeConsent(companyId: string): Promise<EmailIntakeConsentRecord> {
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;

  const res = await fetch(joinApiUrl('/api/ap/email-intake/consent'), {
    method: 'POST',
    headers: authHeaders(),
    credentials: 'include',
    body: JSON.stringify({
      company_id: companyId,
      accepted_by_user_id: user?.id ?? null,
      accepted_by_email: user?.email ?? null,
      consent_version: EMAIL_INVOICE_CONSENT_VERSION,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(text || `Consent record failed (${res.status})`);
  }
  const body = (await res.json()) as { consent: EmailIntakeConsentRecord };
  return body.consent;
}

export async function fetchSuggestedForwardingAddress(companySlug: string): Promise<string> {
  const res = await fetch(
    joinApiUrl(`/api/ap/email-intake/suggested-forwarding-address?company_slug=${encodeURIComponent(companySlug)}`),
    { headers: authHeaders(), credentials: 'include' },
  );
  if (!res.ok) return '';
  const body = (await res.json()) as { forwarding_address?: string };
  return body.forwarding_address ?? '';
}

export async function eraseEmailIntakeData(companyId: string): Promise<Record<string, number>> {
  const res = await fetch(joinApiUrl('/api/ap/email-intake/erasure'), {
    method: 'POST',
    headers: authHeaders(),
    credentials: 'include',
    body: JSON.stringify({ company_id: companyId, confirm: true }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(text || `Erasure failed (${res.status})`);
  }
  const body = (await res.json()) as { purged: Record<string, number> };
  return body.purged;
}
