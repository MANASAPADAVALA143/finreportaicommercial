import { downloadFile, request } from './internalAudit.service';

const ROOT = '/api/ai-close';

export type AgentKey = 'bank_reconciliation' | 'ar_intelligence' | 'fpa' | 'close_manager';
export type SelectableAgent = Exclude<AgentKey, 'close_manager'>;
export type RunStatus = 'queued' | 'running' | 'awaiting_approval' | 'failed' | 'closed';
export type TaskStatus = 'pending' | 'running' | 'completed' | 'completed_with_exceptions' | 'failed';
export type ProposalStatus = 'pending_approval' | 'approved' | 'rejected' | 'changes_requested';
export type ReportKey = 'bank_reconciliation' | 'ar_collections' | 'fpa_intelligence' | 'close_pack';

export type Kpi = {
  key: string;
  label: string;
  value: number | null;
  unit: string | null;
  definition: string;
  source: string | null;
  available: boolean;
};

export type SourceRef = {
  type: 'bank_line' | 'journal_line' | 'sales_invoice' | 'account' | string;
  id?: string;
  ref?: string;
  journal_entry_id?: string;
  date?: string;
  description?: string;
  amount?: number;
  period?: string;
};

export function refLabel(r: SourceRef): string {
  const what = { bank_line: 'Bank line', journal_line: 'Journal', sales_invoice: 'Invoice', account: 'Account' }[r.type] ?? r.type;
  const name = r.ref ?? r.description ?? r.id?.slice(0, 8) ?? '';
  return `${what} ${name}${r.date ? ` (${r.date})` : r.period ? ` (${r.period})` : ''}`;
}

export type ValidationCheck = { name: string; passed: boolean; detail: string; blocking: boolean };

export type CloseTask = {
  id: number;
  agent: AgentKey;
  agent_name: string;
  title: string;
  depends_on: string[] | null;
  wave: number;
  status: TaskStatus;
  attempts: number;
  records_processed: number | null;
  exceptions_count: number | null;
  validation_json: ValidationCheck[] | null;
  messages_json: string[] | null;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
  duration_ms: number | null;
  output_json?: Record<string, unknown> | null;
};

export type ChecklistItem = { key: string; label: string; status: 'done' | 'open' | 'not_run' | 'n/a'; evidence: string };
export type Checklist = { items: ChecklistItem[]; done: number; applicable: number; completion_pct: number; definition: string };

export type CloseException = {
  id: number;
  agent: AgentKey;
  fingerprint: string;
  category: string;
  severity: 'high' | 'medium' | 'low';
  title: string;
  detail: string | null;
  amount: number | null;
  source_refs: SourceRef[] | null;
  status: string;
};

export type JournalLine = { account_code: string; account_name: string | null; description: string | null; debit: number; credit: number };

export type JournalProposal = {
  id: number;
  run_id: number;
  agent: AgentKey;
  agent_name: string;
  journal_entry_id: string;
  entry_number: string | null;
  title: string;
  rationale: string;
  amount: number | null;
  source_refs: SourceRef[] | null;
  status: ProposalStatus;
  prepared_by: string;
  requested_by: string | null;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  created_at: string | null;
  journal_status: string;
  entry_date: string | null;
  period: string | null;
  description: string | null;
  lines: JournalLine[];
  total_debit: number;
  total_credit: number;
  approved_by: string | null;
  approved_at: string | null;
};

export type Deliverable = {
  key: ReportKey;
  title: string;
  agent: AgentKey;
  agent_name: string;
  status: 'ready' | 'not_run' | TaskStatus;
  executed_at: string | null;
};

export type Freshness = {
  last_posted_journal: string | null;
  last_bank_statement: string | null;
  last_sales_invoice: string | null;
  captured_at: string;
};

export type CloseRunSummary = {
  id: number;
  period: string;
  agents: SelectableAgent[];
  status: RunStatus;
  requested_by: string | null;
  error: string | null;
  close_approved_by: string | null;
  close_approved_at: string | null;
  close_note: string | null;
  created_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  freshness_json: Freshness | null;
};

export type CloseRun = CloseRunSummary & {
  kpis: Kpi[];
  tasks: CloseTask[];
  checklist: Checklist | null;
  exceptions: CloseException[];
  exceptions_total: number;
  exceptions_open: number;
  proposals: JournalProposal[];
  deliverables: Deliverable[];
};

const r = <T>(path: string, companyId: string, init: RequestInit = {}) => request<T>(path, companyId, init, ROOT);
const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });

export const aiCloseApi = {
  start: (companyId: string, body: { period?: string; agents?: SelectableAgent[] }) =>
    r<CloseRun>('/runs', companyId, json('POST', body)),
  runs: (companyId: string) => r<CloseRunSummary[]>('/runs', companyId),
  latest: (companyId: string) => r<CloseRun | null>('/runs/latest', companyId),
  run: (companyId: string, id: number) => r<CloseRun>(`/runs/${id}`, companyId),
  task: (companyId: string, runId: number, agent: AgentKey) => r<CloseTask>(`/runs/${runId}/tasks/${agent}`, companyId),
  journals: (companyId: string, status?: ProposalStatus) =>
    r<JournalProposal[]>(`/journals${status ? `?status=${status}` : ''}`, companyId),
  decide: (companyId: string, id: number, decision: Exclude<ProposalStatus, 'pending_approval'>, note?: string) =>
    r<JournalProposal>(`/journals/${id}/decision`, companyId, json('POST', { decision, note: note || null })),
  approveClose: (companyId: string, runId: number, note?: string) =>
    r<CloseRun>(`/runs/${runId}/approve-close`, companyId, json('POST', { note: note || null })),
  download: (companyId: string, run: Pick<CloseRun, 'id' | 'period'>, key: ReportKey, fmt: 'xlsx' | 'pdf') =>
    downloadFile(`${ROOT}/runs/${run.id}/reports/${key}.${fmt}`, companyId, `${key}-${run.period}-run${run.id}.${fmt}`),
};
