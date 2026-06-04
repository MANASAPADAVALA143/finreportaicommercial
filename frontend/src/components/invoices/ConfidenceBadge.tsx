import { cn } from '@/lib/utils';

type Props = {
  score: number | null;
  size?: 'sm' | 'md';
  className?: string;
};

export function ConfidenceBadge({ score, size = 'sm', className }: Props) {
  const showLabel = size === 'md';
  if (score == null || Number.isNaN(Number(score))) {
    return (
      <span
        className={cn(
          'inline-flex items-center rounded-full border font-medium',
          'border-border bg-muted text-muted-foreground',
          size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-3 py-1 text-sm',
          className
        )}
      >
        {showLabel ? 'Not scored' : '—'}
      </span>
    );
  }

  const n = Math.min(100, Math.max(0, Number(score)));
  const tier =
    n >= 90
      ? 'border-green-200 bg-green-100 text-green-800'
      : n >= 70
        ? 'border-amber-200 bg-amber-100 text-amber-900'
        : 'border-red-200 bg-red-100 text-red-800';

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border font-medium',
        tier,
        size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-3 py-1 text-sm',
        className
      )}
    >
      {showLabel ? `${Math.round(n)}% confidence` : `${Math.round(n)}%`}
    </span>
  );
}
