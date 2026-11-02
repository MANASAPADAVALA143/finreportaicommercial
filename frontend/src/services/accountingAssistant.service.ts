import { request } from './internalAudit.service';

const ROOT = '/api/accounting-assistant';

export type Jurisdiction = 'IFRS' | 'Ind AS' | 'US GAAP';
export const JURISDICTIONS: Jurisdiction[] = ['IFRS', 'Ind AS', 'US GAAP'];

export type AccountingConversation = {
  id: number;
  title: string | null;
  jurisdiction: Jurisdiction | null;
  created_at: string | null;
  updated_at: string | null;
};

export type AccountingMessage = {
  id: number;
  conversation_id: number;
  role: 'user' | 'assistant';
  content: string;
  created_at: string | null;
  requires_human_review?: boolean;
  caveats?: string | null;
};

export type ChatRequest = {
  conversation_id?: number | null;
  message: string;
  jurisdiction: Jurisdiction;
  accounting_topic?: string;
};

export type ChatResponse = {
  conversation_id: number;
  message_id: number;
  answer: string;
  structured: null;
  requires_human_review: boolean;
  caveats: string | null;
  conversation: AccountingConversation;
  user_message: AccountingMessage;
  assistant_message: AccountingMessage;
};

export const accountingAssistantApi = {
  conversations: (companyId: string) => request<AccountingConversation[]>('/conversations', companyId, {}, ROOT),
  messages: (companyId: string, conversationId: number) =>
    request<AccountingMessage[]>(`/conversations/${conversationId}/messages`, companyId, {}, ROOT),
  deleteConversation: (companyId: string, conversationId: number) =>
    request<void>(`/conversations/${conversationId}`, companyId, { method: 'DELETE' }, ROOT),
  send: (companyId: string, body: ChatRequest) =>
    request<ChatResponse>('/chat', companyId, { method: 'POST', body: JSON.stringify(body) }, ROOT),
};
