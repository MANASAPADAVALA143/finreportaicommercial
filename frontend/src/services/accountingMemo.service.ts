import { request } from './internalAudit.service';
import type { Jurisdiction } from './accountingAssistant.service';

const ROOT = '/api/accounting-memos';

export type MemoStatus = 'draft' | 'under_review' | 'finalised';
export const MEMO_STATUSES: { value: MemoStatus; label: string }[] = [
  { value: 'draft', label: 'Draft' },
  { value: 'under_review', label: 'Under Review' },
  { value: 'finalised', label: 'Finalised' },
];

export type MemoSectionKey =
  | 'section_executive_summary'
  | 'section_background'
  | 'section_applicable_standards'
  | 'section_accounting_analysis'
  | 'section_conclusion'
  | 'section_journal_entries'
  | 'section_disclosures'
  | 'section_assumptions';

export const MEMO_SECTIONS: { key: MemoSectionKey; label: string }[] = [
  { key: 'section_executive_summary', label: 'Executive Summary' },
  { key: 'section_background', label: 'Background' },
  { key: 'section_applicable_standards', label: 'Applicable Standards' },
  { key: 'section_accounting_analysis', label: 'Accounting Analysis' },
  { key: 'section_conclusion', label: 'Conclusion' },
  { key: 'section_journal_entries', label: 'Journal Entries' },
  { key: 'section_disclosures', label: 'Disclosure Requirements' },
  { key: 'section_assumptions', label: 'Key Assumptions' },
];

export type AccountingMemo = Record<MemoSectionKey, string | null> & {
  id: number;
  title: string;
  status: MemoStatus;
  transaction_description: string | null;
  jurisdiction: Jurisdiction | null;
  accounting_topic: string | null;
  requires_partner_review: boolean;
  ai_generated: boolean;
  created_at: string | null;
  updated_at: string | null;
};

export type GenerateMemoRequest = {
  title?: string;
  transaction_description: string;
  jurisdiction: Jurisdiction;
  accounting_topic?: string;
};

export type UpdateMemoRequest = Partial<Record<MemoSectionKey, string>> & {
  title?: string;
  status?: MemoStatus;
  requires_partner_review?: boolean;
};

export const accountingMemoApi = {
  list: (companyId: string) => request<AccountingMemo[]>('', companyId, {}, ROOT),
  get: (companyId: string, memoId: number) => request<AccountingMemo>(`/${memoId}`, companyId, {}, ROOT),
  remove: (companyId: string, memoId: number) =>
    request<void>(`/${memoId}`, companyId, { method: 'DELETE' }, ROOT),
  generate: (companyId: string, body: GenerateMemoRequest) =>
    request<AccountingMemo>('/generate', companyId, { method: 'POST', body: JSON.stringify(body) }, ROOT),
  update: (companyId: string, memoId: number, body: UpdateMemoRequest) =>
    request<AccountingMemo>(`/${memoId}`, companyId, { method: 'PATCH', body: JSON.stringify(body) }, ROOT),
  regenerate: (companyId: string, memoId: number) =>
    request<AccountingMemo>(`/${memoId}/regenerate`, companyId, { method: 'POST' }, ROOT),
};
