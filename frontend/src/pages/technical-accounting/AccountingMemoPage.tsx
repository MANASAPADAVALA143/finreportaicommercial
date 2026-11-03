import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle, ChevronDown, ChevronRight, FileText, Loader2, PanelLeft, Plus, Printer, RefreshCw, Sparkles, Trash2,
} from 'lucide-react';
import { useCompany } from '../../context/CompanyContext';
import { JURISDICTIONS, type Jurisdiction } from '../../services/accountingAssistant.service';
import {
  MEMO_SECTIONS,
  MEMO_STATUSES,
  accountingMemoApi,
  type AccountingMemo,
  type MemoSectionKey,
  type MemoStatus,
  type UpdateMemoRequest,
} from '../../services/accountingMemo.service';
import { APChatMarkdown } from '../../components/chat/APChatMarkdown';
import { ErrorBanner, errorText, inputCls } from '../internal-audit/shared';

const TOPICS = [
  'Revenue Recognition',
  'Lease Accounting',
  'Financial Instruments',
  'Business Combinations',
  'Impairment',
  'Share-Based Payments',
  'Other',
];
const SAMPLES = [
  'We are evaluating whether our SaaS subscription contracts contain a lease under IFRS 16',
  'We acquired a subsidiary for consideration of $5m. How do we account for the goodwill?',
  'Our customer contract includes variable consideration tied to usage. How do we estimate and recognise revenue under IFRS 15?',
  'We have a convertible bond. How do we split the liability and equity components?',
];
const MAX_DESCRIPTION = 8000;
const PRINT_ROOT_ID = 'accounting-memo-print';
const STATUS_BADGE: Record<MemoStatus, string> = {
  draft: 'bg-slate-100 text-slate-600 border border-slate-200',
  under_review: 'bg-amber-50 text-amber-700 border border-amber-200',
  finalised: 'bg-green-50 text-green-700 border border-green-200',
};
const STATUS_LABEL = Object.fromEntries(MEMO_STATUSES.map((s) => [s.value, s.label])) as Record<MemoStatus, string>;

function shortDate(iso: string | null) {
  return iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '';
}

function titleFrom(text: string) {
  const t = text.split(/\s+/).filter(Boolean).join(' ');
  return t.length <= 80 ? t : `${t.slice(0, 79).trimEnd()}…`;
}

function StatusBadge({ status }: { status: MemoStatus }) {
  return <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${STATUS_BADGE[status]}`}>{STATUS_LABEL[status]}</span>;
}

export default function AccountingMemoPage() {
  const { activeCompanyId, activeCompany, loading: companyLoading } = useCompany();
  const companyId = activeCompanyId ?? '';

  const [memos, setMemos] = useState<AccountingMemo[]>([]);
  const [memo, setMemo] = useState<AccountingMemo | null>(null);
  const [error, setError] = useState('');
  const [showList, setShowList] = useState(false);
  const activeRef = useRef<number | null>(null);

  const loadMemos = useCallback(async () => {
    if (!companyId) return;
    try {
      setMemos(await accountingMemoApi.list(companyId));
    } catch (e) {
      setError(errorText(e, 'Failed to load memos'));
    }
  }, [companyId]);

  useEffect(() => {
    activeRef.current = null;
    setMemo(null);
    void loadMemos();
  }, [loadMemos]);

  const show = (m: AccountingMemo | null) => {
    activeRef.current = m?.id ?? null;
    setMemo(m);
    setError('');
    setShowList(false);
  };

  const remember = (m: AccountingMemo) => {
    setMemos((cur) => [m, ...cur.filter((x) => x.id !== m.id)]);
    if (activeRef.current === m.id) setMemo(m);
  };

  const removeMemo = async (m: AccountingMemo) => {
    if (!window.confirm(`Delete "${m.title}"? This cannot be undone.`)) return;
    try {
      await accountingMemoApi.remove(companyId, m.id);
      setMemos((cur) => cur.filter((x) => x.id !== m.id));
      if (activeRef.current === m.id) show(null);
    } catch (e) {
      setError(errorText(e, 'Delete failed'));
    }
  };

  /** Saves one change; resolves false (with the error shown) when the server rejects it. */
  const save = async (m: AccountingMemo, body: UpdateMemoRequest) => {
    try {
      remember(await accountingMemoApi.update(companyId, m.id, body));
      return true;
    } catch (e) {
      setError(errorText(e, 'Could not save the change'));
      return false;
    }
  };

  if (!companyId) {
    return (
      <div className="rounded-xl border-2 border-dashed border-border py-16 text-center text-sm text-muted-foreground">
        {companyLoading ? 'Loading companies…' : 'Select a company in the top banner to draft accounting memos.'}
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-13rem)] min-h-[560px] rounded-xl border border-border bg-card overflow-hidden">
      <aside
        className={`${showList ? 'flex' : 'hidden'} md:flex w-full md:w-64 shrink-0 flex-col border-r border-border bg-muted/20`}
        aria-label="Saved memos"
      >
        <div className="p-3 border-b border-border">
          <button
            onClick={() => show(null)}
            className="flex w-full items-center justify-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-3 py-2 rounded-md transition-colors"
          >
            <Plus className="h-4 w-4" /> New Memo
          </button>
        </div>
        <ul className="flex-1 overflow-y-auto p-2 space-y-1">
          {memos.length === 0 && <li className="px-2 py-4 text-xs text-muted-foreground text-center">No memos yet.</li>}
          {memos.map((m) => (
            <li key={m.id}>
              <div
                className={`group flex items-start gap-2 rounded-md px-2 py-2 text-sm cursor-pointer ${
                  m.id === memo?.id ? 'bg-blue-600/10 text-foreground' : 'hover:bg-muted text-muted-foreground'
                }`}
                onClick={() => show(m)}
                onKeyDown={(e) => { if (e.key === 'Enter') show(m); }}
                role="button"
                tabIndex={0}
                aria-current={m.id === memo?.id}
              >
                <FileText className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className={`truncate ${m.id === memo?.id ? 'font-medium' : ''}`} title={m.title}>{m.title}</p>
                  <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <StatusBadge status={m.status} />
                    <span>{shortDate(m.updated_at)}</span>
                  </div>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); void removeMemo(m); }}
                  aria-label={`Delete ${m.title}`}
                  className="p-1 rounded text-muted-foreground opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-red-600"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      </aside>

      <section className={`${showList ? 'hidden' : 'flex'} md:flex flex-1 min-w-0 flex-col`}>
        <button
          onClick={() => setShowList(true)}
          className="md:hidden m-2 mb-0 inline-flex w-fit items-center gap-1.5 rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-muted"
        >
          <PanelLeft className="h-4 w-4" /> Saved memos
        </button>
        {error && <div className="px-4 pt-3"><ErrorBanner message={error} /></div>}
        {memo ? (
          <MemoWorkspace
            key={memo.id}
            memo={memo}
            companyName={activeCompany?.company_name ?? ''}
            onSave={(body) => save(memo, body)}
            onRegenerate={async () => {
              setError('');
              try {
                remember(await accountingMemoApi.regenerate(companyId, memo.id));
              } catch (e) {
                setError(errorText(e, 'Could not redraft the memo'));
              }
            }}
            onNew={() => show(null)}
          />
        ) : (
          <NewMemoForm
            onGenerate={async (body) => {
              setError('');
              try {
                const created = await accountingMemoApi.generate(companyId, body);
                setMemos((cur) => [created, ...cur]);
                show(created);
                return true;
              } catch (e) {
                setError(errorText(e, 'The memo could not be drafted. Try again.'));
                return false;
              }
            }}
          />
        )}
      </section>
    </div>
  );
}

// ── State A: describe the transaction ─────────────────────────────────────────

function NewMemoForm({
  onGenerate,
}: {
  onGenerate: (body: { title: string; transaction_description: string; jurisdiction: Jurisdiction; accounting_topic?: string }) => Promise<boolean>;
}) {
  const [description, setDescription] = useState('');
  const [title, setTitle] = useState('');
  const [titleEdited, setTitleEdited] = useState(false);
  const [jurisdiction, setJurisdiction] = useState<Jurisdiction>('IFRS');
  const [topic, setTopic] = useState('');
  const [generating, setGenerating] = useState(false);

  const describe = (text: string) => {
    setDescription(text);
    if (!titleEdited) setTitle(titleFrom(text));
  };

  const generate = async () => {
    if (!description.trim() || generating) return;
    setGenerating(true);
    const ok = await onGenerate({
      title: title.trim(),
      transaction_description: description.trim(),
      jurisdiction,
      accounting_topic: topic || undefined,
    });
    if (!ok) setGenerating(false);
  };

  return (
    <div className="flex-1 overflow-y-auto px-4 py-6">
      <div className="mx-auto max-w-2xl rounded-xl border border-border bg-background p-6 shadow-sm space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Draft a Technical Accounting Memo</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Describe a transaction and Claude will draft a structured Big-4-quality memo in seconds.
          </p>
        </div>
        <textarea
          rows={5}
          value={description}
          maxLength={MAX_DESCRIPTION}
          onChange={(e) => describe(e.target.value)}
          placeholder="Describe the transaction or accounting issue…"
          aria-label="Transaction description"
          disabled={generating}
          className={`${inputCls} min-h-[7rem] resize-y`}
        />
        <div className="flex flex-wrap gap-2">
          {SAMPLES.map((s) => (
            <button
              key={s}
              onClick={() => describe(s)}
              disabled={generating}
              className="rounded-full border border-border bg-background px-3 py-1.5 text-left text-xs text-foreground hover:border-blue-300 hover:bg-blue-50 disabled:opacity-50 transition-colors"
            >
              {s}
            </button>
          ))}
        </div>
        <label className="block text-sm">
          <span className="mb-1 block text-xs font-medium text-muted-foreground">Memo title</span>
          <input
            value={title}
            maxLength={200}
            onChange={(e) => { setTitle(e.target.value); setTitleEdited(true); }}
            placeholder="Taken from the description if left blank"
            disabled={generating}
            className={inputCls}
          />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">Jurisdiction</span>
            <select value={jurisdiction} onChange={(e) => setJurisdiction(e.target.value as Jurisdiction)} disabled={generating} className={inputCls}>
              {JURISDICTIONS.map((j) => <option key={j}>{j}</option>)}
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">Topic (optional)</span>
            <select value={topic} onChange={(e) => setTopic(e.target.value)} disabled={generating} className={inputCls}>
              <option value="">Not specified</option>
              {TOPICS.map((t) => <option key={t}>{t}</option>)}
            </select>
          </label>
        </div>
        <button
          onClick={() => void generate()}
          disabled={generating || !description.trim()}
          className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {generating ? 'Drafting your memo… this can take up to a minute.' : 'Generate Memo'}
        </button>
      </div>
    </div>
  );
}

// ── State B: review and edit ──────────────────────────────────────────────────

function MemoWorkspace({
  memo,
  companyName,
  onSave,
  onRegenerate,
  onNew,
}: {
  memo: AccountingMemo;
  companyName: string;
  onSave: (body: UpdateMemoRequest) => Promise<boolean>;
  onRegenerate: () => Promise<void>;
  onNew: () => void;
}) {
  const [title, setTitle] = useState(memo.title);
  const [editingTitle, setEditingTitle] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  // Bumped after a redraft so every section drops its local text for the new draft.
  const [draft, setDraft] = useState(0);

  useEffect(() => setTitle(memo.title), [memo.title]);

  const saveTitle = async () => {
    setEditingTitle(false);
    const next = title.trim();
    if (!next || next === memo.title) {
      setTitle(memo.title);
      return;
    }
    if (!(await onSave({ title: next }))) setTitle(memo.title);
  };

  const regenerate = async () => {
    if (!window.confirm('This will overwrite AI-generated sections. Continue?')) return;
    setRegenerating(true);
    await onRegenerate();
    setDraft((d) => d + 1);
    setRegenerating(false);
  };

  return (
    <>
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0 flex-1">
          {editingTitle ? (
            <input
              autoFocus
              value={title}
              maxLength={200}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => void saveTitle()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
                if (e.key === 'Escape') { setTitle(memo.title); setEditingTitle(false); }
              }}
              aria-label="Memo title"
              className={inputCls}
            />
          ) : (
            <button
              onClick={() => setEditingTitle(true)}
              title="Click to rename"
              className="block max-w-full truncate rounded px-1 -mx-1 text-left font-semibold text-foreground hover:bg-muted"
            >
              {memo.title}
            </button>
          )}
          <p className="text-[11px] text-muted-foreground">
            {[memo.jurisdiction, memo.accounting_topic].filter(Boolean).join(' · ')}
          </p>
        </div>
        {memo.requires_partner_review && (
          <span className="inline-flex items-center gap-1 rounded bg-amber-50 border border-amber-200 px-2 py-0.5 text-[11px] font-medium text-amber-700">
            <AlertTriangle className="h-3 w-3" /> Partner review recommended
          </span>
        )}
        <select
          value={memo.status}
          onChange={(e) => void onSave({ status: e.target.value as MemoStatus })}
          aria-label="Memo status"
          className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
        >
          {MEMO_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <button
          onClick={() => window.print()}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-sm text-foreground hover:bg-muted"
        >
          <Printer className="h-4 w-4" /> Export
        </button>
        <button onClick={onNew} aria-label="New memo" title="New memo" className="p-1.5 rounded-md text-muted-foreground hover:bg-muted">
          <Plus className="h-4 w-4" />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {regenerating && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
            <Loader2 className="h-4 w-4 animate-spin" /> Redrafting your memo…
          </p>
        )}
        {MEMO_SECTIONS.map((s) => (
          <MemoSection
            key={`${s.key}-${draft}`}
            label={s.label}
            value={memo[s.key] ?? ''}
            disabled={regenerating}
            onSave={(text) => onSave({ [s.key]: text } as Partial<Record<MemoSectionKey, string>>)}
          />
        ))}
      </div>

      <footer className="flex items-center justify-between gap-2 border-t border-border px-4 py-2.5 text-xs text-muted-foreground">
        <span>Last saved {memo.updated_at ? new Date(memo.updated_at).toLocaleString() : '—'}</span>
        <button
          onClick={() => void regenerate()}
          disabled={regenerating || !memo.transaction_description}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-foreground hover:bg-muted disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${regenerating ? 'animate-spin' : ''}`} /> Regenerate
        </button>
      </footer>

      {createPortal(<MemoPrint memo={memo} companyName={companyName} />, document.body)}
    </>
  );
}

function MemoSection({
  label,
  value,
  disabled,
  onSave,
}: {
  label: string;
  value: string;
  disabled: boolean;
  onSave: (text: string) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(true);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value);
  const [saving, setSaving] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [text, editing]);

  const finish = async () => {
    setEditing(false);
    if (text === value) return;
    setSaving(true);
    if (!(await onSave(text))) setText(value);
    setSaving(false);
  };

  return (
    <div className="rounded-lg border border-border bg-white">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm font-semibold text-foreground"
      >
        {open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        <span className="flex-1">{label}</span>
        {saving && <span className="text-[11px] font-normal text-muted-foreground">Saving…</span>}
      </button>
      {open && (
        <div className="px-4 pb-3">
          {editing ? (
            <textarea
              ref={area}
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              onBlur={() => void finish()}
              aria-label={label}
              className={`${inputCls} resize-none font-mono text-[13px] leading-5`}
            />
          ) : (
            <div
              role="button"
              tabIndex={0}
              onClick={() => !disabled && setEditing(true)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !disabled) setEditing(true); }}
              title="Click to edit"
              className="min-h-[2rem] cursor-text rounded-md px-1 -mx-1 hover:bg-muted/40"
            >
              {text.trim() ? (
                <APChatMarkdown content={text} />
              ) : (
                <p className="text-sm italic text-muted-foreground">Not applicable — click to add.</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Export: printed on its own, everything else on the page is hidden ─────────

function MemoPrint({ memo, companyName }: { memo: AccountingMemo; companyName: string }) {
  return (
    <div id={PRINT_ROOT_ID} className="hidden">
      <style>{`@media print {
  body > *:not(#${PRINT_ROOT_ID}) { display: none !important; }
  #${PRINT_ROOT_ID} { display: block !important; padding: 0 8mm; color: #111827; }
  #${PRINT_ROOT_ID} section { break-inside: auto; }
  #${PRINT_ROOT_ID} h2 { break-after: avoid; }
}`}</style>
      <div className="border-b-2 border-gray-800 pb-3 mb-5">
        <p className="text-sm font-medium text-gray-600">{companyName || 'Company'}</p>
        <p className="mt-1 text-xl font-bold tracking-wide">TECHNICAL ACCOUNTING MEMO</p>
        <p className="mt-1 text-base font-semibold">{memo.title}</p>
        <p className="mt-2 text-xs text-gray-600">
          {[
            `Date: ${new Date(memo.updated_at ?? Date.now()).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}`,
            `Framework: ${memo.jurisdiction ?? 'IFRS'}`,
            memo.accounting_topic ? `Topic: ${memo.accounting_topic}` : '',
            `Status: ${STATUS_LABEL[memo.status]}`,
            memo.requires_partner_review ? 'Partner review recommended' : '',
          ].filter(Boolean).join('   |   ')}
        </p>
      </div>
      {MEMO_SECTIONS.map((s, i) => (
        <section key={s.key} className="mb-5">
          <h2 className="mb-1.5 text-sm font-bold uppercase tracking-wide">{i + 1}. {s.label}</h2>
          {memo[s.key]?.trim() ? <APChatMarkdown content={memo[s.key] ?? ''} /> : <p className="text-sm italic text-gray-500">Not applicable.</p>}
        </section>
      ))}
      <p className="mt-8 border-t border-gray-300 pt-2 text-[11px] text-gray-500">
        This memo was AI-assisted. Verify all standard references against source documents.
      </p>
    </div>
  );
}
