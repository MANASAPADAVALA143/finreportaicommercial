import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';

const STORAGE_KEY = 'gulftax_einvoicing_mini_readiness';

type Answers = {
  revenue: 'large' | 'mid' | 'small' | '';
  erp: 'enterprise' | 'sme' | 'manual' | '';
  asp: 'yes' | 'progress' | 'no' | '';
};

type Gap = { text: string; level: 'critical' | 'high' | 'medium' };

function loadAnswers(): Answers | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Answers) : null;
  } catch {
    return null;
  }
}

function computeScore(a: Answers): { score: number; badge: string; gaps: Gap[] } {
  let score = 100;
  const gaps: Gap[] = [];

  if (a.revenue === 'large') {
    if (a.asp === 'no') {
      score -= 40;
      gaps.push({ level: 'critical', text: '⚠️ No ASP appointed — appoint before Oct 2026' });
    } else if (a.asp === 'progress') {
      score -= 20;
      gaps.push({ level: 'high', text: '⚠️ ASP selection in progress — target sign-off by Jul 2026' });
    }
  } else if (a.revenue === 'mid' && a.asp === 'no') {
    score -= 25;
    gaps.push({ level: 'high', text: '⚠️ No ASP appointed — plan before Jan 2027 mandate' });
  }

  if (a.erp === 'manual') {
    score -= 30;
    gaps.push({ level: 'critical', text: '⚠️ Manual invoicing — migrate to ERP with Peppol capability' });
  } else if (a.erp === 'sme') {
    score -= 15;
    gaps.push({ level: 'medium', text: '⚠️ Confirm your accounting software supports PINT AE export' });
  }

  if (a.asp === 'no' && !gaps.some((g) => g.text.includes('ASP'))) {
    gaps.push({ level: 'high', text: '⚠️ No ASP appointed — required for Phase 1 businesses' });
    score -= 20;
  }

  score = Math.max(0, Math.min(100, score));
  const badge = score >= 70 ? '🟢 Ready' : score >= 45 ? '🟡 Partial' : '🔴 Action Needed';
  return { score, badge, gaps: gaps.slice(0, 3) };
}

export function EInvoicingReadinessMini() {
  const [answers, setAnswers] = useState<Answers | null>(loadAnswers);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [draft, setDraft] = useState<Answers>({
    revenue: '',
    erp: '',
    asp: '',
  });

  useEffect(() => {
    if (!answers) setWizardOpen(true);
  }, [answers]);

  const save = () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
    setAnswers(draft);
    setWizardOpen(false);
  };

  const { score, badge, gaps } = answers
    ? computeScore(answers)
    : { score: 0, badge: '—', gaps: [] as Gap[] };

  return (
    <>
      <div className="mt-3 pt-3 border-t border-[rgba(78,168,255,0.14)] space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-muted uppercase tracking-wide">Quick readiness</span>
          <span className="text-xs font-semibold">{badge}</span>
        </div>
        {answers && (
          <>
            <div className="text-[11px] font-mono text-muted">Score: {score}/100</div>
            {gaps.length > 0 && (
              <ul className="text-[11px] text-amber space-y-1">
                {gaps.map((g, i) => (
                  <li key={i}>{g.text}</li>
                ))}
              </ul>
            )}
          </>
        )}
        <div className="flex gap-2 flex-wrap">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="text-[10px] h-7 border-border-g text-gold"
            onClick={() => {
              setDraft(answers ?? { revenue: '', erp: '', asp: '' });
              setWizardOpen(true);
            }}
          >
            {answers ? 'Update answers' : 'Take 3-question check'}
          </Button>
          <Link
            to="/gulftax/e-invoicing"
            className="inline-flex items-center px-2.5 py-1 rounded text-[10px] font-semibold border border-border-g text-gold hover:bg-gold-pale"
          >
            Full Readiness Assessment →
          </Link>
        </div>
      </div>

      <Dialog open={wizardOpen} onOpenChange={setWizardOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>E-Invoicing Quick Check (3 questions)</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Annual revenue (AED)</Label>
              <select
                className="w-full rounded-md border px-3 py-2 text-sm"
                value={draft.revenue}
                onChange={(e) => setDraft({ ...draft, revenue: e.target.value as Answers['revenue'] })}
              >
                <option value="">Select…</option>
                <option value="large">&gt; AED 150M (Phase 1 — Oct 2026)</option>
                <option value="mid">AED 50M – 150M (Phase 2 — Jan 2027)</option>
                <option value="small">&lt; AED 50M</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label>ERP / billing system</Label>
              <select
                className="w-full rounded-md border px-3 py-2 text-sm"
                value={draft.erp}
                onChange={(e) => setDraft({ ...draft, erp: e.target.value as Answers['erp'] })}
              >
                <option value="">Select…</option>
                <option value="enterprise">SAP / Oracle / D365</option>
                <option value="sme">Tally / Zoho / QuickBooks</option>
                <option value="manual">Manual / Excel / PDF</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label>Accredited ASP appointed?</Label>
              <select
                className="w-full rounded-md border px-3 py-2 text-sm"
                value={draft.asp}
                onChange={(e) => setDraft({ ...draft, asp: e.target.value as Answers['asp'] })}
              >
                <option value="">Select…</option>
                <option value="yes">Yes — ASP on file</option>
                <option value="progress">In progress</option>
                <option value="no">No</option>
              </select>
            </div>
            <Button
              type="button"
              className="w-full bg-[#1E3A5F]"
              disabled={!draft.revenue || !draft.erp || !draft.asp}
              onClick={save}
            >
              Save & show score
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
