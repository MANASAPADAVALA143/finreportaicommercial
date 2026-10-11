import { joinApiUrl } from '@/utils/backendOrigin';
import { workspaceHeaders } from '@/services/workspaceService';

export type Risk = 'Low' | 'Medium' | 'High' | 'Critical';
export type EngagementStatus = 'Planning' | 'Fieldwork' | 'Reporting' | 'Closed';
export type FindingStatus = 'Open' | 'In Progress' | 'Overdue' | 'Implemented' | 'Verified';

export const RISK_OPTIONS: Risk[] = ['Low', 'Medium', 'High', 'Critical'];
export const CONTROL_OPTIONS = ['Strong', 'Adequate', 'Weak', 'None'] as const;
export const FREQUENCY_OPTIONS = ['Annual', 'Bi-annual', 'Quarterly', 'Ad-hoc'] as const;
export const ENGAGEMENT_STATUSES: EngagementStatus[] = ['Planning', 'Fieldwork', 'Reporting', 'Closed'];
export const FINDING_STATUSES: FindingStatus[] = ['Open', 'In Progress', 'Overdue', 'Implemented', 'Verified'];
export const CLOSED_FINDING_STATUSES: FindingStatus[] = ['Implemented', 'Verified'];

export type AuditUnit = {
  id: number;
  unit_name: string;
  department: string | null;
  process_owner: string | null;
  inherent_risk: Risk | null;
  control_effectiveness: string | null;
  residual_risk: Risk | null;
  audit_frequency: string | null;
  last_audited: string | null;
  next_planned: string | null;
  notes: string | null;
};

export type Engagement = {
  id: number;
  engagement_ref: string | null;
  title: string;
  audit_unit: string | null;
  scope: string | null;
  objectives: string | null;
  lead_auditor: string | null;
  team_members: string[] | null;
  status: EngagementStatus;
  planned_start: string | null;
  planned_end: string | null;
  actual_start: string | null;
  actual_end: string | null;
  budget_hours: number | null;
  actual_hours: number | null;
  risk_rating: Risk | null;
  findings_count: number | null;
};

export type Finding = {
  id: number;
  engagement_id: number | null;
  finding_ref: string | null;
  title: string;
  description: string | null;
  risk_rating: Risk;
  root_cause: string | null;
  control_gap: string | null;
  recommendation: string | null;
  management_response: string | null;
  action_owner: string | null;
  action_due_date: string | null;
  status: FindingStatus;
  is_repeat: boolean;
  repeat_from_year: string | null;
  evidence_ref: string | null;
};

export type AuditDashboard = {
  engagements_by_status: Record<string, number>;
  findings_by_risk: Record<string, number>;
  open_findings: number;
  overdue_actions: number;
  repeat_findings: number;
  universe_by_risk: Record<string, number>;
  recent_open_findings: Finding[];
};

async function request<T>(path: string, companyId: string, init: RequestInit = {}): Promise<T> {
  const sep = path.includes('?') ? '&' : '?';
  const res = await fetch(joinApiUrl(`/api/internal-audit${path}${sep}company_id=${encodeURIComponent(companyId)}`), {
    ...init,
    headers: workspaceHeaders(null),
    credentials: 'include',
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const detail = body?.detail;
    const message =
      typeof detail === 'string'
        ? detail
        : Array.isArray(detail)
          ? detail.map((d: { msg?: string }) => d.msg).filter(Boolean).join('; ')
          : '';
    throw new Error(message || `Request failed (${res.status})`);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

function crud<T extends { id: number }>(resource: string) {
  return {
    list: (companyId: string) => request<T[]>(`/${resource}`, companyId),
    create: (companyId: string, body: Partial<T>) =>
      request<T>(`/${resource}`, companyId, { method: 'POST', body: JSON.stringify(body) }),
    update: (companyId: string, id: number, body: Partial<T>) =>
      request<T>(`/${resource}/${id}`, companyId, { method: 'PUT', body: JSON.stringify(body) }),
    remove: (companyId: string, id: number) =>
      request<void>(`/${resource}/${id}`, companyId, { method: 'DELETE' }),
  };
}

export const auditUniverseApi = crud<AuditUnit>('universe');
export const engagementsApi = crud<Engagement>('engagements');
export const findingsApi = crud<Finding>('findings');
export const getAuditDashboard = (companyId: string) => request<AuditDashboard>('/dashboard', companyId);

export function isOverdue(f: Pick<Finding, 'action_due_date' | 'status'>, today = new Date().toISOString().slice(0, 10)) {
  return !!f.action_due_date && f.action_due_date < today && !CLOSED_FINDING_STATUSES.includes(f.status);
}
