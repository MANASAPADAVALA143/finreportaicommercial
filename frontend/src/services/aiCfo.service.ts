import { request } from './internalAudit.service';

const ROOT = '/api/ai-cfo';

export type Severity = 'high' | 'medium' | 'low';
export type FindingStatus = 'open' | 'investigated' | 'dismissed' | 'resolved';
export type FindingKind = 'expense_spike' | 'budget_overrun' | 'duplicate_entry';

export type EvidenceRef = { ref: string; journal_entry_id: string; date: string | null; amount: number; description: string | null };

export type Finding = {
  id: number;
  kind: FindingKind;
  period: string;
  account_code: string | null;
  account_name: string | null;
  title: string;
  detection_reason: string;
  severity: Severity;
  amount: number | null;
  metrics_json: Record<string, unknown> | null;
  evidence_refs: EvidenceRef[] | null;
  status: FindingStatus;
  status_note: string | null;
  detected_at: string | null;
};

export type ToolCall = {
  id: number;
  step: number;
  tool_name: string;
  action_class: string;
  input_json: Record<string, unknown> | null;
  output_summary: string | null;
  refs: string[] | null;
  is_error: number;
  duration_ms: number | null;
  created_at: string | null;
  agent?: string;
  investigation_id?: number;
};

export type ApprovalRequest = {
  id: number;
  investigation_id: number | null;
  finding_id: number | null;
  action_type: string;
  title: string;
  rationale: string;
  amount: number | null;
  payload_json: Record<string, unknown> | null;
  status: 'pending' | 'approved' | 'rejected';
  requested_by: string | null;
  decided_by: string | null;
  decision_note: string | null;
  created_at: string | null;
  decided_at: string | null;
};

export type InvestigationResult = {
  conclusion: string;
  answer_markdown: string;
  key_figures: { label?: string; value?: number; source_tool?: string }[];
  drivers: { account_code?: string; amount?: number; explanation?: string; refs?: string[] }[];
  nature: string;
  impact_summary: string | null;
  recommendations: string[];
  limitations: string[];
  confidence: 'low' | 'medium' | 'high';
  approval_request_ids: number[];
};

export type Investigation = {
  id: number;
  finding_id: number | null;
  agent: 'anomaly_investigator' | 'cfo_analyst';
  question: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  result_json: InvestigationResult | null;
  answer_markdown: string | null;
  unverified_refs: string[] | null;
  error: string | null;
  model: string | null;
  steps: number;
  requested_by: string | null;
  created_at: string | null;
  finished_at: string | null;
  tool_calls?: ToolCall[];
  approval_requests?: ApprovalRequest[];
};

export type Coverage = {
  periods: string[];
  first_period: string | null;
  last_period: string | null;
  posted_lines: number;
  unassigned_workspace_lines: number;
  limitations: string[];
};

export type Overview = {
  coverage: Coverage;
  findings_by_status: Partial<Record<FindingStatus, number>>;
  open_findings_by_severity: Partial<Record<Severity, number>>;
  investigations_by_status: Record<string, number>;
  pending_approvals: number;
  ai_configured: boolean;
};

export type DetectionResult = {
  period: string | null;
  findings: Finding[];
  created: number;
  updated: number;
  limitations: string[];
};

export type DemoSeedResult = {
  company_id: string;
  company_name: string;
  periods: string[];
  journal_entries: number;
  budget_rows: number;
  planted_anomalies: string[];
};

const r = <T>(path: string, companyId: string, init: RequestInit = {}) => request<T>(path, companyId, init, ROOT);
const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });

export const aiCfoApi = {
  overview: (companyId: string) => r<Overview>('/overview', companyId),
  detect: (companyId: string, period?: string) => r<DetectionResult>('/detect', companyId, json('POST', { period: period || null })),
  findings: (companyId: string, status?: FindingStatus) =>
    r<Finding[]>(`/findings${status ? `?status=${status}` : ''}`, companyId),
  finding: (companyId: string, id: number) => r<Finding & { investigations: Investigation[] }>(`/findings/${id}`, companyId),
  updateFinding: (companyId: string, id: number, status: FindingStatus, note?: string) =>
    r<Finding>(`/findings/${id}`, companyId, json('PATCH', { status, note })),
  investigate: (companyId: string, body: { finding_id?: number; question?: string }) =>
    r<Investigation>('/investigations', companyId, json('POST', body)),
  investigations: (companyId: string) => r<Investigation[]>('/investigations', companyId),
  investigation: (companyId: string, id: number) => r<Investigation>(`/investigations/${id}`, companyId),
  approvals: (companyId: string, status?: ApprovalRequest['status']) =>
    r<ApprovalRequest[]>(`/approvals${status ? `?status=${status}` : ''}`, companyId),
  decide: (companyId: string, id: number, decision: 'approved' | 'rejected', note?: string) =>
    r<ApprovalRequest & { executed: false }>(`/approvals/${id}/decision`, companyId, json('POST', { decision, note })),
  activity: (companyId: string) => r<ToolCall[]>('/activity', companyId),
  seedDemo: (companyId: string) => r<DemoSeedResult>('/demo/seed', companyId, { method: 'POST' }),
};
