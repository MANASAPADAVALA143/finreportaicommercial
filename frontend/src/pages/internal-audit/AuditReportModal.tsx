import { useState } from 'react';
import { Download } from 'lucide-react';
import { useCompany } from '../../context/CompanyContext';
import { engagementsApi, type Engagement } from '../../services/internalAudit.service';
import { ErrorBanner, Field, Modal, errorText, inputCls, useAuditCompanyId } from './shared';

type PeriodMode = 'quarter' | 'month' | 'year' | 'none';

const MODES: { value: PeriodMode; label: string }[] = [
  { value: 'quarter', label: 'By quarter' },
  { value: 'month', label: 'By month' },
  { value: 'year', label: 'Full year' },
  { value: 'none', label: 'Skip JE section' },
];
const MONTHS = Array.from({ length: 12 }, (_, i) => ({
  value: String(i + 1).padStart(2, '0'),
  label: new Date(2000, i, 1).toLocaleString('en', { month: 'long' }),
}));

function buildPeriod(mode: PeriodMode, year: string, quarter: string, month: string): string | null {
  if (mode === 'quarter') return `${year}-Q${quarter}`;
  if (mode === 'month') return `${year}-${month}`;
  if (mode === 'year') return year;
  return null;
}

export function AuditReportModal({ engagement, onClose }: { engagement: Engagement; onClose: () => void }) {
  const companyId = useAuditCompanyId();
  const { activeCompany } = useCompany();
  const now = new Date();
  const thisYear = now.getFullYear();

  const [mode, setMode] = useState<PeriodMode>('quarter');
  const [year, setYear] = useState(String(thisYear));
  const [quarter, setQuarter] = useState(String(Math.floor(now.getMonth() / 3) + 1));
  const [month, setMonth] = useState(String(now.getMonth() + 1).padStart(2, '0'));
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');

  const period = buildPeriod(mode, year, quarter, month);

  const download = async () => {
    setDownloading(true);
    setError('');
    try {
      await engagementsApi.downloadReport(companyId, engagement, period, activeCompany?.company_name ?? undefined);
      onClose();
    } catch (e) {
      setError(errorText(e, 'Report generation failed'));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Modal
      title="Download Internal Audit Report"
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className="px-4 py-2 text-sm text-muted-foreground border border-border rounded-md">Cancel</button>
          <button
            onClick={() => void download()}
            disabled={downloading}
            className="flex items-center gap-1.5 px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-md disabled:opacity-50 transition-colors"
          >
            <Download className="h-3.5 w-3.5" /> {downloading ? 'Generating…' : 'Download PDF'}
          </button>
        </>
      }
    >
      <div className="p-6 space-y-5">
        <div className="rounded-lg border border-border bg-muted/30 p-4">
          <p className="text-sm font-semibold text-foreground">{engagement.title}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {engagement.engagement_ref || `IA-${engagement.id}`} · {engagement.status} · {engagement.findings_count ?? 0} finding(s)
          </p>
        </div>

        <div>
          <p className="block text-xs font-medium text-muted-foreground mb-2">Journal entry anomalies (JE review queue)</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2" role="radiogroup" aria-label="JE anomaly period">
            {MODES.map((m) => (
              <button
                key={m.value}
                role="radio"
                aria-checked={mode === m.value}
                onClick={() => setMode(m.value)}
                className={`rounded-md border px-3 py-2 text-xs font-medium transition-colors ${
                  mode === m.value ? 'border-blue-600 bg-blue-600 text-white' : 'border-border text-muted-foreground hover:bg-muted'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        {mode !== 'none' && (
          <div className="grid grid-cols-2 gap-4">
            <Field label="Year">
              <select className={inputCls} value={year} onChange={(e) => setYear(e.target.value)}>
                {[thisYear - 2, thisYear - 1, thisYear, thisYear + 1].map((y) => <option key={y}>{y}</option>)}
              </select>
            </Field>
            {mode === 'quarter' && (
              <Field label="Quarter">
                <select className={inputCls} value={quarter} onChange={(e) => setQuarter(e.target.value)}>
                  {['1', '2', '3', '4'].map((q) => <option key={q} value={q}>Q{q}</option>)}
                </select>
              </Field>
            )}
            {mode === 'month' && (
              <Field label="Month">
                <select className={inputCls} value={month} onChange={(e) => setMonth(e.target.value)}>
                  {MONTHS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </Field>
            )}
          </div>
        )}

        <div className="rounded-lg border border-border p-4 text-xs text-muted-foreground space-y-1">
          <p className="font-semibold text-foreground">The report includes</p>
          <p>Cover page with engagement details, scope and objectives</p>
          <p>Executive summary with finding counts by status and risk</p>
          <p>Every finding in risk order, with recommendations and management responses</p>
          <p>Corrective action tracker with overdue actions flagged</p>
          {period
            ? <p>Flagged journal entries posted in <span className="font-mono text-foreground">{period}</span></p>
            : <p>No journal entry section</p>}
          <p>Auditor sign-off</p>
        </div>

        <ErrorBanner message={error} />
      </div>
    </Modal>
  );
}
