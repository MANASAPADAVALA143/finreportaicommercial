import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileSpreadsheet, FileText, Flag, RefreshCw, Save, Sparkles, Upload } from 'lucide-react';
import {
  REVIEW_SEVERITIES,
  REVIEW_STATUSES,
  engagementsApi,
  findingsApi,
  historyApi,
  jeReviewsApi,
  type Engagement,
  type JEReview,
  type ReviewFilters,
  type ReviewSeverity,
  type ReviewStatus,
  type ReviewSummary,
} from '../../services/internalAudit.service';
import { useCompany } from '../../context/CompanyContext';
import { Badge, ErrorBanner, Field, Modal, RISK_BADGE, errorText, inputCls, useAuditCompanyId } from './shared';
import { parseGLFile } from './glFile';

const REVIEW_STATUS_BADGE: Record<string, string> = {
  Open: 'bg-red-50 text-red-600',
  'Under Review': 'bg-blue-50 text-blue-600',
  Cleared: 'bg-green-50 text-green-700',
};

const SEVERITY_RANGE: Record<ReviewSeverity, string> = {
  Critical: 'score above 85',
  High: 'score 70–85',
  Medium: 'score 60–70',
};

const fmt = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });

export default function JEReviewPage() {
  const companyId = useAuditCompanyId();
  const { activeCompany } = useCompany();
  const [items, setItems] = useState<JEReview[]>([]);
  const [summary, setSummary] = useState<ReviewSummary | null>(null);
  const [engagements, setEngagements] = useState<Engagement[]>([]);
  const [findingRefs, setFindingRefs] = useState<Map<number, string>>(new Map());
  const [filters, setFilters] = useState<ReviewFilters>({ status: 'Open' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [analysing, setAnalysing] = useState(false);
  const [exporting, setExporting] = useState<'' | 'pdf' | 'xlsx'>('');
  const [raising, setRaising] = useState<{ review: JEReview; engagementId: string } | null>(null);
  const [raiseError, setRaiseError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [res, engs, finds] = await Promise.all([
        jeReviewsApi.list(companyId, filters),
        engagementsApi.list(companyId),
        findingsApi.list(companyId),
      ]);
      setItems(res.items);
      setSummary(res.summary);
      setEngagements(engs);
      setFindingRefs(new Map(finds.map((f) => [f.id, f.finding_ref || `#${f.id}`])));
    } catch (e) {
      setError(errorText(e, 'Failed to load the review queue'));
    } finally {
      setLoading(false);
    }
  }, [companyId, filters]);

  useEffect(() => { void load(); }, [load]);

  const grouped = useMemo(
    () => REVIEW_SEVERITIES.map((s) => ({ severity: s, rows: items.filter((r) => r.severity === s) })).filter((g) => g.rows.length),
    [items],
  );

  const setFilter = <K extends keyof ReviewFilters>(k: K, v: ReviewFilters[K]) => setFilters((f) => ({ ...f, [k]: v }));

  const replace = (row: JEReview) => setItems((cur) => cur.map((r) => (r.id === row.id ? row : r)));

  const analyse = async (file: File | undefined) => {
    if (!file) return;
    setAnalysing(true);
    setError('');
    setNotice('');
    try {
      const parsed = await parseGLFile(file);
      if (parsed.missing.length) throw new Error(`Missing columns: ${parsed.missing.join(', ')}`);
      if (!parsed.lines.length) throw new Error('No valid journal lines found in the file');
      const res = await historyApi.analyze(companyId, parsed.lines);
      setNotice(`Analysed ${parsed.lines.length} lines — ${res.review_queued} entr${res.review_queued === 1 ? 'y' : 'ies'} scored above 60 and are in the queue.`);
      await load();
    } catch (e) {
      setError(errorText(e, 'Analysis failed'));
    } finally {
      setAnalysing(false);
    }
  };

  const exportAs = async (format: 'pdf' | 'xlsx') => {
    setExporting(format);
    setError('');
    try {
      await jeReviewsApi.download(companyId, format, filters, activeCompany?.company_name ?? undefined);
    } catch (e) {
      setError(errorText(e, 'Export failed'));
    } finally {
      setExporting('');
    }
  };

  const raise = async () => {
    if (!raising) return;
    setRaiseError('');
    try {
      const res = await jeReviewsApi.raiseFinding(
        companyId,
        raising.review.id,
        raising.engagementId ? Number(raising.engagementId) : null,
      );
      replace(res.review);
      setFindingRefs((m) => new Map(m).set(res.finding.id, res.finding.finding_ref || `#${res.finding.id}`));
      setNotice(`Finding ${res.finding.finding_ref} raised for JE ${res.review.journal_id}.`);
      setRaising(null);
    } catch (e) {
      setRaiseError(errorText(e, 'Could not raise the finding'));
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-semibold text-foreground">JE Review Queue</h2>
          <p className="text-sm text-muted-foreground">
            Journal entries the anomaly engine scored above 60, explained against each account's history.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => void load()} aria-label="Refresh" className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground px-3 py-1.5 rounded-md border border-border hover:bg-muted transition-colors">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button onClick={() => void exportAs('pdf')} disabled={!!exporting} className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md border border-border hover:bg-muted disabled:opacity-50 transition-colors">
            <FileText className="h-3.5 w-3.5" /> {exporting === 'pdf' ? 'Preparing…' : 'PDF'}
          </button>
          <button onClick={() => void exportAs('xlsx')} disabled={!!exporting} className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md border border-border hover:bg-muted disabled:opacity-50 transition-colors">
            <FileSpreadsheet className="h-3.5 w-3.5" /> {exporting === 'xlsx' ? 'Preparing…' : 'Excel'}
          </button>
          <label className={`flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-1.5 rounded-md transition-colors ${analysing ? 'opacity-50 pointer-events-none' : 'cursor-pointer'}`}>
            <Upload className="h-4 w-4" /> {analysing ? 'Analysing…' : 'Analyse JE file'}
            <input type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={(e) => { void analyse(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
        </div>
      </div>

      {summary && (
        <div className="grid grid-cols-3 gap-3">
          {REVIEW_SEVERITIES.map((s) => (
            <button
              key={s}
              onClick={() => setFilter('severity', filters.severity === s ? '' : s)}
              className={`rounded-xl border p-4 text-left transition-colors ${filters.severity === s ? 'border-blue-500 ring-2 ring-blue-500/30' : 'border-border hover:bg-muted/40'} bg-card`}
            >
              <div className="flex items-center justify-between">
                <Badge value={s} styles={RISK_BADGE} />
                <span className="text-2xl font-semibold text-foreground">{summary.by_severity[s] ?? 0}</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{SEVERITY_RANGE[s]}</p>
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <select className="rounded-md border border-border bg-background px-3 py-1.5 text-sm" value={filters.status ?? ''} onChange={(e) => setFilter('status', e.target.value as ReviewStatus | '')} aria-label="Filter by status">
          <option value="">All statuses</option>
          {REVIEW_STATUSES.map((s) => <option key={s}>{s}</option>)}
        </select>
        <select className="rounded-md border border-border bg-background px-3 py-1.5 text-sm" value={filters.severity ?? ''} onChange={(e) => setFilter('severity', e.target.value as ReviewSeverity | '')} aria-label="Filter by severity">
          <option value="">All severities</option>
          {REVIEW_SEVERITIES.map((s) => <option key={s}>{s}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
          From
          <input type="date" className="rounded-md border border-border bg-background px-2 py-1 text-sm" value={filters.period_start ?? ''} onChange={(e) => setFilter('period_start', e.target.value)} />
        </label>
        <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
          To
          <input type="date" className="rounded-md border border-border bg-background px-2 py-1 text-sm" value={filters.period_end ?? ''} onChange={(e) => setFilter('period_end', e.target.value)} />
        </label>
        <span className="text-xs text-muted-foreground">Exports use these filters.</span>
      </div>

      {notice && <div className="rounded-lg bg-green-50 border border-green-200 text-green-800 text-sm p-3">{notice}</div>}
      <ErrorBanner message={error} />

      {!loading && items.length === 0 && (
        <div className="rounded-xl border-2 border-dashed border-border py-12 text-center text-sm text-muted-foreground space-y-1">
          <p>No flagged journal entries match these filters.</p>
          <p>
            Set a <Link to="/internal-audit/baseline" className="text-blue-600 hover:underline">historical baseline</Link>, then
            use “Analyse JE file” to score the current period.
          </p>
        </div>
      )}

      {grouped.map(({ severity, rows }) => (
        <section key={severity} className="space-y-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Badge value={severity} styles={RISK_BADGE} /> {rows.length} entr{rows.length === 1 ? 'y' : 'ies'}
          </h3>
          {rows.map((r) => (
            <ReviewCard
              key={r.id}
              review={r}
              companyId={companyId}
              findingRef={r.finding_id != null ? findingRefs.get(r.finding_id) : undefined}
              onSaved={replace}
              onError={setError}
              onRaise={() => { setRaiseError(''); setRaising({ review: r, engagementId: '' }); }}
            />
          ))}
        </section>
      ))}

      {raising && (
        <Modal
          title={`Raise JE ${raising.review.journal_id} as a finding`}
          onClose={() => setRaising(null)}
          footer={
            <>
              {raiseError && <p className="mr-auto text-sm text-red-600">{raiseError}</p>}
              <button onClick={() => setRaising(null)} className="px-4 py-2 text-sm text-muted-foreground border border-border rounded-md">Cancel</button>
              <button onClick={() => void raise()} className="flex items-center gap-1.5 px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors">
                <Flag className="h-3.5 w-3.5" /> Raise finding
              </button>
            </>
          }
        >
          <div className="p-6 space-y-4 text-sm">
            <p className="text-muted-foreground">
              Creates a {raising.review.severity} finding in Findings &amp; CAPA with the explanation, AI observation and your comment.
            </p>
            <Field label="Link to engagement (optional)">
              <select className={inputCls} value={raising.engagementId} onChange={(e) => setRaising({ ...raising, engagementId: e.target.value })}>
                <option value="">Not linked</option>
                {engagements.map((e) => (
                  <option key={e.id} value={e.id}>{e.engagement_ref ? `${e.engagement_ref} — ${e.title}` : e.title}</option>
                ))}
              </select>
            </Field>
          </div>
        </Modal>
      )}
    </div>
  );
}

function ReviewCard({
  review,
  companyId,
  findingRef,
  onSaved,
  onError,
  onRaise,
}: {
  review: JEReview;
  companyId: string;
  findingRef?: string;
  onSaved: (r: JEReview) => void;
  onError: (msg: string) => void;
  onRaise: () => void;
}) {
  const [comment, setComment] = useState(review.auditor_comment ?? '');
  const [saving, setSaving] = useState(false);

  useEffect(() => { setComment(review.auditor_comment ?? ''); }, [review.auditor_comment]);

  const save = async (body: { status?: ReviewStatus; auditor_comment?: string }) => {
    setSaving(true);
    try {
      onSaved(await jeReviewsApi.update(companyId, review.id, body));
    } catch (e) {
      onError(errorText(e, 'Could not update the review'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="font-medium text-foreground">
            JE {review.journal_id}
            <span className="ml-2 font-mono text-sm text-muted-foreground">{review.account}</span>
            {review.account_name && <span className="ml-1 text-sm text-muted-foreground">– {review.account_name}</span>}
          </p>
          <p className="text-xs text-muted-foreground">
            {review.posting_date || 'No date'} · {fmt.format(review.amount)}
            {review.user_id ? ` · posted by ${review.user_id}` : ''} · score {Math.round(review.risk_score)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge value={review.status} styles={REVIEW_STATUS_BADGE} />
          <select
            className="rounded-md border border-border bg-background px-2 py-1 text-sm"
            value={review.status}
            disabled={saving}
            onChange={(e) => void save({ status: e.target.value as ReviewStatus })}
            aria-label="Review status"
          >
            {REVIEW_STATUSES.map((s) => <option key={s}>{s}</option>)}
          </select>
        </div>
      </div>

      {review.explanation && (
        <p className="rounded-lg bg-blue-50 border border-blue-100 text-blue-900 text-sm p-3">{review.explanation}</p>
      )}
      {review.ai_observation && (
        <p className="flex gap-2 text-sm text-foreground">
          <Sparkles className="h-4 w-4 mt-0.5 shrink-0 text-purple-500" />
          <span>{review.ai_observation}</span>
        </p>
      )}
      {!!review.top_reasons?.length && (
        <div className="flex flex-wrap gap-1.5">
          {review.top_reasons.map((t) => (
            <span key={t} className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">{t}</span>
          ))}
        </div>
      )}

      <div className="flex items-end gap-2 flex-wrap">
        <textarea
          className={`${inputCls} flex-1 min-w-[16rem]`}
          rows={2}
          placeholder="Auditor comment — evidence obtained, explanation from management…"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />
        <button
          onClick={() => void save({ auditor_comment: comment })}
          disabled={saving || comment === (review.auditor_comment ?? '')}
          className="flex items-center gap-1.5 px-3 py-2 text-sm border border-border rounded-md hover:bg-muted disabled:opacity-50 transition-colors"
        >
          <Save className="h-3.5 w-3.5" /> Save comment
        </button>
        {findingRef ? (
          <Link to="/internal-audit/findings" className="px-3 py-2 text-sm text-blue-600 hover:underline">
            Finding {findingRef}
          </Link>
        ) : (
          <button onClick={onRaise} className="flex items-center gap-1.5 px-3 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors">
            <Flag className="h-3.5 w-3.5" /> Raise as finding
          </button>
        )}
      </div>
      {review.reviewed_by && (
        <p className="text-xs text-muted-foreground">
          Last reviewed by {review.reviewed_by}
          {review.reviewed_at ? ` on ${review.reviewed_at.slice(0, 10)}` : ''}
        </p>
      )}
    </div>
  );
}
