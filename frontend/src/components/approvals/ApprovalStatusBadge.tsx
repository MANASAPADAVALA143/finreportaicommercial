import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const STYLES: Record<string, string> = {
  not_required: 'bg-slate-100 text-slate-700 border-slate-200',
  pending: 'bg-amber-50 text-amber-900 border-amber-200',
  approved: 'bg-green-50 text-green-800 border-green-200',
  rejected: 'bg-red-50 text-red-800 border-red-200',
};

const LABELS: Record<string, string> = {
  not_required: 'Not submitted',
  pending: 'Pending approval',
  approved: 'Approved (chain)',
  rejected: 'Rejected (chain)',
};

export function ApprovalStatusBadge({ status }: { status: string | null | undefined }) {
  const s = status ?? 'not_required';
  return (
    <Badge variant="outline" className={cn('font-medium', STYLES[s] ?? STYLES.not_required)}>
      {LABELS[s] ?? s}
    </Badge>
  );
}
