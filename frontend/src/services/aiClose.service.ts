import { downloadFile, request } from './internalAudit.service';

const ROOT = '/api/ai-close';

export type AgentKey =
  | 'bank_reconciliation' | 'ap_processing' | 'ar_intelligence' | 'ifrs' | 'fpa' | 'investment'
  | 'consolidation' | 'close_manager' | 'cfo_intelligence';
export type SelectableAgent = 'bank_reconciliation' | 'ap_processing' | 'ar_intelligence' | 'ifrs' | 'fpa' | 'investment';
export type RunStatus = 'queued' | 'running' | 'awaiting_approval' | 'failed' | 'closed';
export type TaskStatus = 'pending' | 'running' | 'completed' | 'completed_with_exceptions' | 'failed';
export type ProposalStatus = 'pending_approval' | 'approved' | 'rejected' | 'changes_requested';
export type ReportKey =
  | 'bank_reconciliation' | 'ap_processing' | 'ar_collections' | 'ifrs_pack' | 'fpa_intelligence' | 'investment_review'
  | 'close_pack' | 'cfo_summary';
export type ReportFormat = 'xlsx' | 'pdf';

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
  type: 'bank_line' | 'journal_line' | 'sales_invoice' | 'account' | 'ap_invoice' | 'goods_receipt' | 'purchase_order' | 'lease' | string;
  id?: string;
  ref?: string;
  journal_entry_id?: string;
  date?: string;
  description?: string;
  amount?: number;
  period?: string;
};

const REF_LABELS: Record<string, string> = {
  bank_line: 'Bank line', journal_line: 'Journal', sales_invoice: 'Invoice', account: 'Account', ap_invoice: 'Supplier invoice',
  goods_receipt: 'GRN', purchase_order: 'PO', lease: 'Lease', journal_reference: 'Reference',
};

export function refLabel(r: SourceRef): string {
  const what = REF_LABELS[r.type] ?? r.type;
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
  entity_id: string | null;
  entity_name: string | null;
  fingerprint: string;
  category: string;
  severity: 'high' | 'medium' | 'low';
  title: string;
  detail: string | null;
  amount: number | null;
  source_refs: SourceRef[] | null;
  status: 'open' | 'resolved' | string;
};

export type JournalLine = { account_code: string; account_name: string | null; description: string | null; debit: number; credit: number };

export type JournalProposal = {
  id: number;
  run_id: number;
  company_id: string;
  entity_name: string | null;
  agent: AgentKey;
  agent_name: string;
  journal_entry_id: string;
  entry_number: string | null;
  fingerprint: string;
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
  formats: ReportFormat[];
  status: 'ready' | 'not_run' | TaskStatus;
  executed_at: string | null;
};

export type Freshness = {
  last_posted_journal: string | null;
  last_bank_statement: string | null;
  last_sales_invoice: string | null;
  captured_at: string;
};

export type CfoSummary = {
  entity: string;
  period: string;
  currency: string;
  headline: {
    close_completion_pct: number | null;
    open_exceptions: number;
    exceptions_identified: number;
    pending_approvals: number;
    pending_approval_value: number;
    open_checklist_items: number;
  };
  performance: { revenue: number; expenses: number; profit: number; prior_revenue: number; prior_expenses: number; prior_profit: number; prior_period: string };
  key_movements: { account: string; type: string; current: number; prior: number; change: number; change_pct: number | null }[];
  major_exceptions: { title: string; agent: AgentKey; entity: string; severity: 'high' | 'medium' | 'low'; amount: number | null }[];
  root_causes: { category: string; cause: string; action: string; count: number; amount: number }[];
  risks: { area: string; level: 'high' | 'medium' | 'low'; detail: string }[];
  recommended_actions: string[];
  approval_requirements: { journal: string | null; title: string; amount: number | null; agent: AgentKey; entity: string }[];
  management_decisions: { journal: string | null; title: string; decision: ProposalStatus; by: string | null; note: string | null }[];
  group?: { consolidated_revenue: number; consolidated_net_profit: number; consolidated_total_assets: number; eliminated_revenue: number };
  subsidiary_comparison?: {
    entity: string; revenue: number; net_profit: number; net_margin_pct: number | null; total_assets: number; cash: number;
    share_of_group_revenue_pct: number | null;
  }[];
  narrative: { text: string; source: 'ai' | 'template'; note: string | null };
};

export type Delivery = { at: string; channel: 'in_app' | 'email' | 'slack'; target: string; ok: boolean; detail: string };

export type CloseSchedule = {
  id: number;
  enabled: boolean;
  scope: 'entity' | 'group';
  entity_ids: string[];
  agents: SelectableAgent[];
  run_day: number;
  run_hour: number;
  timezone: string;
  notify_emails: string[];
  slack_configured: boolean;
  notify_when: 'always' | 'issues' | 'never';
  last_run_period: string | null;
  last_run_id: number | null;
  last_run_at: string | null;
  last_error: string | null;
  next_run_at: string | null;
  next_period: string | null;
  updated_by: string | null;
};

export type ScheduleInput = {
  enabled: boolean;
  scope: 'entity' | 'group';
  entity_ids?: string[];
  agents: SelectableAgent[];
  run_day: number;
  run_hour: number;
  timezone: string;
  notify_emails: string[];
  slack_webhook_url?: string | null;
  notify_when: 'always' | 'issues' | 'never';
};

export type CloseRunSummary = {
  id: number;
  period: string;
  scope: 'entity' | 'group';
  trigger: 'manual' | 'scheduled' | null;
  notified_json: Delivery[] | null;
  agents: AgentKey[];
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

export type FxRate = {
  id: number; period: string; currency: string; reporting_currency: string; closing_rate: number; average_rate: number;
  source: string | null; updated_by: string | null;
};
export type EclRates = { current: number; '1_30': number; '31_60': number; '61_90': number; '90_plus': number };
export type CloseControls = { require_segregation: boolean; manager_limit: number | null; ecl_rates: EclRates | null; updated_by: string | null };

export type CloseRun = CloseRunSummary & {
  controls: CloseControls;
  entities: { id: string; name: string }[];
  kpis: Kpi[];
  tasks: CloseTask[];
  checklist: Checklist | null;
  cfo_summary: CfoSummary | null;
  exceptions: CloseException[];
  exceptions_total: number;
  exceptions_open: number;
  proposals: JournalProposal[];
  deliverables: Deliverable[];
};

export type HoldingInput = {
  code: string; name: string; asset_class: 'equity' | 'bond' | 'sukuk' | 'fund' | 'deposit' | 'other';
  ifrs9_category: 'fvtpl' | 'fvoci' | 'amortised_cost'; issuer?: string | null; sector?: string | null; country?: string | null;
  currency: string; quantity?: number | null; cost: number; acquired_on?: string | null; maturity_date?: string | null;
  coupon_rate?: number | null;
};
export type ValuationInput = { code: string; as_of: string; market_value: number; local_value?: number | null; price?: number | null; income?: number | null };
export type Holding = HoldingInput & { id: number; latest_value: number | null; latest_as_of: string | null };
export type ImportResult = { holdings_created: number; holdings_updated: number; valuations_saved: number; errors: string[] };

export type AskAnswer = { text: string; source: 'ai' | 'computed'; note: string | null };
export type AskRun = CloseRun & { ask: { agent: AgentKey; agent_name: string; prompt: string; answer?: AskAnswer } };
export type PreviewJournal = {
  title: string; rationale: string; entity: string; entry_date: string; amount: number; lines: JournalLine[]; refs: SourceRef[];
};

export type ReportSection = { title: string; columns: string[]; rows: (string | number | null)[][] };
export type ReportView = {
  key: ReportKey;
  title: string;
  meta: [string, string | number | null][];
  summary: [string, string | number | null][];
  sections: ReportSection[];
  notes: string[];
  narrative: string[];
  narrative_source?: 'ai' | 'template';
};

export type DemoGroupResult = {
  company_id: string;
  company_name: string;
  periods: string[];
  entities: { id: string; name: string }[];
  journal_entries: number;
  ap: Record<string, { invoices: number; purchase_orders: number; goods_receipts: number }>;
  ap_note: string | null;
  planted: string[];
};

const r = <T>(path: string, companyId: string, init: RequestInit = {}) => request<T>(path, companyId, init, ROOT);
const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });

export const aiCloseApi = {
  start: (companyId: string, body: { period?: string; agents?: SelectableAgent[]; scope?: 'entity' | 'group'; entity_ids?: string[] }) =>
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
  view: (companyId: string, runId: number, key: ReportKey) => r<ReportView>(`/runs/${runId}/reports/${key}.json`, companyId),
  download: (companyId: string, run: Pick<CloseRun, 'id' | 'period'>, key: ReportKey, fmt: ReportFormat) =>
    downloadFile(`${ROOT}/runs/${run.id}/reports/${key}.${fmt}`, companyId, `${key}-${run.period}-run${run.id}.${fmt}`),
  seedDemo: (companyId: string) => r<DemoGroupResult>('/demo/seed', companyId, { method: 'POST' }),
  schedule: (companyId: string) => r<CloseSchedule | null>('/schedule', companyId),
  saveSchedule: (companyId: string, body: ScheduleInput) => r<CloseSchedule>('/schedule', companyId, json('PUT', body)),
  deleteSchedule: (companyId: string) => r<void>('/schedule', companyId, { method: 'DELETE' }),
  ask: (companyId: string, agent: AgentKey, body: { prompt: string; period?: string; scope?: 'entity' | 'group'; entity_ids?: string[] }) =>
    r<AskRun>(`/agents/${agent}/ask`, companyId, json('POST', body)),
  askRun: (companyId: string, runId: number) => r<AskRun>(`/agents/runs/${runId}`, companyId),
  fxRates: (companyId: string, period: string) => r<FxRate[]>(`/fx-rates?period=${period}`, companyId),
  saveFxRate: (companyId: string, body: { period: string; currency: string; closing_rate: number; average_rate: number; source?: string }) =>
    r<FxRate>('/fx-rates', companyId, json('PUT', body)),
  controls: (companyId: string) => r<CloseControls>('/controls', companyId),
  saveControls: (companyId: string, body: { require_segregation: boolean; manager_limit: number | null; ecl_rates: EclRates | null }) =>
    r<CloseControls>('/controls', companyId, json('PUT', body)),
  holdings: (companyId: string) => r<Holding[]>('/investments', companyId),
  importPortfolio: (companyId: string, body: { holdings: HoldingInput[]; valuations: ValuationInput[] }) =>
    r<ImportResult>('/investments/import', companyId, json('POST', body)),
  deleteHolding: (companyId: string, id: number) => r<void>(`/investments/${id}`, companyId, { method: 'DELETE' }),
  notify: (companyId: string, runId: number, emails?: string[]) =>
    r<{ deliveries: Delivery[] }>(`/runs/${runId}/notify`, companyId, json('POST', { emails: emails?.length ? emails : null })),
};
