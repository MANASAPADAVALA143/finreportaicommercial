import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronRight, RefreshCw, Search, Trash2, Upload } from 'lucide-react';
import { historyApi, type AccountBaseline } from '../../services/internalAudit.service';
import { ErrorBanner, errorText, useAuditCompanyId } from './shared';
import { chunk, parseGLFile, type ParsedGL } from './glFile';

const MIN_MONTHS = 6;
const MAX_MONTHS = 24;
const fmt = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });

export default function BaselinePage() {
  const companyId = useAuditCompanyId();
  const [baseline, setBaseline] = useState<AccountBaseline | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [fileName, setFileName] = useState('');
  const [parsed, setParsed] = useState<ParsedGL | null>(null);
  const [progress, setProgress] = useState('');
  const [uploading, setUploading] = useState(false);
  const [success, setSuccess] = useState('');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setBaseline(await historyApi.baseline(companyId));
    } catch (e) {
      setError(errorText(e, 'Failed to load baseline'));
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => { void load(); }, [load]);

  const onFile = async (file: File | undefined) => {
    setParsed(null);
    setSuccess('');
    setError('');
    if (!file) return;
    setFileName(file.name);
    try {
      setParsed(await parseGLFile(file));
    } catch (e) {
      setError(errorText(e, 'Could not read the file'));
    }
  };

  const upload = async () => {
    if (!parsed?.lines.length) return;
    setUploading(true);
    setError('');
    setSuccess('');
    const parts = chunk(parsed.lines);
    let saved = 0;
    let skipped = 0;
    try {
      for (let i = 0; i < parts.length; i += 1) {
        setProgress(`Uploading ${i + 1} of ${parts.length}…`);
        const res = await historyApi.upload(companyId, parts[i], i === parts.length - 1);
        saved += res.saved;
        skipped += res.skipped_duplicates;
      }
      const fresh = await historyApi.baseline(companyId);
      setBaseline(fresh);
      setSuccess(
        `Baseline set for ${fresh.accounts_count} accounts across ${fresh.months_count} months` +
          ` (${fmt.format(saved)} new lines${skipped ? `, ${fmt.format(skipped)} duplicates skipped` : ''}).`,
      );
      setParsed(null);
      setFileName('');
    } catch (e) {
      setError(errorText(e, 'Upload failed'));
    } finally {
      setUploading(false);
      setProgress('');
    }
  };

  const reset = async () => {
    if (!window.confirm('Delete all historical journal lines and the baseline for this company?')) return;
    setError('');
    setSuccess('');
    try {
      await historyApi.reset(companyId);
      await load();
    } catch (e) {
      setError(errorText(e, 'Reset failed'));
    }
  };

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    const rows = baseline?.accounts ?? [];
    if (!term) return rows;
    return rows.filter((a) => [a.account, a.account_name].some((v) => (v ?? '').toLowerCase().includes(term)));
  }, [baseline, search]);

  const monthWarning = parsed && parsed.months.length > 0
    ? parsed.months.length < MIN_MONTHS
      ? `This file covers ${parsed.months.length} month(s). Load at least ${MIN_MONTHS} months for a reliable baseline.`
      : parsed.months.length > MAX_MONTHS
        ? `This file covers ${parsed.months.length} months. Activity older than ${MAX_MONTHS} months may not reflect current patterns.`
        : ''
    : '';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Historical Baseline</h2>
          <p className="text-sm text-muted-foreground">
            Load 6–24 months of general ledger lines. Each account's normal monthly range becomes the yardstick
            for flagging unusual journal entries.
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => void load()} aria-label="Refresh" className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground px-3 py-1.5 rounded-md border border-border hover:bg-muted transition-colors">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
          {!!baseline?.accounts_count && (
            <button onClick={() => void reset()} className="flex items-center gap-1.5 text-sm text-red-600 px-3 py-1.5 rounded-md border border-red-200 hover:bg-red-50 transition-colors">
              <Trash2 className="h-3.5 w-3.5" /> Reset
            </button>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div className="flex items-center gap-3 flex-wrap">
          <label className="flex items-center gap-1.5 cursor-pointer bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-1.5 rounded-md transition-colors">
            <Upload className="h-4 w-4" /> Choose GL file
            <input
              type="file"
              accept=".csv,.xlsx,.xls"
              className="hidden"
              onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ''; }}
            />
          </label>
          <span className="text-sm text-muted-foreground">
            {fileName || 'CSV or Excel with Journal ID, Posting date, Account, Account name and Amount (or Debit/Credit).'}
          </span>
        </div>

        {parsed && (
          <div className="space-y-3 text-sm">
            {parsed.missing.length > 0 ? (
              <ErrorBanner message={`Missing columns: ${parsed.missing.join(', ')}. Found: ${parsed.columns.join(', ') || 'none'}.`} />
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Stat label="Journal lines" value={fmt.format(parsed.lines.length)} />
                <Stat label="Rows skipped" value={fmt.format(parsed.skipped)} hint="missing date, account or amount" />
                <Stat label="Months" value={String(parsed.months.length)} hint={parsed.months.length ? `${parsed.months[0]} → ${parsed.months[parsed.months.length - 1]}` : ''} />
                <Stat label="Accounts" value={fmt.format(new Set(parsed.lines.map((l) => l.account)).size)} />
              </div>
            )}
            {monthWarning && <div className="rounded-lg bg-amber-50 border border-amber-200 text-amber-800 p-3">{monthWarning}</div>}
            {parsed.lines.length > 0 && (
              <button
                onClick={() => void upload()}
                disabled={uploading}
                className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-md disabled:opacity-50 transition-colors"
              >
                {uploading ? progress || 'Uploading…' : `Set baseline from ${fmt.format(parsed.lines.length)} lines`}
              </button>
            )}
          </div>
        )}

        {success && (
          <div className="flex items-center gap-2 rounded-lg bg-green-50 border border-green-200 text-green-800 text-sm p-3">
            <CheckCircle2 className="h-4 w-4" /> {success}
          </div>
        )}
      </div>

      <ErrorBanner message={error} />

      {baseline && baseline.accounts_count > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{baseline.accounts_count} accounts</span> across{' '}
              <span className="font-medium text-foreground">{baseline.months_count} months</span>
              {baseline.months.length > 0 && ` (${baseline.months[0]} → ${baseline.months[baseline.months.length - 1]})`}.
              Alert threshold = monthly average + {baseline.z_threshold}σ.
            </p>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                className="rounded-md border border-border bg-background pl-8 pr-3 py-1.5 text-sm w-64"
                placeholder="Search account…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
          {baseline.warnings.map((w) => (
            <div key={w} className="rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm p-3">{w}</div>
          ))}
          <div className="rounded-xl border border-border bg-card overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 w-6" />
                  <th className="px-3 py-2 text-left">Account</th>
                  <th className="px-3 py-2 text-right">Months</th>
                  <th className="px-3 py-2 text-right">Entries</th>
                  <th className="px-3 py-2 text-right">Avg monthly</th>
                  <th className="px-3 py-2 text-right">Std dev</th>
                  <th className="px-3 py-2 text-right">Min month</th>
                  <th className="px-3 py-2 text-right">Max month</th>
                  <th className="px-3 py-2 text-right">Alert above</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((a) => {
                  const open = expanded === a.account;
                  const peak = Math.max(...a.monthly.map((m) => m.total), 1);
                  return (
                    <Fragment key={a.account}>
                      <tr className="border-t border-border hover:bg-muted/30 cursor-pointer" onClick={() => setExpanded(open ? null : a.account)}>
                        <td className="px-3 py-2 text-muted-foreground">
                          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                        </td>
                        <td className="px-3 py-2">
                          <span className="font-mono">{a.account}</span>
                          {a.account_name && <span className="ml-2 text-muted-foreground">{a.account_name}</span>}
                        </td>
                        <td className="px-3 py-2 text-right">{a.months}</td>
                        <td className="px-3 py-2 text-right">{fmt.format(a.entry_count)}</td>
                        <td className="px-3 py-2 text-right">{fmt.format(a.avg_monthly_total)}</td>
                        <td className="px-3 py-2 text-right">{fmt.format(a.std_monthly_total)}</td>
                        <td className="px-3 py-2 text-right">{fmt.format(a.min_monthly_total)}</td>
                        <td className="px-3 py-2 text-right">{fmt.format(a.max_monthly_total)}</td>
                        <td className="px-3 py-2 text-right font-medium">{fmt.format(a.alert_threshold)}</td>
                      </tr>
                      {open && (
                        <tr className="border-t border-border bg-muted/20">
                          <td />
                          <td colSpan={8} className="px-3 py-3">
                            <div className="space-y-1">
                              {a.monthly.map((m) => (
                                <div key={m.month} className="flex items-center gap-3 text-xs">
                                  <span className="w-16 font-mono text-muted-foreground">{m.month}</span>
                                  <div className="flex-1 h-2 rounded bg-muted overflow-hidden">
                                    <div
                                      className={`h-full ${m.total > a.alert_threshold ? 'bg-red-500' : 'bg-blue-500'}`}
                                      style={{ width: `${(m.total / peak) * 100}%` }}
                                    />
                                  </div>
                                  <span className="w-28 text-right">{fmt.format(m.total)}</span>
                                  <span className="w-20 text-right text-muted-foreground">{m.count} lines</span>
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {baseline && baseline.accounts_count === 0 && !loading && (
        <div className="rounded-xl border-2 border-dashed border-border py-12 text-center text-sm text-muted-foreground">
          No baseline yet. Upload at least {MIN_MONTHS} months of GL lines to start.
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-border bg-background p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold text-foreground">{value}</p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
