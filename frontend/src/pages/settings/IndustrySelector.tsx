import { useEffect, useState } from 'react';
import { Factory, CheckCircle2, Loader2 } from 'lucide-react';
import { useIndustryConfig } from '../../context/IndustryConfigContext';
import {
  INDUSTRY_CARDS,
  INDUSTRY_PREVIEW,
  type IndustryKey,
} from '../../services/industryConfig.service';
import { useToast } from '../../hooks/use-toast';
import { Button } from '../../components/ui/button';

export default function IndustrySelector() {
  const { industry, setIndustry, refetch, isLoading } = useIndustryConfig();
  const { toast } = useToast();
  const [selected, setSelected] = useState<IndustryKey>(industry || 'general');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (industry) setSelected(industry);
  }, [industry]);

  const onSelect = async (key: IndustryKey) => {
    setSelected(key);
    setSaving(true);
    try {
      await setIndustry(key);
      await refetch();
      toast({
        title: 'Industry updated',
        description: `${INDUSTRY_CARDS.find((c) => c.key === key)?.label || key} is now active.`,
      });
    } catch (e) {
      toast({
        title: 'Could not update industry',
        description: e instanceof Error ? e.message : 'Request failed',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <div className="flex items-start gap-3">
        <Factory className="h-7 w-7 text-teal-600 mt-0.5" />
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Industry & Workspace</h1>
          <p className="text-sm text-slate-500 mt-1">
            Choose your industry to set cost-center labels, AP/AR wording, and compliance modules.
          </p>
        </div>
      </div>

      {(isLoading || saving) && (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          {saving ? 'Saving…' : 'Loading config…'}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {INDUSTRY_CARDS.map((card) => {
          const active = (selected || industry) === card.key;
          const preview = INDUSTRY_PREVIEW[card.key] || INDUSTRY_PREVIEW.general;
          return (
            <button
              key={card.key}
              type="button"
              disabled={saving}
              onClick={() => void onSelect(card.key)}
              className={`text-left rounded-xl border p-4 transition-all ${
                active
                  ? 'border-teal-500 bg-teal-50 ring-2 ring-teal-400/40 shadow-sm'
                  : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="text-2xl">{card.icon}</div>
                {active && <CheckCircle2 className="h-5 w-5 text-teal-600 shrink-0" />}
              </div>
              <div className="font-semibold text-slate-900 mt-2">{card.label}</div>
              <div className="text-xs text-slate-500 mt-1">{card.description}</div>
              <div className="mt-3 text-xs text-slate-600 rounded-md bg-slate-50 border border-slate-100 px-2 py-1.5">
                Cost centers will be called:{' '}
                <span className="font-semibold text-slate-800">{preview.costCenterLabel}</span>
              </div>
            </button>
          );
        })}
      </div>

      <div className="flex gap-2">
        <Button variant="outline" onClick={() => void refetch()} disabled={isLoading || saving}>
          Refresh
        </Button>
      </div>
    </div>
  );
}
