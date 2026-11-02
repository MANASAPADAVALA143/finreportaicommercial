import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { AlertTriangle, Check, Copy, MessageSquare, PanelLeft, Plus, Send, Trash2 } from 'lucide-react';
import { useCompany } from '../../context/CompanyContext';
import {
  JURISDICTIONS,
  accountingAssistantApi,
  type AccountingConversation,
  type AccountingMessage,
  type Jurisdiction,
} from '../../services/accountingAssistant.service';
import { APChatMarkdown } from '../../components/chat/APChatMarkdown';
import { ErrorBanner, errorText } from '../internal-audit/shared';

const SUGGESTIONS = [
  'Explain the IFRS 15 five-step revenue recognition model',
  'How do we identify a lease under IFRS 16?',
  'Explain the accounting treatment of lease modifications',
  'What is the difference between IFRS 15 and ASC 606?',
  'How should variable consideration be accounted for?',
  'Explain the treatment of right-of-use assets',
];
const MAX_CHARS = 8000;
const LONG_HINT_AT = 800;
const PENDING_ID = -1;

function shortDate(iso: string | null) {
  return iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '';
}

export default function TechnicalAccountingAssistantPage() {
  const { activeCompanyId, loading: companyLoading } = useCompany();
  const companyId = activeCompanyId ?? '';

  const [conversations, setConversations] = useState<AccountingConversation[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [messages, setMessages] = useState<AccountingMessage[]>([]);
  const [jurisdiction, setJurisdiction] = useState<Jurisdiction>('IFRS');
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [waitingIn, setWaitingIn] = useState<number | null>(null);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [error, setError] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const activeRef = useRef<number | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);

  const loadConversations = useCallback(async () => {
    if (!companyId) return;
    try {
      setConversations(await accountingAssistantApi.conversations(companyId));
    } catch (e) {
      setError(errorText(e, 'Failed to load conversations'));
    }
  }, [companyId]);

  useEffect(() => {
    setActiveId(null);
    activeRef.current = null;
    setMessages([]);
    void loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, sending]);

  useEffect(() => {
    const el = textarea.current;
    if (!el) return;
    el.style.height = 'auto';
    const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 20;
    el.style.height = `${Math.min(el.scrollHeight, lineHeight * 4 + 16)}px`;
  }, [input]);

  const startNew = () => {
    activeRef.current = null;
    setActiveId(null);
    setMessages([]);
    setError('');
    setShowHistory(false);
    textarea.current?.focus();
  };

  const openConversation = async (c: AccountingConversation) => {
    activeRef.current = c.id;
    setActiveId(c.id);
    setMessages([]);
    setError('');
    setShowHistory(false);
    if (c.jurisdiction) setJurisdiction(c.jurisdiction);
    setLoadingMessages(true);
    try {
      const rows = await accountingAssistantApi.messages(companyId, c.id);
      if (activeRef.current === c.id) setMessages(rows);
    } catch (e) {
      if (activeRef.current === c.id) setError(errorText(e, 'Failed to load this conversation'));
    } finally {
      if (activeRef.current === c.id) setLoadingMessages(false);
    }
  };

  const removeConversation = async (c: AccountingConversation) => {
    if (!window.confirm(`Delete "${c.title || 'Untitled'}"? This cannot be undone.`)) return;
    try {
      await accountingAssistantApi.deleteConversation(companyId, c.id);
      setConversations((cur) => cur.filter((x) => x.id !== c.id));
      if (activeRef.current === c.id) startNew();
    } catch (e) {
      setError(errorText(e, 'Delete failed'));
    }
  };

  const send = async (text: string) => {
    const question = text.trim();
    if (!question || sending || !companyId) return;
    const conversationId = activeRef.current;
    setError('');
    setSending(true);
    setWaitingIn(conversationId);
    setInput('');
    setMessages((cur) => [
      ...cur,
      { id: PENDING_ID, conversation_id: conversationId ?? 0, role: 'user', content: question, created_at: null },
    ]);
    try {
      const res = await accountingAssistantApi.send(companyId, {
        conversation_id: conversationId,
        message: question,
        jurisdiction,
      });
      setConversations((cur) => [res.conversation, ...cur.filter((c) => c.id !== res.conversation_id)]);
      if (activeRef.current !== conversationId) return;
      activeRef.current = res.conversation_id;
      setActiveId(res.conversation_id);
      setMessages((cur) => [...cur.filter((m) => m.id !== PENDING_ID), res.user_message, res.assistant_message]);
    } catch (e) {
      if (activeRef.current === conversationId) {
        setMessages((cur) => cur.filter((m) => m.id !== PENDING_ID));
        setInput(question);
        setError(errorText(e, 'The assistant could not answer. Try again.'));
      }
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send(input);
    }
  };

  if (!companyId) {
    return (
      <div className="rounded-xl border-2 border-dashed border-border py-16 text-center text-sm text-muted-foreground">
        {companyLoading ? 'Loading companies…' : 'Select a company in the top banner to use the accounting assistant.'}
      </div>
    );
  }

  const empty = messages.length === 0 && !loadingMessages;

  return (
    <div className="flex h-[calc(100vh-13rem)] min-h-[520px] rounded-xl border border-border bg-card overflow-hidden">
      <aside
        className={`${showHistory ? 'flex' : 'hidden'} md:flex w-full md:w-64 shrink-0 flex-col border-r border-border bg-muted/20`}
        aria-label="Conversation history"
      >
        <div className="p-3 border-b border-border">
          <button
            onClick={startNew}
            className="flex w-full items-center justify-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-3 py-2 rounded-md transition-colors"
          >
            <Plus className="h-4 w-4" /> New Conversation
          </button>
        </div>
        <ul className="flex-1 overflow-y-auto p-2 space-y-1">
          {conversations.length === 0 && (
            <li className="px-2 py-4 text-xs text-muted-foreground text-center">No conversations yet.</li>
          )}
          {conversations.map((c) => (
            <li key={c.id}>
              <div
                className={`group flex items-start gap-2 rounded-md px-2 py-2 text-sm cursor-pointer ${
                  c.id === activeId ? 'bg-blue-600/10 text-foreground' : 'hover:bg-muted text-muted-foreground'
                }`}
                onClick={() => void openConversation(c)}
                onKeyDown={(e) => { if (e.key === 'Enter') void openConversation(c); }}
                role="button"
                tabIndex={0}
                aria-current={c.id === activeId}
              >
                <MessageSquare className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className={`truncate ${c.id === activeId ? 'font-medium' : ''}`} title={c.title || 'Untitled'}>
                    {c.title || 'Untitled'}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {[c.jurisdiction, shortDate(c.updated_at)].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); void removeConversation(c); }}
                  aria-label={`Delete ${c.title || 'conversation'}`}
                  className="p-1 rounded text-muted-foreground opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-red-600"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      </aside>

      <section className={`${showHistory ? 'hidden' : 'flex'} md:flex flex-1 min-w-0 flex-col`}>
        <header className="flex items-center gap-2 border-b border-border px-4 py-3">
          <button
            onClick={() => setShowHistory(true)}
            className="md:hidden p-1.5 rounded-md text-muted-foreground hover:bg-muted"
            aria-label="Show conversation history"
          >
            <PanelLeft className="h-4 w-4" />
          </button>
          <h2 className="flex-1 truncate font-semibold text-foreground">Technical Accounting AI Assistant</h2>
          <select
            value={jurisdiction}
            onChange={(e) => setJurisdiction(e.target.value as Jurisdiction)}
            aria-label="Jurisdiction"
            className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
          >
            {JURISDICTIONS.map((j) => <option key={j}>{j}</option>)}
          </select>
          <button onClick={startNew} aria-label="New conversation" title="New conversation" className="p-1.5 rounded-md text-muted-foreground hover:bg-muted">
            <Plus className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {loadingMessages && <p className="text-sm text-muted-foreground">Loading conversation…</p>}
          {empty && (
            <div className="mx-auto max-w-2xl pt-6 text-center">
              <p className="text-sm text-muted-foreground mb-4">
                Ask a technical accounting question. Answers prioritise {jurisdiction} and flag references that need verification.
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => void send(s)}
                    disabled={sending}
                    className="rounded-full border border-border bg-background px-3 py-1.5 text-xs text-foreground hover:border-blue-300 hover:bg-blue-50 disabled:opacity-50 transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m) =>
            m.role === 'user' ? (
              <div key={m.id} className="flex justify-end">
                <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-blue-600 px-4 py-2.5 text-sm text-white whitespace-pre-wrap">
                  {m.content}
                </div>
              </div>
            ) : (
              <AssistantMessage key={m.id} message={m} />
            ),
          )}
          {sending && waitingIn === activeId && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
              <span className="flex gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground animate-bounce" />
                <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground animate-bounce [animation-delay:150ms]" />
                <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground animate-bounce [animation-delay:300ms]" />
              </span>
              Researching… detailed answers can take up to a minute.
            </div>
          )}
          <div ref={bottom} />
        </div>

        <div className="border-t border-border p-3 space-y-2">
          <ErrorBanner message={error} />
          <div className="flex items-end gap-2">
            <textarea
              ref={textarea}
              rows={1}
              value={input}
              maxLength={MAX_CHARS}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Ask about IFRS 15, IFRS 16, Ind AS, US GAAP… (Shift+Enter for a new line)"
              aria-label="Your question"
              className="flex-1 resize-none rounded-md border border-border bg-background px-3 py-2 text-sm leading-5 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={() => void send(input)}
              disabled={sending || !input.trim()}
              aria-label="Send"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
          {input.length > LONG_HINT_AT && (
            <p className="text-right text-[11px] text-muted-foreground">{input.length.toLocaleString()} / {MAX_CHARS.toLocaleString()} characters</p>
          )}
        </div>
      </section>
    </div>
  );
}

function AssistantMessage({ message }: { message: AccountingMessage }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="flex justify-start">
      <div className="max-w-[90%] rounded-2xl rounded-bl-sm border border-border bg-white px-4 py-3 shadow-sm">
        <div className="mb-2 flex items-center justify-between gap-3">
          {message.requires_human_review ? (
            <span className="inline-flex items-center gap-1 rounded bg-amber-50 border border-amber-200 px-2 py-0.5 text-[11px] font-medium text-amber-700">
              <AlertTriangle className="h-3 w-3" /> Requires professional review
            </span>
          ) : <span />}
          <button onClick={() => void copy()} aria-label="Copy answer" className="p-1 rounded text-muted-foreground hover:bg-muted">
            {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
        </div>
        <APChatMarkdown content={message.content} />
        {message.caveats && <p className="mt-3 border-t border-border pt-2 text-[11px] text-muted-foreground">{message.caveats}</p>}
      </div>
    </div>
  );
}
