import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { caroApi, type CaroAnswer, type CaroItem, type Engagement } from '../../services/internalAudit.service';
import { ErrorBanner, errorText, inputCls, useAuditCompanyId } from './shared';

const ANSWERS: { value: CaroAnswer; label: string; active: string }[] = [
  { value: 'yes', label: 'Yes', active: 'bg-green-600 border-green-600 text-white' },
  { value: 'no', label: 'No', active: 'bg-red-600 border-red-600 text-white' },
  { value: 'na', label: 'N/A', active: 'bg-slate-500 border-slate-500 text-white' },
];

const CLAUSE_BADGE: Record<CaroAnswer | 'none', string> = {
  yes: 'bg-green-100 text-green-700 border border-green-200',
  no: 'bg-red-100 text-red-700 border border-red-200',
  na: 'bg-slate-100 text-slate-600 border border-slate-200',
  none: 'bg-transparent text-amber-700 border border-amber-300',
};

const SAVE_DELAY_MS = 600;

export default function CaroChecklistPage() {
  const companyId = useAuditCompanyId();
  const engagementId = Number(useParams<{ eid: string }>().eid);
  const [engagement, setEngagement] = useState<Engagement | null>(null);
  const [items, setItems] = useState<CaroItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!Number.isInteger(engagementId)) {
      setError('Invalid engagement');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await caroApi.checklist(companyId, engagementId);
      setEngagement(res.engagement);
      setItems(res.clauses);
    } catch (e) {
      setError(errorText(e, 'Failed to load the CARO checklist'));
    } finally {
      setLoading(false);
    }
  }, [companyId, engagementId]);

  useEffect(() => { void load(); }, [load]);

  const patch = useCallback(
    (clauseId: number, fields: Partial<CaroItem>) =>
      setItems((cur) => cur.map((it) => (it.clause_id === clauseId ? { ...it, ...fields } : it))),
    [],
  );

  const counts = { yes: 0, no: 0, na: 0, none: 0 };
  for (const it of items) counts[it.response ?? 'none'] += 1;
  const answered = items.length - counts.none;
  const pct = items.length ? Math.round((answered / items.length) * 100) : 0;

  return (
    <div className="space-y-6">
      <Link to="/internal-audit/engagements" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> Engagements
      </Link>

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-semibold text-foreground">CARO 2020 Checklist</h2>
          <p className="text-sm text-muted-foreground">
            {engagement ? `${engagement.engagement_ref || `IA-${engagement.id}`} · ${engagement.title}` : `Engagement #${engagementId}`}
            {' · '}Companies (Auditor's Report) Order, 2020 — paragraph 3
          </p>
        </div>
        <button onClick={() => void load()} aria-label="Refresh" className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground px-3 py-1.5 rounded-md border border-border hover:bg-muted transition-colors">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <ErrorBanner message={error} />

      {items.length > 0 && (
        <div className="space-y-2">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{answered} of {items.length} clauses completed</span>
            <span>{pct}%</span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div className="h-full bg-green-500 transition-all" style={{ width: `${pct}%` }} />
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <span className={`px-2 py-0.5 rounded ${CLAUSE_BADGE.yes}`}>Yes: {counts.yes}</span>
            <span className={`px-2 py-0.5 rounded ${CLAUSE_BADGE.no}`}>No: {counts.no}</span>
            <span className={`px-2 py-0.5 rounded ${CLAUSE_BADGE.na}`}>N/A: {counts.na}</span>
            <span className={`px-2 py-0.5 rounded ${CLAUSE_BADGE.none}`}>Unanswered: {counts.none}</span>
          </div>
        </div>
      )}

      {loading && items.length === 0 ? (
        <div className="flex items-center justify-center h-40 text-muted-foreground gap-2">
          <RefreshCw className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : (
        <ol className="space-y-3">
          {items.map((it) => (
            <ClauseCard
              key={it.clause_id}
              item={it}
              companyId={companyId}
              engagementId={engagementId}
              onPatch={patch}
              onError={setError}
            />
          ))}
        </ol>
      )}
    </div>
  );
}

type CardProps = {
  item: CaroItem;
  companyId: string;
  engagementId: number;
  onPatch: (clauseId: number, fields: Partial<CaroItem>) => void;
  onError: (message: string) => void;
};

function ClauseCard({ item, companyId, engagementId, onPatch, onError }: CardProps) {
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState(item.explanation ?? '');
  const [saved, setSaved] = useState(false);
  const savedText = useRef(item.explanation ?? '');
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const flash = useRef<ReturnType<typeof setTimeout>>();
  const answerSeq = useRef(0);

  useEffect(() => () => {
    clearTimeout(timer.current);
    clearTimeout(flash.current);
  }, []);

  const chooseAnswer = async (value: CaroAnswer) => {
    const previous = item.response;
    const next = previous === value ? null : value;
    const seq = ++answerSeq.current;
    onPatch(item.clause_id, { response: next });
    try {
      const res = await caroApi.save(companyId, engagementId, item.clause_id, { response: next });
      if (seq === answerSeq.current) {
        onPatch(item.clause_id, { response: res.response, response_id: res.response_id, updated_by: res.updated_by, updated_at: res.updated_at });
      }
    } catch (e) {
      if (seq === answerSeq.current) onPatch(item.clause_id, { response: previous });
      onError(errorText(e, `Could not save the answer to ${item.clause_no}`));
    }
  };

  const saveExplanation = async (text: string) => {
    clearTimeout(timer.current);
    if (text.trim() === savedText.current.trim()) return;
    try {
      const res = await caroApi.save(companyId, engagementId, item.clause_id, { explanation: text });
      savedText.current = text;
      onPatch(item.clause_id, { explanation: res.explanation, response_id: res.response_id, updated_by: res.updated_by, updated_at: res.updated_at });
      setSaved(true);
      clearTimeout(flash.current);
      flash.current = setTimeout(() => setSaved(false), 1500);
    } catch (e) {
      onError(errorText(e, `Could not save the explanation for ${item.clause_no}`));
    }
  };

  const onType = (text: string) => {
    setDraft(text);
    setSaved(false);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void saveExplanation(text), SAVE_DELAY_MS);
  };

  return (
    <li className="rounded-xl border border-border bg-card px-4 py-4 space-y-3">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-3 min-w-0">
          <span className={`shrink-0 px-2 py-0.5 rounded font-mono text-xs font-semibold ${CLAUSE_BADGE[item.response ?? 'none']}`}>
            {item.clause_no}
          </span>
          <p className="font-semibold text-foreground">{item.matter}</p>
        </div>
        <div className="flex gap-1" role="group" aria-label={`Answer for clause ${item.clause_no}`}>
          {ANSWERS.map((a) => {
            const active = item.response === a.value;
            return (
              <button
                key={a.value}
                aria-pressed={active}
                onClick={() => void chooseAnswer(a.value)}
                className={`min-w-14 rounded-md border px-3 py-1 text-xs font-semibold transition-colors ${
                  active ? a.active : 'border-border text-muted-foreground hover:bg-muted'
                }`}
              >
                {a.label}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <p
          className="text-sm text-muted-foreground whitespace-pre-line"
          style={expanded ? undefined : { display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
        >
          {item.description}
        </p>
        <button onClick={() => setExpanded((v) => !v)} className="mt-1 text-xs text-blue-600 hover:underline">
          {expanded ? 'Show less' : 'Show more'}
        </button>
      </div>

      <div className="space-y-1">
        <textarea
          className={inputCls}
          rows={2}
          maxLength={10000}
          value={draft}
          onChange={(e) => onType(e.target.value)}
          onBlur={() => void saveExplanation(draft)}
          placeholder="Add explanation, observations or reference…"
          aria-label={`Explanation for clause ${item.clause_no}`}
        />
        <div className="flex justify-between text-[11px] text-muted-foreground min-h-4">
          <span>
            {item.updated_at &&
              `Updated ${new Date(item.updated_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}${item.updated_by ? ` by ${item.updated_by}` : ''}`}
          </span>
          {saved && <span className="text-green-700">Saved</span>}
        </div>
      </div>
    </li>
  );
}
