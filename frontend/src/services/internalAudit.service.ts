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
  escalation_level?: EscalationLevel | null;
};

export type EscalationLevel = 'none' | 'management' | 'cfo' | 'audit_committee';
export const ESCALATION_LEVELS: { value: EscalationLevel; label: string }[] = [
  { value: 'none', label: 'Not escalated' },
  { value: 'management', label: 'Management' },
  { value: 'cfo', label: 'CFO' },
  { value: 'audit_committee', label: 'Audit Committee' },
];

export type FindingFollowup = {
  id: number;
  finding_id: number;
  contacted_at: string;
  contacted_person: string | null;
  response_notes: string | null;
  logged_by: string | null;
  created_at: string | null;
};

export type DueDateRevision = {
  id: number;
  finding_id: number;
  original_due_date: string | null;
  revised_due_date: string;
  reason: string;
  revised_by: string | null;
  created_at: string | null;
};

export type OverdueFinding = Finding & {
  escalation_level: EscalationLevel;
  days_overdue: number;
  latest_followup: FindingFollowup | null;
  followup_count: number;
  revision_count: number;
  original_due_date: string | null;
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

async function send(path: string, companyId: string, init: RequestInit = {}): Promise<Response> {
  const sep = path.includes('?') ? '&' : '?';
  const res = await fetch(joinApiUrl(`${path}${sep}company_id=${encodeURIComponent(companyId)}`), {
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
  return res;
}

async function request<T>(path: string, companyId: string, init: RequestInit = {}, root = '/api/internal-audit'): Promise<T> {
  const res = await send(`${root}${path}`, companyId, init);
  return (res.status === 204 ? undefined : await res.json()) as T;
}

function queryString(params: Record<string, string | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  const s = q.toString();
  return s ? `?${s}` : '';
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

async function saveBlob(res: Response, filename: string) {
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export const auditUniverseApi = crud<AuditUnit>('universe');
export const engagementsApi = {
  ...crud<Engagement>('engagements'),
  /** `period` is YYYY-Qn, YYYY-MM or YYYY; omit it to leave the JE anomaly section out. */
  async downloadReport(companyId: string, engagement: Engagement, period: string | null, companyName?: string) {
    const res = await send(
      `/api/internal-audit/engagements/${engagement.id}/report.pdf${queryString({
        period: period ?? undefined,
        company_name: companyName,
      })}`,
      companyId,
    );
    await saveBlob(res, `internal-audit-report-${engagement.engagement_ref || `IA-${engagement.id}`}.pdf`);
  },
};
export const findingsApi = crud<Finding>('findings');

export const followUpApi = {
  overdue: (companyId: string) => request<OverdueFinding[]>('/overdue-findings', companyId),
  history: (companyId: string, findingId: number) =>
    request<{ followups: FindingFollowup[]; revisions: DueDateRevision[] }>(`/findings/${findingId}/follow-up-history`, companyId),
  logFollowup: (
    companyId: string,
    findingId: number,
    body: { contacted_at: string; contacted_person?: string; response_notes?: string },
  ) => request<FindingFollowup>(`/findings/${findingId}/followups`, companyId, { method: 'POST', body: JSON.stringify(body) }),
  reviseDueDate: (companyId: string, findingId: number, body: { revised_due_date: string; reason: string }) =>
    request<{ revision: DueDateRevision; finding: Finding }>(`/findings/${findingId}/revise-due-date`, companyId, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  setEscalation: (companyId: string, findingId: number, escalation_level: EscalationLevel) =>
    request<Finding>(`/findings/${findingId}/escalation`, companyId, {
      method: 'PATCH',
      body: JSON.stringify({ escalation_level }),
    }),
};
export const getAuditDashboard = (companyId: string) => request<AuditDashboard>('/dashboard', companyId);

export function isOverdue(f: Pick<Finding, 'action_due_date' | 'status'>, today = new Date().toISOString().slice(0, 10)) {
  return !!f.action_due_date && f.action_due_date < today && !CLOSED_FINDING_STATUSES.includes(f.status);
}

// ── Historical baseline (JE history) ─────────────────────────────────────────

export type GLLine = {
  journal_id: string;
  posting_date: string;
  account: string;
  account_name?: string;
  amount: number;
  user_id?: string;
  source?: string;
  description?: string;
  entity?: string;
};

export type AccountBaselineRow = {
  account: string;
  account_name: string | null;
  months: number;
  entry_count: number;
  avg_monthly_total: number;
  std_monthly_total: number;
  min_monthly_total: number;
  max_monthly_total: number;
  alert_threshold: number;
  avg_entry_amount: number | null;
  std_entry_amount: number | null;
  monthly: { month: string; total: number; count: number }[];
};

export type AccountBaseline = {
  accounts_count: number;
  months_count: number;
  months: string[];
  z_threshold: number;
  quality: 'strong' | 'building' | 'weak' | 'none';
  warnings: string[];
  accounts: AccountBaselineRow[];
};

export type HistoryUploadResult = {
  saved: number;
  skipped_duplicates: number;
  months_in_baseline?: number;
  accounts_covered?: number;
};

const V2 = '/api/v2';

export const historyApi = {
  baseline: (companyId: string) => request<AccountBaseline>('/history/account-baseline', companyId, {}, V2),
  upload: (companyId: string, entries: GLLine[], rebuild: boolean) =>
    request<HistoryUploadResult>('/history/upload', companyId, {
      method: 'POST',
      body: JSON.stringify({
        company_id: companyId,
        upload_month: entries[0]?.posting_date.slice(0, 7) || new Date().toISOString().slice(0, 7),
        entries,
        rebuild,
      }),
    }, V2),
  reset: (companyId: string) => request<{ deleted_entries: number }>('/history/reset', companyId, { method: 'DELETE' }, V2),
  analyze: (companyId: string, entries: GLLine[]) =>
    request<{ review_queued: number; batch_stats?: Record<string, number> }>('/analyze-historical', companyId, {
      method: 'POST',
      body: JSON.stringify({ company_id: companyId, entries }),
    }, V2),
};

// ── JE review queue ──────────────────────────────────────────────────────────

export type ReviewSeverity = 'Critical' | 'High' | 'Medium';
export type ReviewStatus = 'Open' | 'Under Review' | 'Cleared';
export const REVIEW_SEVERITIES: ReviewSeverity[] = ['Critical', 'High', 'Medium'];
export const REVIEW_STATUSES: ReviewStatus[] = ['Open', 'Under Review', 'Cleared'];

export type JEReview = {
  id: number;
  journal_id: string;
  account: string;
  account_name: string | null;
  amount: number;
  posting_date: string | null;
  user_id: string | null;
  description: string | null;
  risk_score: number;
  severity: ReviewSeverity;
  explanation: string | null;
  ai_observation: string | null;
  top_reasons: string[] | null;
  status: ReviewStatus;
  auditor_comment: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  finding_id: number | null;
};

export type ReviewFilters = {
  severity?: ReviewSeverity | '';
  status?: ReviewStatus | '';
  period_start?: string;
  period_end?: string;
};

export type ReviewSummary = {
  total: number;
  by_severity: Record<ReviewSeverity, number>;
  by_status: Record<ReviewStatus, number>;
};

function filterParams(f: ReviewFilters): Record<string, string | undefined> {
  return { severity: f.severity || undefined, status: f.status || undefined, period_start: f.period_start, period_end: f.period_end };
}

export const jeReviewsApi = {
  list: (companyId: string, filters: ReviewFilters = {}) =>
    request<{ items: JEReview[]; summary: ReviewSummary }>(`/je-reviews${queryString(filterParams(filters))}`, companyId),
  update: (companyId: string, id: number, body: { status?: ReviewStatus; auditor_comment?: string }) =>
    request<JEReview>(`/je-reviews/${id}`, companyId, { method: 'PATCH', body: JSON.stringify(body) }),
  raiseFinding: (companyId: string, id: number, engagementId: number | null) =>
    request<{ finding: Finding; review: JEReview }>(`/je-reviews/${id}/raise-finding`, companyId, {
      method: 'POST',
      body: JSON.stringify({ engagement_id: engagementId }),
    }),
  async download(companyId: string, format: 'pdf' | 'xlsx', filters: ReviewFilters, companyName?: string) {
    const res = await send(
      `/api/internal-audit/je-reviews/export${queryString({ ...filterParams(filters), format, company_name: companyName })}`,
      companyId,
    );
    await saveBlob(res, `je-review-${new Date().toISOString().slice(0, 10)}.${format}`);
  },
};
